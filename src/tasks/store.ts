// Task board and routines: shared state (localStorage `lotus.tasks.v1`, `lotus.routines.v1`), the
// auto-runner for tasks assigned to Lotus, and the routine scheduler. Lives outside React so routines
// keep firing whichever page is open (and while the window is hidden in the tray).

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

const TASKS_KEY = 'lotus.tasks.v1';
const ROUTINES_KEY = 'lotus.routines.v1';

export interface RoutineRun { at: number; ok: boolean; output: string; ms: number; taskId?: string }
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

const read = <T,>(k: string): T[] => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota */ } };

interface State { tasks: Task[]; routines: Routine[]; notice: string | null }
let state: State = {
  // A run that was in progress when Lotus closed did not finish.
  tasks: read<Task>(TASKS_KEY).map((t) => (t.run && (t.run.state === 'running' || t.run.state === 'queued') ? { ...t, run: { ...t.run, state: 'failed', error: 'Lotus closed before this run finished.' } } : t)),
  routines: read<Routine>(ROUTINES_KEY).map((r) => ({ ...r, running: false })),
  notice: null,
};
const subs = new Set<() => void>();
function set(p: Partial<State>) {
  state = { ...state, ...p };
  if (p.tasks) write(TASKS_KEY, state.tasks);
  if (p.routines) write(ROUTINES_KEY, state.routines.map((r) => ({ ...r, running: undefined })));
  subs.forEach((f) => f());
  if (p.tasks) queueMicrotask(autoRun);
}

const patchTask = (id: string, fn: (t: Task) => Task) => set({ tasks: state.tasks.map((t) => (t.id === id ? { ...fn(t), updated: Date.now() } : t)) });
const logTask = (id: string, text: string, kind: Task['log'][number]['kind'] = 'agent') => patchTask(id, (t) => ({ ...t, log: [...t.log, { at: Date.now(), text, kind }].slice(-60) }));
const patchRoutine = (id: string, fn: (r: Routine) => Routine) => set({ routines: state.routines.map((r) => (r.id === id ? fn(r) : r)) });

// ── tasks ───────────────────────────────────────────────────────────────────

export const tasks = {
  get: () => state,
  subscribe: (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn); }; },
  add(p: Partial<Task> & { title: string }): Task {
    const t = newTask(uid('task'), p, state.tasks);
    set({ tasks: [...state.tasks, t] });
    return t;
  },
  patch: patchTask,
  remove(id: string) { const t = state.tasks.find((x) => x.id === id); if (t?.run?.jobId) agentPool.cancel(t.run.jobId); set({ tasks: removeTask(state.tasks, id) }); },
  move(id: string, status: Status, beforeId?: string | null) {
    const r = moveTask(state.tasks, id, status, beforeId);
    if (r.error) { set({ notice: r.error }); return false; }
    set({ tasks: r.tasks, notice: null });
    return true;
  },
  link(from: string, type: TaskLink['type'], to: string) {
    const r = addLink(state.tasks, from, type, to);
    set(r.error ? { notice: r.error } : { tasks: r.tasks, notice: null });
    return !r.error;
  },
  unlink: (from: string, to: string) => set({ tasks: removeLink(state.tasks, from, to) }),
  clearNotice: () => set({ notice: null }),

  /** Starts the agent on a task now (priority 0 because the user asked). */
  run(id: string, priority: 0 | 1 = 0) {
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
  stop(id: string) { const t = state.tasks.find((x) => x.id === id); if (t?.run?.jobId) agentPool.cancel(t.run.jobId); },
  /** Clears a failed run so the auto-runner may pick the task up again. */
  retry(id: string) { patchTask(id, (t) => ({ ...t, run: undefined })); tasks.run(id); },
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
    return r;
  },
  update(id: string, p: Partial<Routine>): string | null {
    if (p.schedule !== undefined) { const err = validateCron(p.schedule); if (err) return err; }
    patchRoutine(id, (r) => {
      const next = { ...r, ...p };
      if (p.schedule !== undefined || p.enabled) next.nextRun = nextRun(next.schedule, new Date())?.getTime();
      return next;
    });
    return null;
  },
  remove: (id: string) => set({ routines: state.routines.filter((r) => r.id !== id) }),

  /** Runs a routine now (scheduled = from the timer). */
  run(id: string, scheduled = false) {
    const r = state.routines.find((x) => x.id === id);
    if (!r || r.running) return;
    const started = Date.now();
    patchRoutine(id, (x) => ({ ...x, running: true, lastRun: started, nextRun: nextRun(x.schedule, new Date())?.getTime() }));
    void agentPool.run(`Routine: ${r.name}`, 'routine', async ({ model, numCtx, signal }) => {
      if (!model) throw new Error('No model selected.');
      if (r.action === 'task') return r.prompt; // the task agent does the work
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
/** Starts the routine scheduler (idempotent). Missed runs are skipped unless the routine asks to catch up. */
export function startScheduler() {
  if (schedulerOn) return;
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
