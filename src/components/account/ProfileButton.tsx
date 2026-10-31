import React, { useEffect, useRef, useState } from 'react';
import { BarChart3, BookOpen, Boxes, LogIn, LogOut, Puzzle, Settings as SettingsIcon } from 'lucide-react';
import { Symbol } from '../common/Symbol';
import { Avatar } from './Avatar';
import { signOut, useAccount } from '../../services/account';
import type { AccountView } from './AccountModal';

interface Props {
  collapsed: boolean;
  /** Shared row classes from the sidebar so the button lines up with the other items. */
  rowClass: string;
  onOpenSettings: () => void;
  onOpenModels: () => void;
  onOpenAccount: (view: AccountView) => void;
  onOpenLibrary: (tab: 'skills' | 'plugins') => void;
}

/**
 * Profile button at the foot of the sidebar. Clicking it raises a small menu upward:
 * signed out → Log in · Usage · Library · Plugins · Settings · Models; signed in → your profile (with usage) · Library · Plugins · Settings · Models · Log out.
 */
export const ProfileButton: React.FC<Props> = ({ collapsed, rowClass, onOpenSettings, onOpenModels, onOpenAccount, onOpenLibrary }) => {
  const account = useAccount();
  const user = account.kind === 'signed-in' ? account.user : null;
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    // Move focus into the menu for keyboard users.
    requestAnimationFrame(() => wrap.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus());
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key); };
  }, [open]);

  const pick = (fn: () => void) => () => { setOpen(false); fn(); };

  type Entry = { id: string; label: React.ReactNode; aria: string; icon: React.ReactNode; onSelect: () => void; danger?: boolean };
  const entries: Entry[] = [
    user
      ? { id: 'profile', aria: `Your profile, ${user.name}`, icon: <Avatar user={user} size={28} />, onSelect: pick(() => onOpenAccount('profile')),
          label: (<span className="flex flex-col min-w-0 leading-tight"><span className="font-semibold truncate">{user.name}</span><span className="text-[12px] text-[var(--color-text-muted)] truncate">{user.email}</span></span>) }
      : { id: 'login', aria: 'Log in', label: 'Log in', icon: <Symbol glyph={LogIn} size={18} />, onSelect: pick(() => onOpenAccount('signin')) },
    ...(user ? [] : [{ id: 'usage', aria: 'Your usage', label: 'Your usage', icon: <Symbol glyph={BarChart3} size={18} />, onSelect: pick(() => onOpenAccount('profile')) }]),
    { id: 'library', aria: 'Library: skills, memory and soul', label: 'Library', icon: <Symbol glyph={BookOpen} size={18} />, onSelect: pick(() => onOpenLibrary('skills')) },
    { id: 'plugins', aria: 'Plugins', label: 'Plugins', icon: <Symbol glyph={Puzzle} size={18} />, onSelect: pick(() => onOpenLibrary('plugins')) },
    { id: 'settings', aria: 'Settings', label: 'Settings', icon: <Symbol glyph={SettingsIcon} size={18} />, onSelect: pick(onOpenSettings) },
    { id: 'models', aria: 'Models', label: 'Models', icon: <Symbol glyph={Boxes} size={18} />, onSelect: pick(onOpenModels) },
    ...(user ? [{ id: 'logout', aria: 'Log out', label: 'Log out', icon: <Symbol glyph={LogOut} size={18} />, onSelect: pick(() => void signOut()), danger: true }] : []),
  ];

  const move = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(wrap.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return (
    <div ref={wrap} className="relative">
      {open && (
        <div role="menu" aria-label="Account" onKeyDown={move}
          className="profile-menu material-frosted absolute bottom-full left-0 mb-2 w-[248px] p-1.5 rounded-[12px] z-50 flex flex-col gap-0.5">
          {entries.map((it, i) => (
            <React.Fragment key={it.id}>
              {(it.id === 'library' || it.id === 'settings' || it.id === 'logout') && <div role="separator" className="profile-menu-item my-1 mx-2 h-px bg-[var(--sep)]" style={{ animationDelay: `${(entries.length - i) * 35}ms` }} />}
              <button type="button" role="menuitem" aria-label={it.aria} onClick={it.onSelect}
                // Items rise from the button one after another: the lowest first.
                style={{ animationDelay: `${(entries.length - 1 - i) * 35}ms` }}
                className={`profile-menu-item w-full flex items-center gap-3 px-2.5 rounded-[8px] text-left text-[14px] transition-colors duration-100 hover:bg-[var(--hover)] active:bg-[var(--pressed)] focus:outline-none focus-visible:bg-[var(--hover)] focus-visible:outline-[3px] focus-visible:outline-[var(--ring)] ${it.id === 'profile' ? 'h-12' : 'h-9'} ${it.danger ? 'text-[var(--c-red)]' : 'text-[var(--color-text-main)]'}`}>
                <span className="w-7 inline-flex justify-center shrink-0">{it.icon}</span>
                <span className="flex-1 min-w-0 truncate">{it.label}</span>
              </button>
            </React.Fragment>
          ))}
        </div>
      )}

      <button ref={btn} type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}
        aria-label={user ? `Account: ${user.name}` : 'Account: not signed in'} title={collapsed ? (user ? user.name : 'Account') : undefined}
        className={`${rowClass} ${collapsed ? 'justify-center px-0' : 'px-3'} ${open ? 'bg-[var(--pressed)] text-[var(--color-text-main)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--hover)] hover:text-[var(--color-text-main)] active:bg-[var(--pressed)]'}`}>
        <Avatar user={user} size={26} />
        {!collapsed && (
          <span className="flex-1 min-w-0 text-left truncate font-medium">{user ? user.name : 'Profile'}</span>
        )}
      </button>
    </div>
  );
};
