// Web search and page reading (pure apart from the injected fetch). Used by Chat's Web mode
// (chat/webSearch.ts, through Tauri's http()) and by the core's web.search / web.read tools.


export interface WebResult { title: string; url: string; snippet: string }
export interface WebPage { url: string; title: string; text: string; error?: string }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

/** Real target of a DuckDuckGo redirect link (`//duckduckgo.com/l/?uddg=<encoded>&rut=…`). */
export function ddgTarget(href: string): string | null {
  const h = decodeEntities(href);
  const m = /[?&]uddg=([^&]+)/.exec(h);
  const url = m ? decodeURIComponent(m[1]) : h.startsWith('//') ? `https:${h}` : h;
  if (!/^https?:\/\//i.test(url)) return null;
  if (/duckduckgo\.com\/y\.js|[?&]ad_domain=/i.test(url)) return null; // ads
  return url;
}

/** Parses DuckDuckGo's HTML results page. */
export function parseDuckDuckGo(html: string, limit = 8): WebResult[] {
  const out: WebResult[] = [];
  const blocks = html.split(/<div[^>]+class="[^"]*\bresult\b[^"]*"/i).slice(1);
  for (const b of blocks) {
    if (/result--ad\b/i.test(b.slice(0, 200))) continue;
    const a = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(b) ?? /<a[^>]+href="([^"]+)"[^>]+class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(b);
    if (!a) continue;
    const url = ddgTarget(a[1]);
    if (!url || out.some((r) => r.url === url)) continue;
    const sn = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/i.exec(b);
    out.push({ title: stripTags(a[2]), url, snippet: sn ? stripTags(sn[1]) : '' });
    if (out.length >= limit) break;
  }
  return out;
}

/** Parses DuckDuckGo's "lite" results page (a plain table; used when the normal page is refused). */
export function parseDuckDuckGoLite(html: string, limit = 8): WebResult[] {
  const out: WebResult[] = [];
  const links = [...html.matchAll(/<a\b([^>]*\bclass=['"]result-link['"][^>]*)>([\s\S]*?)<\/a>/gi)];
  const snippets = [...html.matchAll(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]));
  links.forEach((m, i) => {
    const href = /\bhref=['"]([^'"]+)['"]/i.exec(m[1])?.[1];
    const url = href ? ddgTarget(href) : null;
    if (!url || out.length >= limit || out.some((r) => r.url === url)) return;
    out.push({ title: stripTags(m[2]), url, snippet: snippets[i] ?? '' });
  });
  return out;
}

/** Readable text of an HTML page: drops scripts, styles, navigation and markup; prefers <article>/<main>. */
export function readableText(html: string, max = 6000): { title: string; text: string } {
  const title = stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '');
  let body = html.replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|canvas|form|select|button)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(head|nav|footer|aside|header)\b[\s\S]*?<\/\1>/gi, ' ');
  const main = /<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(body);
  if (main && main[2].replace(/<[^>]+>/g, '').trim().length > 400) body = main[2];
  const text = decodeEntities(body
    .replace(/<\/(p|div|section|h[1-6]|li|tr|br|pre|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .split('\n').map((l) => l.trim()).filter((l) => l.length > 1).join('\n');
  return { title, text: text.length > max ? `${text.slice(0, max)}…` : text };
}

// ── Lotus Search: several search engines, one after another ─────────────────────────────────────
// No single free engine can be relied on: DuckDuckGo answers bursts of searches from one computer with a
// captcha (about a third of searches failed in 0.15.0). So Lotus asks one engine and, when it is refused,
// the next, and rests a refused engine for a while (2 minutes, doubling up to 30) so it can recover. No
// account, key or extra program is needed; SearXNG (a search engine the user runs) stays an option.

/** An engine refused the search: captcha, "too many requests", or a page with no readable results. */
export class SearchBlocked extends Error {
  constructor(message: string, readonly engine?: string) { super(message); }
}
/** Kept for older callers: DuckDuckGo's refusal is a SearchBlocked. */
export const DuckDuckGoBlocked = SearchBlocked;

export type EngineId = 'duckduckgo' | 'bing' | 'ddglite' | 'wikipedia';
export const ENGINE_LABEL: Record<EngineId, string> = { duckduckgo: 'DuckDuckGo', bing: 'Bing', ddglite: 'DuckDuckGo Lite', wikipedia: 'Wikipedia' };
/** The order engines are asked in. Wikipedia last: it only knows encyclopedia topics, but never refuses. */
export const ENGINE_ORDER: EngineId[] = ['duckduckgo', 'bing', 'ddglite', 'wikipedia'];

/** Words on a refusal page (DuckDuckGo, Bing, Cloudflare-style checks). */
const BLOCK_RE = /bots use DuckDuckGo|anomaly-modal|challenge-form|complete the following challenge|captcha|unusual traffic|are you a (?:human|robot)|verify you are human|too many requests|rate.?limit/i;
export const looksBlocked = (status: number, html: string) => status === 202 || status === 403 || status === 429 || status === 503 || BLOCK_RE.test(html.slice(0, 200_000));

/** Real target of a Bing link: direct, or `bing.com/ck/a?…&u=a1<base64url>…`. */
export function bingTarget(href: string): string | null {
  const h = decodeEntities(href);
  const m = /[?&]u=a1([^&]+)/.exec(h);
  let url = h;
  if (m) {
    try {
      const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
      url = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    } catch { return null; }
  }
  if (!/^https?:\/\//i.test(url) || /^https?:\/\/(?:www\.)?bing\.com\//i.test(url)) return null;
  return url;
}

/** Parses Bing's results page (`<li class="b_algo">` blocks). */
export function parseBing(html: string, limit = 8): WebResult[] {
  const out: WebResult[] = [];
  for (const b of html.split(/<li[^>]+class="[^"]*\bb_algo\b[^"]*"/i).slice(1)) {
    const block = b.split(/<\/li>\s*<li[^>]+class="/i)[0];
    const a = /<h2[^>]*>\s*<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!a) continue;
    const url = bingTarget(a[1]);
    if (!url || out.some((r) => r.url === url)) continue;
    const sn = /<p\b[^>]*class="[^"]*\b(?:b_lineclamp\d*|b_paractl|b_algoSlug)\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(block)
      ?? /<div[^>]+class="[^"]*\bb_caption\b[^"]*"[^>]*>[\s\S]*?<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(block);
    const snippet = sn ? stripTags(sn[1].replace(/<a\b[^>]*b_algoReadMore[\s\S]*?<\/a>/gi, '')).replace(/^[^·]{0,40}·\s*/, '') : '';
    out.push({ title: stripTags(a[2]), url, snippet });
    if (out.length >= limit) break;
  }
  return out;
}

/** Parses Wikipedia's search API (JSON). */
export function parseWikipedia(json: unknown, limit = 8): WebResult[] {
  const hits = ((json as { query?: { search?: { title: string; snippet?: string }[] } })?.query?.search ?? []);
  return hits.slice(0, limit).map((h) => ({ title: h.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, '_'))}`, snippet: stripTags(h.snippet ?? '') }));
}

export interface SearchOpts { provider: 'auto' | 'duckduckgo' | 'searxng'; searxngUrl: string; limit?: number; signal?: AbortSignal; health?: EngineHealth }

/** Fetch and timeout come from the caller: Tauri's http() in the app, plain fetch in the core. */
export interface WebIO { fetch: (url: string, init?: RequestInit) => Promise<Response>; timeout: (ms: number, outer?: AbortSignal) => AbortSignal }

/** Can't reach the engine at all (no internet, DNS, timeout): not the engine's fault, so no rest. */
class Unreachable extends Error {}

const FORM = () => ({ 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' });

async function fetchText(io: WebIO, url: string, init: RequestInit, signal: AbortSignal): Promise<{ status: number; text: string }> {
  let res: Response;
  try { res = await io.fetch(url, { ...init, signal }); }
  catch (e) { if (signal.aborted && (e as Error).name === 'AbortError') throw e; throw new Unreachable((e as Error).message); }
  return { status: res.status, text: await res.text().catch(() => '') };
}

/** One engine, once. Throws SearchBlocked when refused, Unreachable when it can't be reached. */
export async function searchEngine(io: WebIO, engine: EngineId, q: string, limit: number, outer?: AbortSignal): Promise<WebResult[]> {
  const signal = io.timeout(12_000, outer);
  const label = ENGINE_LABEL[engine];
  let r: { status: number; text: string };
  let results: WebResult[];
  switch (engine) {
    case 'duckduckgo':
      r = await fetchText(io, 'https://html.duckduckgo.com/html/', { method: 'POST', headers: FORM(), body: `q=${encodeURIComponent(q)}&kl=wt-wt` }, signal);
      results = r.status === 200 ? parseDuckDuckGo(r.text, limit) : [];
      break;
    case 'ddglite':
      r = await fetchText(io, 'https://lite.duckduckgo.com/lite/', { method: 'POST', headers: FORM(), body: `q=${encodeURIComponent(q)}&kl=wt-wt` }, signal);
      results = r.status === 200 ? parseDuckDuckGoLite(r.text, limit) : [];
      break;
    case 'bing':
      r = await fetchText(io, `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=en&count=10`, { headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' } }, signal);
      results = r.status === 200 ? parseBing(r.text, limit) : [];
      break;
    case 'wikipedia': {
      r = await fetchText(io, `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=${limit}&srsearch=${encodeURIComponent(q)}`, { headers: { 'User-Agent': 'Lotus/0.1 (local desktop assistant)', Accept: 'application/json' } }, signal);
      let j: unknown = null;
      try { j = JSON.parse(r.text); } catch { /* not JSON */ }
      results = r.status === 200 ? parseWikipedia(j, limit) : [];
      if (r.status === 200 && j) return results; // an empty answer is a real "nothing found"
      break;
    }
  }
  if (results.length) return results;
  if (looksBlocked(r.status, r.text)) throw new SearchBlocked(`${label} refused the search (${r.status === 200 ? 'it asked for a captcha' : `answer ${r.status}`}).`, engine);
  if (r.status !== 200) throw new SearchBlocked(`${label} answered ${r.status}.`, engine);
  // A normal page with nothing on it: a real "no results", or a layout Lotus can't read any more.
  // Either way the next engine is worth asking, but this one needs no rest.
  return [];
}

/** Which engines were refused recently, and until when they rest. One per process (the core). */
export class EngineHealth {
  private rest = new Map<EngineId, { until: number; strikes: number }>();
  constructor(readonly baseMs = 2 * 60_000, readonly maxMs = 30 * 60_000) {}
  blocked(e: EngineId, now = Date.now()) {
    const strikes = (this.rest.get(e)?.strikes ?? 0) + 1;
    this.rest.set(e, { until: now + Math.min(this.maxMs, this.baseMs * 2 ** (strikes - 1)), strikes });
  }
  ok(e: EngineId) { this.rest.delete(e); }
  resting(e: EngineId, now = Date.now()) { const r = this.rest.get(e); return !!r && r.until > now; }
  /** Engines to ask, in order: rested ones first; if every one is resting, the one that recovers soonest. */
  order(list: EngineId[] = ENGINE_ORDER, now = Date.now()): EngineId[] {
    const ready = list.filter((e) => !this.resting(e, now));
    if (ready.length) return ready;
    return [...list].sort((a, b) => (this.rest.get(a)!.until - this.rest.get(b)!.until)).slice(0, 1);
  }
  clear() { this.rest.clear(); }
}

const STOP = new Set(('a an and are as at be by can do does for from has have how i in is it its me my of on or our than that the their there these this to was what when where which who whom why will with you your ' +
  'about after before best current currently latest new news now recent today tonight tomorrow yesterday week weekend year please tell find show give ' +
  'o os a as um uma de do da dos das e em no na nos nas para por com que qual quais quando onde como hoje amanhã ontem').split(' '));

/** The words of a query that a page about it should mention (no filler words, no bare numbers). */
export function queryTerms(query: string): string[] {
  const words = query.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words.filter((w) => !STOP.has(w) && !/^\d+$/.test(w) && (w.length > 1 || /\d/.test(w))))];
}

/** How many of the query's words a result mentions in its title, snippet or address (plurals count). */
export function matchCount(terms: string[], r: WebResult): number {
  const hay = `${r.title} ${r.snippet} ${r.url}`.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  return terms.filter((t) => hay.includes(t) || (t.length > 4 && hay.includes(t.replace(/(?:es|s)$/, '')))).length;
}

/**
 * Drops results that have nothing to do with the query, and puts the closest first. The 0.16.0 test:
 * when DuckDuckGo asked for a captcha, Bing often answered with unrelated pages (it ignores queries it
 * finds odd and shows popular pages instead). A result must mention at least one query word, or a third
 * of them for longer queries.
 */
export function relevantResults(query: string, results: WebResult[]): WebResult[] {
  const terms = queryTerms(query);
  if (!terms.length) return results;
  const need = Math.max(1, Math.ceil(terms.length / 3));
  return results
    .map((r, i) => ({ r, i, n: matchCount(terms, r) }))
    .filter((x) => x.n >= need)
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((x) => x.r);
}

export interface MetaResult { results: WebResult[]; engine: EngineId | null; tried: { engine: EngineId; error?: string; unreachable?: boolean; count: number; dropped?: number }[] }

/**
 * Lotus Search: asks engines in turn until one gives enough results (3, or `limit` if smaller). Results
 * from an engine that gave only a few are kept and topped up from the next one, without duplicates.
 */
export async function metaSearch(io: WebIO, query: string, o: { limit?: number; signal?: AbortSignal; health: EngineHealth; engines?: EngineId[] }): Promise<MetaResult> {
  const q = query.trim().slice(0, 300);
  const limit = o.limit ?? 8;
  const tried: MetaResult['tried'] = [];
  if (!q) return { results: [], engine: null, tried };
  const out: WebResult[] = [];
  let engine: EngineId | null = null;
  for (const e of o.health.order(o.engines ?? ENGINE_ORDER)) {
    if (o.signal?.aborted) throw new DOMException('Stopped', 'AbortError');
    try {
      const raw = await searchEngine(io, e, q, limit, o.signal);
      o.health.ok(e);
      // Bing's off-topic pages are dropped (DuckDuckGo and Wikipedia stay as they rank them).
      const got = e === 'bing' ? relevantResults(q, raw) : raw;
      tried.push({ engine: e, count: got.length, ...(got.length < raw.length ? { dropped: raw.length - got.length } : {}) });
      for (const r of got) if (out.length < limit && !out.some((x) => x.url === r.url)) out.push(r);
      if (got.length && !engine) engine = e;
      if (out.length >= Math.min(3, limit)) break;
    } catch (err) {
      if ((err as Error).name === 'AbortError' && o.signal?.aborted) throw err;
      if (err instanceof SearchBlocked) o.health.blocked(e);
      tried.push({ engine: e, error: (err as Error).message, unreachable: err instanceof Unreachable || undefined, count: 0 });
    }
  }
  if (out.length) return { results: out, engine, tried };
  const errs = tried.filter((t) => t.error);
  if (errs.length && errs.length === tried.length) {
    if (tried.every((t) => t.unreachable)) {
      throw new Error(`Web search couldn't reach any search engine. Check the internet connection. (${errs[0].error})`);
    }
    throw new SearchBlocked(`Every search engine refused the search just now (${errs.map((t) => ENGINE_LABEL[t.engine]).join(', ')}). Lotus will try again shortly; you can also use SearXNG in Settings → Chat.`);
  }
  return { results: [], engine: null, tried };
}

/** For the setting's saved value: DuckDuckGo-only was the old default, so it now means Lotus Search. */
export const providerOf = (v: unknown): 'auto' | 'searxng' => (v === 'searxng' ? 'searxng' : 'auto');

const autoHealth = new EngineHealth();

export async function searchWebWith(io: WebIO, query: string, o: SearchOpts): Promise<WebResult[]> {
  const q = query.trim().slice(0, 300);
  if (!q) return [];
  if (o.provider === 'searxng') {
    const signal = io.timeout(15_000, o.signal);
    const base = o.searxngUrl.replace(/\/+$/, '');
    let res: Response;
    try { res = await io.fetch(`${base}/search?q=${encodeURIComponent(q)}&format=json&safesearch=1`, { signal }); }
    catch (e) { throw new Error(`Can't reach SearXNG at ${base}. Start it or switch the search provider in Settings → Chat. (${(e as Error).message})`); }
    if (res.status === 403) throw new Error('SearXNG refused the JSON request. Add "json" under search.formats in its settings.yml, then restart it.');
    if (!res.ok) throw new Error(`SearXNG answered ${res.status}.`);
    const j = (await res.json()) as { results?: { title?: string; url: string; content?: string }[] };
    return (j.results ?? []).slice(0, o.limit ?? 8).map((r: { title?: string; url: string; content?: string }) => ({ title: r.title ?? r.url, url: r.url, snippet: r.content ?? '' }));
  }
  return (await metaSearch(io, q, { limit: o.limit, signal: o.signal, health: o.health ?? autoHealth })).results;
}

export async function readPageWith(io: WebIO, url: string, signal?: AbortSignal): Promise<WebPage> {
  try {
    const res = await io.fetch(url, { signal: io.timeout(10_000, signal), headers: { 'User-Agent': UA, Accept: 'text/html,text/plain;q=0.9' } });
    if (!res.ok) return { url, title: '', text: '', error: `HTTP ${res.status}` };
    const type = res.headers.get('content-type') ?? '';
    if (!/text\/(html|plain)|xhtml/i.test(type)) return { url, title: '', text: '', error: `Not a web page (${type.split(';')[0] || 'unknown type'})` };
    const raw = (await res.text()).slice(0, 800_000);
    if (/text\/plain/i.test(type)) return { url, title: url, text: raw.slice(0, 6000) };
    return { url, ...readableText(raw) };
  } catch (e) {
    return { url, title: '', text: '', error: (e as Error).name === 'AbortError' ? 'Timed out' : (e as Error).message };
  }
}
