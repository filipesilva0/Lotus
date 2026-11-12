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

export const ALL_TOOLS: Tool[] = [...FILE_TOOLS, ...TASK_TOOLS, imageGenerate, ...MEMORY_TOOLS, ...WEB_TOOLS];

export interface AgentSettings { approval: ApprovalMode; deny: string[]; folders: string[]; backend: 'ollama' | 'llamacpp'; llamacppUrl: string; enabled: boolean }

export function readAgentSettings(db: Db): AgentSettings {
  let s: Record<string, unknown> = {};
  try { s = JSON.parse(kvGet(db, 'lotus.settings.v1') || '{}'); } catch { /* defaults */ }
  return {
    approval: isApprovalMode(s.agentApproval) ? s.agentApproval : 'risky',
    deny: Array.isArray(s.agentDeny) ? s.agentDeny.map(String) : DEFAULT_DENY,
    folders: Array.isArray(s.agentFolders) ? s.agentFolders.map(String) : [],
    backend: s.llmBackend === 'llamacpp' ? 'llamacpp' : 'ollama',
    llamacppUrl: typeof s.llamacppUrl === 'string' && s.llamacppUrl ? s.llamacppUrl : 'http://127.0.0.1:8080',
    enabled: s.agentTools !== false,
  };
}

export interface StartArgs {
  model: string;
  messages: WireMsg[];
  prompt: string;
  chatId?: string;
  options?: { temperature?: number; topP?: number; topK?: number; numCtx?: number; seed?: number; numPredict?: number; stop?: string[]; think?: boolean };
  memoryOn?: boolean;
  web?: boolean;
  /** Extra folders for this run (the chat's attached folder). */
  folders?: string[];
  /** Limit to these tools (tests, routines). */
  only?: string[];
  capabilities?: string[];
}

const isDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const APPROVAL_TIMEOUT = 15 * 60_000;

export class AgentService {
  private runs = new Map<string, AbortController>();
  private waits = new Map<string, (allow: boolean) => void>();
  readonly registry = new Registry(ALL_TOOLS);

  constructor(private o: { db: Db; studio: string; broadcast: (e: Record<string, unknown>) => void; fetch?: typeof fetch; log?: (m: string) => void }) {
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

  toolsFor(a: Pick<StartArgs, 'memoryOn' | 'web' | 'only'>): Tool[] {
    return ALL_TOOLS.filter((t) => {
      if (a.only && !a.only.includes(t.name)) return false;
      if (t.name.startsWith('memory.') && !a.memoryOn) return false;
      if (t.name.startsWith('web.') && !a.web) return false;
      return true;
    });
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
    if (tools.some((t) => t.name.startsWith('files.')) && messages[0]?.role === 'system') {
      messages[0] = { ...messages[0], content: `${messages[0].content}\n\nFolders you can use with the file tools: ${folders.join(', ')} (the last one is the Lotus Studio folder; save new notes there unless the user names another place).` };
    }

    void (async () => {
      try {
        const out = await runAgent({
          runId, model: a.model, messages, tools, approval: s.approval, rules: parseRules(s.deny), capabilities: a.capabilities,
        }, {
          llm: { backend: s.backend, url: s.backend === 'ollama' ? ollama : s.llamacppUrl.replace(/\/+$/, ''), auth: s.backend === 'ollama' ? auth : null, fetch: fetchFn, ...a.options },
          registry: this.registry,
          ctx: { db: this.o.db, studio: this.o.studio, folders, kvSet: this.kvSet, kvGet: (k) => kvGet(this.o.db, k), fetch: fetchFn, memoryOn: !!a.memoryOn },
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

