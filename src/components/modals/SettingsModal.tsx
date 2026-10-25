import React, { useState } from 'react';
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
import { Segmented, Select, IconBtn } from '../common/ui';
import { PALETTES, FONTS } from '../../styles/theme';
import type { ColorPalette, FontFamily } from '../../types/lotus';
import { PillSlider } from '../common/PillSlider';
import { THIRD_PARTY_LICENSES_TEXT } from '../../data/licenses';
import { ollamaClient } from '../../services/ollamaService';
import { UpdatesPanel } from './UpdatesPanel';
import type { Updates } from '../../hooks/useUpdates';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: LotusSettings;
  onUpdateSettings: (newSettings: Partial<LotusSettings>) => void;
  updates: Updates;
}

type SettingsTab =
  | 'inference'
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
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('inference');
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
    { id: 'inference', label: 'Model & Inference', icon: Sliders },
    { id: 'chat', label: 'Chat & Formatting', icon: MessageSquare },
    { id: 'voice', label: 'Voice', icon: Volume2 },
    { id: 'island', label: 'Island & Agents', icon: Cpu },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'updates', label: 'About & Updates', icon: Download },
    { id: 'licenses', label: 'Licenses & Legal', icon: Shield },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/25 dark:bg-black/45 select-none" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Settings" className="material-overlay w-full max-w-4xl rounded-[12px] flex flex-col md:flex-row h-[90vh] max-h-[640px] overflow-hidden">
        {/* Left Settings Sidebar */}
        <div className="material-sidebar w-full md:w-56 p-3 flex flex-col justify-between border-b md:border-b-0 md:border-r border-[var(--color-border-subtle)] shrink-0">
          <div>
            <div className="px-2 py-1 mb-3">
              <h2 className="text-[15px] font-semibold text-[var(--color-text-main)] leading-tight">Settings</h2>
            </div>

            <nav className="space-y-1 overflow-y-auto max-h-[460px] no-scrollbar">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center gap-2 px-2 h-7 rounded-[6px] text-[13px] transition-colors text-left focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)] ${isActive ? 'bg-[var(--color-accent-fill)] text-white font-medium' : 'text-[var(--color-text-main)] hover:bg-[var(--hover)]'}`}
                  >
                    <Icon className="w-4 h-4 shrink-0" strokeWidth={1.7} aria-hidden="true" />
                    <span className="truncate">{tab.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="pt-3 border-t border-[var(--color-border-subtle)] px-2 text-xs text-[var(--color-text-muted)]">
            <span>{updates.version ? `Lotus ${updates.version}` : 'Lotus'} · Local AI Studio</span>
          </div>
        </div>

        {/* Right Settings Content Area */}
        <div className="flex-1 flex flex-col justify-between overflow-hidden bg-[var(--color-bg-panel)]">
          {/* Header */}
          <div className="h-14 px-6 border-b border-[var(--color-border-subtle)] flex items-center justify-between shrink-0">
            <h3 className="text-[15px] font-semibold text-[var(--color-text-main)]">
              {tabs.find((t) => t.id === activeTab)?.label}
            </h3>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* 1. Model & Inference Parameters (formerly in Card B & Weights) */}
            {activeTab === 'inference' && (
              <div className="space-y-5">
                {/* Default Model */}
                <div className="p-4 bg-[var(--color-bg-sidebar)] rounded-[10px] space-y-2 border border-[var(--sep)]">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="text-xs font-semibold text-[var(--color-text-main)]">
                        Active Model Checkpoint
                      </span>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        Default neural weights used for conversation and vision analysis.
                      </p>
                    </div>
                  </div>
                  <select
                    value={settings.selectedModel}
                    onChange={(e) => onUpdateSettings({ selectedModel: e.target.value })}
                    className="w-full h-9 bg-[var(--color-bg-card)]  rounded-[10px] px-3 text-xs font-semibold text-[var(--color-text-main)] border border-[var(--sep)] focus:outline-none cursor-pointer"
                  >
                    <option value="llama3.2:3b">Llama 3.2 3B Instruct (Ultra Fast · Meta)</option>
                    <option value="qwen2.5-coder:7b">Qwen 2.5 Coder 7B (Code Specialist · Alibaba)</option>
                    <option value="mistral-nemo:12b">Mistral NeMo 12B (Extended Reasoning · Mistral)</option>
                    <option value="deepseek-r1:8b">DeepSeek R1 Distill 8B (Deep Thinking)</option>
                  </select>
                </div>

                {/* Temperature Pill Slider */}
                <div className="p-4 bg-[var(--color-bg-sidebar)] rounded-[10px] space-y-3 border border-[var(--sep)]">
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
                <div className="p-4 bg-[var(--color-bg-sidebar)] rounded-[10px] space-y-2 border border-[var(--sep)]">
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
                <div className="p-4 bg-[var(--color-bg-sidebar)] rounded-[10px] space-y-2 border border-[var(--sep)]">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="text-xs font-semibold text-[var(--color-text-main)]">
                        Context Window (Max Tokens)
                      </span>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        KV Cache size allocated in VRAM for conversation memory.
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
                <div className="p-4 bg-[var(--color-bg-sidebar)] rounded-[10px] space-y-2 border border-[var(--sep)]">
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
                <div className="p-4 bg-[var(--color-bg-sidebar)] rounded-[10px] space-y-2 border border-[var(--sep)]">
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
                    placeholder="Provide overarching guidelines for how the model should behave, respond, and format answers..."
                    className="w-full p-3 bg-[var(--color-bg-card)]  rounded-[10px] text-xs text-[var(--color-text-main)] border border-[var(--sep)] focus:outline-none resize-none leading-relaxed"
                  />
                </div>
              </div>
            )}

            {/* 2. Local Engines & Hardware */}
            {activeTab === 'chat' && (
              <div className="space-y-4">
                {/* Send on Enter */}
                <div className="p-4 bg-[var(--color-bg-sidebar)] rounded-[10px] flex items-center justify-between border border-[var(--sep)]">
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
                <div className="p-4 bg-[var(--color-bg-sidebar)] rounded-[10px] flex items-center justify-between border border-[var(--sep)]">
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
                <div className="p-4 bg-[var(--color-bg-sidebar)] rounded-[10px] flex items-center justify-between border border-[var(--sep)]">
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
              </div>
            )}

            {/* 4. Voice & Speech (Kokoro & Whisper) */}
            {activeTab === 'appearance' && (
              <div className="space-y-5">
                <section aria-labelledby="appearance-h" className="rounded-[10px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)] divide-y divide-[var(--sep)]">
                  <h4 id="appearance-h" className="sr-only">Appearance</h4>
                  <div className="flex items-center justify-between gap-4 px-4 py-3">
                    <span className="text-[13px]">Appearance</span>
                    <Segmented
                      label="Appearance"
                      value={settings.darkMode ? 'dark' : 'light'}
                      onChange={(v) => onUpdateSettings({ darkMode: v === 'dark' })}
                      options={[
                        { id: 'light', label: 'Light', icon: <Sun className="w-3.5 h-3.5" aria-hidden="true" /> },
                        { id: 'dark', label: 'Dark', icon: <Moon className="w-3.5 h-3.5" aria-hidden="true" /> },
                      ]}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-4 px-4 py-3">
                    <span className="text-[13px]">Accent colour</span>
                    <div role="radiogroup" aria-label="Accent colour" className="flex items-center gap-2">
                      {(Object.keys(PALETTES) as ColorPalette[]).map((id) => {
                        const pal = PALETTES[id]; const on = settings.palette === id;
                        return (
                          <button key={id} type="button" role="radio" aria-checked={on} aria-label={pal.name} title={pal.name}
                            onClick={() => onUpdateSettings({ palette: id })}
                            className="w-5 h-5 rounded-full flex items-center justify-center focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)] focus-visible:outline-offset-2"
                            style={{ background: pal.vibrant, boxShadow: on ? `0 0 0 2px var(--color-bg-card), 0 0 0 4px ${pal.vibrant}` : 'inset 0 0 0 0.5px rgba(0,0,0,.25)' }}>
                            {on && <Check className="w-3 h-3 text-white" strokeWidth={3.4} aria-hidden="true" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-4 px-4 py-3">
                    <div>
                      <span className="text-[13px] block">Interface font</span>
                      <span className="text-[12px] text-[var(--color-text-muted)]">System uses San Francisco on Mac and Segoe UI on Windows.</span>
                    </div>
                    <div className="w-44">
                      <Select aria-label="Interface font" value={settings.fontFamily} onChange={(e) => onUpdateSettings({ fontFamily: e.target.value as FontFamily })}>
                        {(Object.keys(FONTS) as FontFamily[]).map((id) => <option key={id} value={id}>{FONTS[id].name}</option>)}
                      </Select>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-4 px-4 py-3">
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
                <pre className="p-4 bg-[var(--color-bg-sidebar)] rounded-[10px] text-xs text-[var(--color-text-main)] dark:text-slate-300 font-mono whitespace-pre-wrap max-h-72 overflow-y-auto leading-relaxed border border-[var(--sep)]">
                  {THIRD_PARTY_LICENSES_TEXT}
                </pre>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="h-14 px-6 border-t border-[#EBECEF] dark:border-[#1E293B] flex items-center justify-between shrink-0">
            <span className="text-xs text-[var(--color-text-muted)]">
              Configuration changes are saved automatically.
            </span>
            <button
              onClick={onClose}
              className="px-5 py-2 rounded-[6px] bg-[var(--color-accent-fill)] text-white text-xs font-semibold hover:scale-105 active:scale-95 transition-transform"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
