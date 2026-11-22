// 0.23: the island redesign and the NotchNook ideas (shelf, conversions, calendar "next up", focus timer,
// quick buttons, clipboard and media helpers).
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db';
import { startServer } from '../src/server';
import { calendarUrl, convertArgs, joinLink, parseIcs, shelfName, shelfTargets, uniqueName } from '../src/shelf';
import { ACTIONS, DEFAULT_PINS, actionById, pinnable } from '../../src/island/actions';
import { focusLeft, focusStart, focusPause, focusResume, focusLabel } from '../../src/island/focus';
import { clipActions, clipPrompt, clipWorthShowing } from '../../src/island/clip';
import { nextUp } from '../../src/island/nextUp';
import { islandLook } from '../../src/island/look';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'lotus-v023-')); dirs.push(d); return d; };
const stops: (() => void)[] = [];
// Windows keeps the open database locked (EBUSY), so cleanup is best effort.
afterAll(() => { stops.forEach((s) => s()); dirs.forEach((d) => { try { rmSync(d, { recursive: true, force: true }); } catch { /* locked */ } }); });
const SRC = join(import.meta.dir, '../../src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

describe('shelf names and conversions', () => {
  test('names are made safe and unique', () => {
    expect(shelfName('C:\\Users\\me\\notes.pdf')).toBe('notes.pdf');
    expect(shelfName('../../etc/passwd')).toBe('passwd');
    expect(shelfName('a<b>:c?.txt')).toBe('abc.txt');
    expect(shelfName('...')).toBeNull();
    const taken = new Set(['clip.mp4', 'clip (2).mp4']);
    expect(uniqueName('clip.mp4', (n) => taken.has(n))).toBe('clip (3).mp4');
    expect(uniqueName('new.mp4', (n) => taken.has(n))).toBe('new.mp4');
  });
  test('only sensible conversions are offered', () => {
    expect(shelfTargets('talk.mov')).toEqual(['mp4', 'gif', 'mp3']);
    expect(shelfTargets('talk.mp4')).toEqual(['gif', 'mp3']);
    expect(shelfTargets('loop.gif')).toEqual(['mp4']);
    expect(shelfTargets('memo.m4a')).toEqual(['mp3', 'wav']);
    expect(shelfTargets('song.mp3')).toEqual(['wav']);
    expect(shelfTargets('report.pdf')).toEqual([]);
  });
  test('FFmpeg arguments', () => {
    expect(convertArgs('in.mov', 'out.mp4', 'mp4')).toContain('libx264');
    expect(convertArgs('in.mov', 'out.gif', 'gif').join(' ')).toContain('palettegen');
    expect(convertArgs('in.m4a', 'out.wav', 'wav')).toEqual(expect.arrayContaining(['-ar', '16000', '-ac', '1']));
    expect(convertArgs('in.mp4', 'out.mp3', 'mp3')).toContain('-vn');
  });
});

describe('shelf over the core API', () => {
  test('save, list, read, delete; unsafe names refused', async () => {
    const studio = tmp();
    const db = openDb(join(tmp(), 'lotus.db'));
    const token = 't'.repeat(40);
    const srv = startServer({ db, studio, token });
    stops.push(() => { srv.board.stop(); srv.builtins.shutdown(); srv.stop(true); });
    const base = `http://127.0.0.1:${srv.port}`;
    const auth = { authorization: `Bearer ${token}` };
    const put = async (name: string, body: string) => (await fetch(`${base}/v1/shelf?name=${encodeURIComponent(name)}`, { method: 'POST', headers: auth, body })).json() as Promise<{ name: string; bytes: number }>;
    const a = await put('notes.txt', 'hello');
    const b = await put('notes.txt', 'again');
    expect(a.name).toBe('notes.txt');
    expect(b.name).toBe('notes (2).txt');
    const list = await (await fetch(`${base}/v1/shelf`, { headers: auth })).json() as { items: { name: string }[] };
    expect(list.items.map((i) => i.name).sort()).toEqual(['notes (2).txt', 'notes.txt']);
    expect(await (await fetch(`${base}/v1/shelf/${encodeURIComponent('notes (2).txt')}`, { headers: auth })).text()).toBe('again');
    expect((await fetch(`${base}/v1/shelf/${encodeURIComponent('../lotus.db')}`, { headers: auth })).status).toBe(404);
    expect((await fetch(`${base}/v1/shelf/notes.txt`, { method: 'DELETE', headers: auth })).status).toBe(200);
    const after = await (await fetch(`${base}/v1/shelf`, { headers: auth })).json() as { items: { name: string }[] };
    expect(after.items.map((i) => i.name)).toEqual(['notes (2).txt']);
    expect(readFileSync(join(studio, 'Shelf', 'notes (2).txt'), 'utf8')).toBe('again');
    // Without FFmpeg the island is told how to get it.
    const conv = await fetch(`${base}/v1/rpc/shelf_convert`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'notes (2).txt', to: 'mp3' }) });
    expect([409, 500]).toContain(conv.status);
  });
});

describe('calendar: next meeting', () => {
  const now = Date.UTC(2026, 10, 23, 9, 0, 0);
  const ics = [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'SUMMARY:Design review', 'DTSTART:20261123T094500Z', 'DTEND:20261123T101500Z',
    'DESCRIPTION:Join: https://meet.google.com/abc-defg-hij\\nThanks', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Old one', 'DTSTART:20261120T094500Z', 'DTEND:20261120T101500Z', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Cancelled call', 'STATUS:CANCELLED', 'DTSTART:20261123T110000Z', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Standup with a very long', '  title', 'DTSTART:20261123T080000Z', 'DTEND:20261123T093000Z',
    'LOCATION:https://us02web.zoom.us/j/123456789?pwd=abc', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  test('upcoming and ongoing events, cancelled and past ones skipped, folded lines joined', () => {
    const ev = parseIcs(ics, now, now + 36 * 3600e3);
    expect(ev.map((e) => e.title)).toEqual(['Standup with a very long title', 'Design review']);
    expect(ev[1].join).toBe('https://meet.google.com/abc-defg-hij');
    expect(ev[0].join).toBe('https://us02web.zoom.us/j/123456789?pwd=abc');
  });
  test('join links from Teams and Webex too; only https calendar addresses', () => {
    expect(joinLink('see https://teams.microsoft.com/l/meetup-join/19%3ameeting_x/0?context=y.')).toBe('https://teams.microsoft.com/l/meetup-join/19%3ameeting_x/0?context=y');
    expect(joinLink('https://acme.webex.com/meet/jo')).toBe('https://acme.webex.com/meet/jo');
    expect(joinLink('no link')).toBeNull();
    expect(calendarUrl('webcal://calendar.google.com/x/basic.ics')).toBe('https://calendar.google.com/x/basic.ics');
    expect(calendarUrl('http://insecure.example/a.ics')).toBeNull();
  });
});

describe('quick buttons', () => {
  test('the default row is short and every pin names a real action', () => {
    expect(DEFAULT_PINS.length).toBeLessThanOrEqual(6);
    for (const id of DEFAULT_PINS) expect(actionById(id)).toBeTruthy();
    expect(new Set(ACTIONS.map((a) => a.id)).size).toBe(ACTIONS.length);
  });
  test('skills and routines can be pinned by id', () => {
    expect(pinnable('skill:abc')).toBe(true);
    expect(pinnable('routine:r1')).toBe(true);
    expect(pinnable('nope')).toBe(false);
  });
});

describe('focus timer', () => {
  test('counts down, pauses and resumes', () => {
    const t0 = 1_000_000;
    const f = focusStart(25, t0, { id: 't1', title: 'Invoice' });
    expect(focusLeft(f, t0 + 60_000)).toBe(24 * 60_000);
    expect(focusLabel(focusLeft(f, t0 + 61_000))).toBe('23:59');
    const p = focusPause(f, t0 + 120_000);
    expect(focusLeft(p, t0 + 999_000)).toBe(23 * 60_000);
    const r = focusResume(p, t0 + 300_000);
    expect(focusLeft(r, t0 + 360_000)).toBe(22 * 60_000);
    expect(focusLeft(r, t0 + 9e9)).toBe(0);
  });
});

describe('copied text', () => {
  test('passwords-like and tiny copies are not offered; actions are short prompts', () => {
    expect(clipWorthShowing('ok')).toBe(false);
    expect(clipWorthShowing('Xy7$kq9!Lm2#')).toBe(false);
    expect(clipWorthShowing('The mitochondria is the powerhouse of the cell.')).toBe(true);
    expect(clipActions.map((a) => a.id)).toEqual(['explain', 'summarise', 'translate', 'fix', 'read']);
    expect(clipPrompt('translate', 'Olá mundo', 'English')).toContain('English');
  });
});

describe('next up', () => {
  test('meetings soonest first, then tasks due today, then the next routine', () => {
    const now = new Date(2026, 10, 23, 9, 0).getTime();
    const today = '2026-11-23';
    const rows = nextUp({
      now,
      tasks: [{ id: 'a', title: 'Later', status: 'todo', due: '2026-11-30' }, { id: 'b', title: 'Invoice', status: 'todo', due: today }, { id: 'c', title: 'Done one', status: 'done', due: today }],
      routines: [{ id: 'r', name: 'Digest', nextRun: now + 3600e3, enabled: true }, { id: 'off', name: 'Off', nextRun: now + 60e3, enabled: false }],
      events: [{ title: 'Review', start: now + 18 * 60e3, end: null, join: 'https://meet.google.com/abc-defg-hij', allDay: false }],
    });
    expect(rows.map((r) => r.kind)).toEqual(['meeting', 'task', 'routine']);
    expect(rows[0].meta).toBe('in 18 min');
    expect(rows[1].title).toBe('Invoice');
  });
});

describe('the look', () => {
  test('one accent; light and dark surfaces readable; Mac stays black', () => {
    const dark = islandLook(true, 'auto', false);
    const light = islandLook(false, 'auto', false);
    expect(dark.vars['--is-bg']).toBe('#000');
    expect(light.vars['--is-bg']).not.toBe('#000');
    expect(islandLook(false, 'auto', true).vars['--is-bg']).toBe('#000');
    expect(islandLook(false, 'black', false).dark).toBe(true);
    expect(light.floating).toBe(true);
    expect(dark.floating).toBe(false);
  });
  test('the island uses the app accent, not Petal\'s pink, for progress and actions', () => {
    const island = read('island/Island.tsx') + read('island/parts.tsx');
    expect(island).not.toMatch(/hsl\(\$\{hue\} (80|85)%/);
    expect(island).toContain('var(--color-accent-vibrant)');
    // No hard-coded white-on-black utility classes left (they break the light island).
    for (const f of ['island/Island.tsx', 'island/Home.tsx', 'island/IslandChat.tsx', 'island/ApprovalCard.tsx', 'island/ShelfView.tsx', 'island/ClipPeek.tsx']) {
      expect(read(f)).not.toMatch(/\btext-white\/\d|\bbg-white\/\d|bg-\[#2c2c2e\]/);
    }
  });
});
