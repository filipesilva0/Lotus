import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

/** True inside the Tauri desktop shell, false in a plain browser (vite dev preview). */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Inside the desktop app requests go through Rust (reqwest), so the local engines
 * never need CORS headers. In a browser it is the normal fetch.
 */
const rawHttp: typeof fetch = (input, init) => {
  if (!isTauri) return fetch(input, init);
  // Windows WebView2 pages live at http://tauri.localhost, which Ollama (OLLAMA_ORIGINS) and ComfyUI
  // reject with 403. Present the request as coming from the engine's own address instead.
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const headers = new Headers(init?.headers);
  if (!headers.has('Origin')) {
    try { headers.set('Origin', new URL(url).origin); } catch { /* not an absolute URL */ }
  }
  return (tauriFetch as unknown as typeof fetch)(input, { ...init, headers });
};

/** Requests Lotus made to the local engines (newest last). Powers the Models → Monitor activity log. */
export interface RequestLogEntry { t: number; method: string; url: string; status: number | 'error'; ms: number }
const LOG_MAX = 300;
const logBuf: RequestLogEntry[] = [];
const logSubs = new Set<() => void>();
export const requestLog = {
  entries: () => logBuf,
  subscribe: (fn: () => void) => { logSubs.add(fn); return () => { logSubs.delete(fn); }; },
};

export const http: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? 'GET').toUpperCase();
  const t0 = performance.now();
  const note = (status: number | 'error') => {
    if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(url) || /\/(api\/ps|system_stats|api\/tags|api\/version|health)\b/.test(url) && status === 200) return;
    logBuf.push({ t: Date.now(), method, url: url.replace(/^https?:\/\//, '').slice(0, 120), status, ms: Math.round(performance.now() - t0) });
    if (logBuf.length > LOG_MAX) logBuf.splice(0, logBuf.length - LOG_MAX);
    logSubs.forEach((f) => f());
  };
  try {
    const res = await rawHttp(input, init);
    note(res.status);
    return res;
  } catch (e) {
    note('error');
    throw e;
  }
};

export function networkErrorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** An engine call that failed, with wording that says what happened and what to do. */
export class EngineError extends Error {
  constructor(
    message: string,
    public readonly engine: string,
    public readonly status?: number,
    public readonly unreachable = false,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

export function timeoutSignal(ms: number, outer?: AbortSignal): AbortSignal {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  ctrl.signal.addEventListener('abort', () => clearTimeout(t), { once: true });
  outer?.addEventListener('abort', () => ctrl.abort(), { once: true });
  return ctrl.signal;
}

/** Pull the most useful message out of a FastAPI / Ollama / ComfyUI error body. */
export async function errorText(res: Response): Promise<string> {
  try {
    const body = await res.text();
    try {
      const j = JSON.parse(body);
      const d = j.detail ?? j.error?.message ?? j.error ?? j.message;
      if (typeof d === 'string') return d;
      if (d) return JSON.stringify(d);
    } catch {
      /* not JSON */
    }
    return body.slice(0, 300) || res.statusText;
  } catch {
    return res.statusText;
  }
}
