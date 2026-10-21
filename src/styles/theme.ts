import { ColorPalette, FontFamily, FontSize } from '../types/tomo';

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
  amber: {
    name: 'Warm Amber',
    vibrant: '#D97706',
    vibrantHover: '#B45309',
    vibrantLight: '#FBBF24',
    pastel: '#FFF8EB',
    pastelBorder: '#FDE68A',
    badgeBg: '#FEF3C7',
    badgeText: '#92400E',
    pastelDark: '#2B2317',
    pastelBorderDark: '#59401C',
    badgeDarkBg: '#3F2C12',
    badgeDarkText: '#FDE68A',
  },
  purple: {
    name: 'Electric Purple',
    vibrant: '#7C3AED',
    vibrantHover: '#6D28D9',
    vibrantLight: '#A78BFA',
    pastel: '#F7F3FF',
    pastelBorder: '#DDD6FE',
    badgeBg: '#EDE9FE',
    badgeText: '#5B21B6',
    pastelDark: '#271F36',
    pastelBorderDark: '#4D366B',
    badgeDarkBg: '#392257',
    badgeDarkText: '#DDD6FE',
  },
  green: {
    name: 'Emerald Mint',
    vibrant: '#059669',
    vibrantHover: '#047857',
    vibrantLight: '#34D399',
    pastel: '#F0FDF4',
    pastelBorder: '#A7F3D0',
    badgeBg: '#D1FAE5',
    badgeText: '#065F46',
    pastelDark: '#182920',
    pastelBorderDark: '#284F3B',
    badgeDarkBg: '#1B3B2B',
    badgeDarkText: '#A7F3D0',
  },
  blue: {
    name: 'Sapphire Blue',
    vibrant: '#2563EB',
    vibrantHover: '#1D4ED8',
    vibrantLight: '#60A5FA',
    pastel: '#F0F6FF',
    pastelBorder: '#BFDBFE',
    badgeBg: '#DBEAFE',
    badgeText: '#1E40AF',
    pastelDark: '#1B2436',
    pastelBorderDark: '#2C3E61',
    badgeDarkBg: '#1E3252',
    badgeDarkText: '#BFDBFE',
  },
  pink: {
    name: 'Rose Pink',
    vibrant: '#DB2777',
    vibrantHover: '#BE185D',
    vibrantLight: '#F472B6',
    pastel: '#FDF2F8',
    pastelBorder: '#FBCFE8',
    badgeBg: '#FCE7F3',
    badgeText: '#9D174D',
    pastelDark: '#2F1B25',
    pastelBorderDark: '#572C41',
    badgeDarkBg: '#441F32',
    badgeDarkText: '#FBCFE8',
  },
};

export const FONTS: Record<FontFamily, { name: string; family: string }> = {
  jakarta: {
    name: 'Plus Jakarta Sans',
    family: "'Plus Jakarta Sans Variable', 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
  },
  inter: {
    name: 'Inter',
    family: "'Inter Variable', 'Inter', system-ui, -apple-system, sans-serif",
  },
  outfit: {
    name: 'Outfit',
    family: "'Outfit Variable', 'Outfit', system-ui, -apple-system, sans-serif",
  },
  mono: {
    name: 'JetBrains Mono',
    family: "'JetBrains Mono Variable', 'JetBrains Mono', monospace",
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

  // Background and base surface variables
  // White in light mode, Dark Grey (#18191E / #22242B) in dark mode
  if (darkMode) {
    root.classList.add('dark');
    root.style.setProperty('--color-bg-base', '#18191E');
    root.style.setProperty('--color-bg-panel', '#18191E');
    root.style.setProperty('--color-bg-card', '#22242B');
    root.style.setProperty('--color-bg-sidebar', '#1D1F25');
    root.style.setProperty('--color-border-subtle', '#2C2F38');
    root.style.setProperty('--color-text-main', '#F3F4F6');
    root.style.setProperty('--color-text-muted', '#9CA3AF');

    root.style.setProperty('--color-accent-pastel', palette.pastelDark);
    root.style.setProperty('--color-accent-pastel-border', palette.pastelBorderDark);
    root.style.setProperty('--color-badge-bg', palette.badgeDarkBg);
    root.style.setProperty('--color-badge-text', palette.badgeDarkText);
  } else {
    root.classList.remove('dark');
    root.style.setProperty('--color-bg-base', '#FFFFFF');
    root.style.setProperty('--color-bg-panel', '#FFFFFF');
    root.style.setProperty('--color-bg-card', '#FFFFFF');
    root.style.setProperty('--color-bg-sidebar', '#F9FAFC');
    root.style.setProperty('--color-border-subtle', '#EBECEF');
    root.style.setProperty('--color-text-main', '#111827');
    root.style.setProperty('--color-text-muted', '#6B7280');

    root.style.setProperty('--color-accent-pastel', palette.pastel);
    root.style.setProperty('--color-accent-pastel-border', palette.pastelBorder);
    root.style.setProperty('--color-badge-bg', palette.badgeBg);
    root.style.setProperty('--color-badge-text', palette.badgeText);
  }

  // Vibrant accent variables
  root.style.setProperty('--color-accent-vibrant', palette.vibrant);
  root.style.setProperty('--color-accent-hover', palette.vibrantHover);
  root.style.setProperty('--color-accent-light', palette.vibrantLight);

  // Set Font Family & Size scale
  root.style.setProperty('--font-primary', font.family);
  document.body.style.fontFamily = font.family;

  const fontScaleMap: Record<FontSize, string> = {
    sm: '0.925rem',
    md: '1rem',
    lg: '1.075rem',
  };
  root.style.fontSize = fontScaleMap[fontSize] || '1rem';
}
