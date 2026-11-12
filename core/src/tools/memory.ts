// memory.save / memory.search: Lotus's long-term memory (the memories table, same as Settings →
// Memory). Only offered when memory is on for the chat (never in incognito or with memory off).

import type { Tool } from '../agent/types';
import { listMemories, putMemories, searchMemories } from '../memory';

export const memorySave: Tool = {
  name: 'memory.save', label: 'Saving to memory', risk: 'write',
  description: 'Remember a fact about the user or a standing instruction for future chats (e.g. "Prefers metric units"). Only when the user asks you to remember something, or states a lasting preference.',
  parameters: { type: 'object', properties: {
    text: { type: 'string', description: 'The fact or instruction, as one short sentence.' },
    kind: { type: 'string', description: '"memory" for a fact (default), "instruction" for how the user wants you to behave.', enum: ['memory', 'instruction'] },
  }, required: ['text'] },
  describe: (a) => `Remember “${String(a.text).slice(0, 100)}”`,
  async run(a, ctx) {
    if (!ctx.memoryOn) return { ok: false, text: 'Memory is off for this chat, so nothing was saved.', summary: 'Memory is off' };
    const text = String(a.text).trim().slice(0, 500);
    if (!text) return { ok: false, text: 'Nothing to remember.', summary: 'Empty' };
    const dup = listMemories(ctx.db).find((m) => m.text.trim().toLowerCase() === text.toLowerCase());
    if (dup) return { ok: true, text: `Already remembered: “${dup.text}”.`, summary: `Already remembered “${text.slice(0, 60)}”`, data: { memoryId: dup.id } };
    const now = Date.now();
    const id = `mem-${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    putMemories(ctx.db, [{ id, kind: a.kind === 'instruction' ? 'instruction' : 'memory', text, source: 'agent', uses: 0, ts: now, updated: now }]);
    return { ok: true, text: `Saved to memory: “${text}”.`, summary: `Remembered “${text.slice(0, 60)}”`, data: { memoryId: id } };
  },
};

export const memorySearch: Tool = {
  name: 'memory.search', label: 'Searching memory', risk: 'read',
  description: 'Look up what Lotus remembers about the user (facts and standing instructions).',
  parameters: { type: 'object', properties: { query: { type: 'string', description: 'Words to look for.' } }, required: ['query'] },
  async run(a, ctx) {
    if (!ctx.memoryOn) return { ok: false, text: 'Memory is off for this chat.', summary: 'Memory is off' };
    const ids = searchMemories(ctx.db, String(a.query), 8);
    const all = listMemories(ctx.db);
    const hits = ids.map((id) => all.find((m) => m.id === id)).filter((m): m is NonNullable<typeof m> => !!m);
    return { ok: true, text: hits.length ? hits.map((m) => `- ${m.text}${m.kind === 'instruction' ? ' (instruction)' : ''}`).join('\n') : 'Nothing remembered about that.', summary: `${hits.length} memor${hits.length === 1 ? 'y' : 'ies'} found` };
  },
};

export const MEMORY_TOOLS = [memorySave, memorySearch];
