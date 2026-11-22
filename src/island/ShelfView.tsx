// The shelf and the drop zones (0.23, idea 2). Drag a file to the top of the screen: the island opens with
// four zones. Whatever you drop is kept on the shelf (Lotus Studio/Shelf) until you remove it.
import React, { useState } from 'react';
import { ArrowLeft, ArrowRightLeft, Captions, FileText, FolderOpen, Inbox, MessageSquare, Send, Trash2, Image as ImageIcon, Film, Music } from 'lucide-react';
import { IconBtn, Pill, fmtBytes, focusRing } from './parts';
import type { ShelfItem } from './sources';
import { canAsk, canTranscribe, isAudio, isPicture, isVideo, shelfTargets, usePages, type UsePage } from './shelfRules';

export type DropZone = 'keep' | 'ask' | 'convert' | 'use';

const ZONES: { id: DropZone; label: string; hint: string; Icon: React.FC<{ className?: string }> }[] = [
  { id: 'keep', label: 'Keep for later', hint: 'On the shelf until you remove it', Icon: Inbox },
  { id: 'ask', label: 'Ask Lotus', hint: 'Summarise, explain or describe it', Icon: MessageSquare },
  { id: 'convert', label: 'Turn into…', hint: 'MP4, GIF, MP3 or text', Icon: ArrowRightLeft },
  { id: 'use', label: 'Use in…', hint: 'Work, Images, Video or Voice', Icon: Send },
];

/** While a file is dragged over the island. Each zone highlights under the pointer. */
export const DropZones: React.FC<{ onDropZone: (z: DropZone, e: React.DragEvent) => void }> = ({ onDropZone }) => {
  const [over, setOver] = useState<DropZone | null>(null);
  return (
    <div className="p-3 grid grid-cols-2 gap-2" aria-label="Drop the file on what you want">
      {ZONES.map(({ id, label, hint, Icon }) => (
        <div key={id}
          onDragEnter={() => setOver(id)} onDragLeave={() => setOver((o) => (o === id ? null : o))}
          onDragOver={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; }}
          onDrop={(e) => { e.preventDefault(); setOver(null); onDropZone(id, e); }}
          className={`h-[76px] rounded-[16px] border-2 border-dashed flex items-center gap-3 px-3 transition-colors ${over === id ? 'border-[var(--color-accent-vibrant)] bg-[var(--is-raised-hover)]' : 'border-[var(--is-hair)] bg-[var(--is-card)]'}`}>
          <span className={`w-10 h-10 shrink-0 rounded-full inline-flex items-center justify-center ${over === id ? 'bg-[var(--color-accent-fill)] text-white' : 'bg-[var(--is-raised)] text-[var(--is-text)]'}`}><Icon className="w-[18px] h-[18px]" /></span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold text-[var(--is-text)]">{label}</span>
            <span className="block text-[11px] leading-snug text-[var(--is-muted)]">{hint}</span>
          </span>
        </div>
      ))}
    </div>
  );
};

const PAGE_LABEL: Record<UsePage, string> = { work: 'Work', images: 'Images', video: 'Video', voice: 'Voice' };
const fileIcon = (n: string) => (isPicture(n) ? ImageIcon : isVideo(n) ? Film : isAudio(n) ? Music : FileText);

export interface ShelfActions {
  ask: (it: ShelfItem) => void;
  convert: (it: ShelfItem, to: string) => Promise<void>;
  transcribe: (it: ShelfItem) => Promise<void>;
  use: (it: ShelfItem, page: UsePage) => void;
  reveal: (it: ShelfItem) => void;
  remove: (it: ShelfItem) => void;
}

/** The shelf: your kept files, newest first. Pick one to see what Lotus can do with it. */
export const ShelfView: React.FC<{ items: ShelfItem[]; selected: string | null; onSelect: (name: string | null) => void; onBack: () => void; act: ShelfActions; status: string | null; busy: string | null }> = ({ items, selected, onSelect, onBack, act, status, busy }) => (
  <div className="px-3 pt-2.5 pb-3 flex flex-col gap-2">
    <div className="flex items-center gap-2">
      <IconBtn label="Back" onClick={onBack}><ArrowLeft className="w-4 h-4" /></IconBtn>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold text-[var(--is-text)]">Shelf</p>
        <p className="text-[11px] text-[var(--is-muted)]">{items.length ? `${items.length} file${items.length === 1 ? '' : 's'} · drop more here` : 'Drop a file on the island to keep it here'}</p>
      </div>
    </div>
    {status && <p role="status" className="px-1 text-[12px] text-[var(--is-text)]">{status}</p>}
    <ul className="max-h-[320px] overflow-y-auto space-y-1" aria-label="Files on the shelf">
      {items.map((it) => {
        const open = selected === it.name;
        const I = fileIcon(it.name);
        return (
          <li key={it.name} className={`rounded-[14px] ${open ? 'bg-[var(--is-card)]' : ''}`}>
            <button type="button" aria-expanded={open} onClick={() => onSelect(open ? null : it.name)}
              className={`w-full h-10 px-2 rounded-[14px] flex items-center gap-2.5 text-left hover:bg-[var(--is-raised)] ${focusRing}`}>
              <span className="w-7 h-7 shrink-0 rounded-[8px] bg-[var(--is-raised)] inline-flex items-center justify-center text-[var(--is-muted)]"><I className="w-4 h-4" /></span>
              <span className="flex-1 min-w-0 truncate text-[13px] text-[var(--is-text)]">{it.name}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-[var(--is-muted)]">{busy === it.name ? 'Working…' : fmtBytes(it.bytes)}</span>
            </button>
            {open && (
              <div className="px-2 pb-2.5 pt-1 space-y-1.5">
                {canAsk(it.name) && <div className="flex"><Pill primary onClick={() => act.ask(it)}><MessageSquare className="w-3.5 h-3.5" />Ask Lotus about it</Pill></div>}
                {(shelfTargets(it.name).length > 0 || canTranscribe(it.name)) && (
                  <ActionRow label="Turn into">
                    {shelfTargets(it.name).map((t) => <Pill key={t} disabled={!!busy} onClick={() => void act.convert(it, t)}>{t.toUpperCase()}</Pill>)}
                    {canTranscribe(it.name) && <Pill disabled={!!busy} onClick={() => void act.transcribe(it)}><Captions className="w-3.5 h-3.5" />Text</Pill>}
                  </ActionRow>
                )}
                <ActionRow label="Use in">
                  {usePages(it.name).map((pg) => <Pill key={pg} onClick={() => act.use(it, pg)}>{PAGE_LABEL[pg]}</Pill>)}
                  <span className="flex-1" />
                  <IconBtn label="Show in folder" onClick={() => act.reveal(it)}><FolderOpen className="w-4 h-4" /></IconBtn>
                  <IconBtn label={`Remove ${it.name} from the shelf`} onClick={() => act.remove(it)}><Trash2 className="w-4 h-4" /></IconBtn>
                </ActionRow>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  </div>
);

const ActionRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center gap-1.5">
    <span className="w-[58px] shrink-0 text-[11px] text-[var(--is-muted)]">{label}</span>
    {children}
  </div>
);
