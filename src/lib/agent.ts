// The web side of the core's agent (core/src/agent/service.ts): start a run, follow its events,
// answer approvals, stop it. Steps arrive as they happen, each with its real result.

import { coreFetch, coreState, onCoreEvent, rpc } from './core';
import { storeMode } from './store';

export type StepStatus = 'waiting' | 'running' | 'done' | 'error' | 'denied';
export interface AgentStep {
  id: string; runId: string; tool: string; label: string; args: Record<string, unknown>; status: StepStatus;
  detail?: string; ask?: string; always?: string; media?: string[]; data?: Record<string, unknown>; started: number; finished?: number;
}
export type AgentEvent =
  | { kind: 'token'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'reset'; keep: number }
  | { kind: 'step'; step: AgentStep }
  | { kind: 'stats'; tokensPerSec: number; durationMs: number; promptTokens?: number; evalTokens?: number }
  | { kind: 'done'; content: string; unverified: string[]; steps: number; mode: 'native' | 'tags'; /** 0.20.0: the model never answered; content is Lotus's note. */ unfinished?: boolean }
  | { kind: 'error'; message: string }
  | { kind: 'ask'; askId: string; question: string; options: string[] }
  | { kind: 'answered'; askId: string; timedOut?: boolean }
  | { kind: 'helper'; helper: HelperInfo };

/** A helper agent of a Work run (0.11.0; core/src/agent/types.ts HelperInfo). */
export interface HelperInfo {
  id: string; name: string; goal: string; status: 'queued' | 'running' | 'done' | 'error' | 'stopped';
  steps: number; current?: string; result?: string; batch?: string; started: number; finished?: number;
}

export interface AgentMessage { role: 'system' | 'user' | 'assistant'; content: string; images?: string[] }

export interface AgentStart {
  model: string;
  messages: AgentMessage[];
  prompt: string;
  chatId?: string;
  options?: { temperature?: number; topP?: number; topK?: number; numCtx?: number; seed?: number; numPredict?: number; stop?: string[]; think?: boolean; frequencyPenalty?: number; presencePenalty?: number };
  /** Think mode: analyse, act with tools, review (core/src/agent/loop.ts). */
  think?: boolean;
  memoryOn?: boolean;
  web?: boolean;
  folders?: string[];
  /** Work mode: the piece of work (artifacts go to Lotus Studio/Work/<workId>). */
  workId?: string;
  /** A task or routine run nobody may be watching: approvals and questions give up after a while, saying so. */
  unattended?: boolean;
  /** Run history: where the run came from when it isn't plain Chat (Work and the island are told apart by workId / chatId 'island'). */
  source?: 'call';
}

export interface ToolInfo { name: string; label: string; description: string; risk: 'read' | 'write' | 'risky' }

/** Tools can run only with the core (the desktop app); the browser preview has none. */
export const agentAvailable = () => storeMode() === 'core' && !!coreState().info;

/**
 * Starts a run and calls `on` for each of its events until it ends. Resolves with the final event.
 * Aborting `signal` stops the run in the core.
 */
export async function runAgent(a: AgentStart, on: (e: AgentEvent) => void, signal?: AbortSignal): Promise<Extract<AgentEvent, { kind: 'done' }>> {
  // Listen before starting so no early event is missed; buffer until the run id is known.
  const early: (AgentEvent & { runId: string })[] = [];
  let runId = '';
  let finish: (e: AgentEvent) => void = () => undefined;
  const ended = new Promise<AgentEvent>((r) => { finish = r; });
  const deliver = (e: AgentEvent) => { on(e); if (e.kind === 'done' || e.kind === 'error') finish(e); };
  const off = onCoreEvent((raw) => {
    const e = raw as unknown as AgentEvent & { type: string; runId: string };
    if (e.type !== 'agent') return;
    if (!runId) { early.push(e); return; }
    if (e.runId === runId) deliver(e);
  });
  try {
    runId = (await rpc<{ runId: string }>('agent_start', a as unknown as Record<string, unknown>)).runId;
    early.filter((e) => e.runId === runId).forEach(deliver);
    const stop = () => { void rpc('agent_stop', { runId }).catch(() => undefined); };
    if (signal?.aborted) stop(); else signal?.addEventListener('abort', stop, { once: true });
    const last = await ended;
    signal?.removeEventListener('abort', stop);
    if (last.kind === 'error') throw new Error(last.message);
    return last as Extract<AgentEvent, { kind: 'done' }>;
  } finally { off(); }
}

/** Stops a run in the core (false when the core isn't running it). */
export const stopRun = (runId: string) => rpc<boolean>('agent_stop', { runId });

/** Allow / Deny a waiting step; `always` also saves the step's Always-allow rule (Settings → Tools lists them). */
export const decideStep = (runId: string, stepId: string, allow: boolean, always = false) => rpc<boolean>('agent_decide', { runId, stepId, allow, always });

export const listTools = (folders: string[] = []) => rpc<{ tools: ToolInfo[]; folders: string[]; studio: string }>('agent_tools', { folders });

/** Run history (Tasks → Activity, phase 2). */
export type RunSource = 'chat' | 'work' | 'island' | 'task' | 'routine' | 'call';
export interface RunSummary {
  id: string; chatId: string | null; created: number; finished: number | null; model: string; mode: string | null;
  status: 'running' | 'done' | 'error' | 'stopped'; prompt: string; reply: string | null; unverified: string[];
  source: RunSource | null; ref: string | null; steps?: number;
}
export type RunDetail = Omit<RunSummary, 'steps'> & { steps: AgentStep[] };
export const listRuns = (f: { limit?: number; source?: RunSource; ref?: string; query?: string; before?: number } = {}) => rpc<RunSummary[]>('agent_runs', f);
export const getRun = (runId: string) => rpc<RunDetail | null>('agent_run', { runId });

/** Answers an agent's ask.user question (typed, a picked option, or spoken). */
export const answerAsk = (runId: string, askId: string, answer: string) => rpc<boolean>('agent_answer', { runId, askId, answer });

export interface ArtifactInfo { file: string; title: string; kind: string; bytes: number; updated: number }
export const workArtifacts = (workId: string) => rpc<ArtifactInfo[]>('work_artifacts', { workId });
export const workArtifact = (workId: string, file: string) => rpc<string>('work_artifact', { workId, file });
export const workDir = (workId: string) => rpc<string | null>('work_dir', { workId });
/** 0.21: a video, sound or picture a job made, as a blob the Artifacts panel can play. */
export const workFile = async (workId: string, file: string): Promise<Blob> => {
  const r = await coreFetch(`/v1/work-file?${new URLSearchParams({ workId, file })}`);
  if (!r.ok) throw new Error('That artifact is no longer in the work folder.');
  return r.blob();
};
/** Artifacts shown as media rather than read as text. */
export const isMediaArtifact = (a: Pick<ArtifactInfo, 'kind'>) => a.kind === 'video' || a.kind === 'audio' || a.kind === 'picture';
