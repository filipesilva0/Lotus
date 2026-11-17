// Which pasted or dragged things are files, and what kind (0.9.5). Pure: no DOM globals, so the core's
// tests can run it (the hook that listens on the window is in fileDrop.ts).

/** The parts of a DataTransfer this file reads. */
export interface ClipboardLike {
  files?: ArrayLike<File> | null;
  items?: ArrayLike<{ kind: string; getAsFile(): File | null }> | null;
  types?: ArrayLike<string> | null;
}

/** Kinds of clipboard/drag data that carry files or images. */
const FILE_TYPES = ['Files', 'application/x-moz-file'];

/** Whether a drag carries files (from the desktop) or an image dragged inside Lotus. */
export function dragHasFiles(types: ArrayLike<string> | null | undefined): boolean {
  if (!types) return false;
  const list = Array.from(types);
  return list.some((t) => FILE_TYPES.includes(t)) || list.includes('text/uri-list');
}

/** Clipboard images are all called "image.png": give each a distinct name so they can be told apart. */
export function nameFiles(files: File[], now = new Date()): File[] {
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}.${String(now.getMinutes()).padStart(2, '0')}.${String(now.getSeconds()).padStart(2, '0')}`;
  let n = 0;
  return files.map((f) => {
    if (f.name && !/^image\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name)) return f;
    const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/[^\w]/g, '');
    n++;
    return new File([f], `Pasted image ${stamp}${files.length > 1 ? ` (${n})` : ''}.${ext}`, { type: f.type || 'image/png', lastModified: f.lastModified });
  });
}

/**
 * Files on the clipboard, or [] when the paste is text. Copying cells from a spreadsheet or text from
 * a web page also puts a picture of it on the clipboard (as "image.png"); then the text is what was
 * meant. Files copied in Explorer/Finder keep their names and always count as files.
 */
export function clipboardFiles(data: ClipboardLike | null | undefined): File[] {
  if (!data) return [];
  let files = Array.from(data.files ?? []);
  if (!files.length) files = Array.from(data.items ?? []).filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter((f): f is File => !!f);
  if (!files.length) return [];
  const hasText = Array.from(data.types ?? []).includes('text/plain');
  if (hasText && files.every((f) => /^image\.\w+$/i.test(f.name))) return [];
  return nameFiles(files);
}

/** Split files into images, audio/video and the rest. */
export function sortFiles(files: File[]) {
  const images: File[] = [], media: File[] = [], other: File[] = [];
  for (const f of files) (f.type.startsWith('image/') ? images : f.type.startsWith('audio/') || f.type.startsWith('video/') || /\.(wav|mp3|m4a|ogg|oga|flac|aac|opus|webm|mp4|mov|mkv)$/i.test(f.name) ? media : other).push(f);
  return { images, media, other };
}


/** Text and code files Lotus reads as text (more document kinds: lib/docParse.ts). */
export const TEXT_EXT = /\.(txt|md|markdown|json|csv|tsv|log|ya?ml|toml|ini|xml|html?|css|scss|js|jsx|ts|tsx|py|rs|go|java|c|h|cpp|hpp|cs|rb|php|sh|ps1|bat|sql|tex)$/i;
