// routine.add / routine.list / routine.remove (0.10.1): scheduled routines ("cron jobs") on the Tasks
// page (`lotus.routines.v1`). Each run, Lotus does the routine's instructions and keeps the answer,
// posts it to the board, or turns it into a task. The window's scheduler runs them; saves reach it
// like any other saved change.

import type { Tool, ToolCtx } from '../agent/types';
import { cronFromPreset, describeCron, nextRun, validateCron } from '../../../src/tasks/cron';

export const ROUTINES_KEY = 'lotus.routines.v1';
const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

interface SavedRoutine { id: string; name: string; prompt: string; schedule: string; enabled: boolean; action: 'log' | 'card' | 'task'; web: boolean; catchUp: boolean; nextRun?: number; runs: unknown[]; created: number }

export function readRoutines(ctx: Pick<ToolCtx, 'kvGet'>): SavedRoutine[] {
  try { const v = JSON.parse(ctx.kvGet(ROUTINES_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

const WEEKDAYS: Record<string, number> = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };

/**
 * A schedule from what a model is likely to send: a cron expression, or "daily 08:30",
 * "weekdays 9:00", "weekly monday 18:00", "monthly 10:00", "hourly", "every 2 hours".
 */
export function scheduleFrom(raw: string): { cron: string } | { error: string } {
  const s = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return { error: 'A routine needs a schedule.' };
  if (!validateCron(s)) return { cron: s };
  const time = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/.exec(s);
  let hh = time ? Number(time[1]) : 9;
  const mm = time?.[2] ? Number(time[2]) : 0;
  if (time?.[3] === 'pm' && hh < 12) hh += 12;
  if (time?.[3] === 'am' && hh === 12) hh = 0;
  if (hh > 23 || mm > 59) return { error: `“${raw}” has a time Lotus can't read. Use a cron expression like "30 8 * * *" or "daily 08:30".` };
  const at = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  const every = /every (\d+) hours?/.exec(s);
  if (every) return { cron: cronFromPreset('hourly', `00:${String(mm).padStart(2, '0')}`, 1, Math.max(1, Math.min(23, Number(every[1])))) };
  if (/\bhourly|every hour\b/.test(s)) return { cron: cronFromPreset('hourly', `00:${String(mm).padStart(2, '0')}`) };
  if (/weekdays?|work ?days|monday to friday/.test(s)) return { cron: cronFromPreset('weekdays', at) };
  const day = Object.keys(WEEKDAYS).find((d) => new RegExp(`\\b${d}s?\\b`).test(s));
  if (day) return { cron: cronFromPreset('weekly', at, WEEKDAYS[day]) };
  if (/monthly|every month/.test(s)) return { cron: cronFromPreset('monthly', at) };
  if (/daily|every day|each day|every morning|every evening|every night|\bat\b/.test(s) || time) return { cron: cronFromPreset('daily', at) };
  return { error: `“${raw}” is not a schedule Lotus can read. Use a cron expression ("0 9 * * 1-5") or words like "daily 08:30", "weekdays 9:00", "weekly friday 17:00", "every 2 hours".` };
}

export const routineAdd: Tool = {
  name: 'routine.add', label: 'Scheduling a routine', risk: 'write',
  description: 'Schedule a routine (a cron job): something Lotus does by itself on a schedule, e.g. a morning news summary, a weekly review, a daily reminder. Shown in Tasks → Routines.',
  parameters: { type: 'object', properties: {
    name: { type: 'string', description: 'Short name, e.g. "Morning briefing".' },
    instructions: { type: 'string', description: 'What Lotus should do each time it runs, written as a request to Lotus.' },
    schedule: { type: 'string', description: 'A 5-field cron expression in local time ("30 8 * * 1-5") or words: "daily 08:30", "weekdays 9:00", "weekly monday 18:00", "monthly 10:00", "every 2 hours".' },
    result: { type: 'string', description: '"keep" (default: keep the answer in the routine\'s history), "card" (post it to the board for review) or "task" (add a task Lotus then works through).', enum: ['keep', 'card', 'task'] },
    web: { type: 'boolean', description: 'Search the web first (for news, prices, weather…).' },
  }, required: ['name', 'instructions', 'schedule'] },
  describe: (a) => `Schedule “${String(a.name)}” (${String(a.schedule)})`,
  async run(a, ctx) {
    const name = String(a.name ?? '').trim().slice(0, 80);
    const prompt = String(a.instructions ?? a.prompt ?? '').trim().slice(0, 4000);
    if (!name || !prompt) return { ok: false, text: 'A routine needs a name and instructions.', summary: 'Missing name or instructions' };
    const sch = scheduleFrom(String(a.schedule ?? ''));
    if ('error' in sch) return { ok: false, text: sch.error, summary: 'Schedule not understood' };
    const all = readRoutines(ctx);
    const action = a.result === 'card' ? 'card' : a.result === 'task' ? 'task' : 'log';
    const r: SavedRoutine = { id: uid('rt'), name, prompt, schedule: sch.cron, enabled: true, action, web: a.web === true, catchUp: false, runs: [], created: Date.now(), nextRun: nextRun(sch.cron, new Date())?.getTime() };
    ctx.kvSet(ROUTINES_KEY, JSON.stringify([...all, r]));
    const when = describeCron(sch.cron);
    const next = r.nextRun ? new Date(r.nextRun).toLocaleString() : 'never';
    return { ok: true, text: `Scheduled routine ${r.id} “${name}”: ${when} (cron ${sch.cron}); next run ${next}.`, summary: `Scheduled “${name}”: ${when}`, data: { routineId: r.id } };
  },
};

export const routineList: Tool = {
  name: 'routine.list', label: 'Reading the routines', risk: 'read',
  description: 'List the scheduled routines (cron jobs) with their schedules and next runs.',
  parameters: { type: 'object', properties: {} },
  async run(_a, ctx) {
    const all = readRoutines(ctx);
    return {
      ok: true,
      text: all.length ? all.map((r) => `${r.id} · ${r.name} · ${describeCron(r.schedule)} (${r.schedule}) · ${r.enabled ? `next ${r.nextRun ? new Date(r.nextRun).toLocaleString() : 'not scheduled'}` : 'paused'}`).join('\n') : 'No routines.',
      summary: `${all.length} routine${all.length === 1 ? '' : 's'}`,
    };
  },
};

export const routineRemove: Tool = {
  name: 'routine.remove', label: 'Removing a routine', risk: 'risky',
  description: 'Delete a scheduled routine by id or name.',
  parameters: { type: 'object', properties: { routine: { type: 'string', description: 'The routine id, or its name.' } }, required: ['routine'] },
  describe: (a) => `Delete the routine “${String(a.routine)}”`,
  async run(a, ctx) {
    const ref = String(a.routine ?? '').trim().toLowerCase();
    const all = readRoutines(ctx);
    const hit = all.filter((r) => r.id === String(a.routine).trim() || r.name.toLowerCase() === ref);
    const found = hit.length ? hit : all.filter((r) => r.name.toLowerCase().includes(ref));
    if (found.length !== 1) return { ok: false, text: found.length ? `“${a.routine}” matches ${found.length} routines: ${found.map((r) => `${r.name} (${r.id})`).join(', ')}. Use the id.` : `No routine matches “${a.routine}”.`, summary: 'Routine not found' };
    ctx.kvSet(ROUTINES_KEY, JSON.stringify(all.filter((r) => r.id !== found[0].id)));
    return { ok: true, text: `Deleted the routine “${found[0].name}”.`, summary: `Deleted “${found[0].name}”` };
  },
};

export const ROUTINE_TOOLS = [routineAdd, routineList, routineRemove];
