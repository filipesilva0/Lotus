// Image model setups (session 17): an image model is often more than one file. A classic SD 1.5/SDXL
// checkpoint holds everything but can take a better VAE; newer models are split into a diffusion
// model, one or more text encoders and a VAE that must match. A setup ("profile") ties a main model
// file to the exact files it needs, plus the settings it works best with, so the Images page, the
// image.generate tool, ComfyUI and the built-in engine (stable-diffusion.cpp) all use the same set.
//
// Pure (no DOM, no storage): shared with the core and tested in handover/verification/s17-tests.ts.

export type ImageFamily = 'sd15' | 'sdxl' | 'sd35' | 'flux1' | 'flux2' | 'zimage' | 'qwen-image';
export type Slot = 'model' | 'vae' | 'clip_l' | 'clip_g' | 't5xxl' | 'llm';
/** The model folders, named like ComfyUI's, under Lotus Studio/Models/image. */
export type ImageFolder = 'checkpoints' | 'diffusion_models' | 'text_encoders' | 'vae' | 'loras';

export interface SlotSpec { slot: Slot; label: string; folder: ImageFolder; required: boolean; hint: string }

export interface FamilySpec {
  id: ImageFamily;
  label: string;
  /** Where the main file lives. */
  mainFolder: ImageFolder;
  /** The other files, in the order the editor shows them. */
  slots: SlotSpec[];
  steps: number; cfg: number; sampler: string; scheduler: string; base: number;
  /** ModelSamplingAuraFlow / flow shift; undefined = not used. */
  shift?: number;
  /** Distilled models ignore the negative prompt (zeroed conditioning). */
  negative: 'zero' | 'text';
  /** ComfyUI CLIPLoader type for single-encoder split models. */
  clipType?: string;
  /** Fixed sampler settings (distilled models break with other values). */
  locked: boolean;
}

const VAE_OPT: SlotSpec = { slot: 'vae', label: 'VAE', folder: 'vae', required: false, hint: 'Optional. A separate VAE often gives cleaner colours than the one inside the checkpoint.' };
const VAE_REQ = (hint: string): SlotSpec => ({ slot: 'vae', label: 'VAE', folder: 'vae', required: true, hint });
const LLM = (hint: string): SlotSpec => ({ slot: 'llm', label: 'Text encoder', folder: 'text_encoders', required: true, hint });

export const FAMILIES: Record<ImageFamily, FamilySpec> = {
  sd15: { id: 'sd15', label: 'Stable Diffusion 1.5', mainFolder: 'checkpoints', slots: [VAE_OPT], steps: 25, cfg: 7, sampler: 'euler_ancestral', scheduler: 'normal', base: 512, negative: 'text', locked: false },
  sdxl: { id: 'sdxl', label: 'Stable Diffusion XL', mainFolder: 'checkpoints', slots: [VAE_OPT], steps: 30, cfg: 6, sampler: 'dpmpp_2m', scheduler: 'karras', base: 1024, negative: 'text', locked: false },
  sd35: {
    id: 'sd35', label: 'Stable Diffusion 3.5', mainFolder: 'checkpoints', steps: 28, cfg: 4.5, sampler: 'euler', scheduler: 'sgm_uniform', base: 1024, negative: 'text', locked: false,
    slots: [
      { slot: 'clip_l', label: 'CLIP-L', folder: 'text_encoders', required: true, hint: 'clip_l.safetensors' },
      { slot: 'clip_g', label: 'CLIP-G', folder: 'text_encoders', required: true, hint: 'clip_g.safetensors' },
      { slot: 't5xxl', label: 'T5-XXL', folder: 'text_encoders', required: true, hint: 't5xxl_fp16 or t5xxl_fp8' },
      VAE_OPT,
    ],
  },
  flux1: {
    id: 'flux1', label: 'FLUX.1', mainFolder: 'diffusion_models', steps: 20, cfg: 1, sampler: 'euler', scheduler: 'simple', base: 1024, negative: 'zero', locked: false,
    slots: [
      { slot: 'clip_l', label: 'CLIP-L', folder: 'text_encoders', required: true, hint: 'clip_l.safetensors' },
      { slot: 't5xxl', label: 'T5-XXL', folder: 'text_encoders', required: true, hint: 't5xxl_fp8_e4m3fn or t5xxl_fp16' },
      VAE_REQ('ae.safetensors (the FLUX.1 VAE)'),
    ],
  },
  flux2: {
    id: 'flux2', label: 'FLUX.2 Klein', mainFolder: 'diffusion_models', steps: 4, cfg: 1, sampler: 'euler', scheduler: 'simple', base: 1024, negative: 'zero', clipType: 'flux2', locked: true,
    slots: [LLM('qwen_3_4b (Qwen3 4B)'), VAE_REQ('flux2-vae.safetensors')],
  },
  zimage: {
    id: 'zimage', label: 'Z-Image', mainFolder: 'diffusion_models', steps: 8, cfg: 1, sampler: 'res_multistep', scheduler: 'simple', base: 1024, shift: 3, negative: 'zero', clipType: 'lumina2', locked: true,
    slots: [LLM('qwen_3_4b (Qwen3 4B)'), VAE_REQ('ae.safetensors')],
  },
  'qwen-image': {
    id: 'qwen-image', label: 'Qwen-Image', mainFolder: 'diffusion_models', steps: 20, cfg: 2.5, sampler: 'euler', scheduler: 'simple', base: 1328, shift: 3.1, negative: 'text', clipType: 'qwen_image', locked: false,
    slots: [LLM('qwen_2.5_vl_7b (Qwen2.5-VL 7B)'), VAE_REQ('qwen_image_vae.safetensors')],
  },
};

export const FAMILY_ORDER: ImageFamily[] = ['sdxl', 'sd15', 'flux1', 'flux2', 'zimage', 'qwen-image', 'sd35'];

export interface LoraUse { name: string; strength: number }

export interface ImageProfile {
  id: string;
  /** What the user sees in the model menu. */
  name: string;
  family: ImageFamily;
  /** File names, each in its slot's folder ('model' in the family's main folder). */
  files: Partial<Record<Slot, string>>;
  steps?: number; cfg?: number; sampler?: string; scheduler?: string;
  /** From the catalog (Lotus keeps it in step with the catalog; the user can still copy it). */
  catalogId?: string;
  /** LoRAs always applied with this model. */
  loras?: LoraUse[];
}

export const slotFolder = (family: ImageFamily, slot: Slot): ImageFolder =>
  slot === 'model' ? FAMILIES[family].mainFolder : (FAMILIES[family].slots.find((s) => s.slot === slot)?.folder ?? 'text_encoders');

/** The slots a profile still needs filled (or whose file is not on disk), in order. */
export function missingFor(p: ImageProfile, have?: (folder: ImageFolder, file: string) => boolean): Slot[] {
  const spec = FAMILIES[p.family];
  const out: Slot[] = [];
  const check = (slot: Slot, required: boolean) => {
    const f = p.files[slot];
    if (!f) { if (required) out.push(slot); return; }
    if (have && !have(slotFolder(p.family, slot), f)) out.push(slot);
  };
  check('model', true);
  for (const s of spec.slots) check(s.slot, s.required);
  return out;
}

export const isReady = (p: ImageProfile, have?: (folder: ImageFolder, file: string) => boolean) => missingFor(p, have).length === 0;

/** Settings a run should use: the profile's own, else the family's. */
export function settingsFor(p: ImageProfile) {
  const f = FAMILIES[p.family];
  return {
    steps: f.locked ? f.steps : (p.steps ?? f.steps),
    cfg: f.locked ? f.cfg : (p.cfg ?? f.cfg),
    sampler: f.locked ? f.sampler : (p.sampler ?? f.sampler),
    scheduler: f.locked ? f.scheduler : (p.scheduler ?? f.scheduler),
    base: f.base, shift: f.shift, negative: f.negative, locked: f.locked,
  };
}

/** A first guess at a model's family from its file name (the user can change it in the editor). */
export function guessFamily(fileName: string, folder?: ImageFolder): ImageFamily {
  const n = fileName.toLowerCase();
  if (/qwen[_-]?image/.test(n)) return 'qwen-image';
  if (/z[_-]?image/.test(n)) return 'zimage';
  if (/flux[_.-]?2|klein/.test(n)) return 'flux2';
  if (/flux|schnell|krea/.test(n)) return 'flux1';
  if (/sd3|sd_3|stable[_-]?diffusion[_-]?3/.test(n)) return 'sd35';
  if (/xl|pony|illustrious|noob|juggernaut|dreamshaper[_-]?xl/.test(n)) return 'sdxl';
  if (/v1[-_.]?5|sd[_-]?1\.?5|sd15|realistic[_-]?vision|deliberate|anything[_-]?v/.test(n)) return 'sd15';
  return folder === 'diffusion_models' ? 'flux1' : 'sdxl';
}

/** Picks the best matching file for a slot from what is installed (e.g. the FLUX.1 VAE for a FLUX.1 model). */
export function suggestFile(family: ImageFamily, slot: Slot, files: string[]): string | undefined {
  const pats: Partial<Record<ImageFamily, Partial<Record<Slot, RegExp[]>>>> = {
    sd15: { vae: [/vae[-_]?ft[-_]?mse|sd[-_]?vae|840000/i] },
    sdxl: { vae: [/sdxl[-_.]?vae|xl[-_.]?vae/i] },
    sd35: { clip_l: [/clip[_-]?l/i], clip_g: [/clip[_-]?g/i], t5xxl: [/t5/i] },
    flux1: { clip_l: [/clip[_-]?l/i], t5xxl: [/t5/i], vae: [/^ae\.(safetensors|sft)$/i, /flux[-_]?(1[-_]?)?vae/i] },
    flux2: { llm: [/qwen[_-]?3[_-]?4b/i], vae: [/flux2/i] },
    zimage: { llm: [/qwen[_-]?3[_-]?4b/i], vae: [/^ae\.(safetensors|sft)$/i, /flux[-_]?(1[-_]?)?vae/i] },
    'qwen-image': { llm: [/qwen[_-]?2\.?5[_-]?vl/i], vae: [/qwen[_-]?image[_-]?vae/i] },
  };
  for (const re of pats[family]?.[slot] ?? []) { const hit = files.find((f) => re.test(f)); if (hit) return hit; }
  return undefined;
}

/** Aspect ratio → pixel size for a profile (multiples of 64, area of the model's native square). */
export function sizeFor(aspect: string, p: ImageProfile): { width: number; height: number } {
  const r64 = (n: number) => Math.max(64, Math.round(n / 64) * 64);
  const custom = /^(\d{2,5})\s*[x×]\s*(\d{2,5})$/.exec(aspect);
  if (custom) return { width: r64(+custom[1]), height: r64(+custom[2]) };
  const [a, b] = aspect.split(':').map(Number);
  const ratio = a > 0 && b > 0 ? a / b : 1;
  const area = FAMILIES[p.family].base ** 2;
  return { width: r64(Math.sqrt(area * ratio)), height: r64(Math.sqrt(area / ratio)) };
}

// ── ComfyUI ────────────────────────────────────────────────────────────────

/** How services/comfyGraph.ts wires a profile's loaders. */
export interface ComfyWiring {
  /** CheckpointLoaderSimple (one file) or UNETLoader + text encoder loader. */
  loader: 'checkpoint' | 'unet';
  model: string;
  vae?: string;
  clip?: { node: 'CLIPLoader'; name: string; type: string } | { node: 'DualCLIPLoader'; a: string; b: string; type: string } | { node: 'TripleCLIPLoader'; a: string; b: string; c: string };
  kind: 'ksampler' | 'flux2';
  latent: 'sd' | 'sd3' | 'flux2';
  shift?: number;
  negative: 'zero' | 'text';
}

export function comfyWiring(p: ImageProfile): ComfyWiring {
  const f = FAMILIES[p.family];
  const files = p.files;
  const model = files.model ?? '';
  if (p.family === 'sd15' || p.family === 'sdxl') return { loader: 'checkpoint', model, vae: files.vae, kind: 'ksampler', latent: 'sd', negative: 'text' };
  if (p.family === 'sd35') {
    return { loader: 'checkpoint', model, vae: files.vae, clip: { node: 'TripleCLIPLoader', a: files.clip_l ?? '', b: files.clip_g ?? '', c: files.t5xxl ?? '' }, kind: 'ksampler', latent: 'sd3', negative: 'text' };
  }
  if (p.family === 'flux1') {
    return { loader: 'unet', model, vae: files.vae, clip: { node: 'DualCLIPLoader', a: files.clip_l ?? '', b: files.t5xxl ?? '', type: 'flux' }, kind: 'ksampler', latent: 'sd3', negative: 'zero' };
  }
  return {
    loader: 'unet', model, vae: files.vae, clip: { node: 'CLIPLoader', name: files.llm ?? '', type: f.clipType ?? 'stable_diffusion' },
    kind: p.family === 'flux2' ? 'flux2' : 'ksampler', latent: p.family === 'flux2' ? 'flux2' : 'sd3', shift: f.shift, negative: f.negative,
  };
}

// ── stable-diffusion.cpp ───────────────────────────────────────────────────

export interface SdRun {
  prompt: string; negative?: string; width: number; height: number; seed: number; count: number;
  steps: number; cfg: number; sampler: string; scheduler: string;
  output: string;
  /** Low-memory switches for GPUs under ~12 GB. */
  lowVram?: boolean;
  /**
   * The installed sd-cli places weights by itself (--auto-fit, sd.cpp since July 2026). Then
   * --offload-to-cpu must not be passed: it turns auto-fit off and pins every weight to the GPU on
   * first use, which left no room to compute on an 8 GB card (SDXL, 0.9.1).
   */
  autoFit?: boolean;
  /** Image to image. */
  init?: string; strength?: number;
}

/** sd.cpp sampler names differ from ComfyUI's; unknown ones fall back to euler. */
export function sdcppSampler(comfyName: string): string {
  const map: Record<string, string> = {
    euler: 'euler', euler_ancestral: 'euler_a', euler_a: 'euler_a', heun: 'heun', dpm_2: 'dpm2', dpmpp_2s_ancestral: 'dpm++2s_a',
    dpmpp_2m: 'dpm++2m', 'dpm++2m': 'dpm++2m', dpmpp_2mv2: 'dpm++2mv2', ipndm: 'ipndm', ipndm_v: 'ipndm_v', lcm: 'lcm', ddim: 'ddim_trailing', tcd: 'tcd',
    res_multistep: 'res_multistep',
  };
  return map[comfyName] ?? 'euler';
}
export function sdcppScheduler(comfyName: string): string | undefined {
  const map: Record<string, string> = { karras: 'karras', exponential: 'exponential', sgm_uniform: 'sgm_uniform', simple: 'simple', normal: 'discrete', discrete: 'discrete', ays: 'ays', gits: 'gits' };
  return map[comfyName];
}

/**
 * Command-line arguments for sd.cpp's `sd-cli` (or older `sd`). `path(folder, file)` gives a file's full
 * path under Lotus Studio/Models/image. LoRAs go in the prompt as <lora:name:weight> with --lora-model-dir.
 */
export function sdcppArgs(p: ImageProfile, run: SdRun, path: (folder: ImageFolder, file: string) => string, loras: LoraUse[] = []): string[] {
  const f = FAMILIES[p.family];
  const files = p.files;
  const args: string[] = [];
  const add = (flag: string, v: string | number | undefined) => { if (v !== undefined && v !== '') args.push(flag, String(v)); };
  const model = path(f.mainFolder, files.model ?? '');
  if (f.mainFolder === 'checkpoints') add('-m', model); else add('--diffusion-model', model);
  if (files.vae) add('--vae', path('vae', files.vae));
  if (files.clip_l) add('--clip_l', path('text_encoders', files.clip_l));
  if (files.clip_g) add('--clip_g', path('text_encoders', files.clip_g));
  if (files.t5xxl) add('--t5xxl', path('text_encoders', files.t5xxl));
  if (files.llm) add('--llm', path('text_encoders', files.llm));
  const all = [...(p.loras ?? []), ...loras].slice(0, 6);
  const tags = all.map((l) => `<lora:${l.name.replace(/\.(safetensors|ckpt|pt|gguf)$/i, '')}:${l.strength}>`).join('');
  if (all.length) add('--lora-model-dir', path('loras', '').replace(/[\\/]+$/, ''));
  add('-p', `${run.prompt}${tags}`);
  if (f.negative === 'text' && run.negative) add('-n', run.negative);
  add('--cfg-scale', run.cfg);
  add('--steps', run.steps);
  add('--sampling-method', sdcppSampler(run.sampler));
  const sch = sdcppScheduler(run.scheduler);
  if (sch && sch !== 'discrete') add('--scheduler', sch);
  if (p.family === 'qwen-image' && f.shift !== undefined) add('--flow-shift', f.shift);
  add('-W', run.width);
  add('-H', run.height);
  add('-s', run.seed);
  add('-b', Math.max(1, Math.min(4, run.count)));
  if (run.init) { add('-i', run.init); add('--strength', run.strength ?? 0.65); }
  // Split models are big: run the attention in flash mode, and on smaller GPUs keep weights in RAM
  // until each part is needed and decode the image in tiles.
  if (f.mainFolder === 'diffusion_models') args.push('--diffusion-fa');
  if (run.lowVram) {
    // With auto-fit, keep 1 GiB of the free video memory spare for the desktop and other apps, and let
    // sd.cpp leave the rest of the weights in RAM; older builds only have --offload-to-cpu.
    if (run.autoFit) args.push('--max-vram', '-1', '--vae-tiling');
    else args.push('--offload-to-cpu', '--vae-tiling');
  }
  add('-o', run.output);
  return args;
}

/** Reads sd.cpp's progress line ("|====>   | 3/20 - 1.23s/it") → 0..1, or null. */
export function sdcppProgress(line: string): { step: number; total: number } | null {
  const m = /\|\s*(\d+)\s*\/\s*(\d+)\s*-/.exec(line) ?? /(?:^|\s)(\d+)\s*\/\s*(\d+)\s*-\s*[\d.]+\s*(?:s\/it|it\/s)/.exec(line);
  if (!m) return null;
  const step = Number(m[1]), total = Number(m[2]);
  return total > 0 && step <= total ? { step, total } : null;
}
