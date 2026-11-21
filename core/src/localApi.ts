// The local API (Advanced mode, 0.18.0): lets other apps on this PC use Lotus's chat model through the
// OpenAI-style API most tools speak (/v1/models, /v1/chat/completions). Off by default. It listens on
// 127.0.0.1 only and every request needs the access key shown in Settings.
//
// Requests are passed to whatever runs chat in Lotus: its own engine (the model is loaded on demand),
// Ollama, or the user's server or cloud service (with its key, which never leaves the core).
//
// Settings live in kv `lotus.localApi.v1`: { enabled, port, key }.

import type { Server } from 'bun';
import type { Db } from './db';
import { kvGet } from './kv';
import { engineChoice } from '../../src/lib/engineDefaults';
import { authHeader } from './agent/llm';
import type { Builtins } from './engines/manager';

export const LOCAL_API_KEY = 'lotus.localApi.v1';
export const DEFAULT_PORT = 11470;

export interface LocalApiSettings { enabled: boolean; port: number; key: string }
export interface LocalApiStatus { enabled: boolean; running: boolean; port: number; url: string; error?: string }

export function readLocalApi(db: Db): LocalApiSettings {
  let s: Partial<LocalApiSettings> = {};
  try { s = JSON.parse(kvGet(db, LOCAL_API_KEY) || '{}'); } catch { /* defaults */ }
  const port = typeof s.port === 'number' && s.port >= 1024 && s.port <= 65535 ? Math.round(s.port) : DEFAULT_PORT;
  return { enabled: s.enabled === true, port, key: typeof s.key === 'string' ? s.key : '' };
}

/** Where chat requests go right now, with the header that unlocks it. */
export interface Upstream { url: string; auth: string | null; builtin: boolean }

export function chatUpstream(db: Db): Upstream {
  const raw = kvGet(db, 'lotus.settings.v1');
  const backend = engineChoice(raw).llmBackend;
  let s: Record<string, unknown> = {};
  try { s = JSON.parse(raw || '{}'); } catch { /* defaults */ }
  let keys: Record<string, unknown> = {};
  try { keys = JSON.parse(kvGet(db, 'lotus.engineAuth.v1') || '{}'); } catch { /* none */ }
  const bearer = (k: unknown) => authHeader(typeof k === 'string' ? k : undefined);
  if (backend === 'ollama') {
    let ollama = 'http://127.0.0.1:11434';
    try { const m = JSON.parse(kvGet(db, 'lotus.engineUrls.v1') || '{}'); if (m.ollama) ollama = String(m.ollama); } catch { /* default */ }
    return { url: ollama.replace(/\/+$/, ''), auth: bearer(keys.ollama), builtin: false };
  }
  if (backend === 'llamacpp') {
    const url = typeof s.llamacppUrl === 'string' && s.llamacppUrl ? s.llamacppUrl : 'http://127.0.0.1:8080';
    return { url: url.replace(/\/+$/, ''), auth: bearer(keys.llamacpp), builtin: false };
  }
  return { url: '', auth: null, builtin: true };
}

const sameKey = (a: string, b: string) => {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

const err = (status: number, message: string, type = 'invalid_request_error') =>
  new Response(JSON.stringify({ error: { message, type } }), { status, headers: { 'content-type': 'application/json' } });

export class LocalApi {
  private server: Server<undefined> | null = null;
  private error: string | undefined;
  private port = DEFAULT_PORT;

  constructor(private o: { db: Db; builtins?: Builtins; fetch?: typeof fetch; log?: (m: string) => void }) {}

  status(): LocalApiStatus {
    const s = readLocalApi(this.o.db);
    const port = this.server ? this.port : s.port;
    return { enabled: s.enabled, running: !!this.server, port, url: `http://127.0.0.1:${port}/v1`, error: this.error };
  }

  /** Starts, stops or moves the server to match the saved settings. */
  apply(): LocalApiStatus {
    const s = readLocalApi(this.o.db);
    const want = s.enabled && s.key.length >= 16;
    if (this.server && (!want || this.port !== s.port)) { this.server.stop(true); this.server = null; }
    this.error = s.enabled && !want ? 'Make an access key first.' : undefined;
    if (want && !this.server) {
      try {
        this.server = Bun.serve({ hostname: '127.0.0.1', port: s.port, idleTimeout: 0, fetch: (req) => this.handle(req) });
        this.port = s.port;
        this.o.log?.(`local API on 127.0.0.1:${s.port}`);
      } catch (e) {
        this.error = /in use|EADDRINUSE/i.test((e as Error).message) ? `Port ${s.port} is already used by another program. Pick another port.` : (e as Error).message;
      }
    }
    return this.status();
  }

  stop() { this.server?.stop(true); this.server = null; }

  private selectedModel(): string {
    try { return String(JSON.parse(kvGet(this.o.db, 'lotus.settings.v1') || '{}').selectedModel ?? ''); } catch { return ''; }
  }

  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    // Browsers can't use it: a web page would send its own Origin, and gets no CORS answer.
    if (req.headers.get('origin')) return err(403, 'The Lotus local API is for apps on this PC, not web pages.');
    // A page that rebinds its own domain to 127.0.0.1 still sends its own Host name.
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return err(403, 'Forbidden.');
    const { key } = readLocalApi(this.o.db);
    const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!sameKey(given, key)) return err(401, 'Missing or wrong API key. Copy it from Lotus → Settings → Advanced → Local API.', 'authentication_error');

    const fetchFn = this.o.fetch ?? fetch;
    const up = chatUpstream(this.o.db);
    try {
      if (url.pathname === '/v1/models' && req.method === 'GET') {
        if (up.builtin) {
          const data = (this.o.builtins?.installed() ?? []).filter((m) => m.kind === 'chat').map((m) => ({ id: m.id, object: 'model', created: 0, owned_by: 'lotus' }));
          return Response.json({ object: 'list', data });
        }
        const r = await fetchFn(`${up.url}/v1/models`, { headers: up.auth ? { authorization: up.auth } : {} });
        return new Response(r.body, { status: r.status, headers: { 'content-type': r.headers.get('content-type') ?? 'application/json' } });
      }
      if ((url.pathname === '/v1/chat/completions' || url.pathname === '/v1/completions' || url.pathname === '/v1/embeddings') && req.method === 'POST') {
        const body = (await req.json()) as Record<string, unknown>;
        if (!body.model) body.model = this.selectedModel();
        if (!body.model) return err(400, 'Say which model to use (model), or pick one in Lotus first.');
        let base = up.url;
        if (up.builtin) {
          if (!this.o.builtins) return err(503, "Lotus's own engine isn't available in this build.", 'server_error');
          base = (await this.o.builtins.ensureChat(String(body.model), { auto: true })).replace(/\/+$/, '');
        }
        const r = await fetchFn(`${base}${url.pathname}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(up.auth ? { authorization: up.auth } : {}) },
          body: JSON.stringify(body),
          signal: req.signal,
        });
        return new Response(r.body, { status: r.status, headers: { 'content-type': r.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' } });
      }
      return err(404, `Lotus's local API has no ${req.method} ${url.pathname}. It answers GET /v1/models and POST /v1/chat/completions.`);
    } catch (e) {
      return err(502, `Lotus couldn't reach its chat engine: ${(e as Error).message}`, 'server_error');
    }
  }
}
