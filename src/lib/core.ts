// Connection to lotusd, Lotus's background core (see core/ and src-tauri/src/lotusd.rs).
// The core owns lotus.db (settings, chats, tasks, memory, skills) and the image/audio files in the
// Lotus Studio folder. Windows reach it over HTTP on 127.0.0.1 with a per-run token from `core_info`.
//
// In a plain browser (vite dev, tests, screenshots) there is no core: `coreReady()` resolves null and
// callers fall back to browser storage, as before session 14.

// Not imported from ./http: http → engineConfig → store → core would be an import cycle.
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface CoreInfo { port: number; token: string; version: string; pid: number }
export type CoreEvent =
  | { type: 'kv'; set: Record<string, string>; remove: string[]; origin: string }
  | { type: 'hello'; version: string }
  /** Agent run events (lib/agent.ts) and "memory changed" (memory/store.ts). */
  | { type: 'agent'; runId: string; kind: string }
  | { type: 'memory' }
  /** Built-in engines (session 17): download jobs and the chat server; image progress. */
  | { type: 'builtin'; jobs: unknown[]; chat: unknown }
  | { type: 'builtin-image'; genId: string; step: number; total: number }
  /** Lotus Pro status changed (0.18.0: licence key, trial). */
  | { type: 'pro'; status: unknown }
  /** MCP tool servers started, stopped or failed (Settings → Advanced). */
  | { type: 'mcp' };

let info: CoreInfo | null = null;
let lastError: string | null = null;
let pending: Promise<CoreInfo | null> | null = null;
const listeners = new Set<(e: CoreEvent) => void>();
const statusSubs = new Set<() => void>();
let socket: { close: () => void } | null = null;
let socketRetry: ReturnType<typeof setTimeout> | null = null;

/**
 * HTTP to the core. In the desktop app it goes through Tauri's HTTP client (Rust), not the web view:
 * WebView2 can refuse a page's requests to 127.0.0.1 (Chromium's local-network rules), which left the
 * installed 0.7.0 on Windows without its core (session 16). A browser (tests, vite) uses fetch.
 */
let nativeFetch: typeof fetch | null = null;
async function httpCore(url: string, init: RequestInit = {}): Promise<Response> {
  if (!isTauri) return fetch(url, init);
  nativeFetch ??= (await import('@tauri-apps/plugin-http')).fetch as unknown as typeof fetch;
  return nativeFetch(url, init);
}

/** Shown in the "core isn't running" notice when the core started but this window can't reach it. */
export function setCoreError(msg: string) { lastError = msg; notify(); }

/** Lets tests and screenshot scripts point the web layer at a real core without Tauri. */
declare global { interface Window { __LOTUS_CORE__?: CoreInfo } }

let snapshot: { info: CoreInfo | null; error: string | null } = { info: null, error: null };
const notify = () => { snapshot = { info, error: lastError }; statusSubs.forEach((f) => f()); };

async function askNative(): Promise<CoreInfo | null> {
  if (typeof window !== 'undefined' && window.__LOTUS_CORE__) return window.__LOTUS_CORE__;
  if (!isTauri) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const got = await invoke<CoreInfo>('core_info');
    lastError = null;
    return got;
  } catch (e) {
    lastError = typeof e === 'string' ? e : (e as Error)?.message ?? 'The Lotus core is not running.';
    return null;
  }
}

/** The running core, or null when there is none (browser mode, or it failed to start). */
export function coreReady(): Promise<CoreInfo | null> {
  if (info) return Promise.resolve(info);
  pending ??= askNative().then((i) => {
    info = i;
    pending = null;
    if (i) openSocket();
    notify();
    return i;
  });
  return pending;
}

/** Forgets the cached core address so the next `coreReady()` asks the app again (after a restart). */
export function forgetCore() { if (!pending) info = null; }

/** Asks the desktop app to restart the core (the notice's Restart button). */
export async function restartCore(): Promise<void> {
  if (!isTauri) return;
  const { invoke } = await import('@tauri-apps/api/core');
  lastError = 'Restarting…'; notify();
  await invoke('core_restart');
}

/** Synchronous view for render code (a stable object between changes, for useSyncExternalStore). */
export const coreState = () => snapshot;
export function subscribeCore(fn: () => void): () => void { statusSubs.add(fn); return () => { statusSubs.delete(fn); }; }

// The app restarts the core if it stops; follow it to its new port.
if (isTauri && typeof window !== 'undefined') {
  void import('@tauri-apps/api/event').then(({ listen }) => {
    void listen<CoreInfo>('core:ready', (e) => {
      const changed = !info || info.port !== e.payload.port;
      info = e.payload; lastError = null;
      if (changed) { socket?.close(); openSocket(); }
      notify();
    });
    void listen<string>('core:down', (e) => { lastError = e.payload; notify(); });
  }).catch(() => undefined);
}

const base = () => (info ? `http://127.0.0.1:${info.port}` : '');

export class CoreError extends Error {}

/** fetch against the core with the token. Retries once after asking the app for the current port. */
export async function coreFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const i = await coreReady();
  if (!i) throw new CoreError(lastError ?? 'The Lotus core is not running.');
  const go = () => httpCore(`${base()}${path}`, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${info!.token}` } });
  let res: Response;
  try {
    res = await go();
  } catch {
    info = null;
    if (!(await coreReady())) throw new CoreError(lastError ?? 'Lost the connection to the Lotus core.');
    res = await go();
  }
  if (!res.ok) {
    let msg = `The Lotus core answered ${res.status}.`;
    try { msg = ((await res.json()) as { error?: string }).error ?? msg; } catch { /* not JSON */ }
    throw new CoreError(msg);
  }
  return res;
}

export async function coreJson<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await coreFetch(path, body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return (await res.json()) as T;
}

/** Calls a core method (POST /v1/rpc/<method>). */
export async function rpc<T = unknown>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await coreJson<{ result: T }>(`/v1/rpc/${method}`, 'POST', args)).result;
}

// ── media files ─────────────────────────────────────────────────────────────

export interface SavedMedia { path: string; kind: 'image' | 'audio'; mime: string; bytes: number; created: number }

/** Saves an image or audio blob into the Lotus Studio folder; returns its relative path. */
/**
 * Saves an image or recording in Lotus Studio. `dir`: a folder under Images/ (from `rpc('media_folder')`);
 * `numbered`: name it "<name> N" ("Output 3"); `reuse`: return an identical numbered file instead of a copy.
 */
export async function saveMedia(blob: Blob, name: string, o: { dir?: string; numbered?: boolean; reuse?: boolean } = {}): Promise<SavedMedia> {
  const q = new URLSearchParams({ name });
  if (o.dir) q.set('dir', o.dir);
  if (o.numbered) q.set('numbered', '1');
  if (o.reuse) q.set('reuse', '1');
  const res = await coreFetch(`/v1/media?${q}`, { method: 'POST', headers: { 'content-type': blob.type || 'application/octet-stream' }, body: blob });
  return (await res.json()) as SavedMedia;
}

export async function loadMedia(path: string): Promise<Blob> {
  return (await coreFetch(`/v1/media/${path.split('/').map(encodeURIComponent).join('/')}`)).blob();
}

export async function deleteMedia(path: string): Promise<void> {
  await coreFetch(`/v1/media/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE' });
}

// ── events ──────────────────────────────────────────────────────────────────

export function onCoreEvent(fn: (e: CoreEvent) => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }

function openSocket() {
  if (!info) return;
  if (socketRetry) { clearTimeout(socketRetry); socketRetry = null; }
  const port = info.port;
  const retry = () => { socketRetry = setTimeout(() => { if (info?.port === port) openSocket(); }, 1500); };
  const deliver = (raw: string) => {
    try { const e = JSON.parse(raw) as { type: string }; if (e.type !== 'ping') listeners.forEach((f) => f(e as CoreEvent)); } catch { /* ignore */ }
  };

  if (isTauri) {
    // Desktop app: one streamed HTTP response (/v1/stream) read through Tauri's HTTP client.
    const ctrl = new AbortController();
    const me = { close: () => ctrl.abort() };
    socket = me;
    void (async () => {
      try {
        const res = await httpCore(`http://127.0.0.1:${port}/v1/stream`, { headers: { authorization: `Bearer ${info!.token}` }, signal: ctrl.signal });
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); if (line) deliver(line); }
        }
      } catch { /* closed or failed: retry below */ }
      if (socket !== me || ctrl.signal.aborted) return;
      socket = null;
      retry();
    })();
    return;
  }

  if (typeof WebSocket === 'undefined') return;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/events?t=${encodeURIComponent(info.token)}`);
  socket = ws;
  ws.onmessage = (m) => deliver(String(m.data));
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    // Reconnect while the core is the same; a restart arrives as core:ready instead.
    retry();
  };
}
