import React from 'react';
import { Avatar } from './Avatar';
import { useAccount } from '../../services/account';
import type { AccountView } from './AccountModal';

interface Props {
  /** Shared row classes from the sidebar so the button lines up with the other items. */
  rowClass: string;
  onOpenAccount: (view: AccountView) => void;
}

/**
 * Profile button at the foot of the sidebar. 0.11.0: it opens the profile page (usage, hardware and
 * runtime; sign in or out there) straight away. The menu it used to raise is gone: Library and Plugins
 * moved to tabs of the Tasks page.
 */
export const ProfileButton: React.FC<Props> = ({ rowClass, onOpenAccount }) => {
  const account = useAccount();
  const user = account.kind === 'signed-in' ? account.user : null;
  return (
    <button type="button" onClick={() => onOpenAccount('profile')}
      aria-label={user ? `Your profile, ${user.name}` : 'Your profile and usage'} data-tip={user ? `${user.name} · Profile` : 'Profile'} data-tip-side="right"
      className={`${rowClass} text-[var(--color-text-muted)] hover:bg-[var(--hover)] hover:text-[var(--color-text-main)] active:bg-[var(--pressed)]`}>
      <Avatar user={user} size={26} />
    </button>
  );
};
