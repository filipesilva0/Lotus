// 0.15.1: Work jobs cut off by an app or core restart. The saved reply must not keep saying
// "3 agents working" forever: on startup it is marked interrupted (with Try again), and the core
// closes the run in its own history.

import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db';
import { closeStaleRuns, CUT_OFF_RUN, CUT_OFF_STEP, finishRun, getRun, saveStep, startRun } from '../src/agent/runs';
import { agentsFinishedNote, closeReply, CUT_OFF_STEP as WEB_CUT_OFF_STEP, markInterrupted, wasCutOff, type ReplyState } from '../../src/work/interrupted';

// The shapes of lib/agent.ts AgentStep and HelperInfo (that file needs the browser window).
type AgentStep = NonNullable<ReplyState['steps']>[number] & { id: string; runId: string; tool: string; label: string; args: Record<string, unknown>; started: number };
type HelperInfo = NonNullable<ReplyState['agents']>[number] & { id: string; name: string; goal: string; steps: number; started: number };
type WorkMsg = ReplyState & { id: string; ts: number; steps?: AgentStep[]; agents?: HelperInfo[] };
type WorkItem = { id: string; title: string; ts: number; messages: WorkMsg[] };

const step = (id: string, status: AgentStep['status'], tool = 'web.search'): AgentStep => ({ id, runId: 'run1', tool, label: tool, args: {}, status, started: 1 });
const agent = (id: string, status: HelperInfo['status']): HelperInfo => ({ id, name: `Agent ${id}`, goal: 'find things', status, steps: 2, started: 1, ...(status === 'running' ? { current: 'Searching the web' } : {}) });
const user: WorkMsg = { id: 'u1', role: 'user', content: 'Research three keyboards', ts: 1 };
const reply = (over: Partial<WorkMsg>): WorkMsg => ({ id: 'r1', role: 'assistant', content: '', ts: 2, ...over });
const item = (...messages: WorkMsg[]): WorkItem => ({ id: 'work1', title: 'Keyboards', ts: 1, messages });

describe('Work replies cut off by a restart', () => {
  // The case from the 0.15.0 review: three agents deployed, the app closed, "3 working" forever.
  const stuck = reply({
    runId: 'run1', pending: true,
    steps: [step('s1', 'done', 'plan.set'), step('s2', 'running', 'agents.deploy'), step('s3', 'waiting', 'files.write')],
    agents: [agent('a', 'done'), agent('b', 'running'), agent('c', 'queued')],
  });

  test('a reply still pending is cut off; one that ended or was stopped is not', () => {
    expect(wasCutOff(stuck)).toBe(true);
    expect(wasCutOff(reply({ pending: true, content: 'Half an answer' }))).toBe(true);
    expect(wasCutOff(reply({ ended: 5, content: '' }))).toBe(false);
    expect(wasCutOff(reply({ ended: 5, stopped: true }))).toBe(false);
    expect(wasCutOff(user)).toBe(false);
    expect(wasCutOff(closeReply(stuck))).toBe(false);
  });

  test('replies saved before this fix are judged by what they show', () => {
    expect(wasCutOff(reply({ content: 'Done', steps: [step('s1', 'done')] }))).toBe(false);
    expect(wasCutOff(reply({ content: '', error: 'The model failed' }))).toBe(false);
    expect(wasCutOff(reply({ content: 'Partial', steps: [step('s1', 'running')] }))).toBe(true);
    expect(wasCutOff(reply({ content: 'Partial', agents: [agent('a', 'done'), agent('b', 'running')] }))).toBe(true);
    expect(wasCutOff(reply({ content: '', steps: [] }))).toBe(true);
  });

  test('closing a reply stops its agents and steps, so nothing shows as working', () => {
    const c = closeReply(stuck, 99);
    expect(c.interrupted).toBe(true);
    expect(c.pending).toBeUndefined();
    expect(c.steps!.map((s) => s.status)).toEqual(['done', 'error', 'error']);
    expect(c.steps![1].detail).toBe(WEB_CUT_OFF_STEP);
    expect(c.steps![1].finished).toBe(99);
    expect(c.steps![0].detail).toBeUndefined();
    expect(c.agents!.map((h) => h.status)).toEqual(['done', 'stopped', 'stopped']);
    expect(c.agents![1].current).toBeUndefined();
    const working = (m: WorkMsg) => (m.agents ?? []).filter((h) => h.status === 'running' || h.status === 'queued').length;
    expect(working(stuck)).toBe(2);
    expect(working(c)).toBe(0);
    expect(agentsFinishedNote(c)).toBe('1 of 3 agents had finished.');
    expect(agentsFinishedNote(reply({ agents: [agent('a', 'stopped')] }))).toBe('Its agent had not finished.');
    expect(agentsFinishedNote(reply({}))).toBe('');
  });

  test('startup marks only the cut-off replies and returns their runs to stop', () => {
    const fine = item(user, reply({ id: 'r0', content: 'All done', ended: 3 }));
    const broken = { ...item(user, stuck), id: 'work2' };
    const r = markInterrupted([fine, broken], 50);
    expect(r.runIds).toEqual(['run1']);
    expect(r.items[0]).toBe(fine);
    expect(r.items[1].messages[0]).toBe(user);
    expect(r.items[1].messages[1].interrupted).toBe(true);
    // A second start changes nothing (the same list comes back).
    const again = markInterrupted(r.items, 60);
    expect(again.items).toBe(r.items);
    expect(again.runIds).toEqual([]);
  });

  test('the web side and the core say the same thing about a cut-off step', () => {
    expect(WEB_CUT_OFF_STEP).toBe(CUT_OFF_STEP);
  });
});

describe('core run history after a restart', () => {
  test('running runs and their unfinished steps are closed, finished ones are left alone', () => {
    const db = openDb(mkdtempSync(join(tmpdir(), 'lotus-cutoff-')));
    startRun(db, { id: 'live', model: 'm', prompt: 'deploy agents', source: 'work', ref: 'work1' });
    startRun(db, { id: 'old', model: 'm', prompt: 'earlier job', source: 'work', ref: 'work1' });
    finishRun(db, 'old', { status: 'done', reply: 'All good' });
    const base = { runId: 'live', label: 'x', args: {}, started: 10 };
    saveStep(db, { ...base, id: 'st1', tool: 'plan.set', status: 'done', finished: 11 } as never, 0);
    saveStep(db, { ...base, id: 'st2', tool: 'agents.deploy', status: 'running' } as never, 1);
    saveStep(db, { ...base, id: 'st3', tool: 'files.write', status: 'waiting' } as never, 2);

    expect(closeStaleRuns(db)).toBe(1);
    const live = getRun(db, 'live')!;
    expect(live.status).toBe('stopped');
    expect(live.reply).toBe(CUT_OFF_RUN);
    expect(live.finished).not.toBeNull();
    expect(live.steps.map((s) => s.status)).toEqual(['done', 'error', 'error']);
    expect(live.steps[1].detail).toBe(CUT_OFF_STEP);
    expect(live.steps[1].finished).toBe(10);
    expect(getRun(db, 'old')!.status).toBe('done');
    expect(getRun(db, 'old')!.reply).toBe('All good');
    expect(closeStaleRuns(db)).toBe(0);
    db.sql.close();
  });
});
