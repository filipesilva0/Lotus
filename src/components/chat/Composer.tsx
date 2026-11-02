import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Mic, MicOff, Plus, Square, X, FileText, Navigation, AtSign, Brain, Globe, FolderOpen, ChevronDown, Check, Boxes, Puzzle, BookOpen, BrainCircuit, EyeOff, FlaskConical } from 'lucide-react';
import { IconBtn, cx } from '../common/ui';
import { EdgeMeter, ModeButton, SendButton, TrayButton, TrayToggle } from '../common/PromptBox';
import { MicRecorder, micErrorMessage } from '../../lib/audio';
import { voicebox } from '../../services/voicebox';
import { isTauri } from '../../lib/http';

export interface SlashCommand { name: string; args?: string; help: string }
export const SLASH: SlashCommand[] = [
  { name: 'new', help: 'Start a new chat' },
  { name: 'clear', help: 'Clear this conversation' },
  { name: 'incognito', help: 'Toggle incognito for this chat' },
  { name: 'research', args: '<question>', help: 'Start a deep research task (plan, agents, cited report)' },
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
  /** Per-chat memory and incognito (icon-only toggles in the tray under the box). */
  memoryOn: boolean; incognito: boolean; onToggleMemory: () => void; onToggleIncognito: () => void;
  /** Share of the context window in use (0–1): drawn as a thin bar along the top edge of the box. */
  contextUsed: number; contextTitle: string;
  onOpenLibrary: (tab: 'skills' | 'plugins') => void;
  /** Deep research: with the Research toggle on, sending starts a research task with the text as its question. */
  onResearch: (question: string) => void;
  mentions: { id: string; label: string; kind: 'model' | 'file' }[];
  prefill?: { text: string; nonce: number } | null;
  onSend: (text: string, files: File[]) => Promise<string[]> | string[];
  onCommand: (name: string, arg: string) => string | void;
  onStop: () => void;
}

export const Composer: React.FC<Props> = ({ model, streaming, disabled, sendOnEnter, models, onModel, onOpenModels, onAttachFolder, extraCommands = [], thinkingOn, onToggleThinking, webOn, onToggleWeb, memoryOn, incognito, onToggleMemory, onToggleIncognito, contextUsed, contextTitle, onOpenLibrary, onResearch, mentions, prefill, onSend, onCommand, onStop }) => {
  const [text, setText] = useState('');
  const [modelOpen, setModelOpen] = useState(false);
  const [researchMode, setResearchMode] = useState(false);
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
    if (!modelOpen) return;
    const away = (e: MouseEvent) => { if (!bar.current?.contains(e.target as Node)) setModelOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setModelOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [modelOpen]);

  const attachFolder = async (list?: FileList) => {
    setNotice(null); setFolderBusy(true);
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
    if (researchMode) {
      if (t.length < 8) { setNotice('Write the research question in a sentence or two.'); return; }
      onResearch(t); setResearchMode(false); setText(''); return;
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
  const steer = streaming && hasText && !researchMode;
  // Shared prompt-box parts (components/common/PromptBox.tsx), so every page's input looks and works the same.
  const modeBtn = (on: boolean, onClick: () => void, icon: React.ReactNode, label: string, title: string) => <ModeButton on={on} onClick={onClick} icon={icon} label={label} title={title} />;
  const trayBtn = (onClick: () => void, icon: React.ReactNode, label: string, title: string) => <TrayButton onClick={onClick} icon={icon} label={label} title={title} />;
  const trayToggle = (on: boolean, onClick: () => void, icon: React.ReactNode, tip: string, disabled?: boolean) => <TrayToggle on={on} onClick={onClick} icon={icon} tip={tip} disabled={disabled} />;

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

        {/* The box sits on a tray: the tray holds per-chat context actions and the memory / incognito toggles. */}
        <div className="rounded-[24px] bg-[var(--composer-tray)]">
          <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
            className={cx('relative rounded-[24px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep),0_2px_8px_rgba(0,0,0,.06)] transition-shadow', drag && 'shadow-[0_0_0_2px_var(--color-accent-fill)]')}>
            {/* Context used, as a thin bar along the top edge (no text; the numbers are in the tip). */}
            <EdgeMeter value={contextUsed} label="Context used" title={contextTitle} />

            {(files.length > 0 || drag) && (
              <div className="flex flex-wrap gap-2 px-3.5 pt-3" aria-label="Attachments">
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
              aria-label="Message" placeholder={researchMode ? 'What do you want to research? Describe the question in your own words' : streaming ? 'Type to steer the reply…' : `Message ${model || 'Lotus'}`}
              className="w-full resize-none bg-transparent px-4 pt-4 pb-1 text-[14px] leading-relaxed placeholder:text-[var(--color-text-muted)] focus:outline-none" />
            <div ref={bar} className="relative flex items-center gap-1 px-2.5 pb-2.5">
              <input ref={fileInput} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
              {/* Browser preview only: the desktop app uses the system folder dialog. */}
              <input ref={dirInput} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden="true"
                {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                onChange={(e) => { const l = e.target.files; if (l?.length) void attachFolder(l); e.target.value = ''; }} />
              <button type="button" aria-label="Attach files" data-tip="Attach images, text or code" onClick={() => fileInput.current?.click()}
                className="tip w-8 h-8 inline-flex items-center justify-center rounded-full text-[var(--color-text-main)] hover:bg-[var(--hover)] active:bg-[var(--pressed)] focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)]">
                <Plus className="w-[18px] h-[18px]" />
              </button>
              {modeBtn(thinkingOn, onToggleThinking, <Brain className="w-4 h-4" />, 'Think',
                thinkingOn ? 'Thinking on: the model analyses, drafts and checks before answering (slower)' : 'Thinking: analyse, draft and check before answering. Takes longer, answers better.')}
              {modeBtn(webOn, onToggleWeb, <Globe className="w-4 h-4" />, 'Web',
                webOn ? 'Web search on: your question is searched on the web and the top pages are read' : 'Web search: search the current web and read the top pages before answering')}
              {modeBtn(researchMode, () => setResearchMode((v) => !v), <FlaskConical className="w-4 h-4" />, 'Research',
                researchMode ? 'Research on: sending starts a deep research task. Lotus asks a few questions, drafts a plan for you to approve, then searches scholarly sources and writes a cited report.' : 'Deep research: plan, search scholarly sources with parallel agents, and write a cited report')}
              {folderBusy && <span className="ml-1 text-[12px] text-[var(--color-text-muted)] animate-pulse" role="status">Reading folder…</span>}
              <div className="flex-1" />

              {/* Model for this chat, right where you type. */}
              <button type="button" aria-haspopup="listbox" aria-expanded={modelOpen} onClick={() => setModelOpen((o) => !o)}
                title="Model for this chat"
                className={cx('h-8 max-w-[220px] inline-flex items-center gap-1 pl-2.5 pr-2 rounded-full text-[13px] transition-colors duration-100 focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)]',
                  modelOpen ? 'bg-[var(--pressed)] text-[var(--color-text-main)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--hover)] hover:text-[var(--color-text-main)]')}>
                <span className="truncate">{model || 'Choose a model'}</span>
                <ChevronDown className={cx('w-3.5 h-3.5 shrink-0 opacity-70 transition-transform', modelOpen && 'rotate-180')} />
              </button>
              {modelOpen && (
                <div role="listbox" aria-label="Models" className="material-frosted absolute bottom-full right-2 mb-2 w-[300px] max-h-[320px] overflow-y-auto p-1 rounded-[10px] z-30">
                  <p className="px-2.5 pt-1.5 pb-1 text-[12px] font-semibold text-[var(--color-text-muted)]">Chat model</p>
                  {!models.length && <p className="px-2.5 py-2 text-[12px] text-[var(--color-text-muted)]">No models listed. Start Ollama, or download a model.</p>}
                  {models.map((m) => (
                    <button key={m.id} type="button" role="option" aria-selected={m.id === model} onClick={() => { onModel(m.id); setModelOpen(false); ta.current?.focus(); }}
                      className={cx('w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] text-left text-[13px] focus:outline-none focus-visible:bg-[var(--hover)]', m.id === model ? 'bg-[var(--color-accent-pastel)]' : 'hover:bg-[var(--hover)]')}>
                      <span className="w-4 shrink-0">{m.id === model && <Check className="w-3.5 h-3.5 text-[var(--color-accent-vibrant)]" />}</span>
                      <span className="flex-1 min-w-0 truncate">{m.name}</span>
                      <span className="text-[12px] text-[var(--color-text-muted)] shrink-0">{m.tag}</span>
                    </button>
                  ))}
                  <div role="separator" className="my-1 mx-2 h-px bg-[var(--sep)]" />
                  <button type="button" onClick={() => { setModelOpen(false); onOpenModels(); }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] text-left text-[13px] hover:bg-[var(--hover)] focus:outline-none focus-visible:bg-[var(--hover)]">
                    <Boxes className="w-3.5 h-3.5 ml-0.5 mr-0.5 text-[var(--color-text-muted)]" />Get more models…
                  </button>
                </div>
              )}
              <button type="button" onClick={toggleMic} aria-pressed={rec} aria-label={rec ? 'Stop dictation' : busyMic ? 'Transcribing…' : 'Dictate'} data-tip={rec ? 'Stop dictation' : busyMic ? 'Transcribing…' : 'Dictate (local Whisper)'}
                className={cx('tip w-8 h-8 inline-flex items-center justify-center rounded-full hover:bg-[var(--hover)] focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)]', rec ? 'text-[var(--c-red)] animate-pulse' : 'text-[var(--color-text-main)]')}>
                {rec ? <MicOff className="w-[18px] h-[18px]" /> : <Mic className="w-[18px] h-[18px]" />}
              </button>
              {streaming && !steer
                ? <SendButton stop onClick={onStop} label="Stop the reply" />
                : <SendButton disabled={!hasText || disabled} onClick={() => void submit()} label={steer ? 'Steer the reply' : 'Send'}
                    tip={steer ? 'Steer: stop the reply here and continue from your message' : sendOnEnter ? 'Send (Enter)' : 'Send (Ctrl+Enter)'}
                    icon={steer ? <Navigation className="w-4 h-4" /> : undefined} />}
            </div>
          </div>

          <div className="h-10 flex items-center gap-0.5 px-3">
            {trayBtn(() => { if (isTauri) void attachFolder(); else dirInput.current?.click(); }, <FolderOpen className="w-4 h-4" />, 'Choose Folder', "Attach a folder: its text and code files join this chat's context")}
            {trayBtn(() => onOpenLibrary('skills'), <BookOpen className="w-4 h-4" />, 'Library', 'The skills, memory and soul Lotus uses')}
            {trayBtn(() => onOpenLibrary('plugins'), <Puzzle className="w-4 h-4" />, 'Plugins', 'Your plugins and their / commands')}
            <div className="flex-1" />
            {trayToggle(memoryOn, onToggleMemory, <BrainCircuit className="w-4 h-4" />,
              incognito ? 'Memory: incognito chats never use it' : memoryOn ? 'Memory on: recalls and keeps learning. Click to pause it for this chat' : 'Memory paused for this chat. Click to resume', incognito)}
            {trayToggle(incognito, onToggleIncognito, <EyeOff className="w-4 h-4" />,
              incognito ? "Incognito on: this chat isn't saved and creates no memories" : "Incognito: don't save this chat or create memories")}
          </div>
        </div>
      </div>
    </div>
  );
};
