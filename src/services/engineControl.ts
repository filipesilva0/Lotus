// Starting and stopping the local engines through the desktop shell.

import { invokeNative } from '../lib/bus';
import { isTauri, http, timeoutSignal, networkErrorText } from '../lib/http';
import { engineUrl, EngineId, isRemote, isLoopbackHost, LISTEN_HINT, engineToken, normalizeEngineUrl, authHeaderFromToken } from './engineConfig';

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
  if (isRemote(id)) throw new Error(`${NAME[id]} is set to run on another computer (${engineUrl(id)}). Start it there, or change the address to use one on this computer.`);
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
  const remote = isRemote(id);
  if (remote && u.protocol === 'https:') {
    // engine_ping speaks plain HTTP only; for https just report what Lotus's own request said.
    try {
      const r = await http(`${engineUrl(id)}${HEALTH_PATH[id]}`, { signal: timeoutSignal(4000) });
      if (r.status === 401 || r.status === 403) return authText(id, r.status);
      return `${NAME[id]} at ${u.host} answered HTTP ${r.status} instead of a normal reply. Check the address.`;
    } catch (e) {
      return `Can't reach ${NAME[id]} at ${u.host} (${networkErrorText(e)}). Check that the other computer is on and reachable from this one.`;
    }
  }
  const ping = await invokeNative<{ reachable: boolean; status: number | null; detail: string }>('engine_ping', { host: u.hostname, port, path: HEALTH_PATH[id] });
  if (!ping) return null;
  if (!ping.reachable) {
    return remote
      ? `${ping.detail}. Check that the other computer is on, that ${NAME[id]} is running there, and that its firewall allows port ${port}. ${LISTEN_HINT[id]}`
      : `${ping.detail}. Start ${NAME[id]}, or change the address if it runs on another port.`;
  }
  if (ping.status === 401 || (remote && ping.status === 403 && engineToken(id))) return authText(id, ping.status);
  if (ping.status && ping.status >= 200 && ping.status < 300) {
    let why = '';
    try { await http(`${engineUrl(id)}${HEALTH_PATH[id]}`, { signal: timeoutSignal(2000) }); } catch (e) { why = networkErrorText(e); }
    return `${NAME[id]} is running and answers directly, but Lotus's own request to it failed${why ? `: ${why}` : ''}. This is a Lotus problem, not an engine problem.`;
  }
  if (ping.status === 403) return `${NAME[id]} is running but refuses the request (HTTP 403). ${id === 'ollama' ? 'Set the OLLAMA_ORIGINS environment variable to * and restart Ollama.' : 'Check its CORS/origin settings.'}`;
  return `${NAME[id]} answered "${ping.detail || 'no response'}" instead of a normal reply.`;
}

function authText(id: EngineId, status: number): string {
  return engineToken(id)
    ? `${NAME[id]} refused the access key (HTTP ${status}). Check the key under Change.`
    : `${NAME[id]} asks for an access key (HTTP ${status}). Add it under Change.`;
}

export interface EngineTest { ok: boolean; version?: string; message: string }

/**
 * Checks an address (and optional access key) before it is saved: asks the engine for its health
 * endpoint and checks the reply really comes from that engine.
 */
export async function testEngine(id: EngineId, address: string, token: string): Promise<EngineTest> {
  const base = normalizeEngineUrl(id, address);
  if (!base) return { ok: false, message: `"${address}" is not a web address. Use something like 192.168.1.20 or http://my-pc.local:${new URL(DEFAULT_PORT_URL[id]).port}.` };
  const headers: Record<string, string> = {};
  const auth = authHeaderFromToken(token);
  if (auth) headers.Authorization = auth;
  let res: Response;
  try {
    res = await http(`${base}${HEALTH_PATH[id]}`, { headers, signal: timeoutSignal(5000) });
  } catch (e) {
    const local = (() => { try { return isLoopbackHost(new URL(base).hostname); } catch { return true; } })();
    return { ok: false, message: local
      ? `Nothing answered at ${base}. Start ${NAME[id]} on this computer first.`
      : `Nothing answered at ${base} (${networkErrorText(e)}). Check that the other computer is on, ${NAME[id]} is running there and its firewall allows the port. ${LISTEN_HINT[id]}` };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, message: token ? `${NAME[id]} refused this access key (HTTP ${res.status}).` : `${NAME[id]} answered but asks for an access key (HTTP ${res.status}).${id === 'ollama' && res.status === 403 ? ' If there is no key, set OLLAMA_ORIGINS=* on that computer and restart Ollama.' : ''}` };
  }
  if (!res.ok) return { ok: false, message: `Something answered at ${base}, but not like ${NAME[id]} (HTTP ${res.status}). Check the address and port.` };
  let body: Record<string, unknown> = {};
  try { body = await res.json() as Record<string, unknown>; } catch { /* checked below */ }
  const looksRight = id === 'ollama' ? typeof body.version === 'string' : id === 'comfyui' ? typeof body.system === 'object' && body.system !== null : Object.keys(body).length > 0;
  if (!looksRight) return { ok: false, message: `Something answered at ${base}, but it does not look like ${NAME[id]}. Check the port.` };
  const sys = body.system as { comfyui_version?: string } | undefined;
  const version = id === 'ollama' ? String(body.version) : id === 'comfyui' ? sys?.comfyui_version : undefined;
  return { ok: true, version, message: `Connected to ${NAME[id]}${version ? ` ${version}` : ''} at ${base}.` };
}

const DEFAULT_PORT_URL: Record<EngineId, string> = { ollama: 'http://x:11434', comfyui: 'http://x:8188', voicebox: 'http://x:17493' };

export const stopEngine = (id: EngineId) => invokeNative('engine_stop', { name: id });
export const isSupervised = async (id: EngineId) => !!(await invokeNative<boolean>('engine_supervised', { name: id }));
