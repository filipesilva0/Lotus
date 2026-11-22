// When you have finished talking (0.21.1), pure so the core's tests can check it. See voice.ts listen().
//
// Before, any microphone level over a fixed 0.09 counted as talking. In a room with a fan, a busy PC
// or a mic turned up high, the background alone was over that, so Lotus never heard the pause after
// you stopped and waited for the time limit (45 seconds on a call). Now Lotus learns how loud the room
// is while it listens and only counts sound clearly above that as talking.

export interface TurnState {
  /** You started talking. */
  heard: boolean;
  /** Seconds (recording clock) when the current quiet began, or -1 while talking. */
  quietSince: number;
  /** How loud the room is without you (0…1). */
  noise: number;
}

/** Talking is at least this loud, however quiet the room. */
export const SPEECH_FLOOR = 0.09;

/** The room is never taken to be louder than this, so a long answer can't teach Lotus that your voice is the room. */
const NOISE_CAP = 0.12;

/** `heard`: the recording already heard you start (a call you interrupted); the room is then learned from the quiet after. */
export const turnStart = (heard = false): TurnState => ({ heard, quietSince: -1, noise: heard ? 0.02 : -1 });

/** The level that counts as talking in a room this loud. */
export const speechLevel = (noise: number) => Math.max(SPEECH_FLOOR, noise * 2 + 0.04);

/**
 * One microphone reading: `level` 0…1, `t` seconds since recording started. `done` when you talked
 * and then stayed quiet for `silenceMs`.
 */
export function turnStep(s: TurnState, level: number, t: number, silenceMs: number): { s: TurnState; done: boolean } {
  // The room's level: the first reading (before you speak), then it follows quiet moments quickly and
  // loud ones slowly. While you talk it barely moves, so your own voice doesn't become "the room".
  const was = s.noise < 0 ? Math.min(level, NOISE_CAP) : s.noise;
  const talking = level > speechLevel(was);
  const k = level < was ? 0.2 : talking ? 0.0005 : 0.01;
  const noise = Math.min(NOISE_CAP, was * (1 - k) + level * k);
  if (talking) return { s: { heard: true, quietSince: -1, noise }, done: false };
  if (!s.heard) return { s: { ...s, noise }, done: false };
  const quietSince = s.quietSince < 0 ? t : s.quietSince;
  return { s: { heard: true, quietSince, noise }, done: (t - quietSince) * 1000 > silenceMs };
}
