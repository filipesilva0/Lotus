import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { IconBtn, cx } from './ui';

/** Sheet: a floating overlay on thick material. Escape closes; focus moves in and returns on close. */
export const Modal: React.FC<{
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean;
}> = ({ open, onClose, title, children, footer, wide }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => { window.removeEventListener('keydown', h); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh] px-4 bg-black/25 dark:bg-black/45" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
        className={cx('material-overlay w-full max-h-[84vh] flex flex-col rounded-[12px] outline-none', wide ? 'max-w-2xl' : 'max-w-md')}>
        <div className="flex items-center justify-between px-4 h-11 shrink-0 border-b border-[var(--sep)]">
          <h2 className="text-[13px] font-semibold text-[var(--color-text-main)]">{title}</h2>
          <IconBtn label="Close" onClick={onClose}><X className="w-4 h-4" /></IconBtn>
        </div>
        <div className="px-4 py-4 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="px-4 py-3 border-t border-[var(--sep)] flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
};
