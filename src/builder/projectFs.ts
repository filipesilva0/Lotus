// Project files and processes, through the desktop shell (src-tauri/src/appbuilder.rs).
// Every path is relative to the project folder; the shell refuses anything that leaves it.

import { invokeNative, onEvent } from '../lib/bus';
import { isTauri } from '../lib/http';
import { uid } from '../lib/persist';
import { FileRead, FsEntry } from './types';
import { stripAnsi } from './protocol';

async function call<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  if (!isTauri) throw new Error('The App Builder needs the Lotus desktop app (it works with files and programs on your PC).');
  try {
    return (await invokeNative<T>(cmd, args)) as T;
  } catch (e) {
    throw new Error(typeof e === 'string' ? e : (e as Error).message ?? String(e));
  }
}

export const projCreate = (path: string) => call<string>('proj_create', { path });
export const projTree = (root: string) => call<{ entries: FsEntry[]; truncated: boolean }>('proj_tree', { root });
export const projRead = (root: string, rel: string) => call<FileRead>('proj_read', { root, rel });
export const projWrite = (root: string, rel: string, content: string, base64 = false) => call<void>('proj_write', { root, rel, content, base64 });
export const projMkdir = (root: string, rel: string) => call<void>('proj_mkdir', { root, rel });
export const projDelete = (root: string, rel: string) => call<void>('proj_delete', { root, rel });
export const projRename = (root: string, from: string, to: string) => call<void>('proj_rename', { root, from, to });
export const previewServe = (root: string, dir: string) => call<{ port: number; url: string }>('preview_serve', { root, dir: dir || null });
export const previewStop = (root: string, dir: string) => call<void>('preview_stop', { root, dir: dir || null });

export interface ToolInfo { id: string; found: boolean; version: string }
export const toolchainCheck = () => call<ToolInfo[]>('toolchain_check', {});

// ── processes ──────────────────────────────────────────────────────────────

export interface ProcOutput { id: string; stream: 'out' | 'err'; data: string }
export interface ProcExit { id: string; code: number | null }

/** Subscribes to every process's output and exit. Returns an unsubscribe function. */
export async function watchProcs(onOut: (o: ProcOutput) => void, onExit: (e: ProcExit) => void): Promise<() => void> {
  const a = await onEvent<ProcOutput>('proc:output', onOut);
  const b = await onEvent<ProcExit>('proc:exit', onExit);
  return () => { a(); b(); };
}

export const procSpawn = (id: string, command: string, root: string, cwd?: string, env?: Record<string, string>) =>
  call<number>('proc_spawn', { id, command, root, cwd: cwd || null, env: env ?? null });
export const procKill = (id: string) => call<void>('proc_kill', { id });

export interface RunResult { code: number | null; output: string; timedOut: boolean; cancelled: boolean }

const LIMIT = 6000;
/** Keeps the start and end of long output (errors are usually at the end, the command echo at the start). */
export function squeeze(text: string, limit = LIMIT): string {
  const t = stripAnsi(text).replace(/\r(?!\n)/g, '\n').trim();
  if (t.length <= limit) return t;
  const head = Math.floor(limit * 0.25);
  return `${t.slice(0, head)}\n… (${t.length - limit} characters left out) …\n${t.slice(t.length - (limit - head))}`;
}

/** Runs a command to completion (or timeout) and returns what it printed. */
export async function runToEnd(command: string, root: string, o: { timeoutMs?: number; signal?: AbortSignal; onChunk?: (id: string, d: string, stream: 'out' | 'err') => void; cwd?: string } = {}): Promise<RunResult> {
  const id = uid('run');
  let output = '';
  let resolveExit!: (e: ProcExit) => void;
  const exited = new Promise<ProcExit>((r) => { resolveExit = r; });
  const off = await watchProcs((p) => { if (p.id === id) { output += p.data; o.onChunk?.(id, p.data, p.stream); } }, (e) => { if (e.id === id) resolveExit(e); });
  let timedOut = false;
  let cancelled = false;
  const timer = setTimeout(() => { timedOut = true; void procKill(id); }, o.timeoutMs ?? 180_000);
  const onAbort = () => { cancelled = true; void procKill(id); };
  o.signal?.addEventListener('abort', onAbort);
  try {
    await procSpawn(id, command, root, o.cwd);
    const e = await exited;
    return { code: e.code, output, timedOut, cancelled };
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener('abort', onAbort);
    off();
  }
}
