// Usage analytics for the profile page (session 7). Computed on this PC from data Lotus already
// keeps (saved chats, memory, skills, plugins, the image gallery). Nothing is sent anywhere, and
// every number shown comes from here: no estimates are dressed up as measurements.

import type { ChatSession } from '../types/lotus';

export interface DayBucket { key: string; label: string; date: number; sent: number; replies: number }
export interface ModelRow { model: string; replies: number; avgTps: number | null; words: number }
export interface Usage {
  chats: number;
  sent: number;
  replies: number;
  /** Words in replies (whitespace split). */
  words: number;
  /** Mean tokens/second over replies that reported it. */
  avgTps: number | null;
  activeDays30: number;
  /** Consecutive days with at least one message, ending today (or yesterday). */
  streak: number;
  days: DayBucket[];
  /** Messages you sent by hour of day (0–23), all time. */
  hours: number[];
  models: ModelRow[];
  features: { id: string; label: string; count: number }[];
  firstUse: number | null;
}

const DAY = 86_400_000;
const dayStart = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Messages carry their creation time in the id (`user-<ms>`, `assistant-<ms>`); older ones fall back to the chat time. */
export function messageTime(id: string, fallback: number): number {
  const m = /(?:^|-)(\d{12,14})(?:-\d+)?$/.exec(id);
  const t = m ? Number(m[1]) : NaN;
  return Number.isFinite(t) && t > 1_500_000_000_000 && t < 4_000_000_000_000 ? t : fallback;
}

const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

export function computeUsage(sessions: ChatSession[], o: { now?: number; days?: number } = {}): Usage {
  const now = o.now ?? Date.now();
  const nDays = o.days ?? 14;
  const today = dayStart(now);
  const days: DayBucket[] = Array.from({ length: nDays }, (_, i) => {
    const date = today - (nDays - 1 - i) * DAY;
    return { key: dayKey(date), label: new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), date, sent: 0, replies: 0 };
  });
  const byKey = new Map(days.map((d) => [d.key, d]));
  const hours = Array<number>(24).fill(0);
  const models = new Map<string, { replies: number; tps: number; tpsN: number; words: number }>();
  const active = new Set<string>();
  let sent = 0, replies = 0, words = 0, tpsSum = 0, tpsN = 0, first: number | null = null;
  const feat = { thinking: 0, web: 0, memory: 0, choices: 0, files: 0 };

  for (const s of sessions) {
    if (s.incognito) continue;
    for (const m of s.messages) {
      if (m.role === 'system' || (!m.content.trim() && !m.files?.length)) continue;
      const t = messageTime(m.id, s.ts);
      first = first === null ? t : Math.min(first, t);
      const k = dayKey(t);
      active.add(k);
      const b = byKey.get(k);
      if (m.role === 'user') {
        sent++;
        hours[new Date(t).getHours()]++;
        if (b) b.sent++;
        if (m.files?.length) feat.files++;
      } else {
        if (m.isStreaming) continue;
        replies++;
        const w = wordCount(m.content);
        words += w;
        if (b) b.replies++;
        const key = s.model || 'Unknown model';
        const row = models.get(key) ?? { replies: 0, tps: 0, tpsN: 0, words: 0 };
        row.replies++; row.words += w;
        if (m.tokensPerSec && m.tokensPerSec > 0) { row.tps += m.tokensPerSec; row.tpsN++; tpsSum += m.tokensPerSec; tpsN++; }
        models.set(key, row);
        if (m.mode?.thinking) feat.thinking++;
        if (m.mode?.web) feat.web++;
        if (m.recall && (m.recall.memories || m.recall.sessions || m.recall.skills.length || m.recall.projectFiles)) feat.memory++;
        if (m.pollAnswer) feat.choices++;
      }
    }
  }

  // Streak: count back from today (a streak that ended yesterday still counts until today is over).
  let streak = 0;
  let d = today;
  if (!active.has(dayKey(d))) d -= DAY;
  while (active.has(dayKey(d))) { streak++; d -= DAY; }
  const cutoff = today - 29 * DAY;
  const activeDays30 = [...active].filter((k) => { const [y, mo, da] = k.split('-').map(Number); return new Date(y, mo - 1, da).getTime() >= cutoff; }).length;

  return {
    chats: sessions.filter((s) => !s.incognito && s.messages.some((m) => m.role === 'user')).length,
    sent, replies, words,
    avgTps: tpsN ? Math.round((tpsSum / tpsN) * 10) / 10 : null,
    activeDays30, streak, days, hours,
    models: [...models.entries()].map(([model, r]) => ({ model, replies: r.replies, words: r.words, avgTps: r.tpsN ? Math.round((r.tps / r.tpsN) * 10) / 10 : null }))
      .sort((a, b) => b.replies - a.replies || a.model.localeCompare(b.model)),
    features: [
      { id: 'thinking', label: 'Thinking mode', count: feat.thinking },
      { id: 'web', label: 'Web search', count: feat.web },
      { id: 'memory', label: 'Used memory', count: feat.memory },
      { id: 'files', label: 'Sent files', count: feat.files },
      { id: 'choices', label: 'Picked an option', count: feat.choices },
    ],
    firstUse: first,
  };
}

/** Top models, the rest folded into "Other" (a chart never gets more than `max` colours). */
export function topModels(rows: ModelRow[], max = 4): ModelRow[] {
  if (rows.length <= max) return rows;
  const head = rows.slice(0, max - 1);
  const rest = rows.slice(max - 1);
  const tps = rest.filter((r) => r.avgTps !== null);
  return [...head, {
    model: `Other (${rest.length})`, replies: rest.reduce((a, r) => a + r.replies, 0), words: rest.reduce((a, r) => a + r.words, 0),
    avgTps: tps.length ? Math.round((tps.reduce((a, r) => a + (r.avgTps ?? 0), 0) / tps.length) * 10) / 10 : null,
  }];
}

/** Compact number for tiles: 1,234 → "1.2k". */
export function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}
