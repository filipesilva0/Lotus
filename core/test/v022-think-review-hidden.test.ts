// 0.22.1: in Think mode the answer used to stream into the chat, then Lotus kept "thinking" (the review)
// and sometimes wiped and rewrote it. Now the first answer is written in the reasoning drawer, checked
// there, and the chat gets the answer only after the check: the reply ends when the answer appears.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db';
import { kvApply, kvGet } from '../src/kv';
import { DEFAULT_DENY, parseRules } from '../src/agent/policy';
import { Registry } from '../src/agent/registry';
import { runAgent, type AgentDeps } from '../src/agent/loop';
import { __clearCapCache, type WireMsg } from '../src/agent/llm';
import { ALL_TOOLS } from '../src/agent/service';
import type { AgentEvent } from '../src/agent/types';
import { fakeOllama, last } from './fakes';

const dirs: string[] = [];
const stops: (() => void)[] = [];
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), `lotus-thk-${p}-`)); dirs.push(d); return d; };
afterAll(() => { stops.forEach((s) => s()); dirs.forEach((d) => { try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows */ } }); });

function harness(url: string) {
  const db = openDb(tmp('db'));
  const studio = tmp('studio');
  const events: AgentEvent[] = [];
  const deps: AgentDeps = {
    llm: { backend: 'ollama', url, fetch },
    registry: new Registry(ALL_TOOLS),
    ctx: { db, studio, folders: [studio], memoryOn: true, fetch, kvSet: (k, v) => { kvApply(db, { set: { [k]: v }, remove: [] }); }, kvGet: (k) => kvGet(db, k) },
    signal: new AbortController().signal,
    emit: (e) => events.push(e),
    record: () => undefined,
    approve: async () => true,
  };
  const req = (text: string, think: boolean) => ({
    runId: 'r1', model: 'fake', think, messages: [{ role: 'system', content: 'You are Lotus.' }, { role: 'user', content: text }] as WireMsg[],
    tools: ALL_TOOLS.filter((t) => !t.name.startsWith('web.') && !t.name.startsWith('computer.') && !t.name.startsWith('browser.')), approval: 'auto' as const, rules: parseRules(DEFAULT_DENY),
  });
  return { events, deps, req };
}

const isReview = (ms: WireMsg[], body: { tools?: unknown[] }) => !body.tools?.length && String(last(ms, 'user')?.content ?? '').includes('strict expert reviewer');
const isAnalysis = (ms: WireMsg[], body: { tools?: unknown[] }) => !body.tools?.length && String(last(ms, 'user')?.content ?? '').includes('analyse the user');
const text = (events: AgentEvent[], kind: 'token' | 'thinking') => events.filter((e) => e.kind === kind).map((e) => (e as { text: string }).text).join('');

describe('Think mode checks the answer inside the reasoning', () => {
  test('nothing reaches the chat until the review is done; then the answer, and nothing after it', async () => {
    __clearCapCache();
    const order: string[] = [];
    let h!: ReturnType<typeof harness>;
    const ol = fakeOllama((ms, body) => {
      if (isAnalysis(ms, body)) return { content: 'Simple fact question.' };
      if (isReview(ms, body)) { order.push(`review after ${h.events.filter((e) => e.kind === 'token').length} chat tokens`); return { content: 'NO ISSUES' }; }
      return { content: 'Paris is the capital of France.' };
    }, { capabilities: ['completion', 'tools', 'thinking'] });
    stops.push(ol.stop);
    h = harness(ol.url);
    const out = await runAgent(h.req('capital of france?', true), h.deps);
    expect(order).toEqual(['review after 0 chat tokens']);
    expect(out.content).toBe('Paris is the capital of France.');
    expect(text(h.events, 'token')).toBe('Paris is the capital of France.');
    // The last thing the reply does is show the answer: no reasoning after it.
    const lastToken = h.events.map((e) => e.kind).lastIndexOf('token');
    expect(h.events.slice(lastToken + 1).some((e) => e.kind === 'thinking')).toBe(false);
    const thought = text(h.events, 'thinking');
    expect(thought).toContain('### Draft answer');
    expect(thought.indexOf('### Draft answer')).toBeLessThan(thought.indexOf('### Review'));
  });

  test('a review that finds a problem: the first answer never shows in the chat, only the fixed one', async () => {
    __clearCapCache();
    const ol = fakeOllama((ms, body) => {
      if (isAnalysis(ms, body)) return { content: 'Fact question.' };
      if (isReview(ms, body)) return { content: 'Wrong city: the capital is Paris.' };
      if (String(last(ms, 'user')?.content ?? '').includes('A review of your answer found')) return { content: 'Paris is the capital of France.' };
      return { content: 'Lyon is the capital of France.' };
    });
    stops.push(ol.stop);
    const h = harness(ol.url);
    const out = await runAgent(h.req('capital of france?', true), h.deps);
    expect(out.content).toBe('Paris is the capital of France.');
    expect(text(h.events, 'token')).toBe('Paris is the capital of France.');
    expect(text(h.events, 'thinking')).toContain('Lyon');
  });

  test('text before a tool call still shows in the chat; the answer after the tool is held for the review', async () => {
    __clearCapCache();
    let h!: ReturnType<typeof harness>;
    let tokensAtReview = '';
    const ol = fakeOllama((ms, body) => {
      if (isAnalysis(ms, body)) return { content: 'Needs task.add.' };
      if (isReview(ms, body)) { tokensAtReview = text(h.events, 'token'); return { content: 'NO ISSUES' }; }
      if (last(ms, 'tool')) return { content: 'Added “Buy milk” to your board.' };
      return { content: 'Adding it now.', calls: [{ name: 'task_add', args: { title: 'Buy milk' } }] };
    }, { capabilities: ['completion', 'tools', 'thinking'] });
    stops.push(ol.stop);
    h = harness(ol.url);
    const out = await runAgent(h.req('add buy milk', true), h.deps);
    expect(tokensAtReview).toBe('Adding it now.');
    expect(out.content).toBe('Adding it now.\n\nAdded “Buy milk” to your board.');
  });

  test('Think off: the answer streams straight to the chat as before', async () => {
    __clearCapCache();
    const ol = fakeOllama([{ content: 'Hello there.' }]);
    stops.push(ol.stop);
    const h = harness(ol.url);
    const out = await runAgent(h.req('hi', false), h.deps);
    expect(out.content).toBe('Hello there.');
    expect(text(h.events, 'thinking')).not.toContain('### Draft answer');
  });
});
