// Permission requests and questions from Lotus's agents that are still waiting for an answer, from any
// window's runs (tasks and routines run unattended, so the Tasks page shows them too; STATE #6/#12).

import { useSyncExternalStore } from 'react';
import { onCoreEvent } from './core';

export interface PendingPerm { runId: string; stepId: string; text: string }
export interface PendingAsk { runId: string; askId: string; question: string; options: string[] }
interface State { perms: PendingPerm[]; asks: PendingAsk[] }

let st: State = { perms: [], asks: [] };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };

/** Pure: the pending lists after one core event. */
export function applyAgentEvent(s: State, e: Record<string, any>): State { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (e?.type !== 'agent') return s;
  if (e.kind === 'ask') return s.asks.some((a) => a.runId === e.runId && a.askId === e.askId) ? s : { ...s, asks: [...s.asks, { runId: e.runId, askId: e.askId, question: String(e.question ?? ''), options: Array.isArray(e.options) ? e.options.map(String) : [] }] };
  if (e.kind === 'answered') return { ...s, asks: s.asks.filter((a) => !(a.runId === e.runId && a.askId === e.askId)) };
  if (e.kind === 'step' && e.step) {
    const rest = s.perms.filter((p) => p.stepId !== e.step.id);
    return e.step.status === 'waiting' ? { ...s, perms: [...rest, { runId: e.runId, stepId: e.step.id, text: String(e.step.ask ?? e.step.label ?? '') }] } : rest.length === s.perms.length ? s : { ...s, perms: rest };
  }
  if (e.kind === 'done' || e.kind === 'error') return { perms: s.perms.filter((p) => p.runId !== e.runId), asks: s.asks.filter((a) => a.runId !== e.runId) };
  return s;
}

let on = false;
function start() {
  if (on) return;
  on = true;
  onCoreEvent((raw) => { const next = applyAgentEvent(st, raw as Record<string, unknown>); if (next !== st) set(next); });
}

export function usePending(): State {
  start();
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => st, () => st);
}
