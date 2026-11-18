// Interrupting by voice (0.15.0). While Lotus thinks or speaks on a call, the microphone stays open
// and recording. When you talk over it, Lotus stops at once and the same recording becomes your next
// turn, so the words you started with aren't lost.
//
// Telling you apart from Lotus's own voice coming back through the microphone:
//   - Lotus's voice goes through echo cancellation (echo.ts) when the window supports it;
//   - while Lotus plays, the threshold follows how loud its echo is in the microphone (learned during
//     the answer, only from moments that stay under the threshold);
//   - it takes about a third of a second of steady speech, so a cough or a click doesn't count.
// The rules are pure (bargeRules.ts) so the core's tests can check them.

import { MicRecorder } from '../lib/audio';
import { echoSafe, playbackLevel } from './echo';
import { bargeStart, shouldBargeIn } from './bargeRules';
export { BARGE_MS } from './bargeRules';

/**
 * Listens while Lotus answers. `onBargeIn` gets the recording that heard you (hand it to listen()).
 * `stop()` closes the microphone if nobody interrupted.
 */
export function watchForBargeIn(onBargeIn: (rec: MicRecorder) => void): { stop: () => void; ready: Promise<boolean> } {
  let st = bargeStart();
  let fired = false, stopped = false;
  const rec = new MicRecorder((level, t) => {
    if (fired || stopped) return;
    const r = shouldBargeIn(st, level, playbackLevel(), t, echoSafe() === true);
    st = r.s;
    if (r.stop) { fired = true; onBargeIn(rec); }
  });
  const ready = rec.start().then(() => { if (stopped) rec.cancel(); return !stopped; }, () => false);
  return { ready, stop: () => { stopped = true; if (!fired) rec.cancel(); } };
}
