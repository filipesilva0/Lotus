// The agent's shared types: tools, steps, events.

import type { Db } from '../db';

/**
 * How much a tool can change:
 *   read   looks at things (files, tasks, memory); never asked about except in "Ask every time"
 *   write  makes something new or changes Lotus's own data (a task, an image, a memory)
 *   risky  changes the user's files or sends something off this computer; asked about by default
 */
export type Risk = 'read' | 'write' | 'risky';

export type JsonSchema = {
  type: 'object';
  properties: Record<string, { type: 'string' | 'number' | 'integer' | 'boolean' | 'array'; description: string; enum?: string[]; items?: { type: string }; /** Other words models use for enum values (not sent to the model). */ aliases?: Record<string, string> }>;
  required?: string[];
};

export interface ToolResult {
  /** True when the tool did what it was asked. */
  ok: boolean;
  /** What the model reads back (kept short). */
  text: string;
  /** One line for the step in the chat ("Added “Buy milk” to To do"). */
  summary: string;
  /** Saved image/audio files, relative to the Lotus Studio folder. */
  media?: string[];
  /** Anything the UI may want (task id, file path…). */
  data?: Record<string, unknown>;
}

export interface ToolCtx {
  db: Db;
  studio: string;
  signal: AbortSignal;
  /** Folders the file tools may use (absolute, already resolved). */
  folders: string[];
  /** Writes a kv key and tells every window (as if another window had saved it). */
  kvSet: (key: string, value: string) => void;
  kvGet: (key: string) => string | null;
  /** Network access for engines and the web (plain fetch in the core; replaced in tests). */
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** Progress for a long step ("Generating · 12 s"). */
  progress: (detail: string) => void;
  memoryOn: boolean;
  /** Work mode: the folder this piece of work keeps its artifacts in (Lotus Studio/Work/<id>). */
  workDir?: string;
  /** Asks the user a question and waits for the answer (typed, a picked option, or spoken). */
  ask?: (question: string, options: string[]) => Promise<string>;
  /** Runs a helper agent on one part of the job and returns its final answer and step count. */
  delegate?: (goal: string, context: string, name?: string) => Promise<{ content: string; steps: number; ok: boolean }>;
}

export interface Tool {
  /** Dotted name shown to people and used in deny rules: files.read, task.add… */
  name: string;
  /** Short label for the step while it runs ("Reading a file"). */
  label: string;
  description: string;
  parameters: JsonSchema;
  risk: Risk;
  run: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<ToolResult>;
  /** The step's one-line description of what it is about to do, for approval cards. */
  describe?: (args: Record<string, unknown>) => string;
}

export type StepStatus = 'waiting' | 'running' | 'done' | 'error' | 'denied';

export interface Step {
  id: string;
  runId: string;
  tool: string;
  label: string;
  args: Record<string, unknown>;
  status: StepStatus;
  /** What the step did or why it failed (one line). */
  detail?: string;
  /** Set while the step waits for Allow / Deny. */
  ask?: string;
  media?: string[];
  data?: Record<string, unknown>;
  started: number;
  finished?: number;
}

export type ApprovalMode = 'ask' | 'risky' | 'auto';

/** Events streamed to the windows over the core's socket: { type: 'agent', runId, ... }. */
export type AgentEvent =
  | { kind: 'token'; text: string }
  | { kind: 'thinking'; text: string }
  /** Drop the text of the current turn (the model is asked to redo a reply that claimed an action it didn't take). */
  | { kind: 'reset'; keep: number }
  | { kind: 'step'; step: Step }
  | { kind: 'stats'; tokensPerSec: number; durationMs: number; promptTokens?: number; evalTokens?: number }
  | { kind: 'done'; content: string; unverified: string[]; steps: number; mode: 'native' | 'tags' }
  | { kind: 'error'; message: string }
  /** The agent asked the user something (ask.user) and waits; answer with agent_answer. */
  | { kind: 'ask'; askId: string; question: string; options: string[] }
  | { kind: 'answered'; askId: string };
