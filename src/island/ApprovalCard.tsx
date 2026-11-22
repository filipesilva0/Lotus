import React from 'react';
import { Check, X } from 'lucide-react';
import { PermissionRequest } from './state';

export const ApprovalCard: React.FC<{ req: PermissionRequest; more: number; onAnswer: (allow: boolean) => void }> = ({ req, more, onAnswer }) => (
  <div className="h-full flex flex-col pl-14 pr-4 pt-3 pb-3.5" role="alertdialog" aria-labelledby="appr-title" aria-describedby="appr-body">
    <div className="min-h-[34px]">
      <p id="appr-title" className="text-[13px] font-semibold text-[var(--is-text)] leading-tight">
        {req.project} wants to use <span className="text-[var(--is-warn)]">{req.tool}</span>
      </p>
      <p className="text-[11px] text-[var(--is-muted)] mt-0.5">Claude Code is waiting for your answer{more > 0 ? ` · ${more} more queued` : ''}</p>
    </div>
    <pre id="appr-body" className="flex-1 min-h-0 mt-2 -ml-11 rounded-[12px] bg-[var(--is-card)] ring-1 ring-[var(--is-hair)] text-[11px] leading-relaxed text-[var(--is-text)] p-2.5 overflow-auto whitespace-pre-wrap break-all">{req.detail || req.summary}</pre>
    <div className="flex justify-end gap-2 mt-2.5 -ml-11">
      <button onClick={() => onAnswer(false)}
        className="h-8 px-4 rounded-full bg-[var(--is-raised)] hover:bg-[var(--is-raised-hover)] text-[var(--is-text)] text-xs font-semibold inline-flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--is-focus)]">
        <X className="w-3.5 h-3.5" />Deny
      </button>
      <button onClick={() => onAnswer(true)}
        className="h-8 px-4 rounded-full bg-[var(--color-accent-fill)] hover:bg-[var(--color-accent-fill-hover)] text-white text-xs font-semibold inline-flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--is-focus)]">
        <Check className="w-3.5 h-3.5" />Allow
      </button>
    </div>
  </div>
);
