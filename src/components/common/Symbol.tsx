import React from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * Symbol: the single entry point for icons, modelled on SF Symbols.
 *
 * Why this is not literally SF Symbols: Apple's licence limits SF Symbols and the SF fonts to
 * apps for Apple platforms. Lotus ships on Windows, so it cannot embed them. Symbol therefore wraps
 * the open-source Lucide set (ISC licence) behind the same vocabulary: weight, scale, rendering mode
 * and symbol effects. If Lotus is later built for macOS, swap the `glyph` renderer here
 * (one file) for a native or licensed symbol set; no call site changes.
 *
 * Rendering modes
 *   monochrome   one colour (currentColor)
 *   hierarchical the glyph in `tone`, with secondary strokes at reduced opacity
 *   palette      `tone` for the glyph and `secondary` for the badge/secondary layer
 * Effects (all stop under prefers-reduced-motion; `appear` becomes a fade)
 *   pulse, bounce, variableColor, rotate, appear, wiggle
 */
export type SymbolEffect = 'pulse' | 'bounce' | 'variableColor' | 'rotate' | 'appear' | 'wiggle';
export type SymbolWeight = 'regular' | 'medium' | 'semibold';
export type SymbolScale = 'small' | 'medium' | 'large';
export type RenderingMode = 'monochrome' | 'hierarchical' | 'palette';

const WEIGHT: Record<SymbolWeight, number> = { regular: 1.6, medium: 1.9, semibold: 2.2 };
const SCALE: Record<SymbolScale, number> = { small: 14, medium: 16, large: 20 };
const EFFECT_CLASS: Record<SymbolEffect, string> = {
  pulse: 'sym-pulse', bounce: 'sym-bounce', variableColor: 'sym-variable', rotate: 'sym-rotate', appear: 'sym-appear', wiggle: 'sym-wiggle',
};

export interface SymbolProps {
  glyph: LucideIcon;
  /** Accessible name. Omit only for purely decorative symbols next to a visible label. */
  label?: string;
  weight?: SymbolWeight;
  scale?: SymbolScale;
  /** Overrides `scale` with an exact pixel size (for display-size symbols). */
  size?: number;
  mode?: RenderingMode;
  tone?: string;
  secondary?: string;
  effect?: SymbolEffect;
  /** Keeps a looping effect running only while true (status changes, loading). */
  active?: boolean;
  className?: string;
}

export const Symbol: React.FC<SymbolProps> = ({
  glyph: Glyph, label, weight = 'regular', scale = 'medium', size, mode = 'monochrome',
  tone, secondary, effect, active = true, className = '',
}) => {
  const px = size ?? SCALE[scale];
  const color = mode === 'monochrome' ? undefined : tone ?? 'currentColor';
  const fx = effect && active ? EFFECT_CLASS[effect] : '';
  // Re-key on effect start so one-shot effects (bounce, appear, wiggle) replay when triggered.
  return (
    <span
      key={effect && active ? effect : 'static'}
      className={`inline-flex shrink-0 items-center justify-center ${fx} ${className}`}
      style={{ width: px, height: px, color, ['--sym-secondary' as string]: secondary }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <Glyph
        width={px}
        height={px}
        strokeWidth={WEIGHT[weight]}
        absoluteStrokeWidth
        style={mode === 'hierarchical' ? { opacity: 0.92 } : undefined}
      />
    </span>
  );
};

/** Status symbol with an animated change: spins while busy, bounces once on success, wiggles once on error. */
export function StatusSymbol({
  status, idle, busy, ok, error, label, size,
}: {
  status: 'idle' | 'busy' | 'ok' | 'error';
  idle: LucideIcon; busy: LucideIcon; ok: LucideIcon; error: LucideIcon;
  label: string; size?: number;
}) {
  const glyph = status === 'busy' ? busy : status === 'ok' ? ok : status === 'error' ? error : idle;
  const effect: SymbolEffect | undefined = status === 'busy' ? 'rotate' : status === 'ok' ? 'bounce' : status === 'error' ? 'wiggle' : undefined;
  const tone = status === 'ok' ? 'var(--c-green, #248A3D)' : status === 'error' ? 'var(--c-red, #D70015)' : undefined;
  return <Symbol glyph={glyph} label={label} size={size} effect={effect} mode={tone ? 'hierarchical' : 'monochrome'} tone={tone} />;
}
