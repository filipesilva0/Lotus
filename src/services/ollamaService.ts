// Ollama client: streaming chat (text + vision), model list, running models, pull, delete.

import { http, EngineError, errorText, timeoutSignal } from '../lib/http';
import { engineUrl } from './engineConfig';

const ENGINE = 'Ollama';

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** Base64 image data (no data: prefix) for vision models. */
  images?: string[];
}

export interface ChatOptions {
  model: string;
  temperature?: number;
  topP?: number;
  numCtx?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  topK?: number;
  stop?: string[];
  seed?: number;
  numPredict?: number;
  signal?: AbortSignal;
  /** Receives the exact JSON body sent (for the developer inspector). */
  onRequest?: (body: unknown) => void;
  /** Receives the final streamed chunk (token counts, durations). */
  onFinal?: (chunk: any) => void;
  /** Called with reasoning tokens from "thinking" models; hidden by default. */
  onThinking?: (token: string) => void;
  /** Ask a thinking-capable model to reason first (Ollama `think`). Leave undefined for other models. */
  think?: boolean | 'low' | 'medium' | 'high';
  /** Ollama response format: 'json' or a JSON schema. */
  format?: 'json' | Record<string, unknown>;
}

export interface ChatStats {
  tokensPerSec: number;
  totalTokens: number;
  durationMs: number;
}

export interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
  details?: { parameter_size?: string; quantization_level?: string; family?: string };
}

export interface RunningModel {
  name: string;
  size: number;
  size_vram: number;
  expires_at: string;
}

export interface PullProgress {
  status: string;
  completed?: number;
  total?: number;
}

const unreachable = (cause?: unknown) =>
  new EngineError(
    `Can't reach Ollama at ${engineUrl('ollama')}. Start Ollama (or the engine from the Engines tab), then try again.${cause ? ` (${cause instanceof Error ? cause.message : String(cause)})` : ''}`,
    ENGINE,
    undefined,
    true,
  );

/** Splits a streamed NDJSON body into parsed objects, handling lines that span chunks. */
async function* ndjson<T>(res: Response): AsyncGenerator<T> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) {
        try {
          yield JSON.parse(line) as T;
        } catch {
          /* skip a malformed line */
        }
      }
    }
  }
  const rest = buf.trim();
  if (rest) {
    try {
      yield JSON.parse(rest) as T;
    } catch {
      /* ignore */
    }
  }
}

export class OllamaService {
  get baseUrl() {
    return engineUrl('ollama');
  }

  private async raw(path: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
    let res: Response;
    try {
      res = await http(`${this.baseUrl}${path}`, { ...init, signal: init.signal ?? timeoutSignal(timeoutMs) });
    } catch (e) {
      throw unreachable(e);
    }
    if (!res.ok) throw new EngineError(await errorText(res), ENGINE, res.status);
    return res;
  }

  async checkHealth(timeoutMs = 1500): Promise<boolean> {
    try {
      const res = await http(`${this.baseUrl}/api/tags`, { signal: timeoutSignal(timeoutMs) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async version(): Promise<string | null> {
    try {
      const r = await this.raw('/api/version', {}, 1500);
      return (await r.json()).version ?? null;
    } catch {
      return null;
    }
  }

  async listModels(): Promise<OllamaModel[]> {
    return (await (await this.raw('/api/tags')).json()).models ?? [];
  }

  async runningModels(): Promise<RunningModel[]> {
    return (await (await this.raw('/api/ps')).json()).models ?? [];
  }

  async deleteModel(name: string) {
    await this.raw('/api/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: name }),
    });
  }

  /** Streams download progress for `ollama pull`. */
  async *pull(name: string, signal?: AbortSignal): AsyncGenerator<PullProgress> {
    const res = await this.raw(
      '/api/pull',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: name, stream: true }),
        signal,
      },
      24 * 3600_000,
    );
    for await (const chunk of ndjson<PullProgress & { error?: string }>(res)) {
      if (chunk.error) throw new EngineError(chunk.error, ENGINE);
      yield chunk;
    }
  }

  /** Streams assistant tokens. Reasoning ("thinking") tokens never reach the yielded text. */
  async *streamChat(
    messages: ChatTurn[],
    opts: ChatOptions,
    onStats?: (s: ChatStats) => void,
  ): AsyncGenerator<string, void, unknown> {
    const body = {
      model: opts.model,
      messages,
      stream: true,
      ...(opts.think !== undefined ? { think: opts.think } : {}),
      ...(opts.format ? { format: opts.format } : {}),
      options: {
        temperature: opts.temperature,
        top_p: opts.topP,
        top_k: opts.topK,
        num_ctx: opts.numCtx,
        frequency_penalty: opts.frequencyPenalty,
        presence_penalty: opts.presencePenalty,
        stop: opts.stop?.length ? opts.stop : undefined,
        seed: opts.seed,
        num_predict: opts.numPredict,
      },
    };
    opts.onRequest?.(body);
    const res = await this.raw(
      '/api/chat',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: opts.signal, body: JSON.stringify(body) },
      30 * 60_000,
    );

    const start = performance.now();
    let tokens = 0;
    for await (const chunk of ndjson<any>(res)) {
      if (chunk.error) throw new EngineError(String(chunk.error), ENGINE);
      const thinking = chunk.message?.thinking;
      if (thinking) opts.onThinking?.(thinking);
      const token: string | undefined = chunk.message?.content;
      if (token) {
        tokens++;
        const secs = (performance.now() - start) / 1000;
        onStats?.({
          tokensPerSec: secs > 0 ? Math.round((tokens / secs) * 10) / 10 : 0,
          totalTokens: tokens,
          durationMs: Math.round(secs * 1000),
        });
        yield token;
      }
      if (chunk.done) opts.onFinal?.(chunk);
      if (chunk.done && chunk.eval_count && chunk.eval_duration) {
        // Ollama reports exact generation speed on the final chunk.
        onStats?.({
          tokensPerSec: Math.round((chunk.eval_count / (chunk.eval_duration / 1e9)) * 10) / 10,
          totalTokens: chunk.eval_count,
          durationMs: Math.round((chunk.total_duration ?? 0) / 1e6),
        });
      }
    }
  }

  /** Model metadata: architecture numbers (for memory maths), capabilities (vision, thinking, tools). */
  async show(name: string): Promise<{ model_info?: Record<string, unknown>; capabilities?: string[]; details?: OllamaModel['details'] }> {
    return (await this.raw('/api/show', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: name }) })).json();
  }

  /** Loads a model into memory (empty prompt) and keeps it there until unloaded or idle for `keepAlive`. */
  async load(name: string, keepAlive: string | number = '30m') {
    await this.raw('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: name, keep_alive: keepAlive }) }, 10 * 60_000);
  }

  async unload(name: string) {
    await this.raw('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: name, keep_alive: 0 }) });
  }

  /** Non-streaming call that reports real token counts (used by Deep Research). */
  async chatOnce(
    messages: ChatTurn[],
    opts: ChatOptions & { json?: boolean },
  ): Promise<{ content: string; thinking: string; promptTokens: number; evalTokens: number }> {
    const res = await this.raw(
      '/api/chat',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: opts.signal,
        body: JSON.stringify({
          model: opts.model, messages, stream: false, ...(opts.json ? { format: 'json' } : opts.format ? { format: opts.format } : {}),
          ...(opts.think !== undefined ? { think: opts.think } : {}),
          options: { temperature: opts.temperature, top_p: opts.topP, num_ctx: opts.numCtx, num_predict: opts.numPredict },
        }),
      },
      30 * 60_000,
    );
    const j = await res.json();
    if (j.error) throw new EngineError(String(j.error), ENGINE);
    return { content: j.message?.content ?? '', thinking: j.message?.thinking ?? '', promptTokens: j.prompt_eval_count ?? 0, evalTokens: j.eval_count ?? 0 };
  }

  /** One-shot, non-streaming helper (used by the island for short answers). */
  async complete(messages: ChatTurn[], opts: ChatOptions): Promise<string> {
    let out = '';
    for await (const t of this.streamChat(messages, opts)) out += t;
    return out;
  }
}

export const ollamaClient = new OllamaService();

/** Browser File → base64 payload for Ollama's `images` field. */
export async function fileToBase64(file: Blob): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}
