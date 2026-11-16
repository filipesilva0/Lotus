// The core's local API. Listens on 127.0.0.1 only, on a port the OS picks, and answers only
// requests that carry the session token the Lotus app generated when it started the core.
//
//   GET    /health                       liveness (no token, reveals nothing)
//   GET    /v1/info                      version, schema, folders
//   GET    /v1/kv                        every key → value
//   PUT    /v1/kv                        { set: {k: v}, remove: [k], origin } (atomic; broadcast)
//   POST   /v1/kv/migrate                { items: {k: v} } one-time import from browser storage
//   POST   /v1/media?name=&type=         raw bytes → { path, ... } saved under Lotus Studio
//   GET    /v1/media/<path>              the file (token may be passed as ?t= for <img>/<audio>)
//   DELETE /v1/media/<path>
//   GET    /v1/media-list?kind=image
//   POST   /v1/rpc/<method>              JSON args → JSON result (memory, agent_*: see agent/service.ts)
//   GET    /v1/events?t=                 WebSocket: { type: 'kv', set, remove, origin } · { type: 'agent', runId, kind, … } · { type: 'memory' }
//   GET    /v1/stream                    the same events as one JSON object per line (a streamed HTTP response).
//                                        The desktop app uses this through Tauri's HTTP client, because WebView2
//                                        may block a page from opening connections to 127.0.0.1 (session 16).

import type { Server, ServerWebSocket } from 'bun';
import { Db, schemaVersion, SCHEMA_VERSION } from './db';
import { KvChange, kvAll, kvApply, kvMigrate } from './kv';
import * as mem from './memory';
import { deleteMedia, listMedia, MAX_MEDIA, MediaKind, mimeFor, resolveMedia, saveMedia } from './media';
import { AgentService, type StartArgs } from './agent/service';
import { readHardware } from './hardware';

export const VERSION = '0.2.0';

export interface CoreOptions {
  db: Db;
  studio: string;
  token: string;
  port?: number;
  /** Extra browser origins allowed to call the API (tests, dev server). */
  origins?: string[];
  log?: (msg: string) => void;
  /** Engine and web access for the agent (tests pass a fake). */
  fetch?: typeof fetch;
}

const DEFAULT_ORIGINS = ['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost', 'http://127.0.0.1:3000', 'http://localhost:3000'];

type Json = Record<string, unknown>;
type Rpc = (db: Db, args: Json) => unknown;

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** RPC methods keep the names the Rust commands had, so the web layer's calls map one to one. */
export const RPC: Record<string, Rpc> = {
  mem_status: (db) => mem.status(db),
  mem_index: (db, a) => mem.indexMessages(db, Array.isArray(a.messages) ? (a.messages as mem.IndexedMsg[]) : []),
  mem_forget_session: (db, a) => { mem.forgetSession(db, str(a.sessionId)); return null; },
  mem_wipe_history: (db) => { mem.wipeHistory(db); return null; },
  mem_search: (db, a) => mem.searchMessages(db, str(a.query), str(a.excludeSession), num(a.limit, 6)),
  memories_list: (db) => mem.listMemories(db),
  memories_put: (db, a) => { mem.putMemories(db, Array.isArray(a.items) ? (a.items as mem.MemoryRow[]) : []); return null; },
  memories_delete: (db, a) => { mem.deleteMemory(db, str(a.id)); return null; },
  memories_search: (db, a) => mem.searchMemories(db, str(a.query), num(a.limit, 8)),
  skills_list: (db) => mem.listSkills(db),
  skills_put: (db, a) => mem.putSkill(db, a.skill as mem.SkillRow),
  skills_delete: (db, a) => { mem.deleteSkill(db, str(a.id)); return null; },
  skills_search: (db, a) => mem.searchSkills(db, str(a.query), num(a.limit, 3)),
  // Live CPU / RAM / GPU readings (Engines & Models → Hardware & Runtime).
  hw_live: () => readHardware(),
};

/** Constant-time comparison so the token can't be guessed byte by byte from timings. */
function sameToken(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Agent methods: they need the running service (events, approvals), not just the database. */
function agentRpc(agent: AgentService, o: CoreOptions, method: string, a: Json): { found: boolean; value?: unknown } {
  switch (method) {
    case 'agent_start': return { found: true, value: agent.start(a as unknown as StartArgs) };
    case 'agent_decide': return { found: true, value: agent.decide(str(a.runId), str(a.stepId), a.allow === true) };
    case 'agent_stop': return { found: true, value: agent.stop(str(a.runId)) };
    case 'agent_tools': return { found: true, value: { tools: agent.describeTools(), folders: agent.folders(Array.isArray(a.folders) ? a.folders.map(String) : []), studio: o.studio } };
    case 'agent_run': return { found: true, value: agent.run(str(a.runId)) };
    case 'agent_runs': return { found: true, value: agent.list(num(a.limit, 50)) };
    case 'agent_answer': return { found: true, value: agent.answer(str(a.runId), str(a.askId), str(a.answer)) };
    case 'work_artifacts': return { found: true, value: agent.artifacts(str(a.workId)) };
    case 'work_artifact': return { found: true, value: agent.artifactText(str(a.workId), str(a.file)) };
    case 'work_dir': return { found: true, value: agent.workDir(str(a.workId)) };
    default: return { found: false };
  }
}

export type CoreServer = Server<{ id: number }> & { agent: AgentService };

export function startServer(o: CoreOptions): CoreServer {
  const log = o.log ?? (() => undefined);
  const origins = new Set([...DEFAULT_ORIGINS, ...(o.origins ?? [])]);
  const sockets = new Set<ServerWebSocket<{ id: number }>>();
  let nextId = 1;

  const cors = (req: Request): Record<string, string> => {
    const origin = req.headers.get('origin');
    if (!origin || !origins.has(origin)) return {};
    return {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET, PUT, POST, DELETE, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type, x-lotus-name',
      'access-control-max-age': '600',
      // Chromium's Private Network Access preflight (pages reaching 127.0.0.1).
      'access-control-allow-private-network': 'true',
      vary: 'origin',
    };
  };
  const json = (req: Request, body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors(req) } });
  const fail = (req: Request, status: number, error: string) => json(req, { error }, status);

  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const enc = new TextEncoder();
  const broadcast = (event: Json) => {
    const msg = JSON.stringify(event);
    for (const s of sockets) { try { s.send(msg); } catch { /* closed */ } }
    const line = enc.encode(`${msg}\n`);
    for (const c of streams) { try { c.enqueue(line); } catch { streams.delete(c); } }
  };
  // Keeps idle streams from being cut by anything in between, and finds dead ones.
  const keepAlive = setInterval(() => { const l = enc.encode('{"type":"ping"}\n'); for (const c of streams) { try { c.enqueue(l); } catch { streams.delete(c); } } }, 5_000);
  (keepAlive as { unref?: () => void }).unref?.();
  const agent = new AgentService({ db: o.db, studio: o.studio, broadcast, fetch: o.fetch, log });

  const server = Bun.serve<{ id: number }, never>({
    hostname: '127.0.0.1',
    // Bun closes a connection after 10 s without traffic; /v1/stream pings every 5 s, so 30 s is plenty.
    idleTimeout: 30,
    port: o.port ?? 0,
    maxRequestBodySize: MAX_MEDIA + 1024 * 1024,
    async fetch(req, srv) {
      const url = new URL(req.url);
      // Only this machine's loopback names: a web page that rebinds its own domain to 127.0.0.1
      // still sends its own Host header and is refused.
      const host = (req.headers.get('host') ?? '').toLowerCase();
      if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) return new Response('Forbidden', { status: 403 });

      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
      if (url.pathname === '/health') return json(req, { ok: true });

      const auth = req.headers.get('authorization') ?? '';
      const given = auth.startsWith('Bearer ') ? auth.slice(7) : (url.searchParams.get('t') ?? '');
      if (!sameToken(given, o.token)) return fail(req, 401, 'Missing or wrong Lotus core token.');

      try {
        if (url.pathname === '/v1/events') {
          if (srv.upgrade(req, { data: { id: nextId++ } })) return undefined as unknown as Response;
          return fail(req, 400, 'Expected a WebSocket upgrade.');
        }
        if (url.pathname === '/v1/stream' && req.method === 'GET') {
          let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null;
          const body = new ReadableStream<Uint8Array>({
            start(c) { ctrl = c; streams.add(c); c.enqueue(enc.encode(`${JSON.stringify({ type: 'hello', version: VERSION })}\n`)); },
            cancel() { if (ctrl) streams.delete(ctrl); },
          });
          req.signal.addEventListener('abort', () => { if (ctrl) { streams.delete(ctrl); try { ctrl.close(); } catch { /* closed */ } } });
          return new Response(body, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', ...cors(req) } });
        }
        if (url.pathname === '/v1/info' && req.method === 'GET') {
          return json(req, { version: VERSION, schema: schemaVersion(o.db), latestSchema: SCHEMA_VERSION, dataDir: o.db.dir, dbPath: o.db.path, studioDir: o.studio, fts5: o.db.fts, pid: process.pid });
        }
        if (url.pathname === '/v1/kv') {
          if (req.method === 'GET') return json(req, { items: kvAll(o.db) });
          if (req.method === 'PUT') {
            const body = (await req.json()) as Partial<KvChange> & { origin?: string };
            const done = kvApply(o.db, { set: body.set ?? {}, remove: body.remove ?? [] });
            if (Object.keys(done.set).length || done.remove.length) broadcast({ type: 'kv', ...done, origin: str(body.origin) });
            return json(req, { ok: true });
          }
        }
        if (url.pathname === '/v1/kv/migrate' && req.method === 'POST') {
          const body = (await req.json()) as { items?: Record<string, string> };
          const r = kvMigrate(o.db, body.items ?? {});
          if (r) log(`imported ${r.added} keys from browser storage`);
          return json(req, r ? { migrated: true, added: r.added } : { migrated: false });
        }
        if (url.pathname === '/v1/media' && req.method === 'POST') {
          const type = req.headers.get('content-type') ?? url.searchParams.get('type') ?? '';
          const row = await saveMedia(o.db, o.studio, await req.arrayBuffer(), type, url.searchParams.get('name') ?? 'file');
          return json(req, row);
        }
        if (url.pathname === '/v1/media-list' && req.method === 'GET') {
          const kind = url.searchParams.get('kind');
          return json(req, { items: listMedia(o.db, kind === 'image' || kind === 'audio' ? (kind as MediaKind) : undefined) });
        }
        if (url.pathname.startsWith('/v1/media/')) {
          const rel = decodeURIComponent(url.pathname.slice('/v1/media/'.length));
          const full = resolveMedia(o.studio, rel);
          if (!full) return fail(req, 400, 'That path is outside the Images and Audio folders.');
          if (req.method === 'GET') {
            const f = Bun.file(full);
            if (!(await f.exists())) return fail(req, 404, 'That file is no longer in the Lotus Studio folder.');
            return new Response(f, { headers: { 'content-type': mimeFor(full), 'cache-control': 'private, max-age=31536000, immutable', ...cors(req) } });
          }
          if (req.method === 'DELETE') { deleteMedia(o.db, o.studio, rel); return json(req, { ok: true }); }
        }
        if (url.pathname.startsWith('/v1/rpc/') && req.method === 'POST') {
          const method = url.pathname.slice('/v1/rpc/'.length);
          const fn = Object.prototype.hasOwnProperty.call(RPC, method) ? RPC[method] : undefined;
          const text = await req.text();
          const raw = (text ? JSON.parse(text) : {}) as Json;
          const args = raw && typeof raw === 'object' ? raw : {};
          if (!fn) {
            const r = agentRpc(agent, o, method, args);
            if (!r.found) return fail(req, 404, `The core has no method called ${method}.`);
            return json(req, { result: r.value ?? null });
          }
          return json(req, { result: (await fn(o.db, args)) ?? null });
        }
        return fail(req, 404, 'Not found.');
      } catch (e) {
        const msg = e instanceof SyntaxError ? 'The request body is not valid JSON.' : (e as Error).message || String(e);
        log(`${req.method} ${url.pathname}: ${msg}`);
        return fail(req, e instanceof SyntaxError ? 400 : 500, msg);
      }
    },
    websocket: {
      open(ws) { sockets.add(ws); ws.send(JSON.stringify({ type: 'hello', version: VERSION })); },
      close(ws) { sockets.delete(ws); },
      message() { /* clients only listen */ },
    },
  });
  return Object.assign(server, { agent });
}
