// macOS: the app's menus live in the system menu bar at the top of the screen, not inside the window
// (session 10). Built from the same MenuDef list the Windows/Linux title bar shows, so every item does
// the same real thing. Edit uses the system's own items so Cmd+C / Cmd+V / Cmd+Z work in every field.
// Session 13 (HIG "The menu bar"): Mac key equivalents per item (`mac`), Close Window / Full Screen /
// Bring All to Front from the system, the Window and Help menus registered with macOS (window list,
// Help search), and app-specific Edit items such as Find after the system ones.

import type { MenuDef, MenuItem as AppItem } from '../components/common/TitleBar';
import { isTauri } from './http';

/** "Ctrl+Alt+S" → "CmdOrCtrl+Alt+S"; "Alt+Left" → "Alt+Left". */
export function toAccelerator(shortcut?: string): string | undefined {
  if (!shortcut) return undefined;
  return shortcut.split('+').map((k) => (k === 'Ctrl' ? 'CmdOrCtrl' : k)).join('+');
}

/** The accelerator an item gets in the macOS menu bar. */
export const macAccelerator = (it: Pick<AppItem, 'shortcut' | 'mac'>): string | undefined => it.mac ?? toAccelerator(it.shortcut);

/** Mac-style key symbols in Apple's order (⌃⌥⇧⌘): "Ctrl+Cmd+S" → "⌃⌘S", "Ctrl+N" (no `mac`) → "⌘N". */
export function macShortcut(shortcut?: string): string | undefined {
  if (!shortcut) return undefined;
  const parts = shortcut.split('+');
  const key = parts.pop() ?? '';
  const mods = new Set(parts.map((k) => (k === 'CmdOrCtrl' ? 'Cmd' : k)));
  // A plain Windows shortcut ("Ctrl+N") means Command on the Mac.
  if (!mods.has('Cmd') && mods.has('Ctrl') && !shortcut.includes('Cmd')) { mods.delete('Ctrl'); mods.add('Cmd'); }
  const order: [string, string][] = [['Ctrl', '⌃'], ['Alt', '⌥'], ['Shift', '⇧'], ['Cmd', '⌘']];
  const keys: Record<string, string> = { Left: '←', Right: '→', Up: '↑', Down: '↓', '/': mods.has('Shift') ? '?' : '/' };
  if (key === '/' && mods.has('Shift')) mods.delete('Shift');
  return order.filter(([m]) => mods.has(m)).map(([, s]) => s).join('') + (keys[key] ?? key);
}

/** Does this keydown match a Windows-style shortcut ("Ctrl+Alt+S", "Alt+Left", "F1", "Ctrl+,")? */
export function matchesShortcut(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, shortcut: string): boolean {
  const parts = shortcut.split('+');
  const key = parts.pop() ?? '';
  const want = { ctrl: parts.includes('Ctrl'), alt: parts.includes('Alt'), shift: parts.includes('Shift') };
  if ((e.ctrlKey || e.metaKey) !== want.ctrl || e.altKey !== want.alt || e.shiftKey !== want.shift) return false;
  const named: Record<string, string> = { Left: 'ArrowLeft', Right: 'ArrowRight', Up: 'ArrowUp', Down: 'ArrowDown' };
  const k = named[key] ?? key;
  return k.length === 1 ? e.key.toLowerCase() === k.toLowerCase() : e.key === k;
}

/** What changes the menu's look; the menu is rebuilt only when this string changes. */
export function menuSignature(menus: MenuDef[]): string {
  return menus.map((m) => `${m.label}[${m.items.map((i) => (i === 'separator' ? '-' : `${i.label}:${i.checked ? 1 : 0}${i.disabled ? 'd' : ''}`)).join(',')}]`).join('|');
}

/** Edit items macOS draws itself (so they work in every text field). */
const SYSTEM_EDIT = new Set(['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Select All']);

/**
 * Installs the menus as the macOS application menu. `latest` is read when an item is clicked, so the
 * handlers are always the current ones even though the native menu is only rebuilt on visible changes.
 */
export async function installMacMenu(menus: MenuDef[], latest: () => MenuDef[], appName = 'Lotus'): Promise<void> {
  if (!isTauri) return;
  const { Menu, Submenu, MenuItem, CheckMenuItem, PredefinedMenuItem } = await import('@tauri-apps/api/menu');
  const sep = () => PredefinedMenuItem.new({ item: 'Separator' });

  const run = (menuLabel: string, itemLabel: string) => {
    const m = latest().find((x) => x.label === menuLabel);
    const it = m?.items.find((i): i is AppItem => i !== 'separator' && i.label === itemLabel);
    if (it && !it.disabled) it.onSelect();
  };
  const appItem = async (menuLabel: string, it: AppItem) => {
    const common = { text: it.label, enabled: !it.disabled, accelerator: macAccelerator(it), action: () => run(menuLabel, it.label) };
    return it.checked === undefined ? MenuItem.new(common) : CheckMenuItem.new({ ...common, checked: it.checked });
  };

  const settings = menus.flatMap((m) => m.items).find((i): i is AppItem => i !== 'separator' && i.label.startsWith('Settings'));
  const appMenu = await Submenu.new({
    text: appName,
    items: [
      await PredefinedMenuItem.new({ item: { About: { name: appName } } }),
      await sep(),
      ...(settings ? [await MenuItem.new({ text: 'Settings…', accelerator: 'Cmd+,', action: () => run('File', settings.label) })] : []),
      await sep(),
      await PredefinedMenuItem.new({ item: 'Services' }),
      await sep(),
      await PredefinedMenuItem.new({ item: 'Hide' }),
      await PredefinedMenuItem.new({ item: 'HideOthers' }),
      await PredefinedMenuItem.new({ item: 'ShowAll' }),
      await sep(),
      await PredefinedMenuItem.new({ item: 'Quit' }),
    ],
  });

  const subs = [appMenu];
  let windowMenu: Awaited<ReturnType<typeof Submenu.new>> | null = null;
  let helpMenu: Awaited<ReturnType<typeof Submenu.new>> | null = null;
  for (const m of menus) {
    const items = [];
    if (m.label === 'Edit') {
      items.push(
        await PredefinedMenuItem.new({ item: 'Undo' }), await PredefinedMenuItem.new({ item: 'Redo' }), await sep(),
        await PredefinedMenuItem.new({ item: 'Cut' }), await PredefinedMenuItem.new({ item: 'Copy' }), await PredefinedMenuItem.new({ item: 'Paste' }),
        await PredefinedMenuItem.new({ item: 'SelectAll' }),
      );
      const extra = tidySeparators(m.items.filter((it) => it === 'separator' || !SYSTEM_EDIT.has(it.label)));
      if (extra.length) items.push(await sep());
      for (const it of extra) items.push(it === 'separator' ? await sep() : await appItem(m.label, it));
    } else {
      // Settings and Quit already sit in the app menu, where macOS expects them.
      const entries = tidySeparators(m.items.filter((it) => it === 'separator' || !(m.label === 'File' && (it.label.startsWith('Settings') || it.label.startsWith('Quit')))));
      for (const it of entries) {
        if (it === 'separator') items.push(await sep());
        else if (m.label === 'File' && it.label === 'Close Window') items.push(await PredefinedMenuItem.new({ item: 'CloseWindow' }));
        else items.push(await appItem(m.label, it));
      }
      // View always offers Enter Full Screen on the Mac (HIG: View menu).
      if (m.label === 'View') items.push(await sep(), await PredefinedMenuItem.new({ item: 'Fullscreen' }));
    }
    const sub = await Submenu.new({ text: m.label, items });
    if (m.label === 'Help') {
      // Window comes just before Help.
      windowMenu = await Submenu.new({
        text: 'Window',
        items: [await PredefinedMenuItem.new({ item: 'Minimize' }), await PredefinedMenuItem.new({ item: 'Maximize' }), await sep(), await PredefinedMenuItem.new({ item: 'BringAllToFront' })],
      });
      subs.push(windowMenu);
      helpMenu = sub;
    }
    subs.push(sub);
  }
  const menu = await Menu.new({ items: subs });
  await menu.setAsAppMenu();
  await windowMenu?.setAsWindowsMenuForNSApp().catch(() => undefined);
  await helpMenu?.setAsHelpMenuForNSApp().catch(() => undefined);
}

/** No separator at either end and never two in a row. */
export function tidySeparators<T>(items: (T | 'separator')[]): (T | 'separator')[] {
  const out: (T | 'separator')[] = [];
  for (const it of items) {
    if (it === 'separator' && (!out.length || out[out.length - 1] === 'separator')) continue;
    out.push(it);
  }
  while (out.length && out[out.length - 1] === 'separator') out.pop();
  return out;
}
