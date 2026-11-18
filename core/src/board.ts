// The task board and routines in lotus.db (roadmap phase 2). Before, each was one JSON value in kv
// (`lotus.tasks.v1`, `lotus.routines.v1`) that every change rewrote whole, from two processes.
//
//   tasks         one row per task: the columns the board sorts and filters on, plus the whole task as
//                 JSON (so the Kanban rules in src/tasks/kanban.ts keep working on plain objects)
//   routines      one row per routine, the same way (without its run history)
//   routine_runs  one row per run of a routine (the last 50 per routine are kept)
//
// The core owns these tables; windows read them over RPC and get { type: 'board' } events.

import type { Database } from 'bun:sqlite';
import type { Db } from './db';
import type { Task } from '../../src/tasks/kanban';

export interface RoutineRun { at: number; ok: boolean; output: string; ms: number; taskId?: string; runId?: string }
export interface Routine {
  id: string; name: string; prompt: string; schedule: string; enabled: boolean;
  action: 'log' | 'card' | 'task'; web: boolean; catchUp: boolean;
  nextRun?: number; lastRun?: number; running?: boolean; runs: RoutineRun[]; created: number;
}

export const OLD_TASKS_KEY = 'lotus.tasks.v1';
export const OLD_ROUTINES_KEY = 'lotus.routines.v1';
const RUNS_KEPT = 50;
const RUNS_SHOWN = 20;

export function createBoardTables(sql: Database): void {
  sql.run(`CREATE TABLE IF NOT EXISTS tasks(
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    assignee TEXT NOT NULL,
    priority TEXT NOT NULL,
    ord REAL NOT NULL,
    due TEXT,
    routine_id TEXT,
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL,
    json TEXT NOT NULL
  )`);
  sql.run('CREATE INDEX IF NOT EXISTS tasks_status ON tasks(status, ord)');
  sql.run(`CREATE TABLE IF NOT EXISTS routines(
    id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL,
    next_run INTEGER,
    created INTEGER NOT NULL,
    json TEXT NOT NULL
  )`);
  sql.run(`CREATE TABLE IF NOT EXISTS routine_runs(
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    routine_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    ok INTEGER NOT NULL,
    ms INTEGER NOT NULL,
    output TEXT NOT NULL,
    task_id TEXT,
    run_id TEXT
  )`);
  sql.run('CREATE INDEX IF NOT EXISTS routine_runs_routine ON routine_runs(routine_id, at)');
  importFromKv(sql);
}

const parseList = (raw: string | undefined | null): Record<string, unknown>[] => {
  try { const v = JSON.parse(raw || '[]'); return Array.isArray(v) ? v.filter((x) => x && typeof x === 'object' && typeof x.id === 'string') : []; } catch { return []; }
};

/** One-time import of what the board kept in kv. The kv values stay (an older Lotus can still read them). */
function importFromKv(sql: Database): void {
  const get = (k: string) => sql.query<{ value: string }, [string]>('SELECT value FROM kv WHERE key = ?').get(k)?.value;
  for (const t of parseList(get(OLD_TASKS_KEY)) as unknown as Task[]) {
    // A run that was going when Lotus closed did not finish.
    const fixed = t.run && (t.run.state === 'running' || t.run.state === 'queued') ? { ...t, run: { ...t.run, state: 'failed' as const, error: 'Lotus closed before this run finished.' } } : t;
    putTaskRow(sql, normTask(fixed));
  }
  for (const r of parseList(get(OLD_ROUTINES_KEY)) as unknown as Routine[]) {
    const runs = Array.isArray(r.runs) ? r.runs : [];
    putRoutineRow(sql, { ...r, runs: [] });
    for (const run of [...runs].reverse()) addRunRow(sql, r.id, run);
  }
}

function normTask(t: Task): Task {
  return {
    ...t, description: t.description ?? '', status: t.status ?? 'todo', assignee: t.assignee ?? 'me', priority: t.priority ?? 'normal',
    labels: Array.isArray(t.labels) ? t.labels : [], steps: Array.isArray(t.steps) ? t.steps : [], links: Array.isArray(t.links) ? t.links : [],
    log: Array.isArray(t.log) ? t.log : [], order: typeof t.order === 'number' ? t.order : 0, created: t.created ?? Date.now(), updated: t.updated ?? Date.now(),
  };
}

function putTaskRow(sql: Database, t: Task): void {
  sql.query(`INSERT INTO tasks(id, status, assignee, priority, ord, due, routine_id, created, updated, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET status = excluded.status, assignee = excluded.assignee, priority = excluded.priority, ord = excluded.ord, due = excluded.due,
    routine_id = excluded.routine_id, updated = excluded.updated, json = excluded.json`)
    .run(t.id, t.status, t.assignee, t.priority, t.order, t.due ?? null, t.source?.routineId ?? null, t.created, t.updated, JSON.stringify(t));
}

function putRoutineRow(sql: Database, r: Routine): void {
  const { runs: _runs, running: _running, ...rest } = r;
  sql.query(`INSERT INTO routines(id, enabled, next_run, created, json) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, next_run = excluded.next_run, json = excluded.json`)
    .run(r.id, r.enabled ? 1 : 0, r.nextRun ?? null, r.created ?? Date.now(), JSON.stringify(rest));
}

function addRunRow(sql: Database, routineId: string, run: RoutineRun): void {
  sql.query('INSERT INTO routine_runs(routine_id, at, ok, ms, output, task_id, run_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(routineId, run.at, run.ok ? 1 : 0, Math.round(run.ms ?? 0), String(run.output ?? '').slice(0, 20000), run.taskId ?? null, run.runId ?? null);
  sql.query('DELETE FROM routine_runs WHERE routine_id = ? AND seq NOT IN (SELECT seq FROM routine_runs WHERE routine_id = ? ORDER BY at DESC, seq DESC LIMIT ?)').run(routineId, routineId, RUNS_KEPT);
}

// ── reads ───────────────────────────────────────────────────────────────────

export function listTasks(db: Db): Task[] {
  const out: Task[] = [];
  for (const r of db.sql.query<{ json: string }, []>('SELECT json FROM tasks ORDER BY status, ord').all()) {
    try { out.push(normTask(JSON.parse(r.json))); } catch { /* skip a damaged row */ }
  }
  return out;
}

export function listRoutines(db: Db): Routine[] {
  const runs = db.sql.query<{ at: number; ok: number; ms: number; output: string; task_id: string | null; run_id: string | null }, [string, number]>(
    'SELECT at, ok, ms, output, task_id, run_id FROM routine_runs WHERE routine_id = ? ORDER BY at DESC, seq DESC LIMIT ?');
  const out: Routine[] = [];
  for (const r of db.sql.query<{ id: string; json: string }, []>('SELECT id, json FROM routines ORDER BY created').all()) {
    try {
      const base = JSON.parse(r.json) as Routine;
      out.push({ ...base, runs: runs.all(r.id, RUNS_SHOWN).map((x) => ({ at: x.at, ok: !!x.ok, ms: x.ms, output: x.output, ...(x.task_id ? { taskId: x.task_id } : {}), ...(x.run_id ? { runId: x.run_id } : {}) })) });
    } catch { /* skip */ }
  }
  return out;
}

// ── writes ──────────────────────────────────────────────────────────────────

/** Makes the tasks table hold exactly `next`: changed rows are written, missing ones deleted. */
export function saveTasks(db: Db, next: Task[]): { changed: number } {
  const old = new Map(db.sql.query<{ id: string; json: string }, []>('SELECT id, json FROM tasks').all().map((r) => [r.id, r.json]));
  let changed = 0;
  db.sql.transaction(() => {
    const keep = new Set<string>();
    for (const t0 of next) {
      if (!t0 || typeof t0.id !== 'string') continue;
      const t = normTask(t0);
      keep.add(t.id);
      if (old.get(t.id) === JSON.stringify(t)) continue;
      putTaskRow(db.sql, t); changed++;
    }
    for (const id of old.keys()) if (!keep.has(id)) { db.sql.query('DELETE FROM tasks WHERE id = ?').run(id); changed++; }
  })();
  return { changed };
}

/** Makes the routines table hold exactly `next` (run history is kept for routines that stay). */
export function saveRoutines(db: Db, next: Routine[]): { changed: number } {
  const old = new Map(db.sql.query<{ id: string; json: string }, []>('SELECT id, json FROM routines').all().map((r) => [r.id, r.json]));
  let changed = 0;
  db.sql.transaction(() => {
    const keep = new Set<string>();
    for (const r of next) {
      if (!r || typeof r.id !== 'string') continue;
      keep.add(r.id);
      const { runs: _r, running: _x, ...rest } = r;
      if (old.get(r.id) === JSON.stringify(rest)) continue;
      putRoutineRow(db.sql, r); changed++;
    }
    for (const id of old.keys()) if (!keep.has(id)) {
      db.sql.query('DELETE FROM routines WHERE id = ?').run(id);
      db.sql.query('DELETE FROM routine_runs WHERE routine_id = ?').run(id);
      changed++;
    }
  })();
  return { changed };
}

export function addRoutineRun(db: Db, routineId: string, run: RoutineRun): void {
  db.sql.transaction(() => addRunRow(db.sql, routineId, run))();
}
