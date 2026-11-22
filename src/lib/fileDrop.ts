// Paste (Ctrl/Cmd+V) and drag-and-drop of files and images onto a page (0.9.5).
//
// Every page that takes files (Chat, Work, Images, Voice, the island) uses `useFileIntake`: files
// dropped anywhere on the page, or pasted while the page is open, go to the page's `onFiles`, as many
// as were dropped or pasted. Only the open page is mounted, so one page listens at a time.
//
// In the desktop app this needs `dragDropEnabled: false` on the window (tauri.conf.json): otherwise
// Tauri takes file drops itself and the page never sees them (Windows/WebView2).

import { useEffect, useRef, useState } from 'react';
import { clipboardFiles, dragHasFiles, nameFiles } from './fileKinds';

export { clipboardFiles, dragHasFiles, nameFiles, sortFiles } from './fileKinds';

/** Images dragged from inside Lotus (gallery, chat) arrive as a blob:/data: address, not a file. */
async function droppedLinks(dt: DataTransfer): Promise<File[]> {
  const raw = dt.getData('text/uri-list') || '';
  const urls = raw.split(/\r?\n/).map((u) => u.trim()).filter((u) => u && !u.startsWith('#') && /^(blob:|data:image\/)/.test(u));
  const out: File[] = [];
  for (const u of urls.slice(0, 20)) {
    try { const b = await (await fetch(u)).blob(); if (b.size) out.push(new File([b], 'image.png', { type: b.type || 'image/png' })); } catch { /* gone */ }
  }
  return nameFiles(out);
}

const intakes: ((f: File[]) => void)[] = [];
let pendingHandoff: File[] | null = null;
/**
 * Hands files to the page that is open (the newest `useFileIntake`), as if they had been dropped on it.
 * Called right after switching page, so a page that mounts within a moment gets them instead.
 */
export function handFiles(files: File[]): void {
  if (!files.length) return;
  pendingHandoff = files;
  setTimeout(() => {
    if (!pendingHandoff) return;
    const take = intakes[intakes.length - 1];
    if (take) { pendingHandoff = null; take(files); }
  }, 400);
}

/** Every file in a drop (all of them, not just the first). */
export async function droppedFiles(dt: DataTransfer | null): Promise<File[]> {
  if (!dt) return [];
  const files = Array.from(dt.files ?? []);
  return files.length ? files : droppedLinks(dt);
}

/**
 * Drop anywhere on the page and paste while it is open. Returns whether files are being dragged over
 * the window (to highlight the drop target). `enabled: false` turns both off (a dialog is open, the
 * page can't take files right now).
 */
export function useFileIntake(onFiles: (files: File[]) => void, o: { enabled?: boolean; paste?: boolean } = {}): boolean {
  const [dragging, setDragging] = useState(false);
  const cb = useRef(onFiles);
  cb.current = onFiles;
  const enabled = o.enabled ?? true;
  const paste = o.paste ?? true;

  // 0.23: the open page also takes files sent from the island's shelf ("Use in Video").
  useEffect(() => {
    if (!enabled) return;
    const take = (f: File[]) => cb.current(f);
    intakes.push(take);
    if (pendingHandoff) { const f = pendingHandoff; pendingHandoff = null; setTimeout(() => take(f), 0); }
    return () => { const i = intakes.lastIndexOf(take); if (i >= 0) intakes.splice(i, 1); };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) { setDragging(false); return; }
    let depth = 0;
    const enter = (e: DragEvent) => { if (!dragHasFiles(e.dataTransfer?.types)) return; depth++; setDragging(true); };
    const over = (e: DragEvent) => { if (!dragHasFiles(e.dataTransfer?.types)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; };
    const leave = (e: DragEvent) => { if (!dragHasFiles(e.dataTransfer?.types)) return; depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const drop = (e: DragEvent) => {
      if (!dragHasFiles(e.dataTransfer?.types)) return;
      // A drop target inside the page that handles files itself (it called preventDefault) wins.
      depth = 0; setDragging(false);
      if (e.defaultPrevented) return;
      e.preventDefault();
      const dt = e.dataTransfer;
      void droppedFiles(dt).then((f) => { if (f.length) cb.current(f); });
    };
    const onPaste = (e: ClipboardEvent) => {
      if (!paste) return;
      const f = clipboardFiles(e.clipboardData);
      if (!f.length) return;
      e.preventDefault();
      cb.current(f);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
      window.removeEventListener('paste', onPaste);
    };
  }, [enabled, paste]);
  return dragging;
}
