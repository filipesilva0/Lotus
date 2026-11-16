// Session 17: Lotus keeps its data in Lotus Studio/Data. Lotus 0.7 and older kept lotus.db and its
// logs in the OS app-data folder; the first start with a new data folder copies them over once.
// The old files are left where they were (a backup), never deleted.

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DB_FILES = ['lotus.db', 'lotus.db-wal', 'lotus.db-shm'];

/** Copies an older data folder's database (and logs) into `data` if `data` has none. Returns what was copied. */
export function moveLegacyData(legacy: string | undefined, data: string): string[] {
  if (!legacy || legacy === data) return [];
  if (existsSync(join(data, 'lotus.db')) || !existsSync(join(legacy, 'lotus.db'))) return [];
  mkdirSync(data, { recursive: true });
  const copied: string[] = [];
  for (const f of DB_FILES) {
    const src = join(legacy, f);
    if (existsSync(src)) { copyFileSync(src, join(data, f)); copied.push(f); }
  }
  const logs = join(legacy, 'logs');
  if (existsSync(logs) && statSync(logs).isDirectory()) {
    mkdirSync(join(data, 'logs'), { recursive: true });
    for (const f of readdirSync(logs)) { try { copyFileSync(join(logs, f), join(data, 'logs', f)); copied.push(`logs/${f}`); } catch { /* skip */ } }
  }
  writeFileSync(join(data, 'moved-from.txt'), `Lotus copied its data here from ${legacy} on ${new Date().toISOString()}.\nThe old copy was left in place; you can delete it.\n`);
  return copied;
}
