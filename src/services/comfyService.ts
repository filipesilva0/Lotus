// ComfyUI client: checkpoint list, queue a txt2img graph, wait for the image, interrupt.

import { http, EngineError, errorText, timeoutSignal } from '../lib/http';
import { engineUrl } from './engineConfig';

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
  signal?: AbortSignal;
  onTick?: (elapsedMs: number, queued: boolean) => void;
}

export interface ComfyResult {
  url: string; // object URL
  seed: number;
  promptId: string;
  generationTimeSec: number;
}

export interface ComfyStats {
  device: string | null;
  vramTotalGb: number;
  vramFreeGb: number;
  version: string | null;
}

/** Common aspect ratios → pixel sizes. SD 1.x checkpoints get the smaller 512-based set. */
export function dimensionsFor(aspect: string, checkpoint: string): { width: number; height: number } {
  const small = /sd[_-]?1\.?5|v1-5|sd15/i.test(checkpoint);
  const table: Record<string, [number, number]> = small
    ? { '1:1': [512, 512], '16:9': [768, 432], '9:16': [432, 768], '4:3': [640, 480], '3:4': [480, 640] }
    : { '1:1': [1024, 1024], '16:9': [1344, 768], '9:16': [768, 1344], '4:3': [1152, 896], '3:4': [896, 1152] };
  const [width, height] = table[aspect] ?? table['1:1'];
  return { width, height };
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
      version: j.system?.comfyui_version ?? null,
    };
  }

  async checkpoints(): Promise<string[]> {
    const j = await (await this.raw('/object_info/CheckpointLoaderSimple')).json();
    return j?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? [];
  }

  async interrupt() {
    await this.raw('/interrupt', { method: 'POST' }).catch(() => undefined);
  }

  private graph(i: TxtToImageInput, seed: number) {
    return {
      '3': {
        class_type: 'KSampler',
        inputs: {
          seed, steps: i.steps, cfg: i.cfg,
          sampler_name: i.sampler ?? 'euler', scheduler: i.scheduler ?? 'normal', denoise: 1,
          model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0],
        },
      },
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: i.checkpoint } },
      '5': { class_type: 'EmptyLatentImage', inputs: { width: i.width, height: i.height, batch_size: 1 } },
      '6': { class_type: 'CLIPTextEncode', inputs: { text: i.prompt, clip: ['4', 1] } },
      '7': { class_type: 'CLIPTextEncode', inputs: { text: i.negativePrompt ?? '', clip: ['4', 1] } },
      '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
      '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'lotus', images: ['8', 0] } },
    };
  }

  async txt2img(input: TxtToImageInput): Promise<ComfyResult> {
    const seed = input.seed ?? Math.floor(Math.random() * 2 ** 31);
    const t0 = performance.now();

    const queued = await (
      await this.raw('/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: this.graph(input, seed), client_id: 'lotus-studio' }),
      })
    ).json();
    const promptId: string = queued.prompt_id;
    if (!promptId) throw new EngineError('ComfyUI did not accept the workflow.', ENGINE);

    // Poll history until the prompt shows up as finished.
    for (;;) {
      if (input.signal?.aborted) {
        await this.interrupt();
        throw new EngineError('Cancelled', ENGINE);
      }
      const hist = await (await this.raw(`/history/${promptId}`)).json();
      const entry = hist[promptId];
      input.onTick?.(performance.now() - t0, !entry);
      if (entry) {
        if (entry.status?.status_str === 'error') {
          const msg = entry.status.messages?.find((m: any[]) => m[0] === 'execution_error')?.[1]?.exception_message;
          throw new EngineError(msg || 'ComfyUI reported an error while generating.', ENGINE);
        }
        const img = Object.values<any>(entry.outputs ?? {})
          .flatMap((o) => o.images ?? [])
          .find(Boolean);
        if (img) {
          const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder ?? '', type: img.type ?? 'output' });
          const blob = await (await this.raw(`/view?${q}`, {}, 60_000)).blob();
          return {
            url: URL.createObjectURL(blob),
            seed,
            promptId,
            generationTimeSec: Math.round(((performance.now() - t0) / 1000) * 10) / 10,
          };
        }
      }
      await new Promise((r) => setTimeout(r, 600));
    }
  }
}

export const comfy = new ComfyService();
