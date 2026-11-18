// agent_runs / agent_steps: what each run did, step by step, with the real results.
// The chat shows the same steps live; this keeps them for the inspector and the real-task tests.

import type { Db } from '../db';
import type { Step } from './types';

export type RunSource = 'chat' | 'work' | 'island' | 'task' | 'routine' | 'call';
export const RUN_SOURCES: RunSource[] = ['chat', 'work', 'island', 'task', 'routine', 'call'];

export interface RunRow {
  id: string; chatId: string | null; created: number; finished: number | null; model: string; mode: string | null;
  status: 'running' | 'done' | 'error' | 'stopped'; prompt: string; reply: string | null; unverified: string[];
  /** Where the run came from (null for runs made before phase 2) and the task, routine or work it belongs to. */
  source: RunSource | null; ref: string | null;
  /** Tool steps it took (list only). */
  steps?: number;
}
type RunDbRow = { id: string; chat_id: string | null; created: number; finished: number | null; model: string; mode: string | null; status: RunRow['status']; prompt: string; reply: string | null; unverified: string | null; source: string | null; ref: string | null; steps?: number };
const toRow = (r: RunDbRow): RunRow => ({ id: r.id, chatId: r.chat_id, created: r.created, finished: r.finished, model: r.model, mode: r.mode, status: r.status, prompt: r.prompt, reply: r.reply, unverified: p(r.unverified, []), source: (r.source as RunSource) ?? null, ref: r.ref, ...(r.steps !== undefined ? { steps: r.steps } : {}) });

const j = (v: unknown) => (v === undefined ? null : JSON.stringify(v));
const p = <T>(s: string | null, d: T): T => { if (!s) return d; try { return JSON.parse(s) as T; } catch { return d; } };

export function startRun(db: Db, r: { id: string; chatId?: string; model: string; prompt: string; source?: RunSource; ref?: string }): void {
  db.sql.query('INSERT INTO agent_runs(id, chat_id, created, model, status, prompt, source, ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(r.id, r.chatId ?? null, Date.now(), r.model, 'running', r.prompt.slice(0, 4000), r.source ?? null, r.ref ?? null);
}

export function finishRun(db: Db, id: string, f: { status: RunRow['status']; reply?: string; mode?: string; unverified?: string[] }): void {
  db.sql.query('UPDATE agent_runs SET status = ?, finished = ?, reply = ?, mode = COALESCE(?, mode), unverified = ? WHERE id = ?')
    .run(f.status, Date.now(), f.reply ?? null, f.mode ?? null, j(f.unverified ?? []), id);
}

export function saveStep(db: Db, s: Step, seq: number): void {
  db.sql.query(`INSERT INTO agent_steps(id, run_id, seq, tool, args, status, detail, media, data, started, finished) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET status = excluded.status, detail = excluded.detail, media = excluded.media, data = excluded.data, finished = excluded.finished`)
    .run(s.id, s.runId, seq, s.tool, JSON.stringify(s.args), s.status, s.detail ?? null, j(s.media), j(s.data), s.started, s.finished ?? null);
}

type StepDbRow = { id: string; run_id: string; tool: string; args: string; status: Step['status']; detail: string | null; media: string | null; data: string | null; started: number; finished: number | null };

export function getRun(db: Db, id: string): (Omit<RunRow, 'steps'> & { steps: Step[] }) | null {
  const r = db.sql.query<RunDbRow, [string]>('SELECT * FROM agent_runs WHERE id = ?').get(id);
  if (!r) return null;
  const steps = db.sql.query<StepDbRow, [string]>('SELECT * FROM agent_steps WHERE run_id = ? ORDER BY seq').all(id).map((s) => ({
    id: s.id, runId: s.run_id, tool: s.tool, label: s.tool, args: p(s.args, {}), status: s.status, detail: s.detail ?? undefined,
    media: p<string[] | undefined>(s.media, undefined), data: p<Record<string, unknown> | undefined>(s.data, undefined), started: s.started, finished: s.finished ?? undefined,
  }));
  const { steps: _n, ...row } = toRow(r);
  return { ...row, steps };
}

/**
 * Recent runs, newest first, with how many tool steps each took. Filters: where they came from, the
 * task/routine/work they belong to, words in the request or reply, and `before` (a created time) to page.
 */
export function listRuns(db: Db, limit = 50, f: { source?: string; ref?: string; query?: string; before?: number } = {}): RunRow[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (f.source) { where.push('r.source = ?'); args.push(f.source); }
  if (f.ref) { where.push('r.ref = ?'); args.push(f.ref); }
  if (f.query) { where.push("(r.prompt LIKE ? ESCAPE '\\' OR r.reply LIKE ? ESCAPE '\\')"); const q = `%${f.query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`; args.push(q, q); }
  if (f.before) { where.push('r.created < ?'); args.push(f.before); }
  args.push(Math.max(1, Math.min(500, limit)));
  return db.sql.query<RunDbRow, (string | number)[]>(`SELECT r.*, (SELECT COUNT(*) FROM agent_steps s WHERE s.run_id = r.id) AS steps FROM agent_runs r ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.created DESC LIMIT ?`)
    .all(...args).map(toRow);
}

/** Keeps the last `keep` runs (steps go with them). */
export function pruneRuns(db: Db, keep = 2000): void {
  db.sql.query('DELETE FROM agent_runs WHERE id NOT IN (SELECT id FROM agent_runs ORDER BY created DESC LIMIT ?)').run(keep);
}

/** A run that was going when the core stopped did not finish. */
export function closeStaleRuns(db: Db): void {
  db.sql.run("UPDATE agent_runs SET status = 'stopped', finished = created WHERE status = 'running'");
  db.sql.run("UPDATE agent_steps SET status = 'error', detail = 'Lotus stopped before this step finished.' WHERE status IN ('running', 'waiting')");
}
