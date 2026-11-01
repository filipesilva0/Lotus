// macOS: the app's menus live in the system menu bar at the top of the screen, not inside the window
// (session 10). Built from the same MenuDef list the Windows/Linux title bar shows, so every item does
// the same real thing. Edit uses the system's own items so Cmd+C / Cmd+V / Cmd+Z work in every field.

import type { MenuDef, MenuItem as AppItem } from '../components/common/TitleBar';
import { isTauri } from './http';

/** "Ctrl+Alt+S" → "CmdOrCtrl+Alt+S"; "Alt+Left" → "Alt+Left". */
export function toAccelerator(shortcut?: string): string | undefined {
  if (!shortcut) return undefined;
  return shortcut.split('+').map((k) => (k === 'Ctrl' ? 'CmdOrCtrl' : k)).join('+');
}

/** On macOS the in-window shortcut hints read Cmd-style ("⌘N"); elsewhere they stay as written. */
export function macShortcut(shortcut?: string): string | undefined {
  if (!shortcut) return undefined;
  const map: Record<string, string> = { Ctrl: '⌘', Alt: '⌥', Shift: '⇧', Left: '←', Right: '→' };
  return shortcut.split('+').map((k) => map[k] ?? k).join('');
}

/** What changes the menu's look; the menu is rebuilt only when this string changes. */
export function menuSignature(menus: MenuDef[]): string {
  return menus.map((m) => `${m.label}[${m.items.map((i) => (i === 'separator' ? '-' : `${i.label}:${i.checked ? 1 : 0}${i.disabled ? 'd' : ''}`)).join(',')}]`).join('|');
}

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

  const settings = menus.flatMap((m) => m.items).find((i): i is AppItem => i !== 'separator' && i.label.startsWith('Settings'));
  const appMenu = await Submenu.new({
    text: appName,
    items: [
      await PredefinedMenuItem.new({ item: { About: { name: appName } } }),
      await sep(),
      ...(settings ? [await MenuItem.new({ text: 'Settings…', accelerator: 'CmdOrCtrl+,', action: () => run('File', settings.label) })] : []),
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
  for (const m of menus) {
    if (m.label === 'Edit') {
      subs.push(await Submenu.new({
        text: 'Edit',
        items: [
          await PredefinedMenuItem.new({ item: 'Undo' }), await PredefinedMenuItem.new({ item: 'Redo' }), await sep(),
          await PredefinedMenuItem.new({ item: 'Cut' }), await PredefinedMenuItem.new({ item: 'Copy' }), await PredefinedMenuItem.new({ item: 'Paste' }),
          await PredefinedMenuItem.new({ item: 'SelectAll' }),
        ],
      }));
      continue;
    }
    // Settings and Quit already sit in the app menu, where macOS expects them.
    const entries = tidySeparators(m.items.filter((it) => it === 'separator' || !(m.label === 'File' && (it.label.startsWith('Settings') || it.label.startsWith('Quit')))));
    const items = [];
    for (const it of entries) {
      if (it === 'separator') { items.push(await sep()); continue; }
      const common = { text: it.label, enabled: !it.disabled, accelerator: toAccelerator(it.shortcut), action: () => run(m.label, it.label) };
      items.push(it.checked === undefined ? await MenuItem.new(common) : await CheckMenuItem.new({ ...common, checked: it.checked }));
    }
    subs.push(await Submenu.new({ text: m.label, items }));
    if (m.label === 'View') {
      subs.push(await Submenu.new({
        text: 'Window',
        items: [await PredefinedMenuItem.new({ item: 'Minimize' }), await PredefinedMenuItem.new({ item: 'Maximize' }), await sep(), await PredefinedMenuItem.new({ item: 'Fullscreen' })],
      }));
    }
  }
  const menu = await Menu.new({ items: subs });
  await menu.setAsAppMenu();
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
