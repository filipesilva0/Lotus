// web.search / web.read: only offered when the chat's Web button is on (local-first: nothing goes to
// the internet unless the user turned it on). Same search and page reader as Chat's Web mode.

import type { Tool, ToolCtx } from '../agent/types';
import { EngineHealth, ENGINE_LABEL, metaSearch, providerOf, readPageWith, SearchBlocked, searchWebWith, type EngineId, type WebIO, type WebResult } from '../../../src/chat/webCore';
import { kvGet } from '../kv';
import { stripMarkdown } from '../../../src/chat/webQuery';
import type { Db } from '../db';

// Every web search in Lotus goes through here (the agent's web.search, and Chat's Web button, tasks and
// routines through the core's web_search method), so one place spaces them out and remembers results.
// Free search engines answer bursts of searches with a captcha (0.14.5: Work's agents searched at once
// and all but the first failed; 0.15.0: about a third of chat searches failed). So:
//   - searches go one at a time with a short gap, and the same query within 10 minutes reuses its results;
//   - Lotus Search asks the next engine when one refuses, and rests the refused one (webCore.ts);
//   - if every engine refused, one more try after a pause (unless they are all resting now);
//   - 0.20.0: while every engine rests, searches fail at once with when Lotus will try again.
export const SEARCH_GAP_MS = { value: 1000 };
export const RETRY_AFTER_MS = { value: 8000 };
/** @deprecated names from 0.14.5, kept for tests and callers. */
export const DDG_GAP_MS = SEARCH_GAP_MS;
export const DDG_COOLDOWN_MS = RETRY_AFTER_MS;
const CACHE_MS = 10 * 60_000;
export const health = new EngineHealth();
let queue: Promise<unknown> = Promise.resolve();
let next = 0;
const cache = new Map<string, { at: number; results: WebResult[]; engine: EngineId | null }>();
const inFlight = new Map<string, Promise<Found>>();
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((done, fail) => {
  if (ms <= 0) { done(); return; }
  const t = setTimeout(done, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); fail(new DOMException('Stopped', 'AbortError')); }, { once: true });
});

export interface Found { results: WebResult[]; engine: EngineId | null }
const keyOf = (q: string) => q.trim().toLowerCase().replace(/\s+/g, ' ');

/** Runs searches one after another, spaced out; one more try after a pause if every engine refused. */
export function throttledSearch(key: string, run: () => Promise<Found>, signal?: AbortSignal): Promise<Found> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return Promise.resolve({ results: hit.results, engine: hit.engine });
  const going = inFlight.get(key);
  if (going) return going; // two agents asking the same thing at once share one search
  const job = queue.catch(() => undefined).then(async () => {
    let first: unknown = null;
    for (let attempt = 0; ; attempt++) {
      await sleep(next - Date.now(), signal);
      try {
        const found = await run();
        next = Date.now() + SEARCH_GAP_MS.value;
        if (found.results.length) {
          cache.set(key, { at: Date.now(), ...found });
          if (cache.size > 200) cache.delete(cache.keys().next().value!);
        }
        return found;
      } catch (e) {
        if (!(e instanceof SearchBlocked)) { next = Date.now() + SEARCH_GAP_MS.value; throw e; }
        // Every engine resting: nothing was asked, so no retry. A retry that finds them resting reports
        // the first try's error, which says what each engine answered.
        if (e.resting) { next = Date.now() + SEARCH_GAP_MS.value; throw first ?? e; }
        next = Date.now() + RETRY_AFTER_MS.value * (attempt + 1);
        if (attempt >= 1) throw e;
        first = e;
      }
    }
  });
  queue = job;
  inFlight.set(key, job);
  void job.finally(() => inFlight.delete(key)).catch(() => undefined);
  return job;
}

export const __resetWebThrottle = () => { cache.clear(); inFlight.clear(); next = 0; queue = Promise.resolve(); health.clear(); };

function settingsOf(get: (k: string) => string | null): { provider: 'auto' | 'searxng'; searxngUrl: string } {
  try {
    const s = JSON.parse(get('lotus.settings.v1') || '{}') as { webSearchProvider?: string; searxngUrl?: string };
    return { provider: providerOf(s.webSearchProvider), searxngUrl: s.searxngUrl || 'http://127.0.0.1:8888' };
  } catch { return { provider: 'auto', searxngUrl: 'http://127.0.0.1:8888' }; }
}

/** One search with the user's provider: Lotus Search (throttled, several engines) or their SearXNG. */
export async function findOnWeb(io: WebIO, get: (k: string) => string | null, query: string, limit: number, signal?: AbortSignal): Promise<Found & { provider: string }> {
  const p = settingsOf(get);
  if (p.provider === 'searxng') return { results: await searchWebWith(io, query, { ...p, limit, signal }), engine: null, provider: 'SearXNG' };
  const found = await throttledSearch(`${limit}:${keyOf(query)}`, async () => {
    const r = await metaSearch(io, query, { limit, signal, health });
    return { results: r.results, engine: r.engine };
  }, signal);
  return { ...found, provider: found.engine ? ENGINE_LABEL[found.engine] : 'Lotus Search' };
}

const io = (ctx: ToolCtx): WebIO => ({
  fetch: (url, init) => ctx.fetch(url, init),
  timeout: (ms, outer) => AbortSignal.any([AbortSignal.timeout(ms), ctx.signal, ...(outer ? [outer] : [])]),
});

/** The core's web_search method: Chat's Web button, tasks and routines search through the same queue. */
export async function webSearchRpc(db: Db, query: string, limit: number, fetchFn: typeof fetch = fetch): Promise<{ results: WebResult[]; provider: string }> {
  const plain: WebIO = { fetch: (url, init) => fetchFn(url, init), timeout: (ms, outer) => (outer ? AbortSignal.any([AbortSignal.timeout(ms), outer]) : AbortSignal.timeout(ms)) };
  const r = await findOnWeb(plain, (k) => kvGet(db, k), query, Math.max(1, Math.min(10, limit || 6)));
  return { results: r.results, provider: r.provider };
}

export const webSearch: Tool = {
  name: 'web.search', label: 'Searching the web', risk: 'read', // only offered when the user turned Web on for the chat
  description: 'Search the web for current information. Returns titles, links and snippets; use web.read to open a page. Only search when the answer needs facts you are not sure of or that may have changed; not for greetings, opinions, writing or maths.',
  parameters: { type: 'object', properties: { query: { type: 'string', description: 'A complete search query that makes sense on its own: name the subject from earlier in the conversation (write "RTX 4060 yellow edition price", not "the yellow one").' } }, required: ['query'] },
  describe: (a) => `Search the web for “${String(a.query)}”`,
  async run(a, ctx) {
    const q = stripMarkdown(String(a.query)) || String(a.query);
    const { results, provider } = await findOnWeb(io(ctx), ctx.kvGet, q, 6, ctx.signal);
    return {
      ok: true,
      text: results.length ? results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join('\n\n') : 'No results.',
      summary: results.length ? `${results.length} result${results.length === 1 ? '' : 's'} · ${provider}` : `No results · ${provider}`,
      // 0.20.0: an empty search is shown as "nothing found", not with a green check.
      data: { results: results.map((r) => ({ title: r.title, url: r.url })), ...(results.length ? {} : { empty: true }) },
    };
  },
};

export const webRead: Tool = {
  name: 'web.read', label: 'Reading a web page', risk: 'read',
  description: 'Open a web page and read its text. Also opens JSON and CSV data feeds (APIs).',
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
