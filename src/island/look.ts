// The island's look (0.23 redesign). Two surfaces, one accent:
//   dark  pure black, flush with the top edge of the screen, so it reads as growing out of the bezel
//         (the notch on a MacBook). Flared top corners.
//   light a white floating card a few pixels below the top edge, with a soft shadow, so it doesn't
//         look like a black hole on a light desktop.
//   glass (0.23.1) frosted glass: see-through, light or dark with Lotus, floating with a soft shadow.
//         Windows can only blur behind a whole rectangular window (that would bring back square, hard
//         edges), so the frost is drawn here: a tinted see-through fill, a light sheen from the top,
//         a fine grain and a bright hairline edge.
// The accent is the app's one accent (--color-accent-vibrant); Petal keeps its own pink face.
// Pure (no DOM), so core tests can check it.

export type IslandSurface = 'auto' | 'black' | 'glass';

export interface IslandLook {
  dark: boolean;
  /** Light: a card below the edge with a shadow. Dark: flush with the edge, flared corners. */
  floating: boolean;
  glass: boolean;
  vars: Record<string, string>;
}

/**
 * Space around a floating island for its shadow, in px (inside the transparent window). 0.23.1: the
 * shadow fits inside it; in 0.23.0 it was cut off by the window's edge, which drew hard straight lines.
 */
export const FLOAT_GAP = { top: 8, side: 26, bottom: 34 };
const FLOAT_SHADOW = '0 0 0 1px rgba(0,0,0,0.06), 0 8px 22px rgba(15,23,42,0.16), 0 1px 4px rgba(15,23,42,0.08)';

/** Fine grain for the frosted glass (an SVG noise tile). */
const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 .07 0'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E\")";

export function islandLook(appDark: boolean, surface: IslandSurface, mac: boolean): IslandLook {
  // On a Mac the island sits over the notch, which is black whatever the theme.
  if (surface === 'glass' && !mac) return glassLook(appDark);
  const dark = mac || surface === 'black' || appDark;
  if (dark) {
    return {
      dark: true, floating: false, glass: false,
      vars: {
        '--is-bg': '#000',
        '--is-ink': '#000',
        '--is-raised': 'rgba(255,255,255,0.09)',
        '--is-raised-hover': 'rgba(255,255,255,0.16)',
        '--is-card': 'rgba(255,255,255,0.06)',
        '--is-text': 'rgba(255,255,255,0.95)',
        // ≥ 7:1 on black.
        '--is-muted': 'rgba(235,235,245,0.64)',
        '--is-hair': 'rgba(255,255,255,0.10)',
        '--is-track': 'rgba(255,255,255,0.18)',
        '--is-warn': '#fcd34d',
        '--is-focus': 'rgba(255,255,255,0.65)',
        '--is-shadow': 'none',
      },
    };
  }
  return {
    dark: false, floating: true, glass: false,
    vars: {
      '--is-bg': '#ffffff',
        '--is-ink': '#ffffff',
      '--is-raised': 'rgba(0,0,0,0.05)',
      '--is-raised-hover': 'rgba(0,0,0,0.09)',
      '--is-card': 'rgba(0,0,0,0.035)',
      '--is-text': 'rgba(0,0,0,0.88)',
      // ≥ 4.5:1 on white and on the card fill.
      '--is-muted': 'rgba(60,60,67,0.80)',
      '--is-hair': 'rgba(0,0,0,0.08)',
      '--is-track': 'rgba(0,0,0,0.10)',
      '--is-warn': '#b45309',
      '--is-focus': 'rgba(0,0,0,0.55)',
      '--is-shadow': FLOAT_SHADOW,
    },
  };
}

/** `--is-ink`: a solid colour for text on a --is-text fill (--is-bg can be layered). */
/** Frosted glass. Fills stay opaque enough (≈ 80 %) that text reads over a busy desktop. */
function glassLook(dark: boolean): IslandLook {
  if (dark) {
    return {
      dark: true, floating: true, glass: true,
      vars: {
        '--is-bg': `${GRAIN}, linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.02) 45%, rgba(255,255,255,0) 100%), rgba(22,22,28,0.80)`,
        '--is-ink': '#16161c',
        '--is-raised': 'rgba(255,255,255,0.11)',
        '--is-raised-hover': 'rgba(255,255,255,0.18)',
        '--is-card': 'rgba(255,255,255,0.07)',
        '--is-text': 'rgba(255,255,255,0.96)',
        '--is-muted': 'rgba(235,235,245,0.70)',
        '--is-hair': 'rgba(255,255,255,0.14)',
        '--is-track': 'rgba(255,255,255,0.20)',
        '--is-warn': '#fcd34d',
        '--is-focus': 'rgba(255,255,255,0.70)',
        '--is-shadow': 'inset 0 0 0 1px rgba(255,255,255,0.14), inset 0 1px 0 rgba(255,255,255,0.16), 0 8px 22px rgba(0,0,0,0.30), 0 1px 4px rgba(0,0,0,0.20)',
      },
    };
  }
  return {
    dark: false, floating: true, glass: true,
    vars: {
      '--is-bg': `${GRAIN}, linear-gradient(180deg, rgba(255,255,255,0.55), rgba(255,255,255,0.15) 50%, rgba(255,255,255,0.05) 100%), rgba(246,246,250,0.78)`,
        '--is-ink': '#ffffff',
      '--is-raised': 'rgba(0,0,0,0.06)',
      '--is-raised-hover': 'rgba(0,0,0,0.10)',
      '--is-card': 'rgba(255,255,255,0.45)',
      '--is-text': 'rgba(0,0,0,0.90)',
      '--is-muted': 'rgba(40,40,48,0.80)',
      '--is-hair': 'rgba(0,0,0,0.08)',
      '--is-track': 'rgba(0,0,0,0.12)',
      '--is-warn': '#a14a06',
      '--is-focus': 'rgba(0,0,0,0.55)',
      '--is-shadow': 'inset 0 0 0 1px rgba(255,255,255,0.65), 0 0 0 1px rgba(0,0,0,0.07), 0 8px 22px rgba(15,23,42,0.18), 0 1px 4px rgba(15,23,42,0.08)',
    },
  };
}
