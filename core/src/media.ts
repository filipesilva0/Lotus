// Images and audio as real files in the Lotus Studio folder (Documents/Lotus Studio by default):
//   Images/2026-11/<name>.png      Audio/2026-11/<name>.wav
// They used to live only in the browser (IndexedDB blobs, or not at all), so they vanished with the
// app profile and were invisible to the user (B9/B10). The `media` table indexes them.

import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { Db } from './db';

export type MediaKind = 'image' | 'audio';
export interface MediaRow { path: string; kind: MediaKind; mime: string; bytes: number; created: number }

const FOLDER: Record<MediaKind, string> = { image: 'Images', audio: 'Audio' };
const EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/flac': 'flac',
};
const MIME_BY_EXT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', webm: 'audio/webm', flac: 'audio/flac' };

export const MAX_MEDIA = 200 * 1024 * 1024;

export function kindOf(mime: string): MediaKind | null {
  const m = mime.split(';')[0].trim().toLowerCase();
  if (!EXT[m]) return null;
  return m.startsWith('image/') ? 'image' : 'audio';
}

/** A file name safe on every OS: letters, digits, dot, dash, underscore; no leading dot. */
export function safeName(name: string): string {
  const base = String(name ?? '').replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '').slice(0, 80);
  return base || 'file';
}

/**
 * Resolves a stored relative path (`Images/2026-11/a.png`) inside the studio folder.
 * Returns null for anything that would leave the Images or Audio folders.
 */
export function resolveMedia(studio: string, rel: string): string | null {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) return null;
  const parts = rel.replace(/\\/g, '/').split('/');
  if (!Object.values(FOLDER).includes(parts[0]) || parts.some((p) => !p || p === '.' || p === '..')) return null;
  const root = normalize(studio);
  const full = normalize(join(root, ...parts));
  return full.startsWith(root + sep) ? full : null;
}

export async function saveMedia(db: Db, studio: string, body: ArrayBuffer | Uint8Array, mime: string, name: string, now = new Date()): Promise<MediaRow> {
  const type = mime.split(';')[0].trim().toLowerCase();
  const kind = kindOf(type);
  if (!kind) throw new Error(`Lotus only saves images and audio here, not ${type || 'unknown files'}.`);
  const bytes = body.byteLength;
  if (!bytes) throw new Error('The file is empty.');
  if (bytes > MAX_MEDIA) throw new Error('The file is larger than 200 MB.');
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const dirRel = `${FOLDER[kind]}/${month}`;
  mkdirSync(join(studio, FOLDER[kind], month), { recursive: true });
  const base = safeName(name);
  let rel = `${dirRel}/${base}.${EXT[type]}`;
  for (let i = 2; existsSync(join(studio, ...rel.split('/'))); i++) rel = `${dirRel}/${base}-${i}.${EXT[type]}`;
  await Bun.write(join(studio, ...rel.split('/')), body);
  const row: MediaRow = { path: rel, kind, mime: type, bytes, created: now.getTime() };
  db.sql.query('INSERT INTO media(path, kind, mime, bytes, created) VALUES (?, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET mime = excluded.mime, bytes = excluded.bytes, created = excluded.created')
    .run(row.path, row.kind, row.mime, row.bytes, row.created);
  return row;
}

export function mimeFor(rel: string): string {
  return MIME_BY_EXT[rel.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

export function deleteMedia(db: Db, studio: string, rel: string): boolean {
  const full = resolveMedia(studio, rel);
  if (!full) return false;
  rmSync(full, { force: true });
  db.sql.query('DELETE FROM media WHERE path = ?').run(rel.replace(/\\/g, '/'));
  return true;
}

export function listMedia(db: Db, kind?: MediaKind, limit = 500): MediaRow[] {
  const rows = kind
    ? db.sql.query<MediaRow, [string, number]>('SELECT * FROM media WHERE kind = ? ORDER BY created DESC LIMIT ?').all(kind, limit)
    : db.sql.query<MediaRow, [number]>('SELECT * FROM media ORDER BY created DESC LIMIT ?').all(limit);
  return rows;
}

export function mediaExists(studio: string, rel: string): boolean {
  const full = resolveMedia(studio, rel);
  try { return !!full && statSync(full).isFile(); } catch { return false; }
}
