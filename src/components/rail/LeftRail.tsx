import React from 'react';
import { MessageSquare, Image as ImageIcon, AudioLines, Server, Settings as SettingsIcon, Hammer, SquareKanban } from 'lucide-react';
import { ProfileButton } from '../account/ProfileButton';
import type { AccountView } from '../account/AccountModal';
import { LotusMark } from '../common/LotusMark';
import { PAGE_PALETTE, PALETTES } from '../../styles/theme';
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
  onOpenAccount: (view: AccountView) => void;
  onOpenLibrary: (tab: 'skills' | 'plugins') => void;
  engines: Record<EngineId, EngineState>;
  /** A newer version was found (only ever true after a real check). */
  updateAvailable?: boolean;
  /** Effective appearance, so each page icon can wear the right shade of its petal colour. */
  dark: boolean;
}

export const VIEW_TITLES: Record<ViewMode, string> = {
  chat: 'Chat', images: 'Images', voice: 'Voice', builder: 'App Builder', tasks: 'Tasks', engines: 'Engines',
};

const row =
  'tip group relative w-full flex items-center justify-center h-11 rounded-[12px] select-none transition-colors duration-100 ' +
  'focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)] focus-visible:outline-offset-0';
const idle = 'text-[var(--color-text-muted)] hover:bg-[var(--hover)] hover:text-[var(--color-text-main)] active:bg-[var(--pressed)]';

/**
 * App switcher: an icon-only column on the window field. Session 8: it is always folded (the wide
 * version and its toggle were removed; the title bar's panel buttons now control each page's own
 * left and right panels). The selected page's icon wears its petal colour; names show as tips.
 */
export const LeftRail: React.FC<LeftRailProps> = ({ currentView, onSelectView, onOpenSettings, onOpenAccount, onOpenLibrary, engines, updateAvailable = false, dark }) => {
  const nav = [
    { id: 'chat' as ViewMode, glyph: MessageSquare, label: 'Chat' },
    { id: 'images' as ViewMode, glyph: ImageIcon, label: 'Images' },
    { id: 'voice' as ViewMode, glyph: AudioLines, label: 'Voice' },
    { id: 'builder' as ViewMode, glyph: Hammer, label: 'App Builder' },
    { id: 'tasks' as ViewMode, glyph: SquareKanban, label: 'Tasks' },
  ];
  const { health, label: healthLabel } = engineHealth(engines);
  const petal = (id: ViewMode) => { const p = PALETTES[PAGE_PALETTE[id]]; return dark ? p.vibrantLight : p.vibrant; };
  const dot = (cls: string) => <span aria-hidden="true" className={`absolute -top-0.5 -right-1 w-2 h-2 rounded-full ${cls}`} />;

  const item = (id: ViewMode, glyph: typeof Server, label: string, aria?: string, badge?: React.ReactNode) => {
    const on = currentView === id;
    return (
      <button key={id} type="button" onClick={() => onSelectView(id)} aria-label={aria ?? label} data-tip={label} data-tip-side="right"
        aria-current={on ? 'page' : undefined}
        className={`${row} ${on ? 'bg-[var(--color-bg-card)] text-[var(--color-text-main)] shadow-[0_0_0_0.5px_var(--sep),var(--shadow-1)]' : idle}`}>
        <span className="relative inline-flex">
          <Symbol glyph={glyph} size={22} weight={on ? 'medium' : 'regular'} mode="hierarchical" tone={on ? petal(id) : 'currentColor'} effect={on ? 'bounce' : undefined} />
          {badge}
        </span>
      </button>
    );
  };

  return (
    <aside className="shrink-0 w-[68px] flex flex-col select-none" aria-label="Pages">
      {/* The five-petal mark: one petal per page (Chat, Images, Voice, App Builder, Tasks). */}
      <div className="h-14 shrink-0 flex items-center justify-center">
        <LotusMark size={32} label="Lotus" />
      </div>

      <nav className="flex flex-col gap-1 px-3" aria-label="Workspaces">
        {nav.map((n) => item(n.id, n.glyph, n.label))}
      </nav>

      <div className="mt-auto flex flex-col gap-1 px-3 pb-3">
        {item('engines', Server, 'Engines & Models', `Engines and models. ${healthLabel}`, dot(DOT[health]))}
        <button type="button" onClick={onOpenSettings} data-tip={updateAvailable ? 'Settings · update available' : 'Settings'} data-tip-side="right"
          aria-label={updateAvailable ? 'Settings. An update is available' : 'Settings'} className={`${row} ${idle}`}>
          <span className="relative inline-flex">
            <Symbol glyph={SettingsIcon} size={22} mode="hierarchical" tone="currentColor" />
            {updateAvailable && dot('bg-[var(--color-accent-vibrant)]')}
          </span>
        </button>
        <ProfileButton rowClass={row} onOpenAccount={onOpenAccount} onOpenLibrary={onOpenLibrary} />
      </div>
    </aside>
  );
};
