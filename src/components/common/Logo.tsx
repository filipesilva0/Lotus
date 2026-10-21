import React from 'react';

interface LogoProps {
  className?: string;
  size?: number;
}

export const Logo: React.FC<LogoProps> = ({ className = 'text-[#0E1A33] dark:text-white', size = 26 }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Tomo logo"
    >
      {/* Precision 4-petal interlocking geometric monogram matching Image 1 */}
      <path
        d="M11.5 7C9.01472 7 7 9.01472 7 11.5C7 13.9853 9.01472 16 11.5 16H16V11.5C16 9.01472 13.9853 7 11.5 7Z"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20.5 7C22.9853 7 25 9.01472 25 11.5C25 13.9853 22.9853 16 20.5 16H16V11.5C16 9.01472 18.0147 7 20.5 7Z"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11.5 25C9.01472 25 7 22.9853 7 20.5C7 18.0147 9.01472 16 11.5 16H16V20.5C16 22.9853 13.9853 25 11.5 25Z"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20.5 25C22.9853 25 25 22.9853 25 20.5C25 18.0147 22.9853 16 20.5 16H16V20.5C16 22.9853 18.0147 25 20.5 25Z"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
