import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { isTauri } from '../../lib/http';
import { cx } from '../common/ui';

/**
 * Full-screen image viewer (session 12). Opens over the whole window and puts the window into full
 * screen; closing it (Esc, the close button, a click on the dark area) puts the window back as it was.
 * Left / right step through the run's versions. Click the image to switch between fitting the screen
 * and actual size (scroll to pan).
 */
export interface ViewerImage { id: string; url: string; alt: string; name: string }

interface Props {
  images: ViewerImage[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}

type Win = { isFullscreen(): Promise<boolean>; setFullscreen(on: boolean): Promise<void> };

async function tauriWindow(): Promise<Win | null> {
  if (!isTauri) return null;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    return getCurrentWindow() as unknown as Win;
  } catch {
    return null;
  }
}

/** Full screen on: the window (desktop app) or the page (browser preview). Returns how to undo it. */
async function enterFullScreen(): Promise<() => void> {
  const w = await tauriWindow();
  if (w) {
    try {
      if (await w.isFullscreen()) return () => undefined; // already full screen: leave it that way
      await w.setFullscreen(true);
      return () => { void w.setFullscreen(false).catch(() => undefined); };
    } catch {
      return () => undefined; // the overlay still fills the window
    }
  }
  const el = document.documentElement;
  if (!document.fullscreenElement && el.requestFullscreen) {
    try {
      await el.requestFullscreen();
      return () => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); };
    } catch { /* blocked: the overlay still fills the window */ }
  }
  return () => undefined;
}

export const ImageViewer: React.FC<Props> = ({ images, index, onIndex, onClose }) => {
  const [actual, setActual] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const im = images[index];
  const many = images.length > 1;
  const step = useCallback((d: number) => {
    const n = index + d;
    if (n >= 0 && n < images.length) { onIndex(n); setActual(false); }
  }, [index, images.length, onIndex]);

  useEffect(() => {
    let undo: (() => void) | null = null;
    let alive = true;
    void enterFullScreen().then((u) => { if (alive) undo = u; else u(); });
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => { alive = false; undo?.(); prev?.focus?.(); };
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose, step]);

  if (!im) return null;
  const download = () => { const a = document.createElement('a'); a.href = im.url; a.download = im.name; a.click(); };
  const ctl = 'w-9 h-9 inline-flex items-center justify-center rounded-[8px] text-white/90 hover:bg-white/15 hover:text-white disabled:opacity-35 disabled:pointer-events-none focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)]';

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Image, full screen" className="fixed inset-0 z-[200] bg-black text-white select-none">
      <div className={cx('absolute inset-0', actual ? 'overflow-auto' : 'flex items-center justify-center p-6')}
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <img src={im.url} alt={im.alt} draggable={false}
          onClick={() => setActual((a) => !a)}
          className={cx(actual ? 'max-w-none m-auto block cursor-zoom-out' : 'max-w-full max-h-full object-contain cursor-zoom-in')} />
      </div>

      <div className="absolute top-3 right-3 flex items-center gap-1 p-1 rounded-[12px] bg-black/55" role="toolbar" aria-label="Viewer">
        <button type="button" className={cx('tip', ctl)} data-tip="Download" data-tip-side="below" aria-label="Download" onClick={download}><Download className="w-4 h-4" /></button>
        <button ref={closeRef} type="button" className={cx('tip', ctl)} data-tip="Close (Esc)" data-tip-side="below" aria-label="Close full screen" onClick={onClose}><X className="w-4 h-4" /></button>
      </div>

      {many && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 px-1 h-10 rounded-[12px] bg-black/55 text-[12px] tabular-nums">
          <button type="button" className={ctl} aria-label="Previous version" disabled={index === 0} onClick={() => step(-1)}><ChevronLeft className="w-4 h-4" /></button>
          <span className="px-1 text-white/90">{index + 1} / {images.length}</span>
          <button type="button" className={ctl} aria-label="Next version" disabled={index === images.length - 1} onClick={() => step(1)}><ChevronRight className="w-4 h-4" /></button>
        </div>
      )}
    </div>,
    document.body,
  );
};
