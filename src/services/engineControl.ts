// Starting and stopping the local engines through the desktop shell.

import { invokeNative } from '../lib/bus';
import { isTauri } from '../lib/http';
import { engineUrl, EngineId } from './engineConfig';

export interface AppPaths { portable: boolean; dataDir: string; exeDir: string }

const exeKey = (id: EngineId) => `tomo.engine.${id}.exe`;
export const savedExe = (id: EngineId) => localStorage.getItem(exeKey(id)) || '';
export const setSavedExe = (id: EngineId, p: string) => localStorage.setItem(exeKey(id), p);

let pathsCache: AppPaths | undefined;
export async function appPaths(): Promise<AppPaths | undefined> {
  return (pathsCache ??= await invokeNative<AppPaths>('app_paths'));
}

/** Lets the user point Tomo at an engine's executable or launcher script. */
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
    super(`Tomo doesn't know where ${engine === 'voicebox' ? 'the Voicebox server' : engine} is installed yet.`);
  }
}

export async function startEngine(id: EngineId): Promise<void> {
  if (!isTauri) throw new Error('Starting engines needs the Tomo desktop app.');
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

export const stopEngine = (id: EngineId) => invokeNative('engine_stop', { name: id });
export const isSupervised = async (id: EngineId) => !!(await invokeNative<boolean>('engine_supervised', { name: id }));
