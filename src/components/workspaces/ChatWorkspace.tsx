import React, { useEffect, useMemo, useState } from 'react';
import { BrainCircuit, ChevronDown, EyeOff, PanelRight, Sparkles } from 'lucide-react';
import { useProjectContext } from '../../context/discover';
import { hardware, useHardware } from '../../hardware/monitor';
import { LotusSettings } from '../../types/lotus';
import { useChat, memoryOnFor } from '../../hooks/useChat';
import { ToolbarContent } from '../common/ToolbarSlot';
import { Banner, Btn, Empty, Gauge, IconBtn } from '../common/ui';
import { MenuItem, Popover } from '../common/Pane';
import { ChatSidebar } from '../chat/ChatSidebar';
import { ChatStream } from '../chat/ChatStream';
import { Composer } from '../chat/Composer';
import { ChatInspector, InspectorTab } from '../chat/ChatInspector';
import { contextItemFromText, estimateTokens, contextTokens, TEXT_EXT } from '../../chat/helpers';
import { usePersisted } from '../../lib/persist';
import { engineUrl } from '../../services/engineConfig';

export interface ModelOption { id: string; name: string; tag: string }

interface Props {
  chat: ReturnType<typeof useChat>;
  settings: LotusSettings; onSettings: (p: Partial<LotusSettings>) => void;
  models: ModelOption[]; ollamaUp: boolean | null; onOpenModels: () => void;
  prefill?: { text: string; nonce: number } | null;
}

export const ChatWorkspace: React.FC<Props> = ({ chat, settings, onSettings, models, ollamaUp, onOpenModels, prefill }) => {
  const { active: session } = chat;
  const [showInspector, setShowInspector] = usePersisted<boolean>('lotus.chat.inspector.v1', true);
  const [tab, setTab] = usePersisted<InspectorTab>('lotus.chat.tab.v1', 'artifacts');
  const [focus, setFocus] = useState<{ code: string; nonce: number } | null>(null);
  const hw = useHardware();
  const numCtx = settings.autoScale ? hw.plan.numCtx : settings.contextWindow;
  const project = useProjectContext(session.folder);
  useEffect(() => { chat.setProjectContext(session.id, project.files); }, [session.id, project.files]); // eslint-disable-line react-hooks/exhaustive-deps
  const memOn = memoryOnFor(session);
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
    switch (name) {
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

  return (
    <div className="flex-1 min-h-0 flex bg-[var(--color-bg-panel)] overflow-hidden">
      <ToolbarContent>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <Popover trigger={(_o, t) => (
            <button type="button" onClick={t} aria-haspopup="menu" className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-[6px] text-[13px] font-medium bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep),0_0.5px_1.5px_rgba(0,0,0,.12)] hover:bg-[var(--hover)] max-w-[260px]">
              <Sparkles className="w-3.5 h-3.5 text-[var(--color-accent-vibrant)] shrink-0" /><span className="truncate">{settings.selectedModel || 'No model'}</span><ChevronDown className="w-3 h-3 opacity-60 shrink-0" />
            </button>)}>
            {(close) => (<>
              {!models.length && <div className="p-2.5 text-[12px] text-[var(--color-text-muted)]">No models installed yet. <button className="font-semibold text-[var(--color-accent-vibrant)]" onClick={() => { close(); onOpenModels(); }}>Open Models</button></div>}
              {models.map((m) => <MenuItem key={m.id} active={settings.selectedModel === m.id} onClick={() => { onSettings({ selectedModel: m.id }); close(); }}><span className="flex-1 truncate">{m.name}</span><span className="text-[11px] opacity-70">{m.tag}</span></MenuItem>)}
            </>)}
          </Popover>

          <div className="flex items-center gap-2 min-w-[150px] max-w-[220px]" title={`${used.exact ? 'Measured by the model server' : 'Estimated'}: ${used.n.toLocaleString()} of ${numCtx.toLocaleString()} tokens${settings.autoScale ? ' (context sized to free video memory)' : ''}`}>
            <div className="flex-1"><Gauge value={frac} label="Context used" warnAt={0.75} critAt={0.92} /></div>
            <span className="text-[11px] tabular-nums text-[var(--color-text-muted)] whitespace-nowrap">{used.exact ? '' : '~'}{used.n.toLocaleString()} / {numCtx >= 1000 ? `${Math.round(numCtx / 1024)}k` : numCtx}</span>
          </div>
          <div className="flex-1" />
          <Btn size="sm" variant={memOn ? 'primary' : 'ghost'} icon={<BrainCircuit className="w-3.5 h-3.5" />} aria-pressed={memOn} disabled={!!session.incognito}
            onClick={toggleMemory}
            title={session.incognito ? 'Incognito chats never read or write memory' : memOn ? 'Memory on: recalls past chats, facts and skills, and keeps learning. Click to pause it for this chat.' : 'Memory paused for this chat: nothing is recalled or learned. Click to resume.'}>Memory</Btn>
          <Btn size="sm" variant={session.incognito ? 'primary' : 'ghost'} icon={<EyeOff className="w-3.5 h-3.5" />} aria-pressed={!!session.incognito}
            onClick={() => chat.patchSession(session.id, (s) => ({ ...s, incognito: !s.incognito }))} title="Incognito chats aren't saved and create no memories">Incognito</Btn>
          <IconBtn label={showInspector ? 'Hide inspector' : 'Show inspector'} active={showInspector} onClick={() => setShowInspector((v) => !v)}><PanelRight className="w-4 h-4" /></IconBtn>
        </div>
      </ToolbarContent>

      <ChatSidebar sessions={chat.sessions} activeId={chat.activeId} folders={chat.folders} onFolders={chat.setFolders}
        onSelect={chat.setActiveId} onNew={() => chat.newChat()} onDelete={chat.deleteChat} onPatch={chat.patchSession} />

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {offline && <div className="px-6 pt-3"><Banner tone="warn" action={<Btn size="sm" variant="secondary" onClick={onOpenModels}>Models</Btn>}>Ollama isn't running at {engineUrl('ollama')}. Start it from Engines to chat.</Banner></div>}
        {session.incognito && <p className="px-6 pt-3 text-[12px] text-[var(--color-text-muted)] flex items-center gap-1.5"><EyeOff className="w-3.5 h-3.5" />Incognito: this conversation isn't saved and creates no memories.</p>}
        {!session.incognito && session.memoryOff && <p className="px-6 pt-3 text-[12px] text-[var(--color-text-muted)] flex items-center gap-1.5"><BrainCircuit className="w-3.5 h-3.5" />Memory paused: this chat doesn't recall past conversations, facts or skills, and nothing new is learned.</p>}
        {session.messages.length === 0 ? (
          <div className="flex-1 flex"><Empty icon={<Sparkles className="w-5 h-5" />} title="What can I help with?" body={`Chatting with ${settings.selectedModel || 'a local model'} on this PC. Type / for commands or @ to mention a model or file.`} className="flex-1" /></div>
        ) : (
          <ChatStream session={session} isStreaming={chat.isStreaming} autoScroll={settings.autoScroll} reasoningMode={settings.reasoningBlockMode}
            onEdit={chat.editMessage} onRegenerate={chat.regenerate} onSwitch={chat.switchTo} onMemory={chat.rateMemory}
            onOpenArtifact={(_l, code) => { setTab('artifacts'); setShowInspector(true); setFocus({ code, nonce: Date.now() }); }} />
        )}
        <Composer model={settings.selectedModel} streaming={chat.isStreaming} disabled={offline} sendOnEnter={settings.sendOnEnter}
          searchOn={!!session.searchSources} onToggleSearch={() => chat.patchSession(session.id, (s) => ({ ...s, searchSources: !s.searchSources }))}
          thinkingOn={!!session.thinking} onToggleThinking={() => chat.patchSession(session.id, (s) => ({ ...s, thinking: !s.thinking }))}
          webOn={!!session.webSearch} onToggleWeb={() => chat.patchSession(session.id, (s) => ({ ...s, webSearch: !s.webSearch }))}
          mentions={mentions} prefill={prefill} onSend={onSend} onCommand={onCommand} onStop={chat.stop} />
      </div>

      {showInspector && (
        <ChatInspector tab={tab} onTab={setTab} session={session} settings={settings} onSettings={onSettings}
          memory={chat.memory} onMemory={chat.setMemory} onContext={chat.patchContext} onAddFiles={mountFiles} raw={chat.raw}
          focusArtifact={focus} searchOn={!!session.searchSources} onToggleSearch={() => chat.patchSession(session.id, (s) => ({ ...s, searchSources: !s.searchSources }))}
          project={project} onFolder={(folder) => chat.patchSession(session.id, (s) => ({ ...s, folder: folder ?? undefined, folderOff: [] }))}
          onToggleFile={(rel) => chat.patchSession(session.id, (s) => ({ ...s, folderOff: s.folderOff?.includes(rel) ? s.folderOff.filter((r) => r !== rel) : [...(s.folderOff ?? []), rel] }))} />
      )}
    </div>
  );
};
