// The memory tidy-up (0.22), a bit like sleep: once a day, after a reply, or with Assistant → Memory → Tidy now.
//
//   1. Rules, no model (layers.ts planTidy): short-term items that keep coming up move to long-term, stale
//      ones fade, notes of deleted chats go, near-copies merge.
//   2. Only when there is a lot learned: the background model merges overlapping learned items into
//      fewer, shorter ones and says which short-term items have become lasting (layers.ts parseTidy).
//
// Runs as a low-priority background job, so it never slows a reply. Never changes what the user saved.

import { useSyncExternalStore } from 'react';
import { agentPool } from '../agents/pool';
import { extractJson, llm } from '../services/llm';
import { uid } from '../lib/persist';
import { kv } from '../lib/store';
import type { MemoryItem } from '../types/lotus';
import { memoryStore } from './store';
import { looksSensitive } from './learn';
import { parseTidy, planTidy, tierOf } from './layers';

const LAST_KEY = 'lotus.memory.tidied.v1';
const EVERY_MS = 20 * 3_600_000;
/** The model step runs only when this many learned items could be merged. */
const MODEL_FROM = 24;

export interface TidyReport { at: number; merged: number; promoted: number; faded: number; ok: boolean }

let running = false;
let report: TidyReport | null = (() => { try { return JSON.parse(kv.getItem(LAST_KEY) || 'null'); } catch { return null; } })();
const subs = new Set<() => void>();
const snapshot = () => ({ running, report });
let snap = snapshot();
const publish = () => { snap = snapshot(); subs.forEach((f) => f()); };

export function useMemoryTidy() {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => snap, () => snap);
}

const TIDY_PROMPT = (items: MemoryItem[]) => `You tidy the memory of a personal assistant, like sleep tidies a person's memory.
Learned items (id [layer]: text). Layers: long = lasting facts, short = what is going on now, chat = notes for one conversation.
${items.map((m) => `${m.id} [${tierOf(m)}${m.kind === 'instruction' ? ', instruction' : ''}]: ${m.text}`).join('\n')}

1. merge: groups of 2 or more items that say overlapping things. Write ONE shorter item (under 200 characters, third person) that keeps every useful detail. Only merge items of the same kind.
2. promote: ids of short items that read as lasting facts about the user rather than something passing.
Change nothing else. If nothing needs doing, return empty lists.
Reply with JSON only: {"merge":[{"ids":["…","…"],"text":"…"}],"promote":["…"]}`;

/**
 * Tidies memory now. `liveChats`: the ids of the chats that still exist (notes of the others go).
 * Returns what changed, in counts.
 */
export async function tidyMemory(o: { liveChats?: string[]; useModel?: boolean } = {}): Promise<TidyReport> {
  if (running) return report ?? { at: Date.now(), merged: 0, promoted: 0, faded: 0, ok: true };
  running = true; publish();
  const out: TidyReport = { at: Date.now(), merged: 0, promoted: 0, faded: 0, ok: true };
  try {
    // 1. Rules.
    const all = memoryStore.get().memories;
    const plan = planTidy(all, { now: out.at, liveChats: o.liveChats ? new Set(o.liveChats) : undefined });
    for (const id of plan.remove) await memoryStore.deleteMemory(id);
    for (const mv of plan.move) await memoryStore.moveTo([mv.id], mv.tier);
    out.merged += plan.counts.merged; out.promoted += plan.counts.promoted; out.faded += plan.counts.faded;

    // 2. The model, only with plenty learned (an 8 GB card should not spend a minute on six items).
    const learned = memoryStore.get().memories.filter((m) => m.source === 'auto');
    if (o.useModel !== false && learned.length >= MODEL_FROM) {
      try {
        const items = learned.slice(-60);
        const ans = await agentPool.run('Tidying memory', 'memory', async ({ model, numCtx, signal }) => {
          const r = await llm.chatOnce([{ role: 'user', content: TIDY_PROMPT(items) }], { model, numCtx, temperature: 0.1, json: true, signal, numPredict: 900 });
          return parseTidy(extractJson(r.content), items, looksSensitive);
        }, { priority: 2 });
        const now = Date.now();
        for (const g of ans.merge) {
          const parts = items.filter((m) => g.ids.includes(m.id));
          const chatId = g.tier === 'chat' ? parts.find((m) => m.chatId)?.chatId : undefined;
          await memoryStore.putMemories([{ id: uid('mem'), kind: parts[0].kind, text: g.text, source: 'auto', ts: Math.min(...parts.map((m) => m.ts)), updated: now, uses: parts.reduce((n, m) => n + (m.uses ?? 0), 0), tier: g.tier, ...(chatId ? { chatId } : {}) }]);
          for (const id of g.ids) await memoryStore.deleteMemory(id);
          out.merged += g.ids.length - 1;
        }
        if (ans.promote.length) { await memoryStore.moveTo(ans.promote, 'long'); out.promoted += ans.promote.length; }
      } catch { /* no model, or it was busy: the rules above still ran */ }
    }
  } catch {
    out.ok = false;
  } finally {
    running = false;
    report = out;
    try { kv.setItem(LAST_KEY, JSON.stringify(out)); } catch { /* quota */ }
    publish();
  }
  return out;
}

/** Tidies when the last tidy-up was more than 20 hours ago (called after replies and at start). */
export function maybeTidy(liveChats: string[]): void {
  if (running || (report && Date.now() - report.at < EVERY_MS)) return;
  if (!memoryStore.get().memories.length) return;
  void tidyMemory({ liveChats }).catch(() => undefined);
}
