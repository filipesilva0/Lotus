// web.search / web.read: only offered when the chat's Web button is on (local-first: nothing goes to
// the internet unless the user turned it on). Same search and page reader as Chat's Web mode.

import type { Tool, ToolCtx } from '../agent/types';
import { readPageWith, searchWebWith, type WebIO } from '../../../src/chat/webCore';

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
    const results = await searchWebWith(io(ctx), String(a.query), { ...p, limit: 6, signal: ctx.signal });
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
