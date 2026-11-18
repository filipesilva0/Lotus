// web.search / web.read: only offered when the chat's Web button is on (local-first: nothing goes to
// the internet unless the user turned it on). Same search and page reader as Chat's Web mode.

import type { Tool, ToolCtx } from '../agent/types';
import { DuckDuckGoBlocked, readPageWith, searchWebWith, type WebIO, type WebResult } from '../../../src/chat/webCore';

// DuckDuckGo answers a burst of searches with a captcha (0.14.5: Work's agents searched at once and all
// but the first failed). So searches through it go one at a time with a gap, the same query within
// 10 minutes reuses its results, and after a captcha Lotus waits before the next try.
export const DDG_GAP_MS = { value: 1500 };
export const DDG_COOLDOWN_MS = { value: 20_000 };
const CACHE_MS = 10 * 60_000;
let ddgQueue: Promise<unknown> = Promise.resolve();
let ddgNext = 0;
const cache = new Map<string, { at: number; results: WebResult[] }>();
const inFlight = new Map<string, Promise<WebResult[]>>();
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((done, fail) => {
  if (ms <= 0) { done(); return; }
  const t = setTimeout(done, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); fail(new DOMException('Stopped', 'AbortError')); }, { once: true });
});

/** Runs DuckDuckGo searches one after another, spaced out; one retry after a cooldown if it is refused. */
export function throttledSearch(key: string, run: () => Promise<WebResult[]>, signal?: AbortSignal): Promise<WebResult[]> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit.results);
  const going = inFlight.get(key);
  if (going) return going; // two agents asking the same thing at once share one search
  const job = ddgQueue.catch(() => undefined).then(async () => {
    for (let attempt = 0; ; attempt++) {
      await sleep(ddgNext - Date.now(), signal);
      try {
        const results = await run();
        ddgNext = Date.now() + DDG_GAP_MS.value;
        cache.set(key, { at: Date.now(), results });
        if (cache.size > 200) cache.delete(cache.keys().next().value!);
        return results;
      } catch (e) {
        if (!(e instanceof DuckDuckGoBlocked)) { ddgNext = Date.now() + DDG_GAP_MS.value; throw e; }
        ddgNext = Date.now() + DDG_COOLDOWN_MS.value;
        if (attempt >= 1) throw e;
      }
    }
  });
  ddgQueue = job;
  inFlight.set(key, job);
  void job.finally(() => inFlight.delete(key)).catch(() => undefined);
  return job;
}

export const __resetWebThrottle = () => { cache.clear(); inFlight.clear(); ddgNext = 0; ddgQueue = Promise.resolve(); };

const io = (ctx: ToolCtx): WebIO => ({
  fetch: (url, init) => ctx.fetch(url, init),
  timeout: (ms, outer) => AbortSignal.any([AbortSignal.timeout(ms), ctx.signal, ...(outer ? [outer] : [])]),
});

function provider(ctx: ToolCtx): { provider: 'duckduckgo' | 'searxng'; searxngUrl: string } {
  try {
    const s = JSON.parse(ctx.kvGet('lotus.settings.v1') || '{}') as { webSearchProvider?: string; searxngUrl?: string };
    return { provider: s.webSearchProvider === 'searxng' ? 'searxng' : 'duckduckgo', searxngUrl: s.searxngUrl || 'http://127.0.0.1:8888' };
  } catch { return { provider: 'duckduckgo', searxngUrl: 'http://127.0.0.1:8888' }; }
}

export const webSearch: Tool = {
  name: 'web.search', label: 'Searching the web', risk: 'read', // only offered when the user turned Web on for the chat
  description: 'Search the web for current information. Returns titles, links and snippets; use web.read to open a page.',
  parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search words.' } }, required: ['query'] },
  describe: (a) => `Search the web for “${String(a.query)}”`,
  async run(a, ctx) {
    const p = provider(ctx);
    const q = String(a.query);
    const results = p.provider === 'duckduckgo'
      ? await throttledSearch(q.trim().toLowerCase().replace(/\s+/g, ' '), () => searchWebWith(io(ctx), q, { ...p, limit: 6, signal: ctx.signal }), ctx.signal)
      : await searchWebWith(io(ctx), q, { ...p, limit: 6, signal: ctx.signal });
    return {
      ok: true,
      text: results.length ? results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join('\n\n') : 'No results.',
      summary: `${results.length} results · ${p.provider === 'searxng' ? 'SearXNG' : 'DuckDuckGo'}`,
      data: { results: results.map((r) => ({ title: r.title, url: r.url })) },
    };
  },
};

export const webRead: Tool = {
  name: 'web.read', label: 'Reading a web page', risk: 'read',
  description: 'Open a web page and read its text.',
  parameters: { type: 'object', properties: { url: { type: 'string', description: 'The page address (http or https).' } }, required: ['url'] },
  describe: (a) => `Open ${String(a.url)}`,
  async run(a, ctx) {
    const url = String(a.url).trim();
    if (!/^https?:\/\//i.test(url)) return { ok: false, text: 'Only http and https addresses can be opened.', summary: 'Not a web address' };
    const page = await readPageWith(io(ctx), url, ctx.signal);
    if (page.error) return { ok: false, text: `Could not read ${url}: ${page.error}`, summary: page.error };
    return { ok: true, text: `${page.title}\n${url}\n\n${page.text}`, summary: `${page.title || url.replace(/^https?:\/\//, '').slice(0, 60)} · ${page.text.length.toLocaleString('en')} characters`, data: { url, title: page.title } };
  },
};

export const WEB_TOOLS = [webSearch, webRead];
