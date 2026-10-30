// Downloading image checkpoints and LoRAs into ComfyUI's models folder.
// Ollama and Voicebox download their own models; ComfyUI cannot, so the desktop shell does it
// (src-tauri/src/downloads.rs). Only ever started by a button press, only over https.

import { invokeNative, onEvent } from '../lib/bus';
import { isTauri } from '../lib/http';
import { uid } from '../lib/persist';
import { savedExe } from './engineControl';

export type ModelFolder = 'checkpoints' | 'loras';

export interface DownloadProgress {
  id: string;
  received: number;
  total: number | null;
  done: boolean;
  error: string | null;
  path: string | null;
}

export const MODEL_EXTENSIONS = ['safetensors', 'ckpt', 'pt', 'pth', 'bin', 'gguf', 'sft', 'onnx'];

const DIR_KEY = 'lotus.comfy.modelsDir.v1';
export const savedModelsDir = () => localStorage.getItem(DIR_KEY) || '';
export const setSavedModelsDir = (p: string) => localStorage.setItem(DIR_KEY, p);

const sep = (dir: string) => (dir.includes('\\') ? '\\' : '/');
export const folderPath = (modelsDir: string, kind: ModelFolder) => `${modelsDir.replace(/[\\/]+$/, '')}${sep(modelsDir)}${kind}`;

/** The folder ComfyUI loads models from: the one the user chose, else found from the launcher they located. */
export async function findModelsDir(): Promise<string> {
  const saved = savedModelsDir();
  if (saved) return saved;
  const launcher = savedExe('comfyui');
  if (!launcher || !isTauri) return '';
  const found = await invokeNative<string | null>('comfy_models_dir', { launcher });
  if (found) setSavedModelsDir(found);
  return found ?? '';
}

/** Lets the user point at ComfyUI's `models` folder. */
export async function browseModelsDir(): Promise<string | null> {
  if (!isTauri) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({ title: "Choose ComfyUI's models folder", directory: true, multiple: false });
  if (typeof picked === 'string') { setSavedModelsDir(picked); return picked; }
  return null;
}

export const listModelFiles = async (dir: string) => (await invokeNative<string[]>('list_model_files', { dir })) ?? [];

export type Normalised = { url: string; fileName: string; host: string } | { error: string };

/**
 * Turns what people paste into a direct file link.
 * Hugging Face "blob" page links become "resolve" (the file itself); a Civitai model page with a
 * version id becomes its API download link. Anything else must already be a direct https link.
 */
export function normaliseLink(input: string): Normalised {
  let raw = input.trim();
  if (!raw) return { error: 'Paste a link to the model file.' };
  if (/^(hf\.co|huggingface\.co|civitai\.com)\//i.test(raw)) raw = `https://${raw}`;
  let u: URL;
  try { u = new URL(raw); } catch { return { error: 'That is not a valid link.' }; }
  if (u.protocol !== 'https:') return { error: 'Only https:// links can be downloaded.' };
  const host = u.hostname.replace(/^www\./, '');

  if (host === 'huggingface.co' || host === 'hf.co') {
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 5 || (parts[2] !== 'blob' && parts[2] !== 'resolve')) {
      return { error: 'That is a repository page. Open the file in its "Files" tab and paste the file\'s link (it ends in .safetensors).' };
    }
    parts[2] = 'resolve';
    const url = `https://huggingface.co/${parts.join('/')}`;
    return { url, fileName: nameFromPath(parts[parts.length - 1]), host: 'huggingface.co' };
  }

  if (host === 'civitai.com') {
    const dl = /^\/api\/download\/models\/(\d+)/.exec(u.pathname);
    if (dl) return { url: `https://civitai.com/api/download/models/${dl[1]}`, fileName: '', host };
    const ver = u.searchParams.get('modelVersionId');
    if (/^\/models\/\d+/.test(u.pathname) && ver && /^\d+$/.test(ver)) return { url: `https://civitai.com/api/download/models/${ver}`, fileName: '', host };
    return { error: 'Use the model page link that includes "?modelVersionId=…", or the Download button\'s link.' };
  }

  return { url: u.toString(), fileName: nameFromPath(u.pathname.split('/').filter(Boolean).pop() ?? ''), host };
}

function nameFromPath(seg: string): string {
  let n = seg;
  try { n = decodeURIComponent(seg); } catch { /* keep as is */ }
  const ext = n.split('.').pop()?.toLowerCase() ?? '';
  return MODEL_EXTENSIONS.includes(ext) ? n : '';
}

export const validFileName = (n: string) =>
  /^[^\\/:*?"<>|]{1,200}$/.test(n) && !n.includes('..') && MODEL_EXTENSIONS.includes(n.split('.').pop()?.toLowerCase() ?? '');

export interface DownloadHandle { id: string; promise: Promise<string>; cancel: () => void }

/** Starts one file download. `promise` resolves with the saved path, or rejects with a message that says what went wrong. */
export function downloadModel(o: { url: string; destDir: string; fileName: string; token?: string; onProgress: (p: DownloadProgress) => void }): DownloadHandle {
  const id = uid('dl');
  let off: (() => void) | null = null;
  const promise = (async () => {
    if (!isTauri) throw new Error('Downloading model files needs the Lotus desktop app.');
    off = await onEvent<DownloadProgress>('download:progress', (p) => { if (p.id === id) o.onProgress(p); });
    try {
      const path = await invokeNative<string>('download_start', { id, url: o.url, destDir: o.destDir, fileName: o.fileName, token: o.token || null });
      return path ?? '';
    } catch (e) {
      throw new Error(typeof e === 'string' ? e : (e as Error).message);
    } finally { off?.(); }
  })();
  return { id, promise, cancel: () => void invokeNative('download_cancel', { id }) };
}
