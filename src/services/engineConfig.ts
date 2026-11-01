export type EngineId = 'ollama' | 'comfyui' | 'voicebox';

export const DEFAULT_URLS: Record<EngineId, string> = {
  ollama: 'http://127.0.0.1:11434',
  comfyui: 'http://127.0.0.1:8188',
  voicebox: 'http://127.0.0.1:17493',
};

export const ENGINE_IDS: EngineId[] = ['ollama', 'comfyui', 'voicebox'];

const KEY = 'lotus.engineUrls.v1';
/** Optional access keys for engines on another computer (session 11). Never sent anywhere else. */
const AUTH_KEY = 'lotus.engineAuth.v1';

function readMap(key: string): Partial<Record<EngineId, string>> {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}');
  } catch {
    return {};
  }
}

export function engineUrl(id: EngineId): string {
  return (readMap(KEY)[id] || DEFAULT_URLS[id]).replace(/\/+$/, '');
}

/**
 * Tidies what the user typed: adds http:// when no scheme is given and the engine's usual port when
 * none is given on a plain http address ("192.168.1.20" → "http://192.168.1.20:11434").
 * Returns null when it still is not a usable http(s) address.
 */
export function normalizeEngineUrl(id: EngineId, raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_URLS[id];
  const hadScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  let s = trimmed.replace(/\/+$/, '');
  if (hadScheme && !/^[a-z][a-z0-9+.-]*:\/\/./i.test(s)) return null;
  if (!hadScheme) s = `http://${s}`;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname) return null;
  if (!hadScheme && !u.port) u.port = new URL(DEFAULT_URLS[id]).port;
  const path = u.pathname.replace(/\/+$/, '');
  return `${u.protocol}//${u.host}${path}`;
}

export function setEngineUrl(id: EngineId, url: string) {
  const next = { ...readMap(KEY), [id]: normalizeEngineUrl(id, url) ?? DEFAULT_URLS[id] };
  localStorage.setItem(KEY, JSON.stringify(next));
}

export function allEngineUrls(): Record<EngineId, string> {
  return { ollama: engineUrl('ollama'), comfyui: engineUrl('comfyui'), voicebox: engineUrl('voicebox') };
}

/** True for this computer's own addresses (127.x, localhost, ::1, 0.0.0.0). */
export function isLoopbackHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '0.0.0.0' || /^127(\.\d{1,3}){3}$/.test(h);
}

/** The engine runs on another computer: Lotus can use it but cannot start, stop or install it. */
export function isRemote(id: EngineId): boolean {
  try { return !isLoopbackHost(new URL(engineUrl(id)).hostname); } catch { return false; }
}

export function engineToken(id: EngineId): string {
  return readMap(AUTH_KEY)[id] || '';
}

export function setEngineToken(id: EngineId, token: string) {
  const map = readMap(AUTH_KEY);
  const t = token.trim();
  if (t) map[id] = t; else delete map[id];
  localStorage.setItem(AUTH_KEY, JSON.stringify(map));
}

/** Which engine (if any) a request URL belongs to: its address must be a prefix of the URL. */
export function engineForUrl(url: string): EngineId | null {
  for (const id of ENGINE_IDS) {
    const base = engineUrl(id);
    if (url === base || url.startsWith(`${base}/`) || url.startsWith(`${base}?`)) return id;
  }
  return null;
}

/**
 * The Authorization header for a request to an engine, when the user gave it an access key.
 * A key containing ":" is sent as Basic auth (user:password, what most reverse proxies ask for);
 * anything else as a Bearer token. Keys only ever go to the engine they were entered for.
 */
export function authHeaderFor(url: string): string | null {
  const id = engineForUrl(url);
  return id ? authHeaderFromToken(engineToken(id)) : null;
}

export function authHeaderFromToken(token: string): string | null {
  const t = token.trim();
  if (!t) return null;
  if (/^(basic|bearer) /i.test(t)) return t;
  if (t.includes(':')) return `Basic ${btoa(unescape(encodeURIComponent(t)))}`;
  return `Bearer ${t}`;
}

/** How to make each engine listen for other computers (shown when a remote one can't be reached). */
export const LISTEN_HINT: Record<EngineId, string> = {
  ollama: 'On that computer, set OLLAMA_HOST=0.0.0.0 and restart Ollama, so it listens on the network.',
  comfyui: 'On that computer, start ComfyUI with --listen 0.0.0.0 (ComfyUI Desktop: set the host to 0.0.0.0 in its Server-Config settings), so it listens on the network.',
  voicebox: 'On that computer, start the Voicebox server with --host 0.0.0.0, so it listens on the network.',
};
