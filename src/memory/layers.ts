// Memory in three layers, like a person's (0.22):
//
//   long   long-term: lasting facts about the user and standing instructions ("always answer in Portuguese").
//          Everything saved before 0.22 is long-term.
//   short  short-term: what is going on in the user's life and work right now (this week's trip, the
//          project they are on). Fades after SHORT_TTL_DAYS unless it keeps coming up, in which case the
//          nightly tidy-up moves it to long-term.
//   chat   one chat's own notes (what this conversation is about, decisions made in it). Recalled only in
//          that chat, and forgotten with it.
//
// Nothing here talks to a model or the database: recall choice, tidy-up planning and the model's tidy-up
// answer are plain functions so the core's tests can check them (core/test/memory-layers.test.ts).

import type { MemoryItem, MemoryTier } from '../types/lotus';

export const TIERS: MemoryTier[] = ['long', 'short', 'chat'];
export const TIER_LABEL: Record<MemoryTier, string> = { long: 'Long-term', short: 'Short-term', chat: 'This chat' };

/** Short-term items fade after this many days without coming up. */
export const SHORT_TTL_DAYS = 14;
/** Chat notes of a chat nobody has opened for this long are let go. */
export const CHAT_TTL_DAYS = 60;
/** Recalled this many times while short-term: it is clearly lasting, so it moves to long-term. */
export const PROMOTE_USES = 3;
/** Caps on what Lotus learns by itself (what the user saves is never capped). */
export const MAX_SHORT = 30;
export const MAX_CHAT = 12;

const DAY = 86_400_000;

export const tierOf = (m: Pick<MemoryItem, 'tier'>): MemoryTier => (m.tier === 'short' || m.tier === 'chat' ? m.tier : 'long');
export const lastSeen = (m: MemoryItem) => Math.max(m.lastUsed ?? 0, m.updated ?? 0, m.ts ?? 0);
const isMine = (m: MemoryItem) => m.source !== 'auto';

// ── words ────────────────────────────────────────────────────────────────────

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();

/** Word-set overlap (Jaccard) between two short texts. */
export function overlap(a: string, b: string): number {
  const A = new Set(norm(a).split(' ').filter(Boolean)), B = new Set(norm(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((w) => { if (B.has(w)) inter++; });
  return inter / (A.size + B.size - inter);
}

// ── recall: what goes into the prompt before a reply ─────────────────────────

export interface RecallPick {
  instructions: MemoryItem[];
  chat: MemoryItem[];
  short: MemoryItem[];
  long: MemoryItem[];
  /** Items that matched the message (their use count goes up: that is how short-term becomes long-term). */
  matched: string[];
  /** Memories left out this time; the model can look them up with memory.search. */
  more: number;
}

/**
 * Chooses the few memories worth sending with this message, instead of all of them:
 *   * standing instructions always (they say how to behave, whatever the topic),
 *   * this chat's own notes, newest first,
 *   * short-term items that match the message, then the two most recent (what is going on right now),
 *   * long-term facts only when they match the message, unless there are so few they cost almost nothing.
 * `matchIds` come from full-text search, best first. Everything stays inside `maxChars`.
 */
export function pickRecall(all: MemoryItem[], matchIds: string[], o: { chatId: string; maxChars: number }): RecallPick {
  const out: RecallPick = { instructions: [], chat: [], short: [], long: [], matched: [], more: 0 };
  const visible = all.filter((m) => tierOf(m) !== 'chat' || m.chatId === o.chatId);
  const rank = new Map(matchIds.map((id, i) => [id, i]));
  const isMatch = (m: MemoryItem) => rank.has(m.id);
  const byMatch = (a: MemoryItem, b: MemoryItem) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9);
  const byRecent = (a: MemoryItem, b: MemoryItem) => lastSeen(b) - lastSeen(a);

  let left = o.maxChars;
  const taken = new Set<string>();
  const take = (list: MemoryItem[], into: MemoryItem[], cap: number) => {
    let room = Math.min(cap, left);
    for (const m of list) {
      if (taken.has(m.id)) continue;
      const cost = m.text.length + 4;
      if (cost > room) continue;
      room -= cost; left -= cost;
      taken.add(m.id); into.push(m);
    }
  };

  const instr = visible.filter((m) => m.kind === 'instruction');
  take([...instr.filter(isMine), ...instr.filter((m) => !isMine(m)).sort(byMatch)], out.instructions, o.maxChars * 0.35);

  const chat = visible.filter((m) => m.kind !== 'instruction' && tierOf(m) === 'chat');
  take([...chat.filter(isMatch).sort(byMatch), ...chat.sort(byRecent)], out.chat, o.maxChars * 0.25);

  const short = visible.filter((m) => m.kind !== 'instruction' && tierOf(m) === 'short');
  take([...short.filter(isMatch).sort(byMatch), ...short.sort(byRecent).slice(0, 2)], out.short, o.maxChars * 0.25);

  const long = visible.filter((m) => m.kind !== 'instruction' && tierOf(m) === 'long');
  const tiny = long.reduce((n, m) => n + m.text.length + 4, 0) <= Math.min(500, o.maxChars * 0.3);
  take(tiny ? long : long.filter(isMatch).sort(byMatch), out.long, left);

  out.matched = [...taken].filter((id) => rank.has(id));
  out.more = visible.length - taken.size;
  return out;
}

// ── tidy-up: the "sleep" pass ────────────────────────────────────────────────

export interface TidyPlan {
  /** Items to delete (only ones Lotus learned, never what the user saved). */
  remove: string[];
  /** Items whose tier changes. */
  move: { id: string; tier: MemoryTier }[];
  /** Plain-words summary counts. */
  counts: { merged: number; promoted: number; faded: number };
}

/**
 * The part of tidying that needs no model:
 *   * short-term items that came up PROMOTE_USES times move to long-term,
 *   * short-term items untouched for SHORT_TTL_DAYS fade (or move to long-term if they came up at least twice),
 *   * chat notes of deleted chats, or of chats idle for CHAT_TTL_DAYS, are let go,
 *   * near-duplicates go: the user's own copy, then the longer-lasting layer, then the newest one stays,
 *   * over the caps, the oldest learned short-term and chat items fade first.
 */
export function planTidy(all: MemoryItem[], o: { now: number; liveChats?: Set<string> }): TidyPlan {
  const plan: TidyPlan = { remove: [], move: [], counts: { merged: 0, promoted: 0, faded: 0 } };
  const gone = new Set<string>();
  const tier = new Map(all.map((m) => [m.id, tierOf(m)]));
  const drop = (m: MemoryItem, why: 'merged' | 'faded') => {
    if (gone.has(m.id) || isMine(m)) return false;
    gone.add(m.id); plan.remove.push(m.id); plan.counts[why]++;
    return true;
  };
  const promote = (m: MemoryItem) => {
    if (tier.get(m.id) === 'long') return;
    tier.set(m.id, 'long'); plan.move.push({ id: m.id, tier: 'long' }); plan.counts.promoted++;
  };

  for (const m of all) {
    const t = tierOf(m), idle = (o.now - lastSeen(m)) / DAY, uses = m.uses ?? 0;
    if (t === 'short') {
      if (uses >= PROMOTE_USES) promote(m);
      else if (idle > SHORT_TTL_DAYS) { if (uses >= 2 || isMine(m)) promote(m); else drop(m, 'faded'); }
    } else if (t === 'chat') {
      const orphan = !!o.liveChats && (!m.chatId || !o.liveChats.has(m.chatId));
      if (orphan || idle > CHAT_TTL_DAYS) drop(m, 'faded');
    }
  }

  // Near-duplicates (same kind; chat notes only against the same chat or the shared layers).
  const keepRank = (m: MemoryItem) => (isMine(m) ? 4 : 0) + (tier.get(m.id) === 'long' ? 2 : tier.get(m.id) === 'short' ? 1 : 0) + lastSeen(m) / 1e15;
  const live = all.filter((m) => !gone.has(m.id));
  for (let i = 0; i < live.length; i++) {
    const a = live[i];
    if (gone.has(a.id)) continue;
    for (let j = i + 1; j < live.length; j++) {
      const b = live[j];
      if (gone.has(b.id) || a.kind !== b.kind) continue;
      if (tier.get(a.id) === 'chat' && tier.get(b.id) === 'chat' && a.chatId !== b.chatId) continue;
      if (overlap(a.text, b.text) < 0.8) continue;
      const [keep, lose] = keepRank(a) >= keepRank(b) ? [a, b] : [b, a];
      if (drop(lose, 'merged') && (lose.uses ?? 0) >= PROMOTE_USES - 1 && tier.get(keep.id) === 'short') promote(keep);
      if (lose === a) break;
    }
  }

  // Caps on what Lotus learned by itself.
  const learned = (t: MemoryTier, chatId?: string) => all.filter((m) => !gone.has(m.id) && !isMine(m) && tier.get(m.id) === t && (chatId === undefined || m.chatId === chatId))
    .sort((a, b) => lastSeen(a) - lastSeen(b));
  const over = (list: MemoryItem[], max: number) => list.slice(0, Math.max(0, list.length - max)).forEach((m) => drop(m, 'faded'));
  over(learned('short'), MAX_SHORT);
  for (const c of new Set(all.filter((m) => tierOf(m) === 'chat').map((m) => m.chatId ?? ''))) over(learned('chat', c), MAX_CHAT);

  plan.move = plan.move.filter((x) => !gone.has(x.id));
  return plan;
}

export interface TidyMerge { ids: string[]; text: string; tier: MemoryTier }
export interface TidyAnswer { merge: TidyMerge[]; promote: string[] }

/**
 * Checks the model's tidy-up answer: it may merge learned items of the same kind into one shorter item and
 * say which short-term items have become lasting. Anything the user saved, unknown ids, secrets and long
 * texts are refused. `sensitive` is learn.ts's looksSensitive (passed in to keep this file standalone).
 */
export function parseTidy(raw: unknown, current: MemoryItem[], sensitive: (t: string) => boolean): TidyAnswer {
  const out: TidyAnswer = { merge: [], promote: [] };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  const byId = new Map(current.filter((m) => !isMine(m)).map((m) => [m.id, m]));
  const used = new Set<string>();
  for (const g of Array.isArray(r.merge) ? r.merge.slice(0, 12) : []) {
    const x = g as Record<string, unknown>;
    const ids = (Array.isArray(x?.ids) ? x.ids : []).map(String).filter((id, i, a) => byId.has(id) && !used.has(id) && a.indexOf(id) === i);
    const text = typeof x?.text === 'string' ? x.text.replace(/\s+/g, ' ').trim() : '';
    if (ids.length < 2 || text.length < 6 || text.length > 240 || sensitive(text)) continue;
    const items = ids.map((id) => byId.get(id)!);
    if (new Set(items.map((m) => m.kind)).size > 1) continue;
    const chats = new Set(items.filter((m) => tierOf(m) === 'chat').map((m) => m.chatId));
    if (chats.size > 1) continue;
    // The merged item sits in the longest-lasting layer of its parts, or long-term when the model says so.
    const tiers = items.map(tierOf);
    const want = x.tier === 'long' ? 'long' : tiers.includes('long') ? 'long' : tiers.includes('short') ? 'short' : 'chat';
    ids.forEach((id) => used.add(id));
    out.merge.push({ ids, text, tier: want });
  }
  for (const id of Array.isArray(r.promote) ? r.promote.slice(0, 20).map(String) : []) {
    const m = byId.get(id);
    if (m && tierOf(m) === 'short' && !used.has(id)) { out.promote.push(id); used.add(id); }
  }
  return out;
}
