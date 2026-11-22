// The island's look (0.23 redesign). Two surfaces, one accent:
//   dark  pure black, flush with the top edge of the screen, so it reads as growing out of the bezel
//         (the notch on a MacBook). Flared top corners.
//   light a white floating card a few pixels below the top edge, with a soft shadow, so it doesn't
//         look like a black hole on a light desktop.
// The accent is the app's one accent (--color-accent-vibrant); Petal keeps its own pink face.
// Pure (no DOM), so core tests can check it.

export type IslandSurface = 'auto' | 'black';

export interface IslandLook {
  dark: boolean;
  /** Light: a card below the edge with a shadow. Dark: flush with the edge, flared corners. */
  floating: boolean;
  vars: Record<string, string>;
}

/** Space around a floating island for its shadow, in px (inside the transparent window). */
export const FLOAT_GAP = { top: 8, side: 16, bottom: 22 };

export function islandLook(appDark: boolean, surface: IslandSurface, mac: boolean): IslandLook {
  // On a Mac the island sits over the notch, which is black whatever the theme.
  const dark = mac || surface === 'black' || appDark;
  if (dark) {
    return {
      dark: true, floating: false,
      vars: {
        '--is-bg': '#000',
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
    dark: false, floating: true,
    vars: {
      '--is-bg': '#ffffff',
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
      '--is-shadow': '0 0 0 1px rgba(0,0,0,0.06), 0 10px 28px rgba(15,23,42,0.18), 0 2px 6px rgba(15,23,42,0.08)',
    },
  };
}
