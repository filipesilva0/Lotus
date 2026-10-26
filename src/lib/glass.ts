import { isTauri } from './http';

/**
 * Real window translucency. The main window is transparent and Windows draws acrylic behind it,
 * so the sidebar shows the user's own wallpaper. Nothing is painted to imitate it.
 * The tint follows the app's appearance. If the effect cannot be applied (older Windows, browser
 * preview), `.no-glass` gives the page a normal opaque background instead of an invisible window.
 */
export async function applyWindowGlass(dark: boolean): Promise<void> {
  const root = document.documentElement;
  if (!isTauri) { root.classList.add('no-glass'); return; }
  try {
    const { getCurrentWindow, Effect } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    await win.setTheme(dark ? 'dark' : 'light');
    await win.setEffects({ effects: [Effect.Acrylic], color: dark ? [28, 28, 30, 150] : [245, 245, 247, 120] });
    root.classList.remove('no-glass');
  } catch {
    root.classList.add('no-glass');
  }
}
