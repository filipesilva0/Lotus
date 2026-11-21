// 0.19 critique, the smaller bugs: wrong skill picked, "Stopped." with no reason, doubled ComfyUI
// folders, task delete without Undo, "Run with Lotus" for your own tasks, the Activity Type column and
// markdown titles, "1 items", and Undo for list deletes.

import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db';
import * as mem from '../src/memory';
import { skillFits, subjectWords } from '../../src/memory/skillMatch';
import { historyContent, interruptedNote, stoppedNote, type ReplyState } from '../../src/work/interrupted';
import { count, noun, pluralOf } from '../../src/lib/plural';
import { newTask, removeTask, restoreTask, runAction, snapshotTask, type Task } from '../../src/tasks/kanban';
import { runSourceLabel } from '../../src/tasks/activity';
import { plainLine } from '../../src/lib/plainText';
import { putBack, takeOut } from '../../src/lib/undoList';
import { folderPath, modelsRoot } from '../../src/models/comfyPaths';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), `lotus-${p}-`));

describe('skill matching (#6)', () => {
  const email = { name: 'Draft a difficult email', description: 'Write a tactful email that says no or delivers bad news', whenToUse: 'The user asks for help writing a hard message to a colleague or client' };
  const agenda = { name: 'Plan the week', description: 'Turn tasks and meetings into a weekly agenda', whenToUse: 'The user wants a plan or agenda for the week' };

  test('an agenda question does not pick the email skill', () => {
    expect(skillFits('What is on my agenda today? Can you help me write down the plan?', email)).toBe(false);
    expect(skillFits('hello! how are ya? whats your name?', email)).toBe(false);
  });
  test('a request about the skill\'s subject still picks it', () => {
    expect(skillFits('Help me write an email to a client telling them the project is late', email)).toBe(true);
    expect(skillFits('make an agenda for my week', agenda)).toBe(true);
    expect(skillFits('email', email)).toBe(true); // a short request naming the skill
  });
  test('stems and stop words', () => {
    expect(subjectWords('Emails emailing the email')).toEqual(['email']);
    expect(subjectWords('help me with this today')).toEqual([]);
  });
  test('the core search drops a skill that shares only one word', () => {
    const db = openDb(tmp('sk'));
    const base = { tags: [], version: 1, uses: 0, wins: 0, enabled: true, origin: 'auto', created: 1, updated: 1 };
    mem.putSkill(db, { id: 'e', body: '1. be kind', ...base, ...email });
    mem.putSkill(db, { id: 'a', body: '1. list meetings', ...base, ...agenda });
    expect(mem.searchSkills(db, 'What is on my agenda for this week?')).toEqual(['a']);
    expect(mem.searchSkills(db, 'Can you help me write a quick message?')).toEqual([]);
    expect(mem.searchSkills(db, 'write a difficult email to my client')).toEqual(['e']);
    db.sql.close();
  });
});

describe('Work: a stopped or cut-off reply says why (#8)', () => {
  const steps = [
    { status: 'done' as const, tool: 'plan.set', label: 'Plan' },
    { status: 'done' as const, tool: 'web.search', label: 'Searched the web', detail: '5 results' },
    { status: 'done' as const, tool: 'files.write', label: 'Saved notes.md' },
  ];
  const stopped: ReplyState = { role: 'assistant', content: '', stopped: true, steps };
  test('the note names who stopped it and what was done', () => {
    const n = stoppedNote(stopped);
    expect(n).toContain('You stopped this reply.');
    expect(n).toContain('2 steps had finished.');
    expect(n).toContain('keep going');
    expect(stoppedNote({ role: 'assistant', content: '', stopped: true })).toContain('Nothing had been done yet.');
  });
  test('the interrupted banner only promises saved files when there are some', () => {
    const r: ReplyState = { role: 'assistant', content: '', interrupted: true, agents: [{ status: 'done' }, { status: 'stopped' }] };
    expect(interruptedNote(r, 0)).toContain('It had not saved any files yet.');
    expect(interruptedNote(r, 0)).toContain('1 of 2 agents had finished.');
    expect(interruptedNote(r, 2)).toContain('The 2 files it saved are kept');
  });
  test('"keep going" sees what the stopped reply had done', () => {
    const h = historyContent(stopped);
    expect(h).toContain('The user stopped this reply');
    expect(h).toContain('Searched the web: 5 results');
    expect(h).not.toContain('Plan');
    const cut = historyContent({ role: 'assistant', content: '', interrupted: true, agents: [{ status: 'done', name: 'Scout', result: 'Found 3 keyboards' }] });
    expect(cut).toContain('Lotus closed before this reply finished');
    expect(cut).toContain('Scout: done (Found 3 keyboards)');
    // Normal replies and requests are unchanged; an empty reply that just ended adds nothing.
    expect(historyContent({ role: 'assistant', content: 'Hi' })).toBe('Hi');
    expect(historyContent({ role: 'user', content: 'keep going' })).toBe('keep going');
    expect(historyContent({ role: 'assistant', content: '' })).toBe('');
  });
});

describe('pluralization (#18)', () => {
  test('one and many', () => {
    expect(count(1, 'microphone')).toBe('1 microphone');
    expect(count(2, 'microphone')).toBe('2 microphones');
    expect(count(1, 'memory')).toBe('1 memory');
    expect(count(3, 'memory')).toBe('3 memories');
    expect(count(1, 'item')).toBe('1 item');
    expect(count(0, 'item')).toBe('0 items');
    expect(pluralOf('search')).toBe('searches');
    expect(pluralOf('day')).toBe('days');
    expect(noun(1, 'person')).toBe('person');
    expect(noun(4, 'person')).toBe('people');
  });
});

describe('tasks (#14, #15)', () => {
  const mk = (id: string, p: Partial<Task> = {}) => ({ ...newTask(id, { title: id, ...p }, []), ...p });
  test('delete then Undo puts the task back with the links other tasks had to it', () => {
    const a = mk('a', { links: [{ type: 'blocks', to: 'b' }] });
    const b = mk('b', { status: 'doing' });
    const c = mk('c', { links: [{ type: 'relates', to: 'b' }] });
    const all = [a, b, c];
    const snap = snapshotTask(all, 'b')!;
    const after = removeTask(all, 'b');
    expect(after.find((t) => t.id === 'a')!.links).toEqual([]);
    const back = restoreTask(after, snap);
    expect(back.find((t) => t.id === 'b')!.status).toBe('doing');
    expect(back.find((t) => t.id === 'a')!.links).toEqual([{ type: 'blocks', to: 'b' }]);
    expect(back.find((t) => t.id === 'c')!.links).toEqual([{ type: 'relates', to: 'b' }]);
    expect(restoreTask(back, snap)).toBe(back); // twice is a no-op
  });
  test('a restored task does not come back running', () => {
    const t = mk('r', { run: { state: 'running', jobId: 'j' } } as Partial<Task>);
    const back = restoreTask([], { task: t, inbound: [] });
    expect(back[0].run).toBeUndefined();
  });
  test('no run button for a task assigned to you', () => {
    expect(runAction({ assignee: 'me' })).toBeNull();
    expect(runAction({ assignee: 'lotus' })).toBe('run');
    expect(runAction({ assignee: 'me', run: { state: 'running', jobId: 'j' } } as Pick<Task, 'assignee' | 'run'>)).toBe('stop');
    expect(runAction({ assignee: 'me', run: { state: 'failed', jobId: 'j' } } as Pick<Task, 'assignee' | 'run'>)).toBe('retry');
  });
});

describe('Activity (#16)', () => {
  test('older runs show where they came from, not "Earlier"', () => {
    expect(runSourceLabel({ source: 'work', chatId: null, ref: null })).toBe('Work');
    expect(runSourceLabel({ source: null, chatId: 'chat-123', ref: null })).toBe('Chat');
    expect(runSourceLabel({ source: null, chatId: null, ref: 'task-abc' })).toBe('Task');
    expect(runSourceLabel({ source: null, chatId: null, ref: 'rt-abc' })).toBe('Routine');
    expect(runSourceLabel({ source: null, chatId: null, ref: null })).toBe('Agent');
  });
  test('titles lose their markdown', () => {
    expect(plainLine('**Plan my week** and _soon_')).toBe('Plan my week and soon');
    expect(plainLine('## Read [the docs](https://x.y) `now`')).toBe('Read the docs now');
    expect(plainLine('- [ ] buy milk')).toBe('buy milk');
    expect(plainLine('a*b*c stays')).toBe('a*b*c stays');
    expect(plainLine('x'.repeat(10), 5)).toBe('xxxx…');
  });
});

describe('Undo for list deletes', () => {
  test('an item goes back where it was', () => {
    const l = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const { rest, item, index } = takeOut(l, 'b');
    expect(rest.map((x) => x.id)).toEqual(['a', 'c']);
    expect(putBack(rest, item!, index).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(putBack(l, item!, index)).toBe(l);
    expect(takeOut(l, 'zz').item).toBeNull();
  });
});

describe('ComfyUI folders (#9)', () => {
  test('picking models\\checkpoints is read as the models folder', () => {
    expect(modelsRoot('C:\\ComfyUI\\models\\checkpoints')).toBe('C:\\ComfyUI\\models');
    expect(modelsRoot('C:\\ComfyUI\\models\\loras\\')).toBe('C:\\ComfyUI\\models');
    expect(modelsRoot('/home/me/ComfyUI/models')).toBe('/home/me/ComfyUI/models');
    expect(modelsRoot('C:\\Checkpoints')).toBe('C:\\Checkpoints'); // a folder right on a drive stays as it is
  });
  test('no more checkpoints\\checkpoints', () => {
    expect(folderPath('C:\\ComfyUI\\models\\checkpoints', 'checkpoints')).toBe('C:\\ComfyUI\\models\\checkpoints');
    expect(folderPath('C:\\ComfyUI\\models\\checkpoints', 'loras')).toBe('C:\\ComfyUI\\models\\loras');
    expect(folderPath('/m/models/', 'vae')).toBe('/m/models/vae');
  });
});

describe('the core says why a run ended (#8)', () => {
  test('an engine request cut off without Stop is an error with a reason, not a silent "Stopped"', async () => {
    const { kvApply } = await import('../src/kv');
    const { AgentService, ENGINE_CUT_OFF, STOPPED_BY_YOU } = await import('../src/agent/service');
    const { getRun } = await import('../src/agent/runs');
    const db = openDb(tmp('cut'));
    kvApply(db, { set: { 'lotus.engineUrls.v1': JSON.stringify({ ollama: 'http://127.0.0.1:9' }), 'lotus.settings.v1': JSON.stringify({ llmBackend: 'ollama' }) }, remove: [] });
    const events: Record<string, unknown>[] = [];
    // The engine went away mid-request: every call ends in an AbortError the user didn't cause.
    const cut = (async () => { throw new DOMException('The operation was aborted.', 'AbortError'); }) as unknown as typeof fetch;
    const svc = new AgentService({ db, studio: tmp('cut-s'), broadcast: (e) => events.push(e), fetch: cut });
    const { runId } = svc.start({ model: 'fake', prompt: 'x', messages: [{ role: 'user', content: 'x' }] });
    for (let i = 0; i < 300 && !events.some((e) => e.kind === 'done' || e.kind === 'error'); i++) await Bun.sleep(10);
    const end = events.find((e) => e.kind === 'done' || e.kind === 'error')!;
    expect(end.kind).toBe('error');
    expect(end.message).toBe(ENGINE_CUT_OFF);
    expect(getRun(db, runId)!.status).toBe('error');
    expect(STOPPED_BY_YOU).toContain('You stopped');
    db.sql.close();
  });
});
