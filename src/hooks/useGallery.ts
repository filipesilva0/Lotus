import { useCallback, useEffect, useRef, useState } from 'react';
import { GeneratedImage } from '../types/lotus';
import { comfy, ComfyBatch, dimensionsFor, LoraUse, TxtToImageInput } from '../services/comfyService';
import { idbGet, idbGetLocal, idbSet } from '../lib/idb';
import { loadMedia, rpc, saveMedia } from '../lib/core';
import { kv, storeMode } from '../lib/store';
import { reportActivity } from '../lib/bus';
import { uid } from '../lib/persist';
import { builtinGenerate } from '../services/builtinImages';
import { settingsFor, sizeFor, type ImageProfile } from '../models/imageProfiles';

export interface GenSession {
  id: string; title: string; ts: number; pinned?: boolean; folderId?: string;
  versions: GeneratedImage[]; index: number;
  /** This generation's folder under Lotus Studio/Images (0.9.5): Reference N and Output N files. */
  dir?: string;
}

export interface ImageParams {
  checkpoint: string; aspect: string; count: number; negative: string; cfg: number; steps: number;
  sampler: string; scheduler: string; seed: number | null; denoise: number;
  /** LoRAs to apply (optional; saved settings from older versions have none). */
  loras?: LoraUse[];
  /** Built-in engine (session 17): the image setup to use (models/imageProfiles.ts). */
  profile?: string;
}

export const DEFAULT_PARAMS: ImageParams = {
  checkpoint: '', aspect: '1:1', count: 1, negative: 'lowres, blurry, distorted, text, watermark',
  cfg: 7, steps: 28, sampler: 'euler', scheduler: 'normal', seed: null, denoise: 0.65, loras: [],
};

/** Browser-only builds (and Lotus before session 14): sessions with image blobs in IndexedDB. */
const KEY = 'gallery.v1';
/** With the core: sessions in lotus.db, each image a file in Lotus Studio/Images (`file`). */
const CORE_KEY = 'lotus.gallery.v2';

type Saved = Omit<GenSession, 'versions'> & { versions: Omit<GeneratedImage, 'url' | 'blob'>[] };
const toSaved = (list: GenSession[]): Saved[] =>
  list.filter((s) => s.versions.some((v) => v.file)).map((s) => ({ ...s, versions: s.versions.filter((v) => v.file).map(({ url: _u, blob: _b, ...v }) => v) }));

/** Number of saved images (Usage page). */
export async function countSavedImages(): Promise<number> {
  const list = storeMode() === 'core' ? kv.getJson<Saved[]>(CORE_KEY, []) : ((await idbGet<GenSession[]>(KEY)) ?? []);
  return Array.isArray(list) ? list.reduce((a, s) => a + (s.versions?.length ?? 0), 0) : 0;
}

/** Fetches saved image files back into blobs, a few at a time. Missing files are dropped. */
async function loadFiles(list: Saved[]): Promise<GenSession[]> {
  const jobs = list.flatMap((s) => s.versions.map((v) => v));
  const blobs = new Map<string, Blob>();
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < jobs.length) {
      const v = jobs[next++];
      try { blobs.set(v.id, await loadMedia(v.file!)); } catch { /* moved or deleted outside Lotus */ }
    }
  }));
  return list.map((s) => {
    const versions = s.versions.filter((v) => blobs.has(v.id)).map((v) => { const blob = blobs.get(v.id)!; return { ...v, blob, url: URL.createObjectURL(blob) }; });
    return { ...s, versions, index: Math.min(s.index, Math.max(0, versions.length - 1)) };
  }).filter((s) => s.versions.length);
}

const stamp = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const blank = (): GenSession => ({ id: uid('gen'), title: 'New generation', ts: Date.now(), versions: [], index: 0 });

export type Gallery = ReturnType<typeof useGallery>;

export function useGallery(comfyUp: boolean | null, engine: 'builtin' | 'comfyui' = 'comfyui', profiles: ImageProfile[] = []) {
  const [sessions, setSessions] = useState<GenSession[]>([blank()]);
  const [activeId, setActiveId] = useState<string>(sessions[0].id);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  /** The generation (sidebar row) the running job belongs to; its result lands there wherever you are. */
  const [busyId, setBusyId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [elapsed, setElapsed] = useState(0);
  /** Sampling progress, when the engine reports it (Lotus's own engine does; ComfyUI over HTTP doesn't). */
  const [step, setStep] = useState<{ step: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<{ width: number; height: number; checkpoint: string; steps: number; sampler: string } | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const ref = useRef(sessions); ref.current = sessions;
  const activeRef = useRef(activeId); activeRef.current = activeId;

  // Load the saved gallery once. With the core the images are files in the Lotus Studio folder;
  // a gallery saved by an older Lotus (blobs in IndexedDB) is read once and then saved as files.
  const core = storeMode() === 'core';
  // Each generation's own folder under Images/, made once when it first saves something (0.9.5).
  const dirs = useRef(new Map<string, Promise<string>>());
  const dirFor = (sid: string, name: string): Promise<string> => {
    const known = ref.current.find((x) => x.id === sid)?.dir;
    if (known) return Promise.resolve(known);
    let p = dirs.current.get(sid);
    if (!p) {
      p = rpc<{ dir: string }>('media_folder', { name }).then((r) => { setSessions((l) => l.map((x) => (x.id === sid ? { ...x, dir: r.dir } : x))); return r.dir; });
      p.catch(() => dirs.current.delete(sid));
      dirs.current.set(sid, p);
    }
    return p;
  };
  useEffect(() => {
    const show = (list: GenSession[]) => {
      if (list.length) { const fresh = blank(); setSessions([fresh, ...list]); setActiveId(fresh.id); }
      setLoaded(true);
    };
    const fromBlobs = (saved: GenSession[] | undefined) =>
      (saved ?? []).map((s) => ({ ...s, versions: s.versions.map((v) => ({ ...v, url: v.blob ? URL.createObjectURL(v.blob) : '' })).filter((v) => v.url) })).filter((s) => s.versions.length);
    if (!core) { void idbGet<GenSession[]>(KEY).then((saved) => show(fromBlobs(saved))); return; }
    const saved = kv.getJson<Saved[] | null>(CORE_KEY, null);
    if (saved) void loadFiles(saved).then(show);
    else void idbGetLocal<GenSession[]>(KEY).then((legacy) => show(fromBlobs(legacy)));
  }, [core]);

  // Images the agent made from a chat (core tool image.generate) arrive as a change to the saved list.
  // They are kept in `external` until their files are loaded, so a save meanwhile doesn't drop them.
  const external = useRef<Saved[]>([]);
  useEffect(() => {
    if (!core) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== CORE_KEY || !e.newValue) return;
      let list: Saved[] = [];
      try { list = JSON.parse(e.newValue) as Saved[]; } catch { return; }
      const known = new Set([...ref.current.map((x) => x.id), ...external.current.map((x) => x.id)]);
      const fresh = list.filter((x) => !known.has(x.id));
      if (!fresh.length) return;
      external.current = [...fresh, ...external.current];
      void loadFiles(fresh).then((loadedList) => {
        external.current = external.current.filter((x) => !fresh.some((f) => f.id === x.id));
        if (!loadedList.length) return;
        setSessions((p) => {
          const blankFirst = p[0] && !p[0].versions.length ? [p[0]] : [];
          return [...blankFirst, ...loadedList, ...p.slice(blankFirst.length)];
        });
      });
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [core]);

  // Save. With the core, new images are written to disk first (once each), then the list.
  const [saveError, setSaveError] = useState<string | null>(null);
  const uploading = useRef(new Set<string>());
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      if (!core) {
        void idbSet(KEY, sessions.filter((s) => s.versions.length).map((s) => ({ ...s, versions: s.versions.map((v) => ({ ...v, url: '' })) })));
        return;
      }
      const unsaved = sessions.flatMap((s) => s.versions.filter((v) => v.blob && !v.file && !uploading.current.has(v.id)).map((v) => ({ s, v })));
      kv.setJson(CORE_KEY, [...external.current, ...toSaved(sessions)]);
      if (!unsaved.length) return;
      unsaved.forEach(({ v }) => uploading.current.add(v.id));
      void (async () => {
        const files = new Map<string, string>();
        for (const { s, v } of unsaved) {
          try {
            const dir = await dirFor(s.id, v.prompt || s.title || 'image');
            files.set(v.id, (await saveMedia(v.blob!, 'Output', { dir, numbered: true })).path);
          }
          catch (e) { setSaveError(`An image could not be saved to the Lotus Studio folder: ${(e as Error).message}`); }
          finally { uploading.current.delete(v.id); }
        }
        if (files.size) {
          setSaveError(null);
          // Updating state saves the list on the next pass.
          setSessions((p) => p.map((s) => ({ ...s, versions: s.versions.map((v) => (files.has(v.id) ? { ...v, file: files.get(v.id) } : v)) })));
        }
      })();
    }, 800);
    return () => clearTimeout(t);
  }, [sessions, loaded, core]);

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
  const run = useCallback(async (what: GeneratedImage['kind'], title: string, meta: Omit<GeneratedImage, 'id' | 'url' | 'blob' | 'seed' | 'generationTimeSec' | 'timestamp' | 'kind'>, job: (onTick: (ms: number, q: boolean) => void, signal: AbortSignal, onStep: (step: number, total: number) => void) => Promise<Omit<ComfyBatch, 'items'> & { items: { blob: Blob; url: string; file?: string }[]; dir?: string }>) => {
    const sid = activeRef.current;
    const c = new AbortController(); ctrl.current = c;
    setBusy(true); setBusyId(sid); setError(null); setLabel(title); setStep(null);
    const id = uid('img');
    reportActivity({ id, kind: 'image', label: 'Image' });
    try {
      const r = await job((ms, q) => reportActivity({ id, kind: 'image', label: q ? 'Queued' : `${Math.floor(ms / 1000)}s` }), c.signal,
        (step, total) => {
          // sd-cli also draws bars while it loads the model (hundreds of tensors); only sampling steps count.
          if (total > 200) return;
          setStep({ step, total }); reportActivity({ id, kind: 'image', label: `${step}/${total}`, progress: step / total }); });
      // Images from the built-in engine are already files in Lotus Studio/Images (`file`), so they are not saved twice.
      const made: GeneratedImage[] = r.items.map((it, k) => ({ ...meta, id: `${id}-${k}`, url: it.url, blob: it.blob, file: it.file, seed: r.seed, generationTimeSec: r.generationTimeSec, timestamp: stamp(), kind: what }));
      patch(sid, (s) => ({
        ...s, ts: Date.now(), title: s.versions.length ? s.title : meta.prompt.slice(0, 40) || 'Untitled', dir: r.dir ?? s.dir,
        versions: [...s.versions, ...made], index: s.versions.length,
      }));
      // If that row was a blank "New generation" that got hidden meanwhile, make sure it is still listed.
      setSessions((p) => (p.some((s) => s.id === sid) ? p : [{ ...blank(), id: sid, title: meta.prompt.slice(0, 40) || 'Untitled', versions: made, index: 0 }, ...p]));
      reportActivity({ id, kind: 'image', label: 'Image ready', done: true });
    } catch (e) {
      if (!c.signal.aborted) setError((e as Error).message);
      reportActivity({ id, kind: 'image', label: 'Image', done: true });
    } finally { setBusy(false); setBusyId(null); setStep(null); ctrl.current = null; }
  }, [patch]);

  const input = (prompt: string, p: ImageParams, o: { width?: number; height?: number } = {}): TxtToImageInput => {
    const d = dimensionsFor(p.aspect, p.checkpoint);
    const width = o.width ?? d.width, height = o.height ?? d.height;
    setInfo({ width, height, checkpoint: p.checkpoint, steps: p.steps, sampler: p.sampler });
    return { prompt, negativePrompt: p.negative, checkpoint: p.checkpoint, steps: p.steps, cfg: p.cfg, width, height, seed: p.seed ?? undefined, sampler: p.sampler, scheduler: p.scheduler, count: p.count, loras: p.loras?.filter((l) => l.name) };
  };
  const metaOf = (prompt: string, p: ImageParams, w: number, h: number) => ({ prompt, negativePrompt: p.negative, steps: p.steps, cfg: p.cfg, dimensions: `${w}×${h}`, checkpoint: p.checkpoint, sampler: p.sampler, loras: p.loras?.length ? p.loras.filter((l) => l.name) : undefined });

  /** The image setup a run uses with the built-in engine (the picked one, else the first complete one). */
  const profileFor = (p: ImageParams) => profiles.find((x) => x.id === p.profile) ?? profiles[0];
  const builtinRun = (what: GeneratedImage['kind'], title: string, prompt: string, p: ImageParams, o: { reference?: Blob | string; references?: Blob[]; strength?: number; width?: number; height?: number } = {}) => {
    const prof = profileFor(p);
    if (!prof) { setError('No image model is ready. Get one in Settings → Models, or finish its setup there.'); return Promise.resolve(); }
    const st = settingsFor(prof);
    const size = o.width && o.height ? { width: o.width, height: o.height } : sizeFor(p.aspect, prof);
    const steps = st.locked ? st.steps : p.steps, cfg = st.locked ? st.cfg : p.cfg;
    setInfo({ width: size.width, height: size.height, checkpoint: prof.name, steps, sampler: st.locked ? st.sampler : p.sampler });
    return run(what, title, { prompt, negativePrompt: p.negative, steps, cfg, dimensions: `${size.width}×${size.height}`, checkpoint: prof.name, profile: prof.id, sampler: p.sampler, loras: p.loras?.length ? p.loras.filter((l) => l.name) : undefined, denoise: o.reference || o.references?.length ? (o.strength ?? p.denoise) : undefined },
      (_tick, signal, onStep) => builtinGenerate(prof, { prompt, negative: p.negative, ...size, seed: p.seed ?? undefined, count: p.count, steps, cfg, sampler: p.sampler, scheduler: p.scheduler, loras: p.loras?.filter((l) => l.name), reference: o.reference, references: o.references, strength: o.strength, dir: ref.current.find((x) => x.id === activeRef.current)?.dir }, { signal, onStep }));
  };
  const needsComfy = (what: string) => { setError(`${what} needs ComfyUI for now. Switch Images to ComfyUI in Settings → Engines, or use Variations.`); return Promise.resolve(); };

  /**
   * Makes images from the prompt. With reference images: FLUX.2 (built-in engine) uses all of them;
   * other models start from the first one (image to image). They are kept in the generation's folder.
   */
  const generate = (prompt: string, p: ImageParams, references: Blob[] = []) => {
    const reference = references[0];
    if (engine === 'builtin') return builtinRun(reference ? 'img2img' : 'txt2img', 'Generating', prompt, p, { references, strength: reference ? p.denoise : undefined });
    if (reference && core) {
      const sid = activeRef.current;
      void dirFor(sid, prompt).then((dir) => saveMedia(reference, 'Reference', { dir, numbered: true, reuse: true })).catch(() => undefined);
    }
    const inp = input(prompt, p);
    return run(reference ? 'img2img' : 'txt2img', 'Generating', { ...metaOf(prompt, p, inp.width, inp.height), denoise: reference ? p.denoise : undefined },
      (tick, signal) => (reference ? comfy.img2img({ ...inp, signal, onTick: tick }, reference, p.denoise) : comfy.txt2img({ ...inp, signal, onTick: tick })));
  };

  /** Same prompt, new seeds, nudged from the chosen image (img2img at moderate denoise). */
  const variation = (img: GeneratedImage, p: ImageParams) => {
    const [w, h] = img.dimensions.split('×').map(Number);
    if (engine === 'builtin') return builtinRun('variation', 'Making variations', img.prompt, { ...p, seed: null, count: Math.min(p.count, 4), profile: img.profile ?? p.profile }, { reference: img.file ?? img.blob, strength: 0.55, width: w, height: h });
    const inp = { ...input(img.prompt, { ...p, seed: null, count: Math.min(p.count, 4), checkpoint: img.checkpoint }, { width: w, height: h }) };
    return run('variation', 'Making variations', { ...metaOf(img.prompt, p, w, h), checkpoint: img.checkpoint, denoise: 0.55 }, (tick, signal) => comfy.img2img({ ...inp, signal, onTick: tick }, img.blob!, 0.55));
  };

  const upscale = (img: GeneratedImage, factor: 2 | 4) => {
    if (engine === 'builtin') return needsComfy('Upscaling');
    const [w, h] = img.dimensions.split('×').map(Number);
    return run('upscale', `Upscaling ×${factor}`, { prompt: img.prompt, negativePrompt: img.negativePrompt, steps: img.steps, cfg: img.cfg, dimensions: `${w * factor}×${h * factor}`, checkpoint: img.checkpoint },
      (tick, signal) => comfy.upscale(img.blob!, factor, signal, tick).then((r) => ({ ...r, seed: img.seed })));
  };

  const inpaint = (img: GeneratedImage, maskedPng: Blob, prompt: string, p: ImageParams) => {
    if (engine === 'builtin') return needsComfy('Inpainting');
    const [w, h] = img.dimensions.split('×').map(Number);
    const inp = input(prompt, { ...p, checkpoint: img.checkpoint, count: 1 }, { width: w, height: h });
    return run('inpaint', 'Inpainting', { ...metaOf(prompt, p, w, h), checkpoint: img.checkpoint }, (tick, signal) => comfy.inpaint({ ...inp, signal, onTick: tick }, maskedPng));
  };

  const outpaint = (img: GeneratedImage, pad: { left: number; top: number; right: number; bottom: number }, prompt: string, p: ImageParams) => {
    if (engine === 'builtin') return needsComfy('Extending the canvas');
    const [w, h] = img.dimensions.split('×').map(Number);
    const nw = w + pad.left + pad.right, nh = h + pad.top + pad.bottom;
    const inp = input(prompt, { ...p, checkpoint: img.checkpoint, count: 1 }, { width: nw, height: nh });
    return run('outpaint', 'Extending canvas', { ...metaOf(prompt, p, nw, nh), checkpoint: img.checkpoint }, (tick, signal) => comfy.outpaint({ ...inp, signal, onTick: tick }, img.blob!, pad));
  };

  const cancel = useCallback(() => ctrl.current?.abort(), []);
  const stepVersion = (d: -1 | 1) => patch(active.id, (s) => ({ ...s, index: Math.min(s.versions.length - 1, Math.max(0, s.index + d)) }));
  const selectVersion = (i: number) => patch(active.id, (s) => ({ ...s, index: i }));

  return { sessions, active, activeId: active.id, setActiveId, current, busy, busyId, label, elapsed, step, error: error ?? saveError, info, comfyUp, engine,
    newSession, remove, removeVersion, patch, generate, variation, upscale, inpaint, outpaint, cancel, stepVersion, selectVersion, setError };
}
