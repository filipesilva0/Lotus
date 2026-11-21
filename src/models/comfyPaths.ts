// Paths inside ComfyUI's `models` folder. Free of the browser and the desktop shell so the core's
// tests can check them.

export type ComfySubfolder = 'checkpoints' | 'loras' | 'diffusion_models' | 'text_encoders' | 'vae';

/** ComfyUI's subfolders of `models` that people pick by mistake when asked for the models folder. */
const MODEL_SUBFOLDERS = ['checkpoints', 'loras', 'diffusion_models', 'text_encoders', 'vae', 'unet', 'clip', 'embeddings', 'upscale_models', 'controlnet'];

/**
 * ComfyUI's `models` folder from what was picked or saved. Picking `models\checkpoints` instead of
 * `models` made Storage (and downloads) use `models\checkpoints\checkpoints` and
 * `models\checkpoints\loras`; a known subfolder at the end is dropped.
 */
export function modelsRoot(dir: string): string {
  const trimmed = String(dir ?? '').trim().replace(/[\\/]+$/, '');
  const m = /^(.*?)[\\/]([^\\/]+)$/.exec(trimmed);
  return m && MODEL_SUBFOLDERS.includes(m[2].toLowerCase()) && m[1] && !/^[A-Za-z]:$/.test(m[1]) ? m[1] : trimmed;
}

const sep = (dir: string) => (dir.includes('\\') ? '\\' : '/');

/** A subfolder of ComfyUI's models folder (also when the saved folder is one of its subfolders). */
export const folderPath = (modelsDir: string, kind: ComfySubfolder) => { const root = modelsRoot(modelsDir); return `${root}${sep(root)}${kind}`; };
