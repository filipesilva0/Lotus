import { ColorPalette, FontFamily, FontSize } from '../types/lotus';
import { PALETTES, SURFACES, accentTokens } from './palettes';

export { PALETTES, APP_PALETTE, SURFACES, accentTokens } from './palettes';
export type { ThemeColors } from './palettes';

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
  const accent = accentTokens(paletteKey, darkMode);
  const font = FONTS[fontKey] || FONTS.jakarta;
  const root = document.documentElement;

  // Semantic surface/text tokens. Components must use these (var(--color-*)) and never hard-code hex.
  // Muted text is >= 4.5:1 on every surface it sits on, sidebars and hover fills included, in both themes
  // (WCAG AA; 0.20 raised it: light grey was 3.9:1 on the sidebar). Do not add a lighter grey.
  if (darkMode) {
    root.classList.add('dark');
    root.style.colorScheme = 'dark';
    // windowBackgroundColor / controlBackgroundColor / sidebar / separatorColor / labelColor / secondaryLabelColor
    root.style.setProperty('--color-bg-base', SURFACES.dark.base);
    root.style.setProperty('--color-bg-panel', SURFACES.dark.panel);
    root.style.setProperty('--color-bg-card', '#2C2C2F');
    root.style.setProperty('--color-bg-sidebar', '#2A2A2D');
    root.style.setProperty('--color-border-subtle', 'rgba(255,255,255,0.12)');
    root.style.setProperty('--color-text-main', 'rgba(255,255,255,0.92)');
    root.style.setProperty('--color-text-muted', 'rgba(235,235,245,0.68)');

    root.style.setProperty('--color-accent-pastel', palette.pastelDark);
    root.style.setProperty('--color-accent-pastel-border', palette.pastelBorderDark);
    root.style.setProperty('--color-badge-bg', palette.badgeDarkBg);
    root.style.setProperty('--color-badge-text', palette.badgeDarkText);
    // On dark surfaces the accent is the brighter system variant.
    root.style.setProperty('--color-accent-vibrant', accent.vibrant);
    root.style.setProperty('--color-accent-hover', accent.hover);
  } else {
    root.classList.remove('dark');
    root.style.colorScheme = 'light';
    root.style.setProperty('--color-bg-base', SURFACES.light.base);
    root.style.setProperty('--color-bg-panel', SURFACES.light.panel);
    root.style.setProperty('--color-bg-card', '#FFFFFF');
    root.style.setProperty('--color-bg-sidebar', '#E8E8EA');
    root.style.setProperty('--color-border-subtle', 'rgba(0,0,0,0.12)');
    root.style.setProperty('--color-text-main', 'rgba(0,0,0,0.88)');
    root.style.setProperty('--color-text-muted', 'rgba(60,60,67,0.80)');

    root.style.setProperty('--color-accent-pastel', palette.pastel);
    root.style.setProperty('--color-accent-pastel-border', palette.pastelBorder);
    root.style.setProperty('--color-badge-bg', palette.badgeBg);
    root.style.setProperty('--color-badge-text', palette.badgeText);
    root.style.setProperty('--color-accent-vibrant', accent.vibrant);
    root.style.setProperty('--color-accent-hover', accent.hover);
  }

  // Filled controls always use the deeper accent so white labels keep >= 4.5:1 in both appearances.
  // 0.20: on dark surfaces the deep gold fill blended into the background (2.7:1), so dark mode uses a
  // slightly brighter gold that still keeps white labels above 4.5:1 and the button edge above 3:1.
  root.style.setProperty('--color-accent-fill', accent.fill);
  root.style.setProperty('--color-accent-fill-hover', accent.fillHover);
  root.style.setProperty('--color-accent-light', palette.vibrantLight);
  // System status colours (systemGreen / systemRed / systemOrange, adapted per appearance).
  root.style.setProperty('--c-green', darkMode ? '#30D158' : '#248A3D');
  root.style.setProperty('--c-red', darkMode ? '#FF453A' : '#D70015');
  root.style.setProperty('--c-orange', darkMode ? '#FF9F0A' : '#B25000');
  // Chart hues (validated set from session 7, used by Hardware & Runtime).
  root.style.setProperty('--c-blue', darkMode ? '#3B86EE' : '#0A6FE0');
  root.style.setProperty('--c-purple', darkMode ? '#AE66D2' : '#B455D6');

  // Set Font Family & Size scale
  root.style.setProperty('--font-primary', font.family);
  document.body.style.fontFamily = font.family;

  // Dynamic type: everything sized in rem scales with this; the OS text-size setting still applies on top.
  const fontScaleMap: Record<FontSize, string> = { sm: '15px', md: '16px', lg: '18px' };
  root.style.fontSize = fontScaleMap[fontSize] || '16px';
}
