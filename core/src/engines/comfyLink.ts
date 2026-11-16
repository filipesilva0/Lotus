// Session 17: ComfyUI reads the image models in Lotus Studio/Models/image, so every model lives in one
// place. ComfyUI loads `extra_model_paths.yaml` from its own folder at start; Lotus adds (or updates)
// one section named `lotus_studio` there and leaves anything else in the file alone.
// ComfyUI Desktop keeps the same kind of file as `extra_models_config.yaml` in its settings folder.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SECTION = 'lotus_studio';

export function lotusSection(imageDir: string): string {
  const base = imageDir.replace(/\\/g, '/');
  return [
    `${SECTION}:`,
    `    base_path: "${base.replace(/"/g, '\\"')}"`,
    '    checkpoints: checkpoints',
    '    diffusion_models: diffusion_models',
    '    unet: diffusion_models',
    '    text_encoders: text_encoders',
    '    clip: text_encoders',
    '    vae: vae',
    '    loras: loras',
    '',
  ].join('\n');
}

/** The file's text with Lotus's section added or replaced (other sections kept as they were). */
export function mergeSection(existing: string, imageDir: string): string {
  const lines = existing.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let skipping = false;
  for (const l of lines) {
    if (new RegExp(`^${SECTION}:\\s*$`).test(l)) { skipping = true; continue; }
    if (skipping && /^\S/.test(l)) skipping = false;
    if (!skipping) out.push(l);
  }
  const kept = out.join('\n').replace(/\n+$/, '');
  return `${kept ? `${kept}\n\n` : ''}${lotusSection(imageDir)}`;
}

/** Writes the section into each config file that applies. Returns the files written. */
export function linkComfy(imageDir: string, o: { root?: string; desktopConfigDir?: string }): string[] {
  const written: string[] = [];
  const write = (file: string) => {
    const before = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const after = mergeSection(before, imageDir);
    if (after !== before) writeFileSync(file, after);
    written.push(file);
  };
  if (o.root && existsSync(o.root)) write(join(o.root, 'extra_model_paths.yaml'));
  if (o.desktopConfigDir && existsSync(o.desktopConfigDir)) write(join(o.desktopConfigDir, 'extra_models_config.yaml'));
  return written;
}

/** ComfyUI Desktop's settings folder on this OS (where it looks for extra_models_config.yaml). */
export function comfyDesktopConfigDir(): string | undefined {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  if (process.platform === 'win32') return process.env.APPDATA ? join(process.env.APPDATA, 'ComfyUI') : undefined;
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'ComfyUI');
  return join(home, '.config', 'ComfyUI');
}
