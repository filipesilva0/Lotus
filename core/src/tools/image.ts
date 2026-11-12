// image.generate: text to image through ComfyUI, with the same workflow the Images page queues
// (services/comfyGraph.ts) and the model/settings the user last picked there. The images are saved
// as files in Lotus Studio/Images and added to the Images page's history.

import type { Tool, ToolCtx } from '../agent/types';
import { dimensionsFor, GraphError, graphTxt2Img, type GraphInput } from '../../../src/services/comfyGraph';
import { recipeFor } from '../../../src/setup/catalog';
import { saveMedia } from '../media';
import { authHeader } from '../agent/llm';

export const GALLERY_KEY = 'lotus.gallery.v2';
const PARAMS_KEY = 'lotus.image.params.v1';
const DEFAULTS = { checkpoint: '', aspect: '1:1', negative: 'lowres, blurry, distorted, text, watermark', cfg: 7, steps: 28, sampler: 'euler', scheduler: 'normal' };

export function engine(ctx: Pick<ToolCtx, 'kvGet'>, id: 'ollama' | 'comfyui' | 'voicebox', fallback: string): { url: string; auth: string | null } {
  const map = (k: string): Record<string, string> => { try { return JSON.parse(ctx.kvGet(k) || '{}'); } catch { return {}; } };
  return { url: (map('lotus.engineUrls.v1')[id] || fallback).replace(/\/+$/, ''), auth: authHeader(map('lotus.engineAuth.v1')[id]) };
}

const json = (r: Response) => r.json() as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function comfyModels(ctx: ToolCtx, url: string, h: Record<string, string>): Promise<string[]> {
  const list = async (node: string, field: string) => {
    try { const j = await json(await ctx.fetch(`${url}/object_info/${node}`, { headers: h, signal: ctx.signal })); return (j?.[node]?.input?.required?.[field]?.[0] ?? []) as string[]; }
    catch { return []; }
  };
  const [unets, ckpts] = await Promise.all([list('UNETLoader', 'unet_name'), list('CheckpointLoaderSimple', 'ckpt_name')]);
  return [...unets.filter((n) => !!recipeFor(n)), ...ckpts];
}

export const imageGenerate: Tool = {
  name: 'image.generate', label: 'Making an image', risk: 'write',
  description: 'Make an image from a text description with the user\'s image model (ComfyUI). The image is shown in the chat and saved to the Images page. Write the prompt in English, describing subject, style and lighting.',
  parameters: { type: 'object', properties: {
    prompt: { type: 'string', description: 'What the image should show, in detail.' },
    aspect: { type: 'string', description: 'Shape: 1:1 (default), 16:9, 9:16, 4:3 or 3:4.', enum: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'] },
    count: { type: 'integer', description: 'How many images (1 to 4, default 1).' },
    negative: { type: 'string', description: 'What to avoid (optional).' },
  }, required: ['prompt'] },
  describe: (a) => `Make ${Number(a.count) > 1 ? `${a.count} images` : 'an image'} of “${String(a.prompt).slice(0, 80)}”`,
  async run(a, ctx) {
    const { url, auth } = engine(ctx, 'comfyui', 'http://127.0.0.1:8188');
    const h: Record<string, string> = auth ? { authorization: auth } : {};
    let saved: Partial<typeof DEFAULTS> = {};
    try { saved = JSON.parse(ctx.kvGet(PARAMS_KEY) || '{}'); } catch { /* defaults */ }
    const p = { ...DEFAULTS, ...saved };

    try { const r = await ctx.fetch(`${url}/system_stats`, { headers: h, signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(4000)]) }); if (!r.ok) throw new Error(); }
    catch { if (ctx.signal.aborted) throw new DOMException('Stopped', 'AbortError'); return { ok: false, text: `ComfyUI isn't running at ${url}, so no image was made. Tell the user to start ComfyUI (Images page or Settings → Engines) and ask again.`, summary: 'ComfyUI is not running' }; }

    let checkpoint = p.checkpoint;
    const models = await comfyModels(ctx, url, h);
    if (!checkpoint || (models.length && !models.includes(checkpoint))) checkpoint = models[0] ?? '';
    if (!checkpoint) return { ok: false, text: 'ComfyUI has no image model installed, so no image was made. The user can download one in Settings → Models.', summary: 'No image model installed' };

    const aspect = typeof a.aspect === 'string' ? a.aspect : p.aspect;
    const { width, height } = dimensionsFor(aspect, checkpoint);
    const count = Math.max(1, Math.min(4, Number(a.count) || 1));
    const input: GraphInput = { prompt: String(a.prompt), negativePrompt: typeof a.negative === 'string' ? a.negative : p.negative, checkpoint, steps: p.steps, cfg: p.cfg, width, height, sampler: p.sampler, scheduler: p.scheduler, count };
    const seed = Math.floor(Math.random() * 2 ** 31);
    let graph;
    try { graph = graphTxt2Img(input, seed); } catch (e) { if (e instanceof GraphError) return { ok: false, text: e.message, summary: 'Model can’t do this' }; throw e; }

    const t0 = Date.now();
    const q = await json(await ctx.fetch(`${url}/prompt`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: 'lotus-core' }), signal: ctx.signal }));
    const promptId: string | undefined = q?.prompt_id;
    if (!promptId) return { ok: false, text: `ComfyUI did not accept the workflow: ${q?.error?.message ?? JSON.stringify(q).slice(0, 200)}`, summary: 'ComfyUI refused the workflow' };

    let outputs: { filename: string; subfolder?: string; type?: string }[] = [];
    for (;;) {
      if (ctx.signal.aborted) { await ctx.fetch(`${url}/interrupt`, { method: 'POST', headers: h }).catch(() => undefined); throw new DOMException('Stopped', 'AbortError'); }
      if (Date.now() - t0 > 15 * 60_000) return { ok: false, text: 'ComfyUI took more than 15 minutes; gave up waiting.', summary: 'Timed out' };
      const hist = await json(await ctx.fetch(`${url}/history/${promptId}`, { headers: h, signal: ctx.signal }));
      const entry = hist?.[promptId];
      ctx.progress(`${entry ? 'Finishing' : 'Generating'} · ${Math.round((Date.now() - t0) / 1000)} s`);
      if (entry) {
        if (entry.status?.status_str === 'error') {
          const msg = entry.status.messages?.find((m: unknown[]) => m[0] === 'execution_error')?.[1]?.exception_message;
          return { ok: false, text: `ComfyUI reported an error: ${msg || 'unknown error'}`, summary: 'ComfyUI error' };
        }
        outputs = Object.values<any>(entry.outputs ?? {}).flatMap((o) => o.images ?? []); // eslint-disable-line @typescript-eslint/no-explicit-any
        if (outputs.length) break;
      }
      await new Promise((r) => setTimeout(r, 700));
    }
    const sec = Math.round((Date.now() - t0) / 100) / 10;
    const media: string[] = [];
    const name = String(a.prompt).slice(0, 40);
    for (const img of outputs) {
      const qs = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder ?? '', type: img.type ?? 'output' });
      const res = await ctx.fetch(`${url}/view?${qs}`, { headers: h, signal: ctx.signal });
      const row = await saveMedia(ctx.db, ctx.studio, new Uint8Array(await res.arrayBuffer()), res.headers.get('content-type') || 'image/png', name);
      media.push(row.path);
    }

    // Add to the Images page's history.
    const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const gid = `gen-${Date.now().toString(36)}`;
    const versions = media.map((file, k) => ({ id: `img-${Date.now().toString(36)}-${k}`, file, prompt: input.prompt, negativePrompt: input.negativePrompt, seed, steps: recipeFor(checkpoint)?.steps ?? input.steps, cfg: recipeFor(checkpoint)?.cfg ?? input.cfg, dimensions: `${width}×${height}`, generationTimeSec: sec, timestamp: stamp, checkpoint, sampler: input.sampler, kind: 'txt2img' }));
    let gallery: unknown[] = [];
    try { const g = JSON.parse(ctx.kvGet(GALLERY_KEY) || '[]'); if (Array.isArray(g)) gallery = g; } catch { /* start fresh */ }
    ctx.kvSet(GALLERY_KEY, JSON.stringify([{ id: gid, title: input.prompt.slice(0, 40) || 'Untitled', ts: Date.now(), versions, index: 0, source: 'chat' }, ...gallery]));

    return {
      ok: true,
      text: `Made ${media.length} image${media.length === 1 ? '' : 's'} with ${checkpoint} (${width}×${height}, ${sec} s). The user can see ${media.length === 1 ? 'it' : 'them'} in the chat and on the Images page. Files: ${media.join(', ')}`,
      summary: `${media.length} image${media.length === 1 ? '' : 's'} · ${checkpoint.replace(/\.(safetensors|ckpt|gguf)$/i, '')} · ${sec} s`,
      media, data: { checkpoint, width, height, seed },
    };
  },
};
