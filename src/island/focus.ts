// Focus timer (idea 6): a countdown on the island, optionally tied to a card on the task board.
// Pure state, so it survives the island window reloading (saved in kv) and can be tested.

export interface Focus {
  /** When the current stretch started (null while paused). */
  since: number | null;
  /** Time left when the current stretch started, ms. */
  left: number;
  total: number;
  task?: { id: string; title: string };
}

export const FOCUS_KEY = 'lotus.island.focus.v1';

export const focusStart = (minutes: number, now: number, task?: Focus['task']): Focus => ({ since: now, left: minutes * 60_000, total: minutes * 60_000, task });
export const focusLeft = (f: Focus, now: number): number => Math.max(0, f.since === null ? f.left : f.left - (now - f.since));
export const focusPause = (f: Focus, now: number): Focus => ({ ...f, since: null, left: focusLeft(f, now) });
export const focusResume = (f: Focus, now: number): Focus => (f.since === null ? { ...f, since: now } : f);
export const focusMore = (f: Focus, minutes: number, now: number): Focus => ({ ...f, since: now, left: minutes * 60_000, total: minutes * 60_000 });
export function focusLabel(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
