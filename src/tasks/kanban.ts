// Kanban rules (pure, unit-tested): columns, ordering, dependency links with cycle checks,
// which tasks are blocked, and which Lotus-assigned task should run next.

export type Status = 'backlog' | 'todo' | 'doing' | 'review' | 'done';
export type Priority = 'low' | 'normal' | 'high' | 'urgent';

export const COLUMNS: { id: Status; title: string; hint: string }[] = [
  { id: 'backlog', title: 'Backlog', hint: 'Ideas and later work' },
  { id: 'todo', title: 'To do', hint: 'Ready. Tasks assigned to Lotus start on their own here.' },
  { id: 'doing', title: 'In progress', hint: 'Being worked on' },
  { id: 'review', title: 'Review', hint: 'Lotus finished: check the result' },
  { id: 'done', title: 'Done', hint: 'Finished' },
];

export const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export interface TaskStep { id: string; text: string; done: boolean; result?: string }
/** Stored on the task that does the blocking / relating. "Blocked by" is derived. */
export interface TaskLink { type: 'blocks' | 'relates'; to: string }
export interface TaskLog { at: number; text: string; kind: 'status' | 'agent' | 'note' | 'error' }

export interface Task {
  id: string;
  title: string;
  description: string;
  status: Status;
  assignee: 'me' | 'lotus';
  priority: Priority;
  labels: string[];
  /** yyyy-mm-dd */
  due?: string;
  steps: TaskStep[];
  links: TaskLink[];
  /** Search the web before the agent starts. */
  web?: boolean;
  /** Position inside its column (lower = higher up). */
  order: number;
  created: number;
  updated: number;
  log: TaskLog[];
  run?: { state: 'queued' | 'running' | 'failed' | 'done'; jobId?: string; error?: string; startedAt?: number; finishedAt?: number };
  /** The agent's final write-up (Markdown). */
  result?: string;
  /** Created by a routine. */
  source?: { routineId: string; name: string };
}

const now = () => Date.now();
const logged = (t: Task, text: string, kind: TaskLog['kind'] = 'status'): Task => ({ ...t, updated: now(), log: [...t.log, { at: now(), text, kind }].slice(-60) });

export function newTask(id: string, p: Partial<Task> & { title: string }, all: Task[]): Task {
  const status = p.status ?? 'todo';
  const order = Math.max(0, ...all.filter((t) => t.status === status).map((t) => t.order + 1));
  return {
    id, title: p.title.trim(), description: p.description ?? '', status, assignee: p.assignee ?? 'me', priority: p.priority ?? 'normal',
    labels: p.labels ?? [], due: p.due, steps: p.steps ?? [], links: p.links ?? [], web: p.web, order, created: now(), updated: now(),
    log: [{ at: now(), text: p.source ? `Created by routine “${p.source.name}”` : 'Created', kind: 'status' }], source: p.source,
  };
}

/** Tasks that block `id` and are not done yet. */
export function blockersOf(id: string, all: Task[]): Task[] {
  return all.filter((t) => t.status !== 'done' && t.links.some((l) => l.type === 'blocks' && l.to === id));
}

/** Tasks that `id` blocks. */
export function blockedBy(id: string, all: Task[]): Task[] {
  const t = all.find((x) => x.id === id);
  return t ? t.links.filter((l) => l.type === 'blocks').map((l) => all.find((x) => x.id === l.to)).filter((x): x is Task => !!x) : [];
}

export const isBlocked = (id: string, all: Task[]) => blockersOf(id, all).length > 0;

/** Would `from` blocks `to` create a loop (to already, directly or not, blocks from)? */
export function wouldCycle(from: string, to: string, all: Task[]): boolean {
  if (from === to) return true;
  const seen = new Set<string>();
  const stack = [to];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === from) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    all.find((t) => t.id === cur)?.links.filter((l) => l.type === 'blocks').forEach((l) => stack.push(l.to));
  }
  return false;
}

export function addLink(all: Task[], from: string, type: TaskLink['type'], to: string): { tasks: Task[]; error?: string } {
  if (from === to) return { tasks: all, error: 'A task can’t be linked to itself.' };
  const a = all.find((t) => t.id === from), b = all.find((t) => t.id === to);
  if (!a || !b) return { tasks: all, error: 'Task not found.' };
  if (a.links.some((l) => l.to === to && l.type === type)) return { tasks: all, error: 'These tasks are already linked.' };
  if (type === 'blocks' && wouldCycle(from, to, all)) return { tasks: all, error: `“${b.title}” already blocks “${a.title}” (directly or through other tasks), so this would make a loop.` };
  return {
    tasks: all.map((t) => (t.id === from ? logged({ ...t, links: [...t.links, { type, to }] }, `${type === 'blocks' ? 'Now blocks' : 'Linked to'} “${b.title}”`, 'note') : t)),
  };
}

export function removeLink(all: Task[], from: string, to: string): Task[] {
  return all.map((t) => (t.id === from ? { ...t, links: t.links.filter((l) => l.to !== to), updated: now() } : t));
}

/** Removes a task and every link pointing at it. */
export function removeTask(all: Task[], id: string): Task[] {
  return all.filter((t) => t.id !== id).map((t) => (t.links.some((l) => l.to === id) ? { ...t, links: t.links.filter((l) => l.to !== id) } : t));
}

/**
 * Moves a task to a column, placed before `beforeId` (or at the end). Starting work on a blocked
 * task is refused with an explanation.
 */
export function moveTask(all: Task[], id: string, status: Status, beforeId?: string | null): { tasks: Task[]; error?: string } {
  const t = all.find((x) => x.id === id);
  if (!t) return { tasks: all };
  if ((status === 'doing' || status === 'review') && t.status !== status) {
    const b = blockersOf(id, all);
    if (b.length) return { tasks: all, error: `“${t.title}” is waiting for ${b.map((x) => `“${x.title}”`).join(', ')}. Finish ${b.length > 1 ? 'those' : 'that'} first, or remove the link.` };
  }
  const column = all.filter((x) => x.status === status && x.id !== id).sort((a, b) => a.order - b.order);
  const at = beforeId ? column.findIndex((x) => x.id === beforeId) : -1;
  const moved: Task = t.status === status ? { ...t, updated: now() } : logged({ ...t, status }, `Moved to ${COLUMNS.find((c) => c.id === status)!.title}`);
  column.splice(at < 0 ? column.length : at, 0, moved);
  const order = new Map(column.map((x, i) => [x.id, i]));
  return { tasks: all.map((x) => (x.id === id ? { ...moved, order: order.get(id)! } : order.has(x.id) ? { ...x, order: order.get(x.id)! } : x)) };
}

export const columnTasks = (all: Task[], status: Status) => all.filter((t) => t.status === status).sort((a, b) => a.order - b.order);

export const progress = (t: Task) => (t.steps.length ? t.steps.filter((s) => s.done).length / t.steps.length : t.status === 'done' ? 1 : 0);

/** The next Lotus-assigned task to start: in To do, not blocked, not already running; urgent first. */
export function nextRunnable(all: Task[]): Task | null {
  const ready = all.filter((t) => t.assignee === 'lotus' && t.status === 'todo' && !t.run?.state?.match(/queued|running|failed/) && !isBlocked(t.id, all));
  ready.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.order - b.order);
  return ready[0] ?? null;
}

/** Checklist lines from Markdown or a JSON-ish list: "- [ ] step", "1. step", "- step". */
export function parseSteps(text: string, max = 8): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const m = /^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)(.+)$/.exec(line);
    if (m) { const s = m[1].replace(/\*\*/g, '').trim(); if (s.length > 2) out.push(s.slice(0, 200)); }
    if (out.length >= max) break;
  }
  return out;
}

export function isOverdue(t: Task, today = new Date()): boolean {
  if (!t.due || t.status === 'done') return false;
  const d = today.toISOString().slice(0, 10);
  return t.due < d;
}
