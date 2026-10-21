import React from 'react';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
}

export const Toggle: React.FC<ToggleProps> = ({
  checked,
  onChange,
  ariaLabel = 'Toggle switch',
  size = 'md',
  disabled = false,
}) => {
  const isSm = size === 'sm';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex items-center cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed transition-colors duration-200 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-vibrant)] rounded-full ${
        isSm ? 'w-9 h-5' : 'w-11 h-6'
      } ${
        checked
          ? 'bg-[var(--color-accent-vibrant)]'
          : 'bg-[#C9CCD3] dark:bg-[#343842]'
      }`}
    >
      <span
        className={`inline-block rounded-full bg-white shadow-sm transform transition-transform duration-200 ease-out ${
          isSm ? 'w-3.5 h-3.5' : 'w-4.5 h-4.5'
        } ${
          checked
            ? isSm
              ? 'translate-x-[18px]'
              : 'translate-x-[22px]'
            : 'translate-x-[3px]'
        }`}
      />
    </button>
  );
};
