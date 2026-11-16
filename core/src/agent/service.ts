// The agent as the core serves it: starts runs, streams their events to every window, holds
// approvals until the user answers, and records runs and steps in lotus.db.
//
// RPC (server.ts):
//   agent_start  { model, messages, prompt, chatId?, options?, memoryOn?, web?, folders? } → { runId }
//   agent_decide { runId, stepId, allow }
//   agent_stop   { runId }
//   agent_tools  → the tools and their risk (Settings → Tools)
//   agent_run    { runId } → the run with its steps
//   agent_runs   { limit? } → recent runs
// Events: { type: 'agent', runId, kind: 'token' | 'thinking' | 'reset' | 'step' | 'stats' | 'done' | 'error', … }

import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Db } from '../db';
import { kvApply, kvGet } from '../kv';
import { runAgent } from './loop';
import { DEFAULT_DENY, isApprovalMode, parseRules } from './policy';
import { Registry } from './registry';
import { closeStaleRuns, finishRun, getRun, listRuns, pruneRuns, saveStep, startRun } from './runs';
import type { WireMsg } from './llm';
import { authHeader } from './llm';
import type { AgentEvent, ApprovalMode, Step, Tool } from './types';
import { FILE_TOOLS } from '../tools/files';
import { TASK_TOOLS } from '../tools/tasks';
import { imageGenerate } from '../tools/image';
import { MEMORY_TOOLS } from '../tools/memory';
import { WEB_TOOLS } from '../tools/web';
import { WORK_TOOLS, listArtifacts } from '../tools/work';
import { COMPUTER_TOOLS } from '../tools/computer';
import { BROWSER_TOOLS } from '../tools/browser';
import { avatarCreate } from '../tools/avatar';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ALL_TOOLS: Tool[] = [...FILE_TOOLS, ...TASK_TOOLS, imageGenerate, ...MEMORY_TOOLS, ...WEB_TOOLS, ...WORK_TOOLS, ...COMPUTER_TOOLS, ...BROWSER_TOOLS, avatarCreate];

/** Tools only Work mode gets (they need a work folder or are about long jobs). */
const WORK_ONLY = new Set(['plan.set', 'plan.check', 'artifact.write', 'artifact.read', 'agent.delegate']);

/** A work id from the UI, as a safe folder name. */
export const workFolderName = (id: string) => String(id ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);

const WORK_PROMPT = `\n\nYou are working in Lotus's Work mode: the user hands you a job and expects a finished result, not advice.
- For anything with more than two steps, call plan.set first, then work through the plan and tick each step with plan.check.
- Deliver the result as artifacts with artifact.write (documents as .md, web pages as one self-contained .html, tables as .csv, code in its own file). Write the whole content.
- For big jobs, hand self-contained parts to helper agents with agent.delegate and combine what they return.
- If you are blocked or a choice is the user's to make, use ask.user with short options instead of guessing.
- Finish with a short summary of what you made and where it is.`;

export interface AgentSettings { approval: ApprovalMode; deny: string[]; folders: string[]; backend: 'ollama' | 'llamacpp' | 'builtin'; llamacppUrl: string; contextWindow: number; enabled: boolean; computerUse: boolean; browserUse: boolean }

export function readAgentSettings(db: Db): AgentSettings {
  let s: Record<string, unknown> = {};
  try { s = JSON.parse(kvGet(db, 'lotus.settings.v1') || '{}'); } catch { /* defaults */ }
  return {
    approval: isApprovalMode(s.agentApproval) ? s.agentApproval : 'risky',
    deny: Array.isArray(s.agentDeny) ? s.agentDeny.map(String) : DEFAULT_DENY,
    folders: Array.isArray(s.agentFolders) ? s.agentFolders.map(String) : [],
    backend: s.llmBackend === 'llamacpp' ? 'llamacpp' : s.llmBackend === 'builtin' ? 'builtin' : 'ollama',
    contextWindow: typeof s.contextWindow === 'number' ? s.contextWindow : 0,
    llamacppUrl: typeof s.llamacppUrl === 'string' && s.llamacppUrl ? s.llamacppUrl : 'http://127.0.0.1:8080',
    enabled: s.agentTools !== false,
    computerUse: s.computerUse === true,
    browserUse: s.browserUse === true,
  };
}

export interface StartArgs {
  model: string;
  messages: WireMsg[];
  prompt: string;
  chatId?: string;
  options?: { temperature?: number; topP?: number; topK?: number; numCtx?: number; seed?: number; numPredict?: number; stop?: string[]; think?: boolean; thinkBudget?: number };
  memoryOn?: boolean;
  web?: boolean;
  /** Extra folders for this run (the chat's attached folder). */
  folders?: string[];
  /** Limit to these tools (tests, routines). */
  only?: string[];
  /** Work mode: the piece of work this run belongs to (its artifacts folder). */
  workId?: string;
  capabilities?: string[];
}

const isDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const APPROVAL_TIMEOUT = 15 * 60_000;

export class AgentService {
  private runs = new Map<string, AbortController>();
  private waits = new Map<string, (allow: boolean) => void>();
  private asks = new Map<string, (answer: string) => void>();
  readonly registry = new Registry(ALL_TOOLS);

  constructor(private o: { db: Db; studio: string; broadcast: (e: Record<string, unknown>) => void; fetch?: typeof fetch; log?: (m: string) => void; builtins?: import('../engines/manager').Builtins }) {
    closeStaleRuns(o.db);
    pruneRuns(o.db);
  }

  private kvSet = (key: string, value: string) => {
    const done = kvApply(this.o.db, { set: { [key]: value }, remove: [] });
    this.o.broadcast({ type: 'kv', ...done, origin: 'core' });
  };

  /** The folders a run may use: the Lotus Studio folder, Settings → Tools, and the chat's folder. */
  folders(extra: string[] = []): string[] {
    const s = readAgentSettings(this.o.db);
    const all = [...extra, ...s.folders, this.o.studio].map((f) => resolve(String(f))).filter((f) => f && isDir(f));
    return [...new Set(all)];
  }

  toolsFor(a: Pick<StartArgs, 'memoryOn' | 'web' | 'only' | 'workId'>): Tool[] {
    const s = readAgentSettings(this.o.db);
    return ALL_TOOLS.filter((t) => {
      if (a.only && !a.only.includes(t.name)) return false;
      if (t.name.startsWith('memory.') && !a.memoryOn) return false;
      if (t.name.startsWith('web.') && !a.web && !a.workId) return false;
      if (WORK_ONLY.has(t.name) && !a.workId) return false;
      if (t.name.startsWith('computer.') && !s.computerUse) return false;
      if (t.name.startsWith('browser.') && !s.browserUse) return false;
      return true;
    });
  }

  /** Lotus Studio/Work/<id>: where a piece of work keeps its artifacts. */
  workDir(id: string): string | null {
    const f = workFolderName(id);
    return f ? join(this.o.studio, 'Work', f) : null;
  }

  artifacts(id: string) { const d = this.workDir(id); return d ? listArtifacts(d) : []; }
  artifactText(id: string, file: string): string {
    const d = this.workDir(id);
    const hit = d && listArtifacts(d).find((x) => x.file === file);
    if (!d || !hit) throw new Error('That artifact is no longer in the work folder.');
    return readFileSync(join(d, hit.file), 'utf8');
  }

  answer(runId: string, askId: string, answer: string): boolean {
    const f = this.asks.get(`${runId}/${askId}`);
    if (!f) return false;
    f(String(answer ?? ''));
    return true;
  }

  start(a: StartArgs): { runId: string } {
    if (!a.model) throw new Error('No model selected. Pick one in the chat box, or download one in Settings → Models.');
    if (!Array.isArray(a.messages) || !a.messages.length) throw new Error('Nothing to send.');
    const s = readAgentSettings(this.o.db);
    const runId = `run-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const ctrl = new AbortController();
    this.runs.set(runId, ctrl);
    startRun(this.o.db, { id: runId, chatId: a.chatId, model: a.model, prompt: a.prompt ?? '' });
    const emit = (e: AgentEvent) => this.o.broadcast({ type: 'agent', runId, ...e });
    const fetchFn = this.o.fetch ?? fetch;
    let ollama = 'http://127.0.0.1:11434', auth: string | null = null;
    try { const m = JSON.parse(kvGet(this.o.db, 'lotus.engineUrls.v1') || '{}'); if (m.ollama) ollama = String(m.ollama).replace(/\/+$/, ''); } catch { /* default */ }
    try { auth = authHeader(JSON.parse(kvGet(this.o.db, 'lotus.engineAuth.v1') || '{}').ollama); } catch { /* none */ }
    const folders = this.folders(a.folders);
    const tools = this.toolsFor(a);
    const messages = a.messages.map((m) => ({ ...m }));
    const workDir = a.workId ? this.workDir(a.workId) ?? undefined : undefined;
    if (workDir) {
      mkdirSync(workDir, { recursive: true });
      if (messages[0]?.role === 'system') messages[0] = { ...messages[0], content: `${messages[0].content}${WORK_PROMPT}` };
      else messages.unshift({ role: 'system', content: WORK_PROMPT.trim() });
    }
    if (tools.some((t) => t.name.startsWith('computer.')) && messages[0]?.role === 'system') {
      messages[0] = { ...messages[0], content: `${messages[0].content}\n\nYou can see and use the user's computer (computer.*). Always take a screenshot before clicking and after each action to check it worked. Prefer browser.* tools for websites.` };
    }
    // ask.user: the question goes to every window (chat, Work, the island), spoken aloud there if the
    // user turned voice on, and the first answer wins.
    let askSeq = 0;
    const ask = (question: string, options: string[]) => new Promise<string>((done) => {
      const askId = `ask${++askSeq}`;
      const key = `${runId}/${askId}`;
      const finish = (v: string) => { if (!this.asks.has(key)) return; this.asks.delete(key); clearTimeout(t); ctrl.signal.removeEventListener('abort', onAbort); emit({ kind: 'answered', askId }); done(v); };
      const onAbort = () => finish('');
      const t = setTimeout(() => finish(''), 30 * 60_000);
      ctrl.signal.addEventListener('abort', onAbort);
      this.asks.set(key, finish);
      emit({ kind: 'ask', askId, question, options });
    });
    if (tools.some((t) => t.name.startsWith('files.')) && messages[0]?.role === 'system') {
      // The user's attached folder (Chat's or Work's Choose Folder) comes first: open files there with the
      // tools as needed instead of expecting them in the conversation (0.9.1).
      const attached = (a.folders ?? []).map((f) => resolve(String(f))).find((f) => folders.includes(f));
      const note = attached ? ` The user attached ${attached} to this conversation: when they mention "the folder", "my files" or files by name, they mean files there. Look with files.list and files.search, read with files.read, change part of a file with files.edit, and create or replace whole files with files.write.` : '';
      messages[0] = { ...messages[0], content: `${messages[0].content}\n\nFolders you can use with the file tools: ${folders.join(', ')} (the last one is the Lotus Studio folder; save new notes there unless the user names another place).${note}` };
    }

    const llm: { backend: 'ollama' | 'llamacpp'; nativeTools?: boolean; url: string; auth: string | null; fetch: typeof fetchFn } & NonNullable<StartArgs['options']> = {
      backend: s.backend === 'ollama' ? 'ollama' : 'llamacpp', nativeTools: s.backend === 'builtin',
      url: s.backend === 'ollama' ? ollama : s.llamacppUrl.replace(/\/+$/, ''), auth: s.backend === 'ollama' ? auth : null, fetch: fetchFn, ...a.options,
    };
    let helperSeq = 0;
    void (async () => {
      try {
        if (s.backend === 'builtin') {
          // The built-in engine loads the chosen model on first use (and swaps models when asked).
          if (!this.o.builtins) throw new Error('The built-in chat engine is not available in this build.');
          llm.url = await this.o.builtins.ensureChat(a.model, { ctx: a.options?.numCtx || s.contextWindow || undefined });
        }
        const out = await runAgent({
          runId, model: a.model, messages, tools, approval: s.approval, rules: parseRules(s.deny), capabilities: a.capabilities, maxTurns: workDir ? 24 : undefined,
        }, {
          llm,
          registry: this.registry,
          ctx: { db: this.o.db, studio: this.o.studio, builtins: this.o.builtins, folders, kvSet: this.kvSet, kvGet: (k) => kvGet(this.o.db, k), fetch: fetchFn, memoryOn: !!a.memoryOn, workDir, ask,
            delegate: workDir ? (goal, context, name) => this.helper(runId, ++helperSeq, { goal, context, name, model: a.model, tools: tools.filter((t) => t.name !== 'agent.delegate' && t.name !== 'ask.user'), llm, s, workDir, folders, memoryOn: !!a.memoryOn, fetchFn, signal: ctrl.signal, emit, approve: (st) => this.waitFor(runId, st, ctrl.signal) }) : undefined },
          signal: ctrl.signal,
          emit,
          record: (st, seq) => {
            saveStep(this.o.db, st, seq);
            if (st.tool === 'memory.save' && st.status === 'done') this.o.broadcast({ type: 'memory' });
          },
          approve: (st) => this.waitFor(runId, st, ctrl.signal),
        });
        const status = ctrl.signal.aborted ? 'stopped' : 'done';
        finishRun(this.o.db, runId, { status, reply: out.content, mode: out.mode, unverified: out.unverified });
        emit({ kind: 'done', content: out.content, unverified: out.unverified, steps: out.steps.length, mode: out.mode });
      } catch (e) {
        const stopped = ctrl.signal.aborted || (e as Error)?.name === 'AbortError';
        const message = stopped ? 'Stopped' : (e as Error)?.message || String(e);
        finishRun(this.o.db, runId, { status: stopped ? 'stopped' : 'error', reply: message });
        if (stopped) emit({ kind: 'done', content: '', unverified: [], steps: 0, mode: 'tags' });
        else { this.o.log?.(`agent ${runId}: ${message}`); emit({ kind: 'error', message }); }
      } finally {
        this.runs.delete(runId);
      }
    })();
    return { runId };
  }

  /**
   * A helper agent (agent.delegate): its own conversation and turn budget, the parent's tools minus
   * delegating and asking, the parent's approvals. Its steps show inside the parent run, tagged with
   * the helper's name so the UI can give each helper its own face.
   */
  private async helper(runId: string, n: number, h: {
    goal: string; context: string; name?: string; model: string; tools: Tool[]; llm: Parameters<typeof runAgent>[1]['llm']; s: AgentSettings; workDir: string; folders: string[];
    memoryOn: boolean; fetchFn: typeof fetch; signal: AbortSignal; emit: (e: AgentEvent) => void; approve: (st: Step) => Promise<boolean>;
  }): Promise<{ content: string; steps: number; ok: boolean }> {
    const name = (h.name ?? '').trim().slice(0, 40) || `Helper ${n}`;
    const subId = `${runId}-h${n}`;
    const out = await runAgent({
      runId: subId, model: h.model, tools: h.tools, approval: h.s.approval, rules: parseRules(h.s.deny), maxTurns: 10,
      messages: [
        { role: 'system', content: `You are ${name}. You are a helper agent working for Lotus on one part of a bigger job. Do exactly the goal below with your tools, then reply with the result itself (facts, text, file names you saved), not a description of your process. Be concise.` },
        { role: 'user', content: `Goal: ${h.goal}${h.context ? `\n\nContext:\n${h.context}` : ''}` },
      ],
    }, {
      llm: h.llm, registry: this.registry,
      ctx: { db: this.o.db, studio: this.o.studio, folders: h.folders, kvSet: this.kvSet, kvGet: (k) => kvGet(this.o.db, k), fetch: h.fetchFn, memoryOn: h.memoryOn, workDir: h.workDir },
      signal: h.signal,
      emit: (e) => { if (e.kind === 'step') h.emit({ kind: 'step', step: { ...e.step, data: { ...(e.step.data ?? {}), helper: name, goal: h.goal.slice(0, 120) } } }); },
      record: (st, seq) => saveStep(this.o.db, { ...st, runId }, 1000 * n + seq),
      approve: h.approve,
    });
    return { content: out.content, steps: out.steps.length, ok: out.steps.every((x) => x.status !== 'error') || !!out.content };
  }

  private waitFor(runId: string, st: Step, signal: AbortSignal): Promise<boolean> {
    const key = `${runId}/${st.id}`;
    return new Promise<boolean>((done) => {
      const finish = (v: boolean) => { if (!this.waits.has(key)) return; this.waits.delete(key); clearTimeout(t); signal.removeEventListener('abort', onAbort); done(v); };
      const onAbort = () => finish(false);
      const t = setTimeout(() => finish(false), APPROVAL_TIMEOUT);
      signal.addEventListener('abort', onAbort);
      this.waits.set(key, finish);
    });
  }

  decide(runId: string, stepId: string, allow: boolean): boolean {
    const f = this.waits.get(`${runId}/${stepId}`);
    if (!f) return false;
    f(!!allow);
    return true;
  }

  stop(runId: string): boolean {
    const c = this.runs.get(runId);
    if (!c) return false;
    c.abort();
    return true;
  }

  stopAll() { for (const c of this.runs.values()) c.abort(); }

  describeTools() {
    return ALL_TOOLS.map((t) => ({ name: t.name, label: t.label, description: t.description, risk: t.risk }));
  }

  run(runId: string) { return getRun(this.o.db, runId); }
  list(limit = 50) { return listRuns(this.o.db, limit); }
  running() { return [...this.runs.keys()]; }
}

