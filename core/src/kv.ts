// Key/value store that replaces the web layer's localStorage and IndexedDB.
// Values are strings (what localStorage held), so the web layer's JSON stays byte-for-byte the same.

import { Db, getMeta, setMeta } from './db';

export const MAX_KEY = 200;
export const MAX_VALUE = 64 * 1024 * 1024;

export interface KvChange { set: Record<string, string>; remove: string[] }

export function validKey(k: unknown): k is string {
  return typeof k === 'string' && k.length > 0 && k.length <= MAX_KEY;
}

export function kvAll(db: Db): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of db.sql.query<{ key: string; value: string }, []>('SELECT key, value FROM kv').all()) out[r.key] = r.value;
  return out;
}

export function kvGet(db: Db, key: string): string | null {
  return db.sql.query<{ value: string }, [string]>('SELECT value FROM kv WHERE key = ?').get(key)?.value ?? null;
}

/** Applies a batch atomically. Throws on an invalid key or value; nothing is written then. */
export function kvApply(db: Db, change: KvChange): KvChange {
  const set: Record<string, string> = {};
  const remove: string[] = [];
  for (const [k, v] of Object.entries(change.set ?? {})) {
    if (!validKey(k)) throw new Error(`Invalid key: ${String(k).slice(0, 40)}`);
    if (typeof v !== 'string') throw new Error(`The value for ${k} must be text.`);
    if (v.length > MAX_VALUE) throw new Error(`The value for ${k} is too large (${Math.round(v.length / 1e6)} MB).`);
    set[k] = v;
  }
  for (const k of change.remove ?? []) {
    if (!validKey(k)) throw new Error(`Invalid key: ${String(k).slice(0, 40)}`);
    remove.push(k);
  }
  const now = Date.now();
  const put = db.sql.query('INSERT INTO kv(key, value, updated) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated = excluded.updated');
  const del = db.sql.query('DELETE FROM kv WHERE key = ?');
  db.sql.transaction(() => {
    for (const [k, v] of Object.entries(set)) put.run(k, v, now);
    for (const k of remove) del.run(k);
  })();
  return { set, remove };
}

export const MIGRATED_KEY = 'migrated.webStorage';

/**
 * One-time import of what an older Lotus kept in the browser (localStorage + IndexedDB).
 * Keys already in the database win, so running it twice (two windows racing) is harmless.
 * Returns how many keys were added, or null when the import already happened.
 */
export function kvMigrate(db: Db, items: Record<string, string>): { added: number } | null {
  if (getMeta(db, MIGRATED_KEY)) return null;
  let added = 0;
  const ins = db.sql.query('INSERT OR IGNORE INTO kv(key, value, updated) VALUES (?, ?, ?)');
  const now = Date.now();
  db.sql.transaction(() => {
    for (const [k, v] of Object.entries(items ?? {})) {
      if (!validKey(k) || typeof v !== 'string' || v.length > MAX_VALUE) continue;
      added += ins.run(k, v, now).changes;
    }
    setMeta(db, MIGRATED_KEY, String(now));
  })();
  return { added };
}
