// Microphone rules (0.10.1), pure so the core's tests can import them.
// 0.10.0 on Windows: "No microphone found" with a microphone plugged in. Chromium (WebView2) reports
// NotFoundError when Windows hides microphones from desktop apps, and an exact device id that no
// longer exists fails the same way, so Lotus now tries several ways to open a microphone before it
// gives up, and says which setting to check.

export type MicOs = 'windows' | 'macos' | 'linux';
/** The subset of MediaTrackConstraints used here (the core type-checks without DOM types). */
export interface MicConstraints { echoCancellation?: boolean; noiseSuppression?: boolean; autoGainControl?: boolean; deviceId?: { exact: string } }

/** The constraints to try, in order: the chosen microphone, the default one, then every one listed. */
export function micAttempts(preferred: string | null | undefined, deviceIds: string[]): MicConstraints[] {
  const clean: MicConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  const out: MicConstraints[] = [];
  if (preferred && preferred !== 'default') out.push({ ...clean, deviceId: { exact: preferred } });
  out.push(clean, {});
  for (const id of deviceIds) if (id && id !== preferred && id !== 'default' && id !== 'communications') out.push({ deviceId: { exact: id } });
  return out;
}

/** Whether another attempt can help after this error (permission refusals can't). */
export const retryableMicError = (name: string): boolean => !['NotAllowedError', 'SecurityError', 'AbortError'].includes(name);

/** What to tell the user, by error and system. Always says what happened and what to do. */
export function micErrorText(name: string, os: MicOs, found: number): string {
  const privacy = os === 'macos' ? 'System Settings → Privacy & Security → Microphone (turn Lotus on)'
    : os === 'linux' ? "your desktop's sound settings (pick an input device)"
    : 'Windows Settings → Privacy & security → Microphone (turn on Microphone access and “Let desktop apps access your microphone”)';
  if (name === 'NotAllowedError' || name === 'SecurityError') return `Microphone access is blocked. Allow it in ${privacy}, then try again.`;
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'The microphone is busy or stopped responding. Close other apps using it (calls, recorders), or pick another microphone in Voice → Settings.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') {
    return found
      ? `Lotus sees ${found} microphone${found > 1 ? 's' : ''} but couldn't open any. Check ${privacy}, or pick another one in Voice → Settings.`
      : `Lotus can't see a microphone. If one is plugged in, check ${privacy}, and that it is enabled in the system's sound settings.`;
  }
  if (name === 'NoMediaDevices') return 'This window has no access to audio devices. Restart Lotus; if it keeps happening, update WebView2 (Windows) or your system.';
  return `Could not start the microphone (${name || 'unknown error'}). Pick another microphone in Voice → Settings, or check ${privacy}.`;
}
