import { isTauri } from './http';

/** Open a web page in the user's default browser. */
export async function openExternal(url: string): Promise<void> {
  if (isTauri) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

/** Show a file or folder in Explorer. Throws if it does not exist. */
export async function revealPath(path: string): Promise<void> {
  if (!isTauri) throw new Error('Only available in the desktop app');
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
  await revealItemInDir(path);
}
