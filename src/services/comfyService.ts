// ComfyUI client: checkpoint list, queue a txt2img graph, wait for the image, interrupt.

import { http, EngineError, errorText, timeoutSignal } from '../lib/http';
import { engineUrl } from './engineConfig';
import { recipeFor } from '../setup/catalog';
import { dimensionsFor, GraphError, graphImg2Img, graphInpaint, graphOutpaint, graphScale, graphTxt2Img, type LoraUse } from './comfyGraph';

export { dimensionsFor, type LoraUse };

const ENGINE = 'ComfyUI';

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

/** Graph errors (a model that can't edit, …) become ComfyUI engine errors. */
function wrap<T>(f: () => T): T {
  try { return f(); } catch (e) { if (e instanceof GraphError) throw new EngineError(e.message, ENGINE); throw e; }
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

  /** Exposed for tests: the workflow that would be queued for a text-to-image run. */
  buildTxt2ImgGraph(i: TxtToImageInput, seed: number) { return graphTxt2Img(i, seed); }

  private graph(i: TxtToImageInput, seed: number) { return wrap(() => graphTxt2Img(i, seed)); }
  private graphImg2Img(i: TxtToImageInput, seed: number, file: string, denoise: number) { return wrap(() => graphImg2Img(i, seed, file, denoise)); }
  private graphInpaint(i: TxtToImageInput, seed: number, file: string) { return wrap(() => graphInpaint(i, seed, file)); }
  private graphOutpaint(i: TxtToImageInput, seed: number, file: string, pad: { left: number; top: number; right: number; bottom: number }) { return wrap(() => graphOutpaint(i, seed, file, pad)); }
  private graphScale(file: string, factor: number) { return graphScale(file, factor); }

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
