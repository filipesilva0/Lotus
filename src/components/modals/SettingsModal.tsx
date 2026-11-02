import React, { useEffect, useState } from 'react';
import { chromeOs } from '../common/TitleBar';
import {
  X,
  Sliders,
  Cpu,
  MessageSquare,
  Volume2,
  HardDrive,
  Palette,
  Keyboard,
  Shield,
  Download,
  Trash2,
  Check,
  SunMoon,
  RefreshCw,
  Folder,
  Sparkles,
  Zap,
  Server,
  Code2,
  FileText,
  RotateCcw,
  Sun,
  Moon,
} from 'lucide-react';
import { LotusSettings } from '../../types/lotus';
import { IslandSettingsPanel, VoiceSettingsPanel } from './IslandSettingsPanel';
import { Toggle } from '../common/Toggle';
import { Segmented, Select, IconBtn, Btn } from '../common/ui';
import { PALETTES, FONTS, PAGE_PALETTE, PETAL_ORDER } from '../../styles/theme';
import type { FontFamily } from '../../types/lotus';
import { VIEW_TITLES } from '../rail/LeftRail';
import { PillSlider } from '../common/PillSlider';
import { THIRD_PARTY_LICENSES_TEXT } from '../../data/licenses';
import { ollamaClient } from '../../services/ollamaService';
import { UpdatesPanel } from './UpdatesPanel';
import { EngineScalingPanel, MemorySkillsPanel, WebSearchPanel } from './LocalAgentSettings';
import type { Updates } from '../../hooks/useUpdates';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: LotusSettings;
  onUpdateSettings: (newSettings: Partial<LotusSettings>) => void;
  updates: Updates;
  /** Installed chat models (for the background tasks model). */
  models: { id: string; name: string; tag: string }[];
  /** Open on this pane (e.g. Help › Check for Updates…); otherwise the last pane used. */
  pane?: SettingsTab | null;
}

const PANE_KEY = 'lotus.settingsPane.v1';
export type SettingsTab =
  | 'inference'
  | 'engine'
  | 'memory'
  | 'chat'
  | 'voice'
  | 'island'
  | 'appearance'
  | 'updates'
  | 'licenses';

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  updates,
  models,
  pane,
}) => {
  // HIG Settings: reopen on the pane used last.
  const [activeTab, setActiveTabRaw] = useState<SettingsTab>(() => {
    if (pane) return pane;
    try { return (localStorage.getItem(PANE_KEY) as SettingsTab | null) ?? 'inference'; } catch { return 'inference'; }
  });
  const setActiveTab = (t: SettingsTab) => { setActiveTabRaw(t); try { localStorage.setItem(PANE_KEY, t); } catch { /* memory only */ } };
  useEffect(() => { if (isOpen && pane) setActiveTabRaw(pane); }, [isOpen, pane]);
  useEffect(() => {
    if (!isOpen) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isOpen, onClose]);
  const [ollamaCheckStatus, setOllamaCheckStatus] = useState<'idle' | 'checking' | 'online' | 'offline'>('idle');
  const [copiedShortcut, setCopiedShortcut] = useState(false);

  if (!isOpen) return null;

  const handleTestOllama = async () => {
    setOllamaCheckStatus('checking');
    const isOnline = await ollamaClient.checkHealth();
    setOllamaCheckStatus(isOnline ? 'online' : 'offline');
    setTimeout(() => setOllamaCheckStatus('idle'), 3500);
  };

  const handleExportChats = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(
      JSON.stringify({ exportedAt: new Date().toISOString(), platform: "Lotus Local AI" }, null, 2)
    );
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `lotus-conversations-export-${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const tabs: { id: SettingsTab; label: string; icon: React.ElementType }[] = [
    { id: 'inference', label: 'Models', icon: Sliders },
    { id: 'engine', label: 'Engines', icon: Server },
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'memory', label: 'Memory', icon: Sparkles },
    { id: 'voice', label: 'Voice', icon: Volume2 },
    { id: 'island', label: 'Island', icon: Cpu },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'updates', label: 'Updates', icon: Download },
    { id: 'licenses', label: 'Legal', icon: Shield },
  ];
  const paneName = tabs.find((t) => t.id === activeTab)?.label ?? 'Settings';
  const mac = chromeOs() === 'macos';
  const closeBtn = <IconBtn label="Close Settings" onClick={onClose}><X className="w-4 h-4" /></IconBtn>;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh] px-4 bg-black/25 dark:bg-black/45 select-none" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={`Settings: ${paneName}`} className="material-frosted w-full max-w-3xl rounded-[12px] flex flex-col h-[84vh] max-h-[640px] overflow-hidden">
        {/* HIG Settings: the title is the pane's name; a fixed pane toolbar shows which pane is open. */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center px-2 h-10 shrink-0">
          <div className="flex">{mac && closeBtn}</div>
          <h2 className="text-[13px] font-semibold text-[var(--color-text-main)]">{paneName}</h2>
          <div className="flex justify-end">{!mac && closeBtn}</div>
        </div>
        <nav className="shrink-0 flex justify-center gap-0.5 px-3 pb-2 border-b border-[var(--sep)] overflow-x-auto" aria-label="Settings panes" role="tablist">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button key={tab.id} type="button" role="tab" aria-selected={isActive} onClick={() => setActiveTab(tab.id)}
                className={`min-w-[64px] px-2 pt-1.5 pb-1 flex flex-col items-center gap-0.5 rounded-[8px] text-[12px] transition-colors focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)] ${isActive ? 'bg-[var(--pressed)] text-[var(--color-text-main)] font-medium' : 'text-[var(--color-text-muted)] hover:bg-[var(--hover)] hover:text-[var(--color-text-main)]'}`}>
                <Icon className={`w-5 h-5 ${isActive ? 'text-[var(--color-accent-vibrant)]' : ''}`} strokeWidth={1.6} aria-hidden="true" />
                <span className="whitespace-nowrap">{tab.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="flex-1 min-h-0 flex">
        {/* Section content */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Body Content */}
          <div className="flex-1 overflow-y-auto px-5 pt-2 pb-5">
            {/* 1. Model & Inference Parameters (formerly in Card B & Weights) */}
            {activeTab === 'inference' && (
              <div className="space-y-5">
                {/* Background tasks model (session 7). The chat model is picked in the chat composer. */}
                <div className="py-3.5 border-b border-[var(--sep)] last:border-b-0 space-y-2">
                  <div>
                    <span className="text-xs font-semibold text-[var(--color-text-main)]">Background tasks model</span>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      Runs Lotus's own housekeeping: learning memories, writing skills and naming chats. A small, fast model keeps this light; the chat model is chosen next to the message box.
                    </p>
                  </div>
                  <select
                    aria-label="Background tasks model"
                    value={settings.backgroundModel}
                    onChange={(e) => onUpdateSettings({ backgroundModel: e.target.value })}
                    className="w-full h-9 bg-[var(--color-bg-card)] rounded-[10px] px-3 text-xs font-semibold text-[var(--color-text-main)] border border-[var(--sep)] focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)]"
                  >
                    <option value="">Same as the chat model{settings.selectedModel ? ` (${settings.selectedModel})` : ''}</option>
                    {models.map((m) => <option key={m.id} value={m.id}>{m.name}{m.tag ? ` · ${m.tag}` : ''}</option>)}
                    {settings.backgroundModel && !models.some((m) => m.id === settings.backgroundModel) && (
                      <option value={settings.backgroundModel}>{settings.backgroundModel} (not installed)</option>
                    )}
                  </select>
                  {settings.backgroundModel && !models.some((m) => m.id === settings.backgroundModel) && models.length > 0 && (
                    <p className="text-xs text-[var(--c-red)]">This model is not installed, so background tasks will fail. Pick another or download it in Models.</p>
                  )}
                  {!models.length && <p className="text-xs text-[var(--color-text-muted)]">Start Ollama to list your installed models.</p>}
                  <div className="flex items-center justify-between pt-1.5">
                    <div>
                      <span className="text-xs font-semibold text-[var(--color-text-main)]">Auto-rename chats</span>
                      <p className="text-xs text-[var(--color-text-muted)]">After the first reply, give the chat a short title. Titles you type yourself are never changed.</p>
                    </div>
                    <Toggle checked={settings.autoRename} onChange={(v) => onUpdateSettings({ autoRename: v })} ariaLabel="Auto-rename chats" />
                  </div>
                </div>

                {/* Temperature Pill Slider */}
                <div className="py-3.5 border-b border-[var(--sep)] last:border-b-0 space-y-3">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="text-xs font-semibold text-[var(--color-text-main)]">
                        Temperature (Sampling Randomness)
                      </span>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        0.2 for precise coding, 0.7 for balanced chat, 1.1+ for creative generation.
                      </p>
                    </div>
                    <span className="font-mono text-xs font-semibold text-[var(--c-green)] bg-[var(--color-bg-card)]  px-2.5 py-1 rounded-[6px] ">
                      {settings.temperature.toFixed(2)}
                    </span>
                  </div>

                  <PillSlider
                    value={Math.round(settings.temperature * 100)}
                    onChange={(val) => onUpdateSettings({ temperature: val / 100 })}
                    min={0}
                    max={150}
                    unit=""
                  />

                  {/* Preset Quick Chips */}
                  <div className="flex gap-2 pt-1 text-xs">
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ temperature: 0.2 })}
                      className="px-2.5 py-0.5 rounded-[6px] bg-[var(--color-bg-card)]  text-[var(--color-text-main)] border border-[var(--sep)] hover:border-[var(--color-accent-vibrant)] transition-colors"
                    >
                      Precise (0.2)
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ temperature: 0.7 })}
                      className="px-2.5 py-0.5 rounded-[6px] bg-[var(--color-bg-card)]  text-[var(--color-text-main)] border border-[var(--sep)] hover:border-[var(--color-accent-vibrant)] transition-colors"
                    >
                      Balanced (0.7)
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ temperature: 1.1 })}
                      className="px-2.5 py-0.5 rounded-[6px] bg-[var(--color-bg-card)]  text-[var(--color-text-main)] border border-[var(--sep)] hover:border-[var(--color-accent-vibrant)] transition-colors"
                    >
                      Creative (1.1)
                    </button>
                  </div>
                </div>

                {/* Top-P Nucleus Sampling */}
                <div className="py-3.5 border-b border-[var(--sep)] last:border-b-0 space-y-2">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="text-xs font-semibold text-[var(--color-text-main)]">
                        Top-P (Nucleus Sampling)
                      </span>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        Limits token selection to top cumulative probability mass.
                      </p>
                    </div>
                    <span className="font-mono text-xs font-semibold text-[var(--c-green)] bg-[var(--color-bg-card)]  px-2.5 py-1 rounded-[6px] ">
                      {settings.topP.toFixed(2)}
                    </span>
                  </div>
                  <PillSlider
                    value={Math.round(settings.topP * 100)}
                    onChange={(val) => onUpdateSettings({ topP: val / 100 })}
                    min={10}
                    max={100}
                    unit="%"
                  />
                </div>

                {/* Context Window Length */}
                <div className="py-3.5 border-b border-[var(--sep)] last:border-b-0 space-y-2">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="text-xs font-semibold text-[var(--color-text-main)]">
                        Context Window (Max Tokens)
                      </span>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {settings.autoScale ? `Auto-scaling is on (Settings → Engines), so chat uses the size free video memory allows; this value is used when it is off.` : "KV cache size allocated in VRAM for conversation memory."}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[2048, 4096, 8192, 16384].map((ctx) => (
                      <button
                        key={ctx}
                        type="button"
                        onClick={() => onUpdateSettings({ contextWindow: ctx })}
                        className={`py-2 rounded-[10px] text-xs font-semibold transition-all border ${
                          settings.contextWindow === ctx
                            ? 'bg-[var(--color-accent-fill)] text-white border-transparent'
                            : 'bg-[var(--color-bg-card)] text-[var(--color-text-main)] border-[var(--sep)] hover:border-[var(--color-accent-vibrant)]'
                        }`}
                      >
                        {ctx >= 1000 ? `${ctx / 1024}K tokens` : `${ctx} tokens`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Reasoning <think> Block Mode */}
                <div className="py-3.5 border-b border-[var(--sep)] last:border-b-0 space-y-2">
                  <div>
                    <span className="text-xs font-semibold text-[var(--color-text-main)]">
                      Deep Reasoning &lt;think&gt; Display
                    </span>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      How DeepSeek R1 and reasoning models render internal chain-of-thought blocks.
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'collapsed' as const, label: 'Collapsed Pill' },
                      { id: 'expanded' as const, label: 'Expanded Stream' },
                      { id: 'hidden' as const, label: 'Hide Thoughts' },
                    ].map((mode) => (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() => onUpdateSettings({ reasoningBlockMode: mode.id })}
                        className={`py-1.5 rounded-[10px] text-xs font-semibold transition-all border ${
                          settings.reasoningBlockMode === mode.id
                            ? 'bg-[var(--color-accent-fill)] text-white border-transparent'
                            : 'bg-[var(--color-bg-card)] text-[var(--color-text-main)] border-[var(--sep)]'
                        }`}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* System Prompt / Custom Instructions */}
                <div className="py-3.5 border-b border-[var(--sep)] last:border-b-0 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-semibold text-[var(--color-text-main)]">
                      Custom System Instructions (Odysseus / ChatGPT Persona)
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateSettings({
                          systemPrompt:
                            'You are Lotus, an intelligent local AI engineer and creative assistant. Answer concisely and accurately.',
                        })
                      }
                      className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] dark:hover:text-white flex items-center gap-1"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Reset</span>
                    </button>
                  </div>
                  <textarea
                    value={settings.systemPrompt}
                    onChange={(e) => onUpdateSettings({ systemPrompt: e.target.value })}
                    rows={3}
                    placeholder="Provide overarching guidelines for how the model should behave, respond, and format answers…"
                    className="w-full p-3 bg-[var(--color-bg-card)]  rounded-[10px] text-xs text-[var(--color-text-main)] border border-[var(--sep)] focus:outline-none resize-none leading-relaxed"
                  />
                </div>
              </div>
            )}

            {/* 2. Local Engines & Hardware */}
            {activeTab === 'chat' && (
              <div className="space-y-4">
                {/* Send on Enter */}
                <div className="py-3.5 border-b border-[var(--sep)] last:border-b-0 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-[var(--color-text-main)]">
                      Send Message with Enter
                    </span>
                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                      Pressing Enter submits message; Shift + Enter creates a new line.
                    </p>
                  </div>
                  <Toggle
                    checked={settings.sendOnEnter}
                    onChange={(val) => onUpdateSettings({ sendOnEnter: val })}
                  />
                </div>

                {/* Auto Scroll */}
                <div className="py-3.5 border-b border-[var(--sep)] last:border-b-0 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-[var(--color-text-main)]">
                      Auto-Scroll During Generation
                    </span>
                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                      Smoothly scrolls viewport down as incoming tokens stream in real time.
                    </p>
                  </div>
                  <Toggle
                    checked={settings.autoScroll}
                    onChange={(val) => onUpdateSettings({ autoScroll: val })}
                  />
                </div>

                {/* Code Copy Language */}
                <div className="py-3.5 border-b border-[var(--sep)] last:border-b-0 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-[var(--color-text-main)]">
                      Include Language Header on Code Copy
                    </span>
                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                      Copies markdown ```typescript tags alongside code snippets.
                    </p>
                  </div>
                  <Toggle
                    checked={settings.codeCopyLanguage}
                    onChange={(val) => onUpdateSettings({ codeCopyLanguage: val })}
                  />
                </div>

                <WebSearchPanel settings={settings} onUpdateSettings={onUpdateSettings} />
              </div>
            )}

            {activeTab === 'engine' && <EngineScalingPanel settings={settings} onUpdateSettings={onUpdateSettings} />}

            {activeTab === 'memory' && <MemorySkillsPanel settings={settings} onUpdateSettings={onUpdateSettings} />}

            {/* 4. Voice & Speech (Kokoro & Whisper) */}
            {activeTab === 'appearance' && (
              <div className="space-y-5">
                <section aria-labelledby="appearance-h" className="divide-y divide-[var(--sep)] border-b border-[var(--sep)]">
                  <h4 id="appearance-h" className="sr-only">Appearance</h4>
                  <div className="flex items-center justify-between gap-4 py-3">
                    <div>
                      <span className="text-[13px] block">Appearance</span>
                      <span className="text-[12px] text-[var(--color-text-muted)]">Auto follows your system's light or dark setting.</span>
                    </div>
                    <Segmented
                      label="Appearance"
                      value={settings.appearance}
                      onChange={(v) => onUpdateSettings({ appearance: v })}
                      options={[
                        { id: 'auto', label: 'Auto', icon: <SunMoon className="w-3.5 h-3.5" aria-hidden="true" /> },
                        { id: 'light', label: 'Light', icon: <Sun className="w-3.5 h-3.5" aria-hidden="true" /> },
                        { id: 'dark', label: 'Dark', icon: <Moon className="w-3.5 h-3.5" aria-hidden="true" /> },
                      ]}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-4 py-3">
                    <div>
                      <span className="text-[13px] block">Accent colours</span>
                      <span className="text-[12px] text-[var(--color-text-muted)]">Each page uses its own petal of the Lotus mark: {PETAL_ORDER.map((id) => `${VIEW_TITLES[id]} ${PALETTES[PAGE_PALETTE[id]].name.toLowerCase()}`).join(', ')}.</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-4 py-3">
                    <div>
                      <span className="text-[13px] block">Interface font</span>
                      <span className="text-[12px] text-[var(--color-text-muted)]">System uses San Francisco on Mac and Segoe UI on Windows.</span>
                    </div>
                    <div className="w-56 shrink-0">
                      <Select aria-label="Interface font" value={settings.fontFamily} onChange={(e) => onUpdateSettings({ fontFamily: e.target.value as FontFamily })}>
                        {(Object.keys(FONTS) as FontFamily[]).map((id) => <option key={id} value={id}>{FONTS[id].name}</option>)}
                      </Select>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-4 py-3">
                    <div>
                      <span className="text-[13px] block">Text size</span>
                      <span className="text-[12px] text-[var(--color-text-muted)]">Scales every label and control.</span>
                    </div>
                    <Segmented
                      label="Text size"
                      value={settings.fontSize}
                      onChange={(v) => onUpdateSettings({ fontSize: v })}
                      options={[{ id: 'sm', label: 'Small' }, { id: 'md', label: 'Default' }, { id: 'lg', label: 'Large' }]}
                    />
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'island' && <IslandSettingsPanel />}

            {activeTab === 'voice' && <VoiceSettingsPanel settings={settings} onUpdateSettings={onUpdateSettings} />}

            {activeTab === 'updates' && <UpdatesPanel u={updates} />}

            {activeTab === 'licenses' && (
              <div className="space-y-3">
                <span className="text-xs font-semibold text-[var(--color-text-main)]">
                  Open Source Notices & THIRD_PARTY_LICENSES.md
                </span>
                <pre className="p-4 bg-[var(--hover)] rounded-[10px] text-xs text-[var(--color-text-main)] dark:text-slate-300 font-mono whitespace-pre-wrap max-h-72 overflow-y-auto leading-relaxed">
                  {THIRD_PARTY_LICENSES_TEXT}
                </pre>
              </div>
            )}
          </div>

        </div>
        </div>
      </div>
    </div>
  );
};
