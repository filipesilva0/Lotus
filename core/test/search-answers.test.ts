// 0.16.5: fixes from the 0.16.0 hands-on test on an RTX 4060.
//   1. A model that keeps searching until its steps run out now gets asked for an answer (Formula 1 and
//      Lisbon weather ended with "I stopped… without a final answer" after 8 searches).
//   2. Work research that found nothing can't produce made-up references or claim a reference list.
//   3. Bing's off-topic pages (after a DuckDuckGo captcha) are dropped.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db';
import { kvApply, kvGet } from '../src/kv';
import { parseRules } from '../src/agent/policy';
import { Registry } from '../src/agent/registry';
import { FINAL_ANSWER_PROMPT, MAX_SEARCHES, runAgent, sourcesOf, type AgentDeps } from '../src/agent/loop';
import { __clearCapCache, type WireMsg } from '../src/agent/llm';
import { checkReferences, claimsSources, cleanReferences, referenceSection, SeenSources, urlsIn } from '../src/agent/sources';
import { helperSources, withSources } from '../src/agent/service';
import { agentsDeploy, artifactWrite } from '../src/tools/work';
import type { Step, Tool, ToolCtx } from '../src/agent/types';
import { matchCount, queryTerms, relevantResults, type WebResult } from '../../src/chat/webCore';
import { fakeOllama, last } from './fakes';

const dirs: string[] = [];
const stops: (() => void)[] = [];
const tmp = (tag: string) => { const d = mkdtempSync(join(tmpdir(), `lotus-0165-${tag}-`)); dirs.push(d); return d; };
afterAll(() => { stops.forEach((s) => s()); dirs.forEach((d) => { try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows: db may be open */ } }); });

/** A pretend web.search: every query finds two pages about it. */
const searches: string[] = [];
const fakeSearch: Tool = {
  name: 'web.search', label: 'Searching the web', risk: 'read', description: 'Search the web.',
  parameters: { type: 'object', properties: { query: { type: 'string', description: 'What to search for.' } }, required: ['query'] },
  async run(a) {
    const q = String(a.query);
    searches.push(q);
    const slug = q.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const results = [{ title: `${q} – results`, url: `https://www.formula1.com/en/${slug}` }, { title: `${q} news`, url: `https://news.example.com/${slug}` }];
    return { ok: true, text: results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\nSnippet about ${q}`).join('\n\n'), summary: '2 results', data: { results } };
  },
};

function harness(url: string, tools: Tool[], workDir?: string) {
  const db = openDb(tmp('db'));
  const events: unknown[] = [];
  const deps: AgentDeps = {
    llm: { backend: 'ollama', url, fetch },
    registry: new Registry(tools),
    ctx: { db, studio: tmp('studio'), folders: [], memoryOn: false, fetch, workDir, kvSet: (k, v) => { kvApply(db, { set: { [k]: v }, remove: [] }); }, kvGet: (k) => kvGet(db, k) } as Omit<ToolCtx, 'progress' | 'signal'>,
    signal: new AbortController().signal,
    emit: (e) => events.push(e),
    record: () => undefined,
    approve: async () => true,
  };
  const req = (text: string, maxTurns?: number) => ({
    runId: 'r1', model: 'fake', messages: [{ role: 'system', content: 'You are Lotus.' }, { role: 'user', content: text }] as WireMsg[],
    tools, approval: 'auto' as const, rules: parseRules([]), maxTurns,
  });
  return { deps, req, events };
}

describe('a model that keeps searching still answers', () => {
  test('out of steps: one more turn without tools gives the answer', async () => {
    __clearCapCache();
    searches.length = 0;
    let n = 0;
    const ol = fakeOllama((ms, body) => {
      if (!(body as { tools?: unknown[] }).tools?.length) return { content: 'Max Verstappen won the last race, according to formula1.com.' };
      n++;
      return { calls: [{ name: 'web_search', args: { query: `f1 results try ${n}` } }] };
    });
    stops.push(ol.stop);
    const h = harness(ol.url, [fakeSearch]);
    const out = await runAgent(h.req('who won the last formula 1 race?', 8), h.deps);
    expect(out.content).toBe('Max Verstappen won the last race, according to formula1.com.');
    expect(out.content).not.toContain('stopped after several tool steps');
    // The last request has no tools and asks for the answer.
    const final = ol.requests[ol.requests.length - 1];
    expect(final.tools ?? []).toEqual([]);
    expect((last(final.messages, 'user') as { content: string }).content).toBe(FINAL_ANSWER_PROMPT);
    // Searches stop after the budget: the model is told to answer instead.
    expect(searches.length).toBe(MAX_SEARCHES);
    const tool = final.messages.filter((m) => m.role === 'tool').map((m) => (m as { content: string }).content);
    expect(tool[tool.length - 1]).toContain(`already searched ${MAX_SEARCHES} times`);
  });

  test('text from earlier turns is replaced by the final answer', async () => {
    __clearCapCache();
    let n = 0;
    const ol = fakeOllama((ms, body) => {
      if (!(body as { tools?: unknown[] }).tools?.length) return { content: 'It is 18 °C and sunny in Lisbon.' };
      n++;
      return { content: 'Let me search again.', calls: [{ name: 'web_search', args: { query: `lisbon weather ${n}` } }] };
    });
    stops.push(ol.stop);
    const h = harness(ol.url, [fakeSearch]);
    const out = await runAgent(h.req('weather in lisbon?', 3), h.deps);
    expect(out.content).toBe('It is 18 °C and sunny in Lisbon.');
  });

  test('a model that answers normally gets no extra turn', async () => {
    __clearCapCache();
    const ol = fakeOllama((ms) => (last(ms, 'tool') ? { content: 'Lando Norris won.' } : { calls: [{ name: 'web_search', args: { query: 'last f1 race winner' } }] }));
    stops.push(ol.stop);
    const h = harness(ol.url, [fakeSearch]);
    const out = await runAgent(h.req('who won?'), h.deps);
    expect(out.content).toBe('Lando Norris won.');
    expect(ol.requests.length).toBe(2);
  });
});

describe('no invented references', () => {
  test('finding links and reference lists', () => {
    expect(urlsIn('See https://a.example/x, and (https://b.example/y).')).toEqual(['https://a.example/x', 'https://b.example/y']);
    const seen = new SeenSources();
    seen.add(['https://www.formula1.com/en/results/2026?x=1#top']);
    expect(seen.has('https://formula1.com/en/results/2026/')).toBe(true);
    expect(seen.has('https://www.formula1.com')).toBe(true); // the site's front page
    expect(seen.has('https://www.formula1.com/en/made-up')).toBe(false);
    const md = '# Brief\n\nBody.\n\n## References\n\n1. Smith, J. (2020). A study.\n\n## Appendix\n\nMore.';
    const s = referenceSection(md)!;
    expect(md.slice(s.start, s.end)).toContain('Smith');
    expect(md.slice(s.start, s.end)).not.toContain('Appendix');
    expect(referenceSection('<h2>Sources</h2><ul><li>x</li></ul><h2>Next</h2>')).not.toBeNull();
    expect(referenceSection('# Brief\n\nNo list here.')).toBeNull();
  });

  test('a document is checked against what was really found', () => {
    const none = new SeenSources();
    const md = '# Brief\n\nText.\n\n## Reference List\n\n- Smith (2020). https://journal.example/smith\n';
    expect(checkReferences('brief.md', md, none)).toEqual({ invented: ['https://journal.example/smith'], refsWithoutSources: true });
    const seen = new SeenSources();
    seen.add(['https://journal.example/smith']);
    expect(checkReferences('brief.md', md, seen)).toEqual({ invented: [], refsWithoutSources: false });
    // A web page may link its fonts; only its reference list counts.
    expect(checkReferences('page.html', '<link href="https://fonts.example/css"><h1>Hi</h1>', none).invented).toEqual([]);
    const cleaned = cleanReferences('brief.md', md, checkReferences('brief.md', md, none));
    expect(cleaned).not.toContain('Reference List');
    expect(cleaned).not.toContain('journal.example');
    expect(cleaned).toContain('No sources were found');
  });

  test('replies that claim references', () => {
    expect(claimsSources('The brief is done, with a Reference List at the end.')).toBe(true);
    expect(claimsSources('I saved brief.md. It is fully referenced.')).toBe(true);
    expect(claimsSources('I saved brief.md. It has no references because nothing was found.')).toBe(false);
    expect(claimsSources('Written without sources: the researchers found nothing.')).toBe(false);
    expect(claimsSources('I saved brief.md.')).toBe(false);
  });

  test('artifact.write: made-up links are sent back once, then removed', async () => {
    __clearCapCache();
    const doc = '# Brief\n\nCycling is good.\n\n## References\n\n- WHO (2020). https://who.example/cycling\n';
    let tries = 0;
    const ol = fakeOllama((ms) => {
      const t = last(ms, 'tool') as { content: string } | undefined;
      if (t?.content.startsWith('Saved') || t?.content.startsWith('Updated')) return { content: 'Done: brief.md is saved.' };
      tries++;
      return { calls: [{ name: 'artifact_write', args: { title: 'Brief', filename: 'brief.md', content: doc } }] };
    });
    stops.push(ol.stop);
    const work = tmp('work');
    const h = harness(ol.url, [artifactWrite], work);
    const out = await runAgent(h.req('write a brief on cycling'), h.deps);
    expect(tries).toBe(2);
    const firstReply = ol.requests[1].messages.filter((m) => m.role === 'tool').map((m) => (m as { content: string }).content)[0];
    expect(firstReply).toContain('Not saved');
    expect(firstReply).toContain('must not have a references');
    const saved = readFileSync(join(work, 'brief.md'), 'utf8');
    expect(saved).toContain('Cycling is good.');
    expect(saved).not.toContain('who.example');
    expect(saved).toContain('No sources were found');
    expect(out.content).toBe('Done: brief.md is saved.');
  });

  test('links that a search really returned are kept', async () => {
    __clearCapCache();
    const ol = fakeOllama((ms) => {
      const tools = ms.filter((m) => m.role === 'tool');
      if (!tools.length) return { calls: [{ name: 'web_search', args: { query: 'cycling health' } }] };
      if (tools.length === 1) return { calls: [{ name: 'artifact_write', args: { title: 'Brief', filename: 'brief.md', content: '# Brief\n\n## Sources\n\n- https://www.formula1.com/en/cycling-health\n' } }] };
      return { content: 'Saved brief.md with its sources.' };
    });
    stops.push(ol.stop);
    const work = tmp('work2');
    const h = harness(ol.url, [fakeSearch, artifactWrite], work);
    const out = await runAgent(h.req('write a brief'), h.deps);
    expect(readFileSync(join(work, 'brief.md'), 'utf8')).toContain('https://www.formula1.com/en/cycling-health');
    expect(out.unverified).toEqual([]);
  });

  test('a reply claiming a reference list with no sources found is checked', async () => {
    __clearCapCache();
    const ol = fakeOllama((ms) => {
      const u = last(ms, 'user') as { content: string };
      if (u.content.startsWith('(Lotus check)')) return { content: 'Done. Brief saved; it was written without sources, since none were found.' };
      if (!ms.some((m) => m.role === 'tool')) return { calls: [{ name: 'artifact_write', args: { title: 'Brief', filename: 'brief.md', content: '# Brief\n\nText.' } }] };
      return { content: 'Done! Saved the brief with a Reference List.' };
    });
    stops.push(ol.stop);
    const h = harness(ol.url, [artifactWrite], tmp('work3'));
    const out = await runAgent(h.req('write a brief'), h.deps);
    expect(out.content).toBe('Done. Brief saved; it was written without sources, since none were found.');
  });

  test('helpers pass on what they found, or say they found nothing', async () => {
    const steps = [
      { tool: 'web.search', status: 'done', data: { results: [{ title: 'A', url: 'https://a.example/1' }, { title: 'B', url: 'https://b.example/2' }] } },
      { tool: 'web.read', status: 'done', data: { title: 'B page', url: 'https://b.example/2' } },
      { tool: 'web.read', status: 'error', data: { url: 'https://c.example/3' } },
    ] as unknown as Step[];
    expect(helperSources(steps)).toEqual([{ title: 'B page', url: 'https://b.example/2' }, { title: 'A', url: 'https://a.example/1' }]);
    expect(withSources('Facts.', helperSources(steps), true)).toContain('Sources found:\n- B page: https://b.example/2');
    expect(withSources('Facts from memory.', [], true)).toContain('found no web sources');
    expect(withSources('Wrote a section.', [], false)).toBe('Wrote a section.');
    // A helper's own written answer doesn't count as a source; its found pages do.
    const deployStep = { tool: 'agents.deploy', status: 'done', data: { sources: [{ title: 'A', url: 'https://a.example/1' }] } } as unknown as Step;
    expect(sourcesOf(deployStep, 'See https://made-up.example/x')).toEqual(['https://a.example/1']);

    const ctx = { deploy: async () => [{ name: 'Researcher', content: 'Nothing.', steps: 8, ok: true, sources: [] }, { name: 'Writer', content: 'Draft.', steps: 1, ok: true, sources: [] }], progress: () => undefined } as unknown as ToolCtx;
    const r = await agentsDeploy.run({ tasks: ['Researcher: find studies', 'Writer: draft'] }, ctx);
    expect(r.text).toContain("None of the agents found any web sources");
  });
});

describe('off-topic search results are dropped', () => {
  const r = (title: string, url: string, snippet = ''): WebResult => ({ title, url, snippet });
  test('query words', () => {
    expect(queryTerms('Who won the latest Formula 1 race in 2026?')).toEqual(['won', 'formula', 'race']);
    expect(queryTerms('f1 results')).toEqual(['f1', 'results']);
    expect(queryTerms('tempo em Lisboa hoje')).toEqual(['tempo', 'lisboa']);
    expect(matchCount(['races'], r('Race calendar', 'https://x.example'))).toBe(1);
  });
  test('Bing-style junk goes, the closest come first', () => {
    const got = relevantResults('lisbon weather forecast', [
      r('MSN | Outlook, Office, Skype, Bing, Breaking News', 'https://www.msn.com/en-us'),
      r('Lisbon, Portugal 10-day weather forecast', 'https://www.weather.example/lisbon'),
      r('YouTube', 'https://www.youtube.com/'),
      r('Lisbon travel guide', 'https://travel.example/lisbon'),
    ]);
    expect(got.map((x) => x.url)).toEqual(['https://www.weather.example/lisbon', 'https://travel.example/lisbon']);
    expect(relevantResults('?!', [r('Anything', 'https://a.example')])).toHaveLength(1);
  });
});
