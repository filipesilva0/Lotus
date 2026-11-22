// 0.21.1 voice fixes: the end of your turn in a noisy room, effects that add up, calls without echo.
import { describe, expect, test } from 'bun:test';
import { speechLevel, turnStart, turnStep, type TurnState } from '../../src/voice/turnRules';
import { addEffects, callEffects, NO_EFFECTS, withEffects } from '../../src/voice/studio';

/** Feeds readings every 16 ms; returns the time (s) the turn ended, or null. */
function run(levels: number[], silenceMs = 700, start: TurnState = turnStart()): number | null {
  let s = start;
  for (let i = 0; i < levels.length; i++) {
    const t = i * 0.016;
    const r = turnStep(s, levels[i], t, silenceMs);
    s = r.s;
    if (r.done) return t;
  }
  return null;
}
const frames = (sec: number, level: number | (() => number)) => Array.from({ length: Math.round(sec / 0.016) }, () => (typeof level === 'number' ? level : level()));
let seed = 3;
const jitter = (base: number, amp: number) => () => { seed = (seed * 16807) % 2147483647; return base + (seed / 2147483647) * amp; };

describe('end of turn', () => {
  test('quiet room: ends about 0.7 s after you stop', () => {
    const t = run([...frames(0.5, 0.01), ...frames(2, 0.5), ...frames(3, 0.01)]);
    expect(t).not.toBeNull();
    expect(t! - 2.5).toBeGreaterThan(0.6);
    expect(t! - 2.5).toBeLessThan(0.9);
  });
  test('noisy room (fan over the old fixed level): still ends soon after you stop', () => {
    const fan = jitter(0.1, 0.04); // 0.10–0.14, above the old 0.09 that counted as talking
    const t = run([...frames(0.6, fan), ...frames(2, jitter(0.5, 0.3)), ...frames(4, fan)]);
    expect(t).not.toBeNull();
    expect(t! - 2.6).toBeLessThan(1.2);
  });
  test('room noise alone never counts as you talking', () => {
    expect(run(frames(10, jitter(0.1, 0.04)))).toBeNull();
  });
  test('a long answer does not teach it that your voice is the room', () => {
    let s = turnStart();
    for (const l of [...frames(0.3, 0.01), ...frames(40, jitter(0.35, 0.3))]) s = turnStep(s, l, 0, 700).s;
    expect(speechLevel(s.noise)).toBeLessThan(0.3);
  });
  test('a recording that already heard you (interrupt by voice) ends after the pause', () => {
    const t = run(frames(2, 0.01), 700, turnStart(true));
    expect(t).not.toBeNull();
    expect(t!).toBeLessThan(0.9);
  });
});

describe('effects', () => {
  test("Speak page effects left at Natural keep the voice's own effects", () => {
    expect(addEffects({ room: 0.4, bass: 3 }, withEffects()).room).toBe(0.4);
    expect(addEffects({ room: 0.4, bass: 3 }, withEffects()).bass).toBe(3);
  });
  test('settings changed on the Speak page win', () => {
    const fx = addEffects({ room: 0.4, bass: 3 }, withEffects({ bass: -2, band: 'phone' }));
    expect(fx).toEqual({ ...NO_EFFECTS, room: 0.4, bass: -2, band: 'phone' });
  });
  test('calls leave out echo and fades but keep the rest', () => {
    expect(callEffects({ echo: 0.5, room: 0.4, fadeIn: 1, fadeOut: 1, pitch: 2 })).toEqual({ ...NO_EFFECTS, room: 0.4, pitch: 2 });
  });
});
