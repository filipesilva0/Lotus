// 0.21: the working parts of a prompt box that Chat and Work share, so the two boxes look and behave
// the same: the model menu, dictation, the attachment chips and a text field that grows as you type.
// (PromptBox.tsx holds the shell and slots; this file holds the pieces with state.)

import React, { useEffect, useRef, useState } from 'react';
import { Boxes, Check, ChevronDown, FileText, Mic, MicOff, X } from 'lucide-react';
import { IconBtn, cx } from './ui';
import { PickerButton } from './PromptBox';
import { prettyModelName } from '../../models/names';
import { MicRecorder, micErrorMessage } from '../../lib/audio';
import { transcribe } from '../../voice/voice';

export interface MenuModel { id: string; name: string; tag: string }

/** The model picker at the right of the box row, with its menu opening upwards. */
export const ModelMenu: React.FC<{ model: string; models: MenuModel[]; onModel: (id: string) => void; onOpenModels: () => void; heading?: string; title?: string; onPicked?: () => void }> = ({ model, models, onModel, onOpenModels, heading = 'Chat model', title, onPicked }) => {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <PickerButton open={open} onClick={() => setOpen((o) => !o)} title={title ?? (model ? `Model (${model})` : 'Model')}
        text={model ? prettyModelName(model) : 'Choose a model'}
        chevron={<ChevronDown className={cx('w-3.5 h-3.5 shrink-0 opacity-70 transition-transform', open && 'rotate-180')} />} />
      {open && (
        <div role="listbox" aria-label="Models" className="material-frosted absolute bottom-full right-0 mb-2 w-[300px] max-h-[320px] overflow-y-auto p-1 rounded-[10px] z-30">
          <p className="px-2.5 pt-1.5 pb-1 text-[12px] font-semibold text-[var(--color-text-muted)]">{heading}</p>
          {!models.length && <p className="px-2.5 py-2 text-[12px] text-[var(--color-text-muted)]">No models listed. Start Ollama, or download a model.</p>}
          {models.map((m) => (
            <button key={m.id} type="button" role="option" aria-selected={m.id === model} onClick={() => { onModel(m.id); setOpen(false); onPicked?.(); }}
              className={cx('w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] text-left text-[13px] focus:outline-none focus-visible:bg-[var(--hover)]', m.id === model ? 'bg-[var(--color-accent-pastel)]' : 'hover:bg-[var(--hover)]')}>
              <span className="w-4 shrink-0">{m.id === model && <Check className="w-3.5 h-3.5 text-[var(--color-accent-vibrant)]" />}</span>
              <span className="flex-1 min-w-0 truncate">{m.name}</span>
              <span className="text-[12px] text-[var(--color-text-muted)] shrink-0">{m.tag}</span>
            </button>
          ))}
          <div role="separator" className="my-1 mx-2 h-px bg-[var(--sep)]" />
          <button type="button" onClick={() => { setOpen(false); onOpenModels(); }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] text-left text-[13px] hover:bg-[var(--hover)] focus:outline-none focus-visible:bg-[var(--hover)]">
            <Boxes className="w-3.5 h-3.5 ml-0.5 mr-0.5 text-[var(--color-text-muted)]" />Get more models…
          </button>
        </div>
      )}
    </div>
  );
};

/** Dictation: records, transcribes with local Whisper and hands the words back. */
export const DictateButton: React.FC<{ onText: (said: string) => void; onNotice: (n: string | null) => void; disabled?: boolean }> = ({ onText, onNotice, disabled }) => {
  const [rec, setRec] = useState(false);
  const [busy, setBusy] = useState(false);
  const recorder = useRef<MicRecorder | null>(null);
  useEffect(() => () => recorder.current?.cancel(), []);
  const toggle = async () => {
    onNotice(null);
    if (busy) return;
    if (!rec) {
      try { recorder.current = new MicRecorder(); await recorder.current.start(); setRec(true); } catch (e) { onNotice(micErrorMessage(e)); }
      return;
    }
    setRec(false); setBusy(true);
    try {
      const r = await recorder.current!.stop();
      const said = await transcribe(r.wav);
      if (said) onText(said); else onNotice('Heard nothing. Try again a little closer to the mic.');
    } catch (e) { onNotice((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <button type="button" onClick={() => void toggle()} disabled={disabled} aria-pressed={rec} aria-label={rec ? 'Stop dictation' : busy ? 'Transcribing…' : 'Dictate'} data-tip={rec ? 'Stop dictation' : busy ? 'Transcribing…' : 'Dictate (local Whisper)'}
      className={cx('tip w-8 h-8 inline-flex items-center justify-center rounded-full hover:bg-[var(--hover)] disabled:opacity-40 focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)]', rec ? 'text-[var(--c-red)] animate-pulse' : 'text-[var(--color-text-main)]')}>
      {rec ? <MicOff className="w-[18px] h-[18px]" /> : <Mic className="w-[18px] h-[18px]" />}
    </button>
  );
};

/** Files waiting to be sent, as chips (pictures show a thumbnail), and the drop hint while dragging. */
export const AttachmentChips: React.FC<{ files: File[]; previews: Record<string, string>; drag: boolean; onRemove: (i: number) => void }> = ({ files, previews, drag, onRemove }) => (files.length > 0 || drag) ? (
  <div className="flex flex-wrap gap-2 px-3.5 pt-3" aria-label="Attachments">
    {drag && !files.length && <p className="text-[12px] text-[var(--color-text-muted)] px-1 py-2">Drop images, PDFs, Office documents, text or code files to attach them. You can also paste them.</p>}
    {files.map((f, i) => {
      const url = previews[f.name + f.size];
      return (
        <span key={f.name + i} className="inline-flex items-center gap-1.5 h-8 pl-1.5 pr-1 rounded-[8px] bg-[var(--hover)] text-[12px] max-w-[220px]">
          {url ? <img src={url} alt="" className="w-6 h-6 rounded-[4px] object-cover" /> : <FileText className="w-3.5 h-3.5 ml-1" />}
          <span className="truncate">{f.name}</span>
          <IconBtn label={`Remove ${f.name}`} className="!w-5 !h-5" onClick={() => onRemove(i)}><X className="w-3 h-3" /></IconBtn>
        </span>
      );
    })}
  </div>
) : null;

/** Files plus picture thumbnails, for a prompt box's attach button, paste and drop. */
export function useAttachments() {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const add = (list: FileList | File[]) => {
    const arr = Array.from(list);
    setFiles((f) => [...f, ...arr]);
    arr.filter((f) => f.type.startsWith('image/')).forEach((f) => setPreviews((p) => ({ ...p, [f.name + f.size]: URL.createObjectURL(f) })));
  };
  const remove = (i: number) => setFiles((l) => l.filter((_, j) => j !== i));
  const clear = () => { setFiles([]); setPreviews({}); };
  return { files, previews, add, remove, clear };
}

/** The text field starts one line high and grows with the text up to 200 px. */
export function useAutoGrow(ref: React.RefObject<HTMLTextAreaElement | null>, text: string) {
  useEffect(() => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 200)}px`; } }, [ref, text]);
}
