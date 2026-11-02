import React, { useEffect, useMemo, useRef, useState } from 'react';
import { offerUndo, flushUndo } from '../common/Alerts';
import { EngineNotice } from '../common/EngineNotice';
import { BrainCircuit, EyeOff, Sparkles } from 'lucide-react';
import { useProjectContext } from '../../context/discover';
import { hardware, useHardware } from '../../hardware/monitor';
import { LotusSettings } from '../../types/lotus';
import { useChat, memoryOnFor } from '../../hooks/useChat';
import { Banner, Btn, Empty } from '../common/ui';
import { usePanels } from '../../lib/panels';
import { ChatSidebar } from '../chat/ChatSidebar';
import { ChatStream } from '../chat/ChatStream';
import { Composer } from '../chat/Composer';
import { ChatInspector, InspectorTab } from '../chat/ChatInspector';
import { contextItemFromText, estimateTokens, contextTokens, TEXT_EXT } from '../../chat/helpers';
import { usePersisted } from '../../lib/persist';
import { engineUrl } from '../../services/engineConfig';
import { folderSummary, folderToContext, pickAndReadFolder, readPickedFiles } from '../../chat/folder';
import { expandCommand, pluginCommands, usePlugins } from '../../plugins/store';
import type { LibraryTab } from '../library/LibrarySheet';
import type { ResearchApi } from '../../research/store';
import { ResearchView } from '../research/ResearchWorkspace';

export interface ModelOption { id: string; name: string; tag: string }

interface Props {
  chat: ReturnType<typeof useChat>;
  settings: LotusSettings; onSettings: (p: Partial<LotusSettings>) => void;
  models: ModelOption[]; ollamaUp: boolean | null; onOpenModels: () => void;
  prefill?: { text: string; nonce: number } | null;
  onOpenLibrary: (tab: LibraryTab) => void;
  /** Deep research (owned by App so runs keep going on other pages). */
  research: ResearchApi; onOpenEngines: () => void;
}

/** Starter prompts for an empty chat (HIG Generative AI: show what works). A click fills the box; nothing is sent. */
const STARTERS = [
  { label: 'Summarize Text', text: 'Summarize this text in five short bullet points:\n\n' },
  { label: 'Draft an Email', text: 'Help me write a short, friendly email that ' },
  { label: 'Explain Simply', text: 'Explain, in simple terms and with one example, how ' },
  { label: 'Plan Something', text: 'Make a step-by-step plan for ' },
];

export const ChatWorkspace: React.FC<Props> = ({ chat, settings, onSettings, models, ollamaUp, onOpenModels, prefill, onOpenLibrary, research, onOpenEngines }) => {
  const [starter, setStarter] = useState<{ text: string; nonce: number } | null>(null);
  const installedPlugins = usePlugins();
  const pluginCmds = useMemo(() => pluginCommands(installedPlugins), [installedPlugins]);
  const { active: session } = chat;
  const { right: showInspector, setRight: setShowInspector } = usePanels();
  const [tab, setTab] = usePersisted<InspectorTab>('lotus.chat.tab.v1', 'artifacts');
  const [focus, setFocus] = useState<{ code: string; nonce: number } | null>(null);
  const hw = useHardware();
  const numCtx = settings.autoScale ? hw.plan.numCtx : settings.contextWindow;
  const project = useProjectContext(session.folder);
  useEffect(() => { chat.setProjectContext(session.id, project.files); }, [session.id, project.files]); // eslint-disable-line react-hooks/exhaustive-deps
  const memOn = memoryOnFor(session);

  // Deep research: a task opens in place of the conversation. `pending` waits one render for a new task to exist.
  const [openResearch, setOpenResearch] = usePersisted<string | null>('lotus.chat.research.v1', null);
  const [pending, setPending] = useState<{ id: string; q: string } | null>(null);
  const rp = openResearch ? research.projects.find((x) => x.id === openResearch) ?? null : null;
  useEffect(() => { if (openResearch && !rp) setOpenResearch(null); }, [openResearch, rp]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (pending && research.projects.some((x) => x.id === pending.id)) { void research.startScoping(pending.id, pending.q); setPending(null); }
  }, [pending, research.projects]); // eslint-disable-line react-hooks/exhaustive-deps
  const startResearch = (q?: string) => {
    const id = research.create();
    setOpenResearch(id);
    if (q) setPending({ id, q });
  };
  const selectChat = (id: string) => { setOpenResearch(null); chat.setActiveId(id); };
  const toggleMemory = () => chat.toggleMemory(session.id);

  const used = useMemo(() => {
    if (session.usedTokens && !chat.isStreaming) return { n: session.usedTokens, exact: true };
    const n = estimateTokens(settings.systemPrompt + session.messages.map((m) => m.content + (m.thinking ? '' : '')).join('')) + contextTokens(session.context);
    return { n, exact: false };
  }, [session, settings.systemPrompt, chat.isStreaming]);
  const frac = used.n / Math.max(1, numCtx);

  const mentions = [
    ...(session.context ?? []).map((c) => ({ id: c.id, label: c.name, kind: 'file' as const })),
    ...models.map((m) => ({ id: m.id, label: m.id, kind: 'model' as const })),
  ];

  const onSend = async (text: string, files: File[]) => {
    // @mentions: a model name switches the model for this message; a file name forces its chunks in.
    let t = text, modelOverride: string | undefined; const forceFiles: string[] = [];
    for (const m of mentions) {
      const tag = `@${m.label}`;
      if (t.includes(tag)) { t = t.replace(tag, '').replace(/\s{2,}/g, ' ').trim(); if (m.kind === 'model') modelOverride = m.id; else forceFiles.push(m.label); }
    }
    return chat.send(t, { files, modelOverride, forceFiles });
  };

  const onCommand = (name: string, arg: string): string | void => {
    const pc = pluginCmds.find((c) => c.name === name);
    if (pc) {
      const text = expandCommand(pc.prompt, arg);
      void onSend(text, []).then((errs) => { if (errs.length) console.warn(errs.join(' ')); });
      return;
    }
    switch (name) {
      case 'research': if (arg.length < 8) return 'Add the research question after /research.'; startResearch(arg); return;
      case 'plugins': onOpenLibrary('plugins'); return;
      case 'library': onOpenLibrary('skills'); return;
      case 'new': chat.newChat(); return;
      case 'clear': chat.clearChat(); return;
      case 'incognito': chat.patchSession(session.id, (s) => ({ ...s, incognito: !s.incognito })); return session.incognito ? 'Incognito off. This chat will be saved.' : 'Incognito on. This chat won’t be saved and creates no memories.';
      case 'think': chat.patchSession(session.id, (s) => ({ ...s, thinking: !s.thinking })); return session.thinking ? 'Thinking off.' : 'Thinking on: replies take longer and are checked before you see them.';
      case 'web': chat.patchSession(session.id, (s) => ({ ...s, webSearch: !s.webSearch })); return session.webSearch ? 'Web search off.' : `Web search on: your question goes to ${settings.webSearchProvider === 'searxng' ? 'your SearXNG' : 'DuckDuckGo'} and the top pages are read.`;
      case 'memory': if (session.incognito) return 'Incognito chats never use memory.'; toggleMemory(); return memOn ? 'Memory off for this chat: nothing is recalled or learned.' : 'Memory on: Lotus recalls and learns again.';
      case 'search': chat.patchSession(session.id, (s) => ({ ...s, searchSources: !s.searchSources })); return session.searchSources ? 'Source search off.' : 'Source search on: keywords go to OpenAlex, arXiv and PubMed.';
      case 'model': { const m = models.find((x) => x.id.toLowerCase().includes(arg.toLowerCase())); if (!arg || !m) return `No installed model matches “${arg}”.`; onSettings({ selectedModel: m.id }); return `Model: ${m.id}`; }
      case 'temp': { const v = parseFloat(arg); if (!(v >= 0 && v <= 2)) return 'Use a number from 0 to 2.'; onSettings({ temperature: v }); return `Temperature ${v}`; }
      case 'seed': if (arg === 'off') { onSettings({ seed: null }); return 'Seed unlocked.'; } else { const v = parseInt(arg, 10); if (!Number.isFinite(v) || v < 0) return 'Use a whole number, or “off”.'; onSettings({ seed: v }); return `Seed locked to ${v}`; }
      case 'system': if (!arg) return 'Add the new system prompt after /system.'; onSettings({ systemPrompt: arg }); return 'System prompt updated.';
      case 'pin': chat.patchSession(session.id, (s) => ({ ...s, pinned: !s.pinned })); return;
    }
  };

  const mountFiles = async (files: File[]) => {
    for (const f of files) if (f.type.startsWith('text/') || TEXT_EXT.test(f.name) || f.type === 'application/json') chat.addContext(contextItemFromText(f.name, await f.text(), hardware.get().plan.chunkChars));
  };

  const offline = ollamaUp === false;

  /** + → Attach a folder: desktop reads it in Rust; the browser preview passes the picked files. */
  const attachFolder = async (list?: FileList): Promise<string | void> => {
    const r = list ? await readPickedFiles(list) : await pickAndReadFolder();
    if (!r) return;
    folderToContext(r, hardware.get().plan.chunkChars).forEach((item) => chat.addContext(item));
    if (r.files.length) { setTab('context'); setShowInspector(true); }
    return folderSummary(r);
  };

  // Deleting a conversation hides it at once and offers Undo; it is removed (and forgotten by
  // memory) only when the Undo note closes.
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const [hiddenChats, setHiddenChats] = useState<Set<string>>(() => new Set());
  const unhideChat = (id: string) => setHiddenChats((h) => { const n = new Set(h); n.delete(id); return n; });
  const deleteChat = (id: string) => {
    const s = chat.sessions.find((x) => x.id === id);
    if (!s?.messages.length) { chat.deleteChat(id); return; }
    setHiddenChats((h) => new Set(h).add(id));
    if (chat.activeId === id) { const next = chat.sessions.find((x) => x.id !== id && !hiddenChats.has(x.id)); if (next) selectChat(next.id); else chat.newChat(); }
    offerUndo('Conversation deleted', () => { unhideChat(id); setOpenResearch(null); chatRef.current.setActiveId(id); }, () => { chatRef.current.deleteChat(id); unhideChat(id); });
  };
  useEffect(() => () => flushUndo(), []);

  return (
    <div className="flex-1 min-h-0 flex bg-[var(--color-bg-panel)] overflow-hidden">
      <ChatSidebar sessions={chat.sessions.filter((x) => !hiddenChats.has(x.id))} activeId={chat.activeId} folders={chat.folders} onFolders={chat.setFolders}
        onSelect={selectChat} onNew={() => { setOpenResearch(null); chat.newChat(); }} onDelete={deleteChat} onPatch={chat.patchSession}
        research={{ projects: research.projects, openId: rp?.id ?? null, onOpen: (id) => { research.setActiveId(id); setOpenResearch(id); }, onNew: () => startResearch(), onDelete: research.remove }} />

      {rp ? (
        <ResearchView r={research} p={rp} models={models.map((m) => m.id)} ollamaUp={ollamaUp} onOpenEngines={onOpenEngines} onClose={() => setOpenResearch(null)} />
      ) : (<>

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {session.incognito && <p className="px-6 pt-3 text-[12px] text-[var(--color-text-muted)] flex items-center gap-1.5"><EyeOff className="w-3.5 h-3.5" />Incognito: this conversation isn't saved and creates no memories.</p>}
        {!session.incognito && session.memoryOff && <p className="px-6 pt-3 text-[12px] text-[var(--color-text-muted)] flex items-center gap-1.5"><BrainCircuit className="w-3.5 h-3.5" />Memory paused: this chat doesn't recall past conversations, facts or skills, and nothing new is learned.</p>}
        {session.messages.length === 0 ? (
          <div className="flex-1 flex"><Empty icon={<Sparkles className="w-5 h-5" />} title="What can I help with?" className="flex-1"
            body={`Chatting with ${settings.selectedModel || 'a local model'} on this computer. Local models can make mistakes, so check important facts. Type / for commands or @ to mention a model or file.`}
            action={<div className="flex flex-wrap justify-center gap-2 max-w-[520px]">{STARTERS.map((p) => <Btn key={p.label} onClick={() => setStarter({ text: p.text, nonce: Date.now() })}>{p.label}</Btn>)}</div>} /></div>
        ) : (
          <ChatStream session={session} isStreaming={chat.isStreaming} autoScroll={settings.autoScroll} reasoningMode={settings.reasoningBlockMode}
            onEdit={chat.editMessage} onRegenerate={chat.regenerate} onSwitch={chat.switchTo} onMemory={chat.rateMemory} onFeedback={chat.rateReply}
            onOpenArtifact={(_l, code) => { setTab('artifacts'); setShowInspector(true); setFocus({ code, nonce: Date.now() }); }}
            onAnswer={(id, text) => void chat.answerPoll(id, text)}
            onInstall={(id, target, allow) => void chat.decideInstall(id, target, allow)} />
        )}
        {offline && <EngineNotice id="ollama" purpose="to chat" className="max-w-[808px] w-full mx-auto px-6 pb-1" />}
        <Composer model={settings.selectedModel} streaming={chat.isStreaming} disabled={offline} sendOnEnter={settings.sendOnEnter}
          models={models} onModel={(id) => onSettings({ selectedModel: id })} onOpenModels={onOpenModels}
          onAttachFolder={attachFolder} extraCommands={pluginCmds.map((c) => ({ name: c.name, args: c.args || undefined, help: c.help }))}
          thinkingOn={!!session.thinking} onToggleThinking={() => chat.patchSession(session.id, (s) => ({ ...s, thinking: !s.thinking }))}
          webOn={!!session.webSearch} onToggleWeb={() => chat.patchSession(session.id, (s) => ({ ...s, webSearch: !s.webSearch }))}
          memoryOn={memOn} incognito={!!session.incognito} onToggleMemory={toggleMemory}
          onToggleIncognito={() => chat.patchSession(session.id, (s) => ({ ...s, incognito: !s.incognito }))}
          contextUsed={frac} contextTitle={`Context: ${used.exact ? '' : 'about '}${used.n.toLocaleString()} of ${numCtx.toLocaleString()} tokens used${used.exact ? ' (measured by the model server)' : ' (estimated)'}${settings.autoScale ? '. Context is sized to free video memory.' : ''}`}
          onOpenLibrary={onOpenLibrary} onResearch={(q) => startResearch(q)}
          mentions={mentions} prefill={starter && (!prefill || starter.nonce > prefill.nonce) ? starter : prefill} onSend={onSend} onCommand={onCommand} onStop={chat.stop} />
      </div>

      {showInspector && (
        <ChatInspector tab={tab} onTab={setTab} session={session} settings={settings} onSettings={onSettings}
          memory={chat.memory} onMemory={chat.setMemory} onContext={chat.patchContext} onAddFiles={mountFiles} raw={chat.raw}
          focusArtifact={focus} searchOn={!!session.searchSources} onToggleSearch={() => chat.patchSession(session.id, (s) => ({ ...s, searchSources: !s.searchSources }))}
          project={project} onFolder={(folder) => chat.patchSession(session.id, (s) => ({ ...s, folder: folder ?? undefined, folderOff: [] }))}
          onToggleFile={(rel) => chat.patchSession(session.id, (s) => ({ ...s, folderOff: s.folderOff?.includes(rel) ? s.folderOff.filter((r) => r !== rel) : [...(s.folderOff ?? []), rel] }))} />
      )}
      </>)}
    </div>
  );
};
