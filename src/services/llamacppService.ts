// llama.cpp `llama-server` client (OpenAI-compatible API): streaming chat, one-shot chat, and the
// server's own settings (/props), which the VRAM auto-scaler reads because llama-server fixes its
// context size and number of parallel slots at start-up.

import { http, EngineError, errorText, timeoutSignal } from '../lib/http';
import type { ChatOptions, ChatStats, ChatTurn } from './ollamaService';
import type { LlamaCppProps } from '../hardware/scaler';

const ENGINE = 'llama.cpp';

/** OpenAI messages: images become image_url parts (llama-server with a multimodal projector). */
function toOpenAi(turns: ChatTurn[]) {
  return turns.map((t) => (t.images?.length
    ? { role: t.role, content: [{ type: 'text', text: t.content }, ...t.images.map((b) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${b}` } }))] }
    : { role: t.role, content: t.content }));
}

/** Parses an SSE body into `data:` JSON payloads (lines may be split across chunks). */
export async function* sse(res: Response): AsyncGenerator<any> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      try { yield JSON.parse(data); } catch { /* partial or junk line */ }
    }
  }
}

export class LlamaCppService {
  constructor(private readonly url: () => string) {}
  get baseUrl() { return this.url().replace(/\/+$/, ''); }

  private async raw(path: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
    let res: Response;
    try {
      res = await http(`${this.baseUrl}${path}`, { ...init, signal: init.signal ?? timeoutSignal(timeoutMs) });
    } catch (e) {
      throw new EngineError(`Can't reach llama-server at ${this.baseUrl}. Start it (for example \`llama-server -m model.gguf --port 8080\`) or change the address in Settings → Model & Inference. (${(e as Error).message})`, ENGINE, undefined, true);
    }
    if (!res.ok) throw new EngineError(await errorText(res), ENGINE, res.status);
    return res;
  }

  async checkHealth(timeoutMs = 1500): Promise<boolean> {
    try { return (await http(`${this.baseUrl}/health`, { signal: timeoutSignal(timeoutMs) })).ok; } catch { return false; }
  }

  /** Context size and slot count the server was started with. */
  async props(): Promise<LlamaCppProps & { model: string }> {
    const j = await (await this.raw('/props', {}, 3000)).json();
    const nCtx = Number(j?.default_generation_settings?.n_ctx ?? j?.n_ctx ?? 0);
    const slots = Number(j?.total_slots ?? 1);
    const model = String(j?.model_path ?? '').split(/[\\/]/).pop() ?? '';
    // Recent servers report n_ctx per slot; older ones the total. Normalise to the total.
    const perSlotReported = j?.default_generation_settings?.n_ctx !== undefined && j?.n_ctx === undefined && slots > 1;
    return { nCtx: perSlotReported ? nCtx * slots : nCtx, slots, model };
  }

  async listModels(): Promise<string[]> {
    try {
      const j = await (await this.raw('/v1/models', {}, 3000)).json();
      return (j?.data ?? []).map((m: { id: string }) => m.id);
    } catch { return []; }
  }

  private body(turns: ChatTurn[], o: ChatOptions, stream: boolean) {
    return {
      model: o.model, messages: toOpenAi(turns), stream,
      temperature: o.temperature, top_p: o.topP, top_k: o.topK, seed: o.seed,
      frequency_penalty: o.frequencyPenalty, presence_penalty: o.presencePenalty,
      stop: o.stop?.length ? o.stop : undefined, max_tokens: o.numPredict,
      ...(o.format === 'json' ? { response_format: { type: 'json_object' } } : {}),
      ...(stream ? { stream_options: { include_usage: true } } : {}),
    };
  }

  async *streamChat(turns: ChatTurn[], o: ChatOptions, onStats?: (s: ChatStats) => void): AsyncGenerator<string, void, unknown> {
    const body = this.body(turns, o, true);
    o.onRequest?.(body);
    const res = await this.raw('/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: o.signal }, 30 * 60_000);
    const start = performance.now();
    let n = 0;
    for await (const c of sse(res)) {
      if (c.error) throw new EngineError(String(c.error.message ?? c.error), ENGINE);
      const d = c.choices?.[0]?.delta ?? {};
      if (d.reasoning_content) o.onThinking?.(d.reasoning_content);
      if (d.content) {
        n++;
        const secs = (performance.now() - start) / 1000;
        onStats?.({ tokensPerSec: secs > 0 ? Math.round((n / secs) * 10) / 10 : 0, totalTokens: n, durationMs: Math.round(secs * 1000) });
        yield d.content;
      }
      if (c.usage) o.onFinal?.({ prompt_eval_count: c.usage.prompt_tokens, eval_count: c.usage.completion_tokens, timings: c.timings });
      if (c.timings?.predicted_per_second) onStats?.({ tokensPerSec: Math.round(c.timings.predicted_per_second * 10) / 10, totalTokens: c.timings.predicted_n ?? n, durationMs: Math.round((c.timings.predicted_ms ?? 0) + (c.timings.prompt_ms ?? 0)) });
    }
  }

  async chatOnce(turns: ChatTurn[], o: ChatOptions & { json?: boolean }): Promise<{ content: string; thinking: string; promptTokens: number; evalTokens: number }> {
    const body = this.body(turns, { ...o, format: o.json ? 'json' : o.format }, false);
    const j = await (await this.raw('/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: o.signal }, 30 * 60_000)).json();
    const msg = j?.choices?.[0]?.message ?? {};
    return { content: msg.content ?? '', thinking: msg.reasoning_content ?? '', promptTokens: j?.usage?.prompt_tokens ?? 0, evalTokens: j?.usage?.completion_tokens ?? 0 };
  }
}
