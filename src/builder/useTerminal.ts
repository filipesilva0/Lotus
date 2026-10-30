import { useCallback, useEffect, useRef, useState } from 'react';
import { uid } from '../lib/persist';
import { findServerUrl, stripAnsi } from './protocol';
import { procKill, procSpawn, RunResult, watchProcs } from './projectFs';
import { BuilderProject } from './types';

export interface TermSession { id: string; title: string; text: string; running: boolean; code?: number | null; server?: boolean }

const CAP = 160_000;
const trimTo = (t: string) => (t.length > CAP ? `… earlier output removed …\n${t.slice(t.length - CAP * 0.8)}` : t);

/**
 * The built-in terminal: every command the user or the agent runs shows up here with live output.
 * Commands run through the desktop shell; when a server prints its local address, `onUrl` is called.
 */
export function useTerminal(project: BuilderProject | null, onUrl: (url: string) => void) {
  const [sessions, setSessions] = useState<TermSession[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const raw = useRef(new Map<string, string>());
  const waiters = useRef(new Map<string, (code: number | null) => void>());
  const urlWaiters = useRef(new Map<string, (url: string | null) => void>());
  const servers = useRef(new Set<string>());
  const onUrlRef = useRef(onUrl);
  onUrlRef.current = onUrl;

  useEffect(() => {
    let off: (() => void) | undefined;
    let dead = false;
    void watchProcs(
      (o) => {
        if (!raw.current.has(o.id)) return;
        const full = (raw.current.get(o.id) ?? '') + o.data;
        raw.current.set(o.id, full.length > 400_000 ? full.slice(full.length - 300_000) : full);
        const clean = stripAnsi(o.data).replace(/\r(?!\n)/g, '\n');
        setSessions((l) => l.map((s) => (s.id === o.id ? { ...s, text: trimTo(s.text + clean) } : s)));
        if (servers.current.has(o.id)) {
          const url = findServerUrl(stripAnsi(full));
          if (url) { urlWaiters.current.get(o.id)?.(url); urlWaiters.current.delete(o.id); onUrlRef.current(url); servers.current.delete(o.id); }
        }
      },
      (e) => {
        setSessions((l) => l.map((s) => (s.id === e.id ? { ...s, running: false, code: e.code, text: `${s.text}${s.text.endsWith('\n') ? '' : '\n'}[exited with code ${e.code ?? 'unknown'}]\n` } : s)));
        waiters.current.get(e.id)?.(e.code); waiters.current.delete(e.id);
        urlWaiters.current.get(e.id)?.(null); urlWaiters.current.delete(e.id);
        servers.current.delete(e.id);
      },
    ).then((f) => { if (dead) f(); else off = f; });
    return () => { dead = true; off?.(); };
  }, []);

  const begin = useCallback((command: string, server: boolean) => {
    const id = uid('t');
    raw.current.set(id, '');
    if (server) servers.current.add(id);
    setSessions((l) => [...l, { id, title: command.length > 28 ? `${command.slice(0, 27)}…` : command, text: `> ${command}\n`, running: true, server }]);
    setActive(id);
    return id;
  }, []);

  const fail = (id: string, msg: string) => setSessions((l) => l.map((s) => (s.id === id ? { ...s, running: false, text: `${s.text}${msg}\n` } : s)));

  /** Starts a command and returns at once. */
  const run = useCallback(async (command: string, server = false): Promise<string | null> => {
    if (!project) return null;
    const id = begin(command, server);
    try { await procSpawn(id, command, project.path); return id; } catch (e) { fail(id, (e as Error).message); return null; }
  }, [project, begin]);

  /** Runs a command and waits for it to end (or the time limit, or a stop request). */
  const runAndWait = useCallback(async (command: string, signal: AbortSignal, timeoutMs: number): Promise<RunResult> => {
    if (!project) return { code: null, output: 'No project is open.', timedOut: false, cancelled: false };
    const id = begin(command, false);
    let timedOut = false; let cancelled = false;
    const exited = new Promise<number | null>((res) => { waiters.current.set(id, res); });
    const timer = setTimeout(() => { timedOut = true; void procKill(id); }, timeoutMs);
    const stop = () => { cancelled = true; void procKill(id); };
    signal.addEventListener('abort', stop);
    try {
      await procSpawn(id, command, project.path);
      const code = await exited;
      return { code, output: raw.current.get(id) ?? '', timedOut, cancelled };
    } catch (e) {
      fail(id, (e as Error).message);
      return { code: null, output: (e as Error).message, timedOut: false, cancelled };
    } finally { clearTimeout(timer); signal.removeEventListener('abort', stop); waiters.current.delete(id); }
  }, [project, begin]);

  /** Stops any running servers, starts this one, and waits (up to 25 s) for it to print its address. */
  const startServer = useCallback(async (command: string): Promise<{ url: string | null; output: string }> => {
    if (!project) return { url: null, output: 'No project is open.' };
    await Promise.all(sessions.filter((s) => s.server && s.running).map((s) => procKill(s.id)));
    const id = begin(command, true);
    const waitUrl = new Promise<string | null>((res) => { urlWaiters.current.set(id, res); setTimeout(() => res(null), 25_000); });
    try { await procSpawn(id, command, project.path); } catch (e) { fail(id, (e as Error).message); return { url: null, output: (e as Error).message }; }
    const url = await waitUrl;
    return { url, output: raw.current.get(id) ?? '' };
  }, [project, begin, sessions]);

  const kill = useCallback((id: string) => void procKill(id), []);
  const close = useCallback((id: string) => {
    void procKill(id); raw.current.delete(id);
    setSessions((l) => l.filter((s) => s.id !== id));
    setActive((a) => (a === id ? null : a));
  }, []);
  const clear = useCallback((id: string) => setSessions((l) => l.map((s) => (s.id === id ? { ...s, text: '' } : s))), []);

  // Show the newest session when the active one is gone.
  const current = sessions.find((s) => s.id === active) ?? sessions[sessions.length - 1] ?? null;
  return { sessions, current, setActive, run, runAndWait, startServer, kill, close, clear, anyRunning: sessions.some((s) => s.running) };
}

export type Terminal = ReturnType<typeof useTerminal>;
