import React from 'react';
import { MessageSquare, Image as ImageIcon, AudioLines, Server, Settings as SettingsIcon, FlaskConical, Boxes } from 'lucide-react';
import { Logo } from '../common/Logo';
import { Symbol } from '../common/Symbol';
import { ViewMode } from '../../types/lotus';
import type { EngineState } from '../../hooks/useEngines';
import type { EngineId } from '../../services/engineConfig';

export type EngineHealth = 'checking' | 'ok' | 'attention' | 'idle';

/**
 * Real engine health for the sidebar, derived only from measured state.
 * - checking: first probe has not finished, or something is starting/stopping
 * - attention: an engine Lotus is meant to run (started by Lotus, or "Start with Lotus") is down or errored
 * - ok: at least one engine is running and nothing needs attention
 * - idle: no engine is running (a normal state: engines are optional)
 */
export function engineHealth(engines: Record<EngineId, EngineState>): { health: EngineHealth; label: string } {
  const list = Object.values(engines);
  const running = list.filter((e) => e.up === true).length;
  if (list.some((e) => e.up === null || e.phase)) return { health: 'checking', label: 'Checking engines…' };
  if (list.some((e) => e.error || (!e.up && (e.supervised || e.policy === 'on_launch')))) {
    return { health: 'attention', label: 'An engine needs attention' };
  }
  if (running > 0) return { health: 'ok', label: `${running} of ${list.length} engines running` };
  return { health: 'idle', label: 'No engines running' };
}

const DOT: Record<EngineHealth, string> = {
  checking: 'bg-[var(--c-orange)] animate-pulse',
  ok: 'bg-[var(--c-green)]',
  attention: 'bg-[var(--c-red)]',
  idle: 'bg-[var(--color-text-muted)] opacity-60',
};

interface LeftRailProps {
  currentView: ViewMode;
  onSelectView: (view: ViewMode) => void;
  onOpenSettings: () => void;
  engines: Record<EngineId, EngineState>;
  /** A newer version was found (only ever true after a real check). */
  updateAvailable?: boolean;
  /** Sidebar collapsed to an icon-only column (⌘/Ctrl+Alt+S toggles it in the toolbar). */
  collapsed?: boolean;
}

export const VIEW_TITLES: Record<ViewMode, string> = {
  chat: 'Chat', images: 'Images', voice: 'Voice', research: 'Research', models: 'Models', engines: 'Engines',
};

const row =
  'group relative w-full flex items-center gap-3 h-11 rounded-[12px] text-[15px] select-none transition-colors duration-100 ' +
  'focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)] focus-visible:outline-offset-0';

/** Source-list sidebar that sits directly on the window field. The selected row is a raised white item; the content pane floats beside it. */
export const LeftRail: React.FC<LeftRailProps> = ({ currentView, onSelectView, onOpenSettings, engines, updateAvailable = false, collapsed = false }) => {
  const nav = [
    { id: 'chat' as ViewMode, glyph: MessageSquare, label: 'Chat' },
    { id: 'images' as ViewMode, glyph: ImageIcon, label: 'Images' },
    { id: 'voice' as ViewMode, glyph: AudioLines, label: 'Voice' },
    { id: 'research' as ViewMode, glyph: FlaskConical, label: 'Research' },
    { id: 'models' as ViewMode, glyph: Boxes, label: 'Models' },
  ];
  const { health, label: healthLabel } = engineHealth(engines);

  const item = (id: ViewMode, glyph: typeof Server, label: string, aria?: string, badge?: React.ReactNode) => {
    const on = currentView === id;
    return (
      <button key={id} type="button" onClick={() => onSelectView(id)} aria-label={aria ?? label} title={collapsed ? label : undefined}
        aria-current={on ? 'page' : undefined}
        className={`${row} ${collapsed ? 'justify-center px-0' : 'px-3.5'} ${on ? 'bg-[var(--color-bg-card)] text-[var(--color-text-main)] shadow-[0_0_0_0.5px_var(--sep),var(--shadow-1)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--hover)] hover:text-[var(--color-text-main)] active:bg-[var(--pressed)]'}`}>
        <span className="relative inline-flex">
          <Symbol glyph={glyph} size={22} weight={on ? 'medium' : 'regular'} mode="hierarchical" tone={on ? 'var(--color-accent-vibrant)' : 'currentColor'} effect={on ? 'bounce' : undefined} />
          {collapsed && badge}
        </span>
        {!collapsed && <span className={`flex-1 text-left truncate ${on ? 'font-semibold' : 'font-medium'}`}>{label}</span>}
        {!collapsed && badge}
      </button>
    );
  };

  const dot = (cls: string) => <span aria-hidden="true" className={`w-2 h-2 rounded-full ${cls} ${collapsed ? 'absolute -top-0.5 -right-1' : ''}`} />;

  return (
    <aside
      className={`shrink-0 flex flex-col select-none transition-[width] duration-200 ${collapsed ? 'w-[68px]' : 'w-[244px]'}`}
      aria-label="Sidebar"
    >
      {/* Leaves room for the window's traffic-light / title-bar area on platforms that draw it inside the content. */}
      <div className={`h-[68px] shrink-0 flex items-center gap-3 ${collapsed ? 'justify-center' : 'px-4'}`}>
        <Logo size={30} />
        {!collapsed && <span className="text-[17px] font-semibold tracking-[-0.01em]">Lotus</span>}
      </div>

      <nav className="flex flex-col gap-1 px-3" aria-label="Workspaces">
        {nav.map((n) => item(n.id, n.glyph, n.label))}
      </nav>

      <div className="mt-auto flex flex-col gap-1 px-3 pb-3">
        {item('engines', Server, 'Engines', `Engines. ${healthLabel}`, dot(DOT[health]))}
        <button type="button" onClick={onOpenSettings} title={collapsed ? 'Settings' : undefined}
          aria-label={updateAvailable ? 'Settings. An update is available' : 'Settings'}
          className={`${row} ${collapsed ? 'justify-center px-0' : 'px-3.5'} text-[var(--color-text-muted)] hover:bg-[var(--hover)] hover:text-[var(--color-text-main)] active:bg-[var(--pressed)]`}>
          <span className="relative inline-flex">
            <Symbol glyph={SettingsIcon} size={22} mode="hierarchical" tone="currentColor" />
            {collapsed && updateAvailable && dot('bg-[var(--color-accent-vibrant)]')}
          </span>
          {!collapsed && <span className="flex-1 text-left font-medium">Settings</span>}
          {!collapsed && updateAvailable && (<><span className="text-[11px] text-[var(--color-text-muted)]">Update</span>{dot('bg-[var(--color-accent-vibrant)]')}</>)}
        </button>
      </div>
    </aside>
  );
};
