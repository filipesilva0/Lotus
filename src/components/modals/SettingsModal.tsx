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
} from 'lucide-react';
import { LotusSettings } from '../../types/lotus';
import { IslandSettingsPanel, VoiceSettingsPanel } from './IslandSettingsPanel';
import { Toggle } from '../common/Toggle';
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/50 backdrop-blur-sm select-none animate-fadeIn">
      <div className="w-full max-w-4xl bg-[var(--color-bg-panel)] rounded-[28px] shadow-2xl border border-black/5 dark:border-[var(--color-border-subtle)] flex flex-col md:flex-row h-[90vh] max-h-[640px] overflow-hidden">
        {/* Left Settings Sidebar */}
        <div className="w-full md:w-60 bg-[var(--color-bg-sidebar)] p-4 flex flex-col justify-between border-b md:border-b-0 md:border-r border-[var(--color-border-subtle)] shrink-0">
          <div>
            <div className="px-2 py-1 mb-3">
              <span className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
                Lotus Studio Settings
              </span>
              <h2 className="text-sm font-bold text-[var(--color-text-main)] leading-tight">
                Preferences
              </h2>
            </div>

            <nav className="space-y-1 overflow-y-auto max-h-[460px] no-scrollbar">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs transition-all text-left ${
                      isActive
                        ? 'bg-[var(--color-accent-pastel)] border border-[var(--color-accent-pastel-border)] text-[var(--color-accent-vibrant)] font-bold shadow-xs'
                        : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] hover:bg-[var(--color-accent-pastel)]/40 dark:hover:bg-[#282B34]'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" strokeWidth={1.75} />
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
            <h3 className="text-xs font-bold text-[var(--color-text-main)] uppercase tracking-wider">
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
                <div className="p-4 bg-[var(--color-bg-sidebar)] rounded-2xl space-y-2 border border-black/5 dark:border-white/5">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="text-xs font-bold text-[var(--color-text-main)]">
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
                    className="w-full h-9 bg-white dark:bg-[#0E1A33] rounded-xl px-3 text-xs font-semibold text-[var(--color-text-main)] border border-black/5 dark:border-white/10 focus:outline-none cursor-pointer"
                  >
                    <option value="llama3.2:3b">Llama 3.2 3B Instruct (Ultra Fast · Meta)</option>
                    <option value="qwen2.5-coder:7b">Qwen 2.5 Coder 7B (Code Specialist · Alibaba)</option>
                    <option value="mistral-nemo:12b">Mistral NeMo 12B (Extended Reasoning · Mistral)</option>
                    <option value="deepseek-r1:8b">DeepSeek R1 Distill 8B (Deep Thinking)</option>
                  </select>
                </div>

                {/* Temperature Pill Slider */}
                <div className="p-4 bg-[var(--color-bg-sidebar)] rounded-2xl space-y-3 border border-black/5 dark:border-white/5">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="text-xs font-bold text-[var(--color-text-main)]">
                        Temperature (Sampling Randomness)
                      </span>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        0.2 for precise coding, 0.7 for balanced chat, 1.1+ for creative generation.
                      </p>
                    </div>
                    <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-white dark:bg-[#0E1A33] px-2.5 py-1 rounded-full shadow-xs">
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
                      className="px-2.5 py-0.5 rounded-full bg-white dark:bg-[#0E1A33] text-[var(--color-text-main)] border border-black/5 dark:border-white/10 hover:border-[#0E1A33] transition-colors"
                    >
                      Precise (0.2)
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ temperature: 0.7 })}
                      className="px-2.5 py-0.5 rounded-full bg-white dark:bg-[#0E1A33] text-[var(--color-text-main)] border border-black/5 dark:border-white/10 hover:border-[#0E1A33] transition-colors"
                    >
                      Balanced (0.7)
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ temperature: 1.1 })}
                      className="px-2.5 py-0.5 rounded-full bg-white dark:bg-[#0E1A33] text-[var(--color-text-main)] border border-black/5 dark:border-white/10 hover:border-[#0E1A33] transition-colors"
                    >
                      Creative (1.1)
                    </button>
                  </div>
                </div>

                {/* Top-P Nucleus Sampling */}
                <div className="p-4 bg-[var(--color-bg-sidebar)] rounded-2xl space-y-2 border border-black/5 dark:border-white/5">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="text-xs font-bold text-[var(--color-text-main)]">
                        Top-P (Nucleus Sampling)
                      </span>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        Limits token selection to top cumulative probability mass.
                      </p>
                    </div>
                    <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-white dark:bg-[#0E1A33] px-2.5 py-1 rounded-full shadow-xs">
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
                <div className="p-4 bg-[var(--color-bg-sidebar)] rounded-2xl space-y-2 border border-black/5 dark:border-white/5">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="text-xs font-bold text-[var(--color-text-main)]">
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
                        className={`py-2 rounded-xl text-xs font-semibold transition-all border ${
                          settings.contextWindow === ctx
                            ? 'bg-[#0E1A33] dark:bg-white text-white dark:text-[var(--color-text-main)] border-transparent shadow-xs'
                            : 'bg-white dark:bg-[#0E1A33] text-[var(--color-text-main)] border-black/5 dark:border-white/10 hover:border-[#0E1A33]'
                        }`}
                      >
                        {ctx >= 1000 ? `${ctx / 1024}K tokens` : `${ctx} tokens`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Reasoning <think> Block Mode */}
                <div className="p-4 bg-[var(--color-bg-sidebar)] rounded-2xl space-y-2 border border-black/5 dark:border-white/5">
                  <div>
                    <span className="text-xs font-bold text-[var(--color-text-main)]">
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
                        className={`py-1.5 rounded-xl text-xs font-semibold transition-all border ${
                          settings.reasoningBlockMode === mode.id
                            ? 'bg-[#0E1A33] dark:bg-white text-white dark:text-[var(--color-text-main)] border-transparent shadow-xs'
                            : 'bg-white dark:bg-[#0E1A33] text-[var(--color-text-main)] border-black/5 dark:border-white/10'
                        }`}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* System Prompt / Custom Instructions */}
                <div className="p-4 bg-[var(--color-bg-sidebar)] rounded-2xl space-y-2 border border-black/5 dark:border-white/5">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-[var(--color-text-main)]">
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
                    className="w-full p-3 bg-white dark:bg-[#0E1A33] rounded-xl text-xs text-[var(--color-text-main)] border border-black/5 dark:border-white/10 focus:outline-none resize-none leading-relaxed"
                  />
                </div>
              </div>
            )}

            {/* 2. Local Engines & Hardware */}
            {activeTab === 'chat' && (
              <div className="space-y-4">
                {/* Send on Enter */}
                <div className="p-4 bg-[var(--color-bg-sidebar)] rounded-2xl flex items-center justify-between border border-black/5 dark:border-white/5">
                  <div>
                    <span className="text-xs font-bold text-[var(--color-text-main)]">
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
                <div className="p-4 bg-[var(--color-bg-sidebar)] rounded-2xl flex items-center justify-between border border-black/5 dark:border-white/5">
                  <div>
                    <span className="text-xs font-bold text-[var(--color-text-main)]">
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
                <div className="p-4 bg-[var(--color-bg-sidebar)] rounded-2xl flex items-center justify-between border border-black/5 dark:border-white/5">
                  <div>
                    <span className="text-xs font-bold text-[var(--color-text-main)]">
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

                {/* Message Density */}
                <div className="p-4 bg-[var(--color-bg-sidebar)] rounded-2xl flex items-center justify-between border border-black/5 dark:border-white/5">
                  <div>
                    <span className="text-xs font-bold text-[var(--color-text-main)]">
                      Message Layout Density
                    </span>
                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                      Choose between spacious comfortable bubbles or tight developer density.
                    </p>
                  </div>
                  <div className="flex bg-white dark:bg-[#0E1A33] p-1 rounded-full border border-black/5 dark:border-white/10 text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ density: 'comfortable' })}
                      className={`px-3 py-1 rounded-full transition-all ${
                        settings.density === 'comfortable'
                          ? 'bg-[#0E1A33] dark:bg-white text-white dark:text-[var(--color-text-main)]'
                          : 'text-[var(--color-text-muted)]'
                      }`}
                    >
                      Comfortable
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ density: 'compact' })}
                      className={`px-3 py-1 rounded-full transition-all ${
                        settings.density === 'compact'
                          ? 'bg-[#0E1A33] dark:bg-white text-white dark:text-[var(--color-text-main)]'
                          : 'text-[var(--color-text-muted)]'
                      }`}
                    >
                      Compact
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 4. Voice & Speech (Kokoro & Whisper) */}
            {activeTab === 'appearance' && (
              <div className="space-y-5">
                {/* Mode: Light vs Dark */}
                <div className="p-4 bg-[var(--color-bg-sidebar)] rounded-2xl space-y-3 border border-[var(--color-accent-pastel-border)] dark:border-[var(--color-border-subtle)]">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-[var(--color-text-main)]">
                        Background Mode
                      </span>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        White in Light Mode, Dark Grey in Dark Mode.
                      </p>
                    </div>
                    <Toggle
                      checked={settings.darkMode}
                      onChange={(val) => onUpdateSettings({ darkMode: val })}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ darkMode: false })}
                      className={`p-3.5 rounded-2xl border-2 text-left transition-all ${
                        !settings.darkMode
                          ? 'border-[var(--color-accent-vibrant)] bg-white shadow-xs'
                          : 'border-transparent bg-slate-100 opacity-60'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="w-3.5 h-3.5 rounded-full bg-white border-2 border-slate-300" />
                        <span className="font-bold text-[var(--color-text-main)]">
                          Light Mode (White)
                        </span>
                      </div>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        Pure white surface panels, soft pastels for secondary elements, high contrast typography.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ darkMode: true })}
                      className={`p-3.5 rounded-2xl border-2 text-left transition-all ${
                        settings.darkMode
                          ? 'border-[var(--color-accent-vibrant)] bg-[#18191E] text-white shadow-xs'
                          : 'border-transparent bg-slate-800 text-slate-300 opacity-60'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="w-3.5 h-3.5 rounded-full bg-[#18191E] border-2 border-slate-600" />
                        <span className="font-bold text-white">
                          Dark Mode (Dark Grey)
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">
                        Deep dark-grey surfaces (#18191E / #202228), darkened pastels, lowered eye fatigue.
                      </p>
                    </button>
                  </div>
                </div>

                {/* Color Palettes (Amber, Purple, Green, Blue, Pink) */}
                <div className="p-4 bg-[var(--color-bg-sidebar)] rounded-2xl space-y-3 border border-[var(--color-accent-pastel-border)] dark:border-[var(--color-border-subtle)]">
                  <div>
                    <span className="text-xs font-bold text-[var(--color-text-main)]">
                      Color Palette (Vibrant Accents & Pastels)
                    </span>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      Vibrant tone for buttons and key actions; gentle pastels for badges, cards, and borders.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5">
                    {[
                      {
                        id: 'amber' as const,
                        name: 'Amber',
                        vibrant: '#D97706',
                        pastel: '#FFF8EB',
                        pastelDark: '#2B2317',
                        border: '#FDE68A',
                      },
                      {
                        id: 'purple' as const,
                        name: 'Purple',
                        vibrant: '#7C3AED',
                        pastel: '#F7F3FF',
                        pastelDark: '#271F36',
                        border: '#DDD6FE',
                      },
                      {
                        id: 'green' as const,
                        name: 'Green',
                        vibrant: '#059669',
                        pastel: '#F0FDF4',
                        pastelDark: '#182920',
                        border: '#A7F3D0',
                      },
                      {
                        id: 'blue' as const,
                        name: 'Blue',
                        vibrant: '#2563EB',
                        pastel: '#F0F6FF',
                        pastelDark: '#1B2436',
                        border: '#BFDBFE',
                      },
                      {
                        id: 'pink' as const,
                        name: 'Pink',
                        vibrant: '#DB2777',
                        pastel: '#FDF2F8',
                        pastelDark: '#2F1B25',
                        border: '#FBCFE8',
                      },
                    ].map((p) => {
                      const isSelected = settings.palette === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => onUpdateSettings({ palette: p.id })}
                          className={`p-3 rounded-2xl flex flex-col items-center gap-2 border-2 transition-all ${
                            isSelected
                              ? 'border-[var(--color-accent-vibrant)] bg-[var(--color-bg-panel)] shadow-xs scale-102 ring-2 ring-[var(--color-accent-pastel-border)]'
                              : 'border-transparent bg-white/70 dark:bg-[#18191E]/60 hover:bg-white dark:hover:bg-[#18191E]'
                          }`}
                        >
                          {/* Color preview swatch showing vibrant accent nested inside pastel */}
                          <div
                            className="w-9 h-9 rounded-full p-1.5 flex items-center justify-center shadow-xs border"
                            style={{
                              backgroundColor: settings.darkMode ? p.pastelDark : p.pastel,
                              borderColor: p.border,
                            }}
                          >
                            <span
                              className="w-5 h-5 rounded-full block shadow-xs transition-transform hover:scale-110"
                              style={{ backgroundColor: p.vibrant }}
                            />
                          </div>

                          <div className="text-center">
                            <span className="text-xs font-bold text-[var(--color-text-main)] capitalize block">
                              {p.name}
                            </span>
                            <span
                              className="text-xs font-semibold px-1.5 py-0.5 rounded-full mt-0.5 inline-block"
                              style={{
                                backgroundColor: settings.darkMode ? p.pastelDark : p.pastel,
                                color: p.vibrant,
                              }}
                            >
                              Pastel + Vibrant
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Live Theme Preview Card */}
                <div className="p-4 bg-[var(--color-bg-panel)] rounded-2xl border border-[var(--color-accent-pastel-border)] dark:border-[var(--color-border-subtle)] shadow-xs">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold text-[var(--color-text-main)]">
                      Live Component Preview
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-badge-bg)] text-[var(--color-badge-text)] font-semibold capitalize">
                      {settings.palette} Theme Active
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      className="px-4 py-2 rounded-full bg-[var(--color-accent-vibrant)] text-white text-xs font-bold shadow-xs hover:brightness-110 transition-all"
                    >
                      Vibrant Accent Button
                    </button>
                    <div className="px-3 py-1.5 rounded-full bg-[var(--color-accent-pastel)] border border-[var(--color-accent-pastel-border)] text-[var(--color-accent-vibrant)] text-xs font-semibold">
                      Pastel Surface Badge
                    </div>
                    <div className="flex-1 min-w-[160px]">
                      <PillSlider value={75} onChange={() => {}} unit="%" />
                    </div>
                  </div>
                </div>

                {/* Font Family Selector */}
                <div className="p-4 bg-[var(--color-bg-sidebar)] rounded-2xl space-y-3 border border-[var(--color-accent-pastel-border)] dark:border-[var(--color-border-subtle)]">
                  <div>
                    <span className="text-xs font-bold text-[var(--color-text-main)]">
                      Typography / Interface Font
                    </span>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      Set the typographical personality across all workspaces.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { id: 'jakarta' as const, name: 'Plus Jakarta', desc: 'Modern Neo-Grotesque' },
                      { id: 'inter' as const, name: 'Inter', desc: 'Precision UI' },
                      { id: 'outfit' as const, name: 'Outfit', desc: 'Clean Contemporary' },
                      { id: 'mono' as const, name: 'JetBrains Mono', desc: 'Technical Monospace' },
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => onUpdateSettings({ fontFamily: f.id })}
                        className={`p-2.5 rounded-xl text-left border transition-all ${
                          settings.fontFamily === f.id
                            ? 'bg-[var(--color-accent-vibrant)] text-white border-transparent shadow-xs'
                            : 'bg-[var(--color-bg-panel)] text-[var(--color-text-main)] border-[var(--color-accent-pastel-border)] dark:border-[var(--color-border-subtle)] hover:border-[var(--color-accent-vibrant)]'
                        }`}
                      >
                        <span className="text-xs font-bold block">{f.name}</span>
                        <span className="text-xs opacity-80 block">{f.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Font Scaling & Density */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-4 bg-[var(--color-bg-sidebar)] rounded-2xl space-y-2 border border-[var(--color-accent-pastel-border)] dark:border-[var(--color-border-subtle)]">
                    <div>
                      <span className="text-xs font-bold text-[var(--color-text-main)]">
                        Text Size Scale
                      </span>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        Adjust overall interface scale.
                      </p>
                    </div>
                    <div className="flex bg-[var(--color-bg-panel)] p-1 rounded-full border border-[var(--color-accent-pastel-border)] dark:border-[var(--color-border-subtle)] text-xs font-semibold">
                      {[
                        { id: 'sm' as const, label: 'Small (90%)' },
                        { id: 'md' as const, label: 'Medium (100%)' },
                        { id: 'lg' as const, label: 'Large (110%)' },
                      ].map((sz) => (
                        <button
                          key={sz.id}
                          type="button"
                          onClick={() => onUpdateSettings({ fontSize: sz.id })}
                          className={`flex-1 py-1 rounded-full transition-all ${
                            settings.fontSize === sz.id
                              ? 'bg-[var(--color-accent-vibrant)] text-white shadow-xs'
                              : 'text-[var(--color-text-muted)]'
                          }`}
                        >
                          {sz.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="p-4 bg-[var(--color-bg-sidebar)] rounded-2xl space-y-2 border border-[var(--color-accent-pastel-border)] dark:border-[var(--color-border-subtle)]">
                    <div>
                      <span className="text-xs font-bold text-[var(--color-text-main)]">
                        Interface Density
                      </span>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        Padding and spacing of cards.
                      </p>
                    </div>
                    <div className="flex bg-[var(--color-bg-panel)] p-1 rounded-full border border-[var(--color-accent-pastel-border)] dark:border-[var(--color-border-subtle)] text-xs font-semibold">
                      {[
                        { id: 'comfortable' as const, label: 'Comfortable' },
                        { id: 'compact' as const, label: 'Compact' },
                      ].map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => onUpdateSettings({ density: d.id })}
                          className={`flex-1 py-1 rounded-full transition-all ${
                            settings.density === d.id
                              ? 'bg-[var(--color-accent-vibrant)] text-white shadow-xs'
                              : 'text-[var(--color-text-muted)]'
                          }`}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 7. Keyboard Shortcuts (ChatGPT / Claude / Odyssey) */}
            {activeTab === 'island' && <IslandSettingsPanel />}

            {activeTab === 'voice' && <VoiceSettingsPanel settings={settings} onUpdateSettings={onUpdateSettings} />}

            {activeTab === 'updates' && <UpdatesPanel u={updates} />}

            {activeTab === 'licenses' && (
              <div className="space-y-3">
                <span className="text-xs font-bold text-[var(--color-text-main)]">
                  Open Source Notices & THIRD_PARTY_LICENSES.md
                </span>
                <pre className="p-4 bg-[var(--color-bg-sidebar)] rounded-[18px] text-xs text-[var(--color-text-main)] dark:text-slate-300 font-mono whitespace-pre-wrap max-h-72 overflow-y-auto leading-relaxed border border-black/5 dark:border-white/5">
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
              className="px-5 py-2 rounded-full bg-[#0E1A33] dark:bg-white text-white dark:text-[var(--color-text-main)] text-xs font-bold hover:scale-105 active:scale-95 transition-transform"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
