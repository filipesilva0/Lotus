// ComfyUI client: checkpoint list, queue a txt2img graph, wait for the image, interrupt.

import { http, EngineError, errorText, timeoutSignal } from '../lib/http';
import { engineUrl } from './engineConfig';
import { recipeFor, ImageRecipe } from '../setup/catalog';

const ENGINE = 'ComfyUI';

export interface LoraUse { name: string; strength: number }

export interface TxtToImageInput {
  prompt: string;
  negativePrompt?: string;
  checkpoint: string;
  steps: number;
  cfg: number;
  width: number;
  height: number;
  seed?: number;
  sampler?: string;
  scheduler?: string;
  /** Images per run (1–8). */
  count?: number;
  /** LoRAs applied on top of the checkpoint, in order (at most 4). */
  loras?: LoraUse[];
  signal?: AbortSignal;
  onTick?: (elapsedMs: number, queued: boolean) => void;
}

export interface ComfyBatch {
  items: { blob: Blob; url: string }[];
  seed: number;
  promptId: string;
  generationTimeSec: number;
}

export interface ComfyStats {
  device: string | null;
  vramTotalGb: number;
  vramFreeGb: number;
  ramTotalGb: number;
  ramFreeGb: number;
  version: string | null;
}

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

class ComfyService {
  get baseUrl() {
    return engineUrl('comfyui');
  }

  private async raw(path: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
    let res: Response;
    try {
      res = await http(`${this.baseUrl}${path}`, { ...init, signal: init.signal ?? timeoutSignal(timeoutMs) });
    } catch {
      throw new EngineError(
        `Can't reach ComfyUI at ${this.baseUrl}. Start ComfyUI from the Engines tab, then try again.`,
        ENGINE,
        undefined,
        true,
      );
    }
    if (!res.ok) throw new EngineError(await errorText(res), ENGINE, res.status);
    return res;
  }

  async isUp(): Promise<boolean> {
    try {
      const r = await http(`${this.baseUrl}/system_stats`, { signal: timeoutSignal(1500) });
      return r.ok;
    } catch {
      return false;
    }
  }

  async stats(): Promise<ComfyStats> {
    const j = await (await this.raw('/system_stats', {}, 2000)).json();
    const dev = j.devices?.[0];
    return {
      device: dev?.name ?? null,
      vramTotalGb: dev ? dev.vram_total / 1024 ** 3 : 0,
      vramFreeGb: dev ? dev.vram_free / 1024 ** 3 : 0,
      ramTotalGb: (j.system?.ram_total ?? 0) / 1024 ** 3,
      ramFreeGb: (j.system?.ram_free ?? 0) / 1024 ** 3,
      version: j.system?.comfyui_version ?? null,
    };
  }

  async checkpoints(): Promise<string[]> {
    const j = await (await this.raw('/object_info/CheckpointLoaderSimple')).json();
    return j?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? [];
  }

  /**
   * Everything the Images model picker can use: classic all-in-one checkpoints, plus split models in
   * models/diffusion_models that Lotus has a recipe for (the recommended ones from the setup guide).
   */
  async imageModels(): Promise<string[]> {
    const ckpts = await this.checkpoints();
    let unets: string[] = [];
    try {
      const j = await (await this.raw('/object_info/UNETLoader')).json();
      unets = j?.UNETLoader?.input?.required?.unet_name?.[0] ?? [];
    } catch { /* older ComfyUI */ }
    return [...unets.filter((n) => !!recipeFor(n)), ...ckpts];
  }

  /** LoRA files ComfyUI can load (its models/loras folder). */
  async loras(): Promise<string[]> {
    try {
      const j = await (await this.raw('/object_info/LoraLoader')).json();
      return j?.LoraLoader?.input?.required?.lora_name?.[0] ?? [];
    } catch { return []; }
  }

  async interrupt() {
    await this.raw('/interrupt', { method: 'POST' }).catch(() => undefined);
  }

  /** Sampler and scheduler names this ComfyUI install supports. */
  async samplers(): Promise<{ samplers: string[]; schedulers: string[] }> {
    try {
      const j = await (await this.raw('/object_info/KSampler')).json();
      const r = j?.KSampler?.input?.required;
      return { samplers: r?.sampler_name?.[0] ?? [], schedulers: r?.scheduler?.[0] ?? [] };
    } catch { return { samplers: [], schedulers: [] }; }
  }

  /** Uploads an image so a graph can load it (PNG alpha is kept: used as the inpaint mask). */
  async upload(blob: Blob, name = `lotus-${Date.now()}.png`): Promise<string> {
    const fd = new FormData();
    fd.append('image', blob, name);
    fd.append('overwrite', 'true');
    const j = await (await this.raw('/upload/image', { method: 'POST', body: fd }, 60_000)).json();
    return j.name as string;
  }

  /**
   * The model, text encoder and VAE. A classic checkpoint is one node ('4'); a split model with a known
   * recipe (setup/catalog.ts) is UNETLoader '4' + CLIPLoader '40' + VAELoader '41' (+ ModelSamplingAuraFlow '42').
   */
  private loaders(i: TxtToImageInput): { nodes: Record<string, unknown>; model: [string, number]; clip: [string, number]; vae: [string, number]; recipe?: ImageRecipe } {
    const r = recipeFor(i.checkpoint);
    if (!r) return { nodes: { '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: i.checkpoint } } }, model: ['4', 0], clip: ['4', 1], vae: ['4', 2] };
    const nodes: Record<string, unknown> = {
      '4': { class_type: 'UNETLoader', inputs: { unet_name: i.checkpoint, weight_dtype: 'default' } },
      '40': { class_type: 'CLIPLoader', inputs: { clip_name: r.clip, type: r.clipType, device: 'default' } },
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
  private lora(i: TxtToImageInput): { nodes: Record<string, unknown>; model: [string, number]; clip: [string, number] } {
    const ld = this.loaders(i);
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
  private sampler(i: TxtToImageInput, seed: number, latent: [string, number], denoise: number) {
    const r = recipeFor(i.checkpoint);
    return {
      class_type: 'KSampler',
      inputs: {
        seed, steps: r?.steps ?? i.steps, cfg: r?.cfg ?? i.cfg, sampler_name: r?.sampler ?? i.sampler ?? 'euler', scheduler: r?.scheduler ?? i.scheduler ?? 'normal', denoise,
        model: this.lora(i).model, positive: ['6', 0], negative: ['7', 0], latent_image: latent,
      },
    };
  }

  private vae(i: TxtToImageInput): [string, number] { return this.loaders(i).vae; }

  private base(i: TxtToImageInput) {
    const ld = this.loaders(i);
    const l = this.lora(i);
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
  private onlyTxt2Img(i: TxtToImageInput) {
    if (recipeFor(i.checkpoint)?.kind === 'flux2') {
      throw new EngineError(`${i.checkpoint} only does text to image in Lotus for now. Pick another model (Z-Image Turbo or a checkpoint) to edit, inpaint or extend images.`, ENGINE);
    }
  }

  /** Exposed for tests: the workflow that would be queued for a text-to-image run. */
  buildTxt2ImgGraph(i: TxtToImageInput, seed: number) { return this.graph(i, seed); }

  /** Text → image. */
  private graph(i: TxtToImageInput, seed: number) {
    const r = recipeFor(i.checkpoint);
    const size = { width: i.width, height: i.height, batch_size: i.count ?? 1 };
    if (r?.kind === 'flux2') {
      // Same wiring as ComfyUI's own FLUX.2 Klein template: noise + guider + sampler + sigmas.
      return {
        ...this.base(i),
        '5': { class_type: 'EmptyFlux2LatentImage', inputs: size },
        '30': { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
        '31': { class_type: 'KSamplerSelect', inputs: { sampler_name: r.sampler } },
        '32': { class_type: 'Flux2Scheduler', inputs: { steps: r.steps, width: i.width, height: i.height } },
        '33': { class_type: 'CFGGuider', inputs: { model: this.lora(i).model, positive: ['6', 0], negative: ['7', 0], cfg: r.cfg } },
        '3': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['30', 0], guider: ['33', 0], sampler: ['31', 0], sigmas: ['32', 0], latent_image: ['5', 0] } },
      };
    }
    return {
      ...this.base(i),
      '3': this.sampler(i, seed, ['5', 0], 1),
      '5': { class_type: r ? 'EmptySD3LatentImage' : 'EmptyLatentImage', inputs: size },
    };
  }

  /** Image → image: the reference is encoded and partly re-noised (denoise < 1 keeps more of it). */
  private graphImg2Img(i: TxtToImageInput, seed: number, file: string, denoise: number) {
    this.onlyTxt2Img(i);
    return {
      ...this.base(i),
      '10': { class_type: 'LoadImage', inputs: { image: file } },
      '11': { class_type: 'ImageScale', inputs: { image: ['10', 0], upscale_method: 'lanczos', width: i.width, height: i.height, crop: 'center' } },
      '12': { class_type: 'VAEEncode', inputs: { pixels: ['11', 0], vae: this.vae(i) } },
      '3': this.sampler(i, seed, ['12', 0], denoise),
    };
  }

  /** Inpainting: transparent pixels of the uploaded PNG are repainted. */
  private graphInpaint(i: TxtToImageInput, seed: number, file: string) {
    this.onlyTxt2Img(i);
    return {
      ...this.base(i),
      '10': { class_type: 'LoadImage', inputs: { image: file } },
      '12': { class_type: 'VAEEncodeForInpaint', inputs: { pixels: ['10', 0], vae: this.vae(i), mask: ['10', 1], grow_mask_by: 8 } },
      '3': this.sampler(i, seed, ['12', 0], 1),
    };
  }

  /** Outpainting: pad the canvas, then repaint the new border. Pads are rounded to multiples of 8. */
  private graphOutpaint(i: TxtToImageInput, seed: number, file: string, pad: { left: number; top: number; right: number; bottom: number }) {
    const r8 = (n: number) => Math.round(n / 8) * 8;
    this.onlyTxt2Img(i);
    return {
      ...this.base(i),
      '10': { class_type: 'LoadImage', inputs: { image: file } },
      '11': { class_type: 'ImagePadForOutpaint', inputs: { image: ['10', 0], left: r8(pad.left), top: r8(pad.top), right: r8(pad.right), bottom: r8(pad.bottom), feathering: 40 } },
      '12': { class_type: 'VAEEncodeForInpaint', inputs: { pixels: ['11', 0], vae: this.vae(i), mask: ['11', 1], grow_mask_by: 8 } },
      '3': this.sampler(i, seed, ['12', 0], 1),
    };
  }

  /** Resize with a classic filter (no AI upscaler model needed). */
  private graphScale(file: string, factor: number) {
    return {
      '10': { class_type: 'LoadImage', inputs: { image: file } },
      '11': { class_type: 'ImageScaleBy', inputs: { image: ['10', 0], upscale_method: 'lanczos', scale_by: factor } },
      '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'lotus-up', images: ['11', 0] } },
    };
  }

  /** Queues a graph, waits for it and returns every output image. */
  private async execute(graph: object, signal?: AbortSignal, onTick?: (ms: number, queued: boolean) => void): Promise<{ blobs: Blob[]; promptId: string; sec: number }> {
    const t0 = performance.now();
    const queued = await (await this.raw('/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: 'lotus-studio' }) })).json();
    const promptId: string = queued.prompt_id;
    if (!promptId) throw new EngineError(queued.error?.message ?? 'ComfyUI did not accept the workflow.', ENGINE);
    for (;;) {
      if (signal?.aborted) { await this.interrupt(); throw new EngineError('Cancelled', ENGINE); }
      const hist = await (await this.raw(`/history/${promptId}`)).json();
      const entry = hist[promptId];
      onTick?.(performance.now() - t0, !entry);
      if (entry) {
        if (entry.status?.status_str === 'error') {
          const msg = entry.status.messages?.find((m: any[]) => m[0] === 'execution_error')?.[1]?.exception_message;
          throw new EngineError(msg || 'ComfyUI reported an error while generating.', ENGINE);
        }
        const imgs = Object.values<any>(entry.outputs ?? {}).flatMap((o) => o.images ?? []);
        if (imgs.length) {
          const blobs = await Promise.all(imgs.map(async (img: any) => {
            const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder ?? '', type: img.type ?? 'output' });
            return (await this.raw(`/view?${q}`, {}, 60_000)).blob();
          }));
          return { blobs, promptId, sec: Math.round(((performance.now() - t0) / 1000) * 10) / 10 };
        }
      }
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  private pack(r: { blobs: Blob[]; promptId: string; sec: number }, seed: number): ComfyBatch {
    return { items: r.blobs.map((blob) => ({ blob, url: URL.createObjectURL(blob) })), seed, promptId: r.promptId, generationTimeSec: r.sec };
  }

  async txt2img(i: TxtToImageInput): Promise<ComfyBatch> {
    const seed = i.seed ?? Math.floor(Math.random() * 2 ** 31);
    return this.pack(await this.execute(this.graph(i, seed), i.signal, i.onTick), seed);
  }

  async img2img(i: TxtToImageInput, reference: Blob, denoise = 0.65): Promise<ComfyBatch> {
    const seed = i.seed ?? Math.floor(Math.random() * 2 ** 31);
    const file = await this.upload(reference);
    return this.pack(await this.execute(this.graphImg2Img(i, seed, file, denoise), i.signal, i.onTick), seed);
  }

  async inpaint(i: TxtToImageInput, maskedPng: Blob): Promise<ComfyBatch> {
    const seed = i.seed ?? Math.floor(Math.random() * 2 ** 31);
    const file = await this.upload(maskedPng);
    return this.pack(await this.execute(this.graphInpaint(i, seed, file), i.signal, i.onTick), seed);
  }

  async outpaint(i: TxtToImageInput, source: Blob, pad: { left: number; top: number; right: number; bottom: number }): Promise<ComfyBatch> {
    const seed = i.seed ?? Math.floor(Math.random() * 2 ** 31);
    const file = await this.upload(source);
    return this.pack(await this.execute(this.graphOutpaint(i, seed, file, pad), i.signal, i.onTick), seed);
  }

  async upscale(source: Blob, factor: 2 | 4, signal?: AbortSignal, onTick?: (ms: number, queued: boolean) => void): Promise<ComfyBatch> {
    const file = await this.upload(source);
    return this.pack(await this.execute(this.graphScale(file, factor), signal, onTick), 0);
  }
}

export const comfy = new ComfyService();
