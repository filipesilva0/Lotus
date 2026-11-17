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
import { WorkWorkspace } from './components/workspaces/WorkWorkspace';
import { useWork } from './work/store';
import { startVoiceController } from './voice/controller';
import { useResearch } from './research/store';
import { TasksWorkspace } from './components/workspaces/TasksWorkspace';
import { setLiveSettings } from './lib/liveSettings';
import { hardware, startHardwareMonitor } from './hardware/monitor';
import { contextItemFromText } from './chat/helpers';
import { startScheduler } from './tasks/store';
import { loadMemory } from './memory/store';
import { SettingsModal, type SettingsTab } from './components/modals/SettingsModal';
import { AccountModal, AccountView } from './components/account/AccountModal';
import type { LibraryTab } from './components/library/LibraryPane';
import { ollamaClient } from './services/ollamaService';
import { llamacpp } from './services/llm';
import { comfy } from './services/comfyService';
import { useChat } from './hooks/useChat';
import { useEngines } from './hooks/useEngines';
import { useGallery, DEFAULT_PARAMS, type ImageParams } from './hooks/useGallery';
import { setImageChoices } from './chat/imageChoices';
import { pickProfile, proposalParams, type ImageProposal } from './chat/imageProposal';
import { useUpdates } from './hooks/useUpdates';
import { applyThemeToDocument, PAGE_PALETTE } from './styles/theme';
import { emitEvent, invokeNative, onEvent } from './lib/bus';
import { hueForPage, KEY_PETAL_HUE, petal } from './agents/avatars';
import { WelcomeSetup } from './components/setup/WelcomeSetup';
import { loadSetup } from './setup/state';
import { useSetupJobs } from './setup/jobs';
import { installMacMenu, matchesShortcut, menuSignature } from './lib/nativeMenu';
import { focusPageSearch, runCommand, type PageCommand } from './lib/commands';
import { AlertHost, flushUndo, takeUndoIfIdle } from './components/common/Alerts';
import { CoreNotice } from './components/common/CoreNotice';
import { EnginesContext } from './components/common/EngineNotice';
import { openExternal } from './lib/open';
import { isTauri } from './lib/http';
import { chromeOs } from './components/common/TitleBar';
import type { ColorPalette } from './types/lotus';
import { kv } from './lib/store';
import { engineReady, hasImageFile, useBuiltins, useProfiles } from './lib/builtins';
import { missingFor } from './models/imageProfiles';
import { linkComfyModels } from './services/engineControl';

import { DEFAULT_DENY } from './agents/toolDefaults';
const SETTINGS_KEY = 'lotus.settings.v1';
const SESSIONS_KEY = 'lotus.sessions.v1';
/** Help › Lotus Help opens the user guide (the project README) in the browser. */
const HELP_URL = 'https://github.com/filipesilva0/Lotus#readme';

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
  systemPrompt: 'You are Lotus, a helpful AI assistant running locally on the user\'s computer. Answer concisely and accurately.',
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
  // Auto: Whisper writes what it hears in the language it was spoken in (0.9.6; 'English' made it
  // translate Portuguese speech into English).
  whisperLanguage: 'Auto',
  density: 'comfortable',
  fontFamily: 'jakarta',
  fontSize: 'md',
  llmBackend: 'builtin',
  imageEngine: 'builtin',
  voiceEngine: 'builtin',
  builtinVoice: '',
  builtinSpeaker: 0,
  builtinDictation: '',
  rethink: 1,
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
  agentTools: true,
  agentApproval: 'risky',
  agentFolders: [],
  agentDeny: DEFAULT_DENY,
};

function load<T>(key: string, fallback: T): T {
  try {
    const raw = kv.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Saved settings from before session 8 carry `darkMode` / `palette`; drop them (appearance now defaults to Auto). */
function loadSettings(): LotusSettings {
  const raw = kv.getItem(SETTINGS_KEY);
  const { darkMode: _d, palette: _p, ...saved } = load<Partial<LotusSettings> & { darkMode?: boolean; palette?: string }>(SETTINGS_KEY, {});
  // 0.9.6: the old default 'English' forced Whisper to write Portuguese (and every other language) in
  // English. Move it to Auto once; a language picked after this stays.
  if (saved.whisperLanguage === 'English' && !kv.getItem('lotus.whisperAuto.v1')) saved.whisperLanguage = 'Auto';
  try { kv.setItem('lotus.whisperAuto.v1', '1'); } catch { /* memory only */ }
  // Installs from before session 17 keep the engines they were set up with (Ollama, ComfyUI, Voicebox);
  // Settings → Engines switches them to the built-in ones.
  if (raw && saved.imageEngine === undefined) {
    return { ...DEFAULT_SETTINGS, llmBackend: 'ollama', imageEngine: 'comfyui', voiceEngine: 'voicebox', engineModelsInStudio: false, ...saved };
  }
  return { ...DEFAULT_SETTINGS, ...saved };
}

export default function App() {
  // First run: the Welcome guide fills the window until it is finished or skipped (session 10).
  const [setupOpen, setSetupOpen] = useState(() => !loadSetup().done);
  const [setupAccent, setSetupAccent] = useState<ColorPalette>('blue');
  const [currentView, setCurrentViewRaw] = useState<ViewMode>('chat');
  const [enginesTab, setEnginesTab] = useState<'engines' | 'models'>('engines');
  const [settings, setSettings] = useState<LotusSettings>(loadSettings);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [prefill, setPrefill] = useState<{ text: string; nonce: number } | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // Window full screen, for View › Enter/Exit Full Screen on Windows and Linux.
  const [fullScreen, setFullScreen] = useState(false);
  useEffect(() => {
    let off: (() => void) | undefined;
    const sync = async () => {
      try { const { getCurrentWindow } = await import('@tauri-apps/api/window'); setFullScreen(await getCurrentWindow().isFullscreen()); }
      catch { setFullScreen(!!document.fullscreenElement); }
    };
    void sync();
    const h = () => void sync();
    window.addEventListener('resize', h);
    off = () => window.removeEventListener('resize', h);
    return () => off?.();
  }, []);
  const [settingsPane, setSettingsPane] = useState<SettingsTab | null>(null);
  const closeSettings = useCallback(() => setIsSettingsOpen(false), []);
  const openSettings = useCallback((pane: SettingsTab | null = null) => { setSettingsPane(pane); setIsSettingsOpen(true); }, []);
  const [accountView, setAccountView] = useState<AccountView | null>(null);
  // 0.11.0: skills, memory, soul and plugins are tabs of the Tasks page.
  const [tasksRequest, setTasksRequest] = useState<{ tab: LibraryTab; n: number } | null>(null);
  const setLibrary = useCallback((tab: LibraryTab) => { setTasksRequest({ tab, n: Date.now() }); setCurrentView('tasks'); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);

  // Each page's left panel (its list) and right panel (its inspector), toggled from the title bar.
  // v2 (session 16): inspectors start closed; sidebars keep what v1 saved.
  const [panelMap, setPanelMap] = useState<Partial<Record<ViewMode, PanelState>>>(() => {
    const v2 = load<Partial<Record<ViewMode, PanelState>> | null>('lotus.panels.v2', null);
    if (v2) return v2;
    const v1 = load<Partial<Record<string, PanelState>>>('lotus.panels.v1', {});
    return Object.fromEntries(Object.entries(v1).map(([k, v]) => [k, { left: v?.left ?? true, right: false }]));
  });
  useEffect(() => { try { kv.setItem('lotus.panels.v2', JSON.stringify(panelMap)); } catch { /* keep in memory */ } }, [panelMap]);
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

  const eng = useEngines();
  const updates = useUpdates();
  const builtins = useBuiltins();
  const [profiles] = useProfiles();
  const builtinChat = settings.llmBackend === 'builtin';
  const builtinImages = settings.imageEngine === 'builtin';
  const builtinChatModels = builtins.models.filter((m) => m.kind === 'chat');
  // "Up" means: ready to answer. For the built-in engines that is "installed, with a model".
  // A llama-server / LM Studio / vLLM the user runs is checked on its own address (STATE #7: it used to follow Ollama's state).
  const serverChat = settings.llmBackend === 'llamacpp';
  const [serverUp, setServerUp] = useState<boolean | null>(null);
  useEffect(() => {
    if (!serverChat) return;
    let stop = false;
    const tick = async () => { const ok = await llamacpp.checkHealth(3000); if (!stop) setServerUp(ok); };
    void tick();
    const t = setInterval(() => void tick(), 10_000);
    return () => { stop = true; clearInterval(t); };
  }, [serverChat, settings.llamacppUrl]);
  const ollamaUp = builtinChat ? (builtins.loaded ? engineReady(builtins, 'llama') && builtinChatModels.length > 0 : null) : serverChat ? serverUp : eng.engines.ollama.up;
  const readyProfiles = profiles.filter((p) => !missingFor(p, hasImageFile(builtins.imageFiles)).length);
  const comfyUp = builtinImages ? (builtins.loaded ? engineReady(builtins, 'sd') && readyProfiles.length > 0 : null) : eng.engines.comfyui.up;

  // Code outside React (agent pool, VRAM monitor, scheduler, learning) reads the current settings from here.
  setLiveSettings(settings);
  const chat = useChat(settings);
  // A transcript (or other text) opened in a new chat as an attached reference, with an optional request sent at once.
  const [pendingSend, setPendingSend] = useState<{ sid: string; text: string } | null>(null);
  const openInChat = useCallback((a: { name: string; text: string; prompt: string }) => {
    const s = chat.newChat({ title: a.name.slice(0, 40), context: [contextItemFromText(a.name, a.text, hardware.get().plan.chunkChars)] });
    setCurrentView('chat');
    if (a.prompt) setPendingSend({ sid: s.id, text: a.prompt });
  }, [chat.newChat]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!pendingSend || chat.active.id !== pendingSend.sid) return;
    setPendingSend(null);
    void chat.send(pendingSend.text);
  }, [pendingSend, chat.active.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Deep research lives in Chat, but its runs belong to the app so they keep going on other pages.
  const research = useResearch({ model: settings.selectedModel });
  // Images too: a generation keeps running and lands in its row while you use other pages.
  // ComfyUI reads the image models in Lotus Studio/Models/image (it picks the link up when it next starts).
  useEffect(() => { if (!builtinImages && isTauri) void linkComfyModels().catch(() => undefined); }, [builtinImages]);
  const gallery = useGallery(comfyUp, builtinImages ? 'builtin' : 'comfyui', readyProfiles);
  // Images Chat may propose (0.10.1): the ready setups (Lotus's engine) or ComfyUI's checkpoints.
  setImageChoices(builtinImages ? readyProfiles.map((p) => ({ name: p.name, family: p.family })) : checkpoints.map((c) => ({ name: c })));
  // Yes on an image the chat proposed: Images opens with its settings, in a new generation, and starts.
  const [pendingImage, setPendingImage] = useState<{ proposal: ImageProposal; from: string } | null>(null);
  const createImage = useCallback((proposal: ImageProposal) => {
    const stored = load<Partial<ImageParams>>('lotus.image.params.v1', {});
    const profile = builtinImages ? pickProfile(proposal, readyProfiles) : undefined;
    const params = proposalParams({ ...DEFAULT_PARAMS, ...stored }, proposal, { profile, checkpoints: builtinImages ? undefined : checkpoints });
    kv.setItem('lotus.image.params.v1', JSON.stringify(params));
    setPendingImage({ proposal, from: gallery.activeId });
    gallery.newSession();
    setCurrentView('images');
  }, [builtinImages, readyProfiles, checkpoints, gallery.activeId, gallery.newSession]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!pendingImage) return;
    // Wait until the new (empty) generation is the active one, so the result lands in it.
    if (gallery.active.versions.length && gallery.activeId === pendingImage.from) return;
    const p = { ...DEFAULT_PARAMS, ...load<Partial<ImageParams>>('lotus.image.params.v1', {}) };
    setPendingImage(null);
    void gallery.generate(pendingImage.proposal.prompt, p);
  }, [pendingImage, gallery.activeId, gallery.active.versions.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // Work runs too (session 16), and spoken questions / permission prompts when voice is on.
  const work = useWork(settings);
  useEffect(() => { startVoiceController(); }, []);
  useEffect(() => { startHardwareMonitor(); void loadMemory(); startScheduler(); }, []);

  // The chat model can change its soul (system prompt) with soul.update (0.10.5); the core saves it in
  // the settings, so take that one field from there.
  useEffect(() => {
    const h = (e: StorageEvent) => {
      if (e.key !== SETTINGS_KEY || !e.newValue) return;
      try { const sp = (JSON.parse(e.newValue) as Partial<LotusSettings>).systemPrompt; if (typeof sp === 'string') setSettings((s) => (s.systemPrompt === sp ? s : { ...s, systemPrompt: sp })); } catch { /* ignore */ }
    };
    window.addEventListener('storage', h);
    return () => window.removeEventListener('storage', h);
  }, []);

  // ── Persistence ───────────────────────────────────────────────────────────
  useEffect(() => { kv.setItem(SETTINGS_KEY, JSON.stringify(settings)); }, [settings]);

  // Petal, the mascot, wears the page's petal colour too (here and on the island).
  useEffect(() => {
    const h = hueForPage(currentView);
    petal.set(h);
    kv.setItem(KEY_PETAL_HUE, String(h));
    void emitEvent('petal:hue', h).catch(() => undefined);
  }, [currentView]);
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
    if (!builtinChat) return;
    const list = builtinChatModels;
    setModels(list.map((m) => ({ id: m.id, name: m.title, tag: m.custom ? 'Added by you' : 'Built in' })));
    setSettings((s) => (list.length && !list.some((m) => m.id === s.selectedModel) ? { ...s, selectedModel: list[0].id } : s));
  }, [builtinChat, builtinChatModels.map((m) => m.id).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ollamaUp || !serverChat) return;
    void llamacpp.listModels().then((ids) => {
      setModels(ids.map((id) => ({ id, name: id, tag: 'Your server' })));
      setSettings((s) => (ids.length && !ids.includes(s.selectedModel) ? { ...s, selectedModel: ids[0] } : s));
    });
  }, [ollamaUp, serverChat, settings.llamacppUrl]);
  useEffect(() => {
    if (!ollamaUp || builtinChat || serverChat) return;
    ollamaClient.listModels().then((list) => {
      setModels(list.map((m) => ({ id: m.name, name: m.name, tag: [m.details?.parameter_size, m.details?.quantization_level].filter(Boolean).join(' · ') || 'Local' })));
      setSettings((s) => (list.length && !list.some((m) => m.name === s.selectedModel) ? { ...s, selectedModel: list[0].name } : s));
    }).catch(() => undefined);
  }, [ollamaUp, chatModelsDone, builtinChat, serverChat]);
  useEffect(() => { if (comfyUp) comfy.imageModels().then(setCheckpoints).catch(() => setCheckpoints([])); }, [comfyUp, imageFilesDone]);

  // ── Messages from other windows ───────────────────────────────────────────
  const openEngines = useCallback((tab: 'engines' | 'models' = 'engines') => { setEnginesTab(tab); setCurrentView('engines'); }, []);
  const enginesCtx = useMemo(() => ({ eng, openEngines: () => openEngines('engines'), openModels: () => openEngines('models') }), [eng, openEngines]);

  useEffect(() => {
    const offs: (() => void)[] = [];
    void onEvent<string | null>('main:navigate', (v) => { if (v === 'chat' || v === 'work' || v === 'images' || v === 'voice' || v === 'tasks' || v === 'engines') setCurrentView(v); else if (v === 'builder') setCurrentView('work'); else if (v === 'research') setCurrentView('chat'); }).then((u) => offs.push(u));
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
  const toggleFullScreen = async () => {
    try { const { getCurrentWindow } = await import('@tauri-apps/api/window'); const w = getCurrentWindow(); await w.setFullscreen(!(await w.isFullscreen())); }
    catch { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.().catch(() => undefined); }
  };
  const go = (v: ViewMode) => () => setCurrentView(v);
  const newChat = () => { chat.newChat(); setCurrentView('chat'); };
  const newOn = (v: ViewMode, c: PageCommand) => () => { setCurrentView(v); runCommand(c); };
  // Edit › Find: the page's search field (opening its sidebar first when the field lives there).
  const findable = currentView === 'chat' || currentView === 'images' || currentView === 'voice' || currentView === 'engines';
  const find = () => { if (focusPageSearch()) return; setPanel('left', true); setTimeout(() => focusPageSearch(), 60); };
  const openHelp = () => void openExternal(HELP_URL);
  const menus: MenuDef[] = [
    { label: 'File', items: [
      { label: 'New Chat', shortcut: 'Ctrl+N', onSelect: newChat },
      { label: 'New Image', onSelect: newOn('images', 'new-image') },
      { label: 'New Work', onSelect: newOn('work', 'new-work') },
      { label: 'New Task', onSelect: newOn('tasks', 'new-task') },
      'separator',
      { label: 'Settings…', shortcut: 'Ctrl+,', onSelect: () => openSettings() },
      'separator',
      { label: 'Close Window', onSelect: () => void closeWindow() },
      { label: 'Quit Lotus', onSelect: () => { flushUndo(); void invokeNative('quit_app'); } },
    ] },
    { label: 'Edit', items: [
      { label: 'Undo', shortcut: 'Ctrl+Z', onSelect: () => { if (!takeUndoIfIdle()) document.execCommand('undo'); } },
      { label: 'Redo', shortcut: 'Ctrl+Y', onSelect: edit('redo') },
      'separator',
      { label: 'Cut', shortcut: 'Ctrl+X', onSelect: edit('cut') },
      { label: 'Copy', shortcut: 'Ctrl+C', onSelect: edit('copy') },
      { label: 'Paste', shortcut: 'Ctrl+V', onSelect: () => void paste() },
      'separator',
      { label: 'Select All', shortcut: 'Ctrl+A', onSelect: edit('selectAll') },
      'separator',
      { label: 'Find…', shortcut: 'Ctrl+F', onSelect: find, disabled: !findable },
    ] },
    { label: 'View', items: [
      { label: panels.left ? 'Hide Sidebar' : 'Show Sidebar', shortcut: 'Ctrl+Alt+S', mac: 'Ctrl+Cmd+S', onSelect: toggleLeft },
      { label: panels.right ? 'Hide Inspector' : 'Show Inspector', shortcut: 'Ctrl+Alt+I', mac: 'Alt+Cmd+I', onSelect: toggleRight },
      'separator',
      { label: 'Skills', onSelect: () => setLibrary('skills') },
      { label: 'Memory', onSelect: () => setLibrary('memory') },
      { label: 'Soul', onSelect: () => setLibrary('soul') },
      { label: 'Plugins', onSelect: () => setLibrary('plugins') },
      // macOS adds its own Enter Full Screen (lib/nativeMenu.ts); Windows and Linux get the same command here.
      ...(chromeOs() === 'macos' ? [] : ['separator' as const, { label: fullScreen ? 'Exit Full Screen' : 'Enter Full Screen', shortcut: 'F11', onSelect: () => void toggleFullScreen() }]),
    ] },
    { label: 'Go', items: [
      { label: 'Back', shortcut: 'Alt+Left', mac: 'Cmd+[', onSelect: goBack, disabled: !past.length },
      { label: 'Forward', shortcut: 'Alt+Right', mac: 'Cmd+]', onSelect: goForward, disabled: !future.length },
      'separator',
      { label: 'Chat', shortcut: 'Ctrl+1', checked: currentView === 'chat', onSelect: go('chat') },
      { label: 'Work', shortcut: 'Ctrl+2', checked: currentView === 'work', onSelect: go('work') },
      { label: 'Images', shortcut: 'Ctrl+3', checked: currentView === 'images', onSelect: go('images') },
      { label: 'Voice', shortcut: 'Ctrl+4', checked: currentView === 'voice', onSelect: go('voice') },
      { label: 'Tasks', shortcut: 'Ctrl+5', checked: currentView === 'tasks', onSelect: go('tasks') },
      { label: 'Engines & Models', shortcut: 'Ctrl+6', checked: currentView === 'engines', onSelect: go('engines') },
    ] },
    { label: 'Help', items: [
      { label: 'Lotus Help', shortcut: 'F1', mac: 'Cmd+Shift+/', onSelect: openHelp },
      { label: 'Setup Guide…', onSelect: () => setSetupOpen(true) },
      'separator',
      { label: 'Check for Updates…', onSelect: () => { void updates.check(); openSettings('updates'); } },
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

  // Windows / Linux: every shortcut listed in the menus works from the keyboard (Edit's are left to the
  // text field itself). On the Mac the menu bar's key equivalents do this, so nothing runs twice.
  useEffect(() => {
    if (chromeOs() === 'macos' && isTauri) return;
    const h = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      for (const m of menusRef.current) {
        for (const it of m.items) {
          if (it === 'separator' || !it.shortcut || !matchesShortcut(e, it.shortcut)) continue;
          if (m.label === 'Edit' && it.label !== 'Find…') continue;
          e.preventDefault();
          if (!it.disabled) it.onSelect();
          return;
        }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // ── Layout ────────────────────────────────────────────────────────────────
  // Split view: translucent sidebar | content pane with a unified toolbar on top.
  const panel = (
    <main className="w-full flex-1 min-h-0 flex overflow-hidden text-[var(--color-text-main)]">
      <LeftRail
        currentView={currentView}
        onSelectView={setCurrentView}
        onOpenSettings={() => openSettings()}
        onOpenAccount={setAccountView}
        engines={eng.engines}
        updateAvailable={updates.state.kind === 'available'}
        dark={dark}
      />

      <div className="flex-1 min-w-0 flex flex-col overflow-hidden mb-2 mr-2 rounded-[12px] bg-[var(--color-bg-panel)] shadow-[0_0_0_0.5px_var(--sep),var(--shadow-1)]">
        {/* Chat, Work, Images and Voice (with Lotus's own engine) have no toolbar row: their controls live in the prompt box. */}
        <header className={currentView === 'chat' || currentView === 'images' || currentView === 'work' || (currentView === 'voice' && settings.voiceEngine === 'builtin') ? 'hidden' : 'h-14 shrink-0 flex items-center gap-3 px-3 border-b border-[var(--sep)]'} role="banner">
          <h1 className={currentView === 'voice' || currentView === 'engines' || currentView === 'chat' || currentView === 'images' || currentView === 'work' || currentView === 'tasks' ? 'sr-only' : 'text-[17px] font-semibold tracking-[-0.01em]'}>{VIEW_TITLES[currentView]}</h1>
          <div ref={setToolbarSlot} className="flex-1 min-w-0 self-stretch flex items-stretch gap-3 pr-2" />
        </header>
        <EnginesContext.Provider value={enginesCtx}>
        <ToolbarSlotContext.Provider value={toolbarSlot}>
        <PanelsProvider value={panelsApi}>
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {currentView === 'chat' && (
          <ChatWorkspace onCreateImage={createImage} chat={chat} settings={settings} onSettings={(p) => setSettings((s) => ({ ...s, ...p }))} models={models} ollamaUp={ollamaUp}
            onOpenModels={() => openEngines('models')} prefill={prefill} onOpenLibrary={setLibrary}
            research={research} onOpenEngines={() => openEngines('models')} />
        )}

        {currentView === 'images' && <ImageWorkspace g={gallery} checkpoints={checkpoints} comfyUp={comfyUp} builtin={builtinImages} profiles={readyProfiles} builtinLoras={builtins.imageFiles.loras.map((f) => f.file)} onOpenEngines={() => openEngines('engines')} onOpenModels={() => openEngines('models')} />}

        {currentView === 'voice' && <VoiceWorkspace onOpenInChat={openInChat} onOpenEngines={() => openEngines('models')} settings={settings} onSettings={(p) => setSettings((s) => ({ ...s, ...p }))} onOpenModels={() => openEngines('models')} />}


        {currentView === 'work' && <WorkWorkspace work={work} settings={settings} onSettings={(p) => setSettings((s) => ({ ...s, ...p }))} models={models} ollamaUp={ollamaUp}
          onOpenModels={() => openEngines('models')} onOpenSettings={() => openSettings('tools' as SettingsTab)} />}

        {currentView === 'tasks' && <TasksWorkspace settings={settings} onSettings={(p) => setSettings((s) => ({ ...s, ...p }))} ollamaUp={ollamaUp} request={tasksRequest} folder={chat.active?.folder} />}

        {currentView === 'engines' && <EnginesWorkspace eng={eng} initialTab={enginesTab} />}
        </div>
        </PanelsProvider>
        </ToolbarSlotContext.Provider>
        </EnginesContext.Provider>
      </div>
    </main>
  );

  if (setupOpen) {
    return (
      <div className="h-screen w-screen relative overflow-hidden">
        <WelcomeSetup eng={eng} onAccent={setSetupAccent} onClose={(st) => {
          setSetupOpen(false); void eng.refresh();
          // The guide's choice between Lotus's own engines and Ollama / ComfyUI / Voicebox (session 17).
          if (st.own === true) setSettings((x) => ({ ...x, llmBackend: 'builtin', imageEngine: 'builtin', voiceEngine: 'builtin' }));
          else if (st.own === false) setSettings((x) => ({ ...x, llmBackend: 'ollama', imageEngine: 'comfyui', voiceEngine: 'voicebox' }));
        }} />
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
      <AccountModal open={accountView !== null} view={accountView ?? 'signin'} onView={setAccountView} onClose={() => setAccountView(null)} sessions={chat.sessions} engines={eng.engines} />
      <AlertHost />
      <CoreNotice />
      <SettingsModal isOpen={isSettingsOpen} pane={settingsPane} onClose={closeSettings} models={models} settings={settings} onUpdateSettings={(n) => setSettings((s) => ({ ...s, ...n }))} updates={updates} />
    </div>
  );
}
