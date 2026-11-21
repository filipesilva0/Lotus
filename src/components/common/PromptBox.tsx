import React from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { cx } from './ui';
import { useHardware } from '../../hardware/monitor';

/*
 * Prompt box (session 8): the one shape every place you type to a model uses (Chat, Images, the App
 * Builder agent, Voice → Speak). A rounded box sits on a tray. Inside the box: the text, then a row
 * with tools on the left and the model / mic / round send button on the right. The tray under it
 * holds page actions (text buttons) and per-conversation switches (icon-only, with tips). An
 * optional meter runs along the box's top edge like an XP bar (context or video memory), no text.
 */

export const PromptShell: React.FC<{
  children: React.ReactNode; tray?: React.ReactNode; drag?: boolean; className?: string;
  onDragOver?: React.DragEventHandler; onDragLeave?: React.DragEventHandler; onDrop?: React.DragEventHandler;
}> = ({ children, tray, drag, className, onDragOver, onDragLeave, onDrop }) => (
  <div className={cx('rounded-[24px]', !!tray && 'bg-[var(--composer-tray)]', className)}>
    <div onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
      className={cx('relative rounded-[24px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep),0_2px_8px_rgba(0,0,0,.06)] transition-shadow', drag && 'shadow-[0_0_0_2px_var(--color-accent-fill)]')}>
      {children}
    </div>
    {!!tray && <div className="min-h-10 flex flex-wrap items-center gap-0.5 px-3 py-1">{tray}</div>}
  </div>
);

/** Thin bar along the box's top edge. `value` 0–1; numbers belong in `title` (shown on hover). */
export const EdgeMeter: React.FC<{ value: number | null; label: string; title: string; warnAt?: number; critAt?: number }> = ({ value, label, title, warnAt = 0.75, critAt = 0.92 }) => {
  const v = value === null ? 0 : Math.max(0, Math.min(1, value));
  const tone = v >= critAt ? 'var(--c-red)' : v >= warnAt ? 'var(--c-orange)' : 'var(--color-accent-vibrant)';
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} title={title}
      className="absolute top-0 left-6 right-6 h-[3px] rounded-b-full bg-[var(--hover)] overflow-hidden">
      <div className="h-full rounded-b-full transition-[width] duration-300" style={{ width: `${v * 100}%`, background: tone }} />
    </div>
  );
};

/**
 * Video memory in use along the box's top edge. Reads this computer's GPU through the hardware
 * monitor (nvidia-smi, amdgpu, Windows counters), so it works with Lotus's own engines too;
 * `fallback` (e.g. ComfyUI's own report) is used only when the computer gives no reading.
 */
export const VramMeter: React.FC<{ fallback?: { device?: string; totalGb: number; freeGb: number } | null; idleTitle?: string }> = ({ fallback, idleTitle }) => {
  const g = useHardware().hw?.gpu ?? null;
  const total = g ? g.totalMb / 1024 : fallback?.totalGb ?? 0;
  const used = g ? g.usedMb / 1024 : fallback ? fallback.totalGb - fallback.freeGb : 0;
  const name = g?.name || fallback?.device || 'GPU';
  return <EdgeMeter value={total ? used / total : null} label="Video memory in use"
    title={total ? `${name}: ${used.toFixed(1)} of ${total.toFixed(1)} GB video memory in use` : idleTitle ?? 'Lotus couldn’t read video memory on this computer'} />;
};

const focusRing = 'focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)]';

/** Labelled on/off control inside the box (Think, Web, Research, Plan first…). */
export const ModeButton: React.FC<{ on: boolean; onClick: () => void; icon: React.ReactNode; label: string; title: string; disabled?: boolean }> = ({ on, onClick, icon, label, title, disabled }) => (
  <button type="button" aria-pressed={on} onClick={onClick} title={title} disabled={disabled}
    className={cx('h-8 inline-flex items-center gap-1.5 px-2.5 rounded-full text-[13px] transition-colors duration-100 disabled:opacity-40', focusRing,
      on ? 'is-selected font-medium' : 'text-[var(--color-text-muted)] hover:bg-[var(--hover)] hover:text-[var(--color-text-main)]')}>
    {icon}<span>{label}</span>
  </button>
);

/** Round icon button inside the box (+, mic, reference image…). Its name shows as a tip. */
export const RoundIcon: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; tip?: string; danger?: boolean }> = ({ label, tip, danger, className, children, ...rest }) => (
  <button type="button" aria-label={label} data-tip={tip ?? label} {...rest}
    className={cx('tip w-8 h-8 inline-flex items-center justify-center rounded-full hover:bg-[var(--hover)] active:bg-[var(--pressed)] disabled:opacity-40', focusRing,
      danger ? 'text-[var(--c-red)]' : 'text-[var(--color-text-main)]', className)}>
    {children}
  </button>
);

/** Text action in the tray (Choose folder, Library, Styles…). */
export const TrayButton: React.FC<{ onClick: () => void; icon: React.ReactNode; label: string; title: string; disabled?: boolean }> = ({ onClick, icon, label, title, disabled }) => (
  <button type="button" onClick={onClick} title={title} disabled={disabled}
    className={cx('h-7 inline-flex items-center gap-1.5 px-2 rounded-[8px] text-[13px] text-[var(--color-text-muted)] hover:bg-[var(--hover)] hover:text-[var(--color-text-main)] disabled:opacity-40', focusRing)}>
    {icon}<span>{label}</span>
  </button>
);

/** Icon-only switch in the tray (Memory, Incognito…); the name shows as a tip on hover or focus. */
export const TrayToggle: React.FC<{ on: boolean; onClick: () => void; icon: React.ReactNode; tip: string; disabled?: boolean }> = ({ on, onClick, icon, tip, disabled }) => (
  <button type="button" aria-pressed={on} aria-label={tip} data-tip={tip} onClick={onClick} disabled={disabled}
    className={cx('tip w-7 h-7 inline-flex items-center justify-center rounded-[8px] transition-colors duration-100 disabled:opacity-40', focusRing,
      on ? 'is-selected' : 'text-[var(--color-text-muted)] hover:bg-[var(--hover)] hover:text-[var(--color-text-main)]')}>
    {icon}
  </button>
);

/** Tray text that is information, not an action (sizes, counts). */
export const TrayNote: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="px-2 text-[12px] tabular-nums text-[var(--color-text-muted)] whitespace-nowrap">{children}</span>
);

/** Round send (or stop) button at the end of the box's row. */
export const SendButton: React.FC<{ stop?: boolean; onClick: () => void; disabled?: boolean; label?: string; tip?: string; icon?: React.ReactNode }> = ({ stop, onClick, disabled, label, tip, icon }) => stop ? (
  <button type="button" onClick={onClick} aria-label={label ?? 'Stop'} data-tip={tip ?? 'Stop'}
    className={cx('tip w-8 h-8 inline-flex items-center justify-center rounded-full bg-[var(--color-text-main)] text-[var(--color-bg-card)]', focusRing)}>
    <Square className="w-3 h-3" fill="currentColor" />
  </button>
) : (
  <button type="button" disabled={disabled} onClick={onClick} aria-label={label ?? 'Send'} data-tip={tip ?? label ?? 'Send'}
    className={cx('tip w-8 h-8 inline-flex items-center justify-center rounded-full bg-[var(--color-accent-fill)] text-white hover:bg-[var(--color-accent-fill-hover)] disabled:bg-[var(--pressed)] disabled:text-[var(--color-text-muted)] transition-colors', focusRing)}>
    {icon ?? <ArrowUp className="w-[18px] h-[18px]" strokeWidth={2.2} />}
  </button>
);

/** A labelled picker that sits at the right of the box row (model, checkpoint). */
export const PickerButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { open: boolean; icon?: React.ReactNode; text: string; chevron: React.ReactNode }>(
  ({ open, icon, text, chevron, className, ...rest }, ref) => (
    <button ref={ref} type="button" aria-haspopup="listbox" aria-expanded={open} {...rest}
      className={cx('h-8 max-w-[240px] inline-flex items-center gap-1 pl-2.5 pr-2 rounded-full text-[13px] transition-colors duration-100', focusRing,
        open ? 'bg-[var(--pressed)] text-[var(--color-text-main)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--hover)] hover:text-[var(--color-text-main)]', className)}>
      {icon}<span className="truncate">{text}</span>{chevron}
    </button>
  ));
PickerButton.displayName = 'PickerButton';

/*
 * 0.20: one skeleton for every prompt box. Chat, Work and Images used to lay out their rows by hand, so the
 * same things sat in different places. Now each page fills the same slots:
 *   box row:  [+ attach] [page chips…]            ……  [picker] [mic] [send]
 *   tray:     [page actions…]                     ……  [status / switches]
 * Page-specific chips (Think, Web, Talk, LoRA…) always go in the chips slot, right after the +.
 */
export const PromptRow: React.FC<{ attach?: React.ReactNode; chips?: React.ReactNode; picker?: React.ReactNode; mic?: React.ReactNode; send: React.ReactNode; className?: string }> = ({ attach, chips, picker, mic, send, className }) => (
  <div className={cx('relative flex items-center gap-1 px-2.5 pb-2.5', className)}>
    {attach}
    {chips && <div className="flex items-center gap-1 min-w-0" role="group" aria-label="Options for this message">{chips}</div>}
    <div className="flex-1" />
    {picker}
    {mic}
    {send}
  </div>
);

/** The tray's two slots: page actions on the left, status and per-conversation switches on the right. */
export const TrayRow: React.FC<{ actions?: React.ReactNode; status?: React.ReactNode }> = ({ actions, status }) => (
  <>
    {actions}
    <div className="flex-1" />
    {status}
  </>
);

/** The text field inside the box (same size, padding and placeholder colour on every page). */
export const PromptText = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} {...p}
    className={cx('w-full resize-none bg-transparent px-4 pt-4 pb-1 text-[14px] leading-relaxed placeholder:text-[var(--color-text-muted)] focus:outline-none max-h-48', className)} />
));
PromptText.displayName = 'PromptText';
