/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ViewMode, ChatSession, ChatMessage, LotusSettings, GeneratedImage } from './types/lotus';
import { LeftRail, VIEW_TITLES } from './components/rail/LeftRail';
import { IconBtn } from './components/common/ui';
import { Symbol } from './components/common/Symbol';
import { PanelLeft } from 'lucide-react';
import { ToolbarSlotContext } from './components/common/ToolbarSlot';
import { applyWindowGlass } from './lib/glass';
import { ChatWorkspace, ModelOption } from './components/workspaces/ChatWorkspace';
import { ImageWorkspace } from './components/workspaces/ImageWorkspace';
import { VoiceWorkspace } from './components/workspaces/VoiceWorkspace';
import { EnginesWorkspace } from './components/workspaces/EnginesWorkspace';
import { ResearchWorkspace } from './components/research/ResearchWorkspace';
import { SettingsModal } from './components/modals/SettingsModal';
import { ollamaClient, ChatTurn, fileToBase64 } from './services/ollamaService';
import { comfy, dimensionsFor } from './services/comfyService';
import { voicebox } from './services/voicebox';
import { useEngines } from './hooks/useEngines';
import { useUpdates } from './hooks/useUpdates';
import { applyThemeToDocument } from './styles/theme';
import { invokeNative, onEvent, reportActivity } from './lib/bus';

const SETTINGS_KEY = 'lotus.settings.v1';
const SESSIONS_KEY = 'lotus.sessions.v1';
const ACTIVE_KEY = 'lotus.activeSession.v1';

const DEFAULT_SETTINGS: LotusSettings = {
  darkMode: false,
  lotusFolderPath: '',
  keepEnginesRunningOnQuit: false,
  selectedModel: '',
  temperature: 0.7,
  topP: 0.9,
  contextWindow: 4096,
  frequencyPenalty: 0.0,
  presencePenalty: 0.0,
  systemPrompt: 'You are Lotus, a helpful AI assistant running locally on the user\'s PC. Answer concisely and accurately.',
  streamingEnabled: true,
  reasoningBlockMode: 'collapsed',
  sendOnEnter: true,
  autoScroll: true,
  codeCopyLanguage: true,
  vramCapPercent: 80,
  comfyUiIdleStopMinutes: 10,
  defaultTtsVoice: '',
  ttsRate: 10,
  autoReadResponses: false,
  whisperLanguage: 'English',
  density: 'comfortable',
  palette: 'blue',
  fontFamily: 'jakarta',
  fontSize: 'md',
};

const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

const welcomeSession = (model: string): ChatSession => ({
  id: `chat-${Date.now()}`,
  title: 'New conversation',
  model,
  updatedAt: 'Just now',
  category: 'General',
  messages: [],
});

/** Blob URLs do not survive a restart, so attachments are kept by name only. */
const stripBlobs = (list: ChatSession[]): ChatSession[] =>
  list.map((s) => ({ ...s, messages: s.messages.map((m) => (m.attachment?.url.startsWith('blob:') ? { ...m, attachment: undefined, isStreaming: false } : { ...m, isStreaming: false })) }));

export default function App() {
  const firstRun = useRef(!localStorage.getItem(SESSIONS_KEY) && !localStorage.getItem('lotus.setup.dismissed'));
  const [currentView, setCurrentView] = useState<ViewMode>(firstRun.current ? 'engines' : 'chat');
  const [enginesTab, setEnginesTab] = useState<'engines' | 'models'>('engines');
  const [settings, setSettings] = useState<LotusSettings>(() => ({ ...DEFAULT_SETTINGS, ...load<Partial<LotusSettings>>(SETTINGS_KEY, {}) }));
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const saved = stripBlobs(load<ChatSession[]>(SESSIONS_KEY, []));
    return saved.length ? saved : [welcomeSession('')];
  });
  const [activeSessionId, setActiveSessionId] = useState<string>(() => load<string>(ACTIVE_KEY, ''));
  const [models, setModels] = useState<ModelOption[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [prefill, setPrefill] = useState<{ text: string; nonce: number } | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => load<boolean>('lotus.sidebar.v1', false));
  useEffect(() => { localStorage.setItem('lotus.sidebar.v1', JSON.stringify(sidebarCollapsed)); }, [sidebarCollapsed]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); setSidebarCollapsed((c) => !c); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // Image generation state
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageElapsed, setImageElapsed] = useState(0);
  const [checkpoints, setCheckpoints] = useState<string[]>([]);
  const imageAbort = useRef<AbortController | null>(null);
  const chatAbort = useRef<AbortController | null>(null);

  const eng = useEngines();
  const updates = useUpdates();
  const ollamaUp = eng.engines.ollama.up;
  const comfyUp = eng.engines.comfyui.up;

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];

  // ── Persistence ───────────────────────────────────────────────────────────
  useEffect(() => { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }, [settings]);
  useEffect(() => { if (!isStreaming) localStorage.setItem(SESSIONS_KEY, JSON.stringify(stripBlobs(sessions).slice(0, 60))); }, [sessions, isStreaming]);
  useEffect(() => { if (activeSession) localStorage.setItem(ACTIVE_KEY, JSON.stringify(activeSession.id)); }, [activeSession]);

  useEffect(() => {
    applyThemeToDocument(settings.palette, settings.fontFamily, settings.fontSize, settings.darkMode);
    void applyWindowGlass(settings.darkMode);
  }, [settings.palette, settings.fontFamily, settings.fontSize, settings.darkMode]);

  // The window starts hidden to avoid a white flash; show it once we have painted.
  useEffect(() => { requestAnimationFrame(() => void invokeNative('main_ready')); }, []);

  // ── Models & checkpoints follow engine availability ────────────────────────
  useEffect(() => {
    if (!ollamaUp) return;
    ollamaClient.listModels().then((list) => {
      setModels(list.map((m) => ({ id: m.name, name: m.name, tag: [m.details?.parameter_size, m.details?.quantization_level].filter(Boolean).join(' · ') || 'Local' })));
      setSettings((s) => (list.length && !list.some((m) => m.name === s.selectedModel) ? { ...s, selectedModel: list[0].name } : s));
    }).catch(() => undefined);
  }, [ollamaUp]);
  useEffect(() => { if (comfyUp) comfy.checkpoints().then(setCheckpoints).catch(() => setCheckpoints([])); }, [comfyUp]);

  // ── Messages from other windows ───────────────────────────────────────────
  const openEngines = useCallback((tab: 'engines' | 'models' = 'engines') => { setEnginesTab(tab); setCurrentView('engines'); }, []);

  useEffect(() => {
    const offs: (() => void)[] = [];
    void onEvent<string | null>('main:navigate', (v) => { if (v === 'chat' || v === 'images' || v === 'voice' || v === 'research' || v === 'engines') setCurrentView(v); }).then((u) => offs.push(u));
    void onEvent<string>('chat:prefill', (text) => { setCurrentView('chat'); setPrefill({ text, nonce: Date.now() }); }).then((u) => offs.push(u));
    void onEvent<{ role: 'user' | 'assistant'; content: string }[]>('chat:import', (msgs) => {
      const s = welcomeSession(settings.selectedModel);
      s.title = (msgs.find((m) => m.role === 'user')?.content ?? 'From the island').slice(0, 40);
      s.messages = msgs.map((m, i) => ({ id: `imp-${Date.now()}-${i}`, role: m.role, content: m.content, timestamp: now() }));
      setSessions((prev) => [s, ...prev]);
      setActiveSessionId(s.id);
      setCurrentView('chat');
    }).then((u) => offs.push(u));
    return () => offs.forEach((o) => o());
  }, [settings.selectedModel]);

  // ── Chat ──────────────────────────────────────────────────────────────────
  const patchSession = (id: string, fn: (s: ChatSession) => ChatSession) => setSessions((prev) => prev.map((s) => (s.id === id ? fn(s) : s)));
  const patchMessage = (sid: string, mid: string, patch: Partial<ChatMessage>) =>
    patchSession(sid, (s) => ({ ...s, messages: s.messages.map((m) => (m.id === mid ? { ...m, ...patch } : m)) }));

  const handleSendMessage = async (text: string, file?: File) => {
    const session = activeSession;
    const stamp = Date.now();
    const userMsg: ChatMessage = {
      id: `user-${stamp}`, role: 'user', content: text, timestamp: now(),
      attachment: file ? { type: 'image', url: URL.createObjectURL(file), name: file.name } : undefined,
    };
    const aiId = `assistant-${stamp}`;
    const aiMsg: ChatMessage = { id: aiId, role: 'assistant', content: '', timestamp: now(), tokensPerSec: 0, durationMs: 0, isStreaming: true };
    const isFirst = session.messages.length === 0;

    patchSession(session.id, (s) => ({
      ...s, updatedAt: 'Just now', model: settings.selectedModel,
      title: isFirst || s.title === 'New conversation' ? text.slice(0, 40) || 'Image chat' : s.title,
      messages: [...s.messages, userMsg, aiMsg],
    }));

    const turns: ChatTurn[] = [
      { role: 'system', content: settings.systemPrompt },
      ...session.messages.filter((m) => m.content).map((m) => ({ role: m.role === 'system' ? 'system' : m.role, content: m.content }) as ChatTurn),
      { role: 'user', content: text, images: file ? [await fileToBase64(file)] : undefined },
    ];

    const ctrl = new AbortController();
    chatAbort.current = ctrl;
    setIsStreaming(true);
    let acc = '';
    let lastReport = 0;
    try {
      if (!settings.selectedModel) throw new Error('No model selected. Open Engines → Models to download one.');
      const stream = ollamaClient.streamChat(turns, {
        model: settings.selectedModel, temperature: settings.temperature, topP: settings.topP, numCtx: settings.contextWindow,
        frequencyPenalty: settings.frequencyPenalty, presencePenalty: settings.presencePenalty, signal: ctrl.signal,
      }, (st) => {
        patchMessage(session.id, aiId, { tokensPerSec: st.tokensPerSec, durationMs: st.durationMs });
        if (Date.now() - lastReport > 1000) { lastReport = Date.now(); reportActivity({ id: 'main-chat', kind: 'chat', label: `${st.tokensPerSec} tok/s` }); }
      });
      for await (const token of stream) {
        acc += token;
        patchMessage(session.id, aiId, { content: acc });
      }
    } catch (e) {
      if (!ctrl.signal.aborted) {
        const msg = (e as Error).message;
        patchMessage(session.id, aiId, { content: acc ? `${acc}\n\n_(${msg})_` : `Couldn't get a reply. ${msg}` });
      }
    } finally {
      setIsStreaming(false);
      chatAbort.current = null;
      patchMessage(session.id, aiId, { isStreaming: false });
      reportActivity({ id: 'main-chat', kind: 'chat', label: 'Done', done: true });
    }

    if (settings.autoReadResponses && acc && !ctrl.signal.aborted) {
      try {
        const q = await voicebox.speak(acc.replace(/```[\s\S]*?```/g, ' ').slice(0, 4000), { profile: localStorage.getItem('lotus.voice.profile') ?? undefined });
        const done = await voicebox.waitFor(q.id);
        await new Audio(await voicebox.audioUrl(done.id)).play();
      } catch { /* read-aloud is best effort */ }
    }
  };

  const handleNewSession = () => {
    const s = welcomeSession(settings.selectedModel);
    setSessions((prev) => [s, ...prev]);
    setActiveSessionId(s.id);
  };

  const handleDeleteSession = (id: string) => {
    const remaining = sessions.filter((s) => s.id !== id);
    if (!remaining.length) {
      const s = welcomeSession(settings.selectedModel);
      setSessions([s]);
      setActiveSessionId(s.id);
      return;
    }
    setSessions(remaining);
    if (activeSessionId === id) setActiveSessionId(remaining[0].id);
  };

  // ── Images (ComfyUI) ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!isGeneratingImage) return;
    const t0 = Date.now();
    const t = setInterval(() => setImageElapsed((Date.now() - t0) / 1000), 250);
    return () => { clearInterval(t); setImageElapsed(0); };
  }, [isGeneratingImage]);

  const handleGenerateImage = async (p: { prompt: string; negativePrompt?: string; steps: number; cfg: number; checkpoint: string; aspectRatio: string }) => {
    setIsGeneratingImage(true);
    setImageError(null);
    const ctrl = new AbortController();
    imageAbort.current = ctrl;
    const id = `img-${Date.now()}`;
    reportActivity({ id, kind: 'image', label: 'Image' });
    try {
      const { width, height } = dimensionsFor(p.aspectRatio, p.checkpoint);
      const r = await comfy.txt2img({
        prompt: p.prompt, negativePrompt: p.negativePrompt, checkpoint: p.checkpoint, steps: p.steps, cfg: p.cfg, width, height, signal: ctrl.signal,
        onTick: (ms) => reportActivity({ id, kind: 'image', label: `${Math.floor(ms / 1000)}s` }),
      });
      const img: GeneratedImage = {
        id, url: r.url, prompt: p.prompt, negativePrompt: p.negativePrompt, seed: r.seed, steps: p.steps, cfg: p.cfg,
        dimensions: `${width}×${height}`, generationTimeSec: r.generationTimeSec, timestamp: now(), checkpoint: p.checkpoint,
      };
      setImages((prev) => [img, ...prev]);
      reportActivity({ id, kind: 'image', label: 'Image ready', done: true });
    } catch (e) {
      if (!ctrl.signal.aborted) setImageError((e as Error).message);
      reportActivity({ id, kind: 'image', label: 'Image', done: true });
    } finally {
      setIsGeneratingImage(false);
      imageAbort.current = null;
    }
  };

  // ── Layout ────────────────────────────────────────────────────────────────
  // Split view: translucent sidebar | content pane with a unified toolbar on top.
  const panel = (
    <main className="w-full h-full flex overflow-hidden text-[var(--color-text-main)]">
      <LeftRail
        currentView={currentView}
        onSelectView={setCurrentView}
        onOpenSettings={() => setIsSettingsOpen(true)}
        engines={eng.engines}
        updateAvailable={updates.state.kind === 'available'}
        collapsed={sidebarCollapsed}
      />

      <div className="flex-1 min-w-0 flex flex-col overflow-hidden my-2 mr-2 rounded-[12px] bg-[var(--color-bg-panel)] shadow-[0_0_0_0.5px_var(--sep),var(--shadow-1)]">
        <header className="h-14 shrink-0 flex items-center gap-3 px-3 border-b border-[var(--sep)]" role="banner">
          <IconBtn label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'} onClick={() => setSidebarCollapsed((c) => !c)}>
            <Symbol glyph={PanelLeft} weight="medium" />
          </IconBtn>
          <h1 className={currentView === 'voice' || currentView === 'engines' ? 'sr-only' : 'text-[17px] font-semibold tracking-[-0.01em]'}>{VIEW_TITLES[currentView]}</h1>
          <div ref={setToolbarSlot} className="flex-1 min-w-0 self-stretch flex items-stretch gap-3 pr-2" />
        </header>
        <ToolbarSlotContext.Provider value={toolbarSlot}>
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {currentView === 'chat' && (
          <ChatWorkspace
            sessions={sessions}
            activeSessionId={activeSession.id}
            onSelectSession={setActiveSessionId}
            onNewSession={handleNewSession}
            onSendMessage={handleSendMessage}
            onDeleteSession={handleDeleteSession}
            isStreaming={isStreaming}
            selectedModel={settings.selectedModel || 'No model'}
            onSelectModel={(m) => setSettings((s) => ({ ...s, selectedModel: m }))}
            models={models}
            ollamaUp={ollamaUp}
            onStop={() => chatAbort.current?.abort()}
            onOpenEngines={() => openEngines('models')}
            prefill={prefill}
          />
        )}

        {currentView === 'images' && (
          <ImageWorkspace
            images={images}
            onGenerate={handleGenerateImage}
            isGenerating={isGeneratingImage}
            checkpoints={checkpoints}
            comfyUp={comfyUp}
            error={imageError}
            elapsedSec={imageElapsed}
            onCancel={() => imageAbort.current?.abort()}
            onOpenEngines={() => openEngines('engines')}
          />
        )}

        {currentView === 'voice' && <VoiceWorkspace onOpenEngines={() => openEngines('models')} />}

        {currentView === 'research' && (
          <ResearchWorkspace model={settings.selectedModel} models={models.map((m) => m.id)} ollamaUp={ollamaUp} onOpenEngines={() => openEngines('models')} />
        )}

        {currentView === 'engines' && <EnginesWorkspace eng={eng} initialTab={enginesTab} />}
        </div>
        </ToolbarSlotContext.Provider>
      </div>
    </main>
  );

  return (
    <div className="h-screen w-screen">
      {panel}
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} settings={settings} onUpdateSettings={(n) => setSettings((s) => ({ ...s, ...n }))} updates={updates} />
    </div>
  );
}
