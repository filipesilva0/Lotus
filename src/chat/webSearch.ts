// Web search for chat (the globe button). Off by default; only runs when the user turns it on.
// Providers:
//   auto    — Lotus Search: DuckDuckGo, Bing, DuckDuckGo Lite and Wikipedia, asked in turn when one refuses
//             (no account, key or extra program needed; chat/webCore.ts)
//   searxng — a SearXNG instance the user runs (e.g. on this computer), via its JSON API
// In the desktop app the search runs in the core, so Chat, tasks, routines and the agent share one queue,
// one cache and one record of which engines are resting. The browser preview searches by itself.
// The top results are then opened and their readable text is passed to the model with citations.

import { http, timeoutSignal } from '../lib/http';
import { rpc } from '../lib/core';
import { storeMode } from '../lib/store';
import { ENGINE_LABEL, metaSearch, providerOf, readPageWith, searchWebWith, EngineHealth, type SearchOpts, type WebIO, type WebPage, type WebResult } from './webCore';

export { queryFromMessage } from './webQuery';
export { ddgTarget, decodeEntities, parseDuckDuckGo, readableText, type SearchOpts, type WebPage, type WebResult } from './webCore';

const io: WebIO = { fetch: (url, init) => http(url, init), timeout: (ms, outer) => timeoutSignal(ms, outer) };
const health = new EngineHealth();

/** Waits for `p`, or rejects as soon as `signal` aborts (an RPC to the core can't be cancelled). */
const orAbort = <T,>(p: Promise<T>, signal?: AbortSignal): Promise<T> => !signal ? p : new Promise<T>((ok, fail) => {
  if (signal.aborted) { fail(new DOMException('Stopped', 'AbortError')); return; }
  const onAbort = () => fail(new DOMException('Stopped', 'AbortError'));
  signal.addEventListener('abort', onAbort, { once: true });
  p.then(ok, fail).finally(() => signal.removeEventListener('abort', onAbort));
});

/** Searches with the user's provider. `provider` names what answered ("DuckDuckGo", "Bing", "SearXNG"…). */
export async function searchWebFull(query: string, o: SearchOpts): Promise<{ results: WebResult[]; provider: string }> {
  const provider = providerOf(o.provider);
  if (storeMode() === 'core') {
    try {
      return await orAbort(rpc<{ results: WebResult[]; provider: string }>('web_search', { query, limit: o.limit ?? 6 }), o.signal);
    } catch (e) {
      // An older core without web_search answers "no method"; anything else is the search's own error.
      if (!/no method called web_search/i.test((e as Error).message)) throw e;
    }
  }
  if (provider === 'searxng') return { results: await searchWebWith(io, query, { ...o, provider }), provider: 'SearXNG' };
  const r = await metaSearch(io, query, { limit: o.limit, signal: o.signal, health });
  return { results: r.results, provider: r.engine ? ENGINE_LABEL[r.engine] : 'Lotus Search' };
}

export const searchWeb = async (query: string, o: SearchOpts): Promise<WebResult[]> => (await searchWebFull(query, o)).results;
export const readPage = (url: string, signal?: AbortSignal): Promise<WebPage> => readPageWith(io, url, signal);

/** The block of text given to the model: numbered sources it may cite as [n]. */
export function webContextBlock(results: WebResult[], pages: WebPage[], budgetChars: number): string {
  const per = Math.max(600, Math.floor(budgetChars / Math.max(1, results.length)));
  return results.map((r, i) => {
    const p = pages.find((x) => x.url === r.url && x.text);
    const body = p ? p.text.slice(0, per) : r.snippet;
    return `[${i + 1}] ${r.title}\n${r.url}\n${body}`;
  }).join('\n\n');
}
