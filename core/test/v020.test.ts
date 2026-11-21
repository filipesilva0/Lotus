// 0.20.0: the critical bugs from the 0.19 design review.
//   1. A Work agent showed a green "Done" after all its web searches failed and it never answered.
//   2. Web search seemed to ask only DuckDuckGo, again and again, and told the user to switch to SearXNG.
//   3. Temperature sat at 2.00 with no warning.
//   4. A free-text question card came out as raw JSON.
//   5. The whole message, Markdown and all, went to the search engine; 0 results showed a green dot.
//   7. Auto-rename left a chat named after its first message.
//  10. "Plenty free" above a note saying the model doesn't fit; the default model didn't fit.
//  11. Three numbers for how many agents run at once, and no word on why they wait.

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db';
import { kvApply, kvGet } from '../src/kv';
import { MAX_FAILED_SEARCHES, runAgent, unfinishedNote, type AgentDeps } from '../src/agent/loop';
import { __clearCapCache, type WireMsg } from '../src/agent/llm';
import { deployLimit, helperSucceeded, readAgentSettings } from '../src/agent/service';
import { Registry } from '../src/agent/registry';
import { parseRules } from '../src/agent/policy';
import type { AgentEvent, Step, Tool } from '../src/agent/types';
import { EngineHealth, metaSearch, SearchBlocked, WIKI_UA, type WebIO } from '../../src/chat/webCore';
import { __resetWebThrottle, health, RETRY_AFTER_MS, SEARCH_GAP_MS, webSearch } from '../src/tools/web';
import { queryFromMessage, stripMarkdown } from '../../src/chat/webQuery';
import { parsePlan, rulePlan } from '../../src/chat/searchPlan';
import { DEFAULT_TEMPERATURE, fixSavedTemperature, temperatureWarning } from '../../src/chat/sampling';
import { looksLikeChoices, parseChoices } from '../../src/chat/choices';
import { shouldRename, withFinishedReply } from '../../src/chat/renameRules';
import { agentLimitText, planScale, statusOf } from '../../src/hardware/scaler';
import { entryById, preferredChatModel } from '../../src/models/library';
import { fakeOllama } from './fakes';

const dirs: string[] = [];
const tmp = (tag: string) => { const d = mkdtempSync(join(tmpdir(), `lotus-v020-${tag}-`)); dirs.push(d); return d; };
const stops: (() => void)[] = [];
afterAll(() => { stops.forEach((s) => s()); dirs.forEach((d) => { try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows */ } }); });

const step = (tool: string, status: Step['status'], detail = ''): Step => ({ id: `s-${Math.random()}`, runId: 'r', tool, label: tool, args: {}, status, detail, started: 0 });

// ── 1. Done only on real success ────────────────────────────────────────────────────────────────

describe('a run is Done only when it really answered', () => {
  test('helpers: no answer, or every step failed, is not success', () => {
    const failed = [step('web.search', 'error', 'DuckDuckGo asked for a captcha'), step('web.search', 'error', 'x')];
    // The 0.19 case: all searches failed and the "answer" was Lotus's own note.
    expect(helperSucceeded({ finished: false, steps: failed, content: unfinishedNote(failed) })).toBe(false);
    expect(helperSucceeded({ finished: true, steps: failed, content: 'Here is what I found.' })).toBe(false);
    expect(helperSucceeded({ finished: true, steps: [...failed, step('web.read', 'done')], content: 'The answer.' })).toBe(true);
    expect(helperSucceeded({ finished: true, steps: [], content: 'Just an answer.' })).toBe(true);
    expect(helperSucceeded({ finished: true, steps: [], content: '   ' })).toBe(false);
  });

  test('the note says what went wrong, in plain words', () => {
    const n = unfinishedNote([step('web.search', 'error', 'Web search didn\'t work: DuckDuckGo asked for a captcha'), step('web.search', 'error', 'Web search is paused')]);
    expect(n).toContain("couldn't finish");
    expect(n).toContain('all 2 searches failed (Web search is paused)');
    expect(unfinishedNote([step('files.read', 'done'), step('files.write', 'error', 'No such folder')])).toContain('1 of 2 steps failed. The last error: No such folder.');
  });

  function searchHarness(url: string, search: Tool['run']) {
    const db = openDb(tmp('loop'));
    const events: AgentEvent[] = [];
    const fake: Tool = { name: 'web.search', label: 'Searching the web', risk: 'read', description: 'Search.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'q' } }, required: ['query'] }, run: search };
    const deps: AgentDeps = {
      llm: { backend: 'ollama', url, fetch },
      registry: new Registry([fake]),
      ctx: { db, studio: tmp('studio'), folders: [], memoryOn: false, fetch, kvSet: (k, v) => { kvApply(db, { set: { [k]: v }, remove: [] }); }, kvGet: (k) => kvGet(db, k) },
      signal: new AbortController().signal, emit: (e) => events.push(e), record: () => undefined, approve: async () => true,
    };
    const req = { runId: 'r1', model: 'fake', messages: [{ role: 'user', content: 'Find the F1 results' }] as WireMsg[], tools: [fake], approval: 'auto' as const, rules: parseRules([]), maxTurns: 6 };
    return { deps, req, events };
  }

  test('after 2 failed searches in a row the run stops searching, and an unanswered run is not finished', async () => {
    __clearCapCache();
    let n = 0;
    const ol = fakeOllama((_ms, body) => (body.tools && (body.tools as unknown[]).length ? { calls: [{ name: 'web_search', args: { query: `f1 results ${n++}` } }] } : { calls: [{ name: 'web_search', args: { query: 'again' } }] }));
    stops.push(ol.stop);
    let ran = 0;
    const h = searchHarness(ol.url, async () => { ran++; throw new SearchBlocked('Web search didn\'t work: DuckDuckGo asked for a captcha; Bing answered 429'); });
    const out = await runAgent(h.req, h.deps);
    expect(ran).toBe(MAX_FAILED_SEARCHES);
    expect(out.steps.filter((s) => s.tool === 'web.search')).toHaveLength(2);
    expect(out.finished).toBe(false);
    expect(out.content).toContain('Web search didn\'t work');
    // The note reached the reply as text too.
    expect(h.events.filter((e) => e.kind === 'token').map((e) => (e as { text: string }).text).join('')).toContain("couldn't finish");
    // The last turn asks for an answer without reasoning (a long think used up its tokens before).
    expect(ol.requests.at(-1)?.body?.think).toBe(false);
  });

  test('a run that answers after failed searches is finished', async () => {
    __clearCapCache();
    const ol = fakeOllama((ms) => (ms.some((m) => m.role === 'tool') ? { content: "I couldn't search the web just now, so this is from memory: …" } : { calls: [{ name: 'web_search', args: { query: 'x' } }] }));
    stops.push(ol.stop);
    const h = searchHarness(ol.url, async () => { throw new SearchBlocked('nope'); });
    const out = await runAgent(h.req, h.deps);
    expect(out.finished).toBe(true);
  });
});

// ── 2. Search fallback and backoff ──────────────────────────────────────────────────────────────

type Engine = 'ddg' | 'bing' | 'lite' | 'wiki';
function net(answer: (e: Engine) => { status?: number; body: string }) {
  const calls: { engine: Engine; headers: Record<string, string> }[] = [];
  const f = async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const engine: Engine = u.host.startsWith('lite.') ? 'lite' : u.host.includes('duckduckgo') ? 'ddg' : u.host.includes('bing') ? 'bing' : 'wiki';
    calls.push({ engine, headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)) });
    const a = answer(engine);
    return new Response(a.body, { status: a.status ?? 200 });
  };
  const io: WebIO = { fetch: f, timeout: (ms, outer) => (outer ? AbortSignal.any([AbortSignal.timeout(ms), outer]) : AbortSignal.timeout(ms)) };
  return { calls, io, ctx: () => ({ fetch: f, kvGet: () => null, signal: new AbortController().signal }) as never };
}
const CAPTCHA = { body: '<form id="challenge-form">anomaly-modal: bots use DuckDuckGo too</form>' };
const WIKI = { body: JSON.stringify({ query: { search: [{ title: 'Formula One', snippet: 'motor racing' }, { title: '2026 Formula One World Championship', snippet: 'season' }, { title: 'F1 car', snippet: 'cars' }] } }) };

describe('web search falls back, and backs off', () => {
  beforeEach(() => { __resetWebThrottle(); SEARCH_GAP_MS.value = 5; RETRY_AFTER_MS.value = 30; });
  afterAll(() => { SEARCH_GAP_MS.value = 1000; RETRY_AFTER_MS.value = 8000; });

  test('a DuckDuckGo captcha goes on to the other engines; Wikipedia gets a User-Agent it accepts', async () => {
    const n = net((e) => (e === 'wiki' ? WIKI : CAPTCHA));
    const r = await metaSearch(n.io, 'formula one 2026 results', { health: new EngineHealth(), limit: 6 });
    expect(n.calls.map((c) => c.engine)).toEqual(['ddg', 'bing', 'lite', 'wiki']);
    expect(r.engine).toBe('wikipedia');
    expect(r.results.length).toBe(3);
    const ua = n.calls.find((c) => c.engine === 'wiki')!.headers['User-Agent'];
    expect(ua).toBe(WIKI_UA);
    // Wikimedia's policy: a name and a way to reach the maker.
    expect(ua).toMatch(/^\S+\/[\d.]+ \(https:\/\/\S+/);
  });

  test('when every engine refuses, the error names each answer and no longer points to SearXNG', async () => {
    const n = net((e) => (e === 'bing' ? { status: 429, body: '' } : e === 'wiki' ? { status: 403, body: 'Forbidden' } : CAPTCHA));
    const err = await metaSearch(n.io, 'x y', { health: new EngineHealth() }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(SearchBlocked);
    expect(String(err)).toContain('DuckDuckGo asked for a captcha; Bing said too many searches; DuckDuckGo Lite asked for a captcha; Wikipedia refused the search (answer 403)');
    expect(String(err)).not.toMatch(/SearXNG/);
  });

  test('then, while every engine rests, searches fail at once without asking anyone', async () => {
    const h = new EngineHealth();
    const n = net(() => ({ status: 403, body: '' }));
    await metaSearch(n.io, 'a b', { health: h }).catch(() => undefined);
    expect(n.calls).toHaveLength(4);
    const err = await metaSearch(n.io, 'c d', { health: h }).catch((e: SearchBlocked) => e);
    expect(n.calls).toHaveLength(4); // nothing asked: real backoff, not 8 more refusals
    expect((err as SearchBlocked).resting).toBe(true);
    expect(String(err)).toMatch(/paused.*tries again in about 2 minutes/);
  });

  test('the agent tool: its retry finds the engines resting and reports the first, informative error', async () => {
    const n = net(() => ({ status: 403, body: '' }));
    const t0 = Date.now();
    const err = await webSearch.run({ query: 'anything' }, n.ctx()).catch((e: Error) => e);
    expect(String(err)).toContain('DuckDuckGo refused the search (answer 403)');
    expect(n.calls).toHaveLength(4);
    expect(Date.now() - t0).toBeLessThan(2000);
    // And the next search is refused straight away.
    const again = await webSearch.run({ query: 'something else' }, n.ctx()).catch((e: Error) => e);
    expect(String(again)).toMatch(/paused/);
    expect(n.calls).toHaveLength(4);
    health.clear();
  });

  test('0 results is "No results", flagged empty (grey, not a green check)', async () => {
    const n = net((e) => (e === 'wiki' ? { body: JSON.stringify({ query: { search: [] } }) } : { body: '<html><body>nothing</body></html>' }));
    const r = await webSearch.run({ query: 'zzqqxx' }, n.ctx());
    expect(r.ok).toBe(true);
    expect(r.summary).toMatch(/^No results/);
    expect(r.data?.empty).toBe(true);
  });
});

// ── 5. Queries from intent, not Markdown ────────────────────────────────────────────────────────

describe('search queries', () => {
  test('Markdown never reaches the search engine', () => {
    expect(stripMarkdown('**What** is the _best_ `RTX 4060` [deal](https://x.example)?')).toBe('What is the best RTX 4060 deal?');
    expect(stripMarkdown('# Agenda\n- **Monday**: dentist\n> quoted')).toBe('Agenda Monday: dentist quoted');
    expect(stripMarkdown('C# vs snake_case_names')).toBe('C# vs snake_case_names');
    expect(queryFromMessage('Hey, **please** look up the *Lisbon* weather')).toBe('the Lisbon weather');
  });
  test('a long message becomes its main words; the planner\'s query loses its Markdown', () => {
    const long = 'I have a **really** long message here about planning my agenda for next week with the dentist on Monday and the gym on Tuesday and a call with my manager';
    const q = rulePlan([], long).query;
    expect(q.split(' ').length).toBeLessThanOrEqual(10);
    expect(q).not.toContain('**');
    expect(parsePlan('SEARCH: **RTX 4060** price')).toEqual({ search: true, query: 'RTX 4060 price' });
  });
});

// ── 3. Temperature ──────────────────────────────────────────────────────────────────────────────

describe('temperature', () => {
  test('a warning above 1.2, a stronger one at the top of the slider', () => {
    expect(temperatureWarning(0.7)).toBeNull();
    expect(temperatureWarning(1.2)).toBeNull();
    expect(temperatureWarning(1.5)).toMatch(/^High/);
    expect(temperatureWarning(2)).toMatch(/^Very high/);
  });
  test('a saved 2.00 goes back to 0.7 once; other values stay', () => {
    expect(fixSavedTemperature(2, false)).toBe(DEFAULT_TEMPERATURE);
    expect(fixSavedTemperature(2, true)).toBe(2);
    expect(fixSavedTemperature(1.4, false)).toBe(1.4);
    expect(fixSavedTemperature(undefined, false)).toBeUndefined();
  });
});

// ── 4. Question cards ───────────────────────────────────────────────────────────────────────────

describe('question cards', () => {
  test('a free-text question in a json block is a card, not raw JSON (the 0.19 review)', () => {
    const reply = 'Happy to help!\n\n```json\n{"question":"What is one real-world task you want Lotus to do?","type":"text"}\n```';
    const p = parseChoices(reply);
    expect(p.text).toBe('Happy to help!');
    expect(p.poll?.questions[0]).toMatchObject({ question: 'What is one real-world task you want Lotus to do?', type: 'text' });
  });
  test('while streaming, the block is hidden', () => {
    expect(parseChoices('Sure.\n\n```json\n{"question":"What is one').pending).toBe(true);
  });
  test('ordinary JSON stays JSON', () => {
    expect(looksLikeChoices({ question: 'x', type: 'banana' })).toBe(false);
    expect(looksLikeChoices({ name: 'config', type: 'text' })).toBe(false);
    expect(parseChoices('```json\n{"port": 8080, "type": "text"}\n```').poll).toBeNull();
  });
});

// ── 7. Auto-rename ──────────────────────────────────────────────────────────────────────────────

describe('auto-rename', () => {
  test('renames even when the finished reply still looks "streaming" in the state Lotus read', () => {
    const s = { title: 'hello! how are ya? whats your name?', autoTitle: 'hello! how are ya? whats your name?', messages: [
      { id: 'u', role: 'user', content: 'hello! how are ya? whats your name?' },
      { id: 'a', role: 'assistant', content: 'Hi, I am', isStreaming: true },
    ] } as never;
    expect(shouldRename(s)).toBe(false); // the 0.19 bug
    expect(shouldRename(withFinishedReply(s, 'a', 'Hi, I am Lotus. How can I help?'))).toBe(true);
  });
});

// ── 10. Video memory status and the default model ───────────────────────────────────────────────

describe('video memory card', () => {
  const gpu = { name: 'RTX 4060', totalMb: 8188, usedMb: 1700, freeMb: 6488 };
  const hw = { source: 'nvidia-smi' as const, gpu, ramTotalMb: 32000, ramFreeMb: 16000, at: 0 };
  test('"Plenty free" only when the model fits', () => {
    const partial = planScale({ hw, model: null, reserveMb: 512, maxSubagents: 4, manualCtx: 4096, autoScale: true, backend: 'builtin', builtin: { ctx: 4096, fits: false, budgetMb: 6200, baseMb: 7400, kvMb: 300, measured: true } });
    expect(partial.pressure).toBe('ok');
    expect(statusOf(partial)).toEqual({ label: "Model doesn't fit", tone: 'orange' });
    const fits = planScale({ hw, model: null, reserveMb: 512, maxSubagents: 4, manualCtx: 4096, autoScale: true, backend: 'builtin', builtin: { ctx: 16384, fits: true, budgetMb: 6200, baseMb: 5200, kvMb: 900, measured: true } });
    expect(statusOf(fits)).toEqual({ label: 'Plenty free', tone: 'muted' });
    // The note's number is the reading from load time, and says so.
    expect(partial.notes[0]).toMatch(/^When the model loaded, 6\.1 GB/);
  });
  test('the default chat model is the biggest installed one that fits, not the first', () => {
    const installed = [{ id: 'gemma-4-12b' }, { id: 'nemotron-3-nano-4b' }, { id: 'qwen3-8b' }];
    expect(preferredChatModel(installed, (m) => entryById(m.id), 8)?.id).toBe('qwen3-8b');
    expect(preferredChatModel(installed, (m) => entryById(m.id), 16)?.id).toBe('gemma-4-12b');
    expect(preferredChatModel(installed, (m) => entryById(m.id), undefined)?.id).toBe('gemma-4-12b');
  });
});

// ── 11. How many agents at once ─────────────────────────────────────────────────────────────────

describe('agents at once', () => {
  test('one sentence explains the real limit', () => {
    expect(agentLimitText({ maxSubagents: 1 }, 4, 'builtin')).toBe("Right now one runs at a time: Lotus's own engine answers one request at a time, so agents take turns.");
    expect(agentLimitText({ maxSubagents: 2 }, 4, 'ollama')).toBe('Right now 2 run at once: that is what free video memory allows.');
    expect(agentLimitText({ maxSubagents: 4 }, 4, 'ollama')).toBe('Right now 4 run at once, your limit.');
    const p = planScale({ hw: null, model: null, reserveMb: 0, maxSubagents: 4, manualCtx: 4096, autoScale: true, backend: 'builtin', builtin: { ctx: 8192, fits: true, budgetMb: 6000, baseMb: 4000, kvMb: 500, measured: true } });
    expect(p.notes.some((n) => /one request at a time/.test(n))).toBe(true);
  });
  test("Work's agents follow the engine and the user's limit", () => {
    expect(deployLimit({ backend: 'builtin', maxSubagents: 4 })).toBe(1);
    expect(deployLimit({ backend: 'ollama', maxSubagents: 4 })).toBe(3);
    expect(deployLimit({ backend: 'ollama', maxSubagents: 2 })).toBe(2);
    const db = openDb(tmp('settings'));
    kvApply(db, { set: { 'lotus.settings.v1': JSON.stringify({ maxSubagents: 2 }) }, remove: [] });
    expect(readAgentSettings(db).maxSubagents).toBe(2);
  });
});
