// 0.15.1: web search that works and searches the right thing.
//  - Lotus Search: DuckDuckGo, then Bing, DuckDuckGo Lite and Wikipedia when one refuses (about a third
//    of searches failed with DuckDuckGo's captcha in 0.15.0); a refused engine rests for a while.
//  - Every search in the app goes through the core's queue (web_search), one at a time, with a cache.
//  - Before searching, the chat model decides whether the message needs the web and writes a query
//    that stands on its own (a follow-up about "the yellow one" in a chat about GPUs searched bananas).
// The HTML samples are cut from real pages fetched on the user's PC (2026-11-21).

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bingTarget, EngineHealth, looksBlocked, metaSearch, parseBing, parseDuckDuckGo, parseDuckDuckGoLite, parseWikipedia,
  providerOf, SearchBlocked, type WebIO,
} from '../../src/chat/webCore';
import { parsePlan, planSearch, planTurns, rulePlan, type PlanMsg } from '../../src/chat/searchPlan';
import { __resetWebThrottle, health, RETRY_AFTER_MS, SEARCH_GAP_MS, webSearch, webSearchRpc } from '../src/tools/web';
import { openDb } from '../src/db';
import { kvApply } from '../src/kv';

// ── Real page samples ───────────────────────────────────────────────────────────────────────────

const DDG_BLOCK = (url: string, title: string, snippet: string) => `<div class="result results_links results_links_deep web-result ">
  <div class="links_main links_deep result__body"> <!-- This is the visible part -->
      <h2 class="result__title">
        <a rel="nofollow" class="result__a" href="${url}">${title}</a>
      </h2>
      <div class="result__extras"><div class="result__extras__url">
          <span class="result__icon"><a rel="nofollow" href="${url}"><img class="result__icon__img" width="16" height="16" alt="" src="//external-content.duckduckgo.com/ip3/x.ico" name="i15" /></a></span>
          <a class="result__url" href="${url}">${url.replace(/^https:\/\//, '')}</a>
      </div></div>
        <a class="result__snippet" href="${url}">${snippet}</a>
    <div class="clear"></div>
  </div>
</div>`;
const DDG_PAGE = (n: number, tag = 'r') => `<html><body><div id="links" class="results">${Array.from({ length: n }, (_, i) => DDG_BLOCK(`https://www.${tag}${i}.example/page`, `Result ${tag}${i}`, `Snippet <b>${tag}</b> ${i}`)).join('\n')}</div></body></html>`;

const DDG_LITE = `<table><tr>
  <td valign="top">
      1.&nbsp;
  </td>
  <td>
    <a rel="nofollow" href="https://www.techpowerup.com/gpu-specs/geforce-rtx-4060.c4107" class='result-link'>NVIDIA GeForce RTX 4060 Specs | TechPowerUp GPU Database</a>
  </td>
</tr>
    <!-- Only show abstract separately if there's a click URL (not EOF) -->
    <tr>
      <td>&nbsp;&nbsp;&nbsp;</td>
      <td class='result-snippet'>
        The GeForce <b>RTX</b> <b>4060</b> is a performance-segment graphics card with 8 GB GDDR6 memory.
      </td>
    </tr>
  <tr><td>&nbsp;&nbsp;&nbsp;</td><td><span class='link-text'>www.techpowerup.com/gpu-specs/geforce-rtx-4060.c4107</span></td></tr>
<tr><td>&nbsp;</td><td>&nbsp;</td></tr></table>`;

const BING_HREF = 'https://www.bing.com/ck/a?!&amp;&amp;p=3df401fbd3f8c92b9516b1cbe0a3d68dJmltdHM9MTc5NTIxOTIwMA&amp;ptn=3&amp;ver=2&amp;hsh=4&amp;fclid=2fa5732d-ef5a&amp;u=a1aHR0cHM6Ly93d3cubnZpZGlhLmNvbS9lbi11cy9nZWZvcmNlL3J0eC8&amp;ntb=1';
const BING_PAGE = `<ol id="b_results" class=""><li class="b_algo" data-id iid=SERP.5316><link rel="stylesheet" href="https://r.bing.com/rp/x.br.css"/><div class="b_tpcn"><a class="tilk" aria-label="nvidia.com" RedirectUrl="" tabindex="-1" target="_blank" href="${BING_HREF}" h="ID=SERP,5126.1"><div class="tpic"></div><div class="tptxt"><div class="tptt">nvidia.com</div><div class="tpmeta"><div class="b_attribution" tabindex="-1"><cite>https://www.nvidia.com <span class="b_ctdif">&gt; en-us &gt; geforce &gt; rtx</span></cite></div></div></div></a></div><h2><a target="_blank" href="${BING_HREF}" h="ID=SERP,5126.2">GeForce <strong>RTX</strong> | Ultimate Ray Tracing &amp; AI | <strong>NVIDIA</strong></a></h2><div class="b_caption"><p class="b_lineclamp2" data-rslinkclamp-iid="">Upgrade to advanced AI with NVIDIA GeForce RTX™ GPUs and accelerate your gaming. …<a class="b_algoReadMore" target="_blank" href="${BING_HREF}" h="ID=SERP,5126.3">Read more</a></p></div><div elementtiming=frp.MiddleOfPage aria-hidden="true" tabindex="-1"> &nbsp; </div></li><li class="b_algo" data-id iid=SERP.5317><h2><a target="_blank" href="https://www.techpowerup.com/gpu-specs/geforce-rtx-4060.c4107">RTX 4060 Specs</a></h2><div class="b_caption"><p class="b_lineclamp3">Nov 3, 2025 · 8 GB GDDR6 on a 128-bit bus.</p></div></li><li class="b_algo"><h2><a href="https://example.org/three">Third</a></h2><div class="b_caption"><p>Plain caption</p></div></li></ol>`;

const WIKI = { batchcomplete: '', continue: { sroffset: 3 }, query: { searchinfo: { totalhits: 27 }, search: [
  { ns: 0, title: 'GeForce RTX 40 series', pageid: 71802991, snippet: 'The <span class="searchmatch">RTX</span> 40 series…' },
  { ns: 0, title: 'Nvidia RTX', pageid: 1, snippet: 'Nvidia <span class="searchmatch">RTX</span>' },
] } };

const DDG_CAPTCHA = '<html><body><div class="anomaly-modal__title">Unfortunately, bots use DuckDuckGo too.</div> Please complete the following challenge to confirm this search was made by a human.</body></html>';
const MOJEEK_403 = '403 - Forbidden … Sorry your network appears to be sending automated queries so we can\'t process your search at this time.';

// ── A fake internet: answers by engine ──────────────────────────────────────────────────────────

type Engine = 'ddg' | 'lite' | 'bing' | 'wiki';
type Answer = { status?: number; body: string } | 'offline';
function net(answer: (e: Engine, q: string) => Answer) {
  const calls: { engine: Engine; q: string; at: number }[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const engine: Engine = u.host.startsWith('lite.') ? 'lite' : u.host.includes('duckduckgo') ? 'ddg' : u.host.includes('bing') ? 'bing' : 'wiki';
    const q = init?.body ? new URLSearchParams(String(init.body)).get('q') ?? '' : u.searchParams.get('q') ?? u.searchParams.get('srsearch') ?? '';
    calls.push({ engine, q, at: Date.now() });
    const a = answer(engine, q);
    if (a === 'offline') throw new TypeError('error sending request: dns error');
    return new Response(a.body, { status: a.status ?? 200, headers: { 'content-type': engine === 'wiki' ? 'application/json' : 'text/html' } });
  };
  const io: WebIO = { fetch, timeout: (ms, outer) => (outer ? AbortSignal.any([AbortSignal.timeout(ms), outer]) : AbortSignal.timeout(ms)) };
  const ctx = (settings?: object) => ({ fetch, kvGet: (k: string) => (k === 'lotus.settings.v1' && settings ? JSON.stringify(settings) : null), signal: new AbortController().signal }) as never;
  return { calls, io, fetch, ctx };
}
const good = (e: Engine, q = 'q'): Answer => ({ body: e === 'ddg' ? DDG_PAGE(5, `${e}${q}`) : e === 'lite' ? DDG_LITE : e === 'bing' ? BING_PAGE : JSON.stringify(WIKI) });

const dirs: string[] = [];
// Windows keeps an open database file locked, so a leftover temp folder is not an error.
afterAll(() => dirs.forEach((d) => { try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows */ } }));
beforeEach(() => { __resetWebThrottle(); SEARCH_GAP_MS.value = 5; RETRY_AFTER_MS.value = 60; });
afterAll(() => { SEARCH_GAP_MS.value = 1000; RETRY_AFTER_MS.value = 8000; });

// ── Parsers ─────────────────────────────────────────────────────────────────────────────────────

describe('result pages', () => {
  test('DuckDuckGo: direct links, titles and snippets', () => {
    const r = parseDuckDuckGo(DDG_BLOCK('https://www.techpowerup.com/gpu-specs/geforce-rtx-4060.c4107', 'NVIDIA GeForce RTX 4060 Specs | TechPowerUp GPU Database', 'The GeForce <b>RTX</b> <b>4060</b> is a card.'));
    expect(r).toEqual([{ title: 'NVIDIA GeForce RTX 4060 Specs | TechPowerUp GPU Database', url: 'https://www.techpowerup.com/gpu-specs/geforce-rtx-4060.c4107', snippet: 'The GeForce RTX 4060 is a card.' }]);
    expect(parseDuckDuckGo(DDG_PAGE(10), 6)).toHaveLength(6);
  });

  test('DuckDuckGo Lite: single-quoted classes', () => {
    expect(parseDuckDuckGoLite(DDG_LITE)).toEqual([{ title: 'NVIDIA GeForce RTX 4060 Specs | TechPowerUp GPU Database', url: 'https://www.techpowerup.com/gpu-specs/geforce-rtx-4060.c4107', snippet: 'The GeForce RTX 4060 is a performance-segment graphics card with 8 GB GDDR6 memory.' }]);
  });

  test('Bing: redirect links decoded, "Read more" and dates dropped', () => {
    expect(bingTarget(BING_HREF)).toBe('https://www.nvidia.com/en-us/geforce/rtx/');
    expect(bingTarget('https://www.bing.com/images/search?q=x')).toBeNull();
    expect(parseBing(BING_PAGE)).toEqual([
      { title: 'GeForce RTX | Ultimate Ray Tracing & AI | NVIDIA', url: 'https://www.nvidia.com/en-us/geforce/rtx/', snippet: 'Upgrade to advanced AI with NVIDIA GeForce RTX™ GPUs and accelerate your gaming. …' },
      { title: 'RTX 4060 Specs', url: 'https://www.techpowerup.com/gpu-specs/geforce-rtx-4060.c4107', snippet: '8 GB GDDR6 on a 128-bit bus.' },
      { title: 'Third', url: 'https://example.org/three', snippet: 'Plain caption' },
    ]);
  });

  test('Wikipedia: article links from the search API', () => {
    expect(parseWikipedia(WIKI)[0]).toEqual({ title: 'GeForce RTX 40 series', url: 'https://en.wikipedia.org/wiki/GeForce_RTX_40_series', snippet: 'The RTX 40 series…' });
    expect(parseWikipedia(null)).toEqual([]);
  });

  test('refusals are recognised', () => {
    expect(looksBlocked(200, DDG_CAPTCHA)).toBe(true);
    expect(looksBlocked(202, '')).toBe(true); // DuckDuckGo's "anomaly" answer
    expect(looksBlocked(403, MOJEEK_403)).toBe(true);
    expect(looksBlocked(200, '<html><body>No results.</body></html>')).toBe(false);
  });

  test('the old DuckDuckGo setting now means Lotus Search', () => {
    expect(providerOf('duckduckgo')).toBe('auto');
    expect(providerOf(undefined)).toBe('auto');
    expect(providerOf('searxng')).toBe('searxng');
  });
});

// ── Lotus Search ────────────────────────────────────────────────────────────────────────────────

describe('Lotus Search falls back between engines', () => {
  test('DuckDuckGo answers: one request, nothing else asked', async () => {
    const n = net((e) => good(e));
    const r = await metaSearch(n.io, 'rtx 4060', { limit: 6, health: new EngineHealth() });
    expect(r.engine).toBe('duckduckgo');
    expect(r.results).toHaveLength(5);
    expect(n.calls.map((c) => c.engine)).toEqual(['ddg']);
  });

  test('a captcha moves on to Bing at once, and DuckDuckGo rests (no captcha seen by the user)', async () => {
    const h = new EngineHealth(100, 1000);
    const n = net((e) => (e === 'ddg' ? { body: DDG_CAPTCHA } : good(e)));
    const r = await metaSearch(n.io, 'rtx 4060', { limit: 6, health: h });
    expect(r.engine).toBe('bing');
    expect(r.results[0].url).toBe('https://www.nvidia.com/en-us/geforce/rtx/');
    expect(n.calls.map((c) => c.engine)).toEqual(['ddg', 'bing']);
    expect(h.resting('duckduckgo')).toBe(true);

    // The next search skips the resting engine…
    await metaSearch(n.io, 'rtx 4070', { limit: 6, health: h });
    expect(n.calls.map((c) => c.engine)).toEqual(['ddg', 'bing', 'bing']);
    // …and tries it again once its rest is over.
    await Bun.sleep(120);
    await metaSearch(n.io, 'rtx 4080', { limit: 6, health: h });
    expect(n.calls.slice(3).map((c) => c.engine)).toEqual(['ddg', 'bing']);
  });

  test('rests grow when an engine keeps refusing, up to a cap', () => {
    const h = new EngineHealth(100, 300);
    const t = 1_000_000;
    h.blocked('bing', t); expect(h.resting('bing', t + 99)).toBe(true); expect(h.resting('bing', t + 101)).toBe(false);
    h.blocked('bing', t); expect(h.resting('bing', t + 199)).toBe(true);
    h.blocked('bing', t); h.blocked('bing', t); expect(h.resting('bing', t + 301)).toBe(false);
    h.ok('bing'); expect(h.resting('bing', t)).toBe(false);
  });

  test('few results are topped up from the next engine, without duplicates', async () => {
    const n = net((e) => (e === 'ddg' ? { body: DDG_PAGE(1, 'x') } : good(e)));
    const r = await metaSearch(n.io, 'rare thing', { limit: 6, health: new EngineHealth() });
    expect(r.results.map((x) => x.url)).toEqual(['https://www.x0.example/page', 'https://www.nvidia.com/en-us/geforce/rtx/', 'https://www.techpowerup.com/gpu-specs/geforce-rtx-4060.c4107', 'https://example.org/three']);
  });

  test('every engine refusing is a SearchBlocked; no internet says so plainly', async () => {
    const blocked = net(() => ({ status: 429, body: 'Too Many Requests' }));
    await expect(metaSearch(blocked.io, 'x y', { health: new EngineHealth() })).rejects.toBeInstanceOf(SearchBlocked);
    const offline = net(() => 'offline');
    await expect(metaSearch(offline.io, 'x y', { health: new EngineHealth() })).rejects.toThrow(/couldn't reach any search engine/);
  });
});

// ── The core's queue (agent tool and the app's web_search) ────────────────────────────────────

describe('searches through the core', () => {
  test('parallel searches go one at a time with a gap, and a repeated query is not sent again', async () => {
    SEARCH_GAP_MS.value = 80;
    const n = net((e, q) => good(e, q));
    const rs = await Promise.all(['alpha', 'beta', 'gamma', 'alpha'].map((q) => webSearch.run({ query: q }, n.ctx())));
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(n.calls.map((c) => c.q)).toEqual(['alpha', 'beta', 'gamma']);
    for (let i = 1; i < n.calls.length; i++) expect(n.calls[i].at - n.calls[i - 1].at).toBeGreaterThanOrEqual(70);
    expect((await webSearch.run({ query: '  Alpha ' }, n.ctx())).text).toContain('ddgalpha0');
    expect(n.calls.length).toBe(3);
    expect(rs[0].summary).toBe('5 results · DuckDuckGo');
  });

  test('when every engine refuses, one more try after a pause', async () => {
    let refuse = true;
    const n = net((e) => (refuse ? { status: 403, body: 'Forbidden' } : good(e)));
    setTimeout(() => { refuse = false; health.clear(); }, 30);
    const t0 = Date.now();
    const r = await webSearch.run({ query: 'flowers' }, n.ctx());
    expect(r.ok).toBe(true);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(55);
    expect(n.calls.slice(0, 4).map((c) => c.engine)).toEqual(['ddg', 'bing', 'lite', 'wiki']);

    __resetWebThrottle();
    const never = net(() => ({ status: 403, body: 'Forbidden' }));
    await expect(webSearch.run({ query: 'never' }, never.ctx())).rejects.toThrow(/Every search engine refused/);
  });

  test("the user's SearXNG is used when chosen", async () => {
    const calls: string[] = [];
    const ctx = { fetch: async (url: string) => { calls.push(url); return Response.json({ results: [{ title: 'S', url: 'https://s.example', content: 'from searx' }] }); },
      kvGet: () => JSON.stringify({ webSearchProvider: 'searxng', searxngUrl: 'http://127.0.0.1:8888/' }), signal: new AbortController().signal } as never;
    const r = await webSearch.run({ query: 'lotus' }, ctx);
    expect(r.summary).toBe('1 results · SearXNG');
    expect(calls[0]).toStartWith('http://127.0.0.1:8888/search?q=lotus&format=json');
  });

  test('web_search (Chat, tasks, routines) shares the queue and cache with the agent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lotusd-web-')); dirs.push(dir);
    const db = openDb(dir);
    kvApply(db, { key: 'lotus.settings.v1', value: JSON.stringify({ webSearchProvider: 'duckduckgo' }) } as never);
    const n = net((e, q) => (e === 'ddg' ? { body: DDG_CAPTCHA } : good(e, q)));
    const r = await webSearchRpc(db, 'rtx 4060 price', 6, n.fetch as never);
    expect(r.provider).toBe('Bing');
    expect(r.results.length).toBe(3);
    await webSearch.run({ query: 'rtx 4060 price' }, n.ctx()); // the agent asking the same thing: from the cache
    expect(n.calls.map((c) => c.engine)).toEqual(['ddg', 'bing']);
  });
});

// ── Deciding whether to search, and what ──────────────────────────────────────────────────────

const GPU_CHAT: PlanMsg[] = [
  { role: 'user', content: 'Which RTX 4060 cards are the quietest?' },
  { role: 'assistant', content: 'The ASUS Dual RTX 4060 and the MSI Ventus 2X are both quiet. Gigabyte also sells a yellow-accented Aero edition.' },
];

describe('search planning', () => {
  test("the model's one line is read in its usual shapes", () => {
    expect(parsePlan('SEARCH: Gigabyte RTX 4060 Aero yellow price')).toEqual({ search: true, query: 'Gigabyte RTX 4060 Aero yellow price' });
    expect(parsePlan('<think>the user asks about…</think>\n**SEARCH:** "rtx 4060 aero noise"')).toEqual({ search: true, query: 'rtx 4060 aero noise' });
    expect(parsePlan('NO SEARCH')).toEqual({ search: false, query: '' });
    expect(parsePlan('No search needed.')).toEqual({ search: false, query: '' });
    expect(parsePlan('Sure! Here is what I think about GPUs.')).toBeNull();
    expect(parsePlan('SEARCH: <query>')).toBeNull();
  });

  test('the planning prompt carries the recent conversation and the latest message once', () => {
    const [sys, user] = planTurns(GPU_CHAT, 'how much is the yellow one?');
    expect(sys.content).toContain('replace words like it, that, this one');
    expect(user.content).toContain('User: Which RTX 4060 cards are the quietest?');
    expect(user.content).toContain('Assistant: The ASUS Dual');
    expect(user.content.match(/yellow one/g)).toHaveLength(1);
  });

  test("the model's query is used: a follow-up keeps its topic", async () => {
    let asked = '';
    const p = await planSearch(GPU_CHAT, 'how much is the yellow one?', async (t) => { asked = t[1].content; return 'SEARCH: Gigabyte RTX 4060 Aero OC price'; });
    expect(p).toEqual({ search: true, query: 'Gigabyte RTX 4060 Aero OC price', by: 'model' });
    expect(asked).toContain('RTX 4060');
  });

  test('the model can say no search is needed', async () => {
    expect(await planSearch(GPU_CHAT, 'rewrite your answer as a short poem', async () => 'NO SEARCH')).toEqual({ search: false, query: '', by: 'model' });
  });

  test('small talk is never searched, and costs no model call', async () => {
    let called = false;
    expect((await planSearch(GPU_CHAT, 'thanks!', async () => { called = true; return 'SEARCH: thanks'; })).search).toBe(false);
    expect(called).toBe(false);
  });

  test('without a usable answer from the model, the rule gives a follow-up its topic', async () => {
    const p = await planSearch(GPU_CHAT, 'how much is the yellow one?', async () => { throw new Error('timed out'); });
    expect(p.by).toBe('rule');
    expect(p.search).toBe(true);
    expect(p.query).toContain('RTX');
    expect(p.query).toContain('4060');
    expect(p.query).toContain('yellow one');
    expect((await planSearch(GPU_CHAT, 'how much is the yellow one?', async () => 'I think it costs $300')).by).toBe('rule');
  });

  test('the rule leaves standalone questions alone and skips text jobs', () => {
    expect(rulePlan(GPU_CHAT, 'What is the population of Lisbon in 2026 according to the latest census?')).toEqual({ search: true, query: 'What is the population of Lisbon in 2026 according to the latest census?', by: 'rule' });
    expect(rulePlan(GPU_CHAT, 'Rewrite that more formally').search).toBe(false);
    expect(rulePlan([], 'latest llama.cpp release').query).toBe('latest llama.cpp release');
  });
});
