// memory.save / memory.search: Lotus's memory (the memories table, Assistant → Memory). Only offered when
// memory is on for the chat (never in incognito or with memory off).
//
// 0.22: memory has three layers (src/memory/layers.ts). Before each reply only the few memories that fit the
// message are sent; memory.search is how the model looks through the rest (and through past chats) when
// it needs more.

import type { Tool } from '../agent/types';
import { listMemories, putMemories, searchMemories, searchMessages, touchMemories } from '../memory';

const TIER_NAME: Record<string, string> = { long: 'Long-term', short: 'Short-term', chat: 'This chat' };
const tierOf = (t: unknown) => (t === 'short' || t === 'chat' ? t : 'long');

export const memorySave: Tool = {
  name: 'memory.save', label: 'Saving to memory', risk: 'write',
  description: 'Remember something for later. layer "long" (default): lasting facts about the user or standing instructions ("Prefers metric units"). "short": what is going on now and matters for days or weeks ("Moving house in December"). "chat": a note only for this conversation. Use when the user asks you to remember, or states a lasting preference.',
  parameters: { type: 'object', properties: {
    text: { type: 'string', description: 'The fact or instruction, as one short sentence.' },
    kind: { type: 'string', description: '"memory" for a fact (default), "instruction" for how the user wants you to behave.', enum: ['memory', 'instruction'] },
    layer: { type: 'string', description: 'Where it goes: "long" (default), "short" or "chat".', enum: ['long', 'short', 'chat'] },
  }, required: ['text'] },
  describe: (a) => `Remember “${String(a.text).slice(0, 100)}”`,
  async run(a, ctx) {
    if (!ctx.memoryOn) return { ok: false, text: 'Memory is off for this chat, so nothing was saved.', summary: 'Memory is off' };
    const text = String(a.text).trim().slice(0, 500);
    if (!text) return { ok: false, text: 'Nothing to remember.', summary: 'Empty' };
    let tier = tierOf(a.layer ?? a.tier);
    if (tier === 'chat' && !ctx.chatId) tier = 'short';
    const dup = listMemories(ctx.db).find((m) => m.text.trim().toLowerCase() === text.toLowerCase() && (m.tier !== 'chat' || m.chatId === ctx.chatId));
    if (dup) return { ok: true, text: `Already remembered: “${dup.text}”.`, summary: `Already remembered “${text.slice(0, 60)}”`, data: { memoryId: dup.id } };
    const now = Date.now();
    const id = `mem-${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    putMemories(ctx.db, [{ id, kind: a.kind === 'instruction' ? 'instruction' : 'memory', text, source: 'agent', uses: 0, ts: now, updated: now, tier, chatId: tier === 'chat' ? ctx.chatId : null }]);
    return { ok: true, text: `Saved to ${TIER_NAME[tier].toLowerCase()} memory: “${text}”.`, summary: `Remembered “${text.slice(0, 60)}”`, data: { memoryId: id } };
  },
};

export const memorySearch: Tool = {
  name: 'memory.search', label: 'Searching memory', risk: 'read',
  description: 'Look through everything Lotus remembers: long-term facts and instructions, short-term notes, this chat\'s notes, and (with past_chats) earlier conversations. Only a few memories come with each message, so search when something about the user or an earlier talk could help.',
  parameters: { type: 'object', properties: {
    query: { type: 'string', description: 'Words to look for.' },
    layer: { type: 'string', description: 'Only one layer: "long", "short" or "chat". Default: all.', enum: ['long', 'short', 'chat'] },
    past_chats: { type: 'boolean', description: 'Also search earlier conversations (default true).' },
  }, required: ['query'] },
  async run(a, ctx) {
    if (!ctx.memoryOn) return { ok: false, text: 'Memory is off for this chat.', summary: 'Memory is off' };
    const query = String(a.query ?? '');
    const layer = a.layer ? tierOf(a.layer) : null;
    const ids = searchMemories(ctx.db, query, 10, { tiers: layer ? [layer] : undefined, chatId: ctx.chatId });
    const all = listMemories(ctx.db);
    const hits = ids.map((id) => all.find((m) => m.id === id)).filter((m): m is NonNullable<typeof m> => !!m);
    if (hits.length) touchMemories(ctx.db, hits.map((m) => m.id));
    const parts: string[] = [];
    for (const t of ['chat', 'short', 'long']) {
      const list = hits.filter((m) => tierOf(m.tier) === t);
      if (list.length) parts.push(`${TIER_NAME[t]}:\n${list.map((m) => `- ${m.text}${m.kind === 'instruction' ? ' (instruction)' : ''}`).join('\n')}`);
    }
    let chats = 0;
    if (a.past_chats !== false && !layer) {
      const seen = new Set<string>();
      const lines: string[] = [];
      for (const h of searchMessages(ctx.db, query, ctx.chatId ?? '', 8)) {
        if (seen.size >= 3 && !seen.has(h.sessionId)) continue;
        seen.add(h.sessionId);
        if (lines.length >= 5) break;
        lines.push(`- “${h.title}” (${new Date(h.ts).toISOString().slice(0, 10)}) ${h.role === 'user' ? 'User' : 'Assistant'}: ${h.snippet.replace(/\s+/g, ' ').slice(0, 220)}`);
      }
      chats = seen.size;
      if (lines.length) parts.push(`Earlier conversations (may be outdated):\n${lines.join('\n')}`);
    }
    const n = hits.length;
    return {
      ok: true,
      text: parts.length ? parts.join('\n\n') : 'Nothing remembered about that.',
      summary: `${n} memor${n === 1 ? 'y' : 'ies'}${chats ? `, ${chats} past chat${chats === 1 ? '' : 's'}` : ''} found`,
    };
  },
};

export const MEMORY_TOOLS = [memorySave, memorySearch];
