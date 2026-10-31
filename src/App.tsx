/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ViewMode, LotusSettings } from './types/lotus';
import { LeftRail, VIEW_TITLES } from './components/rail/LeftRail';
import { TitleBar, MenuDef } from './components/common/TitleBar';
import { ToolbarSlotContext } from './components/common/ToolbarSlot';
import { applyWindowGlass } from './lib/glass';
import { ChatWorkspace, ModelOption } from './components/workspaces/ChatWorkspace';
import { ImageWorkspace } from './components/workspaces/ImageWorkspace';
import { VoiceWorkspace } from './components/workspaces/VoiceWorkspace';
import { EnginesWorkspace } from './components/workspaces/EnginesWorkspace';
import { BuilderWorkspace } from './components/builder/BuilderWorkspace';
import { ResearchWorkspace } from './components/research/ResearchWorkspace';
import { TasksWorkspace } from './components/workspaces/TasksWorkspace';
import { setLiveSettings } from './lib/liveSettings';
import { startHardwareMonitor } from './hardware/monitor';
import { startScheduler } from './tasks/store';
import { loadMemory } from './memory/store';
import { SettingsModal } from './components/modals/SettingsModal';
import { AccountModal, AccountView } from './components/account/AccountModal';
import { ModelsSheet } from './components/modals/ModelsSheet';
import { LibrarySheet, LibraryTab } from './components/library/LibrarySheet';
import { ollamaClient } from './services/ollamaService';
import { comfy } from './services/comfyService';
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
  llmBackend: 'ollama',
  llamacppUrl: 'http://127.0.0.1:8080',
  autoScale: true,
  vramReserveMb: 1024,
  maxSubagents: 4,
  webSearchProvider: 'duckduckgo',
  searxngUrl: 'http://127.0.0.1:8888',
  webPagesToRead: 3,
  autoMemory: true,
  autoSkills: true,
  sessionRecall: true,
  backgroundModel: '',
  autoRename: true,
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
const COLLAPSING: ViewMode[] = ['chat', 'images', 'voice', 'builder', 'tasks'];

export default function App() {
  const firstRun = useRef(!localStorage.getItem(SESSIONS_KEY) && !localStorage.getItem('lotus.setup.dismissed'));
  const [currentView, setCurrentViewRaw] = useState<ViewMode>(firstRun.current ? 'engines' : 'chat');
  const [builderSeen, setBuilderSeen] = useState(false);
  const [enginesTab, setEnginesTab] = useState<'engines' | 'models'>('engines');
  const [settings, setSettings] = useState<LotusSettings>(() => ({ ...DEFAULT_SETTINGS, ...load<Partial<LotusSettings>>(SETTINGS_KEY, {}) }));
  const [models, setModels] = useState<ModelOption[]>([]);
  const [prefill, setPrefill] = useState<{ text: string; nonce: number } | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [accountView, setAccountView] = useState<AccountView | null>(null);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [library, setLibrary] = useState<LibraryTab | null>(null);
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => load<boolean>('lotus.sidebar.v1', false));
  useEffect(() => { localStorage.setItem('lotus.sidebar.v1', JSON.stringify(sidebarCollapsed)); }, [sidebarCollapsed]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); setSidebarCollapsed((c) => !c); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const [checkpoints, setCheckpoints] = useState<string[]>([]);

  // Page history for the title bar's back / forward buttons (in memory, per run).
  const [past, setPast] = useState<ViewMode[]>([]);
  const [future, setFuture] = useState<ViewMode[]>([]);
  const viewRef = useRef(currentView);
  const showView = useCallback((v: ViewMode) => {
    viewRef.current = v;
    setCurrentViewRaw(v);
    if (COLLAPSING.includes(v)) setSidebarCollapsed(true);
  }, []);
  const setCurrentView = useCallback((v: ViewMode) => {
    const here = viewRef.current;
    if (v === here) return;
    setPast((p) => [...p.slice(-49), here]);
    setFuture([]);
    showView(v);
  }, [showView]);
  const goBack = useCallback(() => {
    if (!past.length) return;
    const here = viewRef.current;
    setFuture((f) => [here, ...f]);
    setPast(past.slice(0, -1));
    showView(past[past.length - 1]);
  }, [past, showView]);
  const goForward = useCallback(() => {
    if (!future.length) return;
    const here = viewRef.current;
    setPast((p) => [...p, here]);
    setFuture(future.slice(1));
    showView(future[0]);
  }, [future, showView]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); goBack(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goForward(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [goBack, goForward]);
  useEffect(() => { if (COLLAPSING.includes(currentView)) setSidebarCollapsed(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const eng = useEngines();
  const updates = useUpdates();
  const ollamaUp = eng.engines.ollama.up;
  const comfyUp = eng.engines.comfyui.up;

  // Code outside React (agent pool, VRAM monitor, scheduler, learning) reads the current settings from here.
  setLiveSettings(settings);
  const chat = useChat(settings);
  useEffect(() => { startHardwareMonitor(); void loadMemory(); startScheduler(); }, []);

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
  useEffect(() => { if (currentView === 'builder') setBuilderSeen(true); }, [currentView]);
  const openEngines = useCallback((tab: 'engines' | 'models' = 'engines') => { setEnginesTab(tab); setCurrentView('engines'); }, []);

  useEffect(() => {
    const offs: (() => void)[] = [];
    void onEvent<string | null>('main:navigate', (v) => { if (v === 'chat' || v === 'images' || v === 'voice' || v === 'research' || v === 'builder' || v === 'tasks' || v === 'engines') setCurrentView(v); }).then((u) => offs.push(u));
    void onEvent<string>('chat:prefill', (text) => { setCurrentView('chat'); setPrefill({ text, nonce: Date.now() }); }).then((u) => offs.push(u));
    void onEvent<{ role: 'user' | 'assistant'; content: string }[]>('chat:import', (msgs) => { chat.importMessages(msgs); setCurrentView('chat'); }).then((u) => offs.push(u));
    return () => offs.forEach((o) => o());
  }, [chat.importMessages]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Title-bar menus (every item does something real) ─────────────────────
  const edit = (cmd: string) => () => { document.execCommand(cmd); };
  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) document.execCommand('insertText', false, text);
    } catch {
      document.execCommand('paste');
    }
  };
  const closeWindow = async () => {
    try { const { getCurrentWindow } = await import('@tauri-apps/api/window'); await getCurrentWindow().close(); } catch { /* browser preview */ }
  };
  const go = (v: ViewMode) => () => setCurrentView(v);
  const menus: MenuDef[] = [
    { label: 'File', items: [
      { label: 'New Chat', shortcut: 'Ctrl+N', onSelect: () => { chat.newChat(); setCurrentView('chat'); } },
      'separator',
      { label: 'Settings…', shortcut: 'Ctrl+,', onSelect: () => setIsSettingsOpen(true) },
      'separator',
      { label: 'Close Window', onSelect: () => void closeWindow() },
      { label: 'Quit Lotus', onSelect: () => void invokeNative('quit_app') },
    ] },
    { label: 'Edit', items: [
      { label: 'Undo', shortcut: 'Ctrl+Z', onSelect: edit('undo') },
      { label: 'Redo', shortcut: 'Ctrl+Y', onSelect: edit('redo') },
      'separator',
      { label: 'Cut', shortcut: 'Ctrl+X', onSelect: edit('cut') },
      { label: 'Copy', shortcut: 'Ctrl+C', onSelect: edit('copy') },
      { label: 'Paste', shortcut: 'Ctrl+V', onSelect: () => void paste() },
      'separator',
      { label: 'Select All', shortcut: 'Ctrl+A', onSelect: edit('selectAll') },
    ] },
    { label: 'View', items: [
      { label: sidebarCollapsed ? 'Show Sidebar' : 'Hide Sidebar', shortcut: 'Ctrl+Alt+S', onSelect: () => setSidebarCollapsed((c) => !c) },
      { label: 'Dark Appearance', checked: settings.darkMode, onSelect: () => setSettings((s) => ({ ...s, darkMode: !s.darkMode })) },
      'separator',
      { label: 'Chat', checked: currentView === 'chat', onSelect: go('chat') },
      { label: 'Images', checked: currentView === 'images', onSelect: go('images') },
      { label: 'Voice', checked: currentView === 'voice', onSelect: go('voice') },
      { label: 'Research', checked: currentView === 'research', onSelect: go('research') },
      { label: 'App Builder', checked: currentView === 'builder', onSelect: go('builder') },
      { label: 'Tasks', checked: currentView === 'tasks', onSelect: go('tasks') },
      { label: 'Engines', checked: currentView === 'engines', onSelect: go('engines') },
      'separator',
      { label: 'Library…', onSelect: () => setLibrary('skills') },
      { label: 'Plugins…', onSelect: () => setLibrary('plugins') },
      'separator',
      { label: 'Back', shortcut: 'Alt+Left', onSelect: goBack, disabled: !past.length },
      { label: 'Forward', shortcut: 'Alt+Right', onSelect: goForward, disabled: !future.length },
    ] },
    { label: 'Help', items: [
      { label: 'Check for Updates…', onSelect: () => { void updates.check(); setIsSettingsOpen(true); } },
      { label: 'Models & Engines', onSelect: () => openEngines('models') },
    ] },
  ];

  // Ctrl+N and Ctrl+, are listed in the menus, so they must work from the keyboard too.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
      if (e.key.toLowerCase() === 'n') { e.preventDefault(); chat.newChat(); setCurrentView('chat'); }
      else if (e.key === ',') { e.preventDefault(); setIsSettingsOpen(true); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [chat.newChat, setCurrentView]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Layout ────────────────────────────────────────────────────────────────
  // Split view: translucent sidebar | content pane with a unified toolbar on top.
  const panel = (
    <main className="w-full flex-1 min-h-0 flex overflow-hidden text-[var(--color-text-main)]">
      <LeftRail
        currentView={currentView}
        onSelectView={setCurrentView}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenModels={() => setModelsOpen(true)}
        onOpenAccount={setAccountView}
        onOpenLibrary={setLibrary}
        engines={eng.engines}
        updateAvailable={updates.state.kind === 'available'}
        collapsed={sidebarCollapsed}
      />

      <div className="flex-1 min-w-0 flex flex-col overflow-hidden mb-2 mr-2 rounded-[12px] bg-[var(--color-bg-panel)] shadow-[0_0_0_0.5px_var(--sep),var(--shadow-1)]">
        <header className="h-14 shrink-0 flex items-center gap-3 px-3 border-b border-[var(--sep)]" role="banner">
          <h1 className={currentView === 'voice' || currentView === 'engines' || currentView === 'chat' || currentView === 'images' || currentView === 'builder' || currentView === 'tasks' ? 'sr-only' : 'text-[17px] font-semibold tracking-[-0.01em]'}>{VIEW_TITLES[currentView]}</h1>
          <div ref={setToolbarSlot} className="flex-1 min-w-0 self-stretch flex items-stretch gap-3 pr-2" />
        </header>
        <ToolbarSlotContext.Provider value={toolbarSlot}>
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {currentView === 'chat' && (
          <ChatWorkspace chat={chat} settings={settings} onSettings={(p) => setSettings((s) => ({ ...s, ...p }))} models={models} ollamaUp={ollamaUp}
            onOpenModels={() => openEngines('models')} prefill={prefill} onOpenLibrary={setLibrary} />
        )}

        {currentView === 'images' && <ImageWorkspace checkpoints={checkpoints} comfyUp={comfyUp} onOpenEngines={() => openEngines('engines')} onOpenModels={() => openEngines('models')} />}

        {currentView === 'voice' && <VoiceWorkspace onOpenEngines={() => openEngines('models')} />}

        {currentView === 'research' && (
          <ResearchWorkspace model={settings.selectedModel} models={models.map((m) => m.id)} ollamaUp={ollamaUp} onOpenEngines={() => openEngines('models')} />
        )}


        {/* The App Builder stays mounted once opened so dev servers, terminals and the agent keep going while you use other pages. */}
        {(builderSeen || currentView === 'builder') && (
          <div className={currentView === 'builder' ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}>
            <BuilderWorkspace active={currentView === 'builder'} models={models} selectedModel={settings.selectedModel} ollamaUp={ollamaUp} onOpenEngines={() => openEngines('engines')} />
          </div>
        )}

        {currentView === 'tasks' && <TasksWorkspace settings={settings} onSettings={(p) => setSettings((s) => ({ ...s, ...p }))} ollamaUp={ollamaUp} />}

        {currentView === 'engines' && <EnginesWorkspace eng={eng} initialTab={enginesTab} />}
        </div>
        </ToolbarSlotContext.Provider>
      </div>
    </main>
  );

  return (
    <div className="h-screen w-screen flex flex-col">
      <TitleBar canGoBack={past.length > 0} canGoForward={future.length > 0} onBack={goBack} onForward={goForward}
        sidebarCollapsed={sidebarCollapsed} onToggleSidebar={() => setSidebarCollapsed((c) => !c)} menus={menus} />
      {panel}
      <ModelsSheet open={modelsOpen} onClose={() => setModelsOpen(false)} engines={eng.engines} onOpenEngines={() => openEngines('engines')} />
      <AccountModal open={accountView !== null} view={accountView ?? 'signin'} onView={setAccountView} onClose={() => setAccountView(null)} sessions={chat.sessions} />
      <LibrarySheet open={library !== null} tab={library ?? 'skills'} onTab={setLibrary} onClose={() => setLibrary(null)} settings={settings} onSettings={(p) => setSettings((s) => ({ ...s, ...p }))} folder={chat.active?.folder} />
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} models={models} settings={settings} onUpdateSettings={(n) => setSettings((s) => ({ ...s, ...n }))} updates={updates} />
    </div>
  );
}
