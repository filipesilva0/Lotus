import React from 'react';
import { Server, Settings as SettingsIcon } from 'lucide-react';
import { ProfileButton } from '../account/ProfileButton';
import type { AccountView } from '../account/AccountModal';
import { LotusMark } from '../common/LotusMark';
import { Symbol } from '../common/Symbol';
import { ViewMode } from '../../types/lotus';
import type { EngineState } from '../../hooks/useEngines';
import type { EngineId } from '../../services/engineConfig';
import { PAGES, WORKSPACES, VIEW_TITLES } from './pages';

export { VIEW_TITLES };

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
  engines: Record<EngineId, EngineState>;
  /** A newer version was found (only ever true after a real check). */
  updateAvailable?: boolean;
}

const row =
  'tip group relative w-full flex items-center justify-center h-11 rounded-[12px] select-none transition-colors duration-100 ' +
  'focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)] focus-visible:outline-offset-0';
const idle = 'text-[var(--color-text-muted)] hover:bg-[var(--hover)] hover:text-[var(--color-text-main)] active:bg-[var(--pressed)]';

/**
 * App switcher: an icon-only column on the window field. Session 8: it is always folded (the wide
 * version and its toggle were removed; the title bar's panel buttons now control each page's own
 * left and right panels). The selected page's icon wears the app's one accent (0.21: pages no longer
 * have their own colours); names show as tips. The order and icons come from ./pages.ts.
 */
export const LeftRail: React.FC<LeftRailProps> = ({ currentView, onSelectView, onOpenSettings, onOpenAccount, engines, updateAvailable = false }) => {
  const { health, label: healthLabel } = engineHealth(engines);
  const engines_ = PAGES.find((p) => p.id === 'engines')!;
  const dot = (cls: string) => <span aria-hidden="true" className={`absolute -top-0.5 -right-1 w-2 h-2 rounded-full ${cls}`} />;

  const item = (id: ViewMode, glyph: typeof Server, label: string, aria?: string, badge?: React.ReactNode) => {
    const on = currentView === id;
    return (
      <button key={id} type="button" onClick={() => onSelectView(id)} aria-label={aria ?? label} data-tip={label} data-tip-side="right"
        aria-current={on ? 'page' : undefined}
        className={`${row} ${on ? 'bg-[var(--color-bg-card)] text-[var(--color-text-main)] shadow-[0_0_0_0.5px_var(--sep),var(--shadow-1)]' : idle}`}>
        <span className="relative inline-flex">
          <Symbol glyph={glyph} size={22} weight={on ? 'medium' : 'regular'} mode="hierarchical" tone={on ? 'var(--color-accent-vibrant)' : 'currentColor'} effect={on ? 'bounce' : undefined} />
          {badge}
        </span>
      </button>
    );
  };

  return (
    <aside className="shrink-0 w-[68px] flex flex-col select-none" aria-label="Pages">
      {/* The Lotus mark (the user's own five-petal artwork). */}
      <div className="h-14 shrink-0 flex items-center justify-center">
        <LotusMark size={32} label="Lotus" />
      </div>

      <nav className="flex flex-col gap-1 px-3" aria-label="Workspaces">
        {WORKSPACES.map((n) => item(n.id, n.glyph, n.label, n.title))}
      </nav>

      <div className="mt-auto flex flex-col gap-1 px-3 pb-3">
        {item('engines', engines_.glyph, engines_.label, `Engines and models. ${healthLabel}`, dot(DOT[health]))}
        <button type="button" onClick={onOpenSettings} data-tip={updateAvailable ? 'Settings · update available' : 'Settings'} data-tip-side="right"
          aria-label={updateAvailable ? 'Settings. An update is available' : 'Settings'} className={`${row} ${idle}`}>
          <span className="relative inline-flex">
            <Symbol glyph={SettingsIcon} size={22} mode="hierarchical" tone="currentColor" />
            {updateAvailable && dot('bg-[var(--color-accent-vibrant)]')}
          </span>
        </button>
        <ProfileButton rowClass={row} onOpenAccount={onOpenAccount} />
      </div>
    </aside>
  );
};
