// Images from Lotus's own engine (stable-diffusion.cpp in the core, session 17). The core runs sd-cli
// with every file of the chosen image setup and saves the results in Lotus Studio/Images; this file
// asks for a run and loads the images back for the Images page.

import { loadMedia, onCoreEvent, rpc, type SavedMedia } from '../lib/core';
import { fileToBase64 } from './ollamaService';
import type { ImageProfile, LoraUse } from '../models/imageProfiles';
import type { ComfyBatch } from './comfyService';

export interface BuiltinImageInput {
  prompt: string; negative?: string; width: number; height: number; seed?: number; count?: number;
  steps: number; cfg: number; sampler?: string; scheduler?: string; loras?: LoraUse[];
  /** Image to image: a reference image and how much of it to keep (0.65 = change a fair bit). */
  reference?: Blob | string; strength?: number;
  /** More reference images (FLUX.2 uses them all; other models start from the first). */
  references?: (Blob | string)[];
  /** The generation's folder under Images/ (0.9.5); the core makes one when it is missing. */
  dir?: string;
}

export type BuiltinBatch = ComfyBatch & { items: { blob: Blob; url: string; file: string }[]; dir?: string };

export async function builtinGenerate(profile: ImageProfile, i: BuiltinImageInput, o: { signal: AbortSignal; onStep?: (step: number, total: number) => void }): Promise<BuiltinBatch> {
  const genId = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const off = onCoreEvent((e) => { if (e.type === 'builtin-image' && e.genId === genId) o.onStep?.(e.step, e.total); });
  const onAbort = () => void rpc('image_cancel', { genId }).catch(() => undefined);
  o.signal.addEventListener('abort', onAbort, { once: true });
  try {
    // References go to the core with the request; it saves them in the generation's folder as
    // "Reference 1", "Reference 2", … next to "Output 1", "Output 2", ….
    const refs = await Promise.all([...(i.reference ? [i.reference] : []), ...(i.references ?? [])].slice(0, 8)
      .map(async (r) => (typeof r === 'string' ? r : { data: await fileToBase64(r), mime: r.type || 'image/png' })));
    const r = await rpc<{ images: SavedMedia[]; seed: number; sec: number; dir: string }>('image_builtin', {
      genId, profile, prompt: i.prompt, negative: i.negative, width: i.width, height: i.height, seed: i.seed ?? null, count: i.count ?? 1,
      steps: i.steps, cfg: i.cfg, sampler: i.sampler, scheduler: i.scheduler, loras: i.loras ?? [], refs, strength: i.strength, dir: i.dir,
    });
    const items = await Promise.all(r.images.map(async (m) => { const blob = await loadMedia(m.path); return { blob, url: URL.createObjectURL(blob), file: m.path }; }));
    return { items, seed: r.seed, promptId: genId, generationTimeSec: r.sec, dir: r.dir };
  } catch (e) {
    if (o.signal.aborted) throw new DOMException('Stopped', 'AbortError');
    throw e;
  } finally {
    off();
    o.signal.removeEventListener('abort', onAbort);
  }
}
