/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ViewMode, LotusSettings } from './types/lotus';
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
import { ollamaClient } from './services/ollamaService';
import { comfy } from './services/comfyService';
import { ModelsWorkspace } from './components/workspaces/ModelsWorkspace';
import { useChat } from './hooks/useChat';
import { useEngines } from './hooks/useEngines';
import { useUpdates } from './hooks/useUpdates';
import { applyThemeToDocument } from './styles/theme';
import { invokeNative, onEvent } from './lib/bus';

const SETTINGS_KEY = 'lotus.settings.v1';
const SESSIONS_KEY = 'lotus.sessions.v1';

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
  topK: 40,
  stopSequences: [],
  seed: null,
  maxTokens: 0,
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

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Modules from the specs: entering one collapses the app-switcher rail to icons. */
const COLLAPSING: ViewMode[] = ['chat', 'images', 'voice', 'models'];

export default function App() {
  const firstRun = useRef(!localStorage.getItem(SESSIONS_KEY) && !localStorage.getItem('lotus.setup.dismissed'));
  const [currentView, setCurrentViewRaw] = useState<ViewMode>(firstRun.current ? 'engines' : 'chat');
  const [enginesTab, setEnginesTab] = useState<'engines' | 'models'>('engines');
  const [settings, setSettings] = useState<LotusSettings>(() => ({ ...DEFAULT_SETTINGS, ...load<Partial<LotusSettings>>(SETTINGS_KEY, {}) }));
  const [models, setModels] = useState<ModelOption[]>([]);
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

  const [checkpoints, setCheckpoints] = useState<string[]>([]);

  const setCurrentView = useCallback((v: ViewMode) => {
    setCurrentViewRaw(v);
    if (COLLAPSING.includes(v)) setSidebarCollapsed(true);
  }, []);
  useEffect(() => { if (COLLAPSING.includes(currentView)) setSidebarCollapsed(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const eng = useEngines();
  const updates = useUpdates();
  const ollamaUp = eng.engines.ollama.up;
  const comfyUp = eng.engines.comfyui.up;

  const chat = useChat(settings);

  // ── Persistence ───────────────────────────────────────────────────────────
  useEffect(() => { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }, [settings]);

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
    void onEvent<string | null>('main:navigate', (v) => { if (v === 'chat' || v === 'images' || v === 'voice' || v === 'research' || v === 'models' || v === 'engines') setCurrentView(v); }).then((u) => offs.push(u));
    void onEvent<string>('chat:prefill', (text) => { setCurrentView('chat'); setPrefill({ text, nonce: Date.now() }); }).then((u) => offs.push(u));
    void onEvent<{ role: 'user' | 'assistant'; content: string }[]>('chat:import', (msgs) => { chat.importMessages(msgs); setCurrentView('chat'); }).then((u) => offs.push(u));
    return () => offs.forEach((o) => o());
  }, [chat.importMessages]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <h1 className={currentView === 'voice' || currentView === 'engines' || currentView === 'chat' || currentView === 'images' || currentView === 'models' ? 'sr-only' : 'text-[17px] font-semibold tracking-[-0.01em]'}>{VIEW_TITLES[currentView]}</h1>
          <div ref={setToolbarSlot} className="flex-1 min-w-0 self-stretch flex items-stretch gap-3 pr-2" />
        </header>
        <ToolbarSlotContext.Provider value={toolbarSlot}>
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {currentView === 'chat' && (
          <ChatWorkspace chat={chat} settings={settings} onSettings={(p) => setSettings((s) => ({ ...s, ...p }))} models={models} ollamaUp={ollamaUp}
            onOpenModels={() => setCurrentView('models')} prefill={prefill} />
        )}

        {currentView === 'images' && <ImageWorkspace checkpoints={checkpoints} comfyUp={comfyUp} onOpenEngines={() => openEngines('engines')} />}

        {currentView === 'voice' && <VoiceWorkspace onOpenEngines={() => openEngines('models')} />}

        {currentView === 'research' && (
          <ResearchWorkspace model={settings.selectedModel} models={models.map((m) => m.id)} ollamaUp={ollamaUp} onOpenEngines={() => openEngines('models')} />
        )}

        {currentView === 'models' && <ModelsWorkspace engines={eng.engines} onOpenEngines={() => openEngines('engines')} />}

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
