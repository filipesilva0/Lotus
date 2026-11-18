// Interrupt-by-voice rules (0.15.0), pure so the core's tests can import them. See bargeIn.ts.

export interface BargeState { echo: number; loudMs: number; lastT: number }
export const bargeStart = (): BargeState => ({ echo: 0, loudMs: 0, lastT: -1 });

/** Speech needed before Lotus stops (ms), and the threshold floors. */
export const BARGE_MS = 320;
const QUIET_FLOOR = 0.12, PLAYING_FLOOR = 0.16;

/**
 * One microphone reading. `mic` and `play` are levels 0…1, `t` seconds since the recording started,
 * `safe` whether Lotus's voice goes through echo cancellation. Returns the new state and whether to stop Lotus.
 */
export function shouldBargeIn(s: BargeState, mic: number, play: number, t: number, safe: boolean): { s: BargeState; stop: boolean } {
  const dt = s.lastT < 0 ? 0 : Math.max(0, Math.min(0.2, t - s.lastT)) * 1000;
  const playing = play > 0.02;
  // Without echo cancellation the echo can be as loud as the voice itself: ask for more.
  const gain = safe ? 1.8 : 3;
  const threshold = playing ? Math.max(PLAYING_FLOOR * (safe ? 1 : 1.6), s.echo * gain) : QUIET_FLOOR;
  let echo = s.echo;
  if (playing && mic < threshold) echo = echo * 0.97 + mic * 0.03; // learn the echo from quiet moments only
  else if (!playing) echo *= 0.995;
  const loud = mic > threshold;
  // Brief dips between syllables don't reset the count; a longer quiet does.
  const loudMs = loud ? s.loudMs + dt : Math.max(0, s.loudMs - dt);
  return { s: { echo, loudMs, lastT: t }, stop: loudMs >= BARGE_MS };
}

