import React from 'react';
import {
  MessageSquare,
  Music,
  Layers,
  Server,
  Settings as SettingsIcon,
  FlaskConical,
} from 'lucide-react';
import { Logo } from '../common/Logo';
import { ViewMode } from '../../types/lotus';
import type { EngineState } from '../../hooks/useEngines';
import type { EngineId } from '../../services/engineConfig';

export type EngineHealth = 'checking' | 'ok' | 'attention' | 'idle';

/**
 * Real engine health for the rail, derived only from measured state.
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
  checking: 'bg-amber-400 animate-pulse',
  ok: 'bg-emerald-500',
  attention: 'bg-rose-500',
  idle: 'bg-[var(--color-text-muted)]',
};

interface LeftRailProps {
  currentView: ViewMode;
  onSelectView: (view: ViewMode) => void;
  onOpenSettings: () => void;
  engines: Record<EngineId, EngineState>;
  /** A newer version was found (only ever true after a real check). */
  updateAvailable?: boolean;
}

const itemBase =
  'group relative w-[60px] flex flex-col items-center gap-1 py-2 rounded-xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-vibrant)]';
const itemOn = 'bg-[var(--color-accent-pastel)] text-[var(--color-accent-vibrant)]';
const itemOff =
  'text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] hover:bg-black/5 dark:hover:bg-white/5';

export const LeftRail: React.FC<LeftRailProps> = ({
  currentView,
  onSelectView,
  onOpenSettings,
  engines,
  updateAvailable = false,
}) => {
  const navItems = [
    { id: 'chat' as ViewMode, icon: MessageSquare, label: 'Chat', title: 'Chat & Vision' },
    { id: 'images' as ViewMode, icon: Layers, label: 'Images', title: 'Image Studio' },
    { id: 'voice' as ViewMode, icon: Music, label: 'Voice', title: 'Voice Studio' },
    { id: 'research' as ViewMode, icon: FlaskConical, label: 'Research', title: 'Deep Research' },
  ];
  const { health, label: healthLabel } = engineHealth(engines);

  return (
    <aside
      className="w-[76px] shrink-0 flex flex-col items-center py-4 border-r border-[var(--color-border-subtle)] bg-[var(--color-bg-panel)] transition-colors z-20 select-none rounded-l-[28px] self-stretch relative"
      aria-label="Navigation Rail"
    >
      <button
        onClick={() => onSelectView('chat')}
        className="flex items-center justify-center p-1.5 mb-4 rounded-xl hover:opacity-80 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-vibrant)]"
        title="Lotus"
        aria-label="Lotus, go to Chat"
      >
        <Logo size={28} />
      </button>

      <nav className="absolute left-0 right-0 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1" aria-label="Workspaces">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = currentView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectView(item.id)}
              title={item.title}
              aria-label={item.title}
              aria-current={active ? 'page' : undefined}
              className={`${itemBase} ${active ? itemOn : itemOff}`}
            >
              <Icon className="w-5 h-5" strokeWidth={active ? 2.1 : 1.8} />
              <span className="text-xs font-semibold leading-none">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col items-center gap-1 pt-3 border-t border-[var(--color-border-subtle)] w-full">
        <button
          type="button"
          onClick={() => onSelectView('engines')}
          title={`Engines: ${healthLabel}`}
          aria-label={`Engines. ${healthLabel}`}
          aria-current={currentView === 'engines' ? 'page' : undefined}
          className={`${itemBase} ${currentView === 'engines' ? itemOn : itemOff}`}
        >
          <span className="relative">
            <Server className="w-5 h-5" strokeWidth={currentView === 'engines' ? 2.1 : 1.8} />
            <span
              aria-hidden="true"
              className={`absolute -top-0.5 -right-1 w-2 h-2 rounded-full ring-2 ring-[var(--color-bg-panel)] ${DOT[health]}`}
            />
          </span>
          <span className="text-xs font-semibold leading-none">Engines</span>
        </button>

        <button
          type="button"
          onClick={onOpenSettings}
          title={updateAvailable ? 'Settings: an update is available' : 'Settings'}
          aria-label={updateAvailable ? 'Settings. An update is available' : 'Settings'}
          className={`${itemBase} ${itemOff}`}
        >
          <span className="relative">
            <SettingsIcon className="w-5 h-5" strokeWidth={1.8} />
            {updateAvailable && (
              <span aria-hidden="true" className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-[var(--color-accent-vibrant)] ring-2 ring-[var(--color-bg-panel)]" />
            )}
          </span>
          <span className="text-xs font-semibold leading-none">Settings</span>
        </button>
      </div>
    </aside>
  );
};
