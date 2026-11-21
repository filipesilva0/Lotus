// 0.15.1: a tool call written as JSON inside the answer (Qwen 2.5 Coder 7B, 0.15.0 review) is run,
// not shown to the user as raw JSON.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db';
import { kvApply, kvGet } from '../src/kv';
import { DEFAULT_DENY, parseRules } from '../src/agent/policy';
import { fromWire, Registry } from '../src/agent/registry';
import { runAgent, type AgentDeps } from '../src/agent/loop';
import { __clearCapCache, type WireMsg } from '../src/agent/llm';
import { ALL_TOOLS } from '../src/agent/service';
import { callsInText } from '../src/agent/textCalls';
import type { AgentEvent } from '../src/agent/types';
import { fakeOllama, last } from './fakes';

const dirs: string[] = [];
const tmp = (tag: string) => { const d = mkdtempSync(join(tmpdir(), `lotus-tc-${tag}-`)); dirs.push(d); return d; };
const stops: (() => void)[] = [];
afterAll(() => { stops.forEach((s) => s()); dirs.forEach((d) => { try { rmSync(d, { recursive: true, force: true }); } catch { /* temp */ } }); });

const TOOLS = new Set(['task.add', 'task.list', 'web.search', 'files.read']);
const known = (n: string) => TOOLS.has(fromWire(n));

describe('tool calls inside an answer', () => {
  test('the review case: prose, then the call in a ```json fence', () => {
    const r = callsInText('Let me look that up for you.\n\n```json\n{"name": "web_search", "arguments": {"query": "capital of Portugal"}}\n```', known);
    expect(r?.calls).toEqual([{ name: 'web_search', args: { query: 'capital of Portugal' } }]);
    expect(r?.text).toBe('Let me look that up for you.');
  });

  test('a bare object in the middle of a sentence, and text after it', () => {
    const r = callsInText('Sure! {"name": "task_add", "parameters": {"title": "Buy eggs"}} I will add it now.', known);
    expect(r?.calls).toEqual([{ name: 'task_add', args: { title: 'Buy eggs' } }]);
    expect(r?.text).toBe('Sure!  I will add it now.');
  });

  test('OpenAI shape, arguments as a string, and a list of calls', () => {
    expect(callsInText('Ok:\n{"type": "function", "function": {"name": "files_read", "arguments": "{\\"path\\": \\"a.txt\\"}"}}', known)?.calls)
      .toEqual([{ name: 'files_read', args: { path: 'a.txt' } }]);
    expect(callsInText('Two things:\n```json\n[{"name": "task_add", "arguments": {"title": "A"}}, {"name": "task_add", "arguments": {"title": "B"}}]\n```', known)?.calls.map((c) => c.args.title)).toEqual(['A', 'B']);
  });

  test('one call per line in a single block', () => {
    const r = callsInText('```\n{"name": "task_add", "arguments": {"title": "A"}}\n{"name": "task_list", "arguments": {}}\n```', known);
    expect(r?.calls.map((c) => c.name)).toEqual(['task_add', 'task_list']);
  });

  test('loose JSON (single quotes, trailing comma) still counts', () => {
    expect(callsInText("I'll check: {'name': 'task_list', 'arguments': {},}", known)?.calls).toEqual([{ name: 'task_list', args: {} }]);
  });

  test('<tool_call> JSON after some prose', () => {
    expect(callsInText('Checking.\n<tool_call>\n{"name": "task_list", "arguments": {}}\n</tool_call>', known)?.calls).toEqual([{ name: 'task_list', args: {} }]);
  });

  test('ordinary JSON in an answer is left alone', () => {
    // Not a tool name.
    expect(callsInText('Here is the config: {"name": "my-app", "arguments": {"port": 3000}}', known)).toBeNull();
    // Has other fields: data with a "name", not a call.
    expect(callsInText('```json\n{"name": "task_add", "version": "1.0", "arguments": {}}\n```', known)).toBeNull();
    // No arguments at all: a person or a product, not a call.
    expect(callsInText('The record is {"name": "task_list"}.', known)).toBeNull();
    // A call shape nested inside a bigger object is an example, not a call.
    expect(callsInText('Example payload: {"example": {"name": "task_list", "arguments": {}}}', known)).toBeNull();
    expect(callsInText('No JSON here { just a brace.', known)).toBeNull();
  });
});

describe('agent loop', () => {
  test('a call inside the answer runs, and the user sees the real answer instead of JSON', async () => {
    __clearCapCache();
    let n = 0;
    const ol = fakeOllama((ms) => {
      n++;
      if (last(ms, 'tool') || n > 1) return { content: 'Added “Buy eggs” to your board.' };
      return { content: 'Let me add that.\n```json\n{"name": "task_add", "arguments": {"title": "Buy eggs"}}\n```' };
    }, { capabilities: ['completion'] });
    stops.push(ol.stop);
    const db = openDb(tmp('loop'));
    const events: AgentEvent[] = [];
    const deps: AgentDeps = {
      llm: { backend: 'ollama', url: ol.url, fetch },
      registry: new Registry(ALL_TOOLS),
      ctx: { db, studio: tmp('studio'), folders: [], memoryOn: true, fetch, kvSet: (k, v) => { kvApply(db, { set: { [k]: v }, remove: [] }); }, kvGet: (k) => kvGet(db, k) },
      signal: new AbortController().signal,
      emit: (e) => events.push(e), record: () => undefined, approve: async () => true,
    };
    const out = await runAgent({
      runId: 'r1', model: 'qwen2.5-coder:7b', messages: [{ role: 'system', content: 'You are Lotus.' }, { role: 'user', content: 'add buy eggs' }] as WireMsg[],
      tools: ALL_TOOLS.filter((t) => t.name.startsWith('task.')), approval: 'auto', rules: parseRules(DEFAULT_DENY),
    }, deps);
    expect(out.steps.map((s) => [s.tool, s.status])).toEqual([['task.add', 'done']]);
    expect(out.content).toBe('Added “Buy eggs” to your board.');
    expect(out.content).not.toContain('{');
    // The JSON that streamed in was taken back off the screen.
    expect(events.some((e) => e.kind === 'reset')).toBe(true);
  });
});
