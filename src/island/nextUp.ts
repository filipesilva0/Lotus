// "Next up" (idea 7): what's next today, from the task board, routines and an optional calendar.
// Pure, so it can be tested; the island feeds it from the core.

export interface NextTask { id: string; title: string; status: string; due?: string }
export interface NextRoutine { id: string; name: string; nextRun?: number; enabled: boolean }
export interface NextEvent { title: string; start: number; end: number | null; join: string | null; allDay: boolean }
export interface NextRow { kind: 'meeting' | 'task' | 'routine'; id: string; title: string; meta: string; join?: string | null; now?: boolean }

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function inWords(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m <= 0) return 'now';
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r && h < 3 ? `in ${h} h ${r} min` : `in ${Math.round(m / 60)} h`;
}

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function nextUp(o: { now: number; tasks: NextTask[]; routines: NextRoutine[]; events: NextEvent[] }, max = 3): NextRow[] {
  const today = ymd(new Date(o.now));
  const meetings: NextRow[] = o.events
    .filter((e) => !e.allDay && (e.end ?? e.start + 30 * 60_000) > o.now && e.start - o.now < 12 * 3600e3)
    .slice(0, 2)
    .map((e) => ({ kind: 'meeting', id: `m${e.start}`, title: e.title, meta: e.start <= o.now ? 'now' : e.start - o.now < 3 * 3600e3 ? inWords(e.start - o.now) : clock(e.start), join: e.join, now: e.start <= o.now }));
  const due: NextRow[] = o.tasks
    .filter((t) => t.status !== 'done' && t.due && t.due <= today)
    .map((t) => ({ kind: 'task', id: t.id, title: t.title, meta: t.due! < today ? 'overdue' : 'due today' }));
  const routine = o.routines.filter((r) => r.enabled && r.nextRun && r.nextRun > o.now).sort((a, b) => a.nextRun! - b.nextRun!)[0];
  const rows: NextRow[] = [...meetings, ...due, ...(routine ? [{ kind: 'routine' as const, id: routine.id, title: routine.name, meta: routine.nextRun! - o.now < 3 * 3600e3 ? inWords(routine.nextRun! - o.now) : clock(routine.nextRun!) }] : [])];
  return rows.slice(0, max);
}
