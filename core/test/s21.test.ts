// 0.10.1: microphones that weren't found on Windows. Lotus tries several ways to open one and says
// which setting to check.

import { describe, expect, test } from 'bun:test';
import { micAttempts, micErrorText, retryableMicError } from '../../src/lib/micRules';

describe('opening a microphone', () => {
  test('the chosen one first, then the default, then plain audio, then every listed device', () => {
    const a = micAttempts('mic-2', ['default', 'communications', 'mic-1', 'mic-2']);
    expect(a[0]).toMatchObject({ deviceId: { exact: 'mic-2' } });
    expect(a[1].deviceId).toBeUndefined();
    expect(a[2]).toEqual({});
    expect(a.slice(3)).toEqual([{ deviceId: { exact: 'mic-1' } }]);
  });
  test('no choice: default, plain, then devices', () => {
    const a = micAttempts('', ['mic-1']);
    expect(a.length).toBe(3);
    expect(a[0].echoCancellation).toBe(true);
  });
  test('a refusal is not retried; a missing device is', () => {
    expect(retryableMicError('NotAllowedError')).toBe(false);
    expect(retryableMicError('NotFoundError')).toBe(true);
    expect(retryableMicError('OverconstrainedError')).toBe(true);
  });
  test('messages say what happened and which setting to check', () => {
    expect(micErrorText('NotFoundError', 'windows', 0)).toContain('Let desktop apps access your microphone');
    expect(micErrorText('NotFoundError', 'windows', 2)).toContain('sees 2 microphones');
    expect(micErrorText('NotAllowedError', 'macos', 1)).toContain('System Settings');
    expect(micErrorText('NotReadableError', 'windows', 1)).toContain('busy');
    expect(micErrorText('Weird', 'linux', 0)).toContain('Weird');
  });
});

// ── chat: routines (cron jobs), to-do lists, images proposed with Yes / No ──
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'bun:test';
import { openDb } from '../src/db';
import { kvApply, kvGet } from '../src/kv';
import type { ToolCtx } from '../src/agent/types';
import { routineAdd, routineList, routineRemove, scheduleFrom, ROUTINES_KEY } from '../src/tools/routines';
import { todoCreate, TASKS_KEY } from '../src/tools/tasks';
import { ALL_TOOLS } from '../src/agent/service';
import { unbackedClaims } from '../src/agent/claims';
import { imageInstructions, parseImageProposal, pickProfile, proposalParams } from '../../src/chat/imageProposal';
import type { ImageProfile } from '../../src/models/imageProfiles';

// Images page defaults (as in hooks/useGallery, which needs a window).
const DEFAULT_PARAMS = { checkpoint: '', aspect: '1:1', count: 1, negative: 'lowres', cfg: 7, steps: 28, sampler: 'euler', scheduler: 'normal', seed: null as number | null, denoise: 0.65, profile: undefined as string | undefined, resolution: 0 };
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => { try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows */ } }));
const ctx = (): ToolCtx => {
  const d = mkdtempSync(join(tmpdir(), 'lotus-s21-')); dirs.push(d);
  const db = openDb(join(d, 'lotus.db'));
  return { kvSet: (k: string, v: string) => { kvApply(db, { set: { [k]: v }, remove: [] }); }, kvGet: (k: string) => kvGet(db, k), progress: () => undefined } as unknown as ToolCtx;
};

describe('routines from chat', () => {
  test('schedules in cron or in words', () => {
    expect(scheduleFrom('30 8 * * 1-5')).toEqual({ cron: '30 8 * * 1-5' });
    expect(scheduleFrom('daily 08:30')).toEqual({ cron: '30 8 * * *' });
    expect(scheduleFrom('every day at 7pm')).toEqual({ cron: '0 19 * * *' });
    expect(scheduleFrom('weekdays 9:00')).toEqual({ cron: '0 9 * * 1-5' });
    expect(scheduleFrom('weekly friday 17:00')).toEqual({ cron: '0 17 * * 5' });
    expect(scheduleFrom('every 2 hours')).toEqual({ cron: '0 */2 * * *' });
    expect('error' in scheduleFrom('sometimes')).toBe(true);
  });
  test('add, list and remove a routine', async () => {
    const c = ctx();
    const r = await routineAdd.run({ name: 'Morning briefing', instructions: 'Summarize the news', schedule: 'daily 08:00', web: true }, c);
    expect(r.ok).toBe(true);
    const saved = JSON.parse(c.kvGet(ROUTINES_KEY)!);
    expect(saved[0]).toMatchObject({ name: 'Morning briefing', prompt: 'Summarize the news', schedule: '0 8 * * *', enabled: true, action: 'log', web: true });
    expect(saved[0].nextRun).toBeGreaterThan(Date.now());
    expect((await routineList.run({}, c)).text).toContain('Morning briefing');
    expect((await routineRemove.run({ routine: 'morning' }, c)).ok).toBe(true);
    expect(JSON.parse(c.kvGet(ROUTINES_KEY)!)).toEqual([]);
    expect((await routineAdd.run({ name: 'x', instructions: 'y', schedule: 'whenever' }, c)).ok).toBe(false);
  });
  test('to-do lists: one checklist, or one task per item', async () => {
    const c = ctx();
    expect((await todoCreate.run({ title: 'Groceries', items: ['- milk', '2. eggs', '[ ] bread'] }, c)).ok).toBe(true);
    let t = JSON.parse(c.kvGet(TASKS_KEY)!);
    expect(t[0].title).toBe('Groceries');
    expect(t[0].steps.map((s: { text: string }) => s.text)).toEqual(['milk', 'eggs', 'bread']);
    await todoCreate.run({ title: 'Trip', items: ['passport', 'tickets'], separate: true }, c);
    t = JSON.parse(c.kvGet(TASKS_KEY)!);
    expect(t.length).toBe(3);
    expect(t[2]).toMatchObject({ title: 'tickets', labels: ['Trip'], status: 'todo' });
  });
  test('the tools are offered and back claims', () => {
    for (const n of ['routine.add', 'routine.list', 'routine.remove', 'todo.create']) expect(ALL_TOOLS.some((x) => x.name === n)).toBe(true);
    expect(unbackedClaims("I've scheduled the routine for every morning.", [])).not.toEqual([]);
    expect(unbackedClaims("I've scheduled the routine for every morning.", ['routine.add'])).toEqual([]);
    expect(unbackedClaims("I've created the to-do list.", ['todo.create'])).toEqual([]);
  });
});

describe('images proposed in chat', () => {
  const reply = 'Here is a prompt.\n\n```image\n{"title":"Misty valley","prompt":"misty valley at dawn","negative":"blurry","model":"Juggernaut XL","aspect":"16:9","resolution":0,"count":9,"steps":200,"cfg":6.5,"sampler":"DPMPP_2M","why":"wide scene"}\n```';
  test('the block becomes a proposal with safe values, and leaves the reply text', () => {
    const r = parseImageProposal(reply);
    expect(r.text).toBe('Here is a prompt.');
    expect(r.proposal).toMatchObject({ prompt: 'misty valley at dawn', aspect: '16:9', count: 4, steps: 80, cfg: 6.5, sampler: 'dpmpp_2m', title: 'Misty valley', resolution: 0 });
    expect(parseImageProposal('Hi\n```image\n{"prompt":').pending).toBe(true);
    expect(parseImageProposal('```image\nnot json\n```').problem).toBeTruthy();
    expect(parseImageProposal('```image\n{"aspect":"1:1"}\n```').problem).toContain('without a prompt');
  });
  test('settings follow the chosen model; fixed models keep their own', () => {
    const xl = { id: 'p1', name: 'Juggernaut XL', family: 'sdxl', files: { model: 'juggernautXL.safetensors' } } as ImageProfile;
    const z = { id: 'p2', name: 'Z-Image Turbo', family: 'zimage', files: { model: 'z.safetensors' } } as ImageProfile;
    const p = parseImageProposal(reply).proposal!;
    expect(pickProfile(p, [z, xl])?.id).toBe('p1');
    const a = proposalParams(DEFAULT_PARAMS, p, { profile: xl });
    expect(a).toMatchObject({ profile: 'p1', aspect: '16:9', count: 4, steps: 80, cfg: 6.5, sampler: 'dpmpp_2m', negative: 'blurry' });
    const b = proposalParams(DEFAULT_PARAMS, { ...p, model: 'Z-Image Turbo' }, { profile: z });
    expect(b).toMatchObject({ profile: 'p2', steps: 8, cfg: 1 });
    const c = proposalParams(DEFAULT_PARAMS, { ...p, steps: undefined, cfg: undefined, sampler: undefined }, { profile: xl });
    expect(c).toMatchObject({ steps: 30, cfg: 6, sampler: 'dpmpp_2m' });
    const d = proposalParams({ ...DEFAULT_PARAMS, checkpoint: 'a.safetensors' }, { ...p, model: 'juggernaut' }, { checkpoints: ['a.safetensors', 'juggernautXL_v9.safetensors'] });
    expect(d.checkpoint).toBe('juggernautXL_v9.safetensors');
  });
  test('the instructions list the ready models and what suits them', () => {
    const t = imageInstructions([{ name: 'Z-Image Turbo', family: 'zimage' }, { name: 'Juggernaut XL', family: 'sdxl' }]);
    expect(t).toContain('"image"');
    expect(t).toContain('"Z-Image Turbo" (Z-Image');
    expect(t).toContain("don't set steps");
    expect(imageInstructions([])).toContain('none is ready');
  });
});
