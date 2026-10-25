import React from 'react';
import { Sun } from 'lucide-react';
import { Slider } from './ui';

interface PillSliderProps {
  value: number;
  onChange: (val: number) => void;
  icon?: React.ReactNode;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
}

/** Kept under its old name for existing call sites; now a standard macOS slider with a leading glyph and live value. */
export const PillSlider: React.FC<PillSliderProps> = ({
  value, onChange, icon = <Sun className="w-3.5 h-3.5" strokeWidth={1.8} aria-hidden="true" />, unit = '%', min = 0, max = 100, step = 1, label = 'Value',
}) => (
  <div className="flex items-center gap-2.5">
    <span className="text-[var(--color-text-muted)] shrink-0">{icon}</span>
    <Slider value={value} min={min} max={max} step={step} onChange={onChange} label={label} />
    <span className="w-12 text-right text-[12px] tabular-nums text-[var(--color-text-muted)]">{value}{unit}</span>
  </div>
);
