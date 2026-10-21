import React from 'react';
import {
  MessageSquare,
  Music,
  Layers,
  Server,
  Settings as SettingsIcon,
  FlaskConical,
  User as UserIcon,
  Sun,
  Moon,
} from 'lucide-react';
import { Logo } from '../common/Logo';
import { ViewMode } from '../../types/tomo';

interface LeftRailProps {
  currentView: ViewMode;
  onSelectView: (view: ViewMode) => void;
  onOpenSettings: () => void;
  darkMode?: boolean;
  onToggleTheme?: () => void;
  unreadCount?: number;
}

export const LeftRail: React.FC<LeftRailProps> = ({
  currentView,
  onSelectView,
  onOpenSettings,
  darkMode = false,
  onToggleTheme,
  unreadCount = 2,
}) => {
  // Main workspaces (Chat, Images, Voice) to be centered vertically
  const mainNavItems = [
    { id: 'chat' as ViewMode, icon: MessageSquare, label: 'Chat & Vision' },
    { id: 'images' as ViewMode, icon: Layers, label: 'Image Studio' },
    { id: 'voice' as ViewMode, icon: Music, label: 'Voice Studio' },
    { id: 'research' as ViewMode, icon: FlaskConical, label: 'Deep Research' },
  ];

  return (
    <aside
      className="relative w-16 md:w-[68px] shrink-0 flex flex-col items-center justify-between py-6 border-r border-[#EBECEF] dark:border-[#2C2F38] bg-white dark:bg-[#18191E] transition-colors z-20 select-none rounded-l-[28px] self-stretch"
      aria-label="Navigation Rail"
    >
      {/* 1. Top Logo Mark */}
      <div className="flex flex-col items-center">
        <button
          onClick={() => onSelectView('chat')}
          className="flex items-center justify-center p-1.5 rounded-xl hover:opacity-80 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-vibrant)]"
          title="Tomo AI Studio"
          aria-label="Tomo AI Studio"
        >
          <Logo size={28} />
        </button>
      </div>

      {/* 2. Main Workspace Navigation (Chat, Images, Voice) - Centred Vertically in the Rail */}
      <nav
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center justify-center space-y-2.5 z-10"
        aria-label="Main Workspaces"
      >
        {mainNavItems.map((item, index) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          return (
            <React.Fragment key={item.id}>
              {index > 0 && (
                <div
                  className="w-6 h-[1px] bg-[#F0F1F3] dark:bg-[#2C2F38] my-1 pointer-events-none"
                  aria-hidden="true"
                />
              )}
              <button
                type="button"
                onClick={() => onSelectView(item.id)}
                aria-label={item.label}
                title={item.label}
                className={`relative w-10 h-10 flex items-center justify-center rounded-[13px] transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-vibrant)] ${
                  isActive
                    ? 'bg-[var(--color-accent-pastel)] text-[var(--color-accent-vibrant)] shadow-[0_1px_3px_rgba(0,0,0,0.06)] font-semibold ring-1 ring-[var(--color-accent-pastel-border)]'
                    : 'text-[#8B8F99] hover:text-[#18191E] dark:text-slate-400 dark:hover:text-white hover:bg-[var(--color-accent-pastel)]/40 dark:hover:bg-[#22242B]'
                }`}
              >
                <Icon className="w-[19px] h-[19px]" strokeWidth={1.85} />
              </button>
            </React.Fragment>
          );
        })}
      </nav>

      {/* 3. Bottom Pinned Controls: Light/Dark Mode, Engines & Models (under theme icon), Settings, Avatar */}
      <div className="flex flex-col items-center space-y-2.5 pt-3 border-t border-[#F0F1F3] dark:border-[#2C2F38] w-full">
        {/* Theme Toggle Button (Light/Dark Mode) */}
        {onToggleTheme && (
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            className="w-10 h-10 flex items-center justify-center rounded-[12px] text-[#8B8F99] hover:text-[#18191E] dark:text-slate-400 dark:hover:text-white hover:bg-[var(--color-accent-pastel)]/40 dark:hover:bg-[#22242B] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-vibrant)]"
          >
            {darkMode ? (
              <Sun className="w-[19px] h-[19px]" strokeWidth={1.75} />
            ) : (
              <Moon className="w-[19px] h-[19px]" strokeWidth={1.75} />
            )}
          </button>
        )}

        {/* Engines & Models Icon (Placed directly under the light/dark mode icon) */}
        <button
          type="button"
          onClick={() => onSelectView('engines')}
          aria-label="Engines & Model Registry"
          title="Engines & Model Registry"
          className={`relative w-10 h-10 flex items-center justify-center rounded-[12px] transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-vibrant)] ${
            currentView === 'engines'
              ? 'bg-[var(--color-accent-pastel)] text-[var(--color-accent-vibrant)] shadow-[0_1px_3px_rgba(0,0,0,0.06)] font-semibold ring-1 ring-[var(--color-accent-pastel-border)]'
              : 'text-[#8B8F99] hover:text-[#18191E] dark:text-slate-400 dark:hover:text-white hover:bg-[var(--color-accent-pastel)]/40 dark:hover:bg-[#22242B]'
          }`}
        >
          <Server className="w-[19px] h-[19px]" strokeWidth={1.75} />
          {unreadCount > 0 && (
            <span
              className="absolute top-2 right-2 w-1.5 h-1.5 bg-[var(--color-accent-vibrant)] rounded-full"
              aria-label={`${unreadCount} updates available`}
            />
          )}
        </button>

        {/* Settings Gear */}
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Settings and Preferences"
          title="Settings and Preferences"
          className="w-10 h-10 flex items-center justify-center rounded-[12px] text-[#8B8F99] hover:text-[#18191E] dark:text-slate-400 dark:hover:text-white hover:bg-[var(--color-accent-pastel)]/40 dark:hover:bg-[#22242B] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-vibrant)]"
        >
          <SettingsIcon className="w-[19px] h-[19px]" strokeWidth={1.75} />
        </button>

        {/* User Profile Avatar */}
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Settings"
          title="Settings"
          className="relative group p-0.5 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-vibrant)]"
        >
          <span
            aria-hidden="true"
            className="w-8 h-8 rounded-full flex items-center justify-center text-white bg-gradient-to-br from-[var(--color-accent-vibrant)] to-[var(--color-accent-hover)] shadow-xs ring-1 ring-black/5 dark:ring-white/10 group-hover:scale-105 transition-transform"
          >
            <UserIcon className="w-4 h-4" strokeWidth={2} />
          </span>
        </button>
      </div>
    </aside>
  );
};
