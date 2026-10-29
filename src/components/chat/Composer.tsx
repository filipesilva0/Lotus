import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Mic, MicOff, Paperclip, Square, X, FileText, Search, Navigation, AtSign } from 'lucide-react';
import { Btn, IconBtn, cx } from '../common/ui';
import { MicRecorder, micErrorMessage } from '../../lib/audio';
import { voicebox } from '../../services/voicebox';

export interface SlashCommand { name: string; args?: string; help: string }
export const SLASH: SlashCommand[] = [
  { name: 'new', help: 'Start a new chat' },
  { name: 'clear', help: 'Clear this conversation' },
  { name: 'incognito', help: 'Toggle incognito for this chat' },
  { name: 'search', help: 'Toggle searching academic sources before answering' },
  { name: 'model', args: '<name>', help: 'Switch the model' },
  { name: 'temp', args: '<0–2>', help: 'Set temperature' },
  { name: 'seed', args: '<number|off>', help: 'Lock or unlock the seed' },
  { name: 'system', args: '<text>', help: 'Change the system prompt' },
  { name: 'pin', help: 'Pin or unpin this chat' },
];

interface Props {
  model: string; streaming: boolean; disabled?: boolean; sendOnEnter: boolean;
  searchOn: boolean; onToggleSearch: () => void;
  mentions: { id: string; label: string; kind: 'model' | 'file' }[];
  prefill?: { text: string; nonce: number } | null;
  onSend: (text: string, files: File[]) => Promise<string[]> | string[];
  onCommand: (name: string, arg: string) => string | void;
  onStop: () => void;
}

export const Composer: React.FC<Props> = ({ model, streaming, disabled, sendOnEnter, searchOn, onToggleSearch, mentions, prefill, onSend, onCommand, onStop }) => {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [sel, setSel] = useState(0);
  const [rec, setRec] = useState(false);
  const [busyMic, setBusyMic] = useState(false);
  const recorder = useRef<MicRecorder | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (prefill?.text) setText((p) => (p ? `${p} ${prefill.text}` : prefill.text)); }, [prefill?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => recorder.current?.cancel(), []);
  useEffect(() => { const el = ta.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 200)}px`; } }, [text]);

  // Slash menu: shown while the text is "/word" with no space yet. @ menu: shown for a trailing "@word".
  const slashQ = /^\/(\w*)$/.exec(text)?.[1];
  const atQ = /(?:^|\s)@([\w.\-:]*)$/.exec(text)?.[1];
  const slashItems = useMemo(() => (slashQ === undefined ? [] : SLASH.filter((c) => c.name.startsWith(slashQ.toLowerCase()))), [slashQ]);
  const atItems = useMemo(() => (atQ === undefined ? [] : mentions.filter((m) => m.label.toLowerCase().includes(atQ.toLowerCase())).slice(0, 8)), [atQ, mentions]);
  const menu = slashItems.length ? 'slash' : atItems.length ? 'at' : null;
  useEffect(() => setSel(0), [menu, slashQ, atQ]);

  const addFiles = (list: FileList | File[]) => {
    const arr = Array.from(list);
    setFiles((f) => [...f, ...arr]);
    arr.filter((f) => f.type.startsWith('image/')).forEach((f) => setPreviews((p) => ({ ...p, [f.name + f.size]: URL.createObjectURL(f) })));
  };

  const pick = (i: number) => {
    if (menu === 'slash') { const c = slashItems[i]; setText(`/${c.name}${c.args ? ' ' : ''}`); if (!c.args) { /* run on Enter */ } }
    if (menu === 'at') { const m = atItems[i]; setText((t) => t.replace(/@[\w.\-:]*$/, `@${m.label} `)); }
    ta.current?.focus();
  };

  const submit = async () => {
    const t = text.trim();
    if (!t && !files.length) return;
    setNotice(null);
    const cmd = /^\/(\w+)\s*(.*)$/s.exec(t);
    if (cmd && SLASH.some((c) => c.name === cmd[1].toLowerCase())) {
      const r = onCommand(cmd[1].toLowerCase(), cmd[2].trim());
      if (r) setNotice(r);
      setText(''); return;
    }
    const errs = await onSend(t, files);
    if (errs.length) setNotice(errs.join(' '));
    setText(''); setFiles([]); setPreviews({});
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (menu) {
      const n = menu === 'slash' ? slashItems.length : atItems.length;
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % n); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + n) % n); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && menu === 'at') || (e.key === 'Enter' && menu === 'slash' && slashItems[sel]?.args)) { e.preventDefault(); pick(sel); return; }
      if (e.key === 'Escape') { setText((t) => t.replace(/[/@][\w.\-:]*$/, '')); return; }
      if (e.key === 'Enter' && menu === 'slash') { e.preventDefault(); setText(`/${slashItems[sel].name}`); setTimeout(() => void submit(), 0); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      const go = sendOnEnter ? true : e.ctrlKey || e.metaKey;
      if (go) { e.preventDefault(); void submit(); }
    }
  };

  const toggleMic = async () => {
    setNotice(null);
    if (busyMic) return;
    if (!rec) {
      try { recorder.current = new MicRecorder(); await recorder.current.start(); setRec(true); } catch (e) { setNotice(micErrorMessage(e)); }
      return;
    }
    setRec(false); setBusyMic(true);
    try {
      const r = await recorder.current!.stop();
      const t = await voicebox.transcribe(r.wav);
      if (t.text.trim()) setText((p) => (p ? `${p} ${t.text.trim()}` : t.text.trim())); else setNotice('Heard nothing. Try again a little closer to the mic.');
    } catch (e) { setNotice((e as Error).message); } finally { setBusyMic(false); }
  };

  const hasText = text.trim().length > 0 || files.length > 0;
  const steer = streaming && hasText;

  return (
    <div className="px-6 pb-4 pt-2 shrink-0">
      <div className="max-w-[760px] mx-auto relative">
        {menu && (
          <div role="listbox" aria-label={menu === 'slash' ? 'Commands' : 'Mentions'} className="absolute bottom-full mb-2 left-0 w-[360px] max-h-60 overflow-y-auto p-1 rounded-[10px] material-overlay z-20">
            {menu === 'slash' ? slashItems.map((c, i) => (
              <button key={c.name} role="option" aria-selected={i === sel} type="button" onMouseDown={(e) => { e.preventDefault(); pick(i); }}
                className={cx('w-full flex items-baseline gap-2 px-2.5 py-1.5 rounded-[6px] text-left text-[13px]', i === sel && 'bg-[var(--color-accent-fill)] text-white')}>
                <span className="font-medium">/{c.name}</span>{c.args && <span className="opacity-70 text-[12px]">{c.args}</span>}<span className="ml-auto text-[12px] opacity-70 truncate">{c.help}</span>
              </button>
            )) : atItems.map((m, i) => (
              <button key={m.kind + m.id} role="option" aria-selected={i === sel} type="button" onMouseDown={(e) => { e.preventDefault(); pick(i); }}
                className={cx('w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] text-left text-[13px]', i === sel && 'bg-[var(--color-accent-fill)] text-white')}>
                {m.kind === 'file' ? <FileText className="w-3.5 h-3.5" /> : <AtSign className="w-3.5 h-3.5" />}<span className="truncate">{m.label}</span><span className="ml-auto text-[12px] opacity-70">{m.kind === 'file' ? 'mounted file' : 'model for this message'}</span>
              </button>
            ))}
          </div>
        )}

        {notice && <p role="alert" className="mb-2 px-1 text-[12px] text-[var(--c-red)]">{notice}</p>}

        <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
          className={cx('rounded-[12px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep),var(--shadow-1)] transition-shadow', drag && 'shadow-[0_0_0_2px_var(--color-accent-fill)]')}>
          {(files.length > 0 || drag) && (
            <div className="flex flex-wrap gap-2 p-2.5 pb-0" aria-label="Attachments">
              {drag && !files.length && <p className="text-[12px] text-[var(--color-text-muted)] px-1 py-2">Drop images, text or code files to attach them.</p>}
              {files.map((f, i) => {
                const url = previews[f.name + f.size];
                return (
                  <span key={f.name + i} className="inline-flex items-center gap-1.5 h-8 pl-1.5 pr-1 rounded-[8px] bg-[var(--hover)] text-[12px] max-w-[220px]">
                    {url ? <img src={url} alt="" className="w-6 h-6 rounded-[4px] object-cover" /> : <FileText className="w-3.5 h-3.5 ml-1" />}
                    <span className="truncate">{f.name}</span>
                    <IconBtn label={`Remove ${f.name}`} className="!w-5 !h-5" onClick={() => setFiles((l) => l.filter((_, j) => j !== i))}><X className="w-3 h-3" /></IconBtn>
                  </span>
                );
              })}
            </div>
          )}
          <textarea ref={ta} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} rows={1} disabled={disabled}
            aria-label="Message" placeholder={streaming ? 'Type to steer the reply…' : `Message ${model || 'a model'} — / for commands, @ to mention`}
            className="w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[14px] leading-relaxed placeholder:text-[var(--color-text-muted)] focus:outline-none" />
          <div className="flex items-center gap-1 px-2 pb-2">
            <label className="w-7 h-7 inline-flex items-center justify-center rounded-[6px] text-[var(--color-text-muted)] hover:bg-[var(--hover)] cursor-default" title="Attach images, text or code files">
              <input type="file" multiple className="sr-only" aria-label="Attach files" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
              <Paperclip className="w-4 h-4" />
            </label>
            <IconBtn label={searchOn ? 'Source search on: sends keywords to arXiv, PubMed and OpenAlex' : 'Search academic sources before answering'} active={searchOn} onClick={onToggleSearch}><Search className="w-4 h-4" /></IconBtn>
            <IconBtn label={rec ? 'Stop dictation' : busyMic ? 'Transcribing…' : 'Dictate (local Whisper)'} active={rec} onClick={toggleMic} className={rec ? '!text-[var(--c-red)] animate-pulse' : ''}>{rec ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}</IconBtn>
            <div className="flex-1" />
            {streaming && !steer ? (
              <Btn variant="secondary" icon={<Square className="w-3 h-3" fill="currentColor" />} onClick={onStop}>Stop</Btn>
            ) : (
              <Btn variant="primary" disabled={!hasText || disabled} onClick={() => void submit()} aria-label={steer ? 'Steer the reply' : 'Send'} icon={steer ? <Navigation className="w-3.5 h-3.5" /> : <ArrowUp className="w-3.5 h-3.5" />}>{steer ? 'Steer' : 'Send'}</Btn>
            )}
          </div>
        </div>
        <p className="mt-1.5 text-center text-[11px] text-[var(--color-text-muted)]">{streaming ? 'Sending now stops the reply here and continues from your new message.' : sendOnEnter ? 'Enter to send · Shift+Enter for a new line' : 'Ctrl+Enter to send · Enter for a new line'}</p>
      </div>
    </div>
  );
};
