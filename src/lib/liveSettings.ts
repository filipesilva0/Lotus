import { LotusSettings } from '../types/lotus';

// The current settings for code that runs outside React (agent pool, scheduler, background learning).
// App.tsx calls `setLiveSettings` whenever settings change.

let current: LotusSettings | null = null;
const subs = new Set<() => void>();

/** Safe to call during render: the value updates at once, listeners are told after the render. */
export function setLiveSettings(s: LotusSettings) {
  if (current === s) return;
  current = s;
  queueMicrotask(() => subs.forEach((f) => f()));
}

export function liveSettings(): LotusSettings {
  if (!current) throw new Error('Settings are not loaded yet.');
  return current;
}

export const hasLiveSettings = () => current !== null;

export function onSettings(fn: () => void): () => void {
  subs.add(fn);
  return () => { subs.delete(fn); };
}
