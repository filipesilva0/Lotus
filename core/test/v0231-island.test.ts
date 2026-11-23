// 0.23.1: island polish after the user tried 0.23.0. The island knows what Lotus's own agent is doing
// (it said "Nothing running right now" while Lotus was busy), frosted glass, smoother edges, animation.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyRunEvent, gist, reconcileRuns, runActivities, type CoreRun } from '../../src/island/runs';
import { FLOAT_GAP, islandLook } from '../../src/island/look';

const SRC = join(import.meta.dir, '../../src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

describe('what Lotus is doing', () => {
  test('a run the windows never reported still shows, with what it is doing', () => {
    let m = new Map<string, CoreRun>();
    m = reconcileRuns(m, [{ id: 'r1', status: 'running', source: 'task', prompt: 'Plan the launch week for the Microsoft Store', created: 1 }], 10);
    m = applyRunEvent(m, { type: 'agent', runId: 'r1', kind: 'thinking', text: 'hmm' }, 20);
    const same = applyRunEvent(m, { type: 'agent', runId: 'r1', kind: 'thinking', text: 'more' }, 21);
    expect(same).toBe(m); // a stream of thinking doesn't re-render the island each word
    let lines = runActivities(m, [], 30);
    expect(lines).toHaveLength(1);
    expect(lines[0].kicker).toBe('Task');
    expect(lines[0].label).toContain('Thinking about “Plan the launch week');
    m = applyRunEvent(m, { type: 'agent', runId: 'r1', kind: 'step', step: { label: 'Searching the web', status: 'running' } }, 40);
    expect(runActivities(m, [], 41)[0].label).toBe('Searching the web');
    m = applyRunEvent(m, { type: 'agent', runId: 'r1', kind: 'done' }, 50);
    lines = runActivities(m, [], 51);
    expect(lines[0].done).toBe(true);
    expect(runActivities(m, [], 50 + 3000)).toHaveLength(0);
  });
  test('a window\'s own line (with tok/s or progress) wins over the same run', () => {
    let m = new Map<string, CoreRun>();
    m = reconcileRuns(m, [{ id: 'c1', status: 'running', source: 'chat', prompt: 'hi', created: 1 }], 2);
    expect(runActivities(m, [{ id: 'main-chat', kind: 'chat', label: '31 tok/s' }], 3)).toHaveLength(0);
    expect(runActivities(m, [{ id: 'main-chat', kind: 'chat', label: 'Done', done: true }], 3)).toHaveLength(1);
  });
  test('a missed "done" is caught from the core\'s list', () => {
    let m = new Map<string, CoreRun>();
    m = applyRunEvent(m, { type: 'agent', runId: 'w1', kind: 'token', text: 'x' }, 1);
    m = reconcileRuns(m, [{ id: 'w1', status: 'done', source: 'work', prompt: 'Buying guide', created: 0 }], 5);
    expect(m.get('w1')?.done).toBe(true);
    expect(m.get('w1')?.source).toBe('work');
  });
  test('short prompts', () => {
    expect(gist('  a   b ')).toBe('a b');
    expect(gist('x'.repeat(50)).length).toBe(34);
  });
  test('the island uses it, and quiet reports last 10 minutes, not 90 s', () => {
    expect(read('island/Island.tsx')).toContain('runActivities(');
    expect(read('island/hooks.ts')).toContain('10 * 60_000');
    expect(read('island/hooks.ts')).not.toContain('90_000');
  });
});

describe('the island while Lotus works, and the look', () => {
  test('busy: the work view, with a Menu button back to the home', () => {
    const island = read('island/Island.tsx');
    const work = read('island/WorkView.tsx');
    expect(island).toContain('<WorkView');
    expect(work).toContain('Menu');
    expect(read('island/Home.tsx')).toContain('onShowWork');
  });
  test('frosted glass: see-through, light or dark, floating; Mac stays black', () => {
    const g = islandLook(false, 'glass', false);
    expect(g.glass && g.floating && !g.dark).toBe(true);
    expect(g.vars['--is-bg']).toMatch(/rgba\(246,246,250,0\.7\d\)/);
    expect(islandLook(true, 'glass', false).dark).toBe(true);
    expect(islandLook(false, 'glass', true).vars['--is-bg']).toBe('#000');
    for (const l of [islandLook(true, 'auto', false), islandLook(false, 'auto', false), g]) expect(l.vars['--is-ink']).toMatch(/^#/);
  });
  test('the floating shadow fits inside the window (no cut-off straight edges)', () => {
    // 0 8px 22px: reaches 30 px below and 22 px to the sides.
    expect(FLOAT_GAP.bottom).toBeGreaterThanOrEqual(30);
    expect(FLOAT_GAP.side).toBeGreaterThanOrEqual(22);
  });
  test('opening and closing are animated; it folds away quickly after the mouse leaves', () => {
    const island = read('island/Island.tsx');
    expect(island).toContain("'opening'");
    expect(island).toContain("'closing'");
    expect(island).toContain('prefers-reduced-motion');
    expect(island).toMatch(/FOLD_AFTER_LEAVE = (\d+)/);
    expect(Number(/FOLD_AFTER_LEAVE = (\d+)/.exec(island)![1])).toBeLessThanOrEqual(400);
  });
});
