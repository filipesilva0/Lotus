// The island's shelf (0.23): files you drop on the island are kept in "Lotus Studio/Shelf" until you
// remove them, and the island can turn them into other formats with FFmpeg.
//
//   POST   /v1/shelf?name=        raw bytes → ShelfItem (name made unique: "notes (2).pdf")
//   GET    /v1/shelf              { items: ShelfItem[] } newest first
//   GET    /v1/shelf/<name>       the file
//   DELETE /v1/shelf/<name>
//   rpc shelf_convert { name, to } → ShelfItem (the new file, also on the shelf)
//   rpc calendar_fetch { url }     → { events: CalendarEvent[] } from a private calendar address (.ics)

import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { mimeFor } from './media';
import type { VideoTools } from './video/run';
import { runProgram } from './video/run';

export interface ShelfItem { name: string; bytes: number; added: number; mime: string }
import { shelfTargets, type ShelfTarget } from '../../src/island/shelfRules';
export { shelfTargets, type ShelfTarget };

export const SHELF_DIR = 'Shelf';
export const MAX_SHELF_FILE = 2 * 1024 ** 3;


/** A safe file name: no folders, no characters Windows refuses, no leading dots. Null if nothing is left. */
export function shelfName(raw: string): string | null {
  const n = basename(String(raw ?? '').replace(/\\/g, '/')).replace(/[\u0000-\u001f<>:"|?*]/g, '').trim().replace(/^\.+/, '').slice(0, 140);
  return n || null;
}

/** "clip.mp4" → "clip (2).mp4" while the name is taken. */
export function uniqueName(name: string, taken: (n: string) => boolean): string {
  if (!taken(name)) return name;
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 2; i < 1000; i++) { const n = `${stem} (${i})${ext}`; if (!taken(n)) return n; }
  return `${stem} ${Date.now()}${ext}`;
}

/** FFmpeg arguments for one conversion. GIF: 12 fps, 480 px wide, its own palette so colours stay clean. */
export function convertArgs(input: string, out: string, to: ShelfTarget): string[] {
  const base = ['-y', '-v', 'error', '-i', input];
  switch (to) {
    case 'mp4': return [...base, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:a', 'aac', '-movflags', '+faststart', out];
    case 'gif': return [...base, '-vf', 'fps=12,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse', '-loop', '0', out];
    case 'mp3': return [...base, '-vn', '-c:a', 'libmp3lame', '-q:a', '3', out];
    case 'wav': return [...base, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out];
  }
}

export class Shelf {
  constructor(private studio: string) {}

  dir(): string { const d = join(this.studio, SHELF_DIR); mkdirSync(d, { recursive: true }); return d; }

  /** The full path of a file on the shelf, or null when the name is unsafe or the file is gone. */
  path(name: string): string | null {
    const n = shelfName(name);
    if (!n || n !== name) return null;
    const p = join(this.dir(), n);
    return existsSync(p) && statSync(p).isFile() ? p : null;
  }

  private item(name: string): ShelfItem {
    const s = statSync(join(this.dir(), name));
    return { name, bytes: s.size, added: s.mtimeMs, mime: mimeFor(name) };
  }

  list(): ShelfItem[] {
    return readdirSync(this.dir()).filter((n) => !n.startsWith('.') && statSync(join(this.dir(), n)).isFile())
      .map((n) => this.item(n)).sort((a, b) => b.added - a.added);
  }

  async save(body: ReadableStream<Uint8Array> | ArrayBuffer | Blob, raw: string): Promise<ShelfItem> {
    const safe = shelfName(raw) ?? 'file';
    const name = uniqueName(safe, (n) => existsSync(join(this.dir(), n)));
    await Bun.write(join(this.dir(), name), body instanceof ReadableStream ? new Response(body) : body);
    return this.item(name);
  }

  remove(name: string): void { const p = this.path(name); if (p) unlinkSync(p); }

  async convert(t: VideoTools, name: string, to: ShelfTarget, signal?: AbortSignal): Promise<ShelfItem> {
    const input = this.path(name);
    if (!input) throw new Error(`${name} is no longer on the shelf.`);
    if (!shelfTargets(name).includes(to)) throw new Error(`Lotus can't turn ${name} into ${to.toUpperCase()}.`);
    const stem = name.slice(0, name.length - extname(name).length);
    const outName = uniqueName(`${stem}.${to}`, (n) => existsSync(join(this.dir(), n)));
    await runProgram(t.ffmpeg, convertArgs(input, join(this.dir(), outName), to), { signal });
    return this.item(outName);
  }
}

// ── Calendar (idea 7: "next up") ────────────────────────────────────────────

export interface CalendarEvent { title: string; start: number; end: number | null; join: string | null; allDay: boolean }

/** Video-call links in a meeting's text: Zoom, Google Meet, Teams, Webex. */
export function joinLink(text: string): string | null {
  const m = /https:\/\/(?:[\w-]+\.)?(?:zoom\.us\/(?:j|my|w)\/[^\s"<>\\]+|meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}|teams\.microsoft\.com\/l\/meetup-join\/[^\s"<>\\]+|teams\.live\.com\/meet\/[^\s"<>\\]+|[\w-]+\.webex\.com\/[^\s"<>\\]+)/i.exec(text);
  return m ? m[0].replace(/[),.;]+$/, '') : null;
}

/** "20261123T091500Z", "20261123T091500" (local), "20261123" (all day) → ms. */
function icsTime(v: string): { at: number; allDay: boolean } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(v.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined) return { at: new Date(+y, +mo - 1, +d).getTime(), allDay: true };
  return { at: z ? Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) : new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime(), allDay: false };
}

const unescapeIcs = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

/**
 * Events from an .ics file that start between `from` and `to`. Lines folded with a leading space are
 * joined first. Repeating events (RRULE) are skipped except their first time: enough for "next up"
 * from a private calendar address, which lists upcoming instances on their own in Google and Outlook.
 * Times with a TZID are read as local time.
 */
export function parseIcs(text: string, from: number, to: number): CalendarEvent[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const out: CalendarEvent[] = [];
  let ev: Record<string, string> | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { ev = {}; continue; }
    if (line === 'END:VEVENT') {
      if (ev && ev.DTSTART && (ev.STATUS ?? '').toUpperCase() !== 'CANCELLED') {
        const st = icsTime(ev.DTSTART);
        const en = ev.DTEND ? icsTime(ev.DTEND) : null;
        if (st && st.at >= from - (en ? Math.max(0, en.at - st.at) : 0) && st.at <= to) {
          out.push({ title: unescapeIcs(ev.SUMMARY ?? 'Busy'), start: st.at, end: en?.at ?? null, allDay: st.allDay, join: joinLink(`${ev.LOCATION ?? ''} ${ev.URL ?? ''} ${unescapeIcs(ev.DESCRIPTION ?? '')} ${ev['X-GOOGLE-CONFERENCE'] ?? ''}`) });
        }
      }
      ev = null; continue;
    }
    if (!ev) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).split(';')[0].toUpperCase();
    if (!(key in ev)) ev[key] = line.slice(i + 1);
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Only https calendar addresses (webcal:// is the same thing). */
export function calendarUrl(raw: string): string | null {
  const u = String(raw ?? '').trim().replace(/^webcal:\/\//i, 'https://');
  try { const p = new URL(u); return p.protocol === 'https:' ? p.toString() : null; } catch { return null; }
}

export async function fetchCalendar(raw: string, fetcher: typeof fetch, now = Date.now()): Promise<CalendarEvent[]> {
  const url = calendarUrl(raw);
  if (!url) throw new Error('That calendar address should start with https:// or webcal://.');
  const r = await fetcher(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`The calendar address answered ${r.status}. Copy the private address again from your calendar's settings.`);
  const text = await r.text();
  if (!/BEGIN:VCALENDAR/.test(text)) throw new Error('That address is not a calendar (.ics) file.');
  return parseIcs(text, now, now + 36 * 3600e3).slice(0, 20);
}
