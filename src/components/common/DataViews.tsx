import React, { useMemo, useRef, useState } from 'react';
import { ChevronRight, ChevronUp, ChevronDown } from 'lucide-react';
import { cx } from './ui';

/*
 * Data views: Table (sortable columns, multi-select, drag to reorder rows) and OutlineView
 * (disclosure tree). Both are keyboard operable (arrows, Space/Enter, Shift for ranges) and
 * expose grid/tree roles so VoiceOver announces rows, columns and expanded state.
 */

export interface Column<T> {
  id: string;
  title: string;
  width?: string; // CSS grid track, e.g. '1fr' or '96px'
  align?: 'left' | 'right';
  render: (row: T) => React.ReactNode;
  sortValue?: (row: T) => string | number;
}

export function Table<T>({
  rows, columns, rowId, selected, onSelect, onReorder, onActivate, label, empty, dense,
}: {
  rows: T[]; columns: Column<T>[]; rowId: (r: T) => string;
  selected: string[]; onSelect: (ids: string[]) => void;
  /** Present to enable drag-and-drop reordering. */
  onReorder?: (fromId: string, toId: string) => void;
  onActivate?: (r: T) => void;
  label: string; empty?: React.ReactNode; dense?: boolean;
}) {
  const [sort, setSort] = useState<{ id: string; dir: 1 | -1 } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const anchor = useRef<string | null>(null);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.id === sort?.id);
    if (!col?.sortValue || !sort) return rows;
    const f = col.sortValue;
    return [...rows].sort((a, b) => (f(a) > f(b) ? 1 : f(a) < f(b) ? -1 : 0) * sort.dir);
  }, [rows, columns, sort]);

  const grid = { gridTemplateColumns: columns.map((c) => c.width ?? '1fr').join(' ') };
  const pick = (id: string, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
    if (e.shiftKey && anchor.current) {
      const ids = sorted.map(rowId);
      const [a, b] = [ids.indexOf(anchor.current), ids.indexOf(id)].sort((x, y) => x - y);
      onSelect(ids.slice(a, b + 1));
    } else if (e.metaKey || e.ctrlKey) {
      onSelect(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
      anchor.current = id;
    } else { onSelect([id]); anchor.current = id; }
  };
  const move = (i: number, d: number, e: React.KeyboardEvent) => {
    const n = sorted[i + d]; if (!n) return;
    e.preventDefault();
    pick(rowId(n), e);
    (e.currentTarget.parentElement?.children[i + d + 1] as HTMLElement | undefined)?.focus();
  };

  return (
    <div role="grid" aria-label={label} aria-multiselectable="true" className="rounded-[10px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)] overflow-hidden">
      <div role="row" style={grid} className="grid sticky top-0 material-toolbar border-b border-[var(--sep)] text-[12px] font-medium text-[var(--color-text-muted)]">
        {columns.map((c) => (
          <button key={c.id} role="columnheader" disabled={!c.sortValue}
            aria-sort={sort?.id === c.id ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
            onClick={() => setSort((s) => (s?.id === c.id ? (s.dir === 1 ? { id: c.id, dir: -1 } : null) : { id: c.id, dir: 1 }))}
            className={cx('h-6 px-3 inline-flex items-center gap-1 hover:text-[var(--color-text-main)] disabled:hover:text-[var(--color-text-muted)]', c.align === 'right' ? 'justify-end' : 'justify-start')}>
            {c.title}
            {sort?.id === c.id && (sort.dir === 1 ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
          </button>
        ))}
      </div>
      {sorted.length === 0 && <div className="py-8 text-center text-[13px] text-[var(--color-text-muted)]">{empty ?? 'Nothing here yet.'}</div>}
      {sorted.map((r, i) => {
        const id = rowId(r); const on = selected.includes(id);
        return (
          <div key={id} role="row" aria-selected={on} tabIndex={i === 0 || on ? 0 : -1} style={grid}
            draggable={!!onReorder && !sort}
            onDragStart={() => setDragId(id)}
            onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverId(id); } }}
            onDrop={() => { if (dragId && dragId !== id) onReorder?.(dragId, id); setDragId(null); setOverId(null); }}
            onDragEnd={() => { setDragId(null); setOverId(null); }}
            onClick={(e) => pick(id, e)} onDoubleClick={() => onActivate?.(r)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') move(i, 1, e);
              else if (e.key === 'ArrowUp') move(i, -1, e);
              else if (e.key === 'Enter') onActivate?.(r);
              else if (e.key === ' ') { e.preventDefault(); pick(id, e); }
            }}
            className={cx('grid items-center outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ring)]',
              dense ? 'min-h-6' : 'min-h-8', 'text-[13px] border-b border-[var(--sep)] last:border-b-0',
              i % 2 === 1 && !on && 'bg-[var(--hover)]/40',
              on ? 'bg-[var(--color-accent-fill)] text-white' : 'text-[var(--color-text-main)] hover:bg-[var(--hover)]',
              dragId === id && 'opacity-50', overId === id && dragId !== id && 'shadow-[inset_0_2px_0_var(--color-accent-vibrant)]')}>
            {columns.map((c) => (
              <div key={c.id} role="gridcell" className={cx('px-3 py-1 truncate', c.align === 'right' && 'text-right tabular-nums')}>{c.render(r)}</div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export interface OutlineNode { id: string; title: string; icon?: React.ReactNode; children?: OutlineNode[] }

export const OutlineView: React.FC<{
  nodes: OutlineNode[]; selectedId?: string; onSelect: (id: string) => void; label: string;
}> = ({ nodes, selectedId, onSelect, label }) => {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const row = (n: OutlineNode, depth: number): React.ReactNode => {
    const has = !!n.children?.length; const exp = !!open[n.id]; const on = selectedId === n.id;
    return (
      <React.Fragment key={n.id}>
        <div role="treeitem" aria-level={depth + 1} aria-expanded={has ? exp : undefined} aria-selected={on} tabIndex={on ? 0 : -1}
          onClick={() => onSelect(n.id)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' && has) { e.preventDefault(); setOpen((o) => ({ ...o, [n.id]: true })); }
            if (e.key === 'ArrowLeft' && has) { e.preventDefault(); setOpen((o) => ({ ...o, [n.id]: false })); }
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(n.id); }
          }}
          style={{ paddingLeft: 8 + depth * 14 }}
          className={cx('flex items-center gap-1.5 h-7 pr-2 rounded-[6px] text-[13px] outline-none focus-visible:shadow-[0_0_0_3px_var(--ring)]',
            on ? 'bg-[var(--pressed)] font-medium' : 'hover:bg-[var(--hover)]')}>
          <span className="w-3 inline-flex">
            {has && (
              <button type="button" tabIndex={-1} aria-label={exp ? `Collapse ${n.title}` : `Expand ${n.title}`}
                onClick={(e) => { e.stopPropagation(); setOpen((o) => ({ ...o, [n.id]: !exp })); }}>
                <ChevronRight className={cx('w-3 h-3 text-[var(--color-text-muted)] transition-transform duration-150', exp && 'rotate-90')} strokeWidth={2.4} />
              </button>
            )}
          </span>
          {n.icon}<span className="truncate">{n.title}</span>
        </div>
        {has && exp && <div role="group">{n.children!.map((c) => row(c, depth + 1))}</div>}
      </React.Fragment>
    );
  };
  return <div role="tree" aria-label={label} className="flex flex-col gap-px">{nodes.map((n) => row(n, 0))}</div>;
};
