import React from 'react';
import { Loader2, AlertTriangle, Info, ChevronUp, ChevronDown, Check } from 'lucide-react';

/*
 * Shared macOS-style controls.
 * Type scale (pt): 11 caption · 12 body-small · 13 body · 15 title · 20 large title.
 * Weights: 400 / 500 / 600. Radii: --r-xs 4 · --r-sm 6 (controls) · --r-md 10 (grouped containers).
 * Hit areas: >= 24 px on every control (WCAG 2.2 target size); icon buttons are 28 px.
 * Focus: 3 px system-accent ring (see :focus-visible in index.css). Hover and pressed use --hover/--pressed.
 */

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

const ringFocus = 'focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)] focus-visible:outline-offset-1';

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
  size?: 'sm' | 'md';
  icon?: React.ReactNode;
};

/** Push button. `primary` is the default (accent) button; use one per view. */
export const Btn: React.FC<BtnProps> = ({ variant = 'secondary', loading, size = 'md', icon, children, className, disabled, ...rest }) => (
  <button
    {...rest}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    className={cx(
      'inline-flex items-center justify-center gap-1.5 rounded-[6px] font-medium select-none whitespace-nowrap',
      'transition-[background-color,box-shadow,opacity] duration-100',
      'disabled:opacity-40 disabled:pointer-events-none',
      size === 'sm' ? 'h-6 px-2.5 text-[12px]' : 'h-7 px-3 text-[13px]',
      variant === 'primary' &&
        'bg-[var(--color-accent-fill)] text-white shadow-[inset_0_0.5px_0_rgba(255,255,255,.25),0_0.5px_1px_rgba(0,0,0,.25)] hover:bg-[var(--color-accent-fill-hover)] active:brightness-90',
      variant === 'secondary' &&
        'bg-[var(--color-bg-card)] text-[var(--color-text-main)] shadow-[0_0_0_0.5px_var(--sep),0_0.5px_1.5px_rgba(0,0,0,.12)] hover:bg-[var(--hover)] active:bg-[var(--pressed)]',
      variant === 'ghost' && 'text-[var(--color-text-main)] hover:bg-[var(--hover)] active:bg-[var(--pressed)]',
      variant === 'danger' && 'text-[var(--c-red)] hover:bg-[var(--hover)] active:bg-[var(--pressed)]',
      ringFocus,
      className,
    )}
  >
    {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : icon}
    {children}
  </button>
);

/** Toolbar-style icon button: 28 px target, label doubles as tooltip and VoiceOver name. */
export const IconBtn: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }> = ({
  label, active, className, children, ...rest
}) => (
  <button
    {...rest}
    title={label}
    aria-label={label}
    aria-pressed={active}
    className={cx(
      'w-7 h-7 inline-flex items-center justify-center rounded-[6px] transition-colors duration-100 disabled:opacity-40 disabled:pointer-events-none',
      active
        ? 'bg-[var(--pressed)] text-[var(--color-text-main)]'
        : 'text-[var(--color-text-muted)] hover:bg-[var(--hover)] hover:text-[var(--color-text-main)] active:bg-[var(--pressed)]',
      ringFocus,
      className,
    )}
  >
    {children}
  </button>
);

/** Segmented control: a squared, inset track with a raised selected segment. Arrow keys move selection. */
export function Segmented<T extends string>({
  value, onChange, options, className, label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string; icon?: React.ReactNode }[];
  className?: string;
  label?: string;
}) {
  const onKey = (e: React.KeyboardEvent) => {
    const i = options.findIndex((o) => o.id === value);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); onChange(options[(i + 1) % options.length].id); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); onChange(options[(i - 1 + options.length) % options.length].id); }
  };
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKey}
      className={cx('inline-flex p-0.5 gap-0.5 rounded-[7px] bg-[var(--hover)] shadow-[inset_0_0_0_0.5px_var(--sep)]', className)}>
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          tabIndex={value === o.id ? 0 : -1}
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={cx(
            'px-3 h-6 inline-flex items-center justify-center gap-1.5 text-[12px] font-medium rounded-[5px] transition-colors duration-100',
            value === o.id
              ? 'bg-[var(--color-bg-card)] text-[var(--color-text-main)] shadow-[0_0_0_0.5px_var(--sep),0_1px_2px_rgba(0,0,0,.12)]'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-main)]',
            ringFocus,
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
  <div className={cx('flex items-baseline justify-between mb-1', className)}>
    <span className="text-[12px] font-medium text-[var(--color-text-muted)]">{children}</span>
    {hint && <span className="text-[12px] text-[var(--color-text-muted)] tabular-nums">{hint}</span>}
  </div>
);

const field =
  'w-full rounded-[6px] bg-[var(--color-bg-card)] text-[13px] text-[var(--color-text-main)] placeholder:text-[var(--color-text-muted)] ' +
  'shadow-[inset_0_0_0_0.5px_var(--sep),0_0.5px_1px_rgba(0,0,0,.08)] hover:shadow-[inset_0_0_0_1px_var(--sep)] ' +
  'focus:outline-none focus:shadow-[0_0_0_3px_var(--ring),inset_0_0_0_1px_var(--color-accent-vibrant)] transition-shadow duration-100 disabled:opacity-45';

export const TextInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...p }, ref) => <input ref={ref} {...p} className={cx(field, 'h-7 px-2.5', className)} />,
);
TextInput.displayName = 'TextInput';

export const TextArea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...p }, ref) => <textarea ref={ref} {...p} className={cx(field, 'px-2.5 py-2 leading-relaxed resize-none', className)} />,
);
TextArea.displayName = 'TextArea';

/** Pop-up button: native <select> (so menus, type-ahead and VoiceOver come for free) with the up/down chevron pair. */
export const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = ({ className, children, ...p }) => (
  <span className="relative inline-flex w-full">
    <select {...p}
      className={cx(
        'w-full h-7 pl-2.5 pr-7 appearance-none rounded-[6px] text-[13px] text-[var(--color-text-main)] bg-[var(--color-bg-card)]',
        'shadow-[0_0_0_0.5px_var(--sep),0_0.5px_1.5px_rgba(0,0,0,.12)] hover:bg-[var(--hover)] disabled:opacity-45',
        'focus:outline-none focus-visible:shadow-[0_0_0_3px_var(--ring)]',
        className,
      )}>
      {children}
    </select>
    <span aria-hidden="true" className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 flex flex-col text-[var(--color-text-muted)]">
      <ChevronUp className="w-2.5 h-2.5 -mb-0.5" strokeWidth={2.6} /><ChevronDown className="w-2.5 h-2.5" strokeWidth={2.6} />
    </span>
  </span>
);

/** Combo box: free text with a list of suggestions (native datalist, keyboard and VoiceOver friendly). */
export const ComboBox: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { options: string[]; listId: string }> = ({ options, listId, className, ...p }) => (
  <>
    <input {...p} list={listId} className={cx(field, 'h-7 px-2.5', className)} />
    <datalist id={listId}>{options.map((o) => <option key={o} value={o} />)}</datalist>
  </>
);

/** Slider: thin track, circular thumb, accent fill; native range input underneath for keyboard + VoiceOver. */
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
      className="mac-slider w-full h-5 cursor-default disabled:opacity-40"
      style={{ ['--pct' as string]: `${pct}%` }}
    />
  );
};

/** Stepper: value field with a paired decrement/increment control. */
export const Stepper: React.FC<{
  value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void; label: string; unit?: string; disabled?: boolean;
}> = ({ value, min = -Infinity, max = Infinity, step = 1, onChange, label, unit, disabled }) => {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const bump = (d: number) => onChange(clamp(Math.round((value + d * step) * 1e6) / 1e6));
  return (
    <div className="inline-flex items-center gap-1.5" role="group" aria-label={label}>
      <input
        type="number" value={value} min={min} max={max} step={step} disabled={disabled} aria-label={label}
        onChange={(e) => { const n = parseFloat(e.target.value); if (!Number.isNaN(n)) onChange(clamp(n)); }}
        onKeyDown={(e) => { if (e.key === 'ArrowUp') { e.preventDefault(); bump(1); } if (e.key === 'ArrowDown') { e.preventDefault(); bump(-1); } }}
        className={cx(field, 'h-7 w-16 px-2 text-right tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none')}
      />
      {unit && <span className="text-[12px] text-[var(--color-text-muted)]">{unit}</span>}
      <span className="inline-flex flex-col rounded-[6px] overflow-hidden shadow-[0_0_0_0.5px_var(--sep),0_0.5px_1.5px_rgba(0,0,0,.12)] bg-[var(--color-bg-card)]">
        <button type="button" aria-label={`Increase ${label}`} disabled={disabled || value >= max} onClick={() => bump(1)}
          className={cx('h-3.5 w-5 inline-flex items-center justify-center hover:bg-[var(--hover)] active:bg-[var(--pressed)] disabled:opacity-35', ringFocus)}>
          <ChevronUp className="w-2.5 h-2.5" strokeWidth={2.8} aria-hidden="true" />
        </button>
        <button type="button" aria-label={`Decrease ${label}`} disabled={disabled || value <= min} onClick={() => bump(-1)}
          className={cx('h-3.5 w-5 inline-flex items-center justify-center hover:bg-[var(--hover)] active:bg-[var(--pressed)] disabled:opacity-35', ringFocus)}>
          <ChevronDown className="w-2.5 h-2.5" strokeWidth={2.8} aria-hidden="true" />
        </button>
      </span>
    </div>
  );
};

/** Color well: swatch that opens the system colour picker. */
export const ColorWell: React.FC<{ value: string; onChange: (hex: string) => void; label: string }> = ({ value, onChange, label }) => (
  <label className="relative inline-flex w-9 h-6 rounded-[6px] overflow-hidden shadow-[0_0_0_0.5px_var(--sep),0_0.5px_1.5px_rgba(0,0,0,.12)] bg-[var(--color-bg-card)] p-[3px] focus-within:shadow-[0_0_0_3px_var(--ring)]">
    <span className="sr-only">{label}</span>
    <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}
      className="w-full h-full cursor-default bg-transparent border-0 p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-[3px]" />
  </label>
);

/** Checkbox: 14 px square, 4 px radius, system-accent fill. */
export const Checkbox: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }> = ({ checked, onChange, label, disabled }) => (
  <label className={cx('inline-flex items-center gap-2 text-[13px]', disabled && 'opacity-45')}>
    <span className="relative inline-flex">
      <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden="true" className={cx('w-3.5 h-3.5 rounded-[4px] inline-flex items-center justify-center transition-colors peer-focus-visible:shadow-[0_0_0_3px_var(--ring)]',
        checked ? 'bg-[var(--color-accent-fill)] text-white' : 'bg-[var(--color-bg-card)] shadow-[inset_0_0_0_0.5px_var(--sep)]')}>
        {checked && <Check className="w-2.5 h-2.5" strokeWidth={3.4} />}
      </span>
    </span>
    {label}
  </label>
);

/** Progress: determinate when `value` is 0..1, indeterminate otherwise. */
export const Progress: React.FC<{ value?: number | null; label: string; className?: string }> = ({ value, label, className }) => {
  const det = typeof value === 'number';
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={det ? 0 : undefined} aria-valuemax={det ? 100 : undefined}
      aria-valuenow={det ? Math.round((value as number) * 100) : undefined}
      className={cx('h-1 rounded-[2px] overflow-hidden bg-[var(--hover)] shadow-[inset_0_0_0_0.5px_var(--sep)]', className)}>
      <div className={cx('h-full bg-[var(--color-accent-fill)] transition-[width] duration-200', !det && 'w-1/3 mac-indeterminate')}
        style={det ? { width: `${Math.max(0, Math.min(1, value as number)) * 100}%` } : undefined} />
    </div>
  );
};

/** Level indicator / gauge with semantic bands (normal, warning, critical). */
export const Gauge: React.FC<{ value: number; label: string; warnAt?: number; critAt?: number; className?: string }> = ({ value, label, warnAt = 0.7, critAt = 0.9, className }) => {
  const v = Math.max(0, Math.min(1, value));
  const color = v >= critAt ? 'var(--c-red)' : v >= warnAt ? 'var(--c-orange)' : 'var(--c-green)';
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}
      className={cx('h-1.5 rounded-[3px] bg-[var(--hover)] shadow-[inset_0_0_0_0.5px_var(--sep)] overflow-hidden', className)}>
      <div className="h-full transition-[width] duration-200" style={{ width: `${v * 100}%`, background: color }} />
    </div>
  );
};

/** Grouped container (inset grouped list / form section). */
export const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...p }) => (
  <div {...p} className={cx('rounded-[10px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep),var(--shadow-1)]', className)} />
);

export const Spinner: React.FC<{ className?: string }> = ({ className }) => (
  <Loader2 className={cx('animate-spin', className ?? 'w-4 h-4')} role="status" aria-label="Loading" />
);

export const Skeleton: React.FC<{ className?: string }> = ({ className }) => (
  <div aria-hidden="true" className={cx('animate-pulse rounded-[6px] bg-[var(--hover)]', className)} />
);

export const Empty: React.FC<{ icon?: React.ReactNode; title: string; body?: string; action?: React.ReactNode; className?: string }> = ({
  icon, title, body, action, className,
}) => (
  <div className={cx('flex flex-col items-center justify-center text-center py-12 px-6', className)}>
    {icon && <div className="w-10 h-10 text-[var(--color-text-muted)] flex items-center justify-center mb-3 [&>svg]:w-9 [&>svg]:h-9 [&>svg]:stroke-[1.2]">{icon}</div>}
    <h3 className="text-[15px] font-semibold text-[var(--color-text-main)]">{title}</h3>
    {body && <p className="text-[13px] text-[var(--color-text-muted)] mt-1 max-w-sm leading-relaxed">{body}</p>}
    {action && <div className="mt-4 flex gap-2">{action}</div>}
  </div>
);

export const Banner: React.FC<{ tone?: 'error' | 'info' | 'warn'; children: React.ReactNode; action?: React.ReactNode; className?: string }> = ({
  tone = 'info', children, action, className,
}) => (
  <div
    role={tone === 'error' ? 'alert' : 'status'}
    className={cx(
      'flex items-start gap-2.5 rounded-[10px] px-3 py-2 text-[13px] leading-relaxed shadow-[inset_0_0_0_0.5px_var(--sep)]',
      tone === 'error' && 'bg-[color-mix(in_srgb,var(--c-red)_10%,transparent)] text-[var(--c-red)]',
      tone === 'warn' && 'bg-[color-mix(in_srgb,var(--c-orange)_12%,transparent)] text-[var(--c-orange)]',
      tone === 'info' && 'bg-[var(--hover)] text-[var(--color-text-main)]',
      className,
    )}
  >
    {tone === 'info' ? <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--color-accent-vibrant)]" aria-hidden="true" /> : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />}
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
