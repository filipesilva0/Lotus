// Accent palettes, free of the DOM so the core's tests can check their contrast (0.21).
import type { ColorPalette } from '../types/lotus';

export interface ThemeColors {
  name: string;
  vibrant: string;
  vibrantHover: string;
  vibrantLight: string;
  // Pastel for surfaces, badges, chips, sidebars
  pastel: string;
  pastelBorder: string;
  badgeBg: string;
  badgeText: string;
  // Dark mode pastel counterparts
  pastelDark: string;
  pastelBorderDark: string;
  badgeDarkBg: string;
  badgeDarkText: string;
}

export const PALETTES: Record<ColorPalette, ThemeColors> = {
  // Keys are stable (saved settings use them); values follow macOS system accent colours.
  amber: {
    name: 'Orange',
    vibrant: '#C25700', vibrantHover: '#A34900', vibrantLight: '#FF9F0A',
    pastel: '#FFF3E6', pastelBorder: '#FFD9B0', badgeBg: '#FFE8CC', badgeText: '#8A3F00',
    pastelDark: '#3A2A1A', pastelBorderDark: '#5C4126', badgeDarkBg: '#4A3220', badgeDarkText: '#FFC180',
  },
  purple: {
    name: 'Purple',
    vibrant: '#8944AB', vibrantHover: '#733795', vibrantLight: '#BF5AF2',
    pastel: '#F6EEFA', pastelBorder: '#E0C8EE', badgeBg: '#EBDCF4', badgeText: '#6B2F8A',
    pastelDark: '#2F2338', pastelBorderDark: '#4C3860', badgeDarkBg: '#3C2A4C', badgeDarkText: '#DDB4F2',
  },
  green: {
    name: 'Green',
    vibrant: '#1F7A3A', vibrantHover: '#186430', vibrantLight: '#30D158',
    pastel: '#EAF7EE', pastelBorder: '#BFE5CB', badgeBg: '#D6F0DD', badgeText: '#17602E',
    pastelDark: '#1D2E24', pastelBorderDark: '#2F4B3A', badgeDarkBg: '#23392B', badgeDarkText: '#9EE3B2',
  },
  blue: {
    name: 'Blue',
    vibrant: '#0A66E0', vibrantHover: '#0857BF', vibrantLight: '#0A84FF',
    pastel: '#E9F2FE', pastelBorder: '#BCD7FA', badgeBg: '#D5E7FD', badgeText: '#0A4DAF',
    pastelDark: '#1A2840', pastelBorderDark: '#2B4268', badgeDarkBg: '#1F3355', badgeDarkText: '#9CC8FF',
  },
  red: {
    name: 'Red',
    vibrant: '#C8203A', vibrantHover: '#A81A30', vibrantLight: '#EE5267',
    pastel: '#FDECEE', pastelBorder: '#F7C4CB', badgeBg: '#FADADF', badgeText: '#9A162B',
    pastelDark: '#3A1F24', pastelBorderDark: '#5E3239', badgeDarkBg: '#4A262C', badgeDarkText: '#FFB3BD',
  },
  yellow: {
    name: 'Yellow',
    // Deep gold so white labels on filled buttons keep >= 4.5:1; the bright petal yellow is the dark-mode accent.
    vibrant: '#8F5F00', vibrantHover: '#764E00', vibrantLight: '#F5CF3A',
    pastel: '#FFF7DB', pastelBorder: '#F2DE9A', badgeBg: '#FCEFC2', badgeText: '#6E4A00',
    pastelDark: '#352D17', pastelBorderDark: '#57492A', badgeDarkBg: '#443A1D', badgeDarkText: '#F5D77A',
  },
  graphite: {
    name: 'Graphite',
    vibrant: '#55555D', vibrantHover: '#45454C', vibrantLight: '#AEAEB6',
    pastel: '#F0F0F2', pastelBorder: '#D6D6DB', badgeBg: '#E6E6EA', badgeText: '#3C3C43',
    pastelDark: '#2A2A2E', pastelBorderDark: '#45454B', badgeDarkBg: '#36363B', badgeDarkText: '#D1D1D6',
  },
  pink: {
    name: 'Pink',
    vibrant: '#C42A76', vibrantHover: '#A5215F', vibrantLight: '#FF375F',
    pastel: '#FCEBF3', pastelBorder: '#F4C3DA', badgeBg: '#F9D8E8', badgeText: '#9A1F5B',
    pastelDark: '#35202B', pastelBorderDark: '#58354A', badgeDarkBg: '#452A38', badgeDarkText: '#F7B0CF',
  },
};

/**
 * The one accent the whole app uses (0.21). Sessions 8 to 0.20 gave each page its own petal colour
 * (Chat blue, Work red, Images orange, Voice yellow, Tasks green); the user dropped that idea, so every
 * page, the setup guide and the mascot now share Lotus blue. The other palettes stay because saved
 * settings and older code paths still name them.
 */
export const APP_PALETTE: ColorPalette = 'blue';

/** Dark-mode fills for palettes whose light fill is too dark against the dark window (see applyThemeToDocument). */
export const DARK_FILL: Partial<Record<ColorPalette, [string, string]>> = { yellow: ['#9C6A00', '#8F5F00'] };

/** The window surfaces the accent sits on (applyThemeToDocument sets these). */
export const SURFACES = {
  light: { base: '#E8E8EB', panel: '#FFFFFF' },
  dark: { base: '#1C1C1E', panel: '#272729' },
} as const;

/** The accent tokens applyThemeToDocument sets for one palette and appearance. */
export function accentTokens(paletteKey: ColorPalette, dark: boolean) {
  const p = PALETTES[paletteKey] || PALETTES.blue;
  const fill = dark ? DARK_FILL[paletteKey] : undefined;
  return {
    vibrant: dark ? p.vibrantLight : p.vibrant,
    hover: dark ? p.vibrant : p.vibrantHover,
    fill: fill?.[0] ?? p.vibrant,
    fillHover: fill?.[1] ?? p.vibrantHover,
  };
}
