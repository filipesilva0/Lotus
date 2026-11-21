import React, { useEffect, useState } from 'react';
import { chromeOs } from '../common/TitleBar';
import { X, Cpu, MessageSquare, Volume2, Palette, Shield, Download, SunMoon, Sparkles, Server, Sun, Moon, Wrench, SlidersHorizontal } from 'lucide-react';
import { LotusSettings } from '../../types/lotus';
import { IslandSettingsPanel, VoiceSettingsPanel } from './IslandSettingsPanel';
import { Toggle } from '../common/Toggle';
import { Segmented, Select, IconBtn } from '../common/ui';
import { PALETTES, FONTS, PAGE_PALETTE, PETAL_ORDER } from '../../styles/theme';
import type { FontFamily } from '../../types/lotus';
import { VIEW_TITLES } from '../rail/LeftRail';
import { THIRD_PARTY_LICENSES_TEXT } from '../../data/licenses';
import { UpdatesPanel } from './UpdatesPanel';
import { EngineScalingPanel, MemorySkillsPanel, WebSearchPanel } from './LocalAgentSettings';
import type { Updates } from '../../hooks/useUpdates';
import { ToolsPanel } from './ToolsSettings';
import { kv } from '../../lib/store';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: LotusSettings;
  onUpdateSettings: (newSettings: Partial<LotusSettings>) => void;
  updates: Updates;
  /** Installed chat models (for the background tasks model and the island). */
  models: { id: string; name: string; tag: string }[];
  /** Open on this pane (e.g. Help › Check for Updates…); otherwise the last pane used. */
  pane?: SettingsTab | null;
}

const PANE_KEY = 'lotus.settingsPane.v1';
export type SettingsTab =
  | 'general'
  | 'engine'
  | 'memory'
  | 'tools'
  | 'chat'
  | 'voice'
  | 'island'
  | 'appearance'
  | 'updates'
  | 'licenses';

/** One setting: name and a sentence on the left, its control on the right (same look in every pane). */
const Row: React.FC<{ title: string; hint?: React.ReactNode; children?: React.ReactNode }> = ({ title, hint, children }) => (
  <div className="flex items-center justify-between gap-4 py-3">
    <div className="min-w-0">
      <span className="text-[13px] block">{title}</span>
      {hint && <span className="block text-[12px] text-[var(--color-text-muted)] leading-snug mt-0.5">{hint}</span>}
    </div>
    {children && <div className="shrink-0">{children}</div>}
  </div>
);
const Group: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <section aria-label={label} className="divide-y divide-[var(--sep)] border-b border-[var(--sep)] last:border-b-0">{children}</section>
);

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
    try { const saved = kv.getItem(PANE_KEY); return !saved || saved === 'inference' ? 'general' : (saved as SettingsTab); } catch { return 'general'; }
  });
  const setActiveTab = (t: SettingsTab) => { setActiveTabRaw(t); try { kv.setItem(PANE_KEY, t); } catch { /* memory only */ } };
  useEffect(() => { if (isOpen && pane) setActiveTabRaw(pane); }, [isOpen, pane]);
  useEffect(() => {
    if (!isOpen) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isOpen, onClose]);
  if (!isOpen) return null;

  const tabs: { id: SettingsTab; label: string; icon: React.ElementType }[] = [
    { id: 'general', label: 'General', icon: SlidersHorizontal },
    { id: 'engine', label: 'Engines', icon: Server },
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'memory', label: 'Memory', icon: Sparkles },
    { id: 'tools', label: 'Tools', icon: Wrench },
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
            {activeTab === 'general' && (
              <div className="space-y-5">
                <Group label="Background work">
                  <div className="py-3 space-y-2">
                    <Row title="Background tasks model" hint="Runs Lotus's own housekeeping: learning memories, writing skills and naming chats. A small, fast model keeps this light; the chat model is chosen next to the message box. The built-in engine holds one model at a time, so while a chat model is loaded it does this work too instead of being swapped out." />
                    <Select aria-label="Background tasks model" value={settings.backgroundModel} onChange={(e) => onUpdateSettings({ backgroundModel: e.target.value })}>
                      <option value="">Same as the chat model{settings.selectedModel ? ` (${settings.selectedModel})` : ''}</option>
                      {models.map((m) => <option key={m.id} value={m.id}>{m.name}{m.tag ? ` · ${m.tag}` : ''}</option>)}
                      {settings.backgroundModel && !models.some((m) => m.id === settings.backgroundModel) && <option value={settings.backgroundModel}>{settings.backgroundModel} (not installed)</option>}
                    </Select>
                    {settings.backgroundModel && !models.some((m) => m.id === settings.backgroundModel) && models.length > 0 && <p className="text-[12px] text-[var(--c-red)]">This model is not installed, so background tasks will fail. Pick another or download it in Models.</p>}
                    {!models.length && <p className="text-[12px] text-[var(--color-text-muted)]">No chat models found yet. Get one in Engines &amp; Models → Models.</p>}
                  </div>
                  <Row title="Auto-rename chats" hint="After the first reply, give the chat a short title. Titles you type yourself are never changed.">
                    <Toggle checked={settings.autoRename} onChange={(v) => onUpdateSettings({ autoRename: v })} ariaLabel="Auto-rename chats" />
                  </Row>
                </Group>
                <p className="text-[12px] text-[var(--color-text-muted)] leading-snug px-1">Temperature, context window, reply length, system prompt and the other model settings live with the chat they change: open Chat and show the right panel (Model). Image and voice settings are in the right panel of their pages.</p>
              </div>
            )}

            {activeTab === 'chat' && (
              <div className="space-y-5">
                <Group label="Typing and reading">
                  <Row title="Send with Enter" hint="Enter sends the message; Shift+Enter starts a new line. Off: Ctrl+Enter sends.">
                    <Toggle checked={settings.sendOnEnter} onChange={(v) => onUpdateSettings({ sendOnEnter: v })} ariaLabel="Send with Enter" />
                  </Row>
                  <Row title="Follow the reply as it's written" hint="Keeps the newest words in view while a reply streams in.">
                    <Toggle checked={settings.autoScroll} onChange={(v) => onUpdateSettings({ autoScroll: v })} ariaLabel="Follow the reply as it's written" />
                  </Row>
                  <Row title="Model thinking" hint="How the reasoning of thinking models (Qwen 3, DeepSeek R1, Nemotron…) is shown above the answer.">
                    <Segmented label="Model thinking" value={settings.reasoningBlockMode} onChange={(v) => onUpdateSettings({ reasoningBlockMode: v })}
                      options={[{ id: 'collapsed', label: 'Folded' }, { id: 'expanded', label: 'Open' }, { id: 'hidden', label: 'Hidden' }]} />
                  </Row>
                </Group>
                <WebSearchPanel settings={settings} onUpdateSettings={onUpdateSettings} />
              </div>
            )}

            {activeTab === 'engine' && <EngineScalingPanel settings={settings} onUpdateSettings={onUpdateSettings} />}

            {activeTab === 'memory' && <MemorySkillsPanel settings={settings} onUpdateSettings={onUpdateSettings} />}
            {activeTab === 'tools' && <ToolsPanel settings={settings} onUpdateSettings={onUpdateSettings} />}

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

            {activeTab === 'island' && <IslandSettingsPanel models={models} voiceEngine={settings.voiceEngine} />}

            {activeTab === 'voice' && <VoiceSettingsPanel settings={settings} onUpdateSettings={onUpdateSettings} />}

            {activeTab === 'updates' && <UpdatesPanel u={updates} />}

            {activeTab === 'licenses' && (
              <div className="space-y-3 pt-2">
                <span className="text-[13px] block">Open-source notices</span>
                <pre className="p-4 bg-[var(--hover)] rounded-[10px] text-[12px] text-[var(--color-text-main)] font-mono whitespace-pre-wrap max-h-[420px] overflow-y-auto leading-relaxed">
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
