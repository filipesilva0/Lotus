// soul.read / soul.update (0.10.5): Lotus's soul is its system prompt (Chat → Model → System prompt,
// Library → Soul), sent first in every chat. The model may change it when the user asks it to
// become different ("be more direct", "call yourself Ana", "always answer in Portuguese"). Every
// change asks first (risky) and the previous version is kept, so "undo" brings it back.

import type { Tool, ToolCtx } from '../agent/types';

const SETTINGS_KEY = 'lotus.settings.v1';
export const SOUL_HISTORY_KEY = 'lotus.soul.history.v1';
const MAX = 6000;

function settings(ctx: Pick<ToolCtx, 'kvGet'>): Record<string, unknown> {
  try { const s = JSON.parse(ctx.kvGet(SETTINGS_KEY) || '{}'); return s && typeof s === 'object' ? s : {}; } catch { return {}; }
}
export const readSoul = (ctx: Pick<ToolCtx, 'kvGet'>): string => String(settings(ctx).systemPrompt ?? '');
function history(ctx: Pick<ToolCtx, 'kvGet'>): { text: string; at: number }[] {
  try { const h = JSON.parse(ctx.kvGet(SOUL_HISTORY_KEY) || '[]'); return Array.isArray(h) ? h : []; } catch { return []; }
}

/** The new soul for an update, or why it can't be made. Pure, for tests. */
export function nextSoul(current: string, a: { mode?: string; text?: string; find?: string }, previous?: string): { text: string } | { error: string } {
  const mode = String(a.mode ?? 'append');
  const text = String(a.text ?? '').trim();
  if (mode === 'undo') return previous !== undefined ? { text: previous } : { error: 'There is no earlier version of the soul to go back to.' };
  if (!text && mode !== 'remove') return { error: 'Say what the soul should contain.' };
  let out: string;
  if (mode === 'replace') out = text;
  else if (mode === 'append') out = current.trim() ? `${current.trim()}\n\n${text}` : text;
  else if (mode === 'edit' || mode === 'remove') {
    const find = String(a.find ?? '');
    if (!find) return { error: 'Give the exact passage to change (find).' };
    const n = current.split(find).length - 1;
    if (!n) return { error: 'That passage is not in the soul. Read it with soul.read first.' };
    if (n > 1) return { error: 'That passage appears more than once; give a longer one.' };
    out = current.replace(find, mode === 'remove' ? '' : text).replace(/\n{3,}/g, '\n\n').trim();
  } else return { error: `Unknown mode “${mode}”. Use append, edit, remove, replace or undo.` };
  if (!out.trim()) return { error: 'The soul can’t be empty.' };
  if (out.length > MAX) return { error: `The soul would be ${out.length.toLocaleString()} characters; keep it under ${MAX.toLocaleString()}.` };
  return { text: out };
}

export const soulRead: Tool = {
  name: 'soul.read', label: 'Reading its soul', risk: 'read',
  description: 'Read your soul: the system prompt that defines who you are and how you behave in every chat.',
  parameters: { type: 'object', properties: {} },
  async run(_a, ctx) {
    const s = readSoul(ctx);
    return { ok: true, text: s ? `Your soul (system prompt):\n${s}` : 'Your soul is empty.', summary: `${s.length.toLocaleString()} characters` };
  },
};

export const soulUpdate: Tool = {
  name: 'soul.update', label: 'Changing its soul', risk: 'risky',
  description: 'Change your soul (your system prompt: personality, name, tone, standing rules for every chat) when the user asks you to be different. For a fact about the user or a one-off preference use memory.save instead. Modes: append (add a line, default), edit (replace the exact passage "find" with "text"), remove (delete "find"), replace (write the whole soul), undo (go back to the previous version).',
  parameters: { type: 'object', properties: {
    mode: { type: 'string', description: 'append, edit, remove, replace or undo.', enum: ['append', 'edit', 'remove', 'replace', 'undo'] },
    text: { type: 'string', description: 'The new text (for append, edit, replace).' },
    find: { type: 'string', description: 'The exact passage to change or remove (edit, remove).' },
  } },
  describe: (a) => {
    const m = String(a.mode ?? 'append');
    return m === 'undo' ? 'Undo the last change to its soul' : m === 'remove' ? `Remove from its soul: “${String(a.find ?? '').slice(0, 120)}”` : m === 'replace' ? `Rewrite its soul: “${String(a.text ?? '').slice(0, 160)}…”` : `${m === 'edit' ? 'Change' : 'Add to'} its soul: “${String(a.text ?? '').slice(0, 160)}”`;
  },
  async run(a, ctx) {
    const s = settings(ctx);
    const current = String(s.systemPrompt ?? '');
    const hist = history(ctx);
    const r = nextSoul(current, a as Record<string, string>, hist[0]?.text);
    if ('error' in r) return { ok: false, text: r.error, summary: 'Soul not changed' };
    if (r.text === current) return { ok: true, text: 'The soul already says that; nothing changed.', summary: 'No change' };
    const nextHist = a.mode === 'undo' ? hist.slice(1) : [{ text: current, at: Date.now() }, ...hist].slice(0, 20);
    ctx.kvSet(SOUL_HISTORY_KEY, JSON.stringify(nextHist));
    ctx.kvSet(SETTINGS_KEY, JSON.stringify({ ...s, systemPrompt: r.text }));
    return { ok: true, text: `Soul updated (applies from the next message). It now reads:\n${r.text}`, summary: a.mode === 'undo' ? 'Went back to the previous soul' : 'Soul updated' };
  },
};

export const SOUL_TOOLS = [soulRead, soulUpdate];
