// Long-term memory: chat recall, memory items and skills, with SQLite FTS5 search.
// A straight port of the Rust module that held it before session 14 (src-tauri/src/memory_db.rs):
// same tables, same queries, same SKILL.md mirror, so nothing has to be converted.
// Nothing here leaves the computer.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Db } from './db';

export interface IndexedMsg { id: string; sessionId: string; title: string; role: string; content: string; ts: number }
export interface Hit { id: string; sessionId: string; title: string; role: string; snippet: string; ts: number; score: number }
export interface MemoryRow { id: string; kind: string; text: string; source: string; uses: number; ts: number; updated: number }
export interface SkillRow {
  id: string; name: string; description: string; whenToUse: string; body: string; tags: string[];
  version: number; uses: number; wins: number; enabled: boolean; origin: string; created: number; updated: number;
}
export interface Status { fts5: boolean; path: string; messages: number; memories: number; skills: number }

// ── query helpers ───────────────────────────────────────────────────────────

const STOP = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'your', 'with', 'this', 'that', 'was', 'what', 'how', 'can', 'could',
  'would', 'should', 'have', 'has', 'had', 'from', 'they', 'them', 'then', 'than', 'there', 'here', 'about', 'into',
  'just', 'like', 'please', 'want', 'need', 'make', 'does', 'did', 'its', "it's", 'our', 'out', 'who', 'why', 'when',
  'where', 'which', 'will', 'all', 'any', 'some', 'one', 'get', 'got', 'use', 'using', 'me', 'my', 'is', 'it', 'to',
  'of', 'in', 'on', 'a', 'an', 'be', 'do', 'so', 'if', 'or', 'as', 'at', 'by', 'we', 'i']);

/** Up to 12 distinct lowercase words, stop words dropped. */
export function words(text: string): string[] {
  const out: string[] = [];
  for (const raw of String(text ?? '').split(/[^\p{L}\p{N}]+/u)) {
    const w = raw.toLowerCase();
    if ([...w].length < 2 || STOP.has(w) || out.includes(w)) continue;
    out.push(w);
    if (out.length === 12) break;
  }
  return out;
}

/** Free text → a safe FTS5 query: each word a quoted prefix term, joined with OR. */
export function ftsQuery(text: string): string | null {
  const w = words(text);
  return w.length ? w.map((x) => `"${x}"*`).join(' OR ') : null;
}

export function slug(name: string): string {
  let s = '';
  for (const c of String(name ?? '').toLowerCase()) {
    if (/[a-z0-9]/.test(c)) s += c;
    else if (s && !s.endsWith('-')) s += '-';
  }
  s = s.replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return s || 'skill';
}

export function skillMarkdown(s: SkillRow): string {
  const esc = (v: string) => String(v ?? '').replace(/\n/g, ' ').replace(/"/g, "'");
  return `---\nname: "${esc(s.name)}"\ndescription: "${esc(s.description)}"\nwhen_to_use: "${esc(s.whenToUse)}"\nversion: ${s.version}\ntags: [${(s.tags ?? []).map((t) => `"${esc(t)}"`).join(', ')}]\norigin: ${esc(s.origin)}\n---\n\n${String(s.body ?? '').trim()}\n`;
}

function snippetOf(content: string, ws: string[]): string {
  const lower = content.toLowerCase();
  const found = ws.map((w) => lower.indexOf(w)).filter((i) => i >= 0);
  const at = found.length ? Math.min(...found) : 0;
  const start = Math.max(0, at - 80);
  return `${start > 0 ? '…' : ''}${[...content.slice(start)].slice(0, 220).join('').trim()}…`;
}

const count = (db: Db, sql: string) => { try { return (db.sql.query(sql).get() as { n: number }).n; } catch { return 0; } };

// ── messages (session recall) ───────────────────────────────────────────────

export function status(db: Db): Status {
  return {
    fts5: db.fts,
    path: db.path,
    messages: count(db, 'SELECT count(*) AS n FROM messages_fts'),
    memories: count(db, 'SELECT count(*) AS n FROM memories'),
    skills: count(db, 'SELECT count(*) AS n FROM skills'),
  };
}

export function indexMessages(db: Db, msgs: IndexedMsg[]): number {
  const del = db.sql.query('DELETE FROM messages_fts WHERE msg_id = ?');
  const ins = db.sql.query('INSERT INTO messages_fts(msg_id, session_id, title, role, content, ts) VALUES (?, ?, ?, ?, ?, ?)');
  db.sql.transaction(() => {
    for (const m of msgs) {
      del.run(String(m.id));
      if (!String(m.content ?? '').trim()) continue;
      ins.run(String(m.id), String(m.sessionId), String(m.title ?? ''), String(m.role ?? ''), [...String(m.content)].slice(0, 20_000).join(''), Number(m.ts) || 0);
    }
  })();
  return msgs.length;
}

export function forgetSession(db: Db, sessionId: string): void {
  db.sql.query('DELETE FROM messages_fts WHERE session_id = ?').run(sessionId);
}

export function wipeHistory(db: Db): void {
  db.sql.run('DELETE FROM messages_fts');
}

export function searchMessages(db: Db, query: string, exclude = '', limit = 6): Hit[] {
  if (db.fts) {
    const q = ftsQuery(query);
    if (!q) return [];
    type R = { msg_id: string; session_id: string; title: string; role: string; snip: string; ts: number; r: number };
    return db.sql.query<R, [string, string, number]>(
      `SELECT msg_id, session_id, title, role, snippet(messages_fts, 4, '', '', '…', 24) AS snip, ts, bm25(messages_fts) AS r
       FROM messages_fts WHERE messages_fts MATCH ? AND session_id != ? ORDER BY r LIMIT ?`,
    ).all(q, exclude, limit).map((r) => ({ id: r.msg_id, sessionId: r.session_id, title: r.title, role: r.role, snippet: r.snip, ts: Number(r.ts), score: -r.r }));
  }
  const ws = words(query);
  if (!ws.length) return [];
  type R = { msg_id: string; session_id: string; title: string; role: string; content: string; ts: number };
  const out: Hit[] = [];
  for (const r of db.sql.query<R, [string]>('SELECT msg_id, session_id, title, role, content, ts FROM messages_fts WHERE session_id != ? ORDER BY ts DESC LIMIT 4000').all(exclude)) {
    const lower = r.content.toLowerCase();
    const score = ws.filter((w) => lower.includes(w)).length;
    if (score > 0) out.push({ id: r.msg_id, sessionId: r.session_id, title: r.title, role: r.role, snippet: snippetOf(r.content, ws), ts: Number(r.ts), score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, Math.max(0, limit));
}

// ── memory items ────────────────────────────────────────────────────────────

export function listMemories(db: Db): MemoryRow[] {
  return db.sql.query<MemoryRow, []>('SELECT id, kind, text, source, uses, ts, updated FROM memories ORDER BY ts').all()
    .map((m) => ({ ...m, uses: Number(m.uses) || 0, ts: Number(m.ts) || 0, updated: Number(m.updated) || 0 }));
}

export function putMemories(db: Db, items: MemoryRow[]): void {
  const up = db.sql.query(`INSERT INTO memories(id, kind, text, source, uses, ts, updated) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, text = excluded.text, source = excluded.source, uses = excluded.uses, updated = excluded.updated`);
  const del = db.sql.query('DELETE FROM memories_fts WHERE id = ?');
  const ins = db.sql.query('INSERT INTO memories_fts(id, text) VALUES (?, ?)');
  db.sql.transaction(() => {
    for (const m of items) {
      const id = String(m.id);
      up.run(id, String(m.kind ?? 'memory'), String(m.text ?? ''), String(m.source ?? 'user'), Number(m.uses) || 0, Number(m.ts) || 0, Number(m.updated ?? m.ts) || 0);
      del.run(id);
      ins.run(id, String(m.text ?? ''));
    }
  })();
}

export function deleteMemory(db: Db, id: string): void {
  db.sql.transaction(() => {
    db.sql.query('DELETE FROM memories WHERE id = ?').run(id);
    db.sql.query('DELETE FROM memories_fts WHERE id = ?').run(id);
  })();
}

export function searchMemories(db: Db, query: string, limit = 8): string[] {
  if (db.fts) {
    const q = ftsQuery(query);
    if (!q) return [];
    return db.sql.query<{ id: string }, [string, number]>('SELECT id FROM memories_fts WHERE memories_fts MATCH ? ORDER BY bm25(memories_fts) LIMIT ?').all(q, limit).map((r) => r.id);
  }
  const ws = words(query);
  return listMemories(db)
    .map((m) => [ws.filter((w) => m.text.toLowerCase().includes(w)).length, m.id] as const)
    .filter(([n]) => n > 0).sort((a, b) => b[0] - a[0]).slice(0, limit).map(([, id]) => id);
}

// ── skills ──────────────────────────────────────────────────────────────────

const skillDir = (db: Db, s: Pick<SkillRow, 'name'>) => join(db.dir, 'skills', slug(s.name));

function getSkill(db: Db, id: string): SkillRow | null {
  const r = db.sql.query<{ json: string }, [string]>('SELECT json FROM skills WHERE id = ?').get(id);
  if (!r) return null;
  try { return fromStored(JSON.parse(r.json)); } catch { return null; }
}

/** Rows written by the Rust module used snake_case for `when_to_use`; accept both. */
function fromStored(j: Record<string, unknown>): SkillRow {
  return {
    id: String(j.id), name: String(j.name ?? ''), description: String(j.description ?? ''),
    whenToUse: String(j.whenToUse ?? j.when_to_use ?? ''), body: String(j.body ?? ''),
    tags: Array.isArray(j.tags) ? j.tags.map(String) : [], version: Number(j.version ?? 1) || 1,
    uses: Number(j.uses) || 0, wins: Number(j.wins) || 0, enabled: j.enabled !== false,
    origin: String(j.origin ?? 'auto'), created: Number(j.created) || 0, updated: Number(j.updated) || 0,
  };
}

export function listSkills(db: Db): SkillRow[] {
  const out: SkillRow[] = [];
  for (const r of db.sql.query<{ json: string }, []>('SELECT json FROM skills ORDER BY updated DESC').all()) {
    try { out.push(fromStored(JSON.parse(r.json))); } catch { /* skip a damaged row */ }
  }
  return out;
}

/** Saves a skill and mirrors it to skills/<slug>/SKILL.md. Returns the file path. */
export function putSkill(db: Db, input: SkillRow): string {
  const skill = fromStored(input as unknown as Record<string, unknown>);
  const old = getSkill(db, skill.id);
  if (old && slug(old.name) !== slug(skill.name)) rmSync(skillDir(db, old), { recursive: true, force: true });
  db.sql.transaction(() => {
    db.sql.query('INSERT INTO skills(id, json, updated) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated = excluded.updated')
      .run(skill.id, JSON.stringify(skill), skill.updated);
    db.sql.query('DELETE FROM skills_fts WHERE id = ?').run(skill.id);
    db.sql.query('INSERT INTO skills_fts(id, name, description, when_to_use, body) VALUES (?, ?, ?, ?, ?)')
      .run(skill.id, skill.name, skill.description, skill.whenToUse, skill.body);
  })();
  const dir = skillDir(db, skill);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'SKILL.md');
  try { writeFileSync(file, skillMarkdown(skill)); } catch (e) { throw new Error(`Saved, but could not write ${file}: ${(e as Error).message}`); }
  return file;
}

export function deleteSkill(db: Db, id: string): void {
  const old = getSkill(db, id);
  if (old) rmSync(skillDir(db, old), { recursive: true, force: true });
  db.sql.transaction(() => {
    db.sql.query('DELETE FROM skills WHERE id = ?').run(id);
    db.sql.query('DELETE FROM skills_fts WHERE id = ?').run(id);
  })();
}

export function searchSkills(db: Db, query: string, limit = 3): string[] {
  if (db.fts) {
    const q = ftsQuery(query);
    if (!q) return [];
    // Name and "when to use" weigh more than the body.
    return db.sql.query<{ id: string }, [string, number]>('SELECT id FROM skills_fts WHERE skills_fts MATCH ? ORDER BY bm25(skills_fts, 0.0, 6.0, 3.0, 4.0, 1.0) LIMIT ?').all(q, limit).map((r) => r.id);
  }
  const ws = words(query);
  return db.sql.query<{ id: string; t: string }, []>("SELECT id, name || ' ' || description || ' ' || when_to_use AS t FROM skills_fts").all()
    .map((r) => [ws.filter((w) => r.t.toLowerCase().includes(w)).length, r.id] as const)
    .filter(([n]) => n > 0).sort((a, b) => b[0] - a[0]).slice(0, limit).map(([, id]) => id);
}
