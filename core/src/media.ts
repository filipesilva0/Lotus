// Images and audio as real files in the Lotus Studio folder (Documents/Lotus Studio by default):
//   Images/<generation>/Output 1.png, Reference 1.png   (0.9.5: one folder per generation)
//   Audio/2026-11/<name>.wav                             (and images saved before 0.9.5: Images/2026-11/…)
// They used to live only in the browser (IndexedDB blobs, or not at all), so they vanished with the
// app profile and were invisible to the user (B9/B10). The `media` table indexes them.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
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

/** The type from the file's first bytes, for uploads that arrive without one (0.7/0.8 sent some as application/octet-stream). */
export function sniffMime(body: ArrayBuffer | Uint8Array): string | null {
  const b = body instanceof Uint8Array ? body : new Uint8Array(body);
  const at = (s: string, o = 0) => [...s].every((c, i) => b[o + i] === c.charCodeAt(0));
  if (b[0] === 0x89 && at('PNG', 1)) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (at('RIFF') && at('WEBP', 8)) return 'image/webp';
  if (at('RIFF') && at('WAVE', 8)) return 'audio/wav';
  if (at('GIF8')) return 'image/gif';
  if (at('OggS')) return 'audio/ogg';
  if (at('fLaC')) return 'audio/flac';
  if (at('ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'audio/webm';
  return null;
}

/** A folder name made from a prompt or title: readable, safe on every OS, at most ~48 characters. */
export function folderNameFrom(text: string, now = new Date()): string {
  const words = String(text ?? '').replace(/<lora:[^>]*>/gi, ' ').replace(/[\\/:*?"<>|#%&{}$!'`@=+^~\[\]();,.\u0000-\u001f]+/g, ' ').split(/\s+/).filter(Boolean);
  let out = '';
  for (const w of words) { if ((out + ' ' + w).trim().length > 48) break; out = (out + ' ' + w).trim(); }
  if (!out && words[0]) out = words[0].slice(0, 48);
  out = out.replace(/^[.\s]+|[.\s]+$/g, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(out)) out = `${out} image`;
  if (!out) out = `Image ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}.${String(now.getMinutes()).padStart(2, '0')}`;
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** A checked folder name (one level, no separators), or null. */
export function cleanDir(dir: unknown): string | null {
  if (typeof dir !== 'string') return null;
  const d = dir.trim();
  if (!d || d.length > 80 || /[\\/:*?"<>|\u0000-\u001f]/.test(d) || d === '.' || d === '..' || /^[.\s]|[.\s]$/.test(d)) return null;
  return d;
}

/** Creates a new, unused folder for one generation under Images/ ("Red fox", "Red fox 2", …). */
export function newImageFolder(studio: string, text: string, now = new Date()): string {
  const base = folderNameFrom(text, now);
  let name = base;
  for (let i = 2; existsSync(join(studio, FOLDER.image, name)); i++) name = `${base} ${i}`;
  mkdirSync(join(studio, FOLDER.image, name), { recursive: true });
  return name;
}

export interface SaveOpts {
  /** Folder under Images/ or Audio/ (one level, from `newImageFolder`); default: the month. */
  dir?: string;
  /** Name the file "<name> N" with the next free N ("Output 3"). */
  numbered?: boolean;
  /** With `numbered`: if the folder already has a "<name> N" file with the same bytes, return it instead. */
  reuse?: boolean;
}

export async function saveMedia(db: Db, studio: string, body: ArrayBuffer | Uint8Array, mime: string, name: string, now = new Date(), opts: SaveOpts = {}): Promise<MediaRow> {
  let type = mime.split(';')[0].trim().toLowerCase();
  if (!kindOf(type)) type = sniffMime(body) ?? type;
  const kind = kindOf(type);
  if (!kind) throw new Error(`Lotus only saves images and audio here, not ${type || 'unknown files'}.`);
  const bytes = body.byteLength;
  if (!bytes) throw new Error('The file is empty.');
  if (bytes > MAX_MEDIA) throw new Error('The file is larger than 200 MB.');
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const sub = (opts.dir !== undefined ? cleanDir(opts.dir) : null) ?? month;
  if (opts.dir !== undefined && sub === month) throw new Error('That folder name can\'t be used.');
  const dirRel = `${FOLDER[kind]}/${sub}`;
  const dirFull = join(studio, FOLDER[kind], sub);
  mkdirSync(dirFull, { recursive: true });
  let rel: string;
  if (opts.numbered) {
    // "Output 1.png", "Output 2.png", …: the next number after the highest one in the folder.
    const label = String(name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 40) || 'File';
    const re = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (\\d+)\\.[a-z0-9]+$`, 'i');
    const taken = readdirSync(dirFull).map((f) => ({ f, m: re.exec(f) })).filter((x) => x.m);
    if (opts.reuse) {
      const mine = body instanceof Uint8Array ? body : new Uint8Array(body);
      for (const { f } of taken) {
        const full = join(dirFull, f);
        try {
          if (statSync(full).size !== bytes) continue;
          const theirs = readFileSync(full);
          if (theirs.length === mine.length && theirs.every((v, i) => v === mine[i])) {
            const r = `${dirRel}/${f}`;
            const row = db.sql.query<MediaRow, [string]>('SELECT * FROM media WHERE path = ?').get(r);
            return row ?? { path: r, kind, mime: mimeFor(f), bytes, created: now.getTime() };
          }
        } catch { /* unreadable: ignore */ }
      }
    }
    let n = taken.reduce((mx, x) => Math.max(mx, Number(x.m![1])), 0) + 1;
    rel = `${dirRel}/${label} ${n}.${EXT[type]}`;
    while (existsSync(join(studio, ...rel.split('/')))) rel = `${dirRel}/${label} ${++n}.${EXT[type]}`;
  } else {
    const base = safeName(name);
    rel = `${dirRel}/${base}.${EXT[type]}`;
    for (let i = 2; existsSync(join(studio, ...rel.split('/'))); i++) rel = `${dirRel}/${base}-${i}.${EXT[type]}`;
  }
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
