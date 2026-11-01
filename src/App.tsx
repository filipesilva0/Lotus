/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ViewMode, LotusSettings, Appearance } from './types/lotus';
import { LeftRail, VIEW_TITLES } from './components/rail/LeftRail';
import { TitleBar, MenuDef } from './components/common/TitleBar';
import { ToolbarSlotContext } from './components/common/ToolbarSlot';
import { applyWindowGlass, onSystemAppearance, systemPrefersDark } from './lib/glass';
import { DEFAULT_PANELS, PanelState, PanelsProvider } from './lib/panels';
import { ChatWorkspace, ModelOption } from './components/workspaces/ChatWorkspace';
import { ImageWorkspace } from './components/workspaces/ImageWorkspace';
import { VoiceWorkspace } from './components/workspaces/VoiceWorkspace';
import { EnginesWorkspace } from './components/workspaces/EnginesWorkspace';
import { BuilderWorkspace } from './components/builder/BuilderWorkspace';
import { useResearch } from './research/store';
import { TasksWorkspace } from './components/workspaces/TasksWorkspace';
import { setLiveSettings } from './lib/liveSettings';
import { startHardwareMonitor } from './hardware/monitor';
import { startScheduler } from './tasks/store';
import { loadMemory } from './memory/store';
import { SettingsModal } from './components/modals/SettingsModal';
import { AccountModal, AccountView } from './components/account/AccountModal';
import { LibrarySheet, LibraryTab } from './components/library/LibrarySheet';
import { ollamaClient } from './services/ollamaService';
import { comfy } from './services/comfyService';
import { useChat } from './hooks/useChat';
import { useEngines } from './hooks/useEngines';
import { useUpdates } from './hooks/useUpdates';
import { applyThemeToDocument, PAGE_PALETTE } from './styles/theme';
import { invokeNative, onEvent } from './lib/bus';
import { WelcomeSetup } from './components/setup/WelcomeSetup';
import { loadSetup } from './setup/state';
import { useSetupJobs } from './setup/jobs';
import { installMacMenu, menuSignature } from './lib/nativeMenu';
import { chromeOs } from './components/common/TitleBar';
import type { ColorPalette } from './types/lotus';

const SETTINGS_KEY = 'lotus.settings.v1';
const SESSIONS_KEY = 'lotus.sessions.v1';

const DEFAULT_SETTINGS: LotusSettings = {
  appearance: 'auto',
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

/** Saved settings from before session 8 carry `darkMode` / `palette`; drop them (appearance now defaults to Auto). */
function loadSettings(): LotusSettings {
  const { darkMode: _d, palette: _p, ...saved } = load<Partial<LotusSettings> & { darkMode?: boolean; palette?: string }>(SETTINGS_KEY, {});
  return { ...DEFAULT_SETTINGS, ...saved };
}

export default function App() {
  // First run: the Welcome guide fills the window until it is finished or skipped (session 10).
  const [setupOpen, setSetupOpen] = useState(() => !loadSetup().done);
  const [setupAccent, setSetupAccent] = useState<ColorPalette>('blue');
  const [currentView, setCurrentViewRaw] = useState<ViewMode>('chat');
  const [builderSeen, setBuilderSeen] = useState(false);
  const [enginesTab, setEnginesTab] = useState<'engines' | 'models'>('engines');
  const [settings, setSettings] = useState<LotusSettings>(loadSettings);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [prefill, setPrefill] = useState<{ text: string; nonce: number } | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [accountView, setAccountView] = useState<AccountView | null>(null);
  const [library, setLibrary] = useState<LibraryTab | null>(null);
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);

  // Each page's left panel (its list) and right panel (its inspector), toggled from the title bar.
  const [panelMap, setPanelMap] = useState<Partial<Record<ViewMode, PanelState>>>(() => load('lotus.panels.v1', {}));
  useEffect(() => { try { localStorage.setItem('lotus.panels.v1', JSON.stringify(panelMap)); } catch { /* keep in memory */ } }, [panelMap]);
  const panels = panelMap[currentView] ?? DEFAULT_PANELS;
  const viewRefForPanels = useRef(currentView);
  viewRefForPanels.current = currentView;
  const setPanel = useCallback((side: keyof PanelState, on: boolean | ((was: boolean) => boolean)) => {
    setPanelMap((m) => {
      const cur = m[viewRefForPanels.current] ?? DEFAULT_PANELS;
      const next = typeof on === 'function' ? on(cur[side]) : on;
      return cur[side] === next ? m : { ...m, [viewRefForPanels.current]: { ...cur, [side]: next } };
    });
  }, []);
  const panelsApi = useMemo(() => ({ ...panels, setLeft: (on: boolean) => setPanel('left', on), setRight: (on: boolean) => setPanel('right', on) }), [panels, setPanel]);
  const toggleLeft = useCallback(() => setPanel('left', (v) => !v), [setPanel]);
  const toggleRight = useCallback(() => setPanel('right', (v) => !v), [setPanel]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); toggleLeft(); } else if (k === 'i') { e.preventDefault(); toggleRight(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [toggleLeft, toggleRight]);

  // Appearance: Auto follows Windows' light/dark setting live.
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  useEffect(() => onSystemAppearance(setSystemDark), []);
  const dark = settings.appearance === 'auto' ? systemDark : settings.appearance === 'dark';
  const setAppearance = (a: Appearance) => setSettings((s) => ({ ...s, appearance: a }));

  const [checkpoints, setCheckpoints] = useState<string[]>([]);

  // Page history for the title bar's back / forward buttons (in memory, per run).
  const [past, setPast] = useState<ViewMode[]>([]);
  const [future, setFuture] = useState<ViewMode[]>([]);
  const viewRef = useRef(currentView);
  const showView = useCallback((v: ViewMode) => {
    viewRef.current = v;
    setCurrentViewRaw(v);
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

  const eng = useEngines();
  const updates = useUpdates();
  const ollamaUp = eng.engines.ollama.up;
  const comfyUp = eng.engines.comfyui.up;

  // Code outside React (agent pool, VRAM monitor, scheduler, learning) reads the current settings from here.
  setLiveSettings(settings);
  const chat = useChat(settings);
  // Deep research lives in Chat, but its runs belong to the app so they keep going on other pages.
  const research = useResearch({ model: settings.selectedModel });
  useEffect(() => { startHardwareMonitor(); void loadMemory(); startScheduler(); }, []);

  // ── Persistence ───────────────────────────────────────────────────────────
  useEffect(() => { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }, [settings]);

  // Each page wears its own petal colour as the accent (no accent setting since session 8).
  useEffect(() => {
    applyThemeToDocument(setupOpen ? setupAccent : PAGE_PALETTE[currentView], settings.fontFamily, settings.fontSize, dark);
  }, [currentView, settings.fontFamily, settings.fontSize, dark, setupOpen, setupAccent]);
  useEffect(() => { void applyWindowGlass(settings.appearance, dark); }, [settings.appearance, dark]);

  // The window starts hidden to avoid a white flash; show it once we have painted.
  // A hidden WebKit page (macOS, Linux) may never run animation frames, so a timer backs it up;
  // Rust only acts on the first call and also has its own fallback.
  useEffect(() => {
    const ready = () => void invokeNative('main_ready').catch(() => undefined);
    const raf = requestAnimationFrame(ready);
    const t = setTimeout(ready, 50);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, []);

  // ── Models & checkpoints follow engine availability ────────────────────────
  // A chat model finishing its download (from the guide or a chat install card) refreshes the list too.
  const chatModelsDone = useSetupJobs().filter((j) => j.engine === 'ollama' && j.status === 'done').length;
  const imageFilesDone = useSetupJobs().filter((j) => j.engine === 'comfyui' && j.status === 'done').length;
  useEffect(() => {
    if (!ollamaUp) return;
    ollamaClient.listModels().then((list) => {
      setModels(list.map((m) => ({ id: m.name, name: m.name, tag: [m.details?.parameter_size, m.details?.quantization_level].filter(Boolean).join(' · ') || 'Local' })));
      setSettings((s) => (list.length && !list.some((m) => m.name === s.selectedModel) ? { ...s, selectedModel: list[0].name } : s));
    }).catch(() => undefined);
  }, [ollamaUp, chatModelsDone]);
  useEffect(() => { if (comfyUp) comfy.imageModels().then(setCheckpoints).catch(() => setCheckpoints([])); }, [comfyUp, imageFilesDone]);

  // ── Messages from other windows ───────────────────────────────────────────
  useEffect(() => { if (currentView === 'builder') setBuilderSeen(true); }, [currentView]);
  const openEngines = useCallback((tab: 'engines' | 'models' = 'engines') => { setEnginesTab(tab); setCurrentView('engines'); }, []);

  useEffect(() => {
    const offs: (() => void)[] = [];
    void onEvent<string | null>('main:navigate', (v) => { if (v === 'chat' || v === 'images' || v === 'voice' || v === 'builder' || v === 'tasks' || v === 'engines') setCurrentView(v); else if (v === 'research') setCurrentView('chat'); }).then((u) => offs.push(u));
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
      { label: panels.left ? 'Hide Left Panel' : 'Show Left Panel', shortcut: 'Ctrl+Alt+S', onSelect: toggleLeft },
      { label: panels.right ? 'Hide Right Panel' : 'Show Right Panel', shortcut: 'Ctrl+Alt+I', onSelect: toggleRight },
      'separator',
      { label: 'Appearance: Auto', checked: settings.appearance === 'auto', onSelect: () => setAppearance('auto') },
      { label: 'Appearance: Light', checked: settings.appearance === 'light', onSelect: () => setAppearance('light') },
      { label: 'Appearance: Dark', checked: settings.appearance === 'dark', onSelect: () => setAppearance('dark') },
      'separator',
      { label: 'Chat', checked: currentView === 'chat', onSelect: go('chat') },
      { label: 'Images', checked: currentView === 'images', onSelect: go('images') },
      { label: 'Voice', checked: currentView === 'voice', onSelect: go('voice') },
      { label: 'App Builder', checked: currentView === 'builder', onSelect: go('builder') },
      { label: 'Tasks', checked: currentView === 'tasks', onSelect: go('tasks') },
      { label: 'Engines & Models', checked: currentView === 'engines', onSelect: go('engines') },
      'separator',
      { label: 'Library…', onSelect: () => setLibrary('skills') },
      { label: 'Plugins…', onSelect: () => setLibrary('plugins') },
      'separator',
      { label: 'Back', shortcut: 'Alt+Left', onSelect: goBack, disabled: !past.length },
      { label: 'Forward', shortcut: 'Alt+Right', onSelect: goForward, disabled: !future.length },
    ] },
    { label: 'Help', items: [
      { label: 'Setup Guide…', onSelect: () => setSetupOpen(true) },
      'separator',
      { label: 'Check for Updates…', onSelect: () => { void updates.check(); setIsSettingsOpen(true); } },
    ] },
  ];

  // macOS: these menus go to the system menu bar instead of the window (rebuilt only when they change).
  const menusRef = useRef(menus);
  menusRef.current = menus;
  const menuSig = menuSignature(menus);
  useEffect(() => {
    if (chromeOs() !== 'macos') return;
    void installMacMenu(menusRef.current, () => menusRef.current).catch(() => undefined);
  }, [menuSig]);

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
        onOpenAccount={setAccountView}
        onOpenLibrary={setLibrary}
        engines={eng.engines}
        updateAvailable={updates.state.kind === 'available'}
        dark={dark}
      />

      <div className="flex-1 min-w-0 flex flex-col overflow-hidden mb-2 mr-2 rounded-[12px] bg-[var(--color-bg-panel)] shadow-[0_0_0_0.5px_var(--sep),var(--shadow-1)]">
        {/* Chat and Images have no toolbar row: their controls live in the prompt box (session 8). */}
        <header className={currentView === 'chat' || currentView === 'images' ? 'hidden' : 'h-14 shrink-0 flex items-center gap-3 px-3 border-b border-[var(--sep)]'} role="banner">
          <h1 className={currentView === 'voice' || currentView === 'engines' || currentView === 'chat' || currentView === 'images' || currentView === 'builder' || currentView === 'tasks' ? 'sr-only' : 'text-[17px] font-semibold tracking-[-0.01em]'}>{VIEW_TITLES[currentView]}</h1>
          <div ref={setToolbarSlot} className="flex-1 min-w-0 self-stretch flex items-stretch gap-3 pr-2" />
        </header>
        <ToolbarSlotContext.Provider value={toolbarSlot}>
        <PanelsProvider value={panelsApi}>
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {currentView === 'chat' && (
          <ChatWorkspace chat={chat} settings={settings} onSettings={(p) => setSettings((s) => ({ ...s, ...p }))} models={models} ollamaUp={ollamaUp}
            onOpenModels={() => openEngines('models')} prefill={prefill} onOpenLibrary={setLibrary}
            research={research} onOpenEngines={() => openEngines('models')} />
        )}

        {currentView === 'images' && <ImageWorkspace checkpoints={checkpoints} comfyUp={comfyUp} onOpenEngines={() => openEngines('engines')} onOpenModels={() => openEngines('models')} />}

        {currentView === 'voice' && <VoiceWorkspace onOpenEngines={() => openEngines('models')} />}


        {/* The App Builder stays mounted once opened so dev servers, terminals and the agent keep going while you use other pages. */}
        {(builderSeen || currentView === 'builder') && (
          <div className={currentView === 'builder' ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}>
            <BuilderWorkspace active={currentView === 'builder'} models={models} selectedModel={settings.selectedModel} ollamaUp={ollamaUp} onOpenEngines={() => openEngines('engines')} />
          </div>
        )}

        {currentView === 'tasks' && <TasksWorkspace settings={settings} onSettings={(p) => setSettings((s) => ({ ...s, ...p }))} ollamaUp={ollamaUp} />}

        {currentView === 'engines' && <EnginesWorkspace eng={eng} initialTab={enginesTab} />}
        </div>
        </PanelsProvider>
        </ToolbarSlotContext.Provider>
      </div>
    </main>
  );

  if (setupOpen) {
    return (
      <div className="h-screen w-screen relative overflow-hidden">
        <WelcomeSetup eng={eng} onAccent={setSetupAccent} onClose={() => { setSetupOpen(false); void eng.refresh(); }} />
        <div className="absolute inset-x-0 top-0">
          <TitleBar bare canGoBack={false} canGoForward={false} onBack={goBack} onForward={goForward}
            leftPanel={false} rightPanel={false} onToggleLeft={toggleLeft} onToggleRight={toggleRight} menus={menus} />
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col">
      <TitleBar canGoBack={past.length > 0} canGoForward={future.length > 0} onBack={goBack} onForward={goForward}
        leftPanel={panels.left} rightPanel={panels.right} onToggleLeft={toggleLeft} onToggleRight={toggleRight} menus={menus} />
      {panel}
      <AccountModal open={accountView !== null} view={accountView ?? 'signin'} onView={setAccountView} onClose={() => setAccountView(null)} sessions={chat.sessions} />
      <LibrarySheet open={library !== null} tab={library ?? 'skills'} onTab={setLibrary} onClose={() => setLibrary(null)} settings={settings} onSettings={(p) => setSettings((s) => ({ ...s, ...p }))} folder={chat.active?.folder} />
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} models={models} settings={settings} onUpdateSettings={(n) => setSettings((s) => ({ ...s, ...n }))} updates={updates} />
    </div>
  );
}
