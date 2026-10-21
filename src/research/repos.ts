// Connectors for free, keyless academic APIs. Only abstracts and metadata are read.

import { http, timeoutSignal } from '../lib/http';
import { RepoId, Source, Credibility } from './types';

export interface SearchOpts {
  limit: number;
  yearFrom?: number | null;
  language?: string;
  signal?: AbortSignal;
}

export interface SearchResult {
  repo: RepoId;
  status: number;   // 0 = network failure
  ms: number;
  sources: Source[];
  error?: string;
}

export const REPO_INFO: Record<RepoId, { name: string; blurb: string; host: string }> = {
  arxiv: { name: 'arXiv', blurb: 'Preprints in physics, maths, computer science and more', host: 'export.arxiv.org' },
  pubmed: { name: 'PubMed', blurb: 'Biomedical and life-science literature (NCBI)', host: 'eutils.ncbi.nlm.nih.gov' },
  openalex: { name: 'OpenAlex', blurb: 'Open catalogue of scholarly works across all fields', host: 'api.openalex.org' },
  crossref: { name: 'Crossref', blurb: 'DOI registry: journal articles and conference papers', host: 'api.crossref.org' },
};

// ── Credibility ─────────────────────────────────────────────────────────────

const HIGH = [/\.gov(\.|\/|$)/, /\.edu(\.|\/|$)/, /\.ac\.[a-z]{2}(\/|$)/, /nih\.gov/, /nature\.com/, /science\.org/, /thelancet\.com/, /nejm\.org/, /cell\.com/, /ieee\.org/, /acm\.org/, /springer\.com/, /sciencedirect\.com/, /wiley\.com/, /bmj\.com/, /plos\.org/];

export function domainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export function rateDomain(domain: string, repo: RepoId): Credibility {
  if (/arxiv\.org|biorxiv\.org|medrxiv\.org|ssrn\.com|researchgate/.test(domain)) return 'preprint';
  if (HIGH.some((re) => re.test(domain)) || repo === 'pubmed') return 'high';
  if (/doi\.org|openalex\.org|crossref\.org|semanticscholar\.org|jstor\.org|tandfonline\.com|sagepub\.com|mdpi\.com|frontiersin\.org/.test(domain)) return 'medium';
  return 'unknown';
}

// ── Tiny XML helpers (no DOMParser, so this also runs in tests) ─────────────

const decode = (s: string) =>
  s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const first = (xml: string, tag: string) => {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? decode(m[1]) : '';
};
const all = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]);
const year = (s?: string | number | null) => { const m = /(19|20)\d{2}/.exec(String(s ?? '')); return m ? Number(m[0]) : undefined; };

/** `landing` is the publisher's page when known: doi.org links say nothing about who published the paper. */
function make(p: Omit<Source, 'id' | 'domain' | 'credibility'>, landing?: string): Source {
  const domain = domainOf(landing || p.url);
  return { ...p, id: `${p.repo}:${p.doi || p.url}`, domain, credibility: rateDomain(domain, p.repo) };
}

// ── arXiv ───────────────────────────────────────────────────────────────────

export function parseArxiv(xml: string): Source[] {
  return all(xml, 'entry').map((e) => {
    const url = first(e, 'id');
    const doi = first(e, 'arxiv:doi') || undefined;
    return make({
      repo: 'arxiv', title: first(e, 'title'), authors: all(e, 'author').map((a) => first(a, 'name')),
      year: year(first(e, 'published')), url, doi, abstract: first(e, 'summary'),
    });
  }).filter((s) => s.title && s.url);
}

// ── PubMed (esearch → efetch) ───────────────────────────────────────────────

export function parsePubmed(xml: string): Source[] {
  return all(xml, 'PubmedArticle').map((a) => {
    const pmid = first(a, 'PMID');
    const doi = [...a.matchAll(/<ArticleId IdType="doi">([^<]+)</g)].map((m) => m[1])[0];
    const abstract = all(a, 'AbstractText').map((t) => decode(t)).join(' ');
    const authors = all(a, 'Author').map((x) => `${first(x, 'ForeName')} ${first(x, 'LastName')}`.trim()).filter(Boolean);
    return make({
      repo: 'pubmed', title: first(a, 'ArticleTitle'), authors, year: year(first(a, 'PubDate')),
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`, doi, abstract,
    });
  }).filter((s) => s.title && s.abstract);
}

// ── OpenAlex ────────────────────────────────────────────────────────────────

function openAlexAbstract(idx?: Record<string, number[]>): string {
  if (!idx) return '';
  const words: string[] = [];
  for (const [w, pos] of Object.entries(idx)) pos.forEach((p) => (words[p] = w));
  return words.filter(Boolean).join(' ');
}

export function parseOpenAlex(json: any): Source[] {
  return (json?.results ?? []).map((w: any) => {
    const doi = w.doi ? String(w.doi).replace('https://doi.org/', '') : undefined;
    const url = w.doi || w.primary_location?.landing_page_url || w.id;
    return make({
      repo: 'openalex', title: w.title ?? w.display_name ?? '', authors: (w.authorships ?? []).map((a: any) => a.author?.display_name).filter(Boolean),
      year: w.publication_year, url, doi, abstract: openAlexAbstract(w.abstract_inverted_index),
    }, w.primary_location?.landing_page_url);
  }).filter((s: Source) => s.title && s.url);
}

// ── Crossref ────────────────────────────────────────────────────────────────

export function parseCrossref(json: any): Source[] {
  return (json?.message?.items ?? []).map((i: any) => {
    const doi = i.DOI as string | undefined;
    return make({
      repo: 'crossref', title: (i.title?.[0] ?? '').toString(), authors: (i.author ?? []).map((a: any) => `${a.given ?? ''} ${a.family ?? ''}`.trim()),
      year: i.issued?.['date-parts']?.[0]?.[0], url: i.URL || (doi ? `https://doi.org/${doi}` : ''), doi, abstract: decode(i.abstract ?? ''),
    }, i.resource?.primary?.URL);
  }).filter((s: Source) => s.title && s.url);
}

// ── Search dispatch ─────────────────────────────────────────────────────────

// Be a good API citizen: arXiv asks for at most one request per 3 s, NCBI allows ~3/s without a key.
// All agents share these queues, so parallel agents cannot burst past the limits.
const MIN_GAP_MS: Record<string, number> = { 'export.arxiv.org': 3100, 'eutils.ncbi.nlm.nih.gov': 400, 'api.openalex.org': 120, 'api.crossref.org': 120 };
export const rateLimit = { enabled: true };
const nextFree = new Map<string, number>();

async function throttle(host: string, signal?: AbortSignal): Promise<void> {
  if (!rateLimit.enabled) return;
  const slot = Math.max(Date.now(), nextFree.get(host) ?? 0);
  nextFree.set(host, slot + (MIN_GAP_MS[host] ?? 0));
  const wait = slot - Date.now();
  if (wait <= 0) return;
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, wait);
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

async function get(url: string, signal?: AbortSignal): Promise<{ res: Response | null; ms: number }> {
  await throttle(new URL(url).host, signal);
  const t0 = performance.now();
  try {
    const res = await http(url, { signal: timeoutSignal(25_000, signal), headers: { Accept: '*/*' } });
    return { res, ms: Math.round(performance.now() - t0) };
  } catch {
    return { res: null, ms: Math.round(performance.now() - t0) };
  }
}

export async function searchRepo(repo: RepoId, query: string, o: SearchOpts): Promise<SearchResult> {
  const q = encodeURIComponent(query);
  let ms = 0, status = 0;
  try {
    if (repo === 'arxiv') {
      const { res, ms: m } = await get(`https://export.arxiv.org/api/query?search_query=all:${q}&start=0&max_results=${o.limit}&sortBy=relevance`, o.signal);
      ms = m; if (!res) return { repo, status: 0, ms, sources: [], error: 'Network error' };
      status = res.status; if (!res.ok) return { repo, status, ms, sources: [], error: `HTTP ${status}` };
      return { repo, status, ms, sources: parseArxiv(await res.text()) };
    }
    if (repo === 'pubmed') {
      const lang = o.language ? `+AND+${encodeURIComponent(o.language)}[la]` : '';
      const date = o.yearFrom ? `&mindate=${o.yearFrom}&maxdate=3000&datetype=pdat` : '';
      const s = await get(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=${o.limit}&term=${q}${lang}${date}`, o.signal);
      ms = s.ms; if (!s.res) return { repo, status: 0, ms, sources: [], error: 'Network error' };
      status = s.res.status; if (!s.res.ok) return { repo, status, ms, sources: [], error: `HTTP ${status}` };
      const ids: string[] = (await s.res.json())?.esearchresult?.idlist ?? [];
      if (!ids.length) return { repo, status, ms, sources: [] };
      const f = await get(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&retmode=xml&id=${ids.join(',')}`, o.signal);
      ms += f.ms; if (!f.res || !f.res.ok) return { repo, status: f.res?.status ?? 0, ms, sources: [], error: 'Could not fetch abstracts' };
      return { repo, status: f.res.status, ms, sources: parsePubmed(await f.res.text()) };
    }
    if (repo === 'openalex') {
      const filters = [o.yearFrom ? `from_publication_date:${o.yearFrom}-01-01` : '', o.language ? `language:${o.language}` : '', 'has_abstract:true'].filter(Boolean).join(',');
      const { res, ms: m } = await get(`https://api.openalex.org/works?search=${q}&per-page=${o.limit}&filter=${filters}`, o.signal);
      ms = m; if (!res) return { repo, status: 0, ms, sources: [], error: 'Network error' };
      status = res.status; if (!res.ok) return { repo, status, ms, sources: [], error: `HTTP ${status}` };
      return { repo, status, ms, sources: parseOpenAlex(await res.json()) };
    }
    const filter = o.yearFrom ? `&filter=from-pub-date:${o.yearFrom}` : '';
    const { res, ms: m } = await get(`https://api.crossref.org/works?query=${q}&rows=${o.limit}${filter}&select=DOI,title,author,issued,URL,abstract,resource`, o.signal);
    ms = m; if (!res) return { repo, status: 0, ms, sources: [], error: 'Network error' };
    status = res.status; if (!res.ok) return { repo, status, ms, sources: [], error: `HTTP ${status}` };
    return { repo, status, ms, sources: parseCrossref(await res.json()) };
  } catch (e) {
    return { repo, status, ms, sources: [], error: (e as Error).message };
  }
}
