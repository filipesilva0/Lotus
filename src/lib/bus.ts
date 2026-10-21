// Tiny cross-window event bus. In the desktop app it rides on Tauri events, so the
// main window and the island can talk; in a browser it falls back to BroadcastChannel.

import { isTauri } from './http';

type Handler<T> = (payload: T) => void;

const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('tomo-bus') : null;

export async function emitEvent<T = unknown>(name: string, payload?: T): Promise<void> {
  if (isTauri) {
    const { emit } = await import('@tauri-apps/api/event');
    await emit(name, payload);
  } else {
    bc?.postMessage({ name, payload });
  }
}

export async function onEvent<T = unknown>(name: string, handler: Handler<T>): Promise<() => void> {
  if (isTauri) {
    const { listen } = await import('@tauri-apps/api/event');
    return listen<T>(name, (e) => handler(e.payload));
  }
  const fn = (e: MessageEvent) => e.data?.name === name && handler(e.data.payload);
  bc?.addEventListener('message', fn);
  return () => bc?.removeEventListener('message', fn);
}

/** Invoke a Rust command; resolves undefined in a browser so UI code stays unconditional. */
export async function invokeNative<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  if (!isTauri) return undefined;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export interface ActivityReport {
  id: string;
  kind: 'image' | 'voice' | 'chat' | 'download' | 'research';
  label: string;
  progress?: number;
  done?: boolean;
}

/** Tell the island about a running task so it can show a pill. Fire-and-forget. */
export function reportActivity(a: ActivityReport): void {
  void emitEvent('activity', a).catch(() => undefined);
}
