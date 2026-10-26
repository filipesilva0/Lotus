import { ColorPalette, FontFamily, FontSize } from '../types/lotus';

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
  pink: {
    name: 'Pink',
    vibrant: '#C42A76', vibrantHover: '#A5215F', vibrantLight: '#FF375F',
    pastel: '#FCEBF3', pastelBorder: '#F4C3DA', badgeBg: '#F9D8E8', badgeText: '#9A1F5B',
    pastelDark: '#35202B', pastelBorderDark: '#58354A', badgeDarkBg: '#452A38', badgeDarkText: '#F7B0CF',
  },
};

export const FONTS: Record<FontFamily, { name: string; family: string }> = {
  // 'jakarta' is the stored key for the default; it now means the system UI font
  // (San Francisco on macOS, Segoe UI Variable on Windows). Never bundled or redistributed.
  jakarta: {
    name: 'System (San Francisco)',
    family: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
  },
  inter: {
    name: 'Inter',
    family: "'Inter Variable', 'Inter', system-ui, -apple-system, sans-serif",
  },
  outfit: {
    name: 'System Rounded',
    family: "ui-rounded, 'SF Pro Rounded', 'Segoe UI Variable Display', system-ui, sans-serif",
  },
  mono: {
    name: 'Monospaced',
    family: "ui-monospace, 'SF Mono', 'Cascadia Mono', 'JetBrains Mono Variable', Consolas, monospace",
  },
};

export function applyThemeToDocument(
  paletteKey: ColorPalette,
  fontKey: FontFamily,
  fontSize: FontSize,
  darkMode: boolean
) {
  const palette = PALETTES[paletteKey] || PALETTES.blue;
  const font = FONTS[fontKey] || FONTS.jakarta;
  const root = document.documentElement;

  // Semantic surface/text tokens. Components must use these (var(--color-*)) and never hard-code hex.
  // Muted text is >= 4.5:1 on its surface in both themes (WCAG AA); do not add a lighter grey.
  if (darkMode) {
    root.classList.add('dark');
    root.style.colorScheme = 'dark';
    // windowBackgroundColor / controlBackgroundColor / sidebar / separatorColor / labelColor / secondaryLabelColor
    root.style.setProperty('--color-bg-base', '#1C1C1E');
    root.style.setProperty('--color-bg-panel', '#272729');
    root.style.setProperty('--color-bg-card', '#2C2C2F');
    root.style.setProperty('--color-bg-sidebar', '#2A2A2D');
    root.style.setProperty('--color-border-subtle', 'rgba(255,255,255,0.12)');
    root.style.setProperty('--color-text-main', 'rgba(255,255,255,0.92)');
    root.style.setProperty('--color-text-muted', 'rgba(235,235,245,0.62)');

    root.style.setProperty('--color-accent-pastel', palette.pastelDark);
    root.style.setProperty('--color-accent-pastel-border', palette.pastelBorderDark);
    root.style.setProperty('--color-badge-bg', palette.badgeDarkBg);
    root.style.setProperty('--color-badge-text', palette.badgeDarkText);
    // On dark surfaces the accent is the brighter system variant.
    root.style.setProperty('--color-accent-vibrant', palette.vibrantLight);
    root.style.setProperty('--color-accent-hover', palette.vibrant);
  } else {
    root.classList.remove('dark');
    root.style.colorScheme = 'light';
    root.style.setProperty('--color-bg-base', '#E8E8EB');
    root.style.setProperty('--color-bg-panel', '#FFFFFF');
    root.style.setProperty('--color-bg-card', '#FFFFFF');
    root.style.setProperty('--color-bg-sidebar', '#E8E8EA');
    root.style.setProperty('--color-border-subtle', 'rgba(0,0,0,0.12)');
    root.style.setProperty('--color-text-main', 'rgba(0,0,0,0.88)');
    root.style.setProperty('--color-text-muted', 'rgba(60,60,67,0.68)');

    root.style.setProperty('--color-accent-pastel', palette.pastel);
    root.style.setProperty('--color-accent-pastel-border', palette.pastelBorder);
    root.style.setProperty('--color-badge-bg', palette.badgeBg);
    root.style.setProperty('--color-badge-text', palette.badgeText);
    root.style.setProperty('--color-accent-vibrant', palette.vibrant);
    root.style.setProperty('--color-accent-hover', palette.vibrantHover);
  }

  // Filled controls always use the deeper accent so white labels keep >= 4.5:1 in both appearances.
  root.style.setProperty('--color-accent-fill', palette.vibrant);
  root.style.setProperty('--color-accent-fill-hover', palette.vibrantHover);
  root.style.setProperty('--color-accent-light', palette.vibrantLight);
  // System status colours (systemGreen / systemRed / systemOrange, adapted per appearance).
  root.style.setProperty('--c-green', darkMode ? '#30D158' : '#248A3D');
  root.style.setProperty('--c-red', darkMode ? '#FF453A' : '#D70015');
  root.style.setProperty('--c-orange', darkMode ? '#FF9F0A' : '#B25000');

  // Set Font Family & Size scale
  root.style.setProperty('--font-primary', font.family);
  document.body.style.fontFamily = font.family;

  // Dynamic type: everything sized in rem scales with this; the OS text-size setting still applies on top.
  const fontScaleMap: Record<FontSize, string> = { sm: '15px', md: '16px', lg: '18px' };
  root.style.fontSize = fontScaleMap[fontSize] || '16px';
}
