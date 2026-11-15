// Agent faces (session 16): every agent (Lotus itself, each helper in Work mode, each task agent)
// gets a blobatar drawn from its name, so the same agent always looks the same. The main agent can
// also design new ones with the avatar.create tool; designed looks are saved under AVATARS_KEY and
// win over the plain name-based face. Pure module: used by the app and by the core (no DOM, no kv).

import { blobatar } from '../vendor/blobatar/blob';
import * as ex from '../vendor/blobatar/expression';
import type { Expression } from '../vendor/blobatar/expression';

export const AVATARS_KEY = 'lotus.avatars.v1';

/** Where each silhouette sits in blobatar's shape bands (the middle of its band). */
export const SHAPES = {
  round: 0.11, organic: 0.35, boxy: 0.54, capsule: 0.65, nub: 0.745,
  cloud: 0.825, droplet: 0.8875, hexagon: 0.9325, sun: 0.965, triangle: 0.99,
} as const;
export type ShapeName = keyof typeof SHAPES;

export const EXPRESSIONS: Record<string, Expression> = {
  idle: ex.idle, happy: ex.happy, sad: ex.sad, mad: ex.mad, surprised: ex.surprised, wink: ex.wink, sleepy: ex.sleepy,
  smug: ex.smug, unsure: ex.unsure, scared: ex.scared, love: ex.love, shy: ex.shy, sick: ex.sick, thinking: ex.thinking,
};
export type ExpressionName = keyof typeof EXPRESSIONS;

/** Colour words a model is likely to use → hue in degrees. */
export const COLOR_HUES: Record<string, number> = {
  red: 8, coral: 16, orange: 32, amber: 45, yellow: 60, lime: 95, green: 140, mint: 160, teal: 180, cyan: 195,
  sky: 210, blue: 230, indigo: 255, violet: 275, purple: 290, magenta: 315, pink: 330, rose: 345,
};

export interface AvatarLook {
  /** Hue in degrees (0–360). */
  hue?: number;
  /** 0 pale … 0.999 ink. */
  tone?: number;
  shape?: ShapeName;
  expression?: ExpressionName;
  background?: 'none' | 'circle' | 'squircle' | 'square';
  /** What the agent said it is for (shown on hover). */
  about?: string;
}

/** The look Lotus itself (the main agent / island mascot "Petal") uses. */
export const LOTUS_LOOK: AvatarLook = { hue: 330, shape: 'round', tone: 0.4 };
export const LOTUS_SEED = 'petal';

/**
 * Petal wears the colour of the page you are on (session 16): Chat blue, Work red, Images orange,
 * Voice yellow, Tasks green. Pages without a petal (Engines & Models) keep lotus pink.
 */
export const PAGE_HUES: Record<string, number> = { chat: 222, work: 356, images: 32, voice: 52, tasks: 142 };
export const KEY_PETAL_HUE = 'lotus.petal.hue';
let petalHue = 330;
const hueSubs = new Set<(h: number) => void>();
export const petal = {
  hue: () => petalHue,
  set(h: number) { if (h === petalHue) return; petalHue = h; hueSubs.forEach((f) => f(h)); },
  on(f: (h: number) => void) { hueSubs.add(f); return () => { hueSubs.delete(f); }; },
};
export const hueForPage = (view: string) => PAGE_HUES[view] ?? 330;

export function hueOf(color: unknown): number | undefined {
  if (typeof color === 'number' && Number.isFinite(color)) return ((color % 360) + 360) % 360;
  const s = String(color ?? '').trim().toLowerCase();
  if (!s) return undefined;
  if (/^\d+(\.\d+)?$/.test(s)) return hueOf(Number(s));
  if (s in COLOR_HUES) return COLOR_HUES[s];
  const word = Object.keys(COLOR_HUES).find((k) => s.includes(k));
  return word ? COLOR_HUES[word] : undefined;
}

/** blobatar options for a look (anything unset still comes from the name). */
export function avatarOptions(look: AvatarLook = {}) {
  return {
    ...(look.hue !== undefined ? { hue: look.hue } : {}),
    ...(look.tone !== undefined ? { tone: Math.max(0, Math.min(0.999, look.tone)) } : {}),
    ...(look.shape && look.shape in SHAPES ? { traits: { shape: SHAPES[look.shape] } } : {}),
    ...(look.background && look.background !== 'none' ? { background: look.background } : {}),
    ...(look.expression && EXPRESSIONS[look.expression] ? { expression: EXPRESSIONS[look.expression] } : {}),
  };
}

/** The SVG markup of an agent's face. */
export function renderAvatar(name: string, look: AvatarLook = {}, size = 128): string {
  return blobatar(name || 'agent', { size, title: name, ...avatarOptions(look) });
}

/** Parses the saved looks (tolerates junk). */
export function parseLooks(raw: string | null | undefined): Record<string, AvatarLook> {
  try { const v = JSON.parse(raw || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}
