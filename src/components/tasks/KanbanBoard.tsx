import React, { useState } from 'react';
import { AlertCircle, Bot, CalendarClock, Link2, Loader2, Lock, Plus, User } from 'lucide-react';
import { blockersOf, COLUMNS, columnTasks, isOverdue, progress, Status, Task } from '../../tasks/kanban';
import { tasks as store } from '../../tasks/store';
import { cx } from '../common/ui';

const PRIO_DOT: Record<Task['priority'], string> = {
  urgent: 'bg-[var(--c-red)]', high: 'bg-[var(--c-orange)]', normal: 'bg-[var(--color-accent-fill)]', low: 'bg-[var(--color-text-muted)] opacity-50',
};

const Card: React.FC<{ t: Task; all: Task[]; selected: boolean; onSelect: () => void; onDragStart: (id: string) => void }> = ({ t, all, selected, onSelect, onDragStart }) => {
  const blocked = blockersOf(t.id, all);
  const p = progress(t);
  const running = t.run?.state === 'running' || t.run?.state === 'queued';
  return (
    <div role="button" tabIndex={0} draggable aria-pressed={selected}
      aria-label={`${t.title}. ${t.assignee === 'lotus' ? 'Assigned to Lotus' : 'Assigned to you'}. ${t.priority} priority${blocked.length ? '. Blocked' : ''}`}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; onDragStart(t.id); }}
      onClick={onSelect} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      data-task={t.id}
      className={cx('group rounded-[10px] bg-[var(--color-bg-card)] p-2.5 text-left cursor-default select-none shadow-[0_0_0_0.5px_var(--sep),var(--shadow-1)] hover:shadow-[0_0_0_1px_var(--sep),var(--shadow-1)] focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)]',
        selected && 'shadow-[0_0_0_2px_var(--color-accent-fill)] hover:shadow-[0_0_0_2px_var(--color-accent-fill)]')}>
      <div className="flex items-start gap-2">
        <span className={cx('w-2 h-2 rounded-full mt-1.5 shrink-0', PRIO_DOT[t.priority])} title={`${t.priority} priority`} aria-hidden="true" />
        <p className="flex-1 text-[13px] font-medium leading-snug break-words">{t.title}</p>
        {t.assignee === 'lotus' ? <Bot className="w-3.5 h-3.5 shrink-0 text-[var(--color-accent-vibrant)]" aria-hidden="true" /> : <User className="w-3.5 h-3.5 shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />}
      </div>
      {t.steps.length > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 h-1 rounded-full bg-[var(--hover)] overflow-hidden"><div className="h-full bg-[var(--color-accent-fill)] transition-[width]" style={{ width: `${Math.round(p * 100)}%` }} /></div>
          <span className="text-[11px] tabular-nums text-[var(--color-text-muted)]">{t.steps.filter((s) => s.done).length}/{t.steps.length}</span>
        </div>
      )}
      {(running || t.run?.state === 'failed' || blocked.length > 0 || t.links.length > 0 || t.due || t.labels.length > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-[var(--color-text-muted)]">
          {running && <span className="inline-flex items-center gap-1 text-[var(--color-accent-vibrant)]"><Loader2 className="w-3 h-3 animate-spin" />{t.run?.state === 'queued' ? 'Waiting for a free agent' : 'Lotus is working'}</span>}
          {t.run?.state === 'failed' && <span className="inline-flex items-center gap-1 text-[var(--c-red)]"><AlertCircle className="w-3 h-3" />{t.run.error === 'Stopped' ? 'Stopped' : 'Failed'}</span>}
          {blocked.length > 0 && <span className="inline-flex items-center gap-1" title={`Waiting for: ${blocked.map((b) => b.title).join(', ')}`}><Lock className="w-3 h-3" />Blocked by {blocked.length}</span>}
          {t.links.length > 0 && <span className="inline-flex items-center gap-1"><Link2 className="w-3 h-3" />{t.links.length}</span>}
          {t.due && <span className={cx('inline-flex items-center gap-1', isOverdue(t) && 'text-[var(--c-red)]')}><CalendarClock className="w-3 h-3" />{new Date(`${t.due}T00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}
          {t.labels.slice(0, 3).map((l) => <span key={l} className="px-1.5 rounded-[4px] bg-[var(--hover)]">{l}</span>)}
        </div>
      )}
    </div>
  );
};

/** Five-column board. Drag cards between columns (or use the task's Status field / keyboard in the inspector). */
export const KanbanBoard: React.FC<{ all: Task[]; selected: string | null; onSelect: (id: string) => void }> = ({ all, selected, onSelect }) => {
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ col: Status; before: string | null } | null>(null);
  const [adding, setAdding] = useState<Status | null>(null);
  const [draft, setDraft] = useState('');

  const drop = (col: Status, before: string | null) => {
    if (dragId) store.move(dragId, col, before === dragId ? null : before);
    setDragId(null); setOver(null);
  };

  const add = (col: Status) => {
    const title = draft.trim();
    if (title) { const t = store.add({ title, status: col }); onSelect(t.id); }
    setDraft(''); setAdding(null);
  };

  return (
    <div className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden">
      <div className="h-full flex gap-3 p-4 min-w-max">
        {COLUMNS.map((c) => {
          const list = columnTasks(all, c.id);
          return (
            <section key={c.id} aria-label={c.title}
              onDragOver={(e) => { if (!dragId) return; e.preventDefault(); const card = (e.target as HTMLElement).closest('[data-task]') as HTMLElement | null; setOver({ col: c.id, before: card?.dataset.task ?? null }); }}
              onDragLeave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver(null); }}
              onDrop={(e) => { e.preventDefault(); drop(c.id, over?.col === c.id ? over.before : null); }}
              className={cx('w-[272px] shrink-0 flex flex-col min-h-0 rounded-[12px] bg-[var(--hover)] transition-shadow', over?.col === c.id && 'shadow-[inset_0_0_0_2px_var(--color-accent-fill)]')}>
              <header className="px-3 pt-2.5 pb-2 flex items-center gap-2" title={c.hint}>
                <h3 className="text-[13px] font-semibold">{c.title}</h3>
                <span className="text-[12px] tabular-nums text-[var(--color-text-muted)]">{list.length}</span>
                <span className="flex-1" />
                {(c.id === 'done' || c.id === 'review') && <span className="w-6 h-6" aria-hidden="true" />}
                {c.id !== 'done' && c.id !== 'review' && (
                  <button type="button" aria-label={`Add a task to ${c.title}`} title={`Add a task to ${c.title}`} onClick={() => { setAdding(c.id); setDraft(''); }}
                    className="w-6 h-6 inline-flex items-center justify-center rounded-[6px] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-card)] hover:text-[var(--color-text-main)]"><Plus className="w-4 h-4" /></button>
                )}
              </header>
              <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-2">
                {adding === c.id && (
                  <form onSubmit={(e) => { e.preventDefault(); add(c.id); }} className="rounded-[10px] bg-[var(--color-bg-card)] p-2 shadow-[0_0_0_1px_var(--color-accent-fill)]">
                    <textarea autoFocus rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="New task title" placeholder="What needs doing?"
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); add(c.id); } if (e.key === 'Escape') setAdding(null); }}
                      className="w-full resize-none bg-transparent text-[13px] focus:outline-none" />
                    <p className="text-[11px] text-[var(--color-text-muted)]">Enter to add · Esc to cancel</p>
                  </form>
                )}
                {list.map((t) => (
                  <React.Fragment key={t.id}>
                    {over?.col === c.id && over.before === t.id && dragId !== t.id && <div className="h-0.5 rounded-full bg-[var(--color-accent-fill)]" aria-hidden="true" />}
                    <div className={dragId === t.id ? 'opacity-40' : ''} onDragEnd={() => { setDragId(null); setOver(null); }}><Card t={t} all={all} selected={selected === t.id} onSelect={() => onSelect(t.id)} onDragStart={setDragId} /></div>
                  </React.Fragment>
                ))}
                {!list.length && adding !== c.id && <p className="px-1.5 py-3 text-[12px] text-[var(--color-text-muted)] text-center">{c.hint}</p>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};
