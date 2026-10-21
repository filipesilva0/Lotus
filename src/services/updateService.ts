// Talks to the desktop shell's updater (src-tauri/src/updates.rs). In a plain browser there is
// no updater, so every call resolves to "unsupported" and the UI says so.

import { invokeNative, onEvent } from '../lib/bus';
import { isTauri } from '../lib/http';

export interface UpdateInfo {
  version: string;
  current: string;
  notes: string | null;
  date: string | null;
}

export interface UpdateProgress { downloaded: number; total: number | null }

export const updatesSupported = isTauri;

/** Resolves null when Tomo is up to date. Throws an Error with a user-readable message. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    return (await invokeNative<UpdateInfo | null>('update_check')) ?? null;
  } catch (e) {
    throw new Error(friendly(e));
  }
}

/** Downloads, verifies, installs and restarts. On Windows a success never returns: the app exits. */
export async function installUpdate(): Promise<void> {
  try {
    await invokeNative('update_install');
  } catch (e) {
    throw new Error(friendly(e));
  }
}

export const onUpdateProgress = (fn: (p: UpdateProgress) => void) => onEvent<UpdateProgress>('update:progress', fn);

export async function currentVersion(): Promise<string | null> {
  if (!isTauri) return null;
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    return await getVersion();
  } catch {
    return null;
  }
}

function friendly(e: unknown): string {
  const raw = typeof e === 'string' ? e : e instanceof Error ? e.message : String(e);
  if (/signature/i.test(raw)) return `The downloaded update failed its signature check and was not installed. (${raw})`;
  if (/404|not found|status code/i.test(raw)) {
    return `No update information was found. If you maintain this app, check that a release with latest.json exists. (${raw})`;
  }
  return `Could not reach the update server. Check your internet connection and try again. (${raw})`;
}
