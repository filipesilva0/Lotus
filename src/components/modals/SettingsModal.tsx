import React, { useEffect, useState } from 'react';
import { X, Cpu, Gem, MessageSquare, Volume2, Palette, Shield, Download, SunMoon, Sparkles, Server, Sun, Moon, Wrench, SlidersHorizontal, Blocks } from 'lucide-react';
import { LotusSettings } from '../../types/lotus';
import { IslandSettingsPanel, VoiceSettingsPanel } from './IslandSettingsPanel';
import { Toggle } from '../common/Toggle';
import { Segmented, Select, IconBtn, InfoNote, SettingRow } from '../common/ui';
import { FONTS } from '../../styles/theme';
import type { FontFamily } from '../../types/lotus';
import { PrivacyPanel } from './PrivacyPanel';
import { UpdatesPanel } from './UpdatesPanel';
import { EngineScalingPanel, MemorySkillsPanel, WebSearchPanel } from './LocalAgentSettings';
import type { Updates } from '../../hooks/useUpdates';
import { ToolsPanel } from './ToolsSettings';
import { kv } from '../../lib/store';
import { ProSettings } from '../pro/ProSettings';
import { AdvancedPanel } from './AdvancedSettings';
import { usePro } from '../../lib/pro';
import { prettyModelName } from '../../models/names';

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
  | 'licenses'
  | 'pro'
  | 'advanced';

/** One setting: name and a sentence on the left, its control on the right (same look in every pane). */
const Row = SettingRow;
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
  // Lotus Pro's pane appears once Pro is launched (or in a test build).
  const pro = usePro();
  const showPro = pro.locks || pro.test;
  const advanced = settings.advancedMode === true || settings.llmBackend !== 'builtin' || settings.imageEngine !== 'builtin' || settings.voiceEngine !== 'builtin';
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
    // Advanced mode (0.18.0): engines for people who chose one other than Lotus's own, or who turned it on.
    ...(advanced ? [{ id: 'engine' as SettingsTab, label: 'Engines', icon: Server }] : []),
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'memory', label: 'Memory', icon: Sparkles },
    { id: 'tools', label: 'Tools', icon: Wrench },
    { id: 'voice', label: 'Voice', icon: Volume2 },
    { id: 'island', label: 'Island', icon: Cpu },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'updates', label: 'Updates', icon: Download },
    { id: 'licenses', label: 'Privacy', icon: Shield },
    ...(settings.advancedMode ? [{ id: 'advanced' as SettingsTab, label: 'Advanced', icon: Blocks }] : []),
    ...(showPro ? [{ id: 'pro' as SettingsTab, label: 'Lotus Pro', icon: Gem }] : []),
  ];
  // A pane hidden since it was last open (Advanced mode turned off) opens General instead.
  const tab: SettingsTab = tabs.some((t) => t.id === activeTab) ? activeTab : 'general';
  const paneName = tabs.find((t) => t.id === tab)?.label ?? 'Settings';
  const closeBtn = <IconBtn label="Close Settings" onClick={onClose}><X className="w-4 h-4" /></IconBtn>;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sheet-backdrop select-none" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {/* 0.20: a large sheet with the panes in a left list (it was a fixed strip of 11 icon tabs). It grows with
          the window up to 1040 × 760, so long panes need less scrolling. */}
      <div role="dialog" aria-modal="true" aria-label={`Settings: ${paneName}`} className="material-sheet w-[min(1040px,100%)] h-[min(760px,100%)] rounded-[12px] flex overflow-hidden">
        <nav className="shrink-0 w-[196px] flex flex-col gap-0.5 p-2 pt-3 border-r border-[var(--sep)] bg-[var(--sheet-nav)] overflow-y-auto" aria-label="Settings panes" role="tablist" aria-orientation="vertical">
          <p className="px-2.5 pb-2 text-[12px] font-semibold text-[var(--color-text-muted)]">Settings</p>
          {tabs.map((t) => {
            const Icon = t.icon;
            const isActive = tab === t.id;
            return (
              <button key={t.id} type="button" role="tab" aria-selected={isActive} onClick={() => setActiveTab(t.id)}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                  e.preventDefault();
                  const i = tabs.findIndex((x) => x.id === t.id);
                  const n = tabs[(i + (e.key === 'ArrowDown' ? 1 : tabs.length - 1)) % tabs.length];
                  setActiveTab(n.id);
                  (e.currentTarget.parentElement?.querySelector(`[data-pane="${n.id}"]`) as HTMLElement | null)?.focus();
                }}
                data-pane={t.id} tabIndex={isActive ? 0 : -1}
                className={`h-8 px-2.5 flex items-center gap-2.5 rounded-[6px] text-[13px] text-left transition-colors focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)] ${isActive ? 'bg-[var(--color-accent-fill)] text-white font-medium' : 'text-[var(--color-text-main)] hover:bg-[var(--hover)]'}`}>
                <Icon className="w-4 h-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
                <span className="truncate">{t.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-2 pl-6 pr-2 h-12 shrink-0 border-b border-[var(--sep)]">
            <h2 className="text-[15px] font-semibold text-[var(--color-text-main)]">{paneName}</h2>
            {closeBtn}
          </div>
          {/* One scroll area per pane: panes never add a second scrolling box inside it. */}
          <div className="flex-1 overflow-y-auto px-6 pt-2 pb-6">
            <div className="max-w-[720px]">
            {tab === 'general' && (
              <div className="space-y-5">
                <Group label="Background work">
                  <div className="py-3 space-y-2">
                    <Row title="Background tasks model" hint="Runs Lotus's own housekeeping: learning memories, writing skills and naming chats. A small, fast model keeps this light; the chat model is chosen next to the message box. The built-in engine holds one model at a time, so while a chat model is loaded it does this work too instead of being swapped out." />
                    <Select aria-label="Background tasks model" value={settings.backgroundModel} onChange={(e) => onUpdateSettings({ backgroundModel: e.target.value })}>
                      <option value="">Same as the chat model{settings.selectedModel ? ` (${prettyModelName(settings.selectedModel)})` : ''}</option>
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
                <Group label="Advanced mode">
                  <Row title="Advanced mode" hint="Shows the settings for people who know local AI: other engines, cloud models with your own key, MCP tool servers and a local API for other apps. Everything in it is free.">
                    <Toggle checked={settings.advancedMode === true} onChange={(v) => onUpdateSettings({ advancedMode: v })} ariaLabel="Advanced mode" />
                  </Row>
                </Group>
                <InfoNote title="Looking for model settings?">Temperature, context window, reply length, system prompt and the other model settings live with the chat they change: open Chat and show the right panel (Model). Image and voice settings are in the right panel of their pages.</InfoNote>
              </div>
            )}

            {tab === 'chat' && (
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

            {tab === 'engine' && <EngineScalingPanel settings={settings} onUpdateSettings={onUpdateSettings} />}

            {tab === 'memory' && <MemorySkillsPanel settings={settings} onUpdateSettings={onUpdateSettings} />}
            {tab === 'tools' && <ToolsPanel settings={settings} onUpdateSettings={onUpdateSettings} />}

            {tab === 'appearance' && (
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

            {tab === 'island' && <IslandSettingsPanel models={models} voiceEngine={settings.voiceEngine} />}

            {tab === 'voice' && <VoiceSettingsPanel settings={settings} onUpdateSettings={onUpdateSettings} />}

            {tab === 'updates' && <UpdatesPanel u={updates} />}

            {tab === 'pro' && <ProSettings />}

            {tab === 'advanced' && <AdvancedPanel settings={settings} onUpdateSettings={onUpdateSettings} />}

            {tab === 'licenses' && <PrivacyPanel settings={settings} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
