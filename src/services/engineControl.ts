// Starting and stopping the local engines through the desktop shell.

import { invokeNative } from '../lib/bus';
import { isTauri, http, timeoutSignal, networkErrorText } from '../lib/http';
import { engineUrl, EngineId } from './engineConfig';

export interface AppPaths { portable: boolean; dataDir: string; exeDir: string }

const exeKey = (id: EngineId) => `lotus.engine.${id}.exe`;
export const savedExe = (id: EngineId) => localStorage.getItem(exeKey(id)) || '';
export const setSavedExe = (id: EngineId, p: string) => localStorage.setItem(exeKey(id), p);

let pathsCache: AppPaths | undefined;
export async function appPaths(): Promise<AppPaths | undefined> {
  return (pathsCache ??= await invokeNative<AppPaths>('app_paths'));
}

/** Lets the user point Lotus at an engine's executable or launcher script. */
export async function browseForExe(id: EngineId): Promise<string | null> {
  if (!isTauri) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({
    title: `Locate ${id}`,
    multiple: false,
    filters: [{ name: 'Program or script', extensions: ['exe', 'bat', 'cmd'] }],
  });
  if (typeof picked === 'string') { setSavedExe(id, picked); return picked; }
  return null;
}

export class NeedsExecutable extends Error {
  constructor(public engine: EngineId) {
    super(`Lotus doesn't know where ${engine === 'voicebox' ? 'the Voicebox server' : engine} is installed yet.`);
  }
}

export async function startEngine(id: EngineId): Promise<void> {
  if (!isTauri) throw new Error('Starting engines needs the Lotus desktop app.');
  const paths = await appPaths();
  let exe = savedExe(id) || (await invokeNative<string | null>('engine_find', { name: id, dataDir: paths?.dataDir })) || '';
  if (!exe) throw new NeedsExecutable(id);

  let args: string[] = [];
  const sep = '\\';
  if (id === 'voicebox') {
    const port = new URL(engineUrl('voicebox')).port || '17493';
    args = ['--port', port];
    if (paths) args.push('--data-dir', `${paths.dataDir}${sep}voicebox`);
  } else if (id === 'ollama') {
    args = ['serve'];
  }
  const cwd = id === 'comfyui' ? exe.slice(0, Math.max(exe.lastIndexOf('\\'), exe.lastIndexOf('/'))) : undefined;
  await invokeNative('engine_start', { name: id, exe, args, cwd });
}

const HEALTH_PATH: Record<EngineId, string> = { ollama: '/api/version', comfyui: '/system_stats', voicebox: '/health' };
const NAME: Record<EngineId, string> = { ollama: 'Ollama', comfyui: 'ComfyUI', voicebox: 'Voicebox' };

/** Explains why an engine looks offline. Returns null when it can't tell (e.g. in a browser). */
export async function diagnose(id: EngineId): Promise<string | null> {
  if (!isTauri) return null;
  let u: URL;
  try { u = new URL(engineUrl(id)); } catch { return `The ${NAME[id]} address "${engineUrl(id)}" is not a valid URL. Use Change to fix it.`; }
  const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
  const ping = await invokeNative<{ reachable: boolean; status: number | null; detail: string }>('engine_ping', { host: u.hostname, port, path: HEALTH_PATH[id] });
  if (!ping) return null;
  if (!ping.reachable) return `${ping.detail}. Start ${NAME[id]}, or change the address if it runs on another port.`;
  if (ping.status && ping.status >= 200 && ping.status < 300) {
    let why = '';
    try { await http(`${engineUrl(id)}${HEALTH_PATH[id]}`, { signal: timeoutSignal(2000) }); } catch (e) { why = networkErrorText(e); }
    return `${NAME[id]} is running and answers directly, but Lotus's own request to it failed${why ? `: ${why}` : ''}. This is a Lotus problem, not an engine problem.`;
  }
  if (ping.status === 403) return `${NAME[id]} is running but refuses the request (HTTP 403). ${id === 'ollama' ? 'Set the OLLAMA_ORIGINS environment variable to * and restart Ollama.' : 'Check its CORS/origin settings.'}`;
  return `${NAME[id]} answered "${ping.detail || 'no response'}" instead of a normal reply.`;
}

export const stopEngine = (id: EngineId) => invokeNative('engine_stop', { name: id });
export const isSupervised = async (id: EngineId) => !!(await invokeNative<boolean>('engine_supervised', { name: id }));
