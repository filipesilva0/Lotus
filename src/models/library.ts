// One model catalog for every kind of model Lotus can download (session 17). It replaces the two
// lists Lotus had (setup/catalog.ts picks for the first-run guide and models/catalog.ts for the
// Models page) as the source the Models page and the guide read; setup/catalog.ts keeps the engine
// installers and stays the source of the ComfyUI files and Voicebox name patterns used here.
//
// Every entry says how to get it for each engine that can run it:
//   built in   files Lotus downloads itself into Lotus Studio/Models (llama.cpp, stable-diffusion.cpp, sherpa-onnx)
//   ollama     a tag Ollama pulls
//   comfyui    the same image files, which ComfyUI reads from Lotus Studio/Models/image when Lotus starts it
//   voicebox   a pattern matched against Voicebox's own model list
//
// Pure: shared with the core (which downloads the files) and tested in handover/verification/s17-tests.ts.

import { CHAT_PICKS, IMAGE_PICKS, VOICE_PICKS, DICTATION_PICK, type Tier, type ImagePick } from '../setup/catalog';
import type { ImageFamily, ImageFolder, ImageProfile, Slot } from './imageProfiles';

export type ModelKind = 'chat' | 'image' | 'voice' | 'dictation';
export type { Tier };

/** A file to fetch. `path` is relative to Lotus Studio/Models and uses forward slashes. */
export interface LibFile { url: string; path: string; gb: number; /** Unpack this .tar.bz2/.tar.gz/.zip into `path` (a folder). */ archive?: boolean }

/**
 * A GGUF chat model on Hugging Face. The exact file names are read from the repo when the download
 * starts (`<anything>-<quant>.gguf`, and `mmproj-<mmproj>.gguf` for models that read images), so a
 * renamed file in the repo doesn't break the download.
 */
export interface HfGguf { repo: string; quant: string; mmproj?: string }

export interface VoiceSpec {
  engine: 'kokoro' | 'piper' | 'whisper';
  /** Speakers in a TTS model (Kokoro has many voices, Piper one or a few). */
  speakers?: { id: number; name: string }[];
  languages: string[];
}

export interface LibEntry {
  id: string;
  kind: ModelKind;
  title: string;
  maker: string;
  licence: string;
  blurb: string;
  tier?: Tier;
  tags: string[];
  /** Video memory needed to run it well (GB). 0 = runs on the processor. */
  vramGb: number;
  diskGb: number;
  builtin?: { gguf?: HfGguf; files?: LibFile[] };
  ollama?: string;
  /** Image models: the setup Lotus creates when it is installed. */
  image?: { family: ImageFamily; files: Partial<Record<Slot, string>> };
  voice?: VoiceSpec;
  /** Voicebox: pattern for its own model names. */
  voicebox?: RegExp;
  /** Can call tools well (tested with Lotus's real tasks). */
  tools?: boolean;
  vision?: boolean;
}

// ── Chat ───────────────────────────────────────────────────────────────────

const chat = (e: Omit<LibEntry, 'kind'>): LibEntry => ({ ...e, kind: 'chat' });
const pick = (id: string) => CHAT_PICKS.find((p) => p.id === id);

export const CHAT_MODELS: LibEntry[] = [
  chat({ id: 'qwen3.5-4b', tier: 'quick', title: 'Qwen 3.5 4B', maker: 'Alibaba', licence: 'Apache-2.0', tags: ['Small', 'Vision'], vision: true,
    blurb: pick('qwen3.5:4b')?.blurb ?? 'Quick replies; reads screenshots and photos.', vramGb: 5, diskGb: 3.4,
    builtin: { gguf: { repo: 'unsloth/Qwen3.5-4B-GGUF', quant: 'Q4_K_M', mmproj: 'F16' } }, ollama: 'qwen3.5:4b' }),
  chat({ id: 'nemotron-3-nano-4b', tier: 'quick', title: 'Nemotron 3 Nano 4B', maker: 'NVIDIA', licence: 'NVIDIA Open Model', tags: ['Small', 'Tools'], tools: true,
    blurb: 'Fast and light with a long memory. Passed 26 of Lotus\'s 31 real tasks in about two minutes.', vramGb: 4, diskGb: 2.8,
    builtin: { gguf: { repo: 'unsloth/NVIDIA-Nemotron-3-Nano-4B-GGUF', quant: 'Q4_K_M' } }, ollama: 'nemotron-3-nano:4b' }),
  chat({ id: 'qwen3-8b', tier: 'balanced', title: 'Qwen 3 8B', maker: 'Alibaba', licence: 'Apache-2.0', tags: ['Tools', 'Reasoning'], tools: true,
    blurb: 'The best tool user Lotus has tested on an 8 GB GPU: 30 of 31 real tasks.', vramGb: 6.5, diskGb: 5,
    builtin: { gguf: { repo: 'unsloth/Qwen3-8B-GGUF', quant: 'Q4_K_M' } }, ollama: 'qwen3:8b' }),
  chat({ id: 'gemma-4-12b', tier: 'balanced', title: 'Gemma 4 12B', maker: 'Google', licence: 'Gemma terms', tags: ['Vision', 'Tools'], vision: true, tools: true,
    blurb: pick('gemma4:12b')?.blurb ?? 'Strong all-rounder with vision and tool use.', vramGb: 10, diskGb: 7.3,
    builtin: { gguf: { repo: 'unsloth/gemma-4-12b-it-GGUF', quant: 'Q4_K_M', mmproj: 'F16' } }, ollama: 'gemma4:12b' }),
  chat({ id: 'qwen3.5-27b', tier: 'best', title: 'Qwen 3.5 27B', maker: 'Alibaba', licence: 'Apache-2.0', tags: ['Vision', 'Reasoning', 'Tools'], vision: true, tools: true,
    blurb: pick('qwen3.5:27b')?.blurb ?? 'Top open model for reasoning and writing.', vramGb: 20, diskGb: 17.7,
    builtin: { gguf: { repo: 'unsloth/Qwen3.5-27B-GGUF', quant: 'Q4_K_M', mmproj: 'F16' } }, ollama: 'qwen3.5:27b' }),
  chat({ id: 'qwen2.5-coder-7b', title: 'Qwen 2.5 Coder 7B', maker: 'Alibaba', licence: 'Apache-2.0', tags: ['Coding'],
    blurb: 'Tuned for writing and reviewing code.', vramGb: 6, diskGb: 4.7,
    builtin: { gguf: { repo: 'unsloth/Qwen2.5-Coder-7B-Instruct-GGUF', quant: 'Q4_K_M' } }, ollama: 'qwen2.5-coder:7b' }),
  chat({ id: 'deepseek-r1-8b', title: 'DeepSeek-R1 8B', maker: 'DeepSeek', licence: 'MIT', tags: ['Reasoning'],
    blurb: 'Shows its reasoning before answering.', vramGb: 6.5, diskGb: 5,
    builtin: { gguf: { repo: 'unsloth/DeepSeek-R1-0528-Qwen3-8B-GGUF', quant: 'Q4_K_M' } }, ollama: 'deepseek-r1:8b' }),
  chat({ id: 'llama3.2-3b', title: 'Llama 3.2 3B', maker: 'Meta', licence: 'Llama 3.2 licence', tags: ['Small'],
    blurb: 'Compact and quick on modest hardware. Picks the wrong tool often (22 of 31 real tasks).', vramGb: 3, diskGb: 2,
    builtin: { gguf: { repo: 'unsloth/Llama-3.2-3B-Instruct-GGUF', quant: 'Q4_K_M' } }, ollama: 'llama3.2:3b' }),
];

// ── Images ─────────────────────────────────────────────────────────────────

const imgPath = (folder: ImageFolder, file: string) => `image/${folder}/${file}`;
const fromPick = (p: ImagePick, family: ImageFamily): LibEntry => ({
  id: p.id, kind: 'image', tier: p.tier, title: p.title, maker: p.maker, licence: p.licence, blurb: p.blurb, tags: [], vramGb: p.vramGb, diskGb: p.diskGb,
  builtin: { files: p.files.map((f) => ({ url: f.url, path: imgPath(f.folder, f.fileName), gb: f.gb })) },
  image: { family, files: { model: p.recipe.unet, llm: p.recipe.clip, vae: p.recipe.vae } },
});
const FAMILY_OF: Record<string, ImageFamily> = { 'flux2-klein-4b': 'flux2', 'z-image-turbo': 'zimage', 'qwen-image': 'qwen-image' };

const HF = (repo: string, file: string) => `https://huggingface.co/${repo}/resolve/main/${file}`;

export const IMAGE_MODELS: LibEntry[] = [
  ...IMAGE_PICKS.map((p) => fromPick(p, FAMILY_OF[p.id])),
  { id: 'sdxl-base', kind: 'image', tier: 'balanced', title: 'Stable Diffusion XL', maker: 'Stability AI', licence: 'CreativeML Open RAIL++-M', tags: ['Classic'], vramGb: 7, diskGb: 7.3,
    blurb: 'The classic 1024 px model most LoRAs are made for. Comes with the fixed SDXL VAE.',
    builtin: { files: [
      { url: HF('stabilityai/stable-diffusion-xl-base-1.0', 'sd_xl_base_1.0.safetensors'), path: imgPath('checkpoints', 'sd_xl_base_1.0.safetensors'), gb: 6.9 },
      { url: HF('madebyollin/sdxl-vae-fp16-fix', 'sdxl.vae.safetensors'), path: imgPath('vae', 'sdxl.vae.safetensors'), gb: 0.3 },
    ] },
    image: { family: 'sdxl', files: { model: 'sd_xl_base_1.0.safetensors', vae: 'sdxl.vae.safetensors' } } },
  { id: 'sd15', kind: 'image', tier: 'quick', title: 'Stable Diffusion 1.5', maker: 'RunwayML', licence: 'CreativeML Open RAIL-M', tags: ['Classic', 'Small'], vramGb: 4, diskGb: 4.4,
    blurb: 'Small and fast 512 px model with thousands of add-ons. Comes with the MSE VAE.',
    builtin: { files: [
      { url: HF('stable-diffusion-v1-5/stable-diffusion-v1-5', 'v1-5-pruned-emaonly.safetensors'), path: imgPath('checkpoints', 'v1-5-pruned-emaonly.safetensors'), gb: 4.3 },
      { url: HF('stabilityai/sd-vae-ft-mse-original', 'vae-ft-mse-840000-ema-pruned.safetensors'), path: imgPath('vae', 'vae-ft-mse-840000-ema-pruned.safetensors'), gb: 0.3 },
    ] },
    image: { family: 'sd15', files: { model: 'v1-5-pruned-emaonly.safetensors', vae: 'vae-ft-mse-840000-ema-pruned.safetensors' } } },
];

// ── Voice ──────────────────────────────────────────────────────────────────

const SHERPA = (tag: 'tts-models' | 'asr-models', file: string) => `https://github.com/k2-fsa/sherpa-onnx/releases/download/${tag}/${file}`;
const voicePick = (id: string) => [...VOICE_PICKS, DICTATION_PICK].find((p) => p.id === id);
const KOKORO_EN = ['af_alloy', 'af_aoede', 'af_bella', 'af_heart', 'af_jessica', 'af_kore', 'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky', 'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael', 'am_onyx', 'am_puck', 'am_santa', 'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily', 'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis'];

export const VOICE_MODELS: LibEntry[] = [
  { id: 'kokoro', kind: 'voice', tier: 'balanced', title: 'Kokoro', maker: 'hexgrad', licence: 'Apache-2.0', tags: ['Many voices'], vramGb: 0, diskGb: 0.35,
    blurb: voicePick('kokoro')?.blurb ?? 'Natural voices, fast even without a GPU.',
    builtin: { files: [{ url: SHERPA('tts-models', 'kokoro-en-v0_19.tar.bz2'), path: 'voice/kokoro', gb: 0.33, archive: true }] },
    voice: { engine: 'kokoro', languages: ['en'], speakers: KOKORO_EN.map((name, id) => ({ id, name })) }, voicebox: voicePick('kokoro')?.match },
  { id: 'piper-en-us-lessac', kind: 'voice', tier: 'quick', title: 'Piper · Lessac (US English)', maker: 'Rhasspy', licence: 'MIT', tags: ['Tiny'], vramGb: 0, diskGb: 0.07,
    blurb: 'A clear, tiny voice that speaks instantly on any computer.',
    builtin: { files: [{ url: SHERPA('tts-models', 'vits-piper-en_US-lessac-medium.tar.bz2'), path: 'voice/piper-en-us-lessac', gb: 0.07, archive: true }] },
    voice: { engine: 'piper', languages: ['en'] } },
  { id: 'piper-en-gb-alba', kind: 'voice', title: 'Piper · Alba (British English)', maker: 'Rhasspy', licence: 'MIT', tags: ['Tiny'], vramGb: 0, diskGb: 0.07,
    blurb: 'A tiny British English voice.',
    builtin: { files: [{ url: SHERPA('tts-models', 'vits-piper-en_GB-alba-medium.tar.bz2'), path: 'voice/piper-en-gb-alba', gb: 0.07, archive: true }] },
    voice: { engine: 'piper', languages: ['en'] } },
  { id: 'piper-pt-pt-tugao', kind: 'voice', title: 'Piper · Tugão (European Portuguese)', maker: 'Rhasspy', licence: 'MIT', tags: ['Tiny'], vramGb: 0, diskGb: 0.07,
    blurb: 'A tiny voice for Portuguese from Portugal.',
    builtin: { files: [{ url: SHERPA('tts-models', 'vits-piper-pt_PT-tugao-medium.tar.bz2'), path: 'voice/piper-pt-pt-tugao', gb: 0.07, archive: true }] },
    voice: { engine: 'piper', languages: ['pt'] } },
  { id: 'piper-pt-br-faber', kind: 'voice', title: 'Piper · Faber (Brazilian Portuguese)', maker: 'Rhasspy', licence: 'MIT', tags: ['Tiny'], vramGb: 0, diskGb: 0.07,
    blurb: 'A tiny voice for Brazilian Portuguese.',
    builtin: { files: [{ url: SHERPA('tts-models', 'vits-piper-pt_BR-faber-medium.tar.bz2'), path: 'voice/piper-pt-br-faber', gb: 0.07, archive: true }] },
    voice: { engine: 'piper', languages: ['pt'] } },
  // Voicebox-only voices (cloning) stay listed so the page shows every option in one place.
  ...VOICE_PICKS.filter((p) => p.id !== 'kokoro').map((p): LibEntry => ({ id: p.id, kind: 'voice', tier: p.tier, title: p.title, maker: p.maker, licence: p.licence, blurb: p.blurb, tags: p.clones ? ['Cloning'] : [], vramGb: p.vramGb, diskGb: p.diskGb, voicebox: p.match })),
];

export const DICTATION_MODELS: LibEntry[] = [
  { id: 'whisper-turbo', kind: 'dictation', tier: 'balanced', title: 'Whisper Turbo', maker: 'OpenAI', licence: 'MIT', tags: ['99 languages'], vramGb: 0, diskGb: 1.0,
    blurb: voicePick('whisper-turbo')?.blurb ?? 'Dictation and transcription in many languages.',
    builtin: { files: [{ url: SHERPA('asr-models', 'sherpa-onnx-whisper-turbo.tar.bz2'), path: 'voice/whisper-turbo', gb: 1.0, archive: true }] },
    voice: { engine: 'whisper', languages: ['multi'] }, voicebox: voicePick('whisper-turbo')?.match },
  { id: 'whisper-small', kind: 'dictation', tier: 'quick', title: 'Whisper Small', maker: 'OpenAI', licence: 'MIT', tags: ['99 languages'], vramGb: 0, diskGb: 0.36,
    blurb: 'Lighter dictation that still understands Portuguese, Spanish and many more.',
    builtin: { files: [{ url: SHERPA('asr-models', 'sherpa-onnx-whisper-small.tar.bz2'), path: 'voice/whisper-small', gb: 0.36, archive: true }] },
    voice: { engine: 'whisper', languages: ['multi'] } },
  { id: 'whisper-base-en', kind: 'dictation', title: 'Whisper Base (English)', maker: 'OpenAI', licence: 'MIT', tags: ['English', 'Tiny'], vramGb: 0, diskGb: 0.16,
    blurb: 'Very small and quick, English only.',
    builtin: { files: [{ url: SHERPA('asr-models', 'sherpa-onnx-whisper-base.en.tar.bz2'), path: 'voice/whisper-base-en', gb: 0.16, archive: true }] },
    voice: { engine: 'whisper', languages: ['en'] } },
];

export const LIBRARY: LibEntry[] = [...CHAT_MODELS, ...IMAGE_MODELS, ...VOICE_MODELS, ...DICTATION_MODELS];
export const entryById = (id: string) => LIBRARY.find((e) => e.id === id);

export const KIND_LABEL: Record<ModelKind, string> = { chat: 'Chat', image: 'Images', voice: 'Voice', dictation: 'Dictation' };

// ── Fit ───────────────────────────────────────────────────────────────────

export type Fit = 'fits' | 'tight' | 'too-big' | 'unknown';

/**
 * Does an entry fit this computer? `vramGb` is the GPU's memory (0/undefined = no GPU or unknown).
 * On Apple Silicon memory is shared, so pass the unified memory and Lotus keeps a quarter for macOS.
 * Models that run on the processor (voice, dictation) always fit.
 */
export function fitOf(e: Pick<LibEntry, 'vramGb'>, vramGb: number | undefined, unified = false): Fit {
  if (e.vramGb <= 0.5) return 'fits';
  if (!vramGb || vramGb <= 0) return e.vramGb <= 2 ? 'fits' : 'unknown';
  const usable = unified ? vramGb * 0.75 : vramGb;
  if (e.vramGb <= usable * 0.9) return 'fits';
  if (e.vramGb <= usable * 1.25) return 'tight';
  return 'too-big';
}

export const FIT_LABEL: Record<Fit, string> = { fits: 'Fits this computer', tight: 'Tight fit, runs slower', 'too-big': 'Too big for this computer', unknown: 'Slow without a GPU' };

/** The entry to suggest for a kind on this computer: the best tier that fits, else the smallest. */
export function suggest(kind: ModelKind, vramGb: number | undefined, unified = false, engine: 'builtin' | 'ollama' | 'comfyui' | 'voicebox' = 'builtin'): LibEntry | undefined {
  const usable = LIBRARY.filter((e) => e.kind === kind && e.tier && availableOn(e, engine));
  for (const t of ['best', 'balanced', 'quick'] as Tier[]) {
    const hit = usable.filter((e) => e.tier === t).sort((a, b) => Number(!!b.tools) - Number(!!a.tools)).find((e) => fitOf(e, vramGb, unified) === 'fits');
    if (hit) return hit;
  }
  return [...usable].sort((a, b) => a.vramGb - b.vramGb)[0];
}

/** Can this entry be installed for that engine? */
export function availableOn(e: LibEntry, engine: 'builtin' | 'ollama' | 'comfyui' | 'voicebox'): boolean {
  if (engine === 'builtin') return !!e.builtin;
  if (engine === 'ollama') return !!e.ollama;
  if (engine === 'comfyui') return e.kind === 'image' && !!e.builtin?.files;
  return !!e.voicebox;
}

/** The setup Lotus creates for an installed catalog image model. */
export function profileForEntry(e: LibEntry): ImageProfile | undefined {
  if (!e.image) return undefined;
  return { id: `cat-${e.id}`, name: e.title, family: e.image.family, files: { ...e.image.files }, catalogId: e.id };
}

/** Files to fetch for a set of entries, without fetching a shared file (qwen_3_4b, ae) twice. */
export function filesFor(entries: LibEntry[]): LibFile[] {
  const seen = new Set<string>();
  const out: LibFile[] = [];
  for (const e of entries) for (const f of e.builtin?.files ?? []) if (!seen.has(f.path)) { seen.add(f.path); out.push(f); }
  return out;
}

/** Download size in GB for a selection (shared files counted once). */
export function downloadGb(entries: LibEntry[]): number {
  const files = filesFor(entries).reduce((s, f) => s + f.gb, 0);
  const gguf = entries.filter((e) => e.builtin?.gguf).reduce((s, e) => s + e.diskGb, 0);
  return Math.round((files + gguf) * 10) / 10;
}

// ── Custom models ──────────────────────────────────────────────────────────

/**
 * Reads what the user pasted to add a model that isn't in the catalog:
 *  - a Hugging Face file link (…/resolve/main/x.gguf or .safetensors)
 *  - a Hugging Face GGUF repo, "owner/name" or "owner/name:Q5_K_M"
 *  - any other https link to a model file
 */
export type CustomSource =
  | { type: 'hf-gguf'; repo: string; quant: string }
  | { type: 'file'; url: string; fileName: string };

export function parseCustomSource(raw: string): CustomSource | null {
  const s = raw.trim();
  if (!s) return null;
  const repo = /^(?:https?:\/\/huggingface\.co\/)?([A-Za-z0-9][\w.-]*\/[\w.-]+?)(?::([A-Za-z0-9_]+))?\/?$/.exec(s);
  if (repo && !/\.(gguf|safetensors|ckpt|pt|bin|onnx)$/i.test(repo[1]) && !/^https?:\/\/(?!huggingface\.co)/i.test(s)) {
    return { type: 'hf-gguf', repo: repo[1], quant: (repo[2] ?? 'Q4_K_M').toUpperCase() };
  }
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  if (u.hostname === 'huggingface.co') u.pathname = u.pathname.replace('/blob/', '/resolve/');
  const fileName = decodeURIComponent(u.pathname.split('/').pop() ?? '');
  if (!/^[^\\/:*?"<>|]+\.(gguf|safetensors|ckpt|pt|pth|bin|onnx)$/i.test(fileName)) return null;
  return { type: 'file', url: u.toString(), fileName };
}

/** Picks the files of a GGUF repo for a quantisation from its file list (Hugging Face tree API). */
export function pickGguf(files: { path: string; size?: number }[], quant: string, mmproj?: string): { model?: { path: string; size?: number }; mmproj?: { path: string; size?: number } } {
  const q = quant.toUpperCase();
  const ggufs = files.filter((f) => /\.gguf$/i.test(f.path) && !/(^|\/)mmproj/i.test(f.path) && !/(^|\/)mtp-/i.test(f.path));
  // Exact "-Q4_K_M.gguf" first, then any file containing the quant, then (one-file repos) the only one.
  const model = ggufs.find((f) => new RegExp(`[-_.]${q}\\.gguf$`, 'i').test(f.path) && !/-UD-/i.test(f.path))
    ?? ggufs.find((f) => f.path.toUpperCase().includes(q) && !/0000[2-9]-of-/.test(f.path))
    ?? (ggufs.length === 1 ? ggufs[0] : undefined);
  const proj = mmproj ? files.find((f) => new RegExp(`(^|/)mmproj-${mmproj}\\.gguf$`, 'i').test(f.path)) ?? files.find((f) => /(^|\/)mmproj.*\.gguf$/i.test(f.path)) : undefined;
  return { model, mmproj: proj };
}
