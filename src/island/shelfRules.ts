// What the island can do with a file on the shelf (0.23, idea 2). Shared by the island and the core.

export type ShelfTarget = 'mp4' | 'gif' | 'mp3' | 'wav';
export type UsePage = 'work' | 'images' | 'video' | 'voice';

const ext = (name: string) => (/\.[a-z0-9]{1,5}$/i.exec(name)?.[0] ?? '').toLowerCase();
const VIDEO = new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v', '.gif']);
const AUDIO = new Set(['.wav', '.mp3', '.m4a', '.ogg', '.flac', '.opus', '.aac']);
const PICTURE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp']);
const DOC = new Set(['.pdf', '.docx', '.xlsx', '.pptx', '.txt', '.md', '.csv', '.json', '.html', '.rtf', '.odt']);

export const isVideo = (n: string) => VIDEO.has(ext(n));
export const isAudio = (n: string) => AUDIO.has(ext(n));
export const isPicture = (n: string) => PICTURE.has(ext(n));
export const isDoc = (n: string) => DOC.has(ext(n));

/** Which conversions make sense for a file, by its extension. */
export function shelfTargets(name: string): ShelfTarget[] {
  const e = ext(name);
  if (VIDEO.has(e)) return e === '.gif' ? ['mp4'] : [...(e === '.mp4' ? [] : ['mp4' as const]), 'gif', 'mp3'];
  if (AUDIO.has(e)) return [...(e === '.mp3' ? [] : ['mp3' as const]), ...(e === '.wav' ? [] : ['wav' as const])];
  return [];
}

/** Speech in it can be written down (Whisper). */
export const canTranscribe = (name: string) => (isAudio(name) || (isVideo(name) && ext(name) !== '.gif'));

/** Lotus can read it in the quick chat (pictures, PDFs, Office and text files). */
export const canAsk = (name: string) => isPicture(name) || isDoc(name);

/** What "Ask Lotus" says first, by kind of file. */
export function askPrompt(name: string): string {
  const e = ext(name);
  if (isPicture(name)) return 'Describe this picture.';
  if (e === '.xlsx' || e === '.csv') return 'Explain what this spreadsheet shows, in a few bullet points.';
  return 'Summarise this file in a few bullet points.';
}

/** Pages a file can be sent to. */
export function usePages(name: string): UsePage[] {
  if (isPicture(name)) return ['images', 'video', 'work'];
  if (isVideo(name)) return ['video', 'work'];
  if (isAudio(name)) return ['voice', 'video', 'work'];
  return ['work'];
}
