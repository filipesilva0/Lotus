import { isTauri } from './http';
import type { Appearance } from '../types/lotus';

/**
 * Real window translucency. The main window is transparent and Windows draws acrylic behind it,
 * so the page rail and title bar show the user's own wallpaper. Nothing is painted to imitate it.
 * The tint follows the effective appearance. In 'auto' the window theme is left to the OS (null),
 * so WebView2's prefers-color-scheme tracks Windows' light/dark setting live.
 * If the effect cannot be applied (older Windows, browser preview), `.no-glass` gives the page a
 * normal opaque background instead of an invisible window.
 */
export async function applyWindowGlass(appearance: Appearance, dark: boolean): Promise<void> {
  const root = document.documentElement;
  if (!isTauri) { root.classList.add('no-glass'); return; }
  try {
    const { getCurrentWindow, Effect } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    await win.setTheme(appearance === 'auto' ? null : appearance);
    await win.setEffects({ effects: [Effect.Acrylic], color: dark ? [28, 28, 30, 150] : [245, 245, 247, 120] });
    root.classList.remove('no-glass');
  } catch {
    root.classList.add('no-glass');
  }
}

/** The OS appearance right now (true = dark). */
export const systemPrefersDark = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;

/**
 * Calls `cb` whenever Windows switches between light and dark. Uses the WebView's media query and,
 * in the desktop app, the window's theme-changed event as well (either one is enough).
 */
export function onSystemAppearance(cb: (dark: boolean) => void): () => void {
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  const h = (e: MediaQueryListEvent) => cb(e.matches);
  mq?.addEventListener?.('change', h);
  let off: (() => void) | undefined;
  let alive = true;
  if (isTauri) {
    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const un = await getCurrentWindow().onThemeChanged(({ payload }) => cb(payload === 'dark'));
      if (alive) off = un; else un();
    }).catch(() => undefined);
  }
  return () => { alive = false; mq?.removeEventListener?.('change', h); off?.(); };
}
