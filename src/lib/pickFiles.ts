// The "+" attach button in the desktop app: the file dialog belongs to the Lotus window (pick.rs), so
// it opens over Lotus, gives focus back when it closes, and doesn't leave Lotus behind other windows.
// In a browser preview, the page's own file input is used instead.

import { invokeNative } from './bus';
import { isTauri } from './http';

interface Picked { name: string; data: string; size: number; too_large: boolean }

/** A picked file as the browser's File type, so the page treats it like a dropped file. */
export function pickedToFile(p: { name: string; data: string }): File {
  const bin = atob(p.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], p.name, { type: mimeOf(p.name) });
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', html: 'text/html',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4',
};
export const mimeOf = (name: string) => MIME[(name.split('.').pop() ?? '').toLowerCase()] ?? '';

/**
 * Opens the desktop file dialog. Returns the files picked (empty when cancelled) and the names of
 * any too large to attach, or null outside the desktop app (use the page's file input then).
 */
export async function pickFiles(o: { title?: string; imagesOnly?: boolean } = {}): Promise<{ files: File[]; tooLarge: string[] } | null> {
  if (!isTauri) return null;
  const list = await invokeNative<Picked[]>('pick_files', { title: o.title ?? null, imagesOnly: !!o.imagesOnly });
  if (!list) return null;
  return { files: list.filter((p) => !p.too_large).map(pickedToFile), tooLarge: list.filter((p) => p.too_large).map((p) => p.name) };
}

/**
 * The "+" button: the desktop dialog, or `fallback` (the page's file input) in a browser or when the
 * dialog can't open. Files go to `onFiles`; `onNotice` hears about files too large to attach.
 */
export async function attachWithDialog(onFiles: (f: File[]) => void, fallback: () => void, onNotice?: (text: string) => void, o: { imagesOnly?: boolean } = {}): Promise<void> {
  let r: Awaited<ReturnType<typeof pickFiles>> = null;
  try { r = await pickFiles(o); } catch { r = null; }
  if (!r) { fallback(); return; }
  if (r.files.length) onFiles(r.files);
  if (r.tooLarge.length) onNotice?.(`${r.tooLarge.join(', ')} ${r.tooLarge.length === 1 ? 'is' : 'are'} too large to attach (over 64 MB).`);
}
