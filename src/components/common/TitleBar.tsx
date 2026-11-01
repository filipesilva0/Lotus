import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, PanelLeft, PanelRight } from 'lucide-react';
import { Symbol } from './Symbol';
import { isTauri } from '../../lib/http';
import { desktopOs } from '../../lib/glass';

/**
 * Custom window title bar. The native Windows caption is turned off (`decorations: false` in
 * tauri.conf.json). Session 8: the bar has no surface of its own; it sits on the same window
 * acrylic as the page rail under it, so the frosted field is one seamless piece. (It must not use
 * backdrop-filter: that made it a backdrop root, and its menus then had nothing to blur.)
 *
 * Left: back / forward through pages, left / right panel toggles, and a real menu bar (File, Edit, View, Help).
 * Right: minimise, maximise/restore, close. Empty space drags the window; double-click maximises.
 * Window controls only render inside Tauri, where they work.
 *
 * Session 10, per OS:
 * - Windows: as above (custom caption, Windows-style minimise / maximise / close on the right).
 * - macOS: the window keeps the system's own traffic lights (top left, `titleBarStyle: Overlay` in
 *   tauri.macos.conf.json); the bar leaves room for them and shows no menus, because File / Edit /
 *   View / Help live in the macOS menu bar (lib/nativeMenu.ts).
 * - Linux: the desktop's own title bar draws the window buttons (decorations on in
 *   tauri.linux.conf.json); this bar keeps navigation and the menus.
 */
export type ChromeOs = 'windows' | 'macos' | 'linux';
/** Which chrome to draw. In a browser preview the Windows layout is shown. */
export const chromeOs = (): ChromeOs => (isTauri ? desktopOs() : 'windows');

export interface MenuItem {
  label: string;
  /** Shown right-aligned, for discoverability only (the shortcut itself is handled elsewhere). */
  shortcut?: string;
  onSelect: () => void;
  disabled?: boolean;
  checked?: boolean;
}
export type MenuEntry = MenuItem | 'separator';
export interface MenuDef { label: string; items: MenuEntry[] }

interface TitleBarProps {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  /** The current page's left panel (its list) and right panel (its inspector). */
  leftPanel: boolean;
  rightPanel: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  menus: MenuDef[];
  /** Override for tests and screenshots. */
  os?: ChromeOs;
  /** Only the window controls and a drag area (the first-run guide). */
  bare?: boolean;
}

type Win = { minimize(): Promise<void>; toggleMaximize(): Promise<void>; close(): Promise<void>; isMaximized(): Promise<boolean>; onResized(cb: () => void): Promise<() => void> };

async function currentWindow(): Promise<Win | null> {
  if (!isTauri) return null;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    return getCurrentWindow() as unknown as Win;
  } catch {
    return null;
  }
}

/** Keeps focus where it is (e.g. in the chat box) so Edit > Paste lands in the right field. */
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

const navBtn =
  'w-8 h-7 inline-flex items-center justify-center rounded-[6px] text-[var(--color-text-muted)] transition-colors duration-100 ' +
  'hover:bg-[var(--hover)] hover:text-[var(--color-text-main)] active:bg-[var(--pressed)] ' +
  'disabled:opacity-35 disabled:pointer-events-none focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)]';

export const TitleBar: React.FC<TitleBarProps> = ({ canGoBack, canGoForward, onBack, onForward, leftPanel, rightPanel, onToggleLeft, onToggleRight, menus, os: osProp, bare }) => {
  const os = osProp ?? chromeOs();
  const mac = os === 'macos';
  const tipKeys = (pc: string, macKeys: string) => (mac ? macKeys : pc);
  const [win, setWin] = useState<Win | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let off: (() => void) | undefined;
    let alive = true;
    void currentWindow().then(async (w) => {
      if (!w || !alive) return;
      setWin(w);
      const sync = () => void w.isMaximized().then(setMaximized).catch(() => undefined);
      sync();
      off = await w.onResized(sync).catch(() => undefined);
    });
    return () => { alive = false; off?.(); };
  }, []);

  // Close an open menu on outside click, Escape, or window blur.
  useEffect(() => {
    if (open === null) return;
    const down = (e: MouseEvent) => { if (!barRef.current?.contains(e.target as Node)) setOpen(null); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(null); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); setOpen((i) => (i === null ? 0 : (i + 1) % menus.length)); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setOpen((i) => (i === null ? 0 : (i - 1 + menus.length) % menus.length)); }
    };
    const blur = () => setOpen(null);
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key); window.removeEventListener('blur', blur); };
  }, [open, menus.length]);

  const select = useCallback((item: MenuItem) => { setOpen(null); if (!item.disabled) item.onSelect(); }, []);

  return (
    <div ref={barRef} data-tauri-drag-region data-os={os}
      className={`material-titlebar relative z-40 shrink-0 flex items-center select-none text-[var(--color-text-main)] ${mac ? 'h-[38px] pl-[84px]' : 'h-10 pl-2'}`} role="banner">
      {!bare && <div className="flex items-center gap-0.5">
        <button type="button" className={`tip ${navBtn}`} onMouseDown={keepFocus} onClick={onBack} disabled={!canGoBack} aria-label="Back" data-tip={`Back (${tipKeys('Alt+Left', '⌥←')})`} data-tip-side="below">
          <Symbol glyph={ArrowLeft} size={16} />
        </button>
        <button type="button" className={`tip ${navBtn}`} onMouseDown={keepFocus} onClick={onForward} disabled={!canGoForward} aria-label="Forward" data-tip={`Forward (${tipKeys('Alt+Right', '⌥→')})`} data-tip-side="below">
          <Symbol glyph={ArrowRight} size={16} />
        </button>
        <button type="button" className={`tip ${navBtn} ml-1`} onMouseDown={keepFocus} onClick={onToggleLeft} aria-pressed={leftPanel}
          aria-label={leftPanel ? 'Hide left panel' : 'Show left panel'} data-tip={`${leftPanel ? 'Hide' : 'Show'} left panel (${tipKeys('Ctrl+Alt+S', '⌘⌥S')})`} data-tip-side="below">
          <Symbol glyph={PanelLeft} size={16} />
        </button>
        <button type="button" className={`tip ${navBtn}`} onMouseDown={keepFocus} onClick={onToggleRight} aria-pressed={rightPanel}
          aria-label={rightPanel ? 'Hide right panel' : 'Show right panel'} data-tip={`${rightPanel ? 'Hide' : 'Show'} right panel (${tipKeys('Ctrl+Alt+I', '⌘⌥I')})`} data-tip-side="below">
          <Symbol glyph={PanelRight} size={16} />
        </button>
      </div>}

      {!mac && !bare && <nav className="flex items-center ml-4" role="menubar" aria-label="Application menu">
        {menus.map((m, i) => (
          <div key={m.label} className="relative">
            <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={open === i}
              onMouseDown={keepFocus}
              onClick={() => setOpen((o) => (o === i ? null : i))}
              onMouseEnter={() => { if (open !== null && open !== i) setOpen(i); }}
              className={`h-7 px-2.5 rounded-[6px] text-[13px] transition-colors duration-100 focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)] ${open === i ? 'bg-[var(--pressed)] text-[var(--color-text-main)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--hover)] hover:text-[var(--color-text-main)]'}`}>
              {m.label}
            </button>
            {open === i && <Dropdown items={m.items} onSelect={select} />}
          </div>
        ))}
      </nav>}

      {/* Flexible empty space: this is what you grab to move the window. */}
      <div data-tauri-drag-region className="flex-1 self-stretch" />

      {win && os === 'windows' && (
        <div className="flex self-stretch" role="group" aria-label="Window controls">
          <WinBtn label="Minimise" onClick={() => void win.minimize()}>
            <path d="M0.5 5.5h10" />
          </WinBtn>
          <WinBtn label={maximized ? 'Restore' : 'Maximise'} onClick={() => void win.toggleMaximize()}>
            {maximized
              ? (<><rect x="0.5" y="2.5" width="8" height="8" rx="1" /><path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-1" /></>)
              : <rect x="0.5" y="0.5" width="10" height="10" rx="1" />}
          </WinBtn>
          <WinBtn label="Close" danger onClick={() => void win.close()}>
            <path d="M0.5 0.5l10 10M10.5 0.5l-10 10" />
          </WinBtn>
        </div>
      )}
    </div>
  );
};

const WinBtn: React.FC<{ label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }> = ({ label, onClick, danger, children }) => (
  <button type="button" onClick={onClick} aria-label={label} title={label}
    className={`w-[46px] inline-flex items-center justify-center text-[var(--color-text-main)] transition-colors duration-100 focus:outline-none focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] focus-visible:outline-[var(--ring)] ${danger ? 'hover:bg-[var(--titlebar-close)] hover:text-[var(--titlebar-close-fg)] active:bg-[var(--titlebar-close-pressed)] active:text-[var(--titlebar-close-fg)]' : 'hover:bg-[var(--hover)] active:bg-[var(--pressed)]'}`}>
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true" shapeRendering="geometricPrecision">
      {children}
    </svg>
  </button>
);

const Dropdown: React.FC<{ items: MenuEntry[]; onSelect: (i: MenuItem) => void }> = ({ items, onSelect }) => {
  const ref = useRef<HTMLDivElement>(null);
  const focusAt = (dir: 1 | -1) => {
    const btns = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    if (!btns.length) return;
    const idx = btns.indexOf(document.activeElement as HTMLButtonElement);
    btns[(idx + dir + btns.length) % btns.length].focus();
  };
  return (
    <div ref={ref} role="menu"
      onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); focusAt(1); } else if (e.key === 'ArrowUp') { e.preventDefault(); focusAt(-1); } }}
      className="material-frosted absolute left-0 top-full mt-1 min-w-[220px] p-1 rounded-[8px] text-[13px] z-50">
      {items.map((it, i) => it === 'separator'
        ? <div key={`s${i}`} role="separator" className="my-1 mx-2 h-px bg-[var(--sep)]" />
        : (
          <button key={it.label} type="button" role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={it.checked}
            disabled={it.disabled} onMouseDown={keepFocus} onClick={() => onSelect(it)}
            className="w-full h-7 flex items-center gap-2 pl-7 pr-2.5 rounded-[5px] text-left relative text-[var(--color-text-main)] hover:bg-[var(--color-accent-fill)] hover:text-white focus:bg-[var(--color-accent-fill)] focus:text-white focus:outline-none disabled:opacity-40 disabled:pointer-events-none group">
            {it.checked && <span aria-hidden="true" className="absolute left-2.5 text-[12px]">✓</span>}
            <span className="flex-1 truncate">{it.label}</span>
            {it.shortcut && <span className="text-[12px] text-[var(--color-text-muted)] group-hover:text-white/85 group-focus:text-white/85">{it.shortcut}</span>}
          </button>
        ))}
    </div>
  );
};
