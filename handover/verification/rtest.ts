import { runResearch, RunControl, RunApi, cleanCitations, rejectReason } from '../../src/research/engine';
import { parseArxiv, parsePubmed, parseOpenAlex, rateDomain, rateLimit, searchRepo } from '../../src/research/repos';
import { parseJson, proposePlan } from '../../src/research/llm';
import { DEFAULT_LIMITS, Project } from '../../src/research/types';
import { setEngineUrl } from '../../src/services/engineConfig';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
setEngineUrl('ollama', 'http://127.0.0.1:18998');

rateLimit.enabled = false;
let fails = 0; const ok = (n: string, c: boolean, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`); if (!c) fails++; };

// ---------- fake academic APIs by patching fetch ----------
const ARXIV = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
<entry><id>http://arxiv.org/abs/2301.00001v1</id><published>2023-01-02T00:00:00Z</published><title>Sparse   Transformers
 for Long Context</title><summary>We study sparse attention for long documents and show a 3x speedup on benchmarks with minimal accuracy loss across several tasks.</summary><author><name>Ada Lovelace</name></author><author><name>Alan Turing</name></author><arxiv:doi>10.1000/shared.1</arxiv:doi></entry>
<entry><id>http://arxiv.org/abs/1801.00002v1</id><published>2018-01-02T00:00:00Z</published><title>Old Paper From 2018</title><summary>An older study about recurrent networks that predates the cutoff year but has a perfectly adequate abstract length for reading.</summary><author><name>Grace Hopper</name></author></entry></feed>`;
const PUBMED = `<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID Version="1">111</PMID><DateCompleted><Year>2020</Year></DateCompleted><Article><Journal><JournalIssue><PubDate><Year>2022</Year><Month>Mar</Month></PubDate></JournalIssue></Journal><ArticleTitle>Clinical &amp; trial outcomes of <i>X</i></ArticleTitle><Abstract><AbstractText Label="BACKGROUND">Patients were randomised in a multicentre trial.</AbstractText><AbstractText Label="RESULTS">Outcome improved by 12% (p&lt;0.05) versus placebo in the treated group overall.</AbstractText></Abstract><AuthorList><Author><LastName>Curie</LastName><ForeName>Marie</ForeName></Author></AuthorList></Article></MedlineCitation><PubmedData><ArticleIdList><ArticleId IdType="pubmed">111</ArticleId><ArticleId IdType="doi">10.1000/shared.1</ArticleId></ArticleIdList></PubmedData></PubmedArticle></PubmedArticleSet>`;
const OPENALEX = { results: [
  { id: 'https://openalex.org/W1', doi: 'https://doi.org/10.1000/oa.2', title: 'Open Access Evidence Review', publication_year: 2021, authorships: [{ author: { display_name: 'Rosalind Franklin' } }], abstract_inverted_index: { This: [0], review: [1], covers: [2], evidence: [3], from: [4], many: [5], randomised: [6], studies: [7], and: [8], summarises: [9], pooled: [10], effects: [11], across: [12], populations: [13], in: [14], detail: [15] } },
  { id: 'https://openalex.org/W2', doi: 'https://doi.org/10.1000/spam.3', title: 'Spammy Result', publication_year: 2024, authorships: [], primary_location: { landing_page_url: 'https://spam.example.com/x' }, abstract_inverted_index: { Buy: [0], cheap: [1], pills: [2], now: [3], with: [4], free: [5], shipping: [6], on: [7], all: [8], orders: [9], today: [10], only: [11], limited: [12], time: [13], offer: [14], here: [15], ok: [16] } },
] };
const calls: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input); const u = new URL(url);
  const json = (o: any) => new Response(JSON.stringify(o), { status: 200 });
  if (u.host === 'export.arxiv.org') { calls.push('arxiv'); return new Response(ARXIV, { status: 200 }); }
  if (u.host === 'eutils.ncbi.nlm.nih.gov') { calls.push('pubmed'); return u.pathname.includes('esearch') ? json({ esearchresult: { idlist: ['111'] } }) : new Response(PUBMED, { status: 200 }); }
  if (u.host === 'api.openalex.org') { calls.push('openalex'); return json(OPENALEX); }
  if (u.host === 'api.crossref.org') { calls.push('crossref'); return new Response('nope', { status: 503 }); }
  return realFetch(input, init);
}) as any;

// ---------- parsers ----------
{
  const a = parseArxiv(ARXIV); ok('arxiv: parses entries, collapses whitespace, doi & authors', a.length === 2 && a[0].title === 'Sparse Transformers for Long Context' && a[0].doi === '10.1000/shared.1' && a[0].authors.length === 2 && a[0].year === 2023, JSON.stringify(a[0]).slice(0, 90));
  const p = parsePubmed(PUBMED); ok('pubmed: title entities/tags decoded, structured abstract joined, PubDate year, doi', p.length === 1 && p[0].title === 'Clinical & trial outcomes of X' && p[0].abstract.includes('12% (p<0.05)') && p[0].year === 2022 && p[0].doi === '10.1000/shared.1' && p[0].credibility === 'high');
  const o = parseOpenAlex(OPENALEX); ok('openalex: inverted-index abstract rebuilt in order', o[0].abstract.startsWith('This review covers evidence from many') && o[0].doi === '10.1000/oa.2');
  ok('credibility tiers', rateDomain('nih.gov', 'openalex') === 'high' && rateDomain('arxiv.org', 'arxiv') === 'preprint' && rateDomain('doi.org', 'crossref') === 'medium' && rateDomain('blog.example.com', 'openalex') === 'unknown');
  ok('json: tolerant of fences and chatter', (parseJson('Sure!\n```json\n{"a":{"b":"}"},"c":[1]}\n```') as any)?.a.b === '}');
  ok('citations: invalid refs stripped, valid kept', cleanCitations('A [1] B [99] C [2, 50] D [3-4]', 4) === 'A [1] B  C [2] D [3-4]', cleanCitations('A [1] B [99] C [2, 50] D [3-4]', 4));
}

// ---------- fake Ollama ----------
import http from 'node:http';
let chatCalls = 0; let queryCalls = 0;
const llm = http.createServer(async (req, res) => {
  let b = ''; for await (const c of req) b += c; const body = JSON.parse(b || '{}');
  const sys = body.messages?.[0]?.content ?? ''; const user = body.messages?.[1]?.content ?? '';
  chatCalls++;
  if (body.stream === false) {
    let out: any = {};
    if (/research librarian/.test(sys)) out = { questions: [{ question: 'Which years?', why: 'scope' }, { question: 'Which populations?' }, { question: 'Which outcomes?' }] };
    else if (/plan research/.test(sys)) out = { title: 'Test Review', subtopics: [{ title: 'Efficiency', objective: 'How fast', questions: ['q1'] }, { title: 'Clinical', objective: 'Outcomes', questions: ['q2'] }] };
    else if (/assemble a panel/.test(sys)) out = { personas: [{ name: 'Skeptic', role: 'Reviewer', focus: 'bias' }] };
    else if (/search queries/.test(sys)) { queryCalls++; out = /Iteration: 1/.test(user) ? { queries: ['sparse attention long context', 'trial outcomes placebo'], done: false } : { queries: [], done: true }; }
    else if (/paper abstracts/.test(sys)) { const n = (user.match(/^\[\d+\]/gm) || []).length; out = { items: Array.from({ length: n }, (_, i) => ({ n: i + 1, finding: `Finding about item ${i + 1}`, relevance: 4 })) }; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ message: { content: JSON.stringify(out) }, prompt_eval_count: 100, eval_count: 20 }));
  }
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
  for (const t of ['# Test Review\n\nSparse attention gives speedups [1]. ', 'Trials show improvement [2][99]. ', 'Overall evidence is limited [3].']) res.write(JSON.stringify({ message: { content: t } }) + '\n');
  res.end(JSON.stringify({ done: true, eval_count: 30, eval_duration: 1e9 }) + '\n');
});
await new Promise<void>((r) => llm.listen(18998, r));

const mk = (over: Partial<Project> = {}): Project => ({
  id: 'p', title: 'T', question: 'Do sparse transformers help?', tags: [], createdAt: 0, updatedAt: 0, phase: 'planning', model: 'm', clarifications: [], personas: [],
  plan: [{ id: 't1', title: 'Efficiency', objective: 'How fast', questions: ['q1'] }, { id: 't2', title: 'Clinical', objective: 'Outcomes', questions: ['q2'] }],
  limits: { ...DEFAULT_LIMITS, yearCutoff: 2019, repos: { arxiv: true, pubmed: true, openalex: true, crossref: true }, excludedDomains: ['spam.example.com'], maxDepth: 3 },
  agents: [], sources: [], queries: [], injected: [], report: '', tokensIn: 0, tokensOut: 0, supervisorCtx: 0, numCtx: 8192, paused: false, progress: 0, ...over });
const harness = (p: Project) => { let cur = p; const api: RunApi = { get: () => cur, patch: (fn) => { cur = fn(cur); } }; return { api, get: () => cur }; };

// ---------- full run ----------
{
  const h = harness(mk()); await runResearch(h.api, new RunControl()); const p = h.get();
  ok('run: finishes with phase=done, progress=1', p.phase === 'done' && p.progress === 1 && !p.error, `${p.phase} ${p.error ?? ''}`);
  ok('run: both agents finished', p.agents.length === 2 && p.agents.every((a) => a.status === 'done'));
  const titles = p.sources.map((s) => s.title);
  ok('dedupe: same DOI from arXiv/PubMed kept once', p.sources.filter((s) => s.doi === '10.1000/shared.1').length === 1, titles.join(' | '));
  ok('filters: year cutoff drops 2018 paper', !titles.some((t) => /Old Paper/.test(t)));
  ok('filters: excluded domain dropped', !titles.some((t) => /Spammy/.test(t)));
  ok('queries logged with HTTP status (incl. failing Crossref 503)', p.queries.some((q) => q.repo === 'crossref' && q.status === 503) && p.queries.some((q) => q.repo === 'arxiv' && q.status === 200));
  ok('done=true on round 2 stops the agent early (depth 3 not exhausted)', queryCalls <= 4, `queryCalls=${queryCalls}`);
  ok('findings extracted & stored on sources', p.sources.every((s) => s.finding?.startsWith('Finding about item')));
  ok('tokens counted from Ollama usage', p.tokensIn > 0 && p.tokensOut > 0 && p.agents.every((a) => a.tokensIn > 0 && a.ctxPeak === 100));
  ok('report: bogus citation [99] removed, valid kept', p.report.includes('[1]') && p.report.includes('[2]') && !p.report.includes('[99]'));
  ok('report: auto reference list lists only real sources', /## References/.test(p.report) && p.report.includes('https://doi.org/10.1000/shared.1') && !p.report.includes('spam.example'));
}
// ---------- rejected source is excluded from report ----------
{
  const h = harness(mk()); const ctl = new RunControl();
  const orig = h.api.patch; let rejected = false;
  h.api.patch = (fn) => { orig(fn); const c = h.get(); if (!rejected && c.phase === 'synthesizing') { rejected = true; orig((q) => ({ ...q, sources: q.sources.map((s) => (s.repo === 'openalex' ? { ...s, rejected: true } : s)) })); } };
  await runResearch(h.api, ctl);
  ok('steering: user-rejected sources are left out of references', h.get().phase === 'done' && !h.get().report.includes('Open Access Evidence Review'));
}
// ---------- pause / resume / stop ----------
{
  const h = harness(mk()); const ctl = new RunControl(); ctl.pause();
  const run = runResearch(h.api, ctl);
  await new Promise((r) => setTimeout(r, 400));
  ok('pause: nothing progresses while paused', h.get().sources.length === 0 && h.get().phase === 'running');
  ctl.resume(); await run;
  ok('resume: run completes after pause', h.get().phase === 'done');
  const h2 = harness(mk()); const c2 = new RunControl(); c2.pause(); const r2 = runResearch(h2.api, c2); await new Promise((r) => setTimeout(r, 60)); c2.stop(); await r2;
  ok('stop: ends in phase=stopped without an error message', h2.get().phase === 'stopped' && !h2.get().error, `phase=${h2.get().phase} err=${h2.get().error}`);
}
// ---------- fallback when the model returns junk ----------
{
  llm.close(); const bad = http.createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'application/json' }); s.end(JSON.stringify({ message: { content: 'sorry, I cannot do that' } })); });
  await new Promise<void>((r) => bad.listen(18997, r)); setEngineUrl('ollama', 'http://127.0.0.1:18997');
  const plan = await proposePlan({ model: 'm', numCtx: 4096, onUsage: () => {} }, 'my topic', []);
  ok('fallback: junk model output still yields a usable 1-topic plan', plan.plan.length === 1 && plan.plan[0].questions[0] === 'my topic');
  bad.close(); setEngineUrl('ollama', 'http://127.0.0.1:1');
  const h = harness(mk()); await runResearch(h.api, new RunControl());
  ok('unreachable Ollama: stops with a recovery message', h.get().phase === 'stopped' && /Can't reach Ollama/.test(h.get().error ?? ''), h.get().error);
}
// ---------- rate limiter ----------
{
  rateLimit.enabled = true;
  const t0 = Date.now();
  await Promise.all([searchRepo('arxiv', 'a', { limit: 1 }), searchRepo('arxiv', 'b', { limit: 1 }), searchRepo('openalex', 'c', { limit: 1 })]);
  const el = Date.now() - t0;
  ok('rate limit: two simultaneous arXiv calls are spaced >= 3 s apart (shared by all agents)', el >= 3000 && el < 4500, `${el}ms`);
  const t1 = Date.now(); await searchRepo('openalex', 'd', { limit: 1 }); ok('rate limit: other hosts are not held up by arXiv', Date.now() - t1 < 1000);
  rateLimit.enabled = false;
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
