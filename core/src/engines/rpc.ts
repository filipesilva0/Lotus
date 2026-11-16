// The core API for the built-in engines and the Models page (session 17).
//
//   machine_info                                → OS, GPU, video memory
//   builtin_status                              → engines, jobs, chat server
//   builtin_install { engine }                  → { jobId }     (llama | sd | sherpa)
//   builtin_remove  { engine }
//   models_installed                            → { models, imageFiles, modelsDir }
//   models_install { id }                       → { jobId }     (a catalog entry, src/models/library.ts)
//   models_install_custom { source, kind, folder?, title? } → { jobId }
//   models_remove { id } · image_file_remove { folder, file }
//   job_cancel { jobId }
//   chat_ensure { model, ctx? }                 → { url }       (starts llama-server with that model)
//   chat_stop
//   comfy_link_models { root? }                 → { files }   (ComfyUI reads Lotus Studio/Models/image)
//   image_builtin { profile, prompt, … genId }  → { images: MediaRow[], … }   events { type: 'builtin-image', genId, step, total }
//   image_cancel { genId }
//   tts_builtin { voice, text, speaker?, speed? } → MediaRow (audio)
//   stt_builtin { model, path, language? }      → { text }      (path: a media file, e.g. Audio/2026-11/x.wav)

import { readFileSync, rmSync } from 'node:fs';
import type { Db } from '../db';
import { resolveMedia, saveMedia } from '../media';
import type { BuiltinId } from './assets';
import type { Builtins } from './manager';
import type { ImageFolder, ImageProfile, LoraUse } from '../../../src/models/imageProfiles';
import { settingsFor, sizeFor } from '../../../src/models/imageProfiles';
import type { ModelKind } from '../../../src/models/library';
import { comfyDesktopConfigDir, linkComfy } from './comfyLink';
import { join } from 'node:path';

type Json = Record<string, unknown>;
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const ENGINES: BuiltinId[] = ['llama', 'sd', 'sherpa'];
const KINDS: ModelKind[] = ['chat', 'image', 'voice', 'dictation'];
const FOLDERS: ImageFolder[] = ['checkpoints', 'diffusion_models', 'text_encoders', 'vae', 'loras'];

const imageRuns = new Map<string, AbortController>();

export interface ImageArgs {
  profile: ImageProfile; prompt: string; negative?: string; aspect?: string; width?: number; height?: number;
  seed?: number | null; count?: number; steps?: number; cfg?: number; sampler?: string; scheduler?: string;
  loras?: LoraUse[]; init?: string; strength?: number; genId?: string;
}

/** Runs one built-in image job and saves the images as media files. Shared with image.generate. */
export async function builtinImage(b: Builtins, db: Db, studio: string, a: ImageArgs, o: { signal?: AbortSignal; onProgress?: (step: number, total: number) => void } = {}) {
  const p = a.profile;
  if (!p || !p.family || !p.files) throw new Error('Pick an image model first.');
  const s = settingsFor(p);
  const size = a.width && a.height ? { width: a.width, height: a.height } : sizeFor(a.aspect ?? '1:1', p);
  const seed = typeof a.seed === 'number' && a.seed >= 0 ? Math.floor(a.seed) : Math.floor(Math.random() * 2 ** 31);
  let init: string | undefined;
  if (a.init) { init = resolveMedia(studio, a.init) ?? undefined; if (!init) throw new Error('The reference image is outside the Lotus Studio folder.'); }
  const t0 = Date.now();
  const files = await b.generateImage(p, {
    prompt: a.prompt, negative: a.negative, width: size.width, height: size.height, seed, count: Math.max(1, Math.min(4, a.count ?? 1)),
    steps: s.locked ? s.steps : (a.steps ?? s.steps), cfg: s.locked ? s.cfg : (a.cfg ?? s.cfg), sampler: s.locked ? s.sampler : (a.sampler ?? s.sampler), scheduler: s.locked ? s.scheduler : (a.scheduler ?? s.scheduler),
    init, strength: a.strength,
  }, { signal: o.signal, onProgress: o.onProgress, loras: a.loras });
  const images = [];
  for (const f of files) images.push(await saveMedia(db, studio, readFileSync(f), 'image/png', a.prompt.slice(0, 40) || 'image'));
  b.cleanOutputs(files);
  return { images, seed, width: size.width, height: size.height, sec: Math.round((Date.now() - t0) / 100) / 10, steps: s.locked ? s.steps : (a.steps ?? s.steps), cfg: s.locked ? s.cfg : (a.cfg ?? s.cfg) };
}

export async function builtinRpc(b: Builtins, db: Db, studio: string, method: string, a: Json, broadcast: (e: Json) => void): Promise<{ found: boolean; value?: unknown }> {
  const engine = (): BuiltinId => { const e = str(a.engine) as BuiltinId; if (!ENGINES.includes(e)) throw new Error(`Unknown engine ${a.engine}.`); return e; };
  switch (method) {
    case 'machine_info': return { found: true, value: await b.machine() };
    case 'builtin_status': return { found: true, value: b.status() };
    case 'builtin_install': return { found: true, value: { jobId: b.installEngine(engine()) } };
    case 'builtin_remove': return { found: true, value: b.removeEngine(engine()) };
    case 'models_installed': return { found: true, value: { models: b.installed(), imageFiles: b.imageFiles(), modelsDir: b.modelsDir } };
    case 'models_install': return { found: true, value: { jobId: b.installModel(str(a.id)) } };
    case 'models_install_custom': {
      const kind = str(a.kind) as ModelKind;
      if (!KINDS.includes(kind)) throw new Error('Say what kind of model it is (chat, image, voice or dictation).');
      const folder = str(a.folder) as ImageFolder;
      return { found: true, value: { jobId: b.installCustom({ source: str(a.source), kind, folder: FOLDERS.includes(folder) ? folder : undefined, title: str(a.title) || undefined }) } };
    }
    case 'models_remove': return { found: true, value: b.removeModel(str(a.id)) };
    case 'image_file_remove': return { found: true, value: b.removeImageFile(str(a.folder) as ImageFolder, str(a.file)) };
    case 'job_cancel': return { found: true, value: b.cancel(str(a.jobId)) };
    case 'chat_ensure': return { found: true, value: { url: await b.ensureChat(str(a.model), { ctx: num(a.ctx, 0) }) } };
    case 'chat_stop': return { found: true, value: b.stopChat() };
    // Lets ComfyUI read Lotus Studio/Models/image (root = ComfyUI's own folder, if known).
    case 'comfy_link_models': return { found: true, value: { files: linkComfy(join(b.modelsDir, 'image'), { root: str(a.root) || undefined, desktopConfigDir: a.desktop === false ? undefined : comfyDesktopConfigDir() }) } };
    case 'image_builtin': {
      const genId = str(a.genId) || `g${Date.now().toString(36)}`;
      const ctrl = new AbortController();
      imageRuns.set(genId, ctrl);
      try {
        const r = await builtinImage(b, db, studio, a as unknown as ImageArgs, { signal: ctrl.signal, onProgress: (step, total) => broadcast({ type: 'builtin-image', genId, step, total }) });
        return { found: true, value: r };
      } finally { imageRuns.delete(genId); }
    }
    case 'image_cancel': { imageRuns.get(str(a.genId))?.abort(); return { found: true, value: true }; }
    case 'tts_builtin': {
      const wav = await b.speak(str(a.voice), str(a.text), { speaker: num(a.speaker, 0), speed: num(a.speed, 1) });
      try { return { found: true, value: await saveMedia(db, studio, readFileSync(wav), 'audio/wav', str(a.text).slice(0, 30) || 'speech') }; }
      finally { try { rmSync(wav, { force: true }); } catch { /* temp */ } }
    }
    case 'stt_builtin': {
      const full = resolveMedia(studio, str(a.path));
      if (!full) throw new Error('That recording is outside the Lotus Studio folder.');
      const text = await b.transcribe(str(a.model), full, { language: str(a.language) || undefined });
      if (a.keep !== true) { try { rmSync(full, { force: true }); db.sql.query('DELETE FROM media WHERE path = ?').run(str(a.path)); } catch { /* keep */ } }
      return { found: true, value: { text } };
    }
    default: return { found: false };
  }
}
