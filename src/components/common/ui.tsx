import React from 'react';
import { Loader2, AlertTriangle, Info } from 'lucide-react';

// Shared primitives. Type scale: 11 (labels) · 12 (body) · 14 (titles) · 18 (page).
// Two weights: 500 and 600. Radius: 10 (controls) · 16 (cards).

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

const focus = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-vibrant)]';

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
  size?: 'sm' | 'md';
  icon?: React.ReactNode;
};

export const Btn: React.FC<BtnProps> = ({ variant = 'secondary', loading, size = 'md', icon, children, className, disabled, ...rest }) => (
  <button
    {...rest}
    disabled={disabled || loading}
    className={cx(
      'inline-flex items-center justify-center gap-1.5 rounded-[10px] font-semibold transition-colors select-none',
      'disabled:opacity-45 disabled:cursor-not-allowed',
      size === 'sm' ? 'h-7 px-2.5 text-[11px]' : 'h-9 px-4 text-xs',
      variant === 'primary' && 'bg-[var(--color-accent-vibrant)] text-white hover:bg-[var(--color-accent-hover)]',
      variant === 'secondary' &&
        'bg-[var(--color-accent-pastel)] text-[var(--color-accent-vibrant)] border border-[var(--color-accent-pastel-border)] hover:brightness-95',
      variant === 'ghost' && 'text-[#6B7280] dark:text-slate-400 hover:bg-black/5 dark:hover:bg-white/5 hover:text-[#111827] dark:hover:text-white',
      variant === 'danger' && 'text-rose-600 dark:text-rose-400 hover:bg-rose-500/10',
      focus,
      className,
    )}
  >
    {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}
    {children}
  </button>
);

export const IconBtn: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }> = ({
  label, active, className, children, ...rest
}) => (
  <button
    {...rest}
    title={label}
    aria-label={label}
    className={cx(
      'w-8 h-8 inline-flex items-center justify-center rounded-[10px] transition-colors disabled:opacity-40',
      active
        ? 'bg-[var(--color-accent-pastel)] text-[var(--color-accent-vibrant)]'
        : 'text-[#6B7280] dark:text-slate-400 hover:bg-black/5 dark:hover:bg-white/5 hover:text-[#111827] dark:hover:text-white',
      focus,
      className,
    )}
  >
    {children}
  </button>
);

export function Segmented<T extends string>({
  value, onChange, options, className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string; icon?: React.ReactNode }[];
  className?: string;
}) {
  return (
    <div role="tablist" className={cx('inline-flex bg-[var(--color-accent-pastel)] border border-[var(--color-accent-pastel-border)] p-1 rounded-full', className)}>
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={cx(
            'px-3 h-7 inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-full transition-all',
            value === o.id
              ? 'bg-[var(--color-accent-vibrant)] text-white shadow-xs'
              : 'text-[#6B7280] dark:text-slate-400 hover:text-[#111827] dark:hover:text-white',
            focus,
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const Label: React.FC<{ children: React.ReactNode; hint?: React.ReactNode; className?: string }> = ({ children, hint, className }) => (
  <div className={cx('flex items-baseline justify-between mb-1.5', className)}>
    <span className="text-[11px] font-semibold text-[#6B7280] dark:text-slate-400">{children}</span>
    {hint && <span className="text-[11px] text-[#9CA3AF] tabular-nums">{hint}</span>}
  </div>
);

const field =
  'w-full rounded-[10px] bg-white dark:bg-[#1D1F25] border border-[#E4E6EB] dark:border-[#2C2F38] text-xs text-[#111827] dark:text-slate-100 placeholder:text-[#9CA3AF] hover:border-[#CDD0D8] dark:hover:border-[#3A3E4A] focus:border-[var(--color-accent-vibrant)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-vibrant)]/20 transition-colors disabled:opacity-50';

export const TextInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...p }, ref) => <input ref={ref} {...p} className={cx(field, 'h-9 px-3', className)} />,
);
TextInput.displayName = 'TextInput';

export const TextArea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...p }, ref) => <textarea ref={ref} {...p} className={cx(field, 'px-3 py-2.5 leading-relaxed resize-none', className)} />,
);
TextArea.displayName = 'TextArea';

export const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = ({ className, children, ...p }) => (
  <select {...p} className={cx(field, 'h-9 px-2.5 pr-7 appearance-none bg-no-repeat bg-[right_0.6rem_center] bg-[length:10px]', className)}
    style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none' stroke='%239CA3AF' stroke-width='1.6'%3E%3Cpath d='M1 1l4 4 4-4'/%3E%3C/svg%3E\")" }}>
    {children}
  </select>
);

export const Slider: React.FC<{
  value: number; min: number; max: number; step?: number; onChange: (v: number) => void; onCommit?: (v: number) => void; label?: string; disabled?: boolean;
}> = ({ value, min, max, step = 0.01, onChange, onCommit, label, disabled }) => {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range" min={min} max={max} step={step} value={value} disabled={disabled} aria-label={label}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      onPointerUp={(e) => onCommit?.(parseFloat((e.target as HTMLInputElement).value))}
      onKeyUp={(e) => onCommit?.(parseFloat((e.target as HTMLInputElement).value))}
      className="w-full h-1.5 rounded-full appearance-none cursor-pointer disabled:opacity-40 accent-[var(--color-accent-vibrant)]"
      style={{ background: `linear-gradient(to right, var(--color-accent-vibrant) ${pct}%, rgba(127,127,127,.22) ${pct}%)` }}
    />
  );
};

export const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...p }) => (
  <div {...p} className={cx('rounded-2xl border border-[#EBECEF] dark:border-[#2C2F38] bg-white dark:bg-[#22242B]', className)} />
);

export const Spinner: React.FC<{ className?: string }> = ({ className }) => <Loader2 className={cx('animate-spin', className ?? 'w-4 h-4')} />;

export const Skeleton: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cx('animate-pulse rounded-[10px] bg-black/[.06] dark:bg-white/[.07]', className)} />
);

export const Empty: React.FC<{ icon?: React.ReactNode; title: string; body?: string; action?: React.ReactNode; className?: string }> = ({
  icon, title, body, action, className,
}) => (
  <div className={cx('flex flex-col items-center justify-center text-center py-12 px-6', className)}>
    {icon && <div className="w-11 h-11 rounded-2xl bg-[var(--color-accent-pastel)] text-[var(--color-accent-vibrant)] flex items-center justify-center mb-3">{icon}</div>}
    <h3 className="text-sm font-semibold text-[#111827] dark:text-white">{title}</h3>
    {body && <p className="text-xs text-[#6B7280] dark:text-slate-400 mt-1 max-w-sm leading-relaxed">{body}</p>}
    {action && <div className="mt-4 flex gap-2">{action}</div>}
  </div>
);

export const Banner: React.FC<{ tone?: 'error' | 'info' | 'warn'; children: React.ReactNode; action?: React.ReactNode; className?: string }> = ({
  tone = 'info', children, action, className,
}) => (
  <div
    role={tone === 'error' ? 'alert' : 'status'}
    className={cx(
      'flex items-start gap-2.5 rounded-[12px] px-3 py-2.5 text-xs leading-relaxed',
      tone === 'error' && 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300',
      tone === 'warn' && 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300',
      tone === 'info' && 'bg-[var(--color-accent-pastel)] text-[var(--color-accent-vibrant)]',
      className,
    )}
  >
    {tone === 'info' ? <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
    <div className="flex-1 min-w-0">{children}</div>
    {action}
  </div>
);

/** Copy-confirmation chip state helper. */
export function useFlash(ms = 1400): [boolean, () => void] {
  const [on, setOn] = React.useState(false);
  const t = React.useRef<number>(0);
  return [
    on,
    () => {
      setOn(true);
      window.clearTimeout(t.current);
      t.current = window.setTimeout(() => setOn(false), ms);
    },
  ];
}
