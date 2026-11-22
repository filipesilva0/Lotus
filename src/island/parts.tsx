// Small building blocks of the island (0.23 redesign). Every colour comes from the island's tokens
// (look.ts: --is-*) or the app's one accent, so the same parts work on the black and the white island.
import React from 'react';
import { Check } from 'lucide-react';

export const ACCENT = 'var(--color-accent-vibrant)';
export const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--is-focus)]';

/** Progress: a ring that fills (or spins when there is no number), a check when done. */
export const Ring: React.FC<{ progress?: number | null; done?: boolean; size?: number }> = ({ progress = null, done, size = 18 }) => {
  const r = 7, c = 2 * Math.PI * r;
  if (done) return <Check style={{ color: ACCENT, width: size - 2, height: size - 2 }} aria-label="Done" />;
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden className={progress === null ? 'animate-spin' : ''} style={{ animationDuration: '1.1s' }}>
      <circle cx="9" cy="9" r={r} fill="none" stroke="var(--is-track)" strokeWidth="2.2" />
      <circle cx="9" cy="9" r={r} fill="none" stroke={ACCENT} strokeWidth="2.2" strokeLinecap="round" strokeDasharray={progress === null ? `${c * 0.28} ${c}` : `${c * progress} ${c}`} transform="rotate(-90 9 9)" style={{ transition: 'stroke-dasharray .3s' }} />
    </svg>
  );
};

/** A round icon button (28 px; 32 px with `big`). */
export const IconBtn: React.FC<{ label: string; onClick: () => void; children: React.ReactNode; big?: boolean; tone?: 'plain' | 'raised' | 'accent'; disabled?: boolean; pressed?: boolean }> = ({ label, onClick, children, big, tone = 'plain', disabled, pressed }) => (
  <button type="button" onClick={onClick} title={label} aria-label={label} disabled={disabled} aria-pressed={pressed}
    className={`${big ? 'w-8 h-8' : 'w-7 h-7'} shrink-0 rounded-full inline-flex items-center justify-center transition-colors disabled:opacity-40 ${focusRing} ${
      tone === 'accent' ? 'bg-[var(--color-accent-fill)] text-white hover:bg-[var(--color-accent-fill-hover)]'
        : tone === 'raised' ? 'bg-[var(--is-raised)] text-[var(--is-text)] hover:bg-[var(--is-raised-hover)]'
          : 'text-[var(--is-muted)] hover:text-[var(--is-text)] hover:bg-[var(--is-raised)]'}`}>
    {children}
  </button>
);

/** A pill button with a label. `primary` = the accent, one per view. */
export const Pill: React.FC<{ onClick: () => void; children: React.ReactNode; primary?: boolean; title?: string; disabled?: boolean; type?: 'button' | 'submit' }> = ({ onClick, children, primary, title, disabled, type = 'button' }) => (
  <button type={type} onClick={onClick} title={title} disabled={disabled}
    className={`h-8 px-3.5 rounded-full text-[12px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors disabled:opacity-40 ${focusRing} ${
      primary ? 'bg-[var(--color-accent-fill)] text-white hover:bg-[var(--color-accent-fill-hover)]' : 'bg-[var(--is-raised)] text-[var(--is-text)] hover:bg-[var(--is-raised-hover)]'}`}>
    {children}
  </button>
);

/** A quick button: icon in a circle, a one-word label underneath. */
export const Tile: React.FC<{ label: string; hint: string; onClick: () => void; children: React.ReactNode; active?: boolean }> = ({ label, hint, onClick, children, active }) => (
  <button type="button" onClick={onClick} title={hint} aria-label={hint}
    className={`group flex-1 min-w-0 flex flex-col items-center gap-1 py-1 rounded-[12px] ${focusRing}`}>
    <span className={`w-10 h-10 rounded-full inline-flex items-center justify-center transition-colors ${active ? 'bg-[var(--color-accent-fill)] text-white' : 'bg-[var(--is-raised)] text-[var(--is-text)] group-hover:bg-[var(--is-raised-hover)]'}`}>{children}</span>
    <span className="max-w-full truncate text-[11px] font-medium text-[var(--is-muted)] group-hover:text-[var(--is-text)]">{label}</span>
  </button>
);

/** A widget card on the island. */
export const Card: React.FC<{ children: React.ReactNode; label?: string; className?: string }> = ({ children, label, className = '' }) => (
  <section aria-label={label} className={`rounded-[16px] bg-[var(--is-card)] px-3 py-2.5 ${className}`}>{children}</section>
);

/** Small section heading with an optional action on the right. */
export const Label: React.FC<{ children: React.ReactNode; action?: React.ReactNode }> = ({ children, action }) => (
  <div className="flex items-center justify-between h-5 px-1">
    <p className="text-[11px] font-semibold text-[var(--is-muted)]">{children}</p>
    {action}
  </div>
);

/** A text button for small actions in headings ("Edit", "Clear"). */
export const Link: React.FC<{ onClick: () => void; children: React.ReactNode; title?: string }> = ({ onClick, children, title }) => (
  <button type="button" onClick={onClick} title={title} className={`text-[11px] font-semibold text-[var(--color-accent-vibrant)] hover:underline rounded ${focusRing}`}>{children}</button>
);

export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${Math.round(n / 1024)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(1)} GB`);
