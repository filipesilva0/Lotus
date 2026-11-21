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

import { ROUTINE_TOOLS } from '../tools/routines';
import { SOUL_TOOLS } from '../tools/soul';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Db } from '../db';
import { kvApply, kvGet } from '../kv';
import { engineChoice } from '../../../src/lib/engineDefaults';
import { APPROVAL_WAIT_MS, runAgent, type AgentOutcome } from './loop';
import { allowedBy, DEFAULT_DENY, isApprovalMode, parseRules } from './policy';
import { Registry } from './registry';
import { closeStaleRuns, finishRun, getRun, listRuns, pruneRuns, RUN_SOURCES, saveStep, startRun, type RunSource } from './runs';
import type { WireMsg } from './llm';
import { authHeader } from './llm';
import type { AgentEvent, ApprovalMode, HelperInfo, Step, Tool } from './types';
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

export const ALL_TOOLS: Tool[] = [...FILE_TOOLS, ...TASK_TOOLS, ...ROUTINE_TOOLS, ...SOUL_TOOLS, imageGenerate, ...MEMORY_TOOLS, ...WEB_TOOLS, ...WORK_TOOLS, ...COMPUTER_TOOLS, ...BROWSER_TOOLS, avatarCreate];

/** Tools only Work mode gets (they need a work folder or are about long jobs). */
const AVATAR_WORDS = /avatar|blob|face|mascot|character|persona|look like|icon/i;
const WORK_ONLY = new Set(['plan.set', 'plan.check', 'artifact.write', 'artifact.read', 'agent.delegate', 'agents.deploy']);

/** A work id from the UI, as a safe folder name. */
export const workFolderName = (id: string) => String(id ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);

const WORK_PROMPT = `\n\nYou are working in Lotus's Work mode: the user hands you a job and expects a finished result, not advice.
- For anything with more than two steps, call plan.set first, then work through the plan and tick each step with plan.check.
- Deliver the result as artifacts with artifact.write (documents as .md, web pages as one self-contained .html, tables as .csv, code in its own file). Write the whole content.
- Deploy agents by yourself, without being asked: when a job has two or more parts that don't depend on each other (several topics to research, separate sections or files to write, several things to check), call agents.deploy once with one line per agent ("Name: task") so they work at the same time, then combine what they return. For a single self-contained part use agent.delegate. The user watches each agent's task and progress.
- If you are blocked or a choice is the user's to make, use ask.user with short options instead of guessing.
- Finish with a short summary of what you made and where it is.`;

/** The pages a helper really found: what it read first, then search results (0.16.5, at most 8). */
export function helperSources(steps: Step[]): { title: string; url: string }[] {
  const out: { title: string; url: string }[] = [];
  const add = (title: unknown, url: unknown) => {
    const u = String(url ?? '').trim();
    if (/^https?:\/\//i.test(u) && !out.some((x) => x.url === u)) out.push({ title: String(title ?? '').trim() || u, url: u });
  };
  for (const s of steps) if (s.status === 'done' && s.tool === 'web.read') add(s.data?.title, s.data?.url);
  for (const s of steps) {
    if (s.status !== 'done' || s.tool !== 'web.search') continue;
    for (const r of (Array.isArray(s.data?.results) ? s.data!.results : []) as { title?: string; url?: string }[]) add(r.title, r.url);
  }
  return out.slice(0, 8);
}

/** A helper's answer plus the sources Lotus saw it find, so the lead agent can cite real pages, or a
 *  plain note when it found none (0.16.0: researchers came back empty and the brief invented references). */
export function withSources(content: string, sources: { title: string; url: string }[], searched: boolean): string {
  const body = content.trim();
  if (sources.length) return `${body}\n\nSources found:\n${sources.map((s) => `- ${s.title}: ${s.url}`).join('\n')}`.trim();
  if (!searched) return body;
  return `${body}${body ? '\n\n' : ''}(Lotus) This helper found no web sources. Anything above comes from the model's own knowledge and was not checked; don't cite sources for it.`;
}

/** Always-allow rules (Phase 2): their own key, so the app's settings saves never race the core's. */
export const ALLOW_KEY = 'lotus.agentAllow.v1';

export function readAllowRules(db: Db): string[] {
  try { const v = JSON.parse(kvGet(db, ALLOW_KEY) || '[]'); return Array.isArray(v) ? v.map(String).filter(Boolean) : []; } catch { return []; }
}

export interface AgentSettings { approval: ApprovalMode; deny: string[]; folders: string[]; backend: 'ollama' | 'llamacpp' | 'builtin'; llamacppUrl: string; contextWindow: number; autoScale: boolean; enabled: boolean; computerUse: boolean; browserUse: boolean;
  /** Settings → Engines "Most background agents at once" (0.20.0: Work's agents follow it too). */
  maxSubagents: number }

/**
 * How many of Work's agents run at once. Lotus's own engine serves one request at a time, so there they
 * take turns; Ollama and other servers run up to 3, never more than the user's "Most background agents".
 */
export function deployLimit(s: Pick<AgentSettings, 'backend' | 'maxSubagents'>): number {
  return s.backend === 'builtin' ? 1 : Math.max(1, Math.min(3, s.maxSubagents));
}

export function readAgentSettings(db: Db): AgentSettings {
  let s: Record<string, unknown> = {};
  try { s = JSON.parse(kvGet(db, 'lotus.settings.v1') || '{}'); } catch { /* defaults */ }
  return {
    approval: isApprovalMode(s.agentApproval) ? s.agentApproval : 'risky',
    deny: Array.isArray(s.agentDeny) ? s.agentDeny.map(String) : DEFAULT_DENY,
    folders: Array.isArray(s.agentFolders) ? s.agentFolders.map(String) : [],
    backend: engineChoice(kvGet(db, 'lotus.settings.v1')).llmBackend,
    contextWindow: typeof s.contextWindow === 'number' ? s.contextWindow : 0,
    autoScale: s.autoScale !== false,
    llamacppUrl: typeof s.llamacppUrl === 'string' && s.llamacppUrl ? s.llamacppUrl : 'http://127.0.0.1:8080',
    enabled: s.agentTools !== false,
    computerUse: s.computerUse === true,
    browserUse: s.browserUse === true,
    maxSubagents: typeof s.maxSubagents === 'number' && s.maxSubagents >= 1 ? Math.floor(s.maxSubagents) : 4,
  };
}

export interface StartArgs {
  model: string;
  messages: WireMsg[];
  prompt: string;
  chatId?: string;
  options?: { temperature?: number; topP?: number; topK?: number; numCtx?: number; seed?: number; numPredict?: number; stop?: string[]; think?: boolean; frequencyPenalty?: number; presencePenalty?: number };
  /** Think mode (Chat's brain button): analyse first, act with tools, then review the answer (loop.ts). */
  think?: boolean;
  memoryOn?: boolean;
  web?: boolean;
  /** Extra folders for this run (the chat's attached folder). */
  folders?: string[];
  /** Limit to these tools (tests, routines). */
  only?: string[];
  /** Work mode: the piece of work this run belongs to (its artifacts folder). */
  workId?: string;
  capabilities?: string[];
  /** A task or routine run nobody may be watching: approvals give up after 15 min and questions after 30, saying so (STATE #12). */
  unattended?: boolean;
  /** Run history (phase 2): where the run came from, and the task/routine it belongs to. */
  source?: RunSource;
  ref?: string;
}

/** Where a run came from when the caller didn't say. */
export function sourceOf(a: Pick<StartArgs, 'source' | 'workId' | 'chatId'>): RunSource {
  if (a.source && RUN_SOURCES.includes(a.source)) return a.source;
  if (a.workId) return 'work';
  if (a.chatId === 'island') return 'island';
  return 'chat';
}

const isDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const ASK_TIMEOUT = 30 * 60_000;

export class AgentService {
  private runs = new Map<string, AbortController>();
  private waits = new Map<string, { finish: (allow: boolean) => void; step: Step }>();
  private asks = new Map<string, (answer: string) => void>();
  readonly registry = new Registry(ALL_TOOLS);
  /** MCP tool servers (Advanced mode, 0.18.0), set by the server. Their tools join every run's. */
  mcp?: import('../mcp').McpHub;
  /** The task board (phase 2), set by the server once the board service exists. */
  board?: import('./types').BoardAccess;

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

  toolsFor(a: Pick<StartArgs, 'memoryOn' | 'web' | 'only' | 'workId'> & { prompt?: string }): Tool[] {
    const s = readAgentSettings(this.o.db);
    const mcp = this.mcp?.tools() ?? [];
    for (const t of mcp) this.registry.add(t);
    return [...ALL_TOOLS, ...mcp].filter((t) => {
      if (a.only && !a.only.includes(t.name)) return false;
      if (t.name.startsWith('memory.') && !a.memoryOn) return false;
      // Incognito and memory-off chats leave nothing lasting behind, the soul included (0.10.5).
      if (t.name === 'soul.update' && !a.memoryOn) return false;
      if (t.name.startsWith('web.') && !a.web && !a.workId) return false;
      if (WORK_ONLY.has(t.name) && !a.workId) return false;
      // 0.15.1: the face designer's long list of colours, shapes and expressions only goes to a chat that
      // talks about faces or avatars (it is mostly for Work's helpers); every token here slows the first reply.
      if (t.name === 'avatar.create' && !a.workId && !AVATAR_WORDS.test(a.prompt ?? '')) return false;
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

  /** Starts a run. `listen` (the core's own task runner) gets every event of the run too. */
  start(a: StartArgs, listen?: (e: AgentEvent) => void): { runId: string } {
    if (!a.model) throw new Error('No model selected. Pick one in the chat box, or download one in Settings → Models.');
    if (!Array.isArray(a.messages) || !a.messages.length) throw new Error('Nothing to send.');
    const s = readAgentSettings(this.o.db);
    const runId = `run-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const ctrl = new AbortController();
    this.runs.set(runId, ctrl);
    const source = sourceOf(a);
    startRun(this.o.db, { id: runId, chatId: a.chatId, model: a.model, prompt: a.prompt ?? '', source, ref: a.ref ?? (source === 'work' ? a.workId : undefined) });
    const emit = (e: AgentEvent) => { this.o.broadcast({ type: 'agent', runId, ...e }); try { listen?.(e); } catch { /* a listener's bug must not stop the run */ } };
    const fetchFn = this.o.fetch ?? fetch;
    let ollama = 'http://127.0.0.1:11434', auth: string | null = null;
    try { const m = JSON.parse(kvGet(this.o.db, 'lotus.engineUrls.v1') || '{}'); if (m.ollama) ollama = String(m.ollama).replace(/\/+$/, ''); } catch { /* default */ }
    let serverAuth: string | null = null;
    try { const keys = JSON.parse(kvGet(this.o.db, 'lotus.engineAuth.v1') || '{}'); auth = authHeader(keys.ollama); serverAuth = authHeader(keys.llamacpp); } catch { /* none */ }
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
    const ask = (question: string, options: string[]) => new Promise<string | null>((done) => {
      const askId = `ask${++askSeq}`;
      const key = `${runId}/${askId}`;
      const finish = (v: string | null) => { if (!this.asks.has(key)) return; this.asks.delete(key); if (t) clearTimeout(t); ctrl.signal.removeEventListener('abort', onAbort); emit({ kind: 'answered', askId, ...(v === null ? { timedOut: true } : {}) }); done(v); };
      const onAbort = () => finish('');
      // Interactive runs wait until answered or stopped; unattended ones give up and say so.
      const t = a.unattended ? setTimeout(() => finish(null), ASK_TIMEOUT) : null;
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

    const llm: { backend: 'ollama' | 'llamacpp'; nativeTools?: boolean; url: string; auth: string | null; fetch: typeof fetchFn; growCtx?: (tokens: number) => Promise<string> } & NonNullable<StartArgs['options']> = {
      // STATE #7: a server the user runs (llama-server, LM Studio, vLLM) gets the OpenAI tool list too, with
      // its access key; one that refuses tools falls back to tags (loop.ts).
      backend: s.backend === 'ollama' ? 'ollama' : 'llamacpp', nativeTools: s.backend !== 'ollama',
      url: s.backend === 'ollama' ? ollama : s.llamacppUrl.replace(/\/+$/, ''), auth: s.backend === 'ollama' ? auth : s.backend === 'llamacpp' ? serverAuth : null, fetch: fetchFn, ...a.options,
    };
    let helperSeq = 0, batchSeq = 0;
    const helperBase = { model: a.model, tools: tools.filter((t) => t.name !== 'agent.delegate' && t.name !== 'agents.deploy' && t.name !== 'ask.user'), llm, s, workDir: workDir ?? '', folders, memoryOn: !!a.memoryOn, fetchFn, signal: ctrl.signal, emit, approve: (st: Step) => this.waitFor(runId, st, ctrl.signal, !!a.unattended) };
    void (async () => {
      try {
        if (s.backend === 'builtin') {
          // The built-in engine loads the chosen model on first use (and swaps models when asked).
          if (!this.o.builtins) throw new Error('The built-in chat engine is not available in this build.');
          const b = this.o.builtins;
          // Auto (the default) sizes the context to free video memory; otherwise the chat's own setting.
          llm.url = await b.ensureChat(a.model, s.autoScale ? { auto: true } : { ctx: a.options?.numCtx || s.contextWindow || undefined });
          llm.growCtx = async (tokens) => { const url = await b.ensureChat(a.model, { ctx: tokens, grow: true }); llm.url = url; return url; };
        }
        const out = await runAgent({
          runId, model: a.model, messages, tools, approval: s.approval, rules: parseRules(s.deny), allow: this.allowRules, capabilities: a.capabilities, maxTurns: workDir ? 24 : undefined, think: !!a.think,
        }, {
          llm,
          registry: this.registry,
          ctx: { db: this.o.db, studio: this.o.studio, builtins: this.o.builtins, board: this.board, folders, kvSet: this.kvSet, kvGet: (k) => kvGet(this.o.db, k), fetch: fetchFn, memoryOn: !!a.memoryOn, workDir, ask,
            delegate: workDir ? (goal, context, name) => this.helper(runId, ++helperSeq, { ...helperBase, goal, context, name }) : undefined,
            deploy: workDir ? (jobs, context) => {
              // Several helpers at once. Lotus's own engine serves one request at a time (and may reload the
              // model with a bigger context), so there they take turns; Ollama and llama.cpp run 3 together.
              const batch = `b${++batchSeq}`;
              const seqs = jobs.map(() => ++helperSeq);
              jobs.forEach((j, i) => emit({ kind: 'helper', helper: { id: `${runId}-h${seqs[i]}`, name: j.name || `Helper ${seqs[i]}`, goal: j.goal.slice(0, 200), status: 'queued', steps: 0, batch, started: Date.now() } }));
              return pool(jobs.map((j, i) => () => this.helper(runId, seqs[i], { ...helperBase, goal: j.goal, context, name: j.name, batch })), deployLimit(s));
            } : undefined },
          signal: ctrl.signal,
          emit,
          record: (st, seq) => {
            saveStep(this.o.db, st, seq);
            if (st.tool === 'memory.save' && st.status === 'done') this.o.broadcast({ type: 'memory' });
          },
          approve: (st) => this.waitFor(runId, st, ctrl.signal, !!a.unattended),
        });
        // 0.20.0: a run that never answered is not "done" (the 0.19 review saw a green check on one).
        const status = ctrl.signal.aborted ? 'stopped' : out.finished ? 'done' : 'error';
        finishRun(this.o.db, runId, { status, reply: out.content, mode: out.mode, unverified: out.unverified });
        emit({ kind: 'done', content: out.content, unverified: out.unverified, steps: out.steps.length, mode: out.mode, ...(out.finished ? {} : { unfinished: true }) });
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
    goal: string; context: string; name?: string; batch?: string; model: string; tools: Tool[]; llm: Parameters<typeof runAgent>[1]['llm']; s: AgentSettings; workDir: string; folders: string[];
    memoryOn: boolean; fetchFn: typeof fetch; signal: AbortSignal; emit: (e: AgentEvent) => void; approve: (st: Step) => Promise<boolean | 'timeout'>;
  }): Promise<{ name: string; content: string; steps: number; ok: boolean; sources: { title: string; url: string }[] }> {
    const name = (h.name ?? '').trim().slice(0, 40) || `Helper ${n}`;
    const subId = `${runId}-h${n}`;
    // The helper's card (Work page, island): queued → running (with what it is doing) → done.
    const info: HelperInfo = { id: subId, name, goal: h.goal.slice(0, 200), status: 'running', steps: 0, current: 'Starting', ...(h.batch ? { batch: h.batch } : {}), started: Date.now() };
    const tell = (p: Partial<HelperInfo>) => { Object.assign(info, p); h.emit({ kind: 'helper', helper: { ...info } }); };
    tell({});
    let done = 0;
    try {
      const out = await runAgent({
        runId: subId, model: h.model, tools: h.tools, approval: h.s.approval, rules: parseRules(h.s.deny), allow: this.allowRules, maxTurns: 10,
        messages: [
          { role: 'system', content: `You are ${name}. You are a helper agent working for Lotus on one part of a bigger job. Do exactly the goal below with your tools, then reply with the result itself (facts, text, file names you saved), not a description of your process. Be concise.` },
          { role: 'user', content: `Goal: ${h.goal}${h.context ? `\n\nContext:\n${h.context}` : ''}` },
        ],
      }, {
        llm: h.llm, registry: this.registry,
        ctx: { db: this.o.db, studio: this.o.studio, board: this.board, folders: h.folders, kvSet: this.kvSet, kvGet: (k) => kvGet(this.o.db, k), fetch: h.fetchFn, memoryOn: h.memoryOn, workDir: h.workDir || undefined },
        signal: h.signal,
        emit: (e) => {
          if (e.kind === 'step') {
            h.emit({ kind: 'step', step: { ...e.step, data: { ...(e.step.data ?? {}), helper: name, helperId: subId, goal: h.goal.slice(0, 120) } } });
            if (e.step.status === 'done' || e.step.status === 'error') done++;
            tell({ steps: done, current: e.step.status === 'waiting' ? 'Waiting for your permission' : e.step.status === 'running' ? e.step.label : info.current });
          } else if (e.kind === 'token' && info.current !== 'Writing its result') tell({ current: 'Writing its result' });
          else if (e.kind === 'thinking' && info.current !== 'Thinking') tell({ current: 'Thinking' });
        },
        record: (st, seq) => saveStep(this.o.db, { ...st, runId }, 1000 * n + seq),
        approve: h.approve,
      });
      const ok = helperSucceeded(out);
      tell({ status: h.signal.aborted ? 'stopped' : ok ? 'done' : 'error', steps: out.steps.length, current: undefined, result: out.content.slice(0, 400), finished: Date.now() });
      const sources = helperSources(out.steps);
      const searched = h.tools.some((t) => t.name.startsWith('web.'));
      return { name, content: withSources(out.content, sources, searched), steps: out.steps.length, ok, sources };
    } catch (e) {
      const stopped = h.signal.aborted;
      tell({ status: stopped ? 'stopped' : 'error', current: undefined, result: stopped ? undefined : (e as Error)?.message ?? String(e), finished: Date.now() });
      if (stopped) throw e;
      return { name, content: `Failed: ${(e as Error)?.message ?? String(e)}`, steps: done, ok: false, sources: [] };
    }
  }

  private waitFor(runId: string, st: Step, signal: AbortSignal, unattended = false): Promise<boolean | 'timeout'> {
    const key = `${runId}/${st.id}`;
    return new Promise<boolean | 'timeout'>((done) => {
      const finish = (v: boolean | 'timeout') => { if (!this.waits.has(key)) return; this.waits.delete(key); if (t) clearTimeout(t); signal.removeEventListener('abort', onAbort); done(v); };
      const onAbort = () => finish(false);
      // STATE #12: a chat or Work run waits until you answer or press Stop; a task/routine gives up and says so.
      const t = unattended ? setTimeout(() => finish('timeout'), APPROVAL_WAIT_MS.value) : null;
      signal.addEventListener('abort', onAbort);
      this.waits.set(key, { finish, step: st });
    });
  }

  readonly allowRules = () => parseRules(readAllowRules(this.o.db));

  /**
   * Allow / Deny for a waiting step. `always` also saves the step's "Always allow" rule and lets every
   * other waiting step that rule covers go ahead (two helpers asking for the same folder, say).
   */
  decide(runId: string, stepId: string, allow: boolean, always = false): boolean {
    const w = this.waits.get(`${runId}/${stepId}`);
    if (!w) return false;
    if (allow && always && w.step.always) {
      this.addAllowRule(w.step.always);
      const rules = parseRules([w.step.always]);
      w.finish(true);
      // A destructive step (it offers no Always allow) keeps waiting for its own answer.
      for (const other of [...this.waits.values()]) if (other.step.always && allowedBy(rules, other.step.tool, other.step.args)) other.finish(true);
      return true;
    }
    w.finish(!!allow);
    return true;
  }

  /** Saves an allow rule (once). Returns the rules now saved. */
  addAllowRule(rule: string): string[] {
    const line = String(rule ?? '').trim();
    const now = readAllowRules(this.o.db);
    if (!line || !parseRules([line]).length || now.some((r) => r.toLowerCase() === line.toLowerCase())) return now;
    const next = [...now, line];
    this.kvSet(ALLOW_KEY, JSON.stringify(next));
    return next;
  }

  stop(runId: string): boolean {
    const c = this.runs.get(runId);
    if (!c) return false;
    c.abort();
    return true;
  }

  stopAll() { for (const c of this.runs.values()) c.abort(); }

  /**
   * Starts a run and waits for its end (the core's task runner and routines). Aborting `signal` stops
   * it. Resolves with the reply, or throws its error ('Stopped' as an AbortError).
   */
  runToEnd(a: StartArgs, signal?: AbortSignal, on?: (e: AgentEvent) => void): Promise<{ runId: string; content: string; unverified: string[]; steps: number }> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new DOMException('Stopped', 'AbortError')); return; }
      let runId = '';
      const onAbort = () => { if (runId) this.stop(runId); };
      const listen = (e: AgentEvent) => {
        on?.(e);
        if (e.kind === 'done') {
          signal?.removeEventListener('abort', onAbort);
          if (signal?.aborted) reject(new DOMException('Stopped', 'AbortError'));
          else resolve({ runId, content: e.content, unverified: e.unverified, steps: e.steps });
        } else if (e.kind === 'error') { signal?.removeEventListener('abort', onAbort); reject(new Error(e.message)); }
      };
      try { runId = this.start(a, listen).runId; } catch (e) { reject(e); return; }
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  describeTools() {
    return ALL_TOOLS.map((t) => ({ name: t.name, label: t.label, description: t.description, risk: t.risk }));
  }

  /** A recorded run with its steps; steps get their tool's label ("Saving a file") back. */
  run(runId: string) {
    const r = getRun(this.o.db, runId);
    if (!r) return null;
    return { ...r, steps: r.steps.map((st) => ({ ...st, label: ALL_TOOLS.find((t) => t.name === st.tool)?.label ?? st.tool })) };
  }
  list(limit = 50, f: Parameters<typeof listRuns>[2] = {}) { return listRuns(this.o.db, limit, f); }
  running() { return [...this.runs.keys()]; }
}


/**
 * 0.20.0: a helper is Done only when it really answered and its steps didn't all fail. Before, any
 * text counted, so "I stopped after several tool steps without a final answer" after 8 failed
 * searches showed a green check.
 */
export function helperSucceeded(out: Pick<AgentOutcome, 'finished' | 'steps' | 'content'>): boolean {
  if (!out.finished || !out.content.trim()) return false;
  return !out.steps.length || out.steps.some((x) => x.status === 'done');
}

/** Runs async jobs with at most `limit` at once; results keep the jobs' order. */
export async function pool<T>(jobs: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  const worker = async () => { while (next < jobs.length) { const i = next++; out[i] = await jobs[i](); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, jobs.length)) }, worker));
  return out;
}
