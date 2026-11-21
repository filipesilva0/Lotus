// The board service (roadmap phase 2): the task board, routines, the routine scheduler and the task
// runner, all in the core. Before, they ran on a 20-second timer in the main window with the model
// called from there; now every task step and routine is a run of the core's agent, unattended
// (approvals and questions show on the Tasks page and the island, and give up after a while).
//
// RPC (server.ts): board_get · board_config · task_* · routine_* (see boardRpc below).
// Events: { type: 'board', tasks?, routines? } after every change.
//
// Lotus runs only while it is open (decision D3), so this runs while the core does. The window still
// tells the core which model and context to use and how many jobs fit in memory (board_config), since
// the VRAM auto-scaler lives in the window; the core uses Settings' chat model and one job at a time
// until a window has said.

import type { Db } from './db';
import type { AgentService, StartArgs } from './agent/service';
import { readAgentSettings } from './agent/service';
import type { AgentEvent, BoardAccess, Step } from './agent/types';
import { kvGet } from './kv';
import { listSkills, searchSkills, type SkillRow } from './memory';
import { addRoutineRun, listRoutines, listTasks, saveRoutines, saveTasks, type Routine, type RoutineRun } from './board';
import { addLink, blockersOf, moveTask, newTask, nextRunnable, parseSteps, removeLink, removeTask, restoreTask, type RemovedTask, type Status, type Task, type TaskLink, type TaskStep } from '../../src/tasks/kanban';
import { nextRun, validateCron } from '../../src/tasks/cron';

export const TICK_MS = { value: 20_000 };

const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const stopped = () => new DOMException('Stopped', 'AbortError');
const isAbort = (e: unknown) => (e as Error)?.name === 'AbortError';

export interface RunnerConfig { model: string; numCtx: number; limit: number }

interface Job { id: string; key: string; label: string; priority: 0 | 1; queuedAt: number; ctrl: AbortController; go: (signal: AbortSignal) => Promise<void> }

/** Plan steps from a model reply: {"steps": [...]} or a Markdown list. */
export function parsePlan(text: string): string[] {
  const m = /\{[\s\S]*\}/.exec(text);
  if (m) {
    try {
      const j = JSON.parse(m[0]) as { steps?: unknown };
      if (Array.isArray(j.steps)) return j.steps.filter((s): s is string => typeof s === 'string' && s.trim().length > 2).map((s) => s.trim().slice(0, 200)).slice(0, 8);
    } catch { /* fall through */ }
  }
  return parseSteps(text, 8);
}

const TASK_SYSTEM = (t: Task, skills: SkillRow[], deps: { title: string; result: string }[], tools: boolean) => `You are Lotus, an AI agent running on the user's own computer, working through a task from their task board.
${tools ? 'Use your tools for anything they can do (files, the task board, memory, images, the web when it is on). When a step needs an action no tool can take, write exactly what the user should do so they can do it in one go.' : 'You can only think and write: you cannot run programs, open files or browse. When a step needs an action you cannot take, write exactly what the user should do (commands, settings, text to paste) so they can do it in one go.'}
Today's date: ${new Date().toDateString()}.

TASK: ${t.title}
${t.description ? `DETAILS:\n${t.description}\n` : ''}${deps.length ? `\nRESULTS OF TASKS THIS ONE DEPENDS ON:\n${deps.map((d) => `• ${d.title}:\n${d.result.slice(0, 1500)}`).join('\n')}\n` : ''}${skills.length ? `\nSKILLS YOU WROTE EARLIER (follow if relevant):\n${skills.map((s) => `### ${s.name}\n${s.body.slice(0, 1800)}`).join('\n\n')}\n` : ''}
Write in GitHub Flavored Markdown. Be concrete and complete; no filler.`;

const ROUTINE_SYSTEM = (r: Routine, tools: boolean) => `You are Lotus, running a scheduled routine on the user's own PC. Today is ${new Date().toString()}.
Routine: ${r.name}
Instructions: ${r.prompt}
${tools ? 'Use your tools when the instructions need them (files, tasks, memory, images, the web when it is on). ' : ''}Do what the instructions ask and reply with the result only, in GitHub Flavored Markdown.`;

export class BoardService implements BoardAccess {
  private queue: Job[] = [];
  private active = new Map<string, Job>();
  private routineRunning = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private cfg: RunnerConfig = { model: '', numCtx: 0, limit: 1 };

  constructor(private o: { db: Db; agent: AgentService; broadcast: (e: Record<string, unknown>) => void; log?: (m: string) => void }) {
    // A run that was going when the core stopped did not finish.
    const all = listTasks(o.db);
    if (all.some((t) => t.run?.state === 'running' || t.run?.state === 'queued')) {
      saveTasks(o.db, all.map((t) => (t.run && (t.run.state === 'running' || t.run.state === 'queued') ? { ...t, run: { ...t.run, state: 'failed', error: 'Lotus closed before this run finished.' } } : t)));
    }
  }

  // ── BoardAccess (the agent's task and routine tools) ──────────────────────

  tasks(): Task[] { return listTasks(this.o.db); }
  routines(): Routine[] { return listRoutines(this.o.db).map((r) => (this.routineRunning.has(r.id) ? { ...r, running: true } : r)); }
  setTasks(list: Task[]): void {
    if (saveTasks(this.o.db, list).changed) this.changed('tasks');
  }
  setRoutines(list: Routine[]): void {
    if (saveRoutines(this.o.db, list).changed) this.changed('routines');
  }

  private changed(what: 'tasks' | 'routines') {
    this.o.broadcast(what === 'tasks' ? { type: 'board', tasks: this.tasks() } : { type: 'board', routines: this.routines() });
    if (what === 'tasks') queueMicrotask(() => this.autoRun());
  }

  snapshot() { return { tasks: this.tasks(), routines: this.routines(), jobs: this.jobs(), config: this.cfg }; }

  jobs() {
    return [...this.active.values(), ...this.queue].map((j) => ({ id: j.id, key: j.key, label: j.label, priority: j.priority, status: this.active.has(j.id) ? 'running' : 'queued', queuedAt: j.queuedAt }));
  }

  configure(c: Partial<RunnerConfig>): RunnerConfig {
    if (typeof c.model === 'string') this.cfg.model = c.model;
    if (typeof c.numCtx === 'number' && c.numCtx >= 0) this.cfg.numCtx = Math.round(c.numCtx);
    if (typeof c.limit === 'number' && c.limit >= 1) this.cfg.limit = Math.min(8, Math.round(c.limit));
    this.pump();
    return { ...this.cfg };
  }

  // ── tasks ─────────────────────────────────────────────────────────────────

  private mutate(fn: (all: Task[]) => { tasks: Task[]; error?: string }): string | null {
    const r = fn(this.tasks());
    if (r.error) return r.error;
    this.setTasks(r.tasks);
    return null;
  }

  private patch(id: string, fn: (t: Task) => Task) {
    this.mutate((all) => ({ tasks: all.map((t) => (t.id === id ? { ...fn(t), updated: Date.now() } : t)) }));
  }

  private log(id: string, text: string, kind: Task['log'][number]['kind'] = 'agent') {
    this.patch(id, (t) => ({ ...t, log: [...t.log, { at: Date.now(), text, kind }].slice(-60) }));
  }

  addTask(p: Partial<Task> & { title: string }): Task {
    let made: Task | null = null;
    // A window may choose the id (it shows the new task at once and selects it); otherwise a new one.
    this.mutate((all) => {
      const id = typeof p.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(p.id) && !all.some((t) => t.id === p.id) ? p.id : uid('task');
      made = newTask(id, p, all);
      return { tasks: [...all, made] };
    });
    return made!;
  }
  /** Changes fields of a task (title, description, steps, labels…). Its id and run are not changed here. */
  patchTask(id: string, p: Partial<Task>): string | null {
    const { id: _id, run: _run, ...rest } = p;
    if (!this.tasks().some((t) => t.id === id)) return 'Task not found.';
    this.patch(id, (t) => ({ ...t, ...rest }));
    return null;
  }
  moveTask(id: string, status: Status, beforeId?: string | null) { return this.mutate((all) => moveTask(all, id, status, beforeId)); }
  linkTask(from: string, type: TaskLink['type'], to: string) { return this.mutate((all) => addLink(all, from, type, to)); }
  unlinkTask(from: string, to: string) { return this.mutate((all) => ({ tasks: removeLink(all, from, to) })); }
  removeTask(id: string) { this.cancel(`task:${id}`); return this.mutate((all) => ({ tasks: removeTask(all, id) })); }
  /** Undo of a delete: the task comes back as it was, with the links other tasks had to it. */
  restoreTask(r: RemovedTask) {
    if (!r?.task || typeof r.task.id !== 'string' || typeof r.task.title !== 'string') return 'Nothing to restore.';
    return this.mutate((all) => ({ tasks: restoreTask(all, { task: r.task, inbound: Array.isArray(r.inbound) ? r.inbound : [] }) }));
  }
  stopTask(id: string) { this.cancel(`task:${id}`); }
  retryTask(id: string) { this.patch(id, (t) => ({ ...t, run: undefined })); return this.runTask(id, 0); }

  /** Starts the agent on a task (priority 0: the user asked; 1: the auto-runner). Returns a reason it can't. */
  runTask(id: string, priority: 0 | 1 = 0): string | null {
    const all = this.tasks();
    const t = all.find((x) => x.id === id);
    if (!t) return 'Task not found.';
    if (t.run?.state === 'running' || t.run?.state === 'queued') return null;
    const blockers = blockersOf(id, all);
    if (blockers.length) return `“${t.title}” is waiting for ${blockers.map((b) => `“${b.title}”`).join(', ')}.`;
    const jobId = uid('job');
    this.patch(id, (x) => ({ ...x, assignee: 'lotus', run: { state: 'queued', jobId }, log: [...x.log, { at: Date.now(), text: 'Queued for Lotus', kind: 'agent' }] }));
    this.enqueue({ id: jobId, key: `task:${id}`, label: `Task: ${t.title}`, priority, go: (signal) => this.workTask(id, jobId, signal) });
    return null;
  }

  /** Starts Lotus-assigned tasks that are ready (To do, unblocked). */
  autoRun() {
    for (let guard = 0; guard < 8; guard++) {
      const t = nextRunnable(this.tasks());
      if (!t) return;
      if (this.runTask(t.id, 1)) return;
    }
  }

  private async workTask(id: string, jobId: string, signal: AbortSignal): Promise<void> {
    const startedAt = Date.now();
    this.patch(id, (x) => ({ ...x, status: x.status === 'backlog' || x.status === 'todo' ? 'doing' : x.status, run: { state: 'running', jobId, startedAt } }));
    try {
      const result = await this.taskAgent(id, signal);
      this.patch(id, (x) => ({ ...x, result, status: 'review', run: { state: 'done', jobId, startedAt, finishedAt: Date.now() }, log: [...x.log, { at: Date.now(), text: 'Finished. Ready for review.', kind: 'status' }] }));
    } catch (e) {
      const stop = isAbort(e) || signal.aborted;
      const msg = stop ? 'Stopped' : (e as Error)?.message || String(e);
      if (!this.tasks().some((t) => t.id === id)) return; // deleted while running
      this.patch(id, (x) => ({ ...x, run: { state: 'failed', jobId, error: msg, startedAt, finishedAt: Date.now() }, log: [...x.log, { at: Date.now(), text: stop ? 'Stopped' : `Failed: ${msg}`, kind: 'error' }] }));
    }
  }

  private model(): string {
    if (this.cfg.model) return this.cfg.model;
    try { const s = JSON.parse(kvGet(this.o.db, 'lotus.settings.v1') || '{}'); return typeof s.selectedModel === 'string' ? s.selectedModel : ''; } catch { return ''; }
  }

  /** One agent run for a task or routine: unattended, its steps in the run history under `source`/`ref`. */
  private run(a: Omit<StartArgs, 'model' | 'unattended'> & { model: string }, signal: AbortSignal, on?: (e: AgentEvent) => void) {
    return this.o.agent.runToEnd({ ...a, unattended: true, options: { ...(this.cfg.numCtx ? { numCtx: this.cfg.numCtx } : {}), ...a.options } }, signal, on);
  }

  private async taskAgent(id: string, signal: AbortSignal): Promise<string> {
    const get = () => this.tasks().find((x) => x.id === id);
    const t0 = get();
    if (!t0) throw new Error('The task was deleted.');
    const model = this.model();
    if (!model) throw new Error('No model selected. Choose one in Chat or Settings → Models.');
    const tools = readAgentSettings(this.o.db).enabled;
    const base = { model, source: 'task' as const, ref: id, memoryOn: true, web: !!t0.web };

    const ids = searchSkills(this.o.db, `${t0.title} ${t0.description}`.slice(0, 400), 2);
    const all = listSkills(this.o.db);
    const skills = ids.map((sid) => all.find((k) => k.id === sid)).filter((k): k is SkillRow => !!k && k.enabled);
    if (skills.length) this.log(id, `Using skill${skills.length > 1 ? 's' : ''}: ${skills.map((k) => k.name).join(', ')}`);
    const deps = this.tasks().filter((x) => x.links.some((l) => l.type === 'blocks' && l.to === id) && x.result).map((x) => ({ title: x.title, result: x.result! }));
    const system = TASK_SYSTEM(t0, skills, deps, tools);

    // Plan
    if (!t0.steps.length) {
      this.log(id, 'Planning steps');
      const r = await this.run({ ...base, only: [], prompt: `Plan: ${t0.title}`, messages: [{ role: 'system', content: system }, { role: 'user', content: 'Break this task into 3 to 7 concrete steps that, done in order, complete it. Reply with JSON only: {"steps": ["...", "..."]}' }], options: { temperature: 0.3, numPredict: 600 } }, signal);
      const steps = parsePlan(r.content);
      if (!steps.length) throw new Error('The model did not return a usable plan. Add steps yourself, or try a larger model.');
      this.patch(id, (t) => ({ ...t, steps: steps.map((text, i): TaskStep => ({ id: `${uid('step')}${i}`, text, done: false })) }));
      this.log(id, `Planned ${steps.length} steps`);
    }

    // Steps: each one is a run of the agent with its tools (when tools are on).
    for (;;) {
      if (signal.aborted) throw stopped();
      const t = get();
      if (!t) throw new Error('The task was deleted.');
      const step = t.steps.find((x) => !x.done);
      if (!step) break;
      const i = t.steps.indexOf(step);
      this.log(id, `Step ${i + 1}: ${step.text}`);
      const before = t.steps.slice(0, i).filter((x) => x.done).map((x, k) => `Step ${k + 1} (${x.text}):\n${(x.result ?? '').slice(0, 1200)}`).join('\n\n');
      const ask = `${before ? `Work done so far:\n${before}\n\n` : ''}Now do step ${i + 1} of ${t.steps.length}: ${step.text}\nWrite the result of this step only.`;
      const seen = new Map<string, string>();
      const note = (st: Step) => {
        const line = st.status === 'waiting' ? `Waiting for your permission: ${st.ask ?? st.label} (Allow or Deny on the Tasks page or the island)`
          : st.status === 'running' ? '' : `${st.label}: ${st.detail ?? st.status}`;
        if (!line || seen.get(st.id) === line) return;
        seen.set(st.id, line);
        this.log(id, line, st.status === 'error' || st.status === 'denied' ? 'error' : 'agent');
      };
      const r = await this.run({ ...base, ...(tools ? {} : { only: [] }), prompt: step.text, messages: [{ role: 'system', content: system }, { role: 'user', content: ask }], options: { temperature: 0.3, numPredict: 1800 } }, signal, (e) => { if (e.kind === 'step') note(e.step); });
      if (r.unverified.length) this.log(id, `Not backed by a step: ${r.unverified.join(', ')}`, 'error');
      const result = r.content.trim() || '(no output)';
      this.patch(id, (x) => ({ ...x, steps: x.steps.map((st) => (st.id === step.id ? { ...st, done: true, result: result.slice(0, 6000) } : st)) }));
    }

    // Write-up
    const t = get();
    if (!t) throw new Error('The task was deleted.');
    this.log(id, 'Writing the summary');
    const done = t.steps.map((x, k) => `Step ${k + 1} (${x.text}):\n${(x.result ?? '').slice(0, 1500)}`).join('\n\n');
    const r = await this.run({ ...base, only: [], prompt: `Summary: ${t.title}`, messages: [{ role: 'system', content: system }, { role: 'user', content: `All steps are done:\n${done}\n\nWrite the final result for the user: what was produced or decided, the key output (complete, ready to use), and anything they must do themselves. Markdown.` }], options: { temperature: 0.3, numPredict: 2000 } }, signal);
    return r.content.trim();
  }

  // ── routines ──────────────────────────────────────────────────────────────

  addRoutine(p: Partial<Routine> & { name: string; prompt: string; schedule: string }): Routine | string {
    const err = validateCron(p.schedule);
    if (err) return err;
    const all = this.routines();
    const id = typeof p.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(p.id) && !all.some((r) => r.id === p.id) ? p.id : uid('rt');
    const r: Routine = { enabled: true, action: 'log', web: false, catchUp: false, created: Date.now(), ...p, id, runs: [], running: undefined, nextRun: nextRun(p.schedule, new Date())?.getTime() };
    this.setRoutines([...all, r]);
    return r;
  }

  updateRoutine(id: string, p: Partial<Routine>): string | null {
    if (p.schedule !== undefined) { const err = validateCron(p.schedule); if (err) return err; }
    const { id: _i, runs: _r, running: _x, ...rest } = p;
    this.setRoutines(this.routines().map((r) => {
      if (r.id !== id) return r;
      const next = { ...r, ...rest };
      if (p.schedule !== undefined || p.enabled) next.nextRun = nextRun(next.schedule, new Date())?.getTime();
      return next;
    }));
    return null;
  }

  removeRoutine(id: string) { this.cancel(`routine:${id}`); this.setRoutines(this.routines().filter((r) => r.id !== id)); }

  private patchRoutine(id: string, fn: (r: Routine) => Routine) { this.setRoutines(this.routines().map((r) => (r.id === id ? fn(r) : r))); }

  /** Runs a routine now (scheduled = from the timer). Returns a reason it can't. */
  runRoutine(id: string, scheduled = false): string | null {
    const r = this.routines().find((x) => x.id === id);
    if (!r) return 'Routine not found.';
    if (this.routineRunning.has(id)) return null;
    this.routineRunning.add(id);
    const started = Date.now();
    this.patchRoutine(id, (x) => ({ ...x, lastRun: started, nextRun: nextRun(x.schedule, new Date())?.getTime() }));
    this.enqueue({ id: uid('job'), key: `routine:${id}`, label: `Routine: ${r.name}`, priority: scheduled ? 1 : 0, go: async (signal) => {
      let run: RoutineRun;
      try {
        if (r.action === 'task') {
          const t = this.addTask({ title: r.name, description: r.prompt, status: 'todo', assignee: 'lotus', web: r.web, source: { routineId: r.id, name: r.name } });
          run = { at: started, ok: true, output: 'Added a task for Lotus to the board.', ms: Date.now() - started, taskId: t.id };
        } else {
          const model = this.model();
          if (!model) throw new Error('No model selected. Choose one in Chat or Settings → Models.');
          const tools = readAgentSettings(this.o.db).enabled;
          const out = await this.run({ model, source: 'routine', ref: r.id, memoryOn: true, web: r.web, ...(tools ? {} : { only: [] }), prompt: r.prompt.slice(0, 400),
            messages: [{ role: 'system', content: ROUTINE_SYSTEM(r, tools) }, { role: 'user', content: r.prompt }], options: { temperature: 0.4, numPredict: 2000 } }, signal);
          const warn = out.unverified.length ? `\n\n> Lotus check: this says it did things no step did (${out.unverified.join(', ')}).` : '';
          const output = `${out.content.trim()}${warn}`;
          let taskId: string | undefined;
          if (r.action === 'card') taskId = this.addTask({ title: `${r.name} · ${new Date().toLocaleDateString()}`, description: output, status: 'review', assignee: 'me', source: { routineId: r.id, name: r.name } }).id;
          run = { at: started, ok: true, output, ms: Date.now() - started, runId: out.runId, ...(taskId ? { taskId } : {}) };
        }
      } catch (e) {
        run = { at: started, ok: false, output: isAbort(e) ? 'Stopped' : (e as Error)?.message || String(e), ms: Date.now() - started };
      }
      this.routineRunning.delete(id);
      if (this.routines().some((x) => x.id === id)) addRoutineRun(this.o.db, id, run);
      this.changed('routines');
    } });
    return null;
  }

  stopRoutine(id: string) { this.cancel(`routine:${id}`); }

  // ── scheduler ─────────────────────────────────────────────────────────────

  /** Due routines: enabled, not running, with a next run time that has passed. */
  due(at: number): Routine[] {
    return this.routines().filter((r) => r.enabled && !this.routineRunning.has(r.id) && r.nextRun !== undefined && r.nextRun <= at);
  }

  /** Starts the scheduler (idempotent). Missed runs are skipped unless the routine asks to catch up. */
  start() {
    if (this.timer) return;
    const at = Date.now();
    for (const r of this.routines()) {
      if (!r.enabled) continue;
      const missed = r.nextRun !== undefined && r.nextRun < at;
      if (missed && r.catchUp) this.runRoutine(r.id, true);
      else if (missed || r.nextRun === undefined) this.patchRoutine(r.id, (x) => ({ ...x, nextRun: nextRun(x.schedule, new Date())?.getTime() }));
    }
    this.timer = setInterval(() => this.tick(), TICK_MS.value);
    (this.timer as { unref?: () => void }).unref?.();
    this.autoRun();
  }

  tick() { for (const r of this.due(Date.now())) this.runRoutine(r.id, true); }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const j of [...this.queue, ...this.active.values()]) j.ctrl.abort();
    this.queue = [];
  }

  // ── the job queue (one at a time unless the window's VRAM plan says more fit) ──

  private enqueue(j: Omit<Job, 'queuedAt' | 'ctrl'>) {
    this.queue.push({ ...j, queuedAt: Date.now(), ctrl: new AbortController() });
    this.pump();
  }

  private pump() {
    this.queue.sort((a, b) => a.priority - b.priority || a.queuedAt - b.queuedAt);
    const backend = readAgentSettings(this.o.db).backend;
    const limit = backend === 'builtin' ? 1 : this.cfg.limit;
    while (this.queue.length && this.active.size < limit) {
      const j = this.queue.shift()!;
      this.active.set(j.id, j);
      void j.go(j.ctrl.signal).catch((e) => this.o.log?.(`board job ${j.label}: ${(e as Error)?.message ?? e}`)).finally(() => {
        this.active.delete(j.id);
        this.pump();
        this.o.broadcast({ type: 'board', jobs: this.jobs() });
      });
    }
    this.o.broadcast({ type: 'board', jobs: this.jobs() });
  }

  private cancel(key: string) {
    const qi = this.queue.findIndex((j) => j.key === key);
    if (qi >= 0) {
      const [j] = this.queue.splice(qi, 1);
      j.ctrl.abort();
      if (key.startsWith('task:')) {
        const id = key.slice(5);
        if (this.tasks().some((t) => t.id === id)) this.patch(id, (x) => ({ ...x, run: { ...(x.run ?? {}), state: 'failed', error: 'Stopped' }, log: [...x.log, { at: Date.now(), text: 'Stopped', kind: 'error' }] }));
      } else this.routineRunning.delete(key.slice(8));
      this.o.broadcast({ type: 'board', jobs: this.jobs() });
      return;
    }
    for (const j of this.active.values()) if (j.key === key) j.ctrl.abort();
  }
}

/** Board RPC methods (server.ts). */
export function boardRpc(b: BoardService, method: string, a: Record<string, unknown>): { found: boolean; value?: unknown } {
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const err = (e: string | null) => (e ? { error: e } : { ok: true });
  switch (method) {
    case 'board_get': return { found: true, value: b.snapshot() };
    case 'board_config': return { found: true, value: b.configure(a as Partial<RunnerConfig>) };
    case 'task_add': return { found: true, value: b.addTask(a as Partial<Task> & { title: string }) };
    case 'task_patch': return { found: true, value: err(b.patchTask(str(a.id), (a.patch ?? {}) as Partial<Task>)) };
    case 'task_move': return { found: true, value: err(b.moveTask(str(a.id), str(a.status) as Status, a.beforeId ? str(a.beforeId) : null)) };
    case 'task_link': return { found: true, value: err(b.linkTask(str(a.from), (a.type === 'relates' ? 'relates' : 'blocks'), str(a.to))) };
    case 'task_unlink': return { found: true, value: err(b.unlinkTask(str(a.from), str(a.to))) };
    case 'task_remove': return { found: true, value: err(b.removeTask(str(a.id))) };
    case 'task_restore': return { found: true, value: err(b.restoreTask(a as unknown as RemovedTask)) };
    case 'task_run': return { found: true, value: err(b.runTask(str(a.id), 0)) };
    case 'task_stop': b.stopTask(str(a.id)); return { found: true, value: { ok: true } };
    case 'task_retry': return { found: true, value: err(b.retryTask(str(a.id))) };
    case 'routine_add': { const r = b.addRoutine(a as Partial<Routine> & { name: string; prompt: string; schedule: string }); return { found: true, value: typeof r === 'string' ? { error: r } : r }; }
    case 'routine_update': return { found: true, value: err(b.updateRoutine(str(a.id), (a.patch ?? {}) as Partial<Routine>)) };
    case 'routine_remove': b.removeRoutine(str(a.id)); return { found: true, value: { ok: true } };
    case 'routine_run': return { found: true, value: err(b.runRoutine(str(a.id), false)) };
    case 'routine_stop': b.stopRoutine(str(a.id)); return { found: true, value: { ok: true } };
    default: return { found: false };
  }
}
