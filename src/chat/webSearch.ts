// Web search for chat (the globe button). Off by default; only runs when the user turns it on.
// Providers:
//   duckduckgo — DuckDuckGo's no-JavaScript results page (no account or key needed)
//   searxng    — a SearXNG instance the user runs (e.g. on this computer), via its JSON API
// The top results are then opened and their readable text is passed to the model with citations.

import { http, timeoutSignal } from '../lib/http';

export interface WebResult { title: string; url: string; snippet: string }
export interface WebPage { url: string; title: string; text: string; error?: string }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 Lotus/0.1';

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

export interface SearchOpts { provider: 'duckduckgo' | 'searxng'; searxngUrl: string; limit?: number; signal?: AbortSignal }

export async function searchWeb(query: string, o: SearchOpts): Promise<WebResult[]> {
  const q = query.trim().slice(0, 300);
  if (!q) return [];
  const signal = timeoutSignal(15_000, o.signal);
  if (o.provider === 'searxng') {
    const base = o.searxngUrl.replace(/\/+$/, '');
    let res: Response;
    try { res = await http(`${base}/search?q=${encodeURIComponent(q)}&format=json&safesearch=1`, { signal }); }
    catch (e) { throw new Error(`Can't reach SearXNG at ${base}. Start it or switch the search provider in Settings → Chat. (${(e as Error).message})`); }
    if (res.status === 403) throw new Error('SearXNG refused the JSON request. Add "json" under search.formats in its settings.yml, then restart it.');
    if (!res.ok) throw new Error(`SearXNG answered ${res.status}.`);
    const j = await res.json();
    return (j.results ?? []).slice(0, o.limit ?? 8).map((r: { title?: string; url: string; content?: string }) => ({ title: r.title ?? r.url, url: r.url, snippet: r.content ?? '' }));
  }
  let res: Response;
  try {
    res = await http('https://html.duckduckgo.com/html/', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Accept: 'text/html' },
      body: `q=${encodeURIComponent(q)}&kl=wt-wt`,
    });
  } catch (e) { throw new Error(`Web search could not reach DuckDuckGo. Check the internet connection. (${(e as Error).message})`); }
  if (!res.ok) throw new Error(`DuckDuckGo answered ${res.status}. Try again in a minute, or use SearXNG in Settings → Chat.`);
  const results = parseDuckDuckGo(await res.text(), o.limit ?? 8);
  if (!results.length) throw new Error('DuckDuckGo returned no readable results (it may be asking for a captcha). Try again later, or use SearXNG in Settings → Chat.');
  return results;
}

export async function readPage(url: string, signal?: AbortSignal): Promise<WebPage> {
  try {
    const res = await http(url, { signal: timeoutSignal(10_000, signal), headers: { 'User-Agent': UA, Accept: 'text/html,text/plain;q=0.9' } });
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
