// "Copied" peek (0.23, idea 4): after you copy some text, the island offers a few things Lotus can do
// with it, privately on this PC. It leaves on its own after a few seconds unless you hover it.
import React from 'react';
import { BookOpen, Languages, ScrollText, SpellCheck, Volume2, X } from 'lucide-react';
import { IconBtn, Pill } from './parts';
import { clipActions, type ClipActionId } from './clip';

const ICON: Record<ClipActionId, React.FC<{ className?: string }>> = { explain: BookOpen, summarise: ScrollText, translate: Languages, fix: SpellCheck, read: Volume2 };

export const ClipPeek: React.FC<{ text: string; onAction: (id: ClipActionId) => void; onClose: () => void }> = ({ text, onAction, onClose }) => (
  <div className="px-3 pt-2.5 pb-3 flex flex-col gap-2" role="dialog" aria-label="Do something with what you copied">
    <div className="flex items-start gap-2 pl-1">
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-[var(--is-muted)]">You copied</p>
        <p className="text-[13px] leading-snug text-[var(--is-text)] line-clamp-2">“{text.trim().replace(/\s+/g, ' ')}”</p>
      </div>
      <IconBtn label="Not now" onClick={onClose}><X className="w-4 h-4" /></IconBtn>
    </div>
    <div className="flex flex-wrap gap-1.5">
      {clipActions.map((a) => { const I = ICON[a.id]; return <Pill key={a.id} onClick={() => onAction(a.id)}><I className="w-3.5 h-3.5" />{a.label}</Pill>; })}
    </div>
  </div>
);

/** The focus timer ran out: done, or a few more minutes? */
export const FocusDone: React.FC<{ task?: { title: string }; onMore: () => void; onDone: () => void; onClose: () => void }> = ({ task, onMore, onDone, onClose }) => (
  <div className="px-3 pt-3 pb-3 flex flex-col gap-2.5" role="alertdialog" aria-label="Focus time is up">
    <div className="flex items-start gap-2 pl-1">
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold text-[var(--is-text)]">Focus time is up</p>
        <p className="text-[12px] text-[var(--is-muted)] truncate">{task ? `Done with “${task.title}”, or 5 more minutes?` : 'Take a short break, or keep going for 5 more minutes.'}</p>
      </div>
      <IconBtn label="Close" onClick={onClose}><X className="w-4 h-4" /></IconBtn>
    </div>
    <div className="flex justify-end gap-2">
      <Pill onClick={onMore}>5 more minutes</Pill>
      <Pill primary onClick={onDone}>{task ? 'Done, move it to Done' : 'Done'}</Pill>
    </div>
  </div>
);
