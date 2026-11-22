// 0.22: memory in three layers (long-term, short-term, this chat), recall that sends only what fits the
// message, and the daily tidy-up. Pure parts from src/memory/layers.ts, the database and the tools from core.

import { afterAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, SCHEMA_VERSION, schemaVersion } from '../src/db';
import * as mem from '../src/memory';
import { memorySave, memorySearch } from '../src/tools/memory';
import type { ToolCtx } from '../src/agent/types';
import { parseTidy, pickRecall, planTidy, PROMOTE_USES, SHORT_TTL_DAYS, tierOf } from '../../src/memory/layers';
import type { MemoryItem } from '../../src/types/lotus';

const dirs: string[] = [];
const tmp = (tag: string) => { const d = mkdtempSync(join(tmpdir(), `lotusd-${tag}-`)); dirs.push(d); return d; };
afterAll(() => dirs.forEach((d) => { try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows */ } }));

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;
let n = 0;
const item = (text: string, o: Partial<MemoryItem> = {}): MemoryItem => ({ id: o.id ?? `m${++n}`, text, kind: 'memory', ts: o.updated ?? NOW - DAY, updated: NOW - DAY, source: 'auto', uses: 0, ...o });

describe('recall sends only what fits the message', () => {
  const all = [
    item('Answer in British English', { id: 'i1', kind: 'instruction', source: 'user' }),
    item('Works as a physiotherapist in Lisbon', { id: 'l1', tier: 'long' }),
    item('Has an RTX 4060 with 8 GB of video memory', { id: 'l2' }), // no tier: saved before 0.22 = long-term
    item('Plays padel on Sundays', { id: 'l3', tier: 'long' }),
    item('Has a cat called Miso who hates the vet', { id: 'l4', tier: 'long' }),
    // Enough long-term facts that sending them all would cost real context.
    ...Array.from({ length: 12 }, (_, i) => item(`Long-term fact number ${i} that has nothing to do with the question`, { id: `x${i}`, tier: 'long' as const })),
    item('Writing a grant application due 30 November', { id: 's1', tier: 'short', updated: NOW - 2 * DAY }),
    item('Moving house next month', { id: 's2', tier: 'short', updated: NOW - 5 * DAY }),
    item('Was ill last week', { id: 's3', tier: 'short', updated: NOW - 9 * DAY }),
    item('This chat is about the clinic website colours', { id: 'c1', tier: 'chat', chatId: 'chatA' }),
    item('Chose teal for the header', { id: 'c2', tier: 'chat', chatId: 'chatA' }),
    item('Other chat: budget spreadsheet', { id: 'c3', tier: 'chat', chatId: 'chatB' }),
  ];
  const ids = (l: MemoryItem[]) => l.map((m) => m.id);

  test('old memories without a layer are long-term', () => {
    expect(tierOf({})).toBe('long');
    expect(tierOf({ tier: 'short' })).toBe('short');
  });

  test('instructions always; long-term facts only when they match', () => {
    const p = pickRecall(all, ['l2'], { chatId: 'chatX', maxChars: 1400 });
    expect(ids(p.instructions)).toEqual(['i1']);
    expect(ids(p.long)).toEqual(['l2']);
    expect(p.more).toBeGreaterThan(0);
    expect(p.matched).toEqual(['l2']);
  });

  test('chat notes only in their own chat', () => {
    expect(ids(pickRecall(all, [], { chatId: 'chatA', maxChars: 1400 }).chat).sort()).toEqual(['c1', 'c2']);
    expect(pickRecall(all, ['c1'], { chatId: 'chatB', maxChars: 1400 }).chat.map((m) => m.id)).toEqual(['c3']);
  });

  test('short-term: matches first, then the two most recent', () => {
    const p = pickRecall(all, ['s3'], { chatId: 'chatX', maxChars: 1400 });
    expect(ids(p.short)).toEqual(['s3', 's1', 's2']);
    expect(ids(pickRecall(all, [], { chatId: 'chatX', maxChars: 1400 }).short)).toEqual(['s1', 's2']);
  });

  test('stays inside the budget', () => {
    const big = Array.from({ length: 40 }, (_, i) => item(`Fact number ${i} about something rather long and wordy to fill space`, { id: `b${i}` }));
    const p = pickRecall(big, big.map((m) => m.id), { chatId: '', maxChars: 600 });
    const used = [...p.instructions, ...p.chat, ...p.short, ...p.long].reduce((s, m) => s + m.text.length + 4, 0);
    expect(used).toBeLessThanOrEqual(600);
    expect(p.more).toBe(40 - p.long.length);
  });

  test('a handful of long-term facts cost little, so all go', () => {
    const few = [item('Name is Filipe', { id: 'f1' }), item('Lives in Porto', { id: 'f2' })];
    expect(pickRecall(few, [], { chatId: '', maxChars: 1400 }).long.length).toBe(2);
  });
});

describe('tidy-up', () => {
  test('short-term that keeps coming up moves to long-term; stale short-term fades', () => {
    const all = [
      item('Learning Rust', { id: 'hot', tier: 'short', uses: PROMOTE_USES, updated: NOW - DAY }),
      item('Has a dentist appointment', { id: 'old', tier: 'short', uses: 0, updated: NOW - (SHORT_TTL_DAYS + 1) * DAY }),
      item('Training for a 10k', { id: 'oldUsed', tier: 'short', uses: 2, updated: NOW - (SHORT_TTL_DAYS + 1) * DAY }),
      item('Saved by hand', { id: 'mine', tier: 'short', source: 'user', updated: NOW - 40 * DAY }),
      item('Fresh', { id: 'fresh', tier: 'short' }),
    ];
    const p = planTidy(all, { now: NOW });
    expect(p.remove).toEqual(['old']);
    expect(p.move.map((x) => x.id).sort()).toEqual(['hot', 'mine', 'oldUsed']);
    expect(p.counts).toEqual({ merged: 0, promoted: 3, faded: 1 });
  });

  test('notes of deleted chats go; near-copies merge, keeping the user\'s own and the long-term one', () => {
    const all = [
      item('Notes for a deleted chat', { id: 'orphan', tier: 'chat', chatId: 'gone' }),
      item('Notes for a live chat', { id: 'live', tier: 'chat', chatId: 'here' }),
      item('Prefers dark mode in every app', { id: 'u', source: 'user' }),
      item('prefers dark mode in every app!', { id: 'a', tier: 'short' }),
      item('Uses Windows 11 on a desktop PC', { id: 'L', tier: 'long' }),
      item('Uses Windows 11 on a desktop PC', { id: 'S', tier: 'short' }),
    ];
    const p = planTidy(all, { now: NOW, liveChats: new Set(['here']) });
    expect(p.remove.sort()).toEqual(['S', 'a', 'orphan']);
    expect(p.counts.merged).toBe(2);
    expect(p.counts.faded).toBe(1);
  });

  test('the user\'s own items are never removed, even as duplicates of each other', () => {
    const all = [item('Likes tea', { id: 'x', source: 'user' }), item('Likes tea', { id: 'y', source: 'user' })];
    expect(planTidy(all, { now: NOW }).remove).toEqual([]);
  });

  test('the model\'s merge answer is checked', () => {
    const cur = [
      item('Has a cat', { id: 'a' }), item('The cat is called Miso', { id: 'b' }),
      item('Saved by the user', { id: 'u', source: 'user' }),
      item('Going to Japan in March', { id: 's', tier: 'short' }),
      item('Rule', { id: 'r', kind: 'instruction' }),
    ];
    const ans = parseTidy({
      merge: [
        { ids: ['a', 'b'], text: 'Has a cat called Miso' },
        { ids: ['u', 'a'], text: 'touches a user item' },         // user item: refused (and a is taken)
        { ids: ['s', 'r'], text: 'mixes kinds' },                // fact + instruction: refused
        { ids: ['zz', 's'], text: 'one unknown id leaves one' }, // < 2 ids: refused
      ],
      promote: ['s', 'a', 'u'],
    }, cur, (t) => /password/.test(t));
    expect(ans.merge).toEqual([{ ids: ['a', 'b'], text: 'Has a cat called Miso', tier: 'long' }]);
    expect(ans.promote).toEqual(['s']);
    expect(parseTidy({ merge: [{ ids: ['a', 'b'], text: 'password is hunter2' }] }, cur, (t) => /password/.test(t)).merge).toEqual([]);
  });
});

describe('database and tools', () => {
  test('existing memories carry over as long-term when the database is upgraded', () => {
    const dir = tmp('up');
    // A version-3 database with the old memories table, as 0.21 left it.
    const old = new Database(join(dir, 'lotus.db'), { create: true });
    old.run('CREATE TABLE memories(id TEXT PRIMARY KEY, kind TEXT, text TEXT, source TEXT, uses INTEGER, ts INTEGER, updated INTEGER)');
    old.run("INSERT INTO memories VALUES ('old1', 'memory', 'Lives in Porto', 'user', 3, 1, 1)");
    old.run('PRAGMA user_version = 3');
    old.close();
    const db = openDb(dir);
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    const rows = mem.listMemories(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'old1', text: 'Lives in Porto', tier: 'long', uses: 3 });
  });

  test('layers, chat filter, touch and forgetting a chat', () => {
    const db = openDb(tmp('tiers'));
    mem.putMemories(db, [
      { id: 'l', kind: 'memory', text: 'Owns a red bicycle', source: 'user', uses: 0, ts: 1, updated: 1, tier: 'long' },
      { id: 's', kind: 'memory', text: 'Fixing the bicycle brakes this week', source: 'auto', uses: 0, ts: 2, updated: 2, tier: 'short' },
      { id: 'c', kind: 'memory', text: 'In this chat: bicycle shop opening hours', source: 'auto', uses: 0, ts: 3, updated: 3, tier: 'chat', chatId: 'A' },
    ]);
    expect(mem.searchMemories(db, 'bicycle', 10).sort()).toEqual(['l', 's']);
    expect(mem.searchMemories(db, 'bicycle', 10, { chatId: 'A' }).sort()).toEqual(['c', 'l', 's']);
    expect(mem.searchMemories(db, 'bicycle', 10, { chatId: 'B' }).sort()).toEqual(['l', 's']);
    expect(mem.searchMemories(db, 'bicycle', 10, { tiers: ['short'] })).toEqual(['s']);
    mem.touchMemories(db, ['s'], 99);
    expect(mem.listMemories(db).find((m) => m.id === 's')).toMatchObject({ uses: 1, lastUsed: 99 });
    mem.forgetSession(db, 'A');
    expect(mem.listMemories(db).map((m) => m.id).sort()).toEqual(['l', 's']);
  });

  test('memory.save takes a layer; memory.search looks through layers and past chats', async () => {
    const db = openDb(tmp('tool'));
    const ctx = { db, memoryOn: true, chatId: 'chat1' } as unknown as ToolCtx;
    expect((await memorySave.run({ text: 'Planning a trip to Kyoto in April', layer: 'short' }, ctx)).text).toContain('short-term');
    expect((await memorySave.run({ text: 'This chat: the Kyoto hotel shortlist', layer: 'chat' }, ctx)).ok).toBe(true);
    expect((await memorySave.run({ text: 'Is vegetarian' }, ctx)).ok).toBe(true);
    const rows = mem.listMemories(db);
    expect(rows.find((m) => m.text.startsWith('Planning'))?.tier).toBe('short');
    expect(rows.find((m) => m.text.startsWith('This chat'))).toMatchObject({ tier: 'chat', chatId: 'chat1' });
    expect(rows.find((m) => m.text === 'Is vegetarian')?.tier).toBe('long');
    // Without a chat, a chat note becomes short-term.
    await memorySave.run({ text: 'Note with no chat', layer: 'chat' }, { ...ctx, chatId: undefined } as ToolCtx);
    expect(mem.listMemories(db).find((m) => m.text === 'Note with no chat')?.tier).toBe('short');

    mem.indexMessages(db, [{ id: 'p1', sessionId: 'old', title: 'Japan ideas', role: 'user', content: 'Which temples in Kyoto are quiet early?', ts: 5 }]);
    const r = await memorySearch.run({ query: 'Kyoto' }, ctx);
    expect(r.text).toContain('Short-term:');
    expect(r.text).toContain('This chat:');
    expect(r.text).toContain('Earlier conversations');
    expect(r.summary).toBe('2 memories, 1 past chat found');
    // Another chat does not see chat1's note.
    expect((await memorySearch.run({ query: 'hotel shortlist', past_chats: false }, { ...ctx, chatId: 'chat2' } as ToolCtx)).text).toBe('Nothing remembered about that.');
  });
});
