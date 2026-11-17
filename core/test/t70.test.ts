// T70 (17 Nov 2026): the "first hour" fixes from the 0.11.0 audit (STATE.md #5–#13).

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db';
import { kvApply, kvGet } from '../src/kv';
import { DEFAULT_DENY, parseRules } from '../src/agent/policy';
import { countIn, findClaims, unbackedClaims } from '../src/agent/claims';
import { Registry } from '../src/agent/registry';
import { APPROVAL_WAIT_MS, runAgent, type AgentDeps } from '../src/agent/loop';
import { __clearCapCache, type WireMsg } from '../src/agent/llm';
import { AgentService, ALL_TOOLS, readAgentSettings } from '../src/agent/service';
import { isNoIssues, stepsDigest } from '../src/agent/think';
import type { AgentEvent, Step } from '../src/agent/types';
import { filesEdit, filesWrite, resolveInFolders } from '../src/tools/files';
import { imageEngine } from '../src/tools/image';
import { TASKS_KEY } from '../src/tools/tasks';
import { askUser } from '../src/tools/work';
import { comfyAlternate, engineChoice } from '../../src/lib/engineDefaults';
import { fakeOllama, last } from './fakes';

const dirs: string[] = [];
const stops: (() => void)[] = [];
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), `lotus-t70-${p}-`)); dirs.push(d); return d; };
afterAll(() => { stops.forEach((s) => s()); dirs.forEach((d) => { try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows: a test database may still be open; the OS cleans temp */ } }); });

function harness(url: string, o: { approval?: 'ask' | 'risky' | 'auto'; approve?: (s: Step) => boolean | 'timeout' | Promise<boolean | 'timeout'>; backend?: 'ollama' | 'llamacpp'; nativeTools?: boolean; auth?: string } = {}) {
  const db = openDb(tmp('db'));
  const studio = tmp('studio');
  const events: AgentEvent[] = [];
  const asked: Step[] = [];
  const deps: AgentDeps = {
    llm: { backend: o.backend ?? 'ollama', url, fetch, nativeTools: o.nativeTools, auth: o.auth },
    registry: new Registry(ALL_TOOLS),
    ctx: { db, studio, folders: [studio], memoryOn: true, fetch, kvSet: (k, v) => { kvApply(db, { set: { [k]: v }, remove: [] }); }, kvGet: (k) => kvGet(db, k) },
    signal: new AbortController().signal,
    emit: (e) => events.push(e),
    record: () => undefined,
    approve: async (s) => { asked.push(s); return o.approve ? o.approve(s) : true; },
  };
  const req = (text: string, extra: Record<string, unknown> = {}) => ({
    runId: 'r1', model: 'fake', messages: [{ role: 'system', content: 'You are Lotus.' }, { role: 'user', content: text }] as WireMsg[],
    tools: ALL_TOOLS.filter((t) => !t.name.startsWith('web.') && !t.name.startsWith('computer.') && !t.name.startsWith('browser.')), approval: o.approval ?? 'risky', rules: parseRules(DEFAULT_DENY), ...extra,
  });
  return { db, studio, events, asked, deps, req };
}

describe('#10 one set of engine defaults', () => {
  test('new install → Lotus engines; pre-session-17 settings → Ollama/ComfyUI/Voicebox; explicit choices kept', () => {
    expect(engineChoice(null)).toEqual({ llmBackend: 'builtin', imageEngine: 'builtin', voiceEngine: 'builtin' });
    expect(engineChoice('{"selectedModel":"x"}')).toEqual({ llmBackend: 'ollama', imageEngine: 'comfyui', voiceEngine: 'voicebox' });
    expect(engineChoice('{"imageEngine":"builtin"}')).toEqual({ llmBackend: 'builtin', imageEngine: 'builtin', voiceEngine: 'builtin' });
    expect(engineChoice('{"imageEngine":"comfyui","llmBackend":"llamacpp"}')).toEqual({ llmBackend: 'llamacpp', imageEngine: 'comfyui', voiceEngine: 'builtin' });
    expect(engineChoice('not json').llmBackend).toBe('ollama');
  });
  test('the core reads them the same way', () => {
    const db = openDb(tmp('def'));
    expect(readAgentSettings(db).backend).toBe('builtin');
    expect(imageEngine({ kvGet: (k) => kvGet(db, k) })).toBe('builtin');
    kvApply(db, { set: { 'lotus.settings.v1': JSON.stringify({ selectedModel: 'old' }) }, remove: [] });
    expect(readAgentSettings(db).backend).toBe('ollama');
    expect(imageEngine({ kvGet: (k) => kvGet(db, k) })).toBe('comfyui');
  });
});

describe('#8 claims count and cover more actions', () => {
  test('numbers', () => {
    expect(countIn('I added 4 tasks to your board.')).toBe(4);
    expect(countIn('I added three new tasks.')).toBe(3);
    expect(countIn('Criei 2 tarefas no quadro.')).toBe(2);
    expect(countIn('I added the task.')).toBeUndefined();
    expect(countIn('I added 1 task.')).toBeUndefined();
  });
  test('"added 4 tasks" after one task.add is not backed; a 4-item list is', () => {
    expect(unbackedClaims("I've added 4 tasks to your board.", [{ tool: 'task.add' }]).length).toBe(1);
    expect(unbackedClaims("I've added 4 tasks to your board.", ['task.add', 'task.add', 'task.add', 'task.add'])).toEqual([]);
    expect(unbackedClaims("I've added 4 tasks to your board.", [{ tool: 'todo.create', args: { items: ['a', 'b', 'c', 'd'] } }])).toEqual([]);
    expect(unbackedClaims('I generated 3 images of a fox.', [{ tool: 'image.generate', media: ['a.png'] }]).length).toBe(1);
  });
  test('schedule, delete and install', () => {
    expect(findClaims("I've scheduled a daily check at 9 am.").map((c) => c.kind)).toContain('schedule');
    expect(unbackedClaims("I've scheduled a daily check at 9 am.", ['routine.add'])).toEqual([]);
    expect(findClaims('I deleted the old notes file.').map((c) => c.kind)).toEqual(['delete']);
    expect(unbackedClaims('I deleted the old notes file.', ['files.list']).length).toBe(1);
    expect(unbackedClaims('I removed the routine “Morning news”.', ['routine.remove'])).toEqual([]);
    expect(findClaims('I installed the Qwen3 8B model for you.').map((c) => c.kind)).toEqual(['install']);
    expect(unbackedClaims('I installed the Qwen3 8B model for you.', ['files.write']).length).toBe(1);
    expect(findClaims("I can't delete files, but I can add a task.")).toEqual([]);
    expect(findClaims('Would you like me to install it?')).toEqual([]);
  });
});

describe('#9 emptying a file is destructive', () => {
  test('a line break inside a path is refused', () => {
    const d = tmp('ctl');
    expect('error' in resolveInFolders([d], 'notes\n.txt', true)).toBe(true);
    expect('path' in resolveInFolders([d], '  notes.txt \n', true)).toBe(true);
  });
  test('overwrite with whitespace or an edit that leaves nothing → destructive', () => {
    const d = tmp('wipe');
    writeFileSync(join(d, 'groceries.txt'), 'milk\neggs\n');
    expect(filesWrite.destructive!({ path: 'groceries.txt', content: '   \n', mode: 'overwrite' }, { folders: [d] })).toContain('empties groceries.txt');
    expect(filesWrite.destructive!({ path: 'groceries.txt', content: 'bread', mode: 'overwrite' }, { folders: [d] })).toBeNull();
    expect(filesWrite.destructive!({ path: 'new.txt', content: '', mode: 'overwrite' }, { folders: [d] })).toBeNull();
    expect(filesEdit.destructive!({ path: 'groceries.txt', find: 'milk\neggs\n', replace: ' ' }, { folders: [d] })).toContain('empties');
    expect(filesEdit.destructive!({ path: 'groceries.txt', find: 'milk\n', replace: '' }, { folders: [d] })).toBeNull();
  });
  test('the loop asks even in "Never ask", and a No leaves the file alone', async () => {
    __clearCapCache();
    const ol = fakeOllama((ms) => (last(ms, 'tool') ? { content: 'I could not empty it.' } : { calls: [{ name: 'files_write', args: { path: 'groceries.txt', content: ' ', mode: 'overwrite' } }] }));
    stops.push(ol.stop);
    const h = harness(ol.url, { approval: 'auto', approve: () => false });
    writeFileSync(join(h.studio, 'groceries.txt'), 'milk\neggs\n');
    const out = await runAgent(h.req('delete all my files'), h.deps);
    expect(h.asked).toHaveLength(1);
    expect(h.asked[0].ask).toContain('empties groceries.txt');
    expect(out.steps[0].status).toBe('denied');
    expect(readFileSync(join(h.studio, 'groceries.txt'), 'utf8')).toBe('milk\neggs\n');
  });
});

describe('#11 penalties reach the model', () => {
  test('Ollama options carry frequency and presence penalty', async () => {
    __clearCapCache();
    const ol = fakeOllama([{ content: 'Hello.' }]); stops.push(ol.stop);
    const h = harness(ol.url);
    h.deps.llm = { ...h.deps.llm, frequencyPenalty: 0.4, presencePenalty: 0.2 };
    await runAgent(h.req('hi'), h.deps);
    expect(ol.requests[0].body!.options).toMatchObject({ frequency_penalty: 0.4, presence_penalty: 0.2 });
  });
});

describe('#5 Think mode runs on the agent', () => {
  test('analysis (no tools) → tool step → review → final; analysis reaches the system prompt', async () => {
    __clearCapCache();
    const ol = fakeOllama((ms, body) => {
      const u = String(last(ms, 'user')?.content ?? '');
      if (!body.tools?.length && u.includes('analyse the user')) return { content: 'Needs task.add with title Buy milk.' };
      if (!body.tools?.length && u.includes('strict expert reviewer')) return { content: 'NO ISSUES' };
      return last(ms, 'tool') ? { content: 'Added “Buy milk” to your board.' } : { calls: [{ name: 'task_add', args: { title: 'Buy milk' } }] };
    }, { capabilities: ['completion', 'tools', 'thinking'] });
    stops.push(ol.stop);
    const h = harness(ol.url);
    const out = await runAgent(h.req('add buy milk', { think: true }), h.deps);
    expect(out.steps.map((s) => [s.tool, s.status])).toEqual([['task.add', 'done']]);
    expect(out.content).toBe('Added “Buy milk” to your board.');
    expect(ol.requests[0].tools).toBeUndefined();
    expect(ol.requests[0].body!.think).toBe(true); // reasoning on for the analysis
    expect(String(ol.requests[1].messages[0].content)).toContain('Needs task.add with title Buy milk.');
    expect(ol.requests[1].body!.think).toBe(false); // tool turns stay quick
    expect(ol.requests.at(-1)!.tools).toBeUndefined(); // the review
    const thought = h.events.filter((e) => e.kind === 'thinking').map((e) => (e as { text: string }).text).join('');
    expect(thought).toContain('### Analysis');
    expect(thought).toContain('### Review');
    expect(JSON.parse(kvGet(h.db, TASKS_KEY)!)[0].title).toBe('Buy milk');
  });
  test('a review that finds a problem gets one more go', async () => {
    __clearCapCache();
    let reviews = 0;
    const ol = fakeOllama((ms, body) => {
      const u = String(last(ms, 'user')?.content ?? '');
      if (!body.tools?.length && u.includes('analyse the user')) return { content: 'Two tasks: milk and eggs.' };
      if (!body.tools?.length && u.includes('strict expert reviewer')) { reviews++; return { content: 'The user also asked for eggs; it was not added.' }; }
      if (ms[ms.length - 1].role === 'tool') return { content: 'Added both to your board.' };
      if (u.includes('A review of your answer found')) return { calls: [{ name: 'task_add', args: { title: 'Eggs' } }] };
      return { calls: [{ name: 'task_add', args: { title: 'Milk' } }] };
    });
    stops.push(ol.stop);
    const h = harness(ol.url);
    const out = await runAgent(h.req('add milk and eggs', { think: true }), h.deps);
    expect(reviews).toBe(1);
    expect(out.steps.map((s) => s.args.title)).toEqual(['Milk', 'Eggs']);
    expect(h.events.some((e) => e.kind === 'reset')).toBe(true);
  });
  test('helpers', () => {
    expect(isNoIssues('NO ISSUES')).toBe(true);
    expect(isNoIssues('**NO ISSUES**')).toBe(true);
    expect(isNoIssues('One issue: …')).toBe(false);
    expect(stepsDigest([{ tool: 'task.add', status: 'done', detail: 'Added “x”' }])).toBe('- task.add: done — Added “x”');
  });
});

describe('#12 unattended runs say when nobody answered', () => {
  test('approval timeout → denied with a plain reason, and the model is told', async () => {
    __clearCapCache();
    const ol = fakeOllama((ms) => (last(ms, 'tool') ? { content: 'It is waiting for your permission.' } : { calls: [{ name: 'files_write', args: { path: 'a.txt', content: 'x' } }] }));
    stops.push(ol.stop);
    const h = harness(ol.url, { approve: () => 'timeout' });
    const out = await runAgent(h.req('write a.txt'), h.deps);
    expect(out.steps[0].status).toBe('denied');
    expect(out.steps[0].detail).toBe(`No answer within ${APPROVAL_WAIT_MS.value / 60_000} minutes, so Lotus didn't do it`);
    expect(String(ol.requests[1].messages.find((m) => m.role === 'tool')?.content)).toContain('Nobody answered');
  });
  test('ask.user: no answer in time is not the same as an empty answer', async () => {
    const r = await askUser.run({ question: 'Which?' }, { ask: async () => null } as never);
    expect(r.summary).toBe('No answer within 30 minutes');
    const r2 = await askUser.run({ question: 'Which?' }, { ask: async () => 'B' } as never);
    expect(r2.text).toBe('The user answered: B');
  });
  test('interactive approvals wait past the old 15 minutes; unattended ones give up', async () => {
    __clearCapCache();
    const saved = APPROVAL_WAIT_MS.value;
    APPROVAL_WAIT_MS.value = 150;
    try {
      const ol = fakeOllama((ms) => (last(ms, 'tool') ? { content: 'Done.' } : { calls: [{ name: 'files_write', args: { path: 'b.txt', content: 'x' } }] }));
      stops.push(ol.stop);
      const db = openDb(tmp('svc'));
      const studio = tmp('svc-studio');
      kvApply(db, { set: { 'lotus.settings.v1': JSON.stringify({ llmBackend: 'ollama', imageEngine: 'comfyui' }), 'lotus.engineUrls.v1': JSON.stringify({ ollama: ol.url }) }, remove: [] });
      const events: Record<string, unknown>[] = [];
      const svc = new AgentService({ db, studio, broadcast: (e) => events.push(e) });
      const ended = (id: string) => new Promise<void>((r) => { const t = setInterval(() => { if (events.some((e) => e.runId === id && (e.kind === 'done' || e.kind === 'error'))) { clearInterval(t); r(); } }, 20); });

      const a = svc.start({ model: 'fake', prompt: 'x', messages: [{ role: 'user', content: 'write b.txt' }], unattended: true, capabilities: ['tools'] });
      await ended(a.runId);
      const stepA = events.filter((e) => e.runId === a.runId && e.kind === 'step').map((e) => e.step as Step).at(-1)!;
      expect(stepA.status).toBe('denied');
      expect(stepA.detail).toContain('No answer within');

      const b = svc.start({ model: 'fake', prompt: 'x', messages: [{ role: 'user', content: 'write b.txt' }], capabilities: ['tools'] });
      await Bun.sleep(500); // longer than the unattended limit
      const waiting = events.filter((e) => e.runId === b.runId && e.kind === 'step').map((e) => e.step as Step).at(-1)!;
      expect(waiting.status).toBe('waiting');
      expect(svc.decide(b.runId, waiting.id, true)).toBe(true);
      await ended(b.runId);
      expect(readFileSync(join(studio, 'b.txt'), 'utf8')).toBe('x');
    } finally { APPROVAL_WAIT_MS.value = saved; }
  });
});

describe('#7 your own OpenAI-compatible server', () => {
  test('access key, native tools, and a fall back to tags when tools are refused', async () => {
    const seen: { auth: string | null; tools: boolean }[] = [];
    let refuse = false;
    const server = Bun.serve({
      port: 0, hostname: '127.0.0.1',
      async fetch(req) {
        if (req.headers.get('authorization') !== 'Bearer sk-local') return new Response('{"error":"unauthorized"}', { status: 401 });
        const body = await req.json() as { tools?: unknown[]; messages: { role: string; content: string }[] };
        seen.push({ auth: req.headers.get('authorization'), tools: !!body.tools?.length });
        if (refuse && body.tools?.length) return new Response('{"error":{"message":"tools param requires --jinja flag"}}', { status: 500 });
        const lastMsg = body.messages[body.messages.length - 1];
        const sse = (d: unknown) => `data: ${JSON.stringify(d)}\n\n`;
        let out: string;
        if (lastMsg.role === 'tool' || /Tool result/.test(lastMsg.content)) out = sse({ choices: [{ delta: { content: 'Added it.' } }] });
        else if (body.tools?.length) out = sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'task_add', arguments: '{"title":"Milk"}' } }] } }] });
        else out = sse({ choices: [{ delta: { content: '<tool name="task.add">{"title": "Milk"}</tool>' } }] });
        return new Response(`${out}data: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
      },
    });
    stops.push(() => server.stop(true));
    const url = `http://127.0.0.1:${server.port}`;
    const h = harness(url, { backend: 'llamacpp', nativeTools: true, auth: 'Bearer sk-local' });
    const out = await runAgent(h.req('add milk'), h.deps);
    expect(out.mode).toBe('native');
    expect(out.steps.map((s) => s.status)).toEqual(['done']);
    expect(seen.every((x) => x.auth === 'Bearer sk-local')).toBe(true);

    refuse = true;
    const h2 = harness(url, { backend: 'llamacpp', nativeTools: true, auth: 'Bearer sk-local' });
    const out2 = await runAgent(h2.req('add milk'), h2.deps);
    expect(out2.mode).toBe('tags');
    expect(out2.steps.map((s) => s.status)).toEqual(['done']);

    const h3 = harness(url, { backend: 'llamacpp', nativeTools: true });
    await expect(runAgent(h3.req('add milk'), h3.deps)).rejects.toThrow('access key');
  });
});

describe('#13 ComfyUI on its other port', () => {
  test('8188 ↔ 8000 on this computer only', () => {
    expect(comfyAlternate('http://127.0.0.1:8188')).toBe('http://127.0.0.1:8000');
    expect(comfyAlternate('http://127.0.0.1:8000')).toBe('http://127.0.0.1:8188');
    expect(comfyAlternate('http://localhost:8188')).toBe('http://localhost:8000');
    expect(comfyAlternate('http://192.168.1.20:8188')).toBeNull();
    expect(comfyAlternate('http://127.0.0.1:9000')).toBeNull();
    expect(comfyAlternate('https://127.0.0.1:8188')).toBeNull();
  });
});
