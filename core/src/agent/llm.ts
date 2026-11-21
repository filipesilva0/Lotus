// Chat model access for the agent: Ollama's /api/chat (with native tool calling when the model
// supports it) and llama.cpp's OpenAI-compatible server (text only; tools go through tags).

export interface WireCall { name: string; args: Record<string, unknown> }
export type WireMsg =
  | { role: 'system' | 'user'; content: string; images?: string[] }
  | { role: 'assistant'; content: string; tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[] }
  | { role: 'tool'; content: string; tool_name: string };

export interface WireTool { type: 'function'; function: { name: string; description: string; parameters: unknown } }

export interface ChatOpts {
  backend: 'ollama' | 'llamacpp';
  /** llama.cpp only: send the tool list in OpenAI's format (the built-in server runs with --jinja). */
  nativeTools?: boolean;
  url: string;
  auth?: string | null;
  model: string;
  temperature?: number; topP?: number; topK?: number; numCtx?: number; seed?: number; numPredict?: number; stop?: string[];
  /** Chat's right panel (STATE #11): sent to both engines. */
  frequencyPenalty?: number; presencePenalty?: number;
  /**
   * Ask a thinking model to think (true) or not (false); undefined leaves the model's default.
   * Ollama takes `think`; llama-server takes the chat template's `enable_thinking` switch.
   */
  think?: boolean;
  signal: AbortSignal;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /**
   * Built-in engine: restart llama-server with room for at least `tokens` and return its new address.
   * Called when a request is longer than the running context (a long chat, many tool results).
   */
  growCtx?: (tokens: number) => Promise<string>;
}

export interface TurnResult { content: string; calls: WireCall[]; promptTokens?: number; evalTokens?: number; tokensPerSec?: number; durationMs: number }

export class ToolsUnsupported extends Error {}

const headers = (o: ChatOpts): Record<string, string> => ({ 'content-type': 'application/json', ...(o.auth ? { authorization: o.auth } : {}) });

/** Engine access key → Authorization header (same rules as the app's engineConfig). */
export function authHeader(token: string | undefined): string | null {
  const t = (token ?? '').trim();
  if (!t) return null;
  if (/^(basic|bearer) /i.test(t)) return t;
  if (t.includes(':')) return `Basic ${Buffer.from(t, 'utf8').toString('base64')}`;
  return `Bearer ${t}`;
}

/** A stream that sends nothing for this long is given up on (the engine hung or was stopped). */
export const IDLE_MS = { value: 120_000 };

async function* lines(res: Response, signal: AbortSignal): AsyncGenerator<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
      let timer: ReturnType<typeof setTimeout> | undefined;
      const idle = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`The model sent nothing for ${Math.round(IDLE_MS.value / 1000)} seconds, so Lotus stopped waiting. The engine may be overloaded or stuck; try again, or restart it in Settings → Engines.`)), IDLE_MS.value); });
      const onAbort = () => { void reader.cancel().catch(() => undefined); };
      signal.addEventListener('abort', onAbort, { once: true });
      let chunk: { done: boolean; value?: Uint8Array };
      try { chunk = await Promise.race([reader.read(), idle]); }
      catch (e) { void reader.cancel().catch(() => undefined); if (signal.aborted) throw new DOMException('Stopped', 'AbortError'); throw e; }
      finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); }
      const { done, value } = chunk;
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); if (l) yield l; }
    }
    if (buf.trim()) yield buf.trim();
  } finally { try { reader.releaseLock(); } catch { /* done */ } }
}

const capCache = new Map<string, string[]>();

/** Ollama's capabilities for a model ('completion', 'tools', 'thinking', 'vision'…); [] if unknown. */
export async function ollamaCapabilities(o: Pick<ChatOpts, 'url' | 'auth' | 'model' | 'fetch' | 'signal'>): Promise<string[]> {
  const key = `${o.url}|${o.model}`;
  const hit = capCache.get(key);
  if (hit) return hit;
  try {
    const r = await o.fetch(`${o.url}/api/show`, { method: 'POST', headers: { 'content-type': 'application/json', ...(o.auth ? { authorization: o.auth } : {}) }, body: JSON.stringify({ model: o.model }), signal: o.signal });
    if (!r.ok) return [];
    const j = (await r.json()) as { capabilities?: string[] };
    const caps = Array.isArray(j.capabilities) ? j.capabilities : [];
    capCache.set(key, caps);
    return caps;
  } catch { return []; }
}
export const __clearCapCache = () => capCache.clear();

class SilentEngine extends Error {}

/**
 * fetch that gives up when the engine doesn't start answering within IDLE_MS (Ollama sends nothing
 * until the model produces output, and a model stuck inside a tool call it never closes produces none).
 */
async function firstByte(o: ChatOpts, url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  let silent = false;
  const timer = setTimeout(() => { silent = true; ctrl.abort(); }, IDLE_MS.value);
  try {
    return await o.fetch(url, { ...init, signal: AbortSignal.any([o.signal, ctrl.signal]) });
  } catch (e) {
    if (silent && !o.signal.aborted) throw new SilentEngine(`The model sent nothing for ${Math.round(IDLE_MS.value / 1000)} seconds, so Lotus stopped waiting. The engine may be overloaded or stuck; try again, or restart it in Settings → Engines.`);
    throw e;
  } finally { clearTimeout(timer); }
}

function reachError(o: ChatOpts, e: unknown): Error {
  if ((e as Error)?.name === 'AbortError' || e instanceof SilentEngine) return e as Error;
  const who = o.backend === 'ollama' ? 'Ollama' : 'the llama.cpp server';
  return new Error(`Can't reach ${who} at ${o.url}. Start it from Settings → Engines (or the notice above the chat box), then send again.`);
}

/**
 * Ollama-style messages → OpenAI's: tool calls get ids, and each tool result answers the matching
 * call in order (Lotus runs a turn's calls in the order the model gave them).
 */
export function toOpenAi(messages: WireMsg[]): unknown[] {
  const out: unknown[] = [];
  let pending: string[] = [];
  let n = 0;
  for (const m of messages) {
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const ids = m.tool_calls.map(() => `call_${++n}`);
      pending = [...ids];
      out.push({ role: 'assistant', content: m.content || null, tool_calls: m.tool_calls.map((c, i) => ({ id: ids[i], type: 'function', function: { name: c.function.name, arguments: JSON.stringify(c.function.arguments ?? {}) } })) });
    } else if (m.role === 'tool') {
      const id = pending.shift() ?? `call_${++n}`;
      out.push({ role: 'tool', tool_call_id: id, content: m.content });
    } else if ((m.role === 'user' || m.role === 'system') && m.images?.length) {
      out.push({ role: m.role, content: [{ type: 'text', text: m.content }, ...m.images.map((b) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${b}` } }))] });
    } else out.push({ role: m.role, content: m.content });
  }
  return out;
}

/** One model turn. Streams text through onToken / onThinking; returns the text and any tool calls. */
/**
 * Splits a reply's text into answer and thinking (0.14.2). Engines are meant to send thinking apart
 * (Ollama `thinking`, llama-server `reasoning_content`), but a template the engine doesn't recognise
 * streams `<think>…</think>` inside the answer: it showed in Chat, and its "I'll add…" tripped the
 * claim check, which wiped the answer and asked again. Tags split across chunks are handled; a
 * `</think>` with no opening tag (the template opened it in the prompt) turns what was shown so far
 * into thinking (`retract`).
 */
export class ThinkSplit {
  private buf = '';
  private state: 'start' | 'content' | 'think' = 'start';
  private opened = false;
  private orphanDone = false;
  /** The answer text sent so far (after any retract). */
  visible = '';
  constructor(private on: { token: (t: string) => void; thinking: (t: string) => void; retract?: (shown: string) => void }) {}

  private content(t: string) { if (t) { this.visible += t; this.on.token(t); } }
  private think(t: string) { if (t) this.on.thinking(t); }

  push(t: string) {
    this.buf += t;
    for (;;) {
      if (this.state === 'start') {
        const s = this.buf.replace(/^\s+/, '');
        if (!s || '<think>'.startsWith(s)) return;
        if (s.startsWith('<think>')) { this.state = 'think'; this.opened = true; this.buf = s.slice(7); continue; }
        this.state = 'content';
        continue;
      }
      if (this.state === 'think') {
        const i = this.buf.indexOf('</think>');
        if (i >= 0) { this.think(this.buf.slice(0, i)); this.buf = this.buf.slice(i + 8).replace(/^\s+/, ''); this.state = 'content'; continue; }
        const keep = this.partialTail(this.buf, '</think>');
        this.think(this.buf.slice(0, this.buf.length - keep)); this.buf = this.buf.slice(this.buf.length - keep);
        return;
      }
      const open = this.buf.indexOf('<think>');
      const close = this.buf.indexOf('</think>');
      if (close >= 0 && (open < 0 || close < open) && !this.opened && !this.orphanDone) {
        // The template opened the thinking in the prompt: everything up to here was thinking.
        this.orphanDone = true;
        const was = this.visible;
        this.visible = '';
        this.on.retract?.(was);
        this.think(was + this.buf.slice(0, close));
        this.buf = this.buf.slice(close + 8).replace(/^\s+/, '');
        continue;
      }
      if (open >= 0) { this.content(this.buf.slice(0, open)); this.buf = this.buf.slice(open + 7); this.state = 'think'; this.opened = true; continue; }
      const keep = Math.max(this.partialTail(this.buf, '<think>'), this.partialTail(this.buf, '</think>'));
      this.content(this.buf.slice(0, this.buf.length - keep)); this.buf = this.buf.slice(this.buf.length - keep);
      return;
    }
  }

  /** How many characters at the end of `s` could be the start of `tag`. */
  private partialTail(s: string, tag: string): number {
    for (let n = Math.min(tag.length - 1, s.length); n > 0; n--) if (tag.startsWith(s.slice(-n))) return n;
    return 0;
  }

  end() {
    if (this.state === 'think') this.think(this.buf); else this.content(this.state === 'start' ? this.buf.replace(/^\s+/, '') : this.buf);
    this.buf = '';
  }
}

export async function chatTurn(o: ChatOpts, messages: WireMsg[], tools: WireTool[] | null, on0: { token: (t: string) => void; thinking: (t: string) => void; retract?: (shown: string) => void }): Promise<TurnResult> {
  const t0 = Date.now();
  const split = new ThinkSplit(on0);
  const on = { token: (t: string) => split.push(t), thinking: on0.thinking };
  if (o.backend === 'llamacpp') {
    const native = !!(o.nativeTools && tools?.length);
    const body: Record<string, unknown> = {
      model: o.model, stream: true, messages: native ? toOpenAi(messages) : messages.map((m) => (m.role === 'tool' ? { role: 'user', content: m.content } : { role: m.role, content: m.content })),
      temperature: o.temperature, top_p: o.topP, top_k: o.topK, seed: o.seed, max_tokens: o.numPredict, stop: o.stop?.length ? o.stop : undefined,
      frequency_penalty: o.frequencyPenalty, presence_penalty: o.presencePenalty,
    };
    if (native) body.tools = tools;
    // Without this, llama-server renders the template with thinking on, so Think off did nothing and a
    // reasoning model (Gemma 4 12B on an 8 GB card) reasoned for minutes before a one-line answer.
    if (o.think !== undefined) body.chat_template_kwargs = { enable_thinking: o.think };
    let res: Response;
    try { res = await firstByte(o, `${o.url}/v1/chat/completions`, { method: 'POST', headers: headers(o), body: JSON.stringify(body) }); }
    catch (e) { throw reachError(o, e); }
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      if (native && (res.status === 400 || res.status === 422 || res.status === 500) && /tool|template|jinja|function/i.test(text)) throw new ToolsUnsupported(text);
      if (res.status === 401 || res.status === 403) throw new Error(`The server at ${o.url} wants an access key, or the one saved is wrong. Enter it under the server's address in Settings → Engines.`);
      const need = /exceed_context_size|exceeds the available context/i.test(text) ? Number(/"n_prompt_tokens"\s*:\s*(\d+)/.exec(text)?.[1]) || 0 : 0;
      if (need && o.growCtx) {
        // Room for the prompt plus a reply, rounded up to a whole 4K.
        const ctx = Math.ceil((need + Math.max(2048, o.numPredict ?? 0)) / 4096) * 4096;
        const url = await o.growCtx(ctx);
        return chatTurn({ ...o, url, growCtx: undefined }, messages, tools, on0);
      }
      if (need) throw new Error(`This conversation (${need} tokens) is longer than the model's context window. Raise Context Window in Settings, or start a new chat.`);
      throw new Error(`The llama.cpp server answered ${res.status}: ${text.slice(0, 200)}`);
    }
    const parts = new Map<number, { name: string; args: string }>();
    let promptTokens: number | undefined, evalTokens: number | undefined;
    for await (const l of lines(res, o.signal)) {
      if (!l.startsWith('data:')) continue;
      const d = l.slice(5).trim();
      if (d === '[DONE]') break;
      try {
        const j = JSON.parse(d) as { choices?: { delta?: { content?: string | null; reasoning_content?: string; tool_calls?: { index?: number; function?: { name?: string; arguments?: string } }[] } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
        const delta = j.choices?.[0]?.delta;
        if (delta?.reasoning_content) on.thinking(delta.reasoning_content);
        if (delta?.content) on.token(delta.content);
        for (const tc of delta?.tool_calls ?? []) {
          const k = tc.index ?? 0;
          const cur = parts.get(k) ?? { name: '', args: '' };
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          parts.set(k, cur);
        }
        if (j.usage) { promptTokens = j.usage.prompt_tokens; evalTokens = j.usage.completion_tokens; }
      } catch { /* keep-alive */ }
    }
    const calls: WireCall[] = [...parts.values()].filter((p) => p.name).map((p) => {
      let args: unknown = {};
      try { args = p.args ? JSON.parse(p.args) : {}; } catch { args = {}; }
      return { name: p.name, args: args && typeof args === 'object' ? (args as Record<string, unknown>) : {} };
    });
    split.end();
    const content = split.visible;
    const ms = Date.now() - t0;
    return { content, calls, promptTokens, evalTokens, tokensPerSec: evalTokens && ms ? Math.round((evalTokens / (ms / 1000)) * 10) / 10 : undefined, durationMs: ms };
  }

  const body: Record<string, unknown> = {
    model: o.model, messages, stream: true,
    options: { temperature: o.temperature, top_p: o.topP, top_k: o.topK, num_ctx: o.numCtx, seed: o.seed, num_predict: o.numPredict, stop: o.stop?.length ? o.stop : undefined, frequency_penalty: o.frequencyPenalty, presence_penalty: o.presencePenalty },
  };
  if (tools?.length) body.tools = tools;
  if (o.think !== undefined) body.think = o.think;
  let res: Response;
  try { res = await firstByte(o, `${o.url}/api/chat`, { method: 'POST', headers: headers(o), body: JSON.stringify(body) }); }
  catch (e) { throw reachError(o, e); }
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    let msg = text;
    try { msg = (JSON.parse(text) as { error?: string }).error ?? text; } catch { /* plain */ }
    if (tools?.length && /does not support tools/i.test(msg)) throw new ToolsUnsupported(msg);
    if (res.status === 404 && /not found/i.test(msg)) throw new Error(`Ollama doesn't have the model ${o.model}. Download it in Settings → Models, or pick another model.`);
    throw new Error(`Ollama answered ${res.status}: ${msg}`);
  }
  const calls: WireCall[] = [];
  let promptTokens: number | undefined, evalTokens: number | undefined, tps: number | undefined;
  for await (const l of lines(res, o.signal)) {
    let j: { message?: { content?: string; thinking?: string; tool_calls?: { function?: { name?: string; arguments?: unknown } }[] }; done?: boolean; error?: string; prompt_eval_count?: number; eval_count?: number; eval_duration?: number };
    try { j = JSON.parse(l); } catch { continue; }
    if (j.error) throw new Error(`Ollama: ${j.error}`);
    const m = j.message;
    if (m?.thinking) on.thinking(m.thinking);
    if (m?.content) on.token(m.content);
    for (const c of m?.tool_calls ?? []) {
      const name = String(c.function?.name ?? '');
      let args = c.function?.arguments;
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
      if (name) calls.push({ name, args: args && typeof args === 'object' ? (args as Record<string, unknown>) : {} });
    }
    if (j.done) {
      promptTokens = j.prompt_eval_count; evalTokens = j.eval_count;
      if (j.eval_count && j.eval_duration) tps = Math.round((j.eval_count / (j.eval_duration / 1e9)) * 10) / 10;
    }
  }
  split.end();
  return { content: split.visible, calls, promptTokens, evalTokens, tokensPerSec: tps, durationMs: Date.now() - t0 };
}
