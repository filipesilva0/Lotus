// Background agent pool. Every background model job (task steps, routines, memory learning, skill
// writing) runs through here, so the number running at once never exceeds what the VRAM auto-scaler
// says is safe right now. The limit is re-read before every start, so it follows memory headroom live.
//
// Priorities: 0 = user is waiting (task the user started), 1 = scheduled work, 2 = housekeeping
// (learning). Housekeeping waits while a chat reply is streaming so it never slows the user down.

import { useSyncExternalStore } from 'react';
import { hardware, effectiveNumCtx } from '../hardware/monitor';
import { hasLiveSettings, liveSettings } from '../lib/liveSettings';
import { reportActivity } from '../lib/bus';
import { uid } from '../lib/persist';

export type JobKind = 'task' | 'routine' | 'skill' | 'memory' | 'rename' | 'other';

/** Housekeeping jobs that use the Background tasks model (Settings → Model & Inference) when one is set. */
export const BACKGROUND_KINDS: JobKind[] = ['memory', 'skill', 'rename'];

/** Which model a job runs on: the user's background model for housekeeping, else the scaler's pick. */
export function modelForJob(kind: JobKind, s: { backgroundModel?: string; selectedModel?: string } | null, agentModel: string): string {
  if (BACKGROUND_KINDS.includes(kind) && s?.backgroundModel) return s.backgroundModel;
  return agentModel || s?.selectedModel || '';
}

export interface JobInfo {
  id: string; label: string; kind: JobKind; priority: 0 | 1 | 2;
  status: 'queued' | 'running'; queuedAt: number; startedAt?: number;
}

export interface JobCtx {
  signal: AbortSignal;
  /** Model and context the scaler chose for background work. */
  model: string;
  numCtx: number;
}

interface Entry<T> {
  info: JobInfo;
  fn: (c: JobCtx) => Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
  ctrl: AbortController;
}

const queue: Entry<unknown>[] = [];
const running = new Map<string, Entry<unknown>>();
const subs = new Set<() => void>();
let foregroundBusy = false;
let snapshot: { jobs: JobInfo[]; limit: number } = { jobs: [], limit: 1 };

function publish() {
  snapshot = { jobs: [...[...running.values()].map((e) => e.info), ...queue.map((e) => e.info)], limit: currentLimit() };
  subs.forEach((f) => f());
}

/** Safe parallelism right now (from the VRAM plan). */
export function currentLimit(): number {
  const p = hardware.get().plan;
  return Math.max(1, p.pressure === 'critical' ? 1 : p.maxSubagents);
}

function pump() {
  queue.sort((a, b) => a.info.priority - b.info.priority || a.info.queuedAt - b.info.queuedAt);
  let i = 0;
  while (i < queue.length && running.size < currentLimit()) {
    const e = queue[i];
    if (e.info.priority === 2 && foregroundBusy) { i++; continue; }
    queue.splice(i, 1);
    start(e);
  }
  publish();
}

function start(e: Entry<unknown>) {
  e.info.status = 'running';
  e.info.startedAt = Date.now();
  running.set(e.info.id, e);
  const s = hasLiveSettings() ? liveSettings() : null;
  const model = modelForJob(e.info.kind, s, hardware.get().agentModel);
  if (e.info.priority < 2) reportActivity({ id: `agent-${e.info.id}`, kind: 'chat', label: e.info.label });
  e.fn({ signal: e.ctrl.signal, model, numCtx: effectiveNumCtx() })
    .then((v) => e.resolve(v), (err) => e.reject(err))
    .finally(() => {
      running.delete(e.info.id);
      if (e.info.priority < 2) reportActivity({ id: `agent-${e.info.id}`, kind: 'chat', label: 'Done', done: true });
      pump();
    });
}

export const agentPool = {
  /** Queue a job; resolves with its result. Abort with `opts.signal` or `agentPool.cancel(id)`. */
  run<T>(label: string, kind: JobKind, fn: (c: JobCtx) => Promise<T>, opts: { priority?: 0 | 1 | 2; signal?: AbortSignal; id?: string } = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const ctrl = new AbortController();
      const info: JobInfo = { id: opts.id ?? uid('job'), label, kind, priority: opts.priority ?? 1, status: 'queued', queuedAt: Date.now() };
      const e: Entry<T> = { info, fn, resolve, reject, ctrl };
      opts.signal?.addEventListener('abort', () => agentPool.cancel(info.id), { once: true });
      queue.push(e as Entry<unknown>);
      pump();
    });
  },
  cancel(id: string) {
    const qi = queue.findIndex((e) => e.info.id === id);
    if (qi >= 0) { const [e] = queue.splice(qi, 1); e.ctrl.abort(); e.reject(new DOMException('Cancelled', 'AbortError')); publish(); return; }
    running.get(id)?.ctrl.abort();
  },
  /** Chat sets this while a reply streams; housekeeping jobs wait for it. */
  setForegroundBusy(v: boolean) { foregroundBusy = v; if (!v) pump(); },
  get: () => snapshot,
  subscribe: (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn); }; },
};

// A new VRAM reading can raise or lower the limit: start waiting jobs if there is room now.
hardware.subscribe(() => { if (queue.length) pump(); else if (snapshot.limit !== currentLimit()) publish(); });

export function useAgentPool() {
  return useSyncExternalStore(agentPool.subscribe, agentPool.get, agentPool.get);
}
