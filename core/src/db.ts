// lotus.db: the one SQLite file the core owns. It sits in Lotus's data folder (the same file the
// Rust memory module used before session 14, so existing memories, skills and chat recall carry over).
//
// Schema versions (PRAGMA user_version):
//   0  what the Rust memory module created: memories, skills, *_fts tables
//   1  adds kv (what the web layer kept in localStorage/IndexedDB), meta and media
//   2  adds agent_runs and agent_steps (session 15: every tool call the agent makes, with its result)
//   3  agent_runs.source/ref (run history, phase 2); tasks, routines and routine_runs tables (they were
//      JSON in kv: `lotus.tasks.v1`, `lotus.routines.v1`; imported once, the kv keys are left as they were)
// New versions append a step to MIGRATIONS; never edit a step that has shipped.

import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createBoardTables } from './board';

export interface Db {
  sql: Database;
  /** Whether SQLite has FTS5 (it should; search falls back to LIKE without it). */
  fts: boolean;
  /** Data folder that holds lotus.db and skills/. */
  dir: string;
  path: string;
}

function createMemoryTables(sql: Database): boolean {
  sql.run('CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY, kind TEXT, text TEXT, source TEXT, uses INTEGER, ts INTEGER, updated INTEGER)');
  sql.run('CREATE TABLE IF NOT EXISTS skills(id TEXT PRIMARY KEY, json TEXT NOT NULL, updated INTEGER)');
  try {
    sql.run("CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(msg_id UNINDEXED, session_id UNINDEXED, title, role UNINDEXED, content, ts UNINDEXED, tokenize='unicode61 remove_diacritics 2')");
    sql.run("CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(id UNINDEXED, text, tokenize='unicode61 remove_diacritics 2')");
    sql.run("CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(id UNINDEXED, name, description, when_to_use, body, tokenize='unicode61 remove_diacritics 2')");
    return true;
  } catch {
    sql.run('CREATE TABLE IF NOT EXISTS messages_fts(msg_id TEXT, session_id TEXT, title TEXT, role TEXT, content TEXT, ts INTEGER)');
    sql.run('CREATE TABLE IF NOT EXISTS memories_fts(id TEXT, text TEXT)');
    sql.run('CREATE TABLE IF NOT EXISTS skills_fts(id TEXT, name TEXT, description TEXT, when_to_use TEXT, body TEXT)');
    return false;
  }
}

/** Is `name` an FTS5 virtual table (rather than the plain fallback table)? */
function isFts(sql: Database, name: string): boolean {
  const row = sql.query<{ sql: string }, [string]>("SELECT sql FROM sqlite_master WHERE name = ?").get(name);
  return !!row && /using\s+fts5/i.test(row.sql);
}

const MIGRATIONS: ((sql: Database) => void)[] = [
  // 0 → 1
  (sql) => {
    sql.run('CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated INTEGER NOT NULL)');
    sql.run('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    sql.run(`CREATE TABLE IF NOT EXISTS media(
      path TEXT PRIMARY KEY,      -- relative to the Lotus Studio folder, '/' separated
      kind TEXT NOT NULL,         -- 'image' | 'audio'
      mime TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      created INTEGER NOT NULL
    )`);
  },
  // 1 → 2
  (sql) => {
    sql.run(`CREATE TABLE IF NOT EXISTS agent_runs(
      id TEXT PRIMARY KEY,
      chat_id TEXT,
      created INTEGER NOT NULL,
      finished INTEGER,
      model TEXT NOT NULL,
      mode TEXT,                  -- 'native' | 'tags'
      status TEXT NOT NULL,       -- 'running' | 'done' | 'error' | 'stopped'
      prompt TEXT NOT NULL,       -- the user's message
      reply TEXT,
      unverified TEXT             -- JSON: claims the reply made with no matching step
    )`);
    sql.run(`CREATE TABLE IF NOT EXISTS agent_steps(
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      tool TEXT NOT NULL,
      args TEXT NOT NULL,         -- JSON
      status TEXT NOT NULL,       -- 'waiting' | 'running' | 'done' | 'error' | 'denied'
      detail TEXT,
      media TEXT,                 -- JSON array of Lotus Studio paths
      data TEXT,                  -- JSON
      started INTEGER NOT NULL,
      finished INTEGER
    )`);
    sql.run('CREATE INDEX IF NOT EXISTS agent_steps_run ON agent_steps(run_id, seq)');
    sql.run('CREATE INDEX IF NOT EXISTS agent_runs_created ON agent_runs(created)');
  },
  // 2 → 3
  (sql) => {
    sql.run('ALTER TABLE agent_runs ADD COLUMN source TEXT'); // 'chat' | 'work' | 'island' | 'task' | 'routine' | 'call'
    sql.run('ALTER TABLE agent_runs ADD COLUMN ref TEXT');    // the task or routine id, the Work id
    sql.run('CREATE INDEX IF NOT EXISTS agent_runs_source ON agent_runs(source, created)');
    createBoardTables(sql);
  },
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export function openDb(dir: string): Db {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'lotus.db');
  const sql = new Database(path, { create: true });
  // Two processes may briefly share the file during an update (an older Lotus still running).
  sql.run('PRAGMA busy_timeout = 5000');
  try { sql.query('PRAGMA journal_mode = WAL').get(); } catch { /* best effort */ }
  sql.run('PRAGMA foreign_keys = ON');

  createMemoryTables(sql);
  const fts = isFts(sql, 'messages_fts');

  const current = (sql.query('PRAGMA user_version').get() as { user_version: number }).user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    sql.transaction(() => {
      MIGRATIONS[v](sql);
      sql.run(`PRAGMA user_version = ${v + 1}`);
    })();
  }
  return { sql, fts, dir, path };
}

export function schemaVersion(db: Db): number {
  return (db.sql.query('PRAGMA user_version').get() as { user_version: number }).user_version;
}

// ── meta ────────────────────────────────────────────────────────────────────

export function getMeta(db: Db, key: string): string | null {
  return db.sql.query<{ value: string }, [string]>('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
}

export function setMeta(db: Db, key: string, value: string): void {
  db.sql.query('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
