import { useCallback, useEffect, useRef, useState } from 'react';
import { GeneratedImage } from '../types/lotus';
import { comfy, ComfyBatch, dimensionsFor, LoraUse, TxtToImageInput } from '../services/comfyService';
import { idbGet, idbSet } from '../lib/idb';
import { reportActivity } from '../lib/bus';
import { uid } from '../lib/persist';

export interface GenSession {
  id: string; title: string; ts: number; pinned?: boolean; folderId?: string;
  versions: GeneratedImage[]; index: number;
}

export interface ImageParams {
  checkpoint: string; aspect: string; count: number; negative: string; cfg: number; steps: number;
  sampler: string; scheduler: string; seed: number | null; denoise: number;
  /** LoRAs to apply (optional; saved settings from older versions have none). */
  loras?: LoraUse[];
}

export const DEFAULT_PARAMS: ImageParams = {
  checkpoint: '', aspect: '1:1', count: 1, negative: 'lowres, blurry, distorted, text, watermark',
  cfg: 7, steps: 28, sampler: 'euler', scheduler: 'normal', seed: null, denoise: 0.65, loras: [],
};

const KEY = 'gallery.v1';
const stamp = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const blank = (): GenSession => ({ id: uid('gen'), title: 'New generation', ts: Date.now(), versions: [], index: 0 });

export function useGallery(comfyUp: boolean | null) {
  const [sessions, setSessions] = useState<GenSession[]>([blank()]);
  const [activeId, setActiveId] = useState<string>(sessions[0].id);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<{ width: number; height: number; checkpoint: string; steps: number; sampler: string } | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const ref = useRef(sessions); ref.current = sessions;
  const activeRef = useRef(activeId); activeRef.current = activeId;

  // Load the saved gallery once (image data lives in IndexedDB, not localStorage).
  useEffect(() => {
    void idbGet<GenSession[]>(KEY).then((saved) => {
      if (saved?.length) {
        const list = saved.map((s) => ({ ...s, versions: s.versions.map((v) => ({ ...v, url: v.blob ? URL.createObjectURL(v.blob) : '' })).filter((v) => v.url) }));
        const fresh = blank();
        setSessions([fresh, ...list]); setActiveId(fresh.id);
      }
      setLoaded(true);
    });
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => void idbSet(KEY, sessions.filter((s) => s.versions.length).map((s) => ({ ...s, versions: s.versions.map((v) => ({ ...v, url: '' })) }))), 800);
    return () => clearTimeout(t);
  }, [sessions, loaded]);

  useEffect(() => {
    if (!busy) { setElapsed(0); return; }
    const t0 = Date.now();
    const t = setInterval(() => setElapsed((Date.now() - t0) / 1000), 250);
    return () => clearInterval(t);
  }, [busy]);

  const active = sessions.find((s) => s.id === activeId) ?? sessions[0];
  const current: GeneratedImage | undefined = active.versions[active.index];

  const patch = useCallback((id: string, fn: (s: GenSession) => GenSession) => setSessions((p) => p.map((s) => (s.id === id ? fn(s) : s))), []);
  const newSession = useCallback(() => {
    const existing = ref.current.find((s) => !s.versions.length);
    if (existing) { setActiveId(existing.id); return; }
    const s = blank(); setSessions((p) => [s, ...p]); setActiveId(s.id);
  }, []);
  const remove = useCallback((id: string) => {
    const rest = ref.current.filter((s) => s.id !== id);
    if (!rest.length) { const s = blank(); setSessions([s]); setActiveId(s.id); return; }
    setSessions(rest); if (activeRef.current === id) setActiveId(rest[0].id);
  }, []);
  const removeVersion = useCallback((id: string, vid: string) => patch(id, (s) => { const versions = s.versions.filter((v) => v.id !== vid); return { ...s, versions, index: Math.min(s.index, Math.max(0, versions.length - 1)) }; }), [patch]);

  /** Runs one ComfyUI job and files the results into the active session as new versions. */
  const run = useCallback(async (what: GeneratedImage['kind'], title: string, meta: Omit<GeneratedImage, 'id' | 'url' | 'blob' | 'seed' | 'generationTimeSec' | 'timestamp' | 'kind'>, job: (onTick: (ms: number, q: boolean) => void, signal: AbortSignal) => Promise<ComfyBatch>) => {
    const sid = activeRef.current;
    const c = new AbortController(); ctrl.current = c;
    setBusy(true); setError(null); setLabel(title);
    const id = uid('img');
    reportActivity({ id, kind: 'image', label: 'Image' });
    try {
      const r = await job((ms, q) => reportActivity({ id, kind: 'image', label: q ? 'Queued' : `${Math.floor(ms / 1000)}s` }), c.signal);
      const made: GeneratedImage[] = r.items.map((it, k) => ({ ...meta, id: `${id}-${k}`, url: it.url, blob: it.blob, seed: r.seed, generationTimeSec: r.generationTimeSec, timestamp: stamp(), kind: what }));
      patch(sid, (s) => ({
        ...s, ts: Date.now(), title: s.versions.length ? s.title : meta.prompt.slice(0, 40) || 'Untitled',
        versions: [...s.versions, ...made], index: s.versions.length,
      }));
      reportActivity({ id, kind: 'image', label: 'Image ready', done: true });
    } catch (e) {
      if (!c.signal.aborted) setError((e as Error).message);
      reportActivity({ id, kind: 'image', label: 'Image', done: true });
    } finally { setBusy(false); ctrl.current = null; }
  }, [patch]);

  const input = (prompt: string, p: ImageParams, o: { width?: number; height?: number } = {}): TxtToImageInput => {
    const d = dimensionsFor(p.aspect, p.checkpoint);
    const width = o.width ?? d.width, height = o.height ?? d.height;
    setInfo({ width, height, checkpoint: p.checkpoint, steps: p.steps, sampler: p.sampler });
    return { prompt, negativePrompt: p.negative, checkpoint: p.checkpoint, steps: p.steps, cfg: p.cfg, width, height, seed: p.seed ?? undefined, sampler: p.sampler, scheduler: p.scheduler, count: p.count, loras: p.loras?.filter((l) => l.name) };
  };
  const metaOf = (prompt: string, p: ImageParams, w: number, h: number) => ({ prompt, negativePrompt: p.negative, steps: p.steps, cfg: p.cfg, dimensions: `${w}×${h}`, checkpoint: p.checkpoint, sampler: p.sampler, loras: p.loras?.length ? p.loras.filter((l) => l.name) : undefined });

  const generate = (prompt: string, p: ImageParams, reference?: Blob) => {
    const inp = input(prompt, p);
    return run(reference ? 'img2img' : 'txt2img', 'Generating', { ...metaOf(prompt, p, inp.width, inp.height), denoise: reference ? p.denoise : undefined },
      (tick, signal) => (reference ? comfy.img2img({ ...inp, signal, onTick: tick }, reference, p.denoise) : comfy.txt2img({ ...inp, signal, onTick: tick })));
  };

  /** Same prompt, new seeds, nudged from the chosen image (img2img at moderate denoise). */
  const variation = (img: GeneratedImage, p: ImageParams) => {
    const [w, h] = img.dimensions.split('×').map(Number);
    const inp = { ...input(img.prompt, { ...p, seed: null, count: Math.min(p.count, 4), checkpoint: img.checkpoint }, { width: w, height: h }) };
    return run('variation', 'Making variations', { ...metaOf(img.prompt, p, w, h), checkpoint: img.checkpoint, denoise: 0.55 }, (tick, signal) => comfy.img2img({ ...inp, signal, onTick: tick }, img.blob!, 0.55));
  };

  const upscale = (img: GeneratedImage, factor: 2 | 4) => {
    const [w, h] = img.dimensions.split('×').map(Number);
    return run('upscale', `Upscaling ×${factor}`, { prompt: img.prompt, negativePrompt: img.negativePrompt, steps: img.steps, cfg: img.cfg, dimensions: `${w * factor}×${h * factor}`, checkpoint: img.checkpoint },
      (tick, signal) => comfy.upscale(img.blob!, factor, signal, tick).then((r) => ({ ...r, seed: img.seed })));
  };

  const inpaint = (img: GeneratedImage, maskedPng: Blob, prompt: string, p: ImageParams) => {
    const [w, h] = img.dimensions.split('×').map(Number);
    const inp = input(prompt, { ...p, checkpoint: img.checkpoint, count: 1 }, { width: w, height: h });
    return run('inpaint', 'Inpainting', { ...metaOf(prompt, p, w, h), checkpoint: img.checkpoint }, (tick, signal) => comfy.inpaint({ ...inp, signal, onTick: tick }, maskedPng));
  };

  const outpaint = (img: GeneratedImage, pad: { left: number; top: number; right: number; bottom: number }, prompt: string, p: ImageParams) => {
    const [w, h] = img.dimensions.split('×').map(Number);
    const nw = w + pad.left + pad.right, nh = h + pad.top + pad.bottom;
    const inp = input(prompt, { ...p, checkpoint: img.checkpoint, count: 1 }, { width: nw, height: nh });
    return run('outpaint', 'Extending canvas', { ...metaOf(prompt, p, nw, nh), checkpoint: img.checkpoint }, (tick, signal) => comfy.outpaint({ ...inp, signal, onTick: tick }, img.blob!, pad));
  };

  const cancel = useCallback(() => ctrl.current?.abort(), []);
  const stepVersion = (d: -1 | 1) => patch(active.id, (s) => ({ ...s, index: Math.min(s.versions.length - 1, Math.max(0, s.index + d)) }));
  const selectVersion = (i: number) => patch(active.id, (s) => ({ ...s, index: i }));

  return { sessions, active, activeId: active.id, setActiveId, current, busy, label, elapsed, error, info, comfyUp,
    newSession, remove, removeVersion, patch, generate, variation, upscale, inpaint, outpaint, cancel, stepVersion, selectVersion, setError };
}
