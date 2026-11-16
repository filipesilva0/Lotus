// The web side of the core's agent (core/src/agent/service.ts): start a run, follow its events,
// answer approvals, stop it. Steps arrive as they happen, each with its real result.

import { coreState, onCoreEvent, rpc } from './core';
import { storeMode } from './store';

export type StepStatus = 'waiting' | 'running' | 'done' | 'error' | 'denied';
export interface AgentStep {
  id: string; runId: string; tool: string; label: string; args: Record<string, unknown>; status: StepStatus;
  detail?: string; ask?: string; media?: string[]; data?: Record<string, unknown>; started: number; finished?: number;
}
export type AgentEvent =
  | { kind: 'token'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'reset'; keep: number }
  | { kind: 'step'; step: AgentStep }
  | { kind: 'stats'; tokensPerSec: number; durationMs: number; promptTokens?: number; evalTokens?: number }
  | { kind: 'done'; content: string; unverified: string[]; steps: number; mode: 'native' | 'tags' }
  | { kind: 'error'; message: string }
  | { kind: 'ask'; askId: string; question: string; options: string[] }
  | { kind: 'answered'; askId: string };

export interface AgentMessage { role: 'system' | 'user' | 'assistant'; content: string; images?: string[] }

export interface AgentStart {
  model: string;
  messages: AgentMessage[];
  prompt: string;
  chatId?: string;
  options?: { temperature?: number; topP?: number; topK?: number; numCtx?: number; seed?: number; numPredict?: number; stop?: string[]; think?: boolean; thinkBudget?: number };
  memoryOn?: boolean;
  web?: boolean;
  folders?: string[];
  /** Work mode: the piece of work (artifacts go to Lotus Studio/Work/<workId>). */
  workId?: string;
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

export const decideStep = (runId: string, stepId: string, allow: boolean) => rpc<boolean>('agent_decide', { runId, stepId, allow });

export const listTools = (folders: string[] = []) => rpc<{ tools: ToolInfo[]; folders: string[]; studio: string }>('agent_tools', { folders });

/** Answers an agent's ask.user question (typed, a picked option, or spoken). */
export const answerAsk = (runId: string, askId: string, answer: string) => rpc<boolean>('agent_answer', { runId, askId, answer });

export interface ArtifactInfo { file: string; title: string; kind: string; bytes: number; updated: number }
export const workArtifacts = (workId: string) => rpc<ArtifactInfo[]>('work_artifacts', { workId });
export const workArtifact = (workId: string, file: string) => rpc<string>('work_artifact', { workId, file });
export const workDir = (workId: string) => rpc<string | null>('work_dir', { workId });
