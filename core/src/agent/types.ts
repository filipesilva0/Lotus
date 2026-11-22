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
  /** 0.22: the chat this run answers (memory.save puts chat notes here; memory.search reads them). */
  chatId?: string;
  /** Work mode: the folder this piece of work keeps its artifacts in (Lotus Studio/Work/<id>). */
  workDir?: string;
  /** Asks the user a question and waits for the answer (typed, a picked option, or spoken). */
  ask?: (question: string, options: string[]) => Promise<string | null>;
  /** Runs a helper agent on one part of the job and returns its final answer and step count. */
  delegate?: (goal: string, context: string, name?: string) => Promise<{ content: string; steps: number; ok: boolean; sources?: { title: string; url: string }[] }>;
  /** 0.11.0: runs several helper agents at once (agents.deploy), each on its own part; results in order. */
  deploy?: (jobs: { goal: string; name?: string }[], context: string) => Promise<{ name: string; content: string; steps: number; ok: boolean; sources?: { title: string; url: string }[] }[]>;
  /** The built-in engines (session 17): image.generate uses them when Settings → Engines picks Built in. */
  builtins?: import('../engines/manager').Builtins;
  /** 0.21: can Lotus Pro features be used now (copied voices)? Absent = yes (Pro switched off). */
  proUnlocked?: () => boolean;
  /** The task board and routines in lotus.db (phase 2). Without it (older tests) the tools use kv. */
  board?: BoardAccess;
}

/** What the task and routine tools need from the board: whole lists in, whole lists out. */
export interface BoardAccess {
  tasks(): import('../../../src/tasks/kanban').Task[];
  setTasks(list: import('../../../src/tasks/kanban').Task[]): void;
  routines(): import('../board').Routine[];
  setRoutines(list: import('../board').Routine[]): void;
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
  /**
   * Says why this particular call destroys something (emptying a file…), or null. Such a call always
   * waits for Allow, even in "Never ask" (deny rules still come first).
   */
  destructive?: (args: Record<string, unknown>, ctx: Pick<ToolCtx, 'folders'>) => string | null;
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
  /** While waiting: the rule "Always allow" would save (absent when it can't be offered). */
  always?: string;
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
  | { kind: 'done'; content: string; unverified: string[]; steps: number; mode: 'native' | 'tags'; /** 0.20.0: the model never answered; content is Lotus's note. */ unfinished?: boolean }
  | { kind: 'error'; message: string }
  /** The agent asked the user something (ask.user) and waits; answer with agent_answer. */
  | { kind: 'ask'; askId: string; question: string; options: string[] }
  | { kind: 'answered'; askId: string; timedOut?: boolean }
  /** 0.11.0: a helper agent was deployed, moved on, or finished (the Work page and the island show it). */
  | { kind: 'helper'; helper: HelperInfo };

/** One helper agent of a run, as the windows show it. */
export interface HelperInfo {
  /** `<runId>-h<n>`, unique per run. */
  id: string;
  name: string;
  goal: string;
  status: 'queued' | 'running' | 'done' | 'error' | 'stopped';
  /** Finished steps so far. */
  steps: number;
  /** What it is doing now ("Searching the web · best keyboards"). */
  current?: string;
  /** The start of its result, once done. */
  result?: string;
  /** Deployed together with these (agents.deploy batch), for "2 of 3 done". */
  batch?: string;
  started: number;
  finished?: number;
}
