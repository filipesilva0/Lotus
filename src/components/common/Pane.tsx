import React, { useEffect, useRef, useState } from 'react';
import { cx, Slider } from './ui';

/*
 * Three-pane building blocks shared by Chat, Images, Models and Voice.
 * Sidebar (library) | workspace | inspector, separated by hairlines inside the white content pane.
 */

export const SidebarPane: React.FC<{ label: string; children: React.ReactNode; className?: string }> = ({ label, children, className }) => (
  <aside aria-label={label} className={cx('w-[248px] shrink-0 flex flex-col min-h-0 border-r border-[var(--sep)]', className)}>{children}</aside>
);

export const InspectorPane: React.FC<{ label: string; children: React.ReactNode; className?: string }> = ({ label, children, className }) => (
  <aside aria-label={label} className={cx('w-[320px] shrink-0 flex flex-col min-h-0 border-l border-[var(--sep)]', className)}>{children}</aside>
);

/** A thin bar at the top of a pane (36 px) holding a title and trailing controls. */
export const PaneBar: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={cx('h-11 shrink-0 flex items-center gap-2 px-3 border-b border-[var(--sep)]', className)}>{children}</div>
);

export const Section: React.FC<{ title: string; hint?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }> = ({ title, hint, action, children, className }) => (
  <section className={cx('px-4 py-3 border-b border-[var(--sep)] last:border-b-0', className)}>
    <div className="flex items-center justify-between mb-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--color-text-muted)]">{title}</h3>
      {action}
    </div>
    {hint && <p className="text-[12px] text-[var(--color-text-muted)] mb-2 leading-snug">{hint}</p>}
    {children}
  </section>
);

export const SliderField: React.FC<{
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string; hint?: string; disabled?: boolean;
}> = ({ label, value, min, max, step = 0.01, onChange, format, hint, disabled }) => (
  <div className="mb-3 last:mb-0">
    <div className="flex items-baseline justify-between text-[12px] mb-0.5">
      <span className="text-[var(--color-text-main)]">{label}</span>
      <span className="tabular-nums text-[var(--color-text-muted)]">{format ? format(value) : value}</span>
    </div>
    <Slider value={value} min={min} max={max} step={step} onChange={onChange} label={label} disabled={disabled} />
    {hint && <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 leading-snug">{hint}</p>}
  </div>
);

export const KV: React.FC<{ k: string; v: React.ReactNode; mono?: boolean }> = ({ k, v, mono }) => (
  <div className="flex items-baseline justify-between gap-3 py-1 text-[12px]">
    <span className="text-[var(--color-text-muted)] shrink-0">{k}</span>
    <span className={cx('text-right min-w-0 break-words tabular-nums', mono && 'font-mono text-[11px]')}>{v}</span>
  </div>
);

/** Click-away popover anchored under its trigger. */
export const Popover: React.FC<{
  trigger: (open: boolean, toggle: () => void) => React.ReactNode; children: (close: () => void) => React.ReactNode; align?: 'left' | 'right'; className?: string; up?: boolean;
}> = ({ trigger, children, align = 'left', className, up }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {trigger(open, () => setOpen((o) => !o))}
      {open && (
        <div role="menu" className={cx('absolute z-30 min-w-[180px] max-h-[320px] overflow-y-auto p-1 rounded-[10px] material-overlay', up ? 'bottom-full mb-1' : 'top-full mt-1', align === 'right' ? 'right-0' : 'left-0', className)}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
};

export const MenuItem: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; danger?: boolean }> = ({ active, danger, className, ...p }) => (
  <button type="button" role="menuitem" {...p}
    className={cx('w-full text-left px-2.5 py-1.5 rounded-[6px] text-[13px] flex items-center gap-2 disabled:opacity-40',
      active ? 'bg-[var(--color-accent-fill)] text-white' : danger ? 'text-[var(--c-red)] hover:bg-[var(--hover)]' : 'hover:bg-[var(--hover)]', className)} />
);

/** Groups items by recency: Today, Yesterday, Previous 7 days, Older. */
export function groupByDate<T extends { ts: number }>(items: T[]): { label: string; items: T[] }[] {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const day = 86_400_000;
  const buckets: { label: string; min: number; items: T[] }[] = [
    { label: 'Today', min: d0.getTime(), items: [] },
    { label: 'Yesterday', min: d0.getTime() - day, items: [] },
    { label: 'Previous 7 days', min: d0.getTime() - 7 * day, items: [] },
    { label: 'Older', min: -Infinity, items: [] },
  ];
  [...items].sort((a, b) => b.ts - a.ts).forEach((it) => buckets.find((b) => it.ts >= b.min)!.items.push(it));
  return buckets.filter((b) => b.items.length).map(({ label, items }) => ({ label, items }));
}
