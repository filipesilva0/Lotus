import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Mic, MicOff, Plus, Square, X, FileText, Navigation, AtSign, Brain, Globe, FolderPlus, Paperclip, ChevronDown, Check, Boxes, Puzzle } from 'lucide-react';
import { Btn, IconBtn, cx } from '../common/ui';
import { MicRecorder, micErrorMessage } from '../../lib/audio';
import { voicebox } from '../../services/voicebox';
import { isTauri } from '../../lib/http';

export interface SlashCommand { name: string; args?: string; help: string }
export const SLASH: SlashCommand[] = [
  { name: 'new', help: 'Start a new chat' },
  { name: 'clear', help: 'Clear this conversation' },
  { name: 'incognito', help: 'Toggle incognito for this chat' },
  { name: 'search', help: 'Toggle searching academic sources before answering' },
  { name: 'think', help: 'Toggle Thinking mode (slower, more careful answers)' },
  { name: 'web', help: 'Toggle searching the web before answering' },
  { name: 'memory', help: 'Turn memory on or off for this chat' },
  { name: 'model', args: '<name>', help: 'Switch the model' },
  { name: 'temp', args: '<0–2>', help: 'Set temperature' },
  { name: 'seed', args: '<number|off>', help: 'Lock or unlock the seed' },
  { name: 'system', args: '<text>', help: 'Change the system prompt' },
  { name: 'pin', help: 'Pin or unpin this chat' },
  { name: 'plugins', help: 'Open your plugins (create one with Lotus)' },
  { name: 'library', help: 'Read the skills, memory and soul Lotus uses' },
];

export interface ComposerModel { id: string; name: string; tag: string }
/** A slash command added by a plugin (shown with the built-ins). */
export interface ExtraCommand { name: string; args?: string; help: string }

interface Props {
  model: string; streaming: boolean; disabled?: boolean; sendOnEnter: boolean;
  /** Installed models for the picker in the composer. */
  models: ComposerModel[]; onModel: (id: string) => void; onOpenModels: () => void;
  /** Desktop: opens the folder dialog; returns a notice to show. Browser: the composer reads the picked files itself. */
  onAttachFolder: (files?: FileList) => Promise<string | void>;
  extraCommands?: ExtraCommand[];
  thinkingOn: boolean; onToggleThinking: () => void;
  webOn: boolean; onToggleWeb: () => void;
  mentions: { id: string; label: string; kind: 'model' | 'file' }[];
  prefill?: { text: string; nonce: number } | null;
  onSend: (text: string, files: File[]) => Promise<string[]> | string[];
  onCommand: (name: string, arg: string) => string | void;
  onStop: () => void;
}

export const Composer: React.FC<Props> = ({ model, streaming, disabled, sendOnEnter, models, onModel, onOpenModels, onAttachFolder, extraCommands = [], thinkingOn, onToggleThinking, webOn, onToggleWeb, mentions, prefill, onSend, onCommand, onStop }) => {
  const [text, setText] = useState('');
  const [plusOpen, setPlusOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [folderBusy, setFolderBusy] = useState(false);
  const dirInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const bar = useRef<HTMLDivElement>(null);
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
  useEffect(() => {
    if (!plusOpen && !modelOpen) return;
    const away = (e: MouseEvent) => { if (!bar.current?.contains(e.target as Node)) { setPlusOpen(false); setModelOpen(false); } };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPlusOpen(false); setModelOpen(false); } };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [plusOpen, modelOpen]);

  const attachFolder = async (list?: FileList) => {
    setPlusOpen(false); setNotice(null); setFolderBusy(true);
    try { const r = await onAttachFolder(list); if (r) setNotice(r); }
    catch (e) { setNotice(`Couldn't read that folder. ${(e as Error).message ?? e}`); }
    finally { setFolderBusy(false); }
  };
  useEffect(() => { const el = ta.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 200)}px`; } }, [text]);

  // Slash menu: shown while the text is "/word" with no space yet. @ menu: shown for a trailing "@word".
  const slashQ = /^\/(\w*)$/.exec(text)?.[1];
  const atQ = /(?:^|\s)@([\w.\-:]*)$/.exec(text)?.[1];
  const commands = useMemo(() => [...SLASH, ...extraCommands.filter((c) => !SLASH.some((b) => b.name === c.name))], [extraCommands]);
  const slashItems = useMemo(() => (slashQ === undefined ? [] : commands.filter((c) => c.name.startsWith(slashQ.toLowerCase()))), [slashQ, commands]);
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
    if (cmd && commands.some((c) => c.name === cmd[1].toLowerCase())) {
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
                {!SLASH.some((b) => b.name === c.name) && <Puzzle className="w-3 h-3 self-center shrink-0 opacity-70" aria-label="Plugin command" />}<span className="font-medium">/{c.name}</span>{c.args && <span className="opacity-70 text-[12px]">{c.args}</span>}<span className="ml-auto text-[12px] opacity-70 truncate">{c.help}</span>
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
          <div ref={bar} className="relative flex items-center gap-1 px-2 pb-2">
            <input ref={fileInput} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
            {/* Browser preview only: the desktop app uses the system folder dialog. */}
            <input ref={dirInput} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden="true"
              {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
              onChange={(e) => { const l = e.target.files; if (l?.length) void attachFolder(l); e.target.value = ''; }} />
            <IconBtn label="Add files or a folder" aria-haspopup="menu" aria-expanded={plusOpen} active={plusOpen} onClick={() => { setPlusOpen((o) => !o); setModelOpen(false); }}>
              <Plus className={cx('w-4 h-4 transition-transform duration-150', plusOpen && 'rotate-45')} />
            </IconBtn>
            {plusOpen && (
              <div role="menu" aria-label="Add to chat" className="material-frosted absolute bottom-full left-1 mb-2 w-[260px] p-1 rounded-[10px] z-30">
                <button type="button" role="menuitem" onClick={() => { setPlusOpen(false); fileInput.current?.click(); }}
                  className="w-full flex items-start gap-2.5 px-2.5 py-2 rounded-[6px] text-left hover:bg-[var(--hover)] focus:outline-none focus-visible:bg-[var(--hover)]">
                  <Paperclip className="w-4 h-4 mt-0.5 text-[var(--petal-blue)]" /><span className="flex flex-col"><span className="text-[13px] font-medium">Attach files</span><span className="text-[12px] text-[var(--color-text-muted)]">Images, text and code</span></span>
                </button>
                <button type="button" role="menuitem" onClick={() => { if (isTauri) void attachFolder(); else { setPlusOpen(false); dirInput.current?.click(); } }}
                  className="w-full flex items-start gap-2.5 px-2.5 py-2 rounded-[6px] text-left hover:bg-[var(--hover)] focus:outline-none focus-visible:bg-[var(--hover)]">
                  <FolderPlus className="w-4 h-4 mt-0.5 text-[var(--petal-orange)]" /><span className="flex flex-col"><span className="text-[13px] font-medium">Attach a folder</span><span className="text-[12px] text-[var(--color-text-muted)]">Its text and code files join this chat's context</span></span>
                </button>
              </div>
            )}
            <span className="w-px h-4 mx-1 bg-[var(--sep)]" aria-hidden="true" />
            <Btn size="sm" variant={thinkingOn ? 'primary' : 'ghost'} aria-pressed={thinkingOn} icon={<Brain className="w-3.5 h-3.5" />} onClick={onToggleThinking}
              title={thinkingOn ? 'Thinking on: the model analyses, drafts and checks before answering (slower)' : 'Thinking: analyse, draft and check before answering. Takes longer, answers better.'}>Think</Btn>
            <Btn size="sm" variant={webOn ? 'primary' : 'ghost'} aria-pressed={webOn} icon={<Globe className="w-3.5 h-3.5" />} onClick={onToggleWeb}
              title={webOn ? 'Web search on: your question is searched on the web and the top pages are read' : 'Web search: search the current web and read the top pages before answering'}>Web</Btn>
            <IconBtn label={rec ? 'Stop dictation' : busyMic ? 'Transcribing…' : 'Dictate (local Whisper)'} active={rec} onClick={toggleMic} className={rec ? '!text-[var(--c-red)] animate-pulse' : ''}>{rec ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}</IconBtn>
            {folderBusy && <span className="ml-1 text-[12px] text-[var(--color-text-muted)] animate-pulse" role="status">Reading folder…</span>}
            <div className="flex-1" />

            {/* Model for this chat, right where you type (like the reference composer). */}
            <button type="button" aria-haspopup="listbox" aria-expanded={modelOpen} onClick={() => { setModelOpen((o) => !o); setPlusOpen(false); }}
              title="Model for this chat"
              className={cx('h-7 max-w-[220px] inline-flex items-center gap-1.5 pl-2 pr-1.5 rounded-[8px] text-[12px] font-medium transition-colors duration-100 focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)]',
                modelOpen ? 'bg-[var(--pressed)] text-[var(--color-text-main)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--hover)] hover:text-[var(--color-text-main)]')}>
              <span aria-hidden="true" className="w-2 h-2 rounded-full shrink-0 bg-[var(--petal-green)]" style={{ background: model ? undefined : 'var(--color-text-muted)' }} />
              <span className="truncate">{model || 'Choose a model'}</span>
              <ChevronDown className={cx('w-3.5 h-3.5 shrink-0 opacity-70 transition-transform', modelOpen && 'rotate-180')} />
            </button>
            {modelOpen && (
              <div role="listbox" aria-label="Models" className="material-frosted absolute bottom-full right-2 mb-2 w-[300px] max-h-[320px] overflow-y-auto p-1 rounded-[10px] z-30">
                <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-[.04em] text-[var(--color-text-muted)]">Chat model</p>
                {!models.length && <p className="px-2.5 py-2 text-[12px] text-[var(--color-text-muted)]">No models listed. Start Ollama, or download a model.</p>}
                {models.map((m) => (
                  <button key={m.id} type="button" role="option" aria-selected={m.id === model} onClick={() => { onModel(m.id); setModelOpen(false); ta.current?.focus(); }}
                    className={cx('w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] text-left text-[13px] focus:outline-none focus-visible:bg-[var(--hover)]', m.id === model ? 'bg-[var(--color-accent-pastel)]' : 'hover:bg-[var(--hover)]')}>
                    <span className="w-4 shrink-0">{m.id === model && <Check className="w-3.5 h-3.5 text-[var(--color-accent-vibrant)]" />}</span>
                    <span className="flex-1 min-w-0 truncate">{m.name}</span>
                    <span className="text-[11px] text-[var(--color-text-muted)] shrink-0">{m.tag}</span>
                  </button>
                ))}
                <div role="separator" className="my-1 mx-2 h-px bg-[var(--sep)]" />
                <button type="button" onClick={() => { setModelOpen(false); onOpenModels(); }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] text-left text-[13px] hover:bg-[var(--hover)] focus:outline-none focus-visible:bg-[var(--hover)]">
                  <Boxes className="w-3.5 h-3.5 ml-0.5 mr-0.5 text-[var(--color-text-muted)]" />Get more models…
                </button>
              </div>
            )}
            {streaming && !steer ? (
              <Btn variant="secondary" icon={<Square className="w-3 h-3" fill="currentColor" />} onClick={onStop}>Stop</Btn>
            ) : (
              <Btn variant="primary" disabled={!hasText || disabled} onClick={() => void submit()} aria-label={steer ? 'Steer the reply' : 'Send'} icon={steer ? <Navigation className="w-3.5 h-3.5" /> : <ArrowUp className="w-3.5 h-3.5" />}>{steer ? 'Steer' : 'Send'}</Btn>
            )}
          </div>
        </div>
        <p className="mt-1.5 text-center text-[11px] text-[var(--color-text-muted)]">{streaming ? 'Sending now stops the reply here and continues from your new message.' : `${sendOnEnter ? 'Enter to send · Shift+Enter for a new line' : 'Ctrl+Enter to send · Enter for a new line'} · Markdown supported`}</p>
      </div>
    </div>
  );
};
