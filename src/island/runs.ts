// What Lotus's own agent is doing (0.23.1), straight from the core's event stream, so the island knows
// a chat is thinking, a task or routine is running, or Work is busy, even when the window that started
// it says nothing for a while. Before this the island only knew what windows reported, and a run that
// went quiet (a long think, a task, a routine) dropped off after 90 s: "Nothing running right now"
// while Lotus was busy.
// Pure (no DOM), so core tests can check it.

/** The island's activity line (src/island/state.ts Activity), repeated here so core tests can load this file. */
interface Activity { id: string; kind: 'image' | 'voice' | 'chat' | 'download' | 'research' | 'build'; label: string; progress?: number; done?: boolean; agent?: string; kicker?: string }

export type RunSource = 'chat' | 'work' | 'island' | 'task' | 'routine' | 'call';

export interface CoreRun {
  runId: string;
  source: RunSource | null;
  prompt: string;
  /** What it is doing now, in plain words. */
  label: string;
  done: boolean;
  at: number;
}

const WORD: Record<RunSource, string> = { chat: 'Chat', work: 'Work', island: 'Quick chat', task: 'Task', routine: 'Routine', call: 'Call' };

/** The short words of a prompt, for "Thinking about “…”". */
export function gist(prompt: string, max = 34): string {
  const t = prompt.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

type Ev = { type?: string; runId?: string; kind?: string; step?: { label?: string; status?: string; ask?: string } };

/**
 * One core event applied to the runs Lotus knows about. Returns the same map when nothing changed.
 * `token` and `thinking` arrive many times a second: they only change the label once.
 */
export function applyRunEvent(runs: Map<string, CoreRun>, raw: unknown, now: number): Map<string, CoreRun> {
  const e = raw as Ev;
  if (!e || e.type !== 'agent' || !e.runId) return runs;
  const cur = runs.get(e.runId);
  let label: string | null = null;
  let done = false;
  switch (e.kind) {
    case 'thinking': label = 'Thinking'; break;
    case 'token': label = 'Writing the answer'; break;
    case 'step':
      if (e.step?.status === 'waiting') label = 'Waiting for your permission';
      else if (e.step?.status === 'running') label = e.step.label || 'Working';
      else label = cur?.label ?? 'Working';
      break;
    case 'ask': label = 'Asking you something'; break;
    case 'answered': label = 'Working'; break;
    case 'done': label = 'Done'; done = true; break;
    case 'error': label = 'Stopped'; done = true; break;
    default: if (!cur) label = 'Working'; else return runs;
  }
  if (cur && cur.label === label && cur.done === done) return runs;
  const next = new Map(runs);
  next.set(e.runId, { runId: e.runId, source: cur?.source ?? null, prompt: cur?.prompt ?? '', label: label ?? 'Working', done, at: now });
  return next;
}

/** Runs the core lists as still going (after the island starts, or to catch a missed "done"). */
export function reconcileRuns(runs: Map<string, CoreRun>, rows: { id: string; status: string; source: RunSource | null; prompt: string; created: number }[], now: number): Map<string, CoreRun> {
  const next = new Map(runs);
  const live = new Set(rows.filter((r) => r.status === 'running').map((r) => r.id));
  for (const r of rows) {
    const cur = next.get(r.id);
    if (r.status === 'running') next.set(r.id, { runId: r.id, source: r.source, prompt: r.prompt, label: cur?.label ?? 'Working', done: false, at: cur?.at ?? r.created });
    else if (cur && !cur.done) next.set(r.id, { ...cur, source: cur.source ?? r.source, label: r.status === 'done' ? 'Done' : 'Stopped', done: true, at: now });
    else if (cur && !cur.source) next.set(r.id, { ...cur, source: r.source, prompt: r.prompt });
  }
  // A run listed nowhere and silent for 15 minutes is gone (the core restarted).
  for (const [id, r] of next) if (!r.done && !live.has(id) && now - r.at > 15 * 60_000 && !rows.some((x) => x.id === id)) next.delete(id);
  return next;
}

/** Does a window already report this run? Then the window's line (with tok/s, progress) wins. */
function reported(r: CoreRun, items: Activity[]): boolean {
  const live = items.filter((a) => !a.done);
  switch (r.source) {
    case 'chat': return live.some((a) => a.id === 'main-chat');
    case 'island': return live.some((a) => a.id === 'island-chat');
    case 'task': return live.some((a) => a.id.startsWith('task-'));
    case 'routine': return live.some((a) => a.id.startsWith('routine-'));
    case 'work': return live.some((a) => a.kind === 'build' && !a.agent);
    case 'call': return live.some((a) => a.id.startsWith('call-'));
    default: return false;
  }
}

/** The runs as island lines, after the windows' own lines. Finished runs show for a moment only. */
export function runActivities(runs: Map<string, CoreRun>, items: Activity[], now: number): Activity[] {
  const out: Activity[] = [];
  for (const r of runs.values()) {
    if (r.done && now - r.at > 2500) continue;
    if (reported(r, items)) continue;
    const word = r.source ? WORD[r.source] : 'Lotus';
    const g = gist(r.prompt);
    const label = r.done ? (g ? `${r.label}: ${g}` : r.label) : r.label === 'Thinking' && g ? `Thinking about “${g}”` : r.label === 'Writing the answer' && g ? `Answering “${g}”` : r.label;
    out.push({ id: `run-${r.runId}`, kind: r.source === 'work' ? 'build' : r.source === 'call' ? 'voice' : 'chat', label, done: r.done, kicker: word });
  }
  return out;
}
