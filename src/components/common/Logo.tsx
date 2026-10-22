import React from 'react';

interface LogoProps {
  className?: string;
  size?: number;
}

/** Lotus line art: five petals and a ripple, drawn with strokes only so it follows the text colour. */
export const Logo: React.FC<LogoProps> = ({ className = 'text-[var(--color-text-main)]', size = 26 }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Lotus logo"
    >
      <path d="M16 4.5C20.5 9.5 20.5 17.5 16 23.5C11.5 17.5 11.5 9.5 16 4.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 23.5C10.5 22.5 6.8 18 6.8 12C11.6 12.8 14.8 17 16 23.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 23.5C21.5 22.5 25.2 18 25.2 12C20.4 12.8 17.2 17 16 23.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 23.5C9 25 3.8 21.5 2.6 16C8 15.8 13.2 18.4 16 23.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 23.5C23 25 28.2 21.5 29.4 16C24 15.8 18.8 18.4 16 23.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 28C12 29.6 20 29.6 25 28" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};
