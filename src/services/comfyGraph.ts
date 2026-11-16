// ComfyUI workflow graphs (pure): text to image, image to image, inpaint, outpaint, scale.
// Shared by the Images page (services/comfyService.ts) and the core's image.generate tool
// (core/src/tools/image.ts), so both queue exactly the same workflow.

import { recipeFor, ImageRecipe } from '../setup/catalog';
import { comfyWiring, settingsFor, type ImageProfile } from '../models/imageProfiles';

export interface LoraUse { name: string; strength: number }

/** What a graph needs (the Images page's TxtToImageInput carries more: signal, onTick). */
export interface GraphInput {
  prompt: string;
  negativePrompt?: string;
  checkpoint: string;
  steps: number;
  cfg: number;
  width: number;
  height: number;
  sampler?: string;
  scheduler?: string;
  /** Images per run (1–8). */
  count?: number;
  /** LoRAs applied on top of the checkpoint, in order (at most 4). */
  loras?: LoraUse[];
  /** Session 17: an image setup ties the model to its own VAE and text encoders (models/imageProfiles.ts). */
  profile?: ImageProfile;
}
type TxtToImageInput = GraphInput;

/** A model that can't do what was asked (the caller wraps it in its own error type). */
export class GraphError extends Error {}

/** Common aspect ratios → pixel sizes. SD 1.x checkpoints get the smaller 512-based set. */
export function dimensionsFor(aspect: string, checkpoint: string): { width: number; height: number } {
  const r64 = (n: number) => Math.max(64, Math.round(n / 64) * 64);
  const custom = /^(\d{2,5})\s*[x×]\s*(\d{2,5})$/.exec(aspect);
  if (custom) return { width: r64(+custom[1]), height: r64(+custom[2]) };
  const small = /sd[_-]?1\.?5|v1-5|sd15/i.test(checkpoint);
  const [a, b] = aspect.split(':').map(Number);
  const ratio = a > 0 && b > 0 ? a / b : 1;
  const area = (recipeFor(checkpoint)?.base ?? (small ? 512 : 1024)) ** 2;
  return { width: r64(Math.sqrt(area * ratio)), height: r64(Math.sqrt(area / ratio)) };
}

/** A profile's wiring as the recipe shape the graph builders already use (+ checkpoint/VAE override). */
interface Spec extends Partial<ImageRecipe> { checkpoint?: boolean; vaeOverride?: string; clipNode?: 'CLIPLoader' | 'DualCLIPLoader' | 'TripleCLIPLoader'; clips?: string[] }
function specOf(i: TxtToImageInput): Spec | undefined {
  if (i.profile) {
    const w = comfyWiring(i.profile);
    const st = settingsFor(i.profile);
    const common = { steps: st.steps, cfg: st.cfg, sampler: st.sampler, scheduler: st.scheduler, base: st.base, negative: w.negative, kind: w.kind } as const;
    if (w.loader === 'checkpoint' && !w.clip) return st.locked ? { ...common, checkpoint: true, vaeOverride: w.vae } : { checkpoint: true, vaeOverride: w.vae, base: st.base };
    if (w.loader === 'checkpoint' && w.clip?.node === 'TripleCLIPLoader') return { checkpoint: true, vaeOverride: w.vae, clipNode: 'TripleCLIPLoader', clips: [w.clip.a, w.clip.b, w.clip.c], latent: 'sd3', base: st.base };
    const clip = w.clip!;
    return {
      ...(st.locked ? common : { base: st.base, negative: w.negative, kind: w.kind }), unet: w.model, vae: w.vae ?? '', shift: w.shift, latent: w.latent === 'flux2' ? 'flux2' : 'sd3',
      ...(clip.node === 'CLIPLoader' ? { clip: clip.name, clipType: clip.type, clipNode: 'CLIPLoader' as const } : clip.node === 'DualCLIPLoader' ? { clipNode: 'DualCLIPLoader' as const, clips: [clip.a, clip.b], clipType: clip.type } : {}),
    };
  }
  return recipeFor(i.checkpoint);
}

/**
 * The model, text encoder and VAE. A classic checkpoint is one node ('4') (+ VAELoader '41' when its
 * setup names a separate VAE); a split model is UNETLoader '4' + text encoder loader '40' + VAELoader
 * '41' (+ ModelSamplingAuraFlow '42').
 */
function loaders(i: TxtToImageInput): { nodes: Record<string, unknown>; model: [string, number]; clip: [string, number]; vae: [string, number]; recipe?: Spec } {
  const r = specOf(i);
  const name = i.profile?.files.model ?? i.checkpoint;
  if (!r || r.checkpoint) {
    const nodes: Record<string, unknown> = { '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: name } } };
    let vae: [string, number] = ['4', 2];
    let clip: [string, number] = ['4', 1];
    if (r?.vaeOverride) { nodes['41'] = { class_type: 'VAELoader', inputs: { vae_name: r.vaeOverride } }; vae = ['41', 0]; }
    if (r?.clipNode === 'TripleCLIPLoader' && r.clips) { nodes['40'] = { class_type: 'TripleCLIPLoader', inputs: { clip_name1: r.clips[0], clip_name2: r.clips[1], clip_name3: r.clips[2] } }; clip = ['40', 0]; }
    return { nodes, model: ['4', 0], clip, vae, recipe: r && (r.steps !== undefined || r.clipNode) ? r : undefined };
  }
  const nodes: Record<string, unknown> = {
    '4': { class_type: 'UNETLoader', inputs: { unet_name: r.unet ?? name, weight_dtype: 'default' } },
    '40': r.clipNode === 'DualCLIPLoader' && r.clips
      ? { class_type: 'DualCLIPLoader', inputs: { clip_name1: r.clips[0], clip_name2: r.clips[1], type: r.clipType ?? 'flux', device: 'default' } }
      : { class_type: 'CLIPLoader', inputs: { clip_name: r.clip, type: r.clipType, device: 'default' } },
    '41': { class_type: 'VAELoader', inputs: { vae_name: r.vae } },
  };
  let model: [string, number] = ['4', 0];
  if (r.shift !== undefined) { nodes['42'] = { class_type: 'ModelSamplingAuraFlow', inputs: { model, shift: r.shift } }; model = ['42', 0]; }
  return { nodes, model, clip: ['40', 0], vae: ['41', 0], recipe: r };
}

/**
 * LoRAs are chained one after another between the loaders and everything that uses the model and
 * text encoder: loader → LoraLoader 20 → LoraLoader 21 → … Node ids 20+ are reserved for them.
 * With no LoRAs the loaders feed the graph directly, exactly as before.
 */
function lora(i: TxtToImageInput): { nodes: Record<string, unknown>; model: [string, number]; clip: [string, number] } {
  const ld = loaders(i);
  const nodes: Record<string, unknown> = {};
  let model = ld.model;
  let clip = ld.clip;
  (i.loras ?? []).slice(0, 4).forEach((l, k) => {
    const id = String(20 + k);
    nodes[id] = { class_type: 'LoraLoader', inputs: { model, clip, lora_name: l.name, strength_model: l.strength, strength_clip: l.strength } };
    model = [id, 0];
    clip = [id, 1];
  });
  return { nodes, model, clip };
}

/** Recipe models have fixed steps, guidance and sampler (distilled models break with other values). */
function sampler(i: TxtToImageInput, seed: number, latent: [string, number], denoise: number) {
  const r = specOf(i);
  return {
    class_type: 'KSampler',
    inputs: {
      seed, steps: r?.steps ?? i.steps, cfg: r?.cfg ?? i.cfg, sampler_name: r?.sampler ?? i.sampler ?? 'euler', scheduler: r?.scheduler ?? i.scheduler ?? 'normal', denoise,
      model: lora(i).model, positive: ['6', 0], negative: ['7', 0], latent_image: latent,
    },
  };
}

function vae(i: TxtToImageInput): [string, number] { return loaders(i).vae; }

function base(i: TxtToImageInput) {
  const ld = loaders(i);
  const l = lora(i);
  const negative = ld.recipe?.negative === 'zero'
    ? { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['6', 0] } }
    : { class_type: 'CLIPTextEncode', inputs: { text: i.negativePrompt ?? '', clip: l.clip } };
  return {
    ...ld.nodes,
    ...l.nodes,
    '6': { class_type: 'CLIPTextEncode', inputs: { text: i.prompt, clip: l.clip } },
    '7': negative,
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ld.vae } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'lotus', images: ['8', 0] } },
  };
}

/** FLUX.2 Klein is driven through the custom-sampler nodes, and Lotus wires text-to-image only. */
function onlyTxt2Img(i: TxtToImageInput) {
  if (specOf(i)?.kind === 'flux2') {
    throw new GraphError(`${i.profile?.name ?? i.checkpoint} only does text to image in Lotus for now. Pick another model (Z-Image Turbo or a checkpoint) to edit, inpaint or extend images.`);
  }
}

/** Text → image. */
export function graphTxt2Img(i: TxtToImageInput, seed: number) {
  const r = specOf(i);
  const size = { width: i.width, height: i.height, batch_size: i.count ?? 1 };
  if (r?.kind === 'flux2') {
    // Same wiring as ComfyUI's own FLUX.2 Klein template: noise + guider + sampler + sigmas.
    return {
      ...base(i),
      '5': { class_type: 'EmptyFlux2LatentImage', inputs: size },
      '30': { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
      '31': { class_type: 'KSamplerSelect', inputs: { sampler_name: r.sampler ?? 'euler' } },
      '32': { class_type: 'Flux2Scheduler', inputs: { steps: r.steps ?? 4, width: i.width, height: i.height } },
      '33': { class_type: 'CFGGuider', inputs: { model: lora(i).model, positive: ['6', 0], negative: ['7', 0], cfg: r.cfg ?? 1 } },
      '3': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['30', 0], guider: ['33', 0], sampler: ['31', 0], sigmas: ['32', 0], latent_image: ['5', 0] } },
    };
  }
  return {
    ...base(i),
    '3': sampler(i, seed, ['5', 0], 1),
    '5': { class_type: r && !r.checkpoint ? 'EmptySD3LatentImage' : r?.latent === 'sd3' ? 'EmptySD3LatentImage' : 'EmptyLatentImage', inputs: size },
  };
}

/** Image → image: the reference is encoded and partly re-noised (denoise < 1 keeps more of it). */
export function graphImg2Img(i: TxtToImageInput, seed: number, file: string, denoise: number) {
  onlyTxt2Img(i);
  return {
    ...base(i),
    '10': { class_type: 'LoadImage', inputs: { image: file } },
    '11': { class_type: 'ImageScale', inputs: { image: ['10', 0], upscale_method: 'lanczos', width: i.width, height: i.height, crop: 'center' } },
    '12': { class_type: 'VAEEncode', inputs: { pixels: ['11', 0], vae: vae(i) } },
    '3': sampler(i, seed, ['12', 0], denoise),
  };
}

/** Inpainting: transparent pixels of the uploaded PNG are repainted. */
export function graphInpaint(i: TxtToImageInput, seed: number, file: string) {
  onlyTxt2Img(i);
  return {
    ...base(i),
    '10': { class_type: 'LoadImage', inputs: { image: file } },
    '12': { class_type: 'VAEEncodeForInpaint', inputs: { pixels: ['10', 0], vae: vae(i), mask: ['10', 1], grow_mask_by: 8 } },
    '3': sampler(i, seed, ['12', 0], 1),
  };
}

/** Outpainting: pad the canvas, then repaint the new border. Pads are rounded to multiples of 8. */
export function graphOutpaint(i: TxtToImageInput, seed: number, file: string, pad: { left: number; top: number; right: number; bottom: number }) {
  const r8 = (n: number) => Math.round(n / 8) * 8;
  onlyTxt2Img(i);
  return {
    ...base(i),
    '10': { class_type: 'LoadImage', inputs: { image: file } },
    '11': { class_type: 'ImagePadForOutpaint', inputs: { image: ['10', 0], left: r8(pad.left), top: r8(pad.top), right: r8(pad.right), bottom: r8(pad.bottom), feathering: 40 } },
    '12': { class_type: 'VAEEncodeForInpaint', inputs: { pixels: ['11', 0], vae: vae(i), mask: ['11', 1], grow_mask_by: 8 } },
    '3': sampler(i, seed, ['12', 0], 1),
  };
}

/** Resize with a classic filter (no AI upscaler model needed). */
export function graphScale(file: string, factor: number) {
  return {
    '10': { class_type: 'LoadImage', inputs: { image: file } },
    '11': { class_type: 'ImageScaleBy', inputs: { image: ['10', 0], upscale_method: 'lanczos', scale_by: factor } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'lotus-up', images: ['11', 0] } },
  };
}
