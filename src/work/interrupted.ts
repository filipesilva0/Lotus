// Work replies cut off by a restart (0.15.1). A Work reply lives in the app's saved state while its
// run streams in. If the app or the core closes mid-run, the saved reply keeps its last live state
// ("3 agents working", spinning steps) and nothing would ever finish it. On startup, before
// anything can be running again, such replies are marked interrupted: their agents and steps are
// closed, and the Work page shows "Lotus closed before this finished" with Try again.
//
// Kept free of React and the core client so the core's tests can run it.

// The parts of a Work message (store.ts WorkMsg, lib/agent.ts AgentStep and HelperInfo) this file
// reads, written out here because those files need React and the browser window.
type StepState = { status: 'waiting' | 'running' | 'done' | 'error' | 'denied'; detail?: string; finished?: number };
type AgentState = { status: 'queued' | 'running' | 'done' | 'error' | 'stopped'; current?: string; finished?: number };
export interface ReplyState {
  role: 'user' | 'assistant'; content: string; steps?: StepState[]; agents?: AgentState[]; error?: string; unverified?: string[];
  runId?: string; pending?: boolean; ended?: number; stopped?: boolean; interrupted?: boolean;
}
type Item<M> = { messages: M[] };

/** What a step that never finished says once it is closed (the core says the same in its run history). */
export const CUT_OFF_STEP = 'Lotus closed before this step finished.';

const LIVE_STEP: StepState['status'][] = ['running', 'waiting'];
const LIVE_AGENT: AgentState['status'][] = ['queued', 'running'];

/**
 * Whether a saved reply was still being written when Lotus closed. New replies carry `pending`
 * until their run ends and `ended` after; replies saved before 0.15.1 have neither and are judged
 * by what they show: a step or agent still going, or nothing at all (no text and no error).
 */
export function wasCutOff(m: ReplyState): boolean {
  if (m.role !== 'assistant' || m.interrupted) return false;
  if (m.pending) return true;
  if (m.ended || m.stopped) return false;
  if ((m.steps ?? []).some((s) => LIVE_STEP.includes(s.status))) return true;
  if ((m.agents ?? []).some((h) => LIVE_AGENT.includes(h.status))) return true;
  return !m.content.trim() && !m.error && !m.unverified?.length;
}

/** Closes one cut-off reply: its agents stop, its unfinished steps end with a note, and it says it was interrupted. */
export function closeReply<M extends ReplyState>(m: M, now = Date.now()): M {
  const { pending: _p, ...rest } = m;
  return {
    ...(rest as M),
    interrupted: true,
    ...(m.steps ? { steps: m.steps.map((s) => (LIVE_STEP.includes(s.status) ? { ...s, status: 'error' as const, detail: CUT_OFF_STEP, finished: s.finished ?? now } : s)) } : {}),
    ...(m.agents ? { agents: m.agents.map((h) => (LIVE_AGENT.includes(h.status) ? { ...h, status: 'stopped' as const, current: undefined, finished: h.finished ?? now } : h)) } : {}),
  };
}

/**
 * Marks every cut-off reply in the saved Work list as interrupted. Returns the same list object
 * when nothing needed closing, and the core run ids of the closed replies (so a run the core may
 * still be doing after a window reload can be stopped).
 */
export function markInterrupted<M extends ReplyState, W extends Item<M>>(items: W[], now = Date.now()): { items: W[]; runIds: string[] } {
  const runIds: string[] = [];
  let changed = false;
  const next = items.map((w) => {
    if (!w.messages.some(wasCutOff)) return w;
    changed = true;
    return { ...w, messages: w.messages.map((m) => {
      if (!wasCutOff(m)) return m;
      if (m.runId) runIds.push(m.runId);
      return closeReply(m, now);
    }) };
  });
  return { items: changed ? next : items, runIds };
}

/** "2 of 3 agents had finished" for an interrupted reply's note (empty when it deployed none). */
export function agentsFinishedNote(m: ReplyState): string {
  const list = m.agents ?? [];
  if (!list.length) return '';
  const done = list.filter((h) => h.status === 'done').length;
  return list.length === 1 ? (done ? 'Its agent had finished.' : 'Its agent had not finished.')
    : `${done} of ${list.length} agents had finished.`;
}
