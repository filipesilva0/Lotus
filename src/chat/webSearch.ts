// Web search for chat (the globe button). Off by default; only runs when the user turns it on.
// Providers:
//   duckduckgo — DuckDuckGo's no-JavaScript results page (no account or key needed)
//   searxng    — a SearXNG instance the user runs (e.g. on this computer), via its JSON API
// The top results are then opened and their readable text is passed to the model with citations.

import { http, timeoutSignal } from '../lib/http';
import { readPageWith, searchWebWith, type SearchOpts, type WebIO, type WebPage, type WebResult } from './webCore';

export { ddgTarget, decodeEntities, parseDuckDuckGo, readableText, type SearchOpts, type WebPage, type WebResult } from './webCore';

const io: WebIO = { fetch: (url, init) => http(url, init), timeout: (ms, outer) => timeoutSignal(ms, outer) };
export const searchWeb = (query: string, o: SearchOpts): Promise<WebResult[]> => searchWebWith(io, query, o);
export const readPage = (url: string, signal?: AbortSignal): Promise<WebPage> => readPageWith(io, url, signal);

/** A search query from a chat message: drops filler, keeps the question's words. */
export function queryFromMessage(text: string): string {
  let t = text.replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim();
  const lead = /^(hey|hi|hello|please|can you|could you|would you|tell me|search( the web)?( for)?|look up|find( out)?)\b[\s,:]*/i;
  for (let i = 0; i < 5 && lead.test(t); i++) t = t.replace(lead, '');
  return t.slice(0, 200);
}

/** The block of text given to the model: numbered sources it may cite as [n]. */
export function webContextBlock(results: WebResult[], pages: WebPage[], budgetChars: number): string {
  const per = Math.max(600, Math.floor(budgetChars / Math.max(1, results.length)));
  return results.map((r, i) => {
    const p = pages.find((x) => x.url === r.url && x.text);
    const body = p ? p.text.slice(0, per) : r.snippet;
    return `[${i + 1}] ${r.title}\n${r.url}\n${body}`;
  }).join('\n\n');
}
