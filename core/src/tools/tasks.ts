// task.add / task.list / task.move: the Tasks page's board (lotus.db `tasks` since phase 2), with the same rules
// the board uses (tasks/kanban.ts). Changes reach open windows like any other saved change, so the
// board updates while you watch.

import type { Tool, ToolCtx } from '../agent/types';
import { COLUMNS, moveTask, newTask, type Priority, type Status, type Task } from '../../../src/tasks/kanban';

export const TASKS_KEY = 'lotus.tasks.v1';
const STATUSES = COLUMNS.map((c) => c.id) as Status[];
/** What models call the columns. */
const STATUS_ALIASES: Record<string, Status> = {
  'in progress': 'doing', 'in-progress': 'doing', started: 'doing', working: 'doing', ongoing: 'doing', active: 'doing',
  'to do': 'todo', 'to-do': 'todo', open: 'todo', pending: 'todo', new: 'todo', ready: 'todo',
  completed: 'done', complete: 'done', finished: 'done', closed: 'done', resolved: 'done',
  later: 'backlog', someday: 'backlog', icebox: 'backlog', reviewing: 'review', 'in review': 'review',
};
const colName = (s: Status) => COLUMNS.find((c) => c.id === s)?.title ?? s;
const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function readTasks(ctx: Pick<ToolCtx, 'kvGet' | 'board'>): Task[] {
  if (ctx.board) return ctx.board.tasks();
  try { const v = JSON.parse(ctx.kvGet(TASKS_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
const save = (ctx: ToolCtx, list: Task[]) => (ctx.board ? ctx.board.setTasks(list) : ctx.kvSet(TASKS_KEY, JSON.stringify(list)));

/** Finds a task by id, exact title, or a unique title match. */
export function findTask(all: Task[], ref: string): Task | { error: string } {
  const r = ref.trim().toLowerCase();
  const exact = all.find((t) => t.id === ref.trim()) ?? all.find((t) => t.title.toLowerCase() === r);
  if (exact) return exact;
  const some = all.filter((t) => t.title.toLowerCase().includes(r));
  if (some.length === 1) return some[0];
  if (!some.length) return { error: `No task matches “${ref}”. Use task.list to see the board.` };
  return { error: `“${ref}” matches ${some.length} tasks: ${some.slice(0, 6).map((t) => `“${t.title}” (${t.id})`).join(', ')}. Use the id.` };
}

const line = (t: Task) => `${t.id} · ${t.title} · ${colName(t.status)} · ${t.assignee === 'lotus' ? 'for Lotus' : 'for you'}${t.priority !== 'normal' ? ` · ${t.priority}` : ''}${t.due ? ` · due ${t.due}` : ''}`;

export const taskAdd: Tool = {
  name: 'task.add', label: 'Adding a task', risk: 'write',
  description: 'Add a task to the user\'s task board (the Tasks page). Use for to-dos, reminders and anything to do later.',
  parameters: { type: 'object', properties: {
    title: { type: 'string', description: 'Short task title, e.g. "Buy milk".' },
    description: { type: 'string', description: 'Details (optional).' },
    status: { type: 'string', description: 'Column: backlog, todo (default), doing, review or done.', enum: STATUSES, aliases: STATUS_ALIASES },
    assignee: { type: 'string', description: '"me" (the user, default) or "lotus" (Lotus works on it by itself).', enum: ['me', 'lotus'] },
    priority: { type: 'string', description: 'low, normal (default), high or urgent.', enum: ['low', 'normal', 'high', 'urgent'] },
    due: { type: 'string', description: 'Due date as YYYY-MM-DD (optional).' },
    steps: { type: 'array', description: 'Checklist steps (optional).', items: { type: 'string' } },
  }, required: ['title'] },
  describe: (a) => `Add the task “${String(a.title)}”`,
  async run(a, ctx) {
    const title = String(a.title).trim().slice(0, 200);
    if (!title) return { ok: false, text: 'A task needs a title.', summary: 'No title' };
    const due = typeof a.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.due) ? a.due : undefined;
    const all = readTasks(ctx);
    const steps = Array.isArray(a.steps) ? a.steps.map(String).filter(Boolean).slice(0, 12).map((text, i) => ({ id: `${uid('st')}${i}`, text, done: false })) : [];
    const t = newTask(uid('task'), {
      title, description: typeof a.description === 'string' ? a.description : '', status: (a.status as Status) ?? 'todo',
      assignee: (a.assignee as 'me' | 'lotus') ?? 'me', priority: (a.priority as Priority) ?? 'normal', due, steps,
    }, all);
    t.log = [{ at: Date.now(), text: 'Created by Lotus from a chat', kind: 'status' }];
    save(ctx, [...all, t]);
    return {
      ok: true,
      text: `Added task ${t.id} “${t.title}” to ${colName(t.status)}${t.assignee === 'lotus' ? ' (Lotus will work on it)' : ''}${due ? `, due ${due}` : ''}.`,
      summary: `Added “${t.title}” to ${colName(t.status)}`, data: { taskId: t.id },
    };
  },
};

export const taskList: Tool = {
  name: 'task.list', label: 'Reading the task board', risk: 'read',
  description: 'List tasks on the user\'s board, optionally only one column or those matching some words.',
  parameters: { type: 'object', properties: {
    status: { type: 'string', description: 'Only this column.', enum: STATUSES, aliases: STATUS_ALIASES },
    query: { type: 'string', description: 'Only tasks whose title or description contains this.' },
  } },
  async run(a, ctx) {
    const q = typeof a.query === 'string' ? a.query.toLowerCase() : '';
    const list = readTasks(ctx).filter((t) => (!a.status || t.status === a.status) && (!q || `${t.title} ${t.description}`.toLowerCase().includes(q)))
      .sort((x, y) => STATUSES.indexOf(x.status) - STATUSES.indexOf(y.status) || x.order - y.order);
    return {
      ok: true,
      text: list.length ? `${list.length} task${list.length === 1 ? '' : 's'}:\n${list.slice(0, 80).map(line).join('\n')}` : 'No tasks match.',
      summary: `${list.length} task${list.length === 1 ? '' : 's'}${a.status ? ` in ${colName(a.status as Status)}` : ''}`,
    };
  },
};

export const taskMove: Tool = {
  name: 'task.move', label: 'Moving a task', risk: 'write',
  description: 'Move a task to another column of the board, e.g. mark it done.',
  parameters: { type: 'object', properties: {
    task: { type: 'string', description: 'The task id, or its title.' },
    status: { type: 'string', description: 'Column to move it to: backlog, todo, doing (in progress), review or done.', enum: STATUSES, aliases: STATUS_ALIASES },
  }, required: ['task', 'status'] },
  describe: (a) => `Move “${String(a.task)}” to ${colName(a.status as Status)}`,
  async run(a, ctx) {
    const all = readTasks(ctx);
    const t = findTask(all, String(a.task));
    if ('error' in t) return { ok: false, text: t.error, summary: 'Task not found' };
    const r = moveTask(all, t.id, a.status as Status);
    if (r.error) return { ok: false, text: r.error, summary: 'Could not move it' };
    save(ctx, r.tasks);
    return { ok: true, text: `Moved “${t.title}” to ${colName(a.status as Status)}.`, summary: `Moved “${t.title}” to ${colName(a.status as Status)}`, data: { taskId: t.id } };
  },
};

/** A to-do list (0.10.1): one task with a checklist, or one task per item, on the board. */
export const todoCreate: Tool = {
  name: 'todo.create', label: 'Making a to-do list', risk: 'write',
  description: 'Make a to-do list on the task board: by default one task named after the list with every item as a checklist step; with separate=true, one task per item (all labelled with the list name).',
  parameters: { type: 'object', properties: {
    title: { type: 'string', description: 'The list name, e.g. "Groceries" or "Before the trip".' },
    items: { type: 'array', description: 'The to-dos, in order.', items: { type: 'string' } },
    separate: { type: 'boolean', description: 'One task per item instead of one checklist (default false).' },
    due: { type: 'string', description: 'Due date as YYYY-MM-DD (optional).' },
    priority: { type: 'string', description: 'low, normal (default), high or urgent.', enum: ['low', 'normal', 'high', 'urgent'] },
  }, required: ['title', 'items'] },
  describe: (a) => `Make the to-do list “${String(a.title)}”${Array.isArray(a.items) ? ` (${a.items.length} items)` : ''}`,
  async run(a, ctx) {
    const title = String(a.title ?? '').trim().slice(0, 120);
    const items = (Array.isArray(a.items) ? a.items : typeof a.items === 'string' ? String(a.items).split(/\n|;/) : []).map((x) => String(x).replace(/^\s*(?:[-*•]|\d+[.)]|\[ ?\])\s*/, '').trim()).filter(Boolean).slice(0, 40);
    if (!title || !items.length) return { ok: false, text: 'A to-do list needs a name and at least one item.', summary: 'Empty list' };
    const due = typeof a.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.due) ? a.due : undefined;
    const priority = (a.priority as Priority) ?? 'normal';
    let all = readTasks(ctx);
    const made: Task[] = [];
    const add = (p: Partial<Task> & { title: string }) => {
      const t = newTask(uid('task'), { status: 'todo', assignee: 'me', priority, due, ...p }, all);
      t.log = [{ at: Date.now(), text: 'Created by Lotus from a chat', kind: 'status' }];
      all = [...all, t]; made.push(t);
    };
    if (a.separate === true) items.forEach((it) => add({ title: it.slice(0, 200), labels: [title] }));
    else add({ title, steps: items.map((text, i) => ({ id: `${uid('st')}${i}`, text: text.slice(0, 300), done: false })) });
    save(ctx, all);
    return {
      ok: true,
      text: a.separate === true ? `Added ${made.length} tasks labelled “${title}” to To Do.` : `Added the to-do list “${title}” (${items.length} items) to To Do as task ${made[0].id}.`,
      summary: `To-do list “${title}”: ${items.length} item${items.length === 1 ? '' : 's'}`, data: { taskIds: made.map((t) => t.id) },
    };
  },
};

export const TASK_TOOLS = [taskAdd, taskList, taskMove, todoCreate];
