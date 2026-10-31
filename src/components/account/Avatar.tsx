import React from 'react';
import { UserRound } from 'lucide-react';
import { AccountUser, initials } from '../../services/account';

/** Round profile picture; initials when there is no picture, a person glyph when signed out. */
export const Avatar: React.FC<{ user: AccountUser | null; size?: number; className?: string }> = ({ user, size = 24, className = '' }) => {
  const box = `shrink-0 rounded-full overflow-hidden inline-flex items-center justify-center ${className}`;
  if (user?.avatar) {
    return <img src={user.avatar} alt="" width={size} height={size} className={`${box} object-cover`} style={{ width: size, height: size }} draggable={false} />;
  }
  if (user) {
    return (
      <span aria-hidden="true" className={`${box} bg-[var(--color-accent-fill)] text-white font-semibold`} style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.4)) }}>
        {initials(user.name)}
      </span>
    );
  }
  return (
    <span aria-hidden="true" className={`${box} bg-[var(--pressed)] text-[var(--color-text-muted)]`} style={{ width: size, height: size }}>
      <UserRound width={Math.round(size * 0.62)} height={Math.round(size * 0.62)} strokeWidth={1.8} />
    </span>
  );
};
