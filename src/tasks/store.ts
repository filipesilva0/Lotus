// Task board and routines: shared state for the Tasks page.
//
// With the core (the desktop app, phase 2): the board lives in lotus.db's tasks/routines tables and the
// core runs the scheduler and the task agent. This store shows what the core sends ({ type: 'board' }
// events), applies each change here first with the same Kanban rules (so the page answers at once and
// `add` can return the new task), then sends it to the core, whose next event is the truth. It also
// tells the core which model, context and how many parallel jobs the VRAM auto-scaler allows.
//
// Without the core (browser preview, tests): the old way, kv (`lotus.tasks.v1`, `lotus.routines.v1`),
// the auto-runner and a 20-second scheduler here.

import { useSyncExternalStore } from 'react';
import { agentPool } from '../agents/pool';
import { uid } from '../lib/persist';
import { reportActivity } from '../lib/bus';
import { hasLiveSettings, liveSettings } from '../lib/liveSettings';
import { extractJson, llm } from '../services/llm';
import { readPage, searchWeb } from '../chat/webSearch';
import { considerSkill } from '../memory/learn';
import { addLink, blockersOf, moveTask, newTask, nextRunnable, removeLink, removeTask, Status, Task, TaskLink } from './kanban';
import { nextRun, validateCron } from './cron';
import { runTaskAgent } from './runner';
import { kv } from '../lib/store';
import { agentAvailable, runAgent } from '../lib/agent';
import { coreReady, onCoreEvent, rpc } from '../lib/core';
import { storeMode } from '../lib/store';
import { currentLimit, modelForJob } from '../agents/pool';
import { effectiveNumCtx, hardware } from '../hardware/monitor';

const TASKS_KEY = 'lotus.tasks.v1';
const ROUTINES_KEY = 'lotus.routines.v1';

export interface RoutineRun { at: number; ok: boolean; output: string; ms: number; taskId?: string; /** The agent run (Tasks → Activity). */ runId?: string }
export interface Routine {
  id: string;
  name: string;
  /** What Lotus should do each time. */
  prompt: string;
  /** 5-field cron, local time. */
  schedule: string;
  enabled: boolean;
  /** log = keep the answer here; card = post it to the board's Review column; task = add a task Lotus then works through. */
  action: 'log' | 'card' | 'task';
  web: boolean;
  /** Run once at start-up if a run was missed while Lotus was closed. */
  catchUp: boolean;
  nextRun?: number;
  lastRun?: number;
  running?: boolean;
  runs: RoutineRun[];
  created: number;
}

const read = <T,>(k: string): T[] => { try { return JSON.parse(kv.getItem(k) || '[]'); } catch { return []; } };
const write = (k: string, v: unknown) => { try { kv.setItem(k, JSON.stringify(v)); } catch { /* quota */ } };

/** A job the core is running or has queued (task or routine), for the Tasks page's agents list. */
export interface BoardJob { id: string; key: string; label: string; priority: number; status: 'running' | 'queued'; queuedAt: number }

interface State { tasks: Task[]; routines: Routine[]; notice: string | null; jobs: BoardJob[]; /** The core's board has arrived. */ ready: boolean }
let state: State = { tasks: [], routines: [], notice: null, jobs: [], ready: false };
const subs = new Set<() => void>();

/** 'core' once the core answered; 'local' in a plain browser; null while we don't know yet. */
let backend: 'core' | 'local' | null = null;
const viaCore = () => backend === 'core';

function loadLocal() {
  backend = 'local';
  state = {
    ...state, ready: true,
    // A run that was in progress when Lotus closed did not finish.
    tasks: read<Task>(TASKS_KEY).map((t) => (t.run && (t.run.state === 'running' || t.run.state === 'queued') ? { ...t, run: { ...t.run, state: 'failed', error: 'Lotus closed before this run finished.' } } : t)),
    routines: read<Routine>(ROUTINES_KEY).map((r) => ({ ...r, running: false })),
  };
  subs.forEach((f) => f());
}

function set(p: Partial<State>) {
  state = { ...state, ...p };
  if (!viaCore()) {
    if (p.tasks) write(TASKS_KEY, state.tasks);
    if (p.routines) write(ROUTINES_KEY, state.routines.map((r) => ({ ...r, running: undefined })));
  }
  subs.forEach((f) => f());
  if (p.tasks && !viaCore()) queueMicrotask(autoRun);
}

/** Sends a change to the core; a refusal shows as the board notice and the core's state comes back. */
function send(method: string, args: Record<string, unknown>) {
  void rpc<{ error?: string } | null>(method, args).then((r) => {
    if (r && typeof r === 'object' && 'error' in r && r.error) { set({ notice: r.error }); void refresh(); }
  }, (e: unknown) => { set({ notice: `Couldn't save that: ${(e as Error).message}` }); void refresh(); });
}

async function refresh() {
  const b = await rpc<{ tasks: Task[]; routines: Routine[]; jobs: BoardJob[] }>('board_get');
  took(b.tasks, b.routines, b.jobs);
}

/** What the core sent. Tasks Lotus just finished and routines that just ran become activity pills (and skills). */
function took(tasks?: Task[], routines?: Routine[], jobs?: BoardJob[]) {
  if (tasks && state.ready) {
    const before = new Map(state.tasks.map((t) => [t.id, t.run?.state]));
    for (const t of tasks) {
      if (t.run?.state === 'done' && before.has(t.id) && before.get(t.id) !== 'done') {
        reportActivity({ id: `task-${t.id}`, kind: 'chat', label: `Task done: ${t.title}`, done: true });
        queueMicrotask(() => learnFromTask(t.id));
      } else if (t.run?.state === 'running' && before.get(t.id) !== 'running') reportActivity({ id: `task-${t.id}`, kind: 'chat', label: `Task: ${t.title}` });
    }
  }
  if (routines && state.ready) {
    const before = new Map(state.routines.map((r) => [r.id, r]));
    for (const r of routines) {
      const old = before.get(r.id);
      if (old && r.runs[0] && r.runs[0].at !== old.runs[0]?.at) reportActivity({ id: `routine-${r.id}`, kind: 'chat', label: `Routine ${r.runs[0].ok ? 'done' : 'failed'}: ${r.name}`, done: true });
      else if (old && r.running && !old.running) reportActivity({ id: `routine-${r.id}`, kind: 'chat', label: `Routine: ${r.name}` });
    }
  }
  state = { ...state, ...(tasks ? { tasks } : {}), ...(routines ? { routines } : {}), ...(jobs ? { jobs } : {}), ready: true };
  subs.forEach((f) => f());
}

let booted = false;
/** Finds out whether the core is there, then loads the board from it (or from kv without it). */
function boot() {
  if (booted) return;
  booted = true;
  if (typeof window === 'undefined') { loadLocal(); return; }
  void coreReady().then(async (info) => {
    if (!info || storeMode() !== 'core') { loadLocal(); return; }
    backend = 'core';
    onCoreEvent((e) => {
      const b = e as { type: string; tasks?: Task[]; routines?: Routine[]; jobs?: BoardJob[] };
      if (b.type === 'board') took(b.tasks, b.routines, b.jobs);
      else if (b.type === 'hello') void refresh().catch(() => undefined); // the core restarted
    });
    try { await refresh(); } catch (e) { set({ notice: `Couldn't load the task board: ${(e as Error).message}`, ready: true }); }
    configureCore();
    hardware.subscribe(configureCore);
  }, () => loadLocal());
}

let lastConfig = '';
/** The window's VRAM auto-scaler decides the model, context and parallel jobs; the core runs them. */
function configureCore() {
  const s = hasLiveSettings() ? liveSettings() : null;
  const c = { model: modelForJob('task', s, hardware.get().agentModel), numCtx: effectiveNumCtx(), limit: currentLimit() };
  const k = JSON.stringify(c);
  if (k === lastConfig) return;
  lastConfig = k;
  void rpc('board_config', c).catch(() => { lastConfig = ''; });
}

// Without the core, the agent's saves (a browser preview has none) and other windows' arrive as
// storage events. Take them without writing them back.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (viaCore()) return;
    // Routines the agent scheduled from a chat (0.10.1): keep the ones running here as running.
    if (e.key === ROUTINES_KEY) {
      const running = new Set(state.routines.filter((r) => r.running).map((r) => r.id));
      state = { ...state, routines: read<Routine>(ROUTINES_KEY).map((r) => ({ ...r, running: running.has(r.id) })) };
      subs.forEach((f) => f());
      return;
    }
    if (e.key !== TASKS_KEY) return;
    state = { ...state, tasks: read<Task>(TASKS_KEY) };
    subs.forEach((f) => f());
    queueMicrotask(autoRun);
  });
}

const patchTask = (id: string, fn: (t: Task) => Task) => set({ tasks: state.tasks.map((t) => (t.id === id ? { ...fn(t), updated: Date.now() } : t)) });
const logTask = (id: string, text: string, kind: Task['log'][number]['kind'] = 'agent') => patchTask(id, (t) => ({ ...t, log: [...t.log, { at: Date.now(), text, kind }].slice(-60) }));
const patchRoutine = (id: string, fn: (r: Routine) => Routine) => set({ routines: state.routines.map((r) => (r.id === id ? fn(r) : r)) });

// ── tasks ───────────────────────────────────────────────────────────────────

export const tasks = {
  get: () => { boot(); return state; },
  subscribe: (fn: () => void) => { boot(); subs.add(fn); return () => { subs.delete(fn); }; },
  add(p: Partial<Task> & { title: string }): Task {
    const t = newTask(uid('task'), p, state.tasks);
    set({ tasks: [...state.tasks, t] });
    if (viaCore()) send('task_add', { ...p, id: t.id });
    return t;
  },
  patch(id: string, fn: (t: Task) => Task) {
    const old = state.tasks.find((t) => t.id === id);
    patchTask(id, fn);
    const now = state.tasks.find((t) => t.id === id);
    if (viaCore() && old && now) {
      // Only what changed, so a change the core made meanwhile (a log line, a step result) isn't undone.
      const diff: Partial<Task> = {};
      for (const k of Object.keys(now) as (keyof Task)[]) if (k !== 'run' && k !== 'updated' && JSON.stringify(now[k]) !== JSON.stringify(old[k])) (diff as Record<string, unknown>)[k] = now[k];
      if (Object.keys(diff).length) send('task_patch', { id, patch: diff });
    }
  },
  remove(id: string) {
    const t = state.tasks.find((x) => x.id === id);
    if (viaCore()) send('task_remove', { id });
    else if (t?.run?.jobId) agentPool.cancel(t.run.jobId);
    set({ tasks: removeTask(state.tasks, id) });
  },
  move(id: string, status: Status, beforeId?: string | null) {
    const r = moveTask(state.tasks, id, status, beforeId);
    if (r.error) { set({ notice: r.error }); return false; }
    set({ tasks: r.tasks, notice: null });
    if (viaCore()) send('task_move', { id, status, beforeId: beforeId ?? null });
    return true;
  },
  link(from: string, type: TaskLink['type'], to: string) {
    const r = addLink(state.tasks, from, type, to);
    set(r.error ? { notice: r.error } : { tasks: r.tasks, notice: null });
    if (!r.error && viaCore()) send('task_link', { from, type, to });
    return !r.error;
  },
  unlink: (from: string, to: string) => { set({ tasks: removeLink(state.tasks, from, to) }); if (viaCore()) send('task_unlink', { from, to }); },
  clearNotice: () => set({ notice: null }),

  /** Starts the agent on a task now (priority 0 because the user asked). */
  run(id: string, priority: 0 | 1 = 0) {
    if (viaCore()) { send('task_run', { id }); return; }
    const t = state.tasks.find((x) => x.id === id);
    if (!t || t.run?.state === 'running' || t.run?.state === 'queued') return;
    const blockers = blockersOf(id, state.tasks);
    if (blockers.length) { set({ notice: `“${t.title}” is waiting for ${blockers.map((b) => `“${b.title}”`).join(', ')}.` }); return; }
    const jobId = uid('job');
    patchTask(id, (x) => ({ ...x, assignee: 'lotus', run: { state: 'queued', jobId }, log: [...x.log, { at: Date.now(), text: 'Queued for Lotus', kind: 'agent' }] }));
    void agentPool.run(`Task: ${t.title}`, 'task', async (c) => {
      patchTask(id, (x) => ({ ...x, status: x.status === 'backlog' || x.status === 'todo' ? 'doing' : x.status, run: { state: 'running', jobId, startedAt: Date.now() } }));
      return runTaskAgent({
        get: () => state.tasks.find((x) => x.id === id),
        patch: (fn) => patchTask(id, fn),
        log: (text, kind = 'agent') => logTask(id, text, kind),
        dependencyResults: () => state.tasks.filter((x) => x.links.some((l) => l.type === 'blocks' && l.to === id) && x.result).map((x) => ({ title: x.title, result: x.result! })),
      }, c);
    }, { priority, id: jobId }).then((result) => {
      patchTask(id, (x) => ({ ...x, result, status: 'review', run: { state: 'done', jobId, startedAt: x.run?.startedAt, finishedAt: Date.now() }, log: [...x.log, { at: Date.now(), text: 'Finished. Ready for review.', kind: 'status' }] }));
      reportActivity({ id: `task-${id}`, kind: 'chat', label: `Task done: ${t.title}`, done: true });
      learnFromTask(id);
    }, (e: unknown) => {
      const stopped = (e as Error)?.name === 'AbortError';
      patchTask(id, (x) => ({ ...x, run: { state: 'failed', jobId, error: stopped ? 'Stopped' : (e as Error).message, startedAt: x.run?.startedAt, finishedAt: Date.now() }, log: [...x.log, { at: Date.now(), text: stopped ? 'Stopped' : `Failed: ${(e as Error).message}`, kind: 'error' }] }));
    });
  },
  stop(id: string) {
    if (viaCore()) { send('task_stop', { id }); return; }
    const t = state.tasks.find((x) => x.id === id); if (t?.run?.jobId) agentPool.cancel(t.run.jobId);
  },
  /** Clears a failed run so the auto-runner may pick the task up again. */
  retry(id: string) {
    if (viaCore()) { send('task_retry', { id }); return; }
    patchTask(id, (t) => ({ ...t, run: undefined })); tasks.run(id);
  },
  /** Stops a job the core is running (the agents list). */
  stopJob(key: string) {
    if (key.startsWith('task:')) send('task_stop', { id: key.slice(5) });
    else if (key.startsWith('routine:')) send('routine_stop', { id: key.slice(8) });
  },
};

/** A finished multi-step task is a good candidate for a skill (when skills are on). */
function learnFromTask(id: string) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t || !hasLiveSettings() || !liveSettings().autoSkills) return;
  const turns = [
    { role: 'user' as const, content: `${t.title}\n${t.description}` },
    { role: 'assistant' as const, content: `${t.steps.map((s, i) => `${i + 1}. ${s.text}\n${(s.result ?? '').slice(0, 800)}`).join('\n\n')}\n\n${t.result ?? ''}` },
  ];
  void considerSkill(turns, { outcome: 'a multi-step task from the task board, finished by the agent', label: `Learning from task: ${t.title}` })
    .then((sk) => { if (sk) logTask(id, `Saved a skill from this task: “${sk.name}”`, 'note'); })
    .catch(() => undefined);
}

/** Starts Lotus-assigned tasks that are ready (To do, unblocked). Called after every board change. */
function autoRun() {
  for (let guard = 0; guard < 8; guard++) {
    const t = nextRunnable(state.tasks);
    if (!t) return;
    tasks.run(t.id, 1);
  }
}

export function useTasks() {
  return useSyncExternalStore(tasks.subscribe, tasks.get, tasks.get);
}

// ── routines ────────────────────────────────────────────────────────────────

const ROUTINE_PROMPT = (r: Routine, web: string) => `You are Lotus, running a scheduled routine on the user's own PC. Today is ${new Date().toString()}.
Routine: ${r.name}
Instructions: ${r.prompt}
${web ? `\nCurrent web results (cite as [n]):\n${web}\n` : ''}
Do what the instructions ask and reply with the result only, in GitHub Flavored Markdown.${r.action === 'task' ? '\nAlso propose a short task title as the first line, starting with "TITLE: ".' : ''}`;

export const routines = {
  add(p: Partial<Routine> & { name: string; prompt: string; schedule: string }): Routine | string {
    const err = validateCron(p.schedule);
    if (err) return err;
    const r: Routine = { id: uid('rt'), enabled: true, action: 'log', web: false, catchUp: false, runs: [], created: Date.now(), ...p, nextRun: nextRun(p.schedule, new Date())?.getTime() };
    set({ routines: [...state.routines, r] });
    if (viaCore()) send('routine_add', { ...p, id: r.id });
    return r;
  },
  update(id: string, p: Partial<Routine>): string | null {
    if (p.schedule !== undefined) { const err = validateCron(p.schedule); if (err) return err; }
    patchRoutine(id, (r) => {
      const next = { ...r, ...p };
      if (p.schedule !== undefined || p.enabled) next.nextRun = nextRun(next.schedule, new Date())?.getTime();
      return next;
    });
    if (viaCore()) send('routine_update', { id, patch: p });
    return null;
  },
  remove: (id: string) => { set({ routines: state.routines.filter((r) => r.id !== id) }); if (viaCore()) send('routine_remove', { id }); },

  /** Runs a routine now (scheduled = from the timer). */
  run(id: string, scheduled = false) {
    if (viaCore()) { set({ routines: state.routines.map((x) => (x.id === id ? { ...x, running: true } : x)) }); send('routine_run', { id }); return; }
    const r = state.routines.find((x) => x.id === id);
    if (!r || r.running) return;
    const started = Date.now();
    patchRoutine(id, (x) => ({ ...x, running: true, lastRun: started, nextRun: nextRun(x.schedule, new Date())?.getTime() }));
    void agentPool.run(`Routine: ${r.name}`, 'routine', async ({ model, numCtx, signal }) => {
      if (!model) throw new Error('No model selected.');
      if (r.action === 'task') return r.prompt; // the task agent does the work
      // STATE #6: with the core, a routine is a run of the agent with its tools (unattended: an approval
      // nobody answers gives up after 15 minutes and says so). Without it, a plain model call as before.
      if (agentAvailable() && (!hasLiveSettings() || liveSettings().agentTools !== false)) {
        const done = await runAgent({
          model, prompt: r.prompt.slice(0, 400), unattended: true, web: r.web, memoryOn: true,
          messages: [{ role: 'system', content: ROUTINE_PROMPT(r, '').replace(/\nDo what the instructions ask/, '\nUse your tools when the instructions need them (files, tasks, memory, images, the web when it is on). Do what the instructions ask') }, { role: 'user', content: r.prompt }],
          options: { numCtx, temperature: 0.4, numPredict: 2000 },
        }, (e) => { if (e.kind === 'step' && e.step.status === 'waiting') reportActivity({ id: `routine-${id}`, kind: 'chat', label: `Routine waiting for your permission: ${r.name}` }); }, signal);
        const steps = done.steps ? ` (${done.steps} step${done.steps === 1 ? '' : 's'})` : '';
        const warn = done.unverified.length ? `\n\n> Lotus check: this says it did things no step did (${done.unverified.join(', ')}).` : '';
        if (steps) reportActivity({ id: `routine-${id}`, kind: 'chat', label: `Routine: ${r.name}${steps}` });
        return `${done.content.trim()}${warn}`;
      }
      let web = '';
      if (r.web && hasLiveSettings()) {
        const s = liveSettings();
        const results = await searchWeb(r.prompt.slice(0, 200), { provider: s.webSearchProvider, searxngUrl: s.searxngUrl, limit: 5, signal });
        const pages = await Promise.all(results.slice(0, Math.min(3, s.webPagesToRead)).map((x) => readPage(x.url, signal)));
        web = results.map((x, i) => `[${i + 1}] ${x.title} — ${x.url}\n${(pages.find((p) => p.url === x.url)?.text || x.snippet).slice(0, 1500)}`).join('\n\n');
      }
      const out = await llm.chatOnce([{ role: 'user', content: ROUTINE_PROMPT(r, web) }], { model, numCtx, signal, temperature: 0.4, numPredict: 2000 });
      return out.content.trim();
    }, { priority: scheduled ? 1 : 0 }).then((output) => {
      let taskId: string | undefined;
      if (r.action === 'card') {
        taskId = tasks.add({ title: `${r.name} · ${new Date().toLocaleDateString()}`, description: output, status: 'review', assignee: 'me', source: { routineId: r.id, name: r.name } }).id;
      } else if (r.action === 'task') {
        taskId = tasks.add({ title: r.name, description: r.prompt, status: 'todo', assignee: 'lotus', web: r.web, source: { routineId: r.id, name: r.name } }).id;
      }
      const run: RoutineRun = { at: started, ok: true, output: r.action === 'task' ? 'Added a task for Lotus to the board.' : output, ms: Date.now() - started, taskId };
      patchRoutine(id, (x) => ({ ...x, running: false, runs: [run, ...x.runs].slice(0, 20) }));
      reportActivity({ id: `routine-${id}`, kind: 'chat', label: `Routine done: ${r.name}`, done: true });
    }, (e: unknown) => {
      patchRoutine(id, (x) => ({ ...x, running: false, runs: [{ at: started, ok: false, output: (e as Error).message, ms: Date.now() - started }, ...x.runs].slice(0, 20) }));
    });
  },
};

/** Due routines: enabled, with a next run time that has passed. */
export function dueRoutines(list: Routine[], at: number): Routine[] {
  return list.filter((r) => r.enabled && !r.running && r.nextRun !== undefined && r.nextRun <= at);
}

let schedulerOn = false;
/**
 * Starts the board (idempotent). With the core, the core schedules and runs everything; without it,
 * this window does: missed runs are skipped unless the routine asks to catch up.
 */
export function startScheduler() {
  boot();
  if (backend === null) { void coreReady().then(() => queueMicrotask(startScheduler)); return; }
  if (viaCore() || schedulerOn) return;
  schedulerOn = true;
  const at = Date.now();
  for (const r of state.routines) {
    if (!r.enabled) continue;
    const missed = r.nextRun !== undefined && r.nextRun < at;
    if (missed && r.catchUp) routines.run(r.id, true);
    else if (missed || r.nextRun === undefined) patchRoutine(r.id, (x) => ({ ...x, nextRun: nextRun(x.schedule, new Date())?.getTime() }));
  }
  setInterval(() => { for (const r of dueRoutines(state.routines, Date.now())) routines.run(r.id, true); }, 20_000);
  autoRun();
}

/** Optional: ask the model to turn a free-text goal into a task with steps (the "Plan with Lotus" button). */
export async function draftTask(goal: string, model: string, numCtx: number): Promise<{ title: string; steps: string[] } | null> {
  const r = await llm.chatOnce([{ role: 'user', content: `Turn this goal into a task for a task board. Reply with JSON only: {"title": "short imperative title", "steps": ["3-7 concrete steps"]}\nGoal: ${goal}` }], { model, numCtx, json: true, temperature: 0.2, numPredict: 500 });
  const j = extractJson<{ title?: string; steps?: unknown }>(r.content);
  if (!j?.title) return null;
  return { title: String(j.title).slice(0, 120), steps: Array.isArray(j.steps) ? j.steps.filter((s): s is string => typeof s === 'string').slice(0, 8) : [] };
}
