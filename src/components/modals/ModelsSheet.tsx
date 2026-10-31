import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { IconBtn } from '../common/ui';
import { ModelsWorkspace } from '../workspaces/ModelsWorkspace';
import type { EngineState } from '../../hooks/useEngines';
import type { EngineId } from '../../services/engineConfig';

/**
 * Models as a sheet, opened from the profile menu. Same shell as the profile and settings sheets:
 * top-aligned floating card on thick material, 44 px header with title and close.
 * The full Models page (Engines → Models) is unchanged; this shows the same component.
 */
export const ModelsSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  engines: Record<EngineId, EngineState>;
  onOpenEngines: () => void;
}> = ({ open, onClose, engines, onOpenEngines }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const h = (e: KeyboardEvent) => {
      // Let a dialog opened from inside (Add model…) close first.
      if (e.key === 'Escape' && document.querySelectorAll('[role="dialog"]').length <= 1) onClose();
    };
    window.addEventListener('keydown', h);
    return () => { window.removeEventListener('keydown', h); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh] px-4 bg-black/25 dark:bg-black/45" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Models"
        className="material-overlay w-full max-w-5xl h-[84vh] max-h-[760px] flex flex-col rounded-[12px] outline-none overflow-hidden">
        <div className="flex items-center justify-between px-4 h-11 shrink-0 border-b border-[var(--sep)]">
          <h2 className="text-[13px] font-semibold text-[var(--color-text-main)]">Models</h2>
          <IconBtn label="Close" onClick={onClose}><X className="w-4 h-4" /></IconBtn>
        </div>
        {/* The workspace paints its own panel colour; on a sheet it sits on the material instead. */}
        <div className="flex-1 min-h-0 flex [&>div]:!bg-transparent">
          <ModelsWorkspace engines={engines} onOpenEngines={() => { onClose(); onOpenEngines(); }} />
        </div>
      </div>
    </div>
  );
};
