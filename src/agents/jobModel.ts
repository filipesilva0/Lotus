// Which model a background job runs on. Kept free of React and the hardware monitor so the core's
// tests can check it (core/test/think-and-swap.test.ts).

export type JobKind = 'task' | 'routine' | 'skill' | 'memory' | 'rename' | 'other';

/** Housekeeping jobs that use the Background tasks model (Settings → General) when one is set. */
export const BACKGROUND_KINDS: JobKind[] = ['memory', 'skill', 'rename'];

/**
 * The user's background model for housekeeping, else the scaler's pick.
 *
 * `builtinLoaded`: the model the built-in engine has loaded (or is loading) right now. That engine runs
 * one model at a time, so housekeeping on another model unloaded the chat model about 10 s after every
 * reply, and the next message waited for it to load again (6.8 GB for Gemma 4 12B on an 8 GB card).
 * Housekeeping now uses the loaded model; the background model is used only when nothing is loaded.
 */
export function modelForJob(kind: JobKind, s: { backgroundModel?: string; selectedModel?: string } | null, agentModel: string, builtinLoaded?: string | null): string {
  if (BACKGROUND_KINDS.includes(kind)) {
    if (builtinLoaded) return builtinLoaded;
    if (s?.backgroundModel) return s.backgroundModel;
  }
  return agentModel || s?.selectedModel || '';
}
