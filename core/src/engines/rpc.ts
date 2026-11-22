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
//   image_builtin { profile, prompt, … dir?, refs?, genId } → { images: MediaRow[], references, dir, … }   events { type: 'builtin-image', genId, step, total }
//                                               (0.9.5: everything goes in Images/<dir>/ as Reference N and Output N)
//   image_cancel { genId }
//   tts_builtin { voice, text, speaker?, speed?, reference?, referenceText?, steps? } → MediaRow (audio)   (reference: a media path, for cloning voices)
//   stt_builtin { model, path, language?, warm? } → { text }    (path: a media file, e.g. Audio/2026-11/x.wav; warm: keep Whisper loaded)
//   stt_warm    { model, language? }             → boolean     (loads Whisper ahead of a call)
//   gsv_status  { dir }  → { folderOk, running, startedByLotus, error? }   GPT-SoVITS (optional voice engine)
//   gsv_start   { dir }  / gsv_stop {}
//   tts_gptsovits { dir, text, reference, referenceText?, language?, speed? } → MediaRow (audio)

import { existsSync, readFileSync, rmSync } from 'node:fs';
import type { Db } from '../db';
import { cleanDir, newImageFolder, resolveMedia, saveMedia } from '../media';
import type { BuiltinId } from './assets';
import type { Builtins } from './manager';
import type { ImageFolder, ImageProfile, LoraUse } from '../../../src/models/imageProfiles';
import { tagWav } from '../../../src/lib/wavTag';
import { FAMILIES, settingsFor, sizeFor } from '../../../src/models/imageProfiles';
import type { ModelKind } from '../../../src/models/library';
import { comfyDesktopConfigDir, linkComfy } from './comfyLink';
import { GptSovits } from './gptsovits';
import { join } from 'node:path';

type Json = Record<string, unknown>;
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const ENGINES: BuiltinId[] = ['llama', 'sd', 'sherpa', 'ffmpeg'];
const KINDS: ModelKind[] = ['chat', 'image', 'voice', 'dictation'];
const FOLDERS: ImageFolder[] = ['checkpoints', 'diffusion_models', 'text_encoders', 'vae', 'loras'];

const imageRuns = new Map<string, AbortController>();

export interface ImageArgs {
  profile: ImageProfile; prompt: string; negative?: string; aspect?: string; width?: number; height?: number;
  seed?: number | null; count?: number; steps?: number; cfg?: number; sampler?: string; scheduler?: string;
  loras?: LoraUse[]; init?: string; strength?: number; genId?: string;
  /** Folder under Images/ for this generation (from an earlier run); a new one is made when missing. */
  dir?: string;
  /** Reference images: a saved media path, or { data: base64, mime }. */
  refs?: (string | { data: string; mime?: string })[];
}

/** Reference images as bytes, from saved files or uploads. */
function refBytes(studio: string, refs: ImageArgs['refs']): { body: Uint8Array; mime: string }[] {
  const out: { body: Uint8Array; mime: string }[] = [];
  for (const r of (refs ?? []).slice(0, 8)) {
    if (typeof r === 'string') {
      const full = resolveMedia(studio, r);
      if (!full || !existsSync(full)) throw new Error('A reference image is missing or outside the Lotus Studio folder.');
      out.push({ body: readFileSync(full), mime: 'image/png' });
    } else if (r && typeof r.data === 'string') {
      out.push({ body: Buffer.from(r.data.replace(/^data:[^,]*,/, ''), 'base64'), mime: str(r.mime, 'image/png') });
    }
  }
  return out;
}

/** Runs one built-in image job and saves the images as media files. Shared with image.generate. */
export async function builtinImage(b: Builtins, db: Db, studio: string, a: ImageArgs, o: { signal?: AbortSignal; onProgress?: (step: number, total: number) => void } = {}) {
  const p = a.profile;
  if (!p || !p.family || !p.files) throw new Error('Pick an image model first.');
  const s = settingsFor(p);
  const size = a.width && a.height ? { width: a.width, height: a.height } : sizeFor(a.aspect ?? '1:1', p);
  const seed = typeof a.seed === 'number' && a.seed >= 0 ? Math.floor(a.seed) : Math.floor(Math.random() * 2 ** 31);
  // One folder per generation: Images/<name from the prompt>/Reference N and Output N (0.9.5).
  const want = cleanDir(a.dir);
  const dir = want && existsSync(join(studio, 'Images', want)) ? want : newImageFolder(studio, a.prompt);
  // FLUX.2 takes several reference images; other models start from the first one (image to image),
  // so only the images the model really uses are kept as references.
  const multi = !!FAMILIES[p.family]?.refImages;
  const given = [...(a.init ? [a.init] : []), ...(a.refs ?? [])];
  const references: string[] = [];
  for (const r of refBytes(studio, multi ? given : given.slice(0, 1))) {
    const path = (await saveMedia(db, studio, r.body, r.mime, 'Reference', new Date(), { dir, numbered: true, reuse: true })).path;
    if (!references.includes(path)) references.push(path);
  }
  const refFiles = references.map((r) => resolveMedia(studio, r)!);
  const init = !multi ? refFiles[0] : undefined;
  const t0 = Date.now();
  const files = await b.generateImage(p, {
    prompt: a.prompt, negative: a.negative, width: size.width, height: size.height, seed, count: Math.max(1, Math.min(4, a.count ?? 1)),
    steps: s.locked ? s.steps : (a.steps ?? s.steps), cfg: s.locked ? s.cfg : (a.cfg ?? s.cfg), sampler: s.locked ? s.sampler : (a.sampler ?? s.sampler), scheduler: s.locked ? s.scheduler : (a.scheduler ?? s.scheduler),
    init, strength: init ? a.strength : undefined, refs: multi ? refFiles : undefined,
  }, { signal: o.signal, onProgress: o.onProgress, loras: a.loras });
  const images = [];
  for (const f of files) images.push(await saveMedia(db, studio, readFileSync(f), 'image/png', 'Output', new Date(), { dir, numbered: true }));
  b.cleanOutputs(files);
  return { images, references, dir, seed, width: size.width, height: size.height, sec: Math.round((Date.now() - t0) / 100) / 10, steps: s.locked ? s.steps : (a.steps ?? s.steps), cfg: s.locked ? s.cfg : (a.cfg ?? s.cfg) };
}

/** GPT-SoVITS, when a voice uses it (0.15.0). One per core. */
let gsv: GptSovits | null = null;
export const gptSovits = (studio: string) => (gsv ??= new GptSovits({ tempDir: join(studio, 'Engines', 'GPT-SoVITS-temp') }));
/** Stops the GPT-SoVITS server Lotus started (the core is shutting down). */
export const stopGptSovits = () => gsv?.stop();

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
    case 'chat_ensure': return { found: true, value: { url: await b.ensureChat(str(a.model), { ctx: num(a.ctx, 0), auto: a.auto === true }) } };
    // The context Auto would give this model now (Settings → Chat shows it).
    case 'chat_fit': return { found: true, value: await b.chatFit(str(a.model)) };
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
      let ref: { audio: string; text?: string; steps?: number } | undefined;
      if (str(a.reference)) {
        const audio = resolveMedia(studio, str(a.reference));
        if (!audio) throw new Error('That voice\'s recording is outside the Lotus Studio folder.');
        ref = { audio, text: str(a.referenceText) || undefined, steps: a.steps === undefined ? undefined : num(a.steps, 0) || undefined };
      }
      const wav = await b.speak(str(a.voice), str(a.text), { speaker: num(a.speaker, 0), speed: num(a.speed, 1), ref });
      try { return { found: true, value: await saveMedia(db, studio, tagWav(new Uint8Array(readFileSync(wav))), 'audio/wav', str(a.text).slice(0, 30) || 'speech') }; }
      finally { try { rmSync(wav, { force: true }); } catch { /* temp */ } }
    }
    case 'stt_builtin': {
      const full = resolveMedia(studio, str(a.path));
      if (!full) throw new Error('That recording is outside the Lotus Studio folder.');
      const text = await b.transcribe(str(a.model), full, { language: str(a.language) || undefined, warm: a.warm === true });
      if (a.keep !== true) { try { rmSync(full, { force: true }); db.sql.query('DELETE FROM media WHERE path = ?').run(str(a.path)); } catch { /* keep */ } }
      return { found: true, value: { text } };
    }
    case 'gsv_status': return { found: true, value: await gptSovits(studio).status(str(a.dir)) };
    case 'gsv_start': await gptSovits(studio).start(str(a.dir)); return { found: true, value: true };
    case 'gsv_stop': gptSovits(studio).stop(); return { found: true, value: true };
    case 'tts_gptsovits': {
      const ref = resolveMedia(studio, str(a.reference));
      if (!ref) throw new Error('This voice has no recording yet. Add one in Voice → Voices.');
      const wav = await gptSovits(studio).speak({ dir: str(a.dir), text: str(a.text), refAudio: ref, refText: str(a.referenceText) || undefined, lang: str(a.language) || undefined, speed: a.speed === undefined ? undefined : num(a.speed, 1) });
      return { found: true, value: await saveMedia(db, studio, tagWav(new Uint8Array(wav)), 'audio/wav', str(a.text).slice(0, 30) || 'speech') };
    }
    case 'stt_warm': return { found: true, value: await b.warmDictation(str(a.model), str(a.language) || undefined).catch(() => false) };
    default: return { found: false };
  }
}
