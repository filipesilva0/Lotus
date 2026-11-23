import { useCallback, useEffect, useRef, useState } from 'react';
import { onEvent, invokeNative } from '../lib/bus';
import { ollamaClient } from '../services/ollamaService';
import { voicebox } from '../services/voicebox';
import { comfy } from '../services/comfyService';
import { Activity, AgentSession, PermissionRequest, baseName } from './state';
import { onCoreEvent, rpc } from '../lib/core';
import { applyRunEvent, reconcileRuns, type CoreRun, type RunSource } from './runs';

export interface EngineUp { ollama: boolean | null; voicebox: boolean | null; comfyui: boolean | null }

/** Polls the three local engines every few seconds. */
export function useEngineStatus(intervalMs = 5000): EngineUp {
  const [s, setS] = useState<EngineUp>({ ollama: null, voicebox: null, comfyui: null });
  useEffect(() => {
    let alive = true;
    const run = async () => {
      if (document.hidden) return;
      const [o, v, c] = await Promise.all([ollamaClient.checkHealth(), voicebox.isUp(), comfy.isUp()]);
      if (alive) setS((p) => (p.ollama === o && p.voicebox === v && p.comfyui === c ? p : { ollama: o, voicebox: v, comfyui: c }));
    };
    void run();
    const t = setInterval(run, intervalMs);
    return () => { alive = false; clearInterval(t); };
  }, [intervalMs]);
  return s;
}

/** Tasks reported by other windows (image generation, downloads, …) plus local ones. */
export function useActivity() {
  const [items, setItems] = useState<Activity[]>([]);
  const timers = useRef(new Map<string, number>());

  const put = useCallback((a: Activity) => {
    setItems((cur) => (cur.some((x) => x.id === a.id) ? cur.map((x) => (x.id === a.id ? { ...x, ...a } : x)) : [...cur, a]));
    window.clearTimeout(timers.current.get(a.id));
    if (a.done) {
      timers.current.set(a.id, window.setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== a.id)), 2500));
    } else {
      // A task that stops reporting (window crashed) must not stick forever. 0.23.1: 10 minutes, not 90 s:
      // tasks, routines and calls report once when they start, and dropped off while still going.
      timers.current.set(a.id, window.setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== a.id)), 10 * 60_000));
    }
  }, []);

  useEffect(() => {
    let off: (() => void) | undefined;
    void onEvent<Activity>('activity', put).then((u) => (off = u));
    return () => off?.();
  }, [put]);

  return { items, put };
}

const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

function summarize(tool: string, input: Record<string, unknown>): { summary: string; detail: string } {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '');
  if (tool === 'Bash') return { summary: str('command').split('\n')[0].slice(0, 120), detail: str('command') };
  if (str('file_path')) return { summary: str('file_path'), detail: str('file_path') };
  if (str('url')) return { summary: str('url'), detail: str('url') };
  const j = JSON.stringify(input, null, 2);
  return { summary: j.replace(/\s+/g, ' ').slice(0, 120), detail: j };
}

/** Claude Code sessions and permission prompts arriving from the Rust hook server. */
export function useAgents(enabled: boolean) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [queue, setQueue] = useState<PermissionRequest[]>([]);

  useEffect(() => {
    if (!enabled) return;
    const offs: (() => void)[] = [];
    const touch = (id: string, project: string, patch: Partial<AgentSession>) =>
      setSessions((cur) => {
        const found = cur.find((s) => s.id === id);
        const next: AgentSession = { id, project, state: 'idle', at: Date.now(), ...found, ...patch };
        return found ? cur.map((s) => (s.id === id ? next : s)) : [...cur, next];
      });

    void onEvent<any>('agent:event', (p) => {
      const o = asObj(p);
      const id = String(o.session_id ?? 'unknown');
      const project = baseName(o.cwd as string);
      switch (o.hook_event_name) {
        case 'SessionStart': return touch(id, project, { state: 'idle', note: undefined });
        case 'UserPromptSubmit': return touch(id, project, { state: 'working', note: undefined });
        case 'Stop': return touch(id, project, { state: 'done' });
        case 'Notification': return touch(id, project, { state: 'waiting', note: String(o.message ?? '') });
        case 'SessionEnd': return setSessions((cur) => cur.filter((s) => s.id !== id));
      }
    }).then((u) => offs.push(u));

    void onEvent<any>('agent:permission', (p) => {
      const o = asObj(p);
      const tool = String(o.tool_name ?? 'a tool');
      const { summary, detail } = summarize(tool, asObj(o.tool_input));
      const req: PermissionRequest = {
        requestId: Number(o.request_id), sessionId: String(o.session_id ?? ''), project: baseName(o.cwd as string), tool, summary, detail,
      };
      setQueue((q) => [...q, req]);
      touch(req.sessionId, req.project, { state: 'waiting' });
    }).then((u) => offs.push(u));

    void onEvent<{ request_id: number }>('agent:permission-done', (p) =>
      setQueue((q) => q.filter((r) => r.requestId !== p.request_id)),
    ).then((u) => offs.push(u));

    // "done" is a brief celebration, then the session goes quiet.
    const t = setInterval(() => setSessions((cur) => cur.map((s) => (s.state === 'done' && Date.now() - s.at > 6000 ? { ...s, state: 'idle' } : s))), 2000);
    return () => { offs.forEach((o) => o()); clearInterval(t); };
  }, [enabled]);

  const answer = useCallback(async (req: PermissionRequest, allow: boolean) => {
    setQueue((q) => q.filter((r) => r.requestId !== req.requestId));
    await invokeNative('hook_answer', { requestId: req.requestId, allow, message: allow ? undefined : 'Denied from the Lotus island' });
  }, []);

  return { sessions, queue, answer };
}

/**
 * 0.23.1: what Lotus's own agent is running (chat, Work, tasks, routines), from the core's event stream,
 * checked against the core's list of runs when the island starts and every half minute while one runs.
 */
export function useCoreRuns(): Map<string, CoreRun> {
  const [runs, setRuns] = useState<Map<string, CoreRun>>(() => new Map());
  const ref = useRef(runs);
  ref.current = runs;
  useEffect(() => {
    let alive = true;
    const sync = () => void rpc<{ id: string; status: string; source: RunSource | null; prompt: string; created: number }[]>('agent_runs', { limit: 12 })
      .then((rows) => { if (alive && Array.isArray(rows)) setRuns((m) => reconcileRuns(m, rows, Date.now())); }).catch(() => undefined);
    sync();
    const off = onCoreEvent((e) => {
      const before = ref.current;
      const next = applyRunEvent(before, e, Date.now());
      if (next === before) return;
      setRuns(next);
      // A run we haven't seen: ask the core where it came from (chat, task, routine…).
      const id = (e as { runId?: string }).runId;
      if (id && !before.has(id)) sync();
    });
    const t = setInterval(() => { if ([...ref.current.values()].some((r) => !r.done)) sync(); }, 30_000);
    // Finished runs fade from the list after a moment.
    const sweep = setInterval(() => setRuns((m) => { const now = Date.now(); let ch = false; const n = new Map(m); for (const [k, r] of n) if (r.done && now - r.at > 5000) { n.delete(k); ch = true; } return ch ? n : m; }), 2500);
    return () => { alive = false; off(); clearInterval(t); clearInterval(sweep); };
  }, []);
  return runs;
}
