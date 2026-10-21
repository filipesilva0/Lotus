import React, { useRef, useState, useCallback } from 'react';
import { Sun } from 'lucide-react';

interface PillSliderProps {
  value: number; // 0 to 100
  onChange: (val: number) => void;
  icon?: React.ReactNode;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
}

export const PillSlider: React.FC<PillSliderProps> = ({
  value,
  onChange,
  icon = <Sun className="w-3.5 h-3.5 text-[var(--color-accent-vibrant)]" strokeWidth={2} />,
  unit = '%',
  min = 0,
  max = 100,
  step = 1,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const calculateValueFromPointer = useCallback(
    (clientX: number) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const relativeX = clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, relativeX / rect.width));
      const rawVal = min + percentage * (max - min);
      const steppedVal = Math.round(rawVal / step) * step;
      onChange(Math.max(min, Math.min(max, steppedVal)));
    },
    [min, max, step, onChange]
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    calculateValueFromPointer(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    calculateValueFromPointer(e.clientX);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Pointer capture released safely
      }
    }
  };

  // Keyboard accessibility
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      onChange(Math.min(max, value + step));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      onChange(Math.max(min, value - step));
    }
  };

  const fillPercentage = ((value - min) / (max - min)) * 100;

  return (
    <div
      ref={containerRef}
      role="slider"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className="relative w-full h-8 bg-white dark:bg-[#18191E] border border-[var(--color-accent-pastel-border,#EBECEF)] rounded-full cursor-ew-resize select-none overflow-hidden flex items-center justify-between px-3.5 shadow-xs transition-all focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-vibrant)]/30"
    >
      {/* Background fill representing current slider level */}
      <div
        className="absolute left-0 top-0 bottom-0 bg-[var(--color-accent-pastel,#EFF6FF)] transition-all pointer-events-none rounded-full"
        style={{ width: `${fillPercentage}%` }}
      />

      {/* Vertical handle indicator line in pill */}
      <div
        className="absolute top-1.5 bottom-1.5 w-1 bg-[var(--color-accent-vibrant,#2563EB)] rounded-full pointer-events-none transform -translate-x-1/2 shadow-xs"
        style={{ left: `${Math.max(4, Math.min(96, fillPercentage))}%` }}
      />

      {/* Left Icon */}
      <div className="relative z-10 flex items-center justify-center">
        {icon}
      </div>

      {/* Right Percentage Text */}
      <span className="relative z-10 text-[11px] font-bold text-[var(--color-accent-vibrant,#2563EB)] tabular-nums">
        {value}
        {unit}
      </span>
    </div>
  );
};
