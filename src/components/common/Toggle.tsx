import React from 'react';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
}

/** Switch: macOS 38×22 (small 30×18) track. The switch track is the one place a capsule is correct (HIG). */
export const Toggle: React.FC<ToggleProps> = ({ checked, onChange, ariaLabel = 'Switch', size = 'md', disabled = false }) => {
  const sm = size === 'sm';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex items-center shrink-0 rounded-full transition-colors duration-150 disabled:opacity-40 focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)] focus-visible:outline-offset-1 ${
        sm ? 'w-[30px] h-[18px]' : 'w-[38px] h-[22px]'
      } ${checked ? 'bg-[var(--c-green)]' : 'bg-[var(--pressed)] shadow-[inset_0_0_0_0.5px_var(--sep)]'}`}
    >
      <span
        aria-hidden="true"
        className={`inline-block rounded-full bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,.12),0_1px_3px_rgba(0,0,0,.3)] transition-transform duration-150 ${
          sm ? 'w-3.5 h-3.5' : 'w-[18px] h-[18px]'
        } ${checked ? (sm ? 'translate-x-[14px]' : 'translate-x-[18px]') : 'translate-x-[2px]'}`}
      />
    </button>
  );
};
