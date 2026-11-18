// Roadmap phase 2 (17 Nov 2026): one agent everywhere — Always allow, run history, tasks and
// routines as tables, the scheduler in the core.

import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db';
import { kvApply, kvGet } from '../src/kv';
import { alwaysRuleFor, decide, parseRules } from '../src/agent/policy';
import { __clearCapCache } from '../src/agent/llm';
import { AgentService, ALLOW_KEY, readAllowRules } from '../src/agent/service';
import type { Step } from '../src/agent/types';
import { fakeOllama, last } from './fakes';

const dirs: string[] = [];
const stops: (() => void)[] = [];
export const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), `lotus-p2-${p}-`)); dirs.push(d); return d; };
afterAll(() => { stops.forEach((s) => s()); dirs.forEach((d) => { try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows */ } }); });

describe('Always allow: the rule', () => {
  test('a file → its folder; a URL → its site; no file or site → the tool', () => {
    expect(alwaysRuleFor('files.write', { path: 'C:\\Users\\Filipe\\Documents\\Notes\\a.md' })).toBe('files.write:C:/Users/Filipe/Documents/Notes/*');
    expect(alwaysRuleFor('files.write', { path: '/home/f/notes/a.md' })).toBe('files.write:/home/f/notes/*');
    expect(alwaysRuleFor('web.read', { url: 'https://en.wikipedia.org/wiki/Lotus' })).toBe('web.read:https://en.wikipedia.org/*');
    expect(alwaysRuleFor('computer.click', { x: 1, y: 2 })).toBe('computer.click');
    expect(alwaysRuleFor('files.write', { path: 'a.md' })).toBeNull(); // no folder to scope to
    expect(alwaysRuleFor('files.write', { path: '/x/*.md' })).toBeNull();
    expect(alwaysRuleFor('web.read', { url: 'file:///etc/passwd' })).toBeNull();
  });
  test('it covers the folder and below, not a sibling; deny rules still win', () => {
    const allow = parseRules(['files.write:C:/Notes/*']);
    const tool = { name: 'files.write', risk: 'risky' as const };
    expect(decide(tool, { path: 'C:\\Notes\\a.md' }, 'risky', [], allow).decision).toBe('allow');
    expect(decide(tool, { path: 'C:\\Notes\\sub\\b.md' }, 'ask', [], allow).decision).toBe('allow');
    expect(decide(tool, { path: 'C:\\Notes2\\a.md' }, 'risky', [], allow).decision).toBe('ask');
    expect(decide(tool, { path: 'C:\\Notes\\run.bat' }, 'risky', parseRules(['files.write:*.bat']), allow).decision).toBe('deny');
  });
});

describe('Always allow: the service', () => {
  test('saves the rule, lets the run go on, and the next write in that folder does not ask', async () => {
    __clearCapCache();
    const studio = tmp('studio');
    mkdirSync(join(studio, 'Notes'), { recursive: true });
    let n = 0;
    const ol = fakeOllama((ms) => (last(ms, 'tool') ? { content: 'Done.' } : { calls: [{ name: 'files_write', args: { path: join(studio, 'Notes', `n${++n}.txt`), content: 'x' } }] }));
    stops.push(ol.stop);
    const db = openDb(tmp('db'));
    kvApply(db, { set: { 'lotus.settings.v1': JSON.stringify({ llmBackend: 'ollama', imageEngine: 'comfyui' }), 'lotus.engineUrls.v1': JSON.stringify({ ollama: ol.url }) }, remove: [] });
    const events: Record<string, unknown>[] = [];
    const svc = new AgentService({ db, studio, broadcast: (e) => events.push(e) });
    const ended = (id: string) => new Promise<void>((r) => { const t = setInterval(() => { if (events.some((e) => e.runId === id && (e.kind === 'done' || e.kind === 'error'))) { clearInterval(t); r(); } }, 20); });
    const stepsOf = (id: string) => events.filter((e) => e.runId === id && e.kind === 'step').map((e) => e.step as Step);

    const a = svc.start({ model: 'fake', prompt: 'x', messages: [{ role: 'user', content: 'write a note' }], capabilities: ['tools'] });
    let waiting: Step | undefined;
    for (let i = 0; i < 100 && !waiting; i++) { await Bun.sleep(20); waiting = stepsOf(a.runId).find((s) => s.status === 'waiting'); }
    expect(waiting?.always).toBe(`files.write:${join(studio, 'Notes').replace(/\\/g, '/')}/*`);
    expect(svc.decide(a.runId, waiting!.id, true, true)).toBe(true);
    await ended(a.runId);
    expect(existsSync(join(studio, 'Notes', 'n1.txt'))).toBe(true);
    expect(readAllowRules(db)).toEqual([waiting!.always!]);
    expect(events.some((e) => e.type === 'kv' && (e.set as Record<string, string>)[ALLOW_KEY])).toBe(true);

    const b = svc.start({ model: 'fake', prompt: 'x', messages: [{ role: 'user', content: 'another note' }], capabilities: ['tools'] });
    await ended(b.runId);
    expect(stepsOf(b.runId).some((s) => s.status === 'waiting')).toBe(false);
    expect(existsSync(join(studio, 'Notes', 'n2.txt'))).toBe(true);

    // Saving the same rule twice keeps one copy; removing it in Settings makes Lotus ask again.
    svc.addAllowRule(waiting!.always!);
    expect(readAllowRules(db).length).toBe(1);
    kvApply(db, { set: { [ALLOW_KEY]: '[]' }, remove: [] });
    const c = svc.start({ model: 'fake', prompt: 'x', messages: [{ role: 'user', content: 'third' }], capabilities: ['tools'] });
    let w3: Step | undefined;
    for (let i = 0; i < 100 && !w3; i++) { await Bun.sleep(20); w3 = stepsOf(c.runId).find((s) => s.status === 'waiting'); }
    expect(w3).toBeDefined();
    svc.decide(c.runId, w3!.id, false);
    await ended(c.runId);
    expect(kvGet(db, ALLOW_KEY)).toBe('[]');
  });
});

// ── board, scheduler, runner, history ───────────────────────────────────────

import { listRoutines, listTasks, OLD_ROUTINES_KEY, OLD_TASKS_KEY } from '../src/board';
import { BoardService, boardRpc, parsePlan } from '../src/scheduler';
import { listRuns } from '../src/agent/runs';
import { Database } from 'bun:sqlite';

function boardHarness(respond: Parameters<typeof fakeOllama>[0], kvPre: Record<string, string> = {}) {
  __clearCapCache();
  const ol = fakeOllama(respond);
  stops.push(ol.stop);
  const dir = tmp('board');
  // An older lotus.db (schema 2) with the board in kv, to check the one-time import.
  if (Object.keys(kvPre).length) {
    const old = new Database(join(dir, 'lotus.db'), { create: true });
    old.run('CREATE TABLE kv(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated INTEGER NOT NULL)');
    for (const [k, v] of Object.entries(kvPre)) old.query('INSERT INTO kv VALUES (?, ?, 0)').run(k, v);
    old.run('PRAGMA user_version = 1');
    old.close();
  }
  const db = openDb(dir);
  const studio = tmp('board-studio');
  kvApply(db, { set: { 'lotus.settings.v1': JSON.stringify({ llmBackend: 'ollama', imageEngine: 'comfyui', selectedModel: 'fake' }), 'lotus.engineUrls.v1': JSON.stringify({ ollama: ol.url }) }, remove: [] });
  const events: Record<string, unknown>[] = [];
  const agent = new AgentService({ db, studio, broadcast: (e) => events.push(e) });
  const board = new BoardService({ db, agent, broadcast: (e) => events.push(e) });
  agent.board = board;
  const until = async (ok: () => boolean, ms = 4000) => { for (let i = 0; i < ms / 20 && !ok(); i++) await Bun.sleep(20); return ok(); };
  return { db, studio, events, agent, board, ol, until };
}

describe('board tables', () => {
  test('the old kv board is imported once; a run that was going is marked failed', () => {
    const t = { id: 'task-a', title: 'Old task', description: '', status: 'doing', assignee: 'lotus', priority: 'high', labels: [], steps: [], links: [], order: 0, created: 1, updated: 2, log: [], run: { state: 'running', jobId: 'j' } };
    const r = { id: 'rt-a', name: 'Morning', prompt: 'news', schedule: '0 8 * * *', enabled: true, action: 'log', web: false, catchUp: false, runs: [{ at: 5, ok: true, output: 'hi', ms: 3 }, { at: 4, ok: false, output: 'no', ms: 1 }], created: 1 };
    const h = boardHarness([{ content: 'x' }], { [OLD_TASKS_KEY]: JSON.stringify([t]), [OLD_ROUTINES_KEY]: JSON.stringify([r]) });
    const tasks = listTasks(h.db);
    expect(tasks.map((x) => [x.id, x.title, x.priority, x.run?.state])).toEqual([['task-a', 'Old task', 'high', 'failed']]);
    const rs = listRoutines(h.db);
    expect(rs[0].name).toBe('Morning');
    expect(rs[0].runs.map((x) => x.output)).toEqual(['hi', 'no']); // newest first
    expect(kvGet(h.db, OLD_TASKS_KEY)).toContain('Old task'); // left for an older Lotus
  });

  test('add, move with the Kanban rules, link, remove; every change is broadcast', () => {
    const h = boardHarness([{ content: 'x' }]);
    const a = h.board.addTask({ title: 'A', status: 'todo' });
    const b = h.board.addTask({ title: 'B', status: 'todo' });
    expect(h.board.linkTask(a.id, 'blocks', b.id)).toBeNull();
    expect(h.board.moveTask(b.id, 'doing')).toContain('waiting for “A”');
    expect(h.board.linkTask(b.id, 'blocks', a.id)).toContain('loop');
    expect(h.board.moveTask(a.id, 'done')).toBeNull();
    expect(h.board.moveTask(b.id, 'doing')).toBeNull();
    h.board.removeTask(a.id);
    expect(listTasks(h.db).map((t) => t.title)).toEqual(['B']);
    expect(h.events.filter((e) => e.type === 'board' && e.tasks).length).toBeGreaterThan(4);
    expect(boardRpc(h.board, 'task_move', { id: 'nope', status: 'done' }).value).toEqual({ ok: true });
    expect(boardRpc(h.board, 'nothing', {}).found).toBe(false);
  });

  test('the agent\'s task.add writes to the table', async () => {
    const h = boardHarness((ms) => (last(ms, 'tool') ? { content: 'Added.' } : { calls: [{ name: 'task_add', args: { title: 'Buy milk' } }] }));
    await h.agent.runToEnd({ model: 'fake', prompt: 'x', messages: [{ role: 'user', content: 'add a task' }], capabilities: ['tools'] });
    expect(listTasks(h.db).map((t) => t.title)).toEqual(['Buy milk']);
    expect(kvGet(h.db, OLD_TASKS_KEY)).toBeNull();
  });
});

describe('task runner in the core', () => {
  test('plans, does each step as an agent run with tools, writes up, and lands in Review; runs are in the history as "task"', async () => {
    const h = boardHarness((ms) => {
      const u = last(ms, 'user')?.content ?? '';
      if (u.includes('Reply with JSON only')) return { content: '{"steps": ["Write the note", "Check it"]}' };
      if (u.includes('Now do step 1')) return last(ms, 'tool') ? { content: 'Wrote it.' } : { calls: [{ name: 'files_write', args: { path: 'note.md', content: 'hello' } }] };
      if (u.includes('Now do step 2')) return { content: 'It reads hello.' };
      return { content: 'All done: note.md says hello.' };
    });
    kvApply(h.db, { set: { 'lotus.settings.v1': JSON.stringify({ llmBackend: 'ollama', imageEngine: 'comfyui', selectedModel: 'fake', agentApproval: 'auto' }) }, remove: [] });
    const t = h.board.addTask({ title: 'Make a note', assignee: 'lotus', status: 'todo' });
    h.board.autoRun();
    expect(await h.until(() => listTasks(h.db)[0].status === 'review')).toBe(true);
    const done = listTasks(h.db)[0];
    expect(done.steps.map((s) => [s.text, s.done])).toEqual([['Write the note', true], ['Check it', true]]);
    expect(done.result).toBe('All done: note.md says hello.');
    expect(done.run?.state).toBe('done');
    expect(done.log.some((l) => l.text.startsWith('Saving a file') || l.text.includes('note.md'))).toBe(true);
    const runs = listRuns(h.db, 50, { ref: t.id });
    expect(runs.length).toBe(4); // plan, two steps, write-up
    expect(runs.every((r) => r.source === 'task')).toBe(true);
    expect(runs.find((r) => r.prompt === 'Write the note')?.steps).toBe(1);
    expect(listRuns(h.db, 50, { source: 'chat' }).length).toBe(0);
    expect(listRuns(h.db, 50, { query: 'Check it' }).length).toBe(2); // the step's request and the plan's reply
  });

  test('approvals wait unattended; stopping a running task marks it stopped', async () => {
    const h = boardHarness((ms) => {
      const u = last(ms, 'user')?.content ?? '';
      if (u.includes('Now do step')) return { calls: [{ name: 'files_write', args: { path: 'x.md', content: 'x' } }] };
      return { content: 'unused' };
    });
    const t = h.board.addTask({ title: 'Write x', steps: [{ id: 's1', text: 'Write x.md', done: false }] });
    expect(boardRpc(h.board, 'task_run', { id: t.id }).value).toEqual({ ok: true });
    expect(await h.until(() => listTasks(h.db)[0].log.some((l) => l.text.startsWith('Waiting for your permission')))).toBe(true);
    h.board.stopTask(t.id);
    expect(await h.until(() => listTasks(h.db)[0].run?.state === 'failed')).toBe(true);
    expect(listTasks(h.db)[0].run?.error).toBe('Stopped');
  });

  test('no model: the task fails with a plain reason', async () => {
    const h = boardHarness([{ content: 'x' }]);
    kvApply(h.db, { set: { 'lotus.settings.v1': JSON.stringify({ llmBackend: 'ollama' }) }, remove: [] });
    h.board.addTask({ title: 'T', assignee: 'lotus', status: 'todo' });
    h.board.autoRun();
    expect(await h.until(() => listTasks(h.db)[0].run?.state === 'failed')).toBe(true);
    expect(listTasks(h.db)[0].run?.error).toContain('No model selected');
  });

  test('parsePlan reads JSON or a list', () => {
    expect(parsePlan('Sure: {"steps": ["one step", "two step"]}')).toEqual(['one step', 'two step']);
    expect(parsePlan('1. first thing\n2. second thing')).toEqual(['first thing', 'second thing']);
  });
});

describe('routines in the core', () => {
  test('a due routine runs on a tick, posts a card, keeps its run with the run id', async () => {
    const h = boardHarness([{ content: 'Sunny, 21°C.' }]);
    const r = h.board.addRoutine({ name: 'Weather', prompt: 'weather today', schedule: '0 8 * * *', action: 'card' });
    expect(typeof r).not.toBe('string');
    const id = (r as { id: string }).id;
    h.board.setRoutines(h.board.routines().map((x) => ({ ...x, nextRun: Date.now() - 1000 })));
    expect(h.board.due(Date.now()).map((x) => x.id)).toEqual([id]);
    h.board.tick();
    expect(h.board.due(Date.now())).toEqual([]); // running: not due twice
    expect(await h.until(() => (listRoutines(h.db)[0]?.runs.length ?? 0) > 0)).toBe(true);
    const run = listRoutines(h.db)[0].runs[0];
    expect(run.ok).toBe(true);
    expect(run.output).toBe('Sunny, 21°C.');
    expect(listTasks(h.db).map((t) => [t.status, t.description])).toEqual([['review', 'Sunny, 21°C.']]);
    expect(listRuns(h.db, 5, { source: 'routine', ref: id })[0].id).toBe(run.runId!);
    expect(listRoutines(h.db)[0].nextRun!).toBeGreaterThan(Date.now());
  });

  test('"task" routines add a task for Lotus; bad schedules are refused; removing deletes the history', async () => {
    const h = boardHarness([{ content: 'x' }]);
    expect(h.board.addRoutine({ name: 'Bad', prompt: 'x', schedule: 'often' })).toBeString();
    const r = h.board.addRoutine({ name: 'Inbox', prompt: 'sort my inbox', schedule: '0 9 * * 1', action: 'task' }) as { id: string };
    expect(boardRpc(h.board, 'routine_run', { id: r.id }).value).toEqual({ ok: true });
    expect(await h.until(() => (listRoutines(h.db)[0]?.runs.length ?? 0) > 0)).toBe(true);
    expect(listTasks(h.db).some((t) => t.title === 'Inbox' && t.assignee === 'lotus' && t.source?.routineId === r.id)).toBe(true);
    h.board.removeRoutine(r.id);
    expect(listRoutines(h.db)).toEqual([]);
    expect(h.db.sql.query('SELECT COUNT(*) AS n FROM routine_runs').get()).toEqual({ n: 0 });
  });

  test('start(): a missed run catches up only when asked; config sets model and parallel jobs', async () => {
    const h = boardHarness([{ content: 'caught up' }]);
    h.board.setRoutines([
      { id: 'rt-1', name: 'Catch', prompt: 'p', schedule: '0 8 * * *', enabled: true, action: 'log', web: false, catchUp: true, runs: [], created: 1, nextRun: Date.now() - 60_000 },
      { id: 'rt-2', name: 'Skip', prompt: 'p', schedule: '0 8 * * *', enabled: true, action: 'log', web: false, catchUp: false, runs: [], created: 2, nextRun: Date.now() - 60_000 },
    ]);
    h.board.start();
    try {
      expect(await h.until(() => listRoutines(h.db).find((r) => r.id === 'rt-1')!.runs.length > 0)).toBe(true);
      expect(listRoutines(h.db).find((r) => r.id === 'rt-2')!.runs.length).toBe(0);
      expect(listRoutines(h.db).find((r) => r.id === 'rt-2')!.nextRun!).toBeGreaterThan(Date.now());
    } finally { h.board.stop(); }
    expect(h.board.configure({ model: 'other', limit: 3, numCtx: 8192 })).toEqual({ model: 'other', numCtx: 8192, limit: 3 });
    expect(h.board.configure({ limit: 99 }).limit).toBe(8);
  });
});

// ── 0.14.2: thinking that arrives inside the answer ─────────────────────────

import { ThinkSplit } from '../src/agent/llm';
import { runAgent } from '../src/agent/loop';
import { Registry } from '../src/agent/registry';
import { ALL_TOOLS } from '../src/agent/service';

function split(chunks: string[]) {
  const out = { answer: '', thinking: '', retracted: [] as string[] };
  const s = new ThinkSplit({ token: (t) => { out.answer += t; }, thinking: (t) => { out.thinking += t; }, retract: (was) => { out.retracted.push(was); out.answer = ''; } });
  for (const c of chunks) s.push(c);
  s.end();
  return { ...out, visible: s.visible };
}

describe('thinking inside the answer (0.14.2)', () => {
  test('a <think> block, split across chunks, goes to thinking', () => {
    const r = split(['<thi', 'nk>I should add a ta', 'sk.</thi', 'nk>\n\nDone: I added it.']);
    expect(r.thinking).toBe('I should add a task.');
    expect(r.answer).toBe('Done: I added it.');
    expect(r.visible).toBe('Done: I added it.');
  });
  test('leading spaces before <think>, and no thinking at all', () => {
    expect(split(['  \n<think>x</think>Hi']).answer).toBe('Hi');
    expect(split(['Hel', 'lo <b', '>world</b>']).answer).toBe('Hello <b>world</b>');
    expect(split(['<', 'p>hi</p>']).answer).toBe('<p>hi</p>');
  });
  test('</think> without an opening tag: what was shown becomes thinking', () => {
    const r = split(['The user wants a ', 'note. I will ', 'write it.</think>', 'Saved the note.']);
    expect(r.retracted).toEqual(['The user wants a note. I will ']);
    expect(r.thinking).toBe('The user wants a note. I will write it.');
    expect(r.answer).toBe('Saved the note.');
  });
  test('an unfinished <think> (out of tokens) stays thinking', () => {
    const r = split(['<think>still going']);
    expect(r.thinking).toBe('still going');
    expect(r.answer).toBe('');
  });

  test('in the agent: no thinking in the answer, and no claim-check redo caused by it', async () => {
    __clearCapCache();
    let n = 0;
    const ol = fakeOllama(() => (++n === 1 ? { content: '<think>I added the task already? No, I will just answer.</think>The capital of France is Paris.' } : { content: 'unexpected second turn' }), { capabilities: ['completion'] });
    stops.push(ol.stop);
    const db = openDb(tmp('think-db'));
    const events: { kind: string; text?: string }[] = [];
    const out = await runAgent({ runId: 'r', model: 'm', messages: [{ role: 'user', content: 'Capital of France?' }], tools: ALL_TOOLS.filter((t) => t.name === 'task.add'), approval: 'auto', rules: [] }, {
      llm: { backend: 'ollama', url: ol.url, fetch }, registry: new Registry(ALL_TOOLS),
      ctx: { db, studio: tmp('think-studio'), folders: [], memoryOn: false, fetch, kvSet: () => undefined, kvGet: () => null },
      signal: new AbortController().signal, emit: (e) => events.push(e as never), record: () => undefined, approve: async () => true,
    });
    expect(out.content).toBe('The capital of France is Paris.');
    expect(out.unverified).toEqual([]);
    expect(n).toBe(1); // no second turn
    expect(events.filter((e) => e.kind === 'token').map((e) => e.text).join('')).not.toContain('think');
    expect(events.some((e) => e.kind === 'reset')).toBe(false);
    expect(events.filter((e) => e.kind === 'thinking').map((e) => e.text).join('')).toContain('I added the task already');
  });
});
