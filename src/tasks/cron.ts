// Cron expressions for routines (pure, unit-tested). Standard 5 fields, local time:
//   minute hour day-of-month month day-of-week
// Supports *, n, a-b, lists (a,b), steps (*/n, a-b/n, n/m), month and weekday names (jan, mon),
// 7 = Sunday, and the shortcuts @hourly @daily @weekly @monthly @yearly.
// Like classic cron, when both day-of-month and day-of-week are restricted, either one matching is enough.

export interface Cron { minute: Set<number>; hour: Set<number>; dom: Set<number>; month: Set<number>; dow: Set<number>; domAny: boolean; dowAny: boolean }

const MACROS: Record<string, string> = { '@hourly': '0 * * * *', '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@weekly': '0 0 * * 0', '@monthly': '0 0 1 * *', '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *' };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function field(src: string, lo: number, hi: number, names?: string[], nameBase = 0): Set<number> {
  const out = new Set<number>();
  const val = (s: string) => {
    const k = s.toLowerCase();
    if (names) { const i = names.indexOf(k.slice(0, 3)); if (i >= 0) return i + nameBase; }
    if (!/^\d+$/.test(s)) throw new Error(`“${s}” is not a number`);
    return parseInt(s, 10);
  };
  for (const part of src.split(',')) {
    const [range, stepS] = part.split('/');
    const step = stepS === undefined ? 1 : parseInt(stepS, 10);
    if (!Number.isFinite(step) || step < 1) throw new Error(`Bad step in “${part}”`);
    let a: number, b: number;
    if (range === '*') { a = lo; b = hi; }
    else if (range.includes('-')) { const [x, y] = range.split('-'); a = val(x); b = val(y); }
    else { a = val(range); b = stepS === undefined ? a : hi; }
    if (a < lo || b > hi || a > b) throw new Error(`“${part}” is outside ${lo}–${hi}`);
    for (let v = a; v <= b; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): Cron {
  const e = (MACROS[expr.trim().toLowerCase()] ?? expr).trim().split(/\s+/);
  if (e.length !== 5) throw new Error('A schedule needs 5 parts: minute hour day month weekday (for example “30 8 * * 1-5”).');
  const dow = field(e[4], 0, 7, DAYS);
  if (dow.has(7)) { dow.delete(7); dow.add(0); }
  return {
    minute: field(e[0], 0, 59), hour: field(e[1], 0, 23), dom: field(e[2], 1, 31), month: field(e[3], 1, 12, MONTHS, 1), dow,
    domAny: e[2] === '*', dowAny: e[4] === '*',
  };
}

export function validateCron(expr: string): string | null {
  try { parseCron(expr); return null; } catch (e) { return (e as Error).message; }
}

function dayMatches(c: Cron, d: Date): boolean {
  const domOk = c.dom.has(d.getDate()), dowOk = c.dow.has(d.getDay());
  if (c.domAny && c.dowAny) return true;
  if (c.domAny) return dowOk;
  if (c.dowAny) return domOk;
  return domOk || dowOk;
}

/** First time strictly after `from` that matches (local time). Null if none within 5 years. */
export function nextRun(expr: string | Cron, from: Date): Date | null {
  const c = typeof expr === 'string' ? parseCron(expr) : expr;
  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const limit = from.getTime() + 5 * 366 * 86_400_000;
  while (d.getTime() <= limit) {
    if (!c.month.has(d.getMonth() + 1)) { d.setMonth(d.getMonth() + 1, 1); d.setHours(0, 0, 0, 0); continue; }
    if (!dayMatches(c, d)) { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); continue; }
    if (!c.hour.has(d.getHours())) { d.setHours(d.getHours() + 1, 0, 0, 0); continue; }
    if (!c.minute.has(d.getMinutes())) { d.setMinutes(d.getMinutes() + 1, 0, 0); continue; }
    return d;
  }
  return null;
}

const pad = (n: number) => String(n).padStart(2, '0');
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Plain-language description of common schedules; falls back to the expression. */
export function describeCron(expr: string): string {
  let c: Cron;
  try { c = parseCron(expr); } catch { return 'Invalid schedule'; }
  const e = (MACROS[expr.trim().toLowerCase()] ?? expr).trim().split(/\s+/);
  const one = (s: Set<number>) => (s.size === 1 ? [...s][0] : null);
  const m = one(c.minute), h = one(c.hour);
  const allMonths = e[3] === '*';
  if (/^\*\/\d+$/.test(e[0]) && e[1] === '*' && c.domAny && c.dowAny && allMonths) return `Every ${e[0].slice(2)} minutes`;
  if (m !== null && e[1] === '*' && c.domAny && c.dowAny && allMonths) return m === 0 ? 'Every hour' : `Every hour at :${pad(m)}`;
  if (m !== null && /^\*\/\d+$/.test(e[1]) && c.domAny && c.dowAny && allMonths) return `Every ${e[1].slice(2)} hours at :${pad(m)}`;
  if (m !== null && h !== null && allMonths) {
    const at = `at ${pad(h)}:${pad(m)}`;
    if (c.domAny && c.dowAny) return `Every day ${at}`;
    if (c.domAny) {
      const days = [...c.dow].sort();
      if (days.join() === '1,2,3,4,5') return `Weekdays ${at}`;
      if (days.join() === '0,6') return `Weekends ${at}`;
      return `Every ${days.map((d) => DAY_NAMES[d]).join(', ')} ${at}`;
    }
    if (c.dowAny && c.dom.size === 1) { const d = [...c.dom][0]; return `Monthly on day ${d} ${at}`; }
  }
  return expr;
}

/** Builds a cron expression from the simple editor (preset + time + weekday). */
export function cronFromPreset(p: 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'monthly', time = '09:00', weekday = 1, interval = 1): string {
  const [hh, mm] = time.split(':').map((x) => parseInt(x, 10) || 0);
  switch (p) {
    case 'hourly': return interval > 1 ? `${mm} */${interval} * * *` : `${mm} * * * *`;
    case 'daily': return `${mm} ${hh} * * *`;
    case 'weekdays': return `${mm} ${hh} * * 1-5`;
    case 'weekly': return `${mm} ${hh} * * ${weekday}`;
    case 'monthly': return `${mm} ${hh} 1 * *`;
  }
}
