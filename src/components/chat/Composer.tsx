import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X, FileText, Navigation, AtSign, Brain, Globe, FolderOpen, Puzzle, BookOpen, BrainCircuit, EyeOff, FlaskConical } from 'lucide-react';
import { IconBtn, cx } from '../common/ui';
import { EdgeMeter, ModeButton, PromptRow, PromptShell, PromptText, RoundIcon, SendButton, TrayButton, TrayRow, TrayToggle } from '../common/PromptBox';
import { AttachmentChips, DictateButton, ModelMenu, useAttachments, useAutoGrow } from '../common/PromptParts';
import { useAssistantName } from '../../lib/identity';
import { isTauri } from '../../lib/http';
import { folderName } from '../../chat/folder';
import { useFileIntake } from '../../lib/fileDrop';
import { attachWithDialog } from '../../lib/pickFiles';

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
  /** The folder Lotus may read and edit for this chat (desktop), and how to take it away. */
  folder?: string | null; onClearFolder?: () => void;
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

export const Composer: React.FC<Props> = ({ model, streaming, disabled, sendOnEnter, models, onModel, onOpenModels, onAttachFolder, folder, onClearFolder, extraCommands = [], thinkingOn, onToggleThinking, webOn, onToggleWeb, memoryOn, incognito, onToggleMemory, onToggleIncognito, contextUsed, contextTitle, onOpenLibrary, onResearch, mentions, prefill, onSend, onCommand, onStop }) => {
  const [text, setText] = useState('');
  const name = useAssistantName();
  const [researchMode, setResearchMode] = useState(false);
  const [folderBusy, setFolderBusy] = useState(false);
  const dirInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const att = useAttachments();
  const files = att.files;
  const [notice, setNotice] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (prefill?.text) setText((p) => (p ? `${p} ${prefill.text}` : prefill.text)); }, [prefill?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const attachFolder = async (list?: FileList) => {
    setNotice(null); setFolderBusy(true);
    try { const r = await onAttachFolder(list); if (r) setNotice(r); }
    catch (e) { setNotice(`Couldn't read that folder. ${(e as Error).message ?? e}`); }
    finally { setFolderBusy(false); }
  };
  useAutoGrow(ta, text);

  // Slash menu: shown while the text is "/word" with no space yet. @ menu: shown for a trailing "@word".
  const slashQ = /^\/(\w*)$/.exec(text)?.[1];
  const atQ = /(?:^|\s)@([\w.\-:]*)$/.exec(text)?.[1];
  const commands = useMemo(() => [...SLASH, ...extraCommands.filter((c) => !SLASH.some((b) => b.name === c.name))], [extraCommands]);
  const slashItems = useMemo(() => (slashQ === undefined ? [] : commands.filter((c) => c.name.startsWith(slashQ.toLowerCase()))), [slashQ, commands]);
  const atItems = useMemo(() => (atQ === undefined ? [] : mentions.filter((m) => m.label.toLowerCase().includes(atQ.toLowerCase())).slice(0, 8)), [atQ, mentions]);
  const menu = slashItems.length ? 'slash' : atItems.length ? 'at' : null;
  useEffect(() => setSel(0), [menu, slashQ, atQ]);

  const addFiles = att.add;
  // Drop files anywhere on the Chat page, or paste them (Ctrl/Cmd+V): all of them are attached.
  const drag = useFileIntake(addFiles, { enabled: !disabled });

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
    setText(''); att.clear();
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


  const hasText = text.trim().length > 0 || files.length > 0;
  const steer = streaming && hasText && !researchMode;
  // Shared prompt-box parts (components/common/PromptBox.tsx), so every page's input looks and works the same.
  const modeBtn = (on: boolean, onClick: () => void, icon: React.ReactNode, label: string, title: string) => <ModeButton on={on} onClick={onClick} icon={icon} label={label} title={title} />;
  const trayBtn = (onClick: () => void, icon: React.ReactNode, label: string, title: string) => <TrayButton onClick={onClick} icon={icon} label={label} title={title} />;
  // These sit at the right end of the box: their tips open to the left so they aren't cut off.
  const trayToggle = (on: boolean, onClick: () => void, icon: React.ReactNode, tip: string, disabled?: boolean) => <TrayToggle on={on} onClick={onClick} icon={icon} tip={tip} disabled={disabled} align="end" />;

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
        <PromptShell drag={drag} tray={<TrayRow
          actions={<>
            {folder ? (
              <span className="h-7 inline-flex items-center gap-1.5 pl-2 pr-0.5 rounded-[8px] bg-[var(--color-accent-pastel)] text-[var(--color-accent-vibrant)] text-[13px] max-w-[220px]" title={`${name} can read and edit files in ${folder} (saving asks first)`}>
                <FolderOpen className="w-4 h-4 shrink-0" /><span className="truncate">{folderName(folder)}</span>
                <IconBtn label="Stop using this folder" className="!w-6 !h-6" onClick={() => onClearFolder?.()}><X className="w-3 h-3" /></IconBtn>
              </span>
            ) : trayBtn(() => { if (isTauri) void attachFolder(); else dirInput.current?.click(); }, <FolderOpen className="w-4 h-4" />, 'Choose Folder', isTauri ? `Let ${name} work in a folder: it opens, searches and edits the files it needs (saving asks first)` : "Attach a folder: its text and code files join this chat's context")}
            {trayBtn(() => onOpenLibrary('skills'), <BookOpen className="w-4 h-4" />, 'Skills', `The skills, memory and soul ${name} uses (Assistant page)`)}
            {trayBtn(() => onOpenLibrary('plugins'), <Puzzle className="w-4 h-4" />, 'Plugins', 'Your plugins and their / commands')}
          </>}
          status={<>
            {trayToggle(memoryOn, onToggleMemory, <BrainCircuit className="w-4 h-4" />,
              incognito ? 'Memory is off in incognito chats' : memoryOn ? 'Memory on · click to pause for this chat' : 'Memory paused · click to resume', incognito)}
            {trayToggle(incognito, onToggleIncognito, <EyeOff className="w-4 h-4" />,
              incognito ? 'Incognito on · not saved, no memories' : 'Incognito · don’t save this chat')}
          </>} />}>
            {/* Context used, as a thin bar along the top edge (no text; the numbers are in the tip). */}
            <EdgeMeter value={contextUsed} label="Context used" title={contextTitle} />

            <AttachmentChips files={files} previews={att.previews} drag={drag} onRemove={att.remove} />
            <PromptText ref={ta} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} rows={1} disabled={disabled}
              aria-label="Message" placeholder={researchMode ? 'What do you want to research? Describe the question in your own words' : streaming ? 'Type to steer the reply…' : `Message ${name}`} />
            <PromptRow
              attach={<>
              <input ref={fileInput} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
              {/* Browser preview only: the desktop app uses the system folder dialog. */}
              <input ref={dirInput} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden="true"
                {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                onChange={(e) => { const l = e.target.files; if (l?.length) void attachFolder(l); e.target.value = ''; }} />
              <RoundIcon label="Attach files" tip="Attach images, PDFs, documents, spreadsheets, text or code (or paste or drop them)" onClick={() => void attachWithDialog(addFiles, () => fileInput.current?.click(), setNotice)}><Plus className="w-[18px] h-[18px]" /></RoundIcon>
              </>}
              chips={<>
              {modeBtn(thinkingOn, onToggleThinking, <Brain className="w-4 h-4" />, 'Think',
                thinkingOn ? 'Thinking on: the model analyses, drafts and checks before answering (slower)' : 'Thinking: analyse, draft and check before answering. Takes longer, answers better.')}
              {modeBtn(webOn, onToggleWeb, <Globe className="w-4 h-4" />, 'Web',
                webOn ? 'Web search on: when a message needs current facts, Lotus searches the web (using the whole conversation) and reads the top pages' : 'Web search: search the current web and read the top pages before answering')}
              {modeBtn(researchMode, () => setResearchMode((v) => !v), <FlaskConical className="w-4 h-4" />, 'Research',
                researchMode ? 'Research on: sending starts a deep research task. Lotus asks a few questions, drafts a plan for you to approve, then searches scholarly sources and writes a cited report.' : 'Deep research: plan, search scholarly sources with parallel agents, and write a cited report')}
              {folderBusy && <span className="ml-1 text-[12px] text-[var(--color-text-muted)] animate-pulse" role="status">Reading folder…</span>}
              </>}
              picker={<ModelMenu model={model} models={models} onModel={onModel} onOpenModels={onOpenModels} title={model ? `Model for this chat (${model})` : 'Model for this chat'} onPicked={() => ta.current?.focus()} />}
              mic={<DictateButton onText={(said) => setText((p) => (p ? `${p} ${said}` : said))} onNotice={setNotice} />}
              send={streaming && !steer
                ? <SendButton stop onClick={onStop} label="Stop the reply" />
                : <SendButton disabled={!hasText || disabled} onClick={() => void submit()} label={steer ? 'Steer the reply' : 'Send'}
                    tip={steer ? 'Steer: stop the reply here and continue from your message' : sendOnEnter ? 'Send (Enter)' : 'Send (Ctrl+Enter)'}
                    icon={steer ? <Navigation className="w-4 h-4" /> : undefined} />} />
        </PromptShell>
      </div>
    </div>
  );
};
