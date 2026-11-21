// Tasks → Activity helpers, free of React so the core's tests can check them.

export type RunSourceId = 'chat' | 'work' | 'island' | 'task' | 'routine' | 'call';
const SOURCE: Record<RunSourceId, string> = { chat: 'Chat', work: 'Work', task: 'Task', routine: 'Routine', island: 'Island', call: 'Call' };

/**
 * Where a run came from, for the Type column. Runs saved before Lotus recorded it have no `source`;
 * they showed "Earlier" (a time word) there. Their chat id or task/routine reference still says where.
 */
export function runSourceLabel(r: { source: RunSourceId | null; chatId: string | null; ref: string | null }): string {
  if (r.source && SOURCE[r.source]) return SOURCE[r.source];
  const ref = r.ref ?? '';
  if (/^task[_-]/.test(ref)) return 'Task';
  if (/^(rt|routine)[_-]/.test(ref)) return 'Routine';
  if (/^work[_-]/.test(ref) || /^work[_-]/.test(r.chatId ?? '')) return 'Work';
  if (r.chatId) return 'Chat';
  return 'Agent';
}
