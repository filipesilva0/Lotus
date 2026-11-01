// First-run setup data (session 10): where each engine's official installer comes from, and the
// recommended models for each engine in three tiers. Pure data + pure helpers, so it is tested in
// handover/verification/s10-tests.ts. Picked in November 2026; see DECISIONS D27 for why.

import type { EngineId } from '../services/engineConfig';

export type DesktopOs = 'windows' | 'macos' | 'linux';
export type Arch = 'x86_64' | 'aarch64';

// ── Engines ────────────────────────────────────────────────────────────────

export interface EngineSource {
  id: EngineId;
  name: string;
  role: string;
  /** Licence of the engine itself (the installer shows its own terms when it opens). */
  licence: string;
  home: string;
  terms: string;
  /** Opened in the browser when Lotus cannot download for this OS, or the download fails. */
  downloadPage: string;
  /** Short, honest note shown under the toggle. */
  note: Partial<Record<DesktopOs, string>>;
}

export const ENGINES: Record<EngineId, EngineSource> = {
  ollama: {
    id: 'ollama', name: 'Ollama', role: 'Chat, Deep Research, App Builder and Tasks',
    licence: 'MIT', home: 'https://ollama.com', terms: 'https://github.com/ollama/ollama/blob/main/LICENSE',
    downloadPage: 'https://ollama.com/download',
    note: { linux: 'Unpacked into Lotus Studio/Engines, so it needs no administrator password.' },
  },
  comfyui: {
    id: 'comfyui', name: 'ComfyUI', role: 'Images',
    licence: 'GPL-3.0 (ComfyUI) · Comfy Desktop terms', home: 'https://www.comfy.org', terms: 'https://www.comfy.org/terms-of-service',
    downloadPage: 'https://www.comfy.org/download',
    note: { macos: 'Comfy Desktop needs an Apple Silicon Mac.', windows: 'Best with an NVIDIA GPU; works without one, slowly.' },
  },
  voicebox: {
    id: 'voicebox', name: 'Voicebox', role: 'Voice: speech, cloning and dictation',
    licence: 'MIT', home: 'https://github.com/jamiepine/voicebox', terms: 'https://github.com/jamiepine/voicebox/blob/main/LICENSE',
    downloadPage: 'https://github.com/jamiepine/voicebox/releases/latest',
    note: { linux: 'Voicebox has no ready-made Linux download yet. Lotus opens its page so you can build it or run it with Docker.' },
  },
};

export const ENGINE_ORDER: EngineId[] = ['ollama', 'comfyui', 'voicebox'];

export interface InstallerFile { url: string; fileName: string }

const GH = (repo: string, file: string) => `https://github.com/${repo}/releases/latest/download/${file}`;

/**
 * The official installer for an engine on this OS, or null when there is none to download.
 * Voicebox's file names carry the version, so its link is read from the project's own update
 * manifest (`latest.json`, passed in as `voiceboxVersion`).
 */
export function installerFor(id: EngineId, os: DesktopOs, arch: Arch, voiceboxVersion?: string): InstallerFile | null {
  if (id === 'ollama') {
    if (os === 'windows') return { url: GH('ollama/ollama', 'OllamaSetup.exe'), fileName: 'OllamaSetup.exe' };
    if (os === 'macos') return { url: GH('ollama/ollama', 'Ollama.dmg'), fileName: 'Ollama.dmg' };
    const f = arch === 'aarch64' ? 'ollama-linux-arm64.tar.zst' : 'ollama-linux-amd64.tar.zst';
    return { url: GH('ollama/ollama', f), fileName: f };
  }
  if (id === 'comfyui') {
    if (os === 'windows') return { url: 'https://download.comfy.org/windows/nsis/x64', fileName: 'ComfyUI-Desktop-Setup.exe' };
    if (os === 'macos') return arch === 'aarch64' ? { url: 'https://download.comfy.org/mac/dmg/arm64', fileName: 'ComfyUI-Desktop.dmg' } : null;
    return arch === 'x86_64' ? { url: 'https://download.comfy.org/linux/appImage/x64', fileName: 'ComfyUI-Desktop-x86_64.AppImage' } : null;
  }
  // voicebox
  const v = voiceboxVersion?.replace(/^v/, '');
  if (!v || !/^\d+\.\d+\.\d+/.test(v) || os === 'linux') return null;
  const base = `https://github.com/jamiepine/voicebox/releases/download/v${v}/`;
  if (os === 'windows') return { url: `${base}Voicebox_${v}_x64-setup.exe`, fileName: `Voicebox_${v}_x64-setup.exe` };
  const a = arch === 'aarch64' ? 'aarch64' : 'x64';
  return { url: `${base}Voicebox_${v}_${a}.dmg`, fileName: `Voicebox_${v}_${a}.dmg` };
}

/** Voicebox's update manifest (a Tauri latest.json): its `version` names the current release. */
export const VOICEBOX_MANIFEST = 'https://github.com/jamiepine/voicebox/releases/latest/download/latest.json';

/** What the guide tells the user once the vendor's installer is on screen. */
export function afterOpenHint(id: EngineId, os: DesktopOs): string {
  const name = ENGINES[id].name;
  if (os === 'macos') return `Drag ${name} into Applications in the window that opened, then open it once.`;
  if (os === 'linux') return `Finish installing ${name} in the window that opened.`;
  return `Finish ${name}'s installer in the window that opened. Lotus notices when it is done.`;
}

/** ComfyUI Desktop serves on port 8000; a manual ComfyUI install uses 8188 (engineConfig's default). */
export const COMFY_DESKTOP_URL = 'http://127.0.0.1:8000';
export const isComfyDesktopPath = (p: string) => /comfyui(-electron)?(\.exe)?$|ComfyUI\.app|comfy.*\.appimage$/i.test(p.replace(/\\/g, '/').split('/').pop() ?? '') || /ComfyUI\.app\//.test(p);

// ── Recommended models ─────────────────────────────────────────────────────

export type Tier = 'quick' | 'balanced' | 'best';
export const TIERS: { id: Tier; label: string; blurb: string }[] = [
  { id: 'quick', label: 'Quick', blurb: 'Fast on almost any PC' },
  { id: 'balanced', label: 'Balanced', blurb: 'The everyday pick' },
  { id: 'best', label: 'Best', blurb: 'Highest quality, needs a big GPU' },
];

export interface ComfyFile { folder: 'diffusion_models' | 'text_encoders' | 'vae'; url: string; fileName: string; gb: number }

/** How Lotus builds the ComfyUI graph for a split (diffusion model + text encoder + VAE) image model. */
export interface ImageRecipe {
  unet: string; clip: string; clipType: string; vae: string;
  kind: 'ksampler' | 'flux2';
  steps: number; cfg: number; sampler: string; scheduler: string;
  /** ModelSamplingAuraFlow shift; undefined = node not used. */
  shift?: number;
  /** EmptySD3LatentImage (16-channel) vs EmptyFlux2LatentImage. */
  latent: 'sd3' | 'flux2';
  /** Native size of the model's square images. */
  base: number;
  /** Negative prompt: zeroed conditioning (distilled models) or a real empty prompt. */
  negative: 'zero' | 'text';
}

interface Base { id: string; tier: Tier; title: string; maker: string; licence: string; blurb: string; vramGb: number; diskGb: number }
export interface ChatPick extends Base { kind: 'chat'; tag: string; vision: true }
export interface ImagePick extends Base { kind: 'image'; files: ComfyFile[]; recipe: ImageRecipe }
/** Voicebox names its models itself, so a pick is matched against `/models/status` at runtime. */
export interface VoicePick extends Base { kind: 'voice'; match: RegExp; clones: boolean }
export type Pick = ChatPick | ImagePick | VoicePick;

export const CHAT_PICKS: ChatPick[] = [
  { kind: 'chat', id: 'qwen3.5:4b', tag: 'qwen3.5:4b', tier: 'quick', title: 'Qwen 3.5 4B', maker: 'Alibaba', licence: 'Apache-2.0', vision: true,
    blurb: 'Quick replies and reads screenshots and photos. Runs on laptops.', vramGb: 5, diskGb: 3.3 },
  { kind: 'chat', id: 'gemma4:12b', tag: 'gemma4:12b', tier: 'balanced', title: 'Gemma 4 12B', maker: 'Google', licence: 'Gemma terms', vision: true,
    blurb: 'Strong all-rounder with vision and tool use. Great for daily chat.', vramGb: 10, diskGb: 7.7 },
  { kind: 'chat', id: 'qwen3.5:27b', tag: 'qwen3.5:27b', tier: 'best', title: 'Qwen 3.5 27B', maker: 'Alibaba', licence: 'Apache-2.0', vision: true,
    blurb: 'Top open model for reasoning, writing and image understanding.', vramGb: 22, diskGb: 17 },
];

const KLEIN = 'https://huggingface.co/Comfy-Org/flux2-klein/resolve/main/split_files/';
const ZIMG = 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/';
const QIMG = 'https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/';

export const IMAGE_PICKS: ImagePick[] = [
  {
    kind: 'image', id: 'flux2-klein-4b', tier: 'quick', title: 'FLUX.2 Klein 4B', maker: 'Black Forest Labs', licence: 'Apache-2.0',
    blurb: 'Four steps, about a second per image on a modern GPU. Ideal for drafts.', vramGb: 10, diskGb: 16,
    files: [
      { folder: 'diffusion_models', url: `${KLEIN}diffusion_models/flux-2-klein-4b.safetensors`, fileName: 'flux-2-klein-4b.safetensors', gb: 7.8 },
      { folder: 'text_encoders', url: `${KLEIN}text_encoders/qwen_3_4b.safetensors`, fileName: 'qwen_3_4b.safetensors', gb: 8.0 },
      { folder: 'vae', url: 'https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/vae/flux2-vae.safetensors', fileName: 'flux2-vae.safetensors', gb: 0.3 },
    ],
    recipe: { unet: 'flux-2-klein-4b.safetensors', clip: 'qwen_3_4b.safetensors', clipType: 'flux2', vae: 'flux2-vae.safetensors', kind: 'flux2', steps: 4, cfg: 1, sampler: 'euler', scheduler: 'simple', latent: 'flux2', base: 1024, negative: 'zero' },
  },
  {
    kind: 'image', id: 'z-image-turbo', tier: 'balanced', title: 'Z-Image Turbo', maker: 'Alibaba Tongyi', licence: 'Apache-2.0',
    blurb: 'Photoreal images in eight steps, with readable text in English and Chinese.', vramGb: 16, diskGb: 21,
    files: [
      { folder: 'diffusion_models', url: `${ZIMG}diffusion_models/z_image_turbo_bf16.safetensors`, fileName: 'z_image_turbo_bf16.safetensors', gb: 12.3 },
      { folder: 'text_encoders', url: `${ZIMG}text_encoders/qwen_3_4b.safetensors`, fileName: 'qwen_3_4b.safetensors', gb: 8.0 },
      { folder: 'vae', url: `${ZIMG}vae/ae.safetensors`, fileName: 'ae.safetensors', gb: 0.3 },
    ],
    recipe: { unet: 'z_image_turbo_bf16.safetensors', clip: 'qwen_3_4b.safetensors', clipType: 'lumina2', vae: 'ae.safetensors', kind: 'ksampler', steps: 8, cfg: 1, sampler: 'res_multistep', scheduler: 'simple', shift: 3, latent: 'sd3', base: 1024, negative: 'zero' },
  },
  {
    kind: 'image', id: 'qwen-image', tier: 'best', title: 'Qwen-Image', maker: 'Alibaba Qwen', licence: 'Apache-2.0',
    blurb: 'A 20B model with the best prompt following and text rendering here.', vramGb: 24, diskGb: 30,
    files: [
      { folder: 'diffusion_models', url: `${QIMG}diffusion_models/qwen_image_fp8_e4m3fn.safetensors`, fileName: 'qwen_image_fp8_e4m3fn.safetensors', gb: 20.4 },
      { folder: 'text_encoders', url: `${QIMG}text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors`, fileName: 'qwen_2.5_vl_7b_fp8_scaled.safetensors', gb: 9.4 },
      { folder: 'vae', url: `${QIMG}vae/qwen_image_vae.safetensors`, fileName: 'qwen_image_vae.safetensors', gb: 0.3 },
    ],
    recipe: { unet: 'qwen_image_fp8_e4m3fn.safetensors', clip: 'qwen_2.5_vl_7b_fp8_scaled.safetensors', clipType: 'qwen_image', vae: 'qwen_image_vae.safetensors', kind: 'ksampler', steps: 20, cfg: 2.5, sampler: 'euler', scheduler: 'simple', shift: 3.1, latent: 'sd3', base: 1328, negative: 'text' },
  },
];

export const VOICE_PICKS: VoicePick[] = [
  { kind: 'voice', id: 'kokoro', tier: 'quick', title: 'Kokoro', maker: 'hexgrad', licence: 'Apache-2.0', clones: false,
    blurb: '82M parameters, 50 ready-made voices, fast even without a GPU.', vramGb: 0, diskGb: 0.4, match: /kokoro/i },
  { kind: 'voice', id: 'chatterbox-turbo', tier: 'balanced', title: 'Chatterbox Turbo', maker: 'Resemble AI', licence: 'MIT', clones: true,
    blurb: 'Fast English voice cloning from a short sample, with expressive delivery.', vramGb: 4, diskGb: 1.5, match: /chatterbox[\s_-]*turbo/i },
  { kind: 'voice', id: 'qwen3-tts-1.7b', tier: 'best', title: 'Qwen3-TTS 1.7B', maker: 'Alibaba Qwen', licence: 'Apache-2.0', clones: true,
    blurb: 'The most natural cloning here, in ten languages.', vramGb: 8, diskGb: 4.5, match: /qwen.*(tts)?.*1[._]?7\s*b/i },
];

/** Speech-to-text for dictation; offered next to the voice picks. */
export const DICTATION_PICK: VoicePick = { kind: 'voice', id: 'whisper-turbo', tier: 'balanced', title: 'Whisper Turbo', maker: 'OpenAI', licence: 'MIT', clones: false,
  blurb: 'Dictation and transcription, about eight times faster than Whisper Large.', vramGb: 3, diskGb: 1.6, match: /whisper.*turbo/i };

export const PICKS_BY_ENGINE: Record<EngineId, Pick[]> = { ollama: CHAT_PICKS, comfyui: IMAGE_PICKS, voicebox: [...VOICE_PICKS, DICTATION_PICK] };

/** Finds Voicebox's model for a pick in its `/models/status` list. */
export function matchVoiceModel<T extends { model_name: string; display_name: string; hf_repo_id?: string | null }>(pick: VoicePick, models: T[]): T | undefined {
  return models.find((m) => pick.match.test(m.model_name) || pick.match.test(m.display_name) || (!!m.hf_repo_id && pick.match.test(m.hf_repo_id)));
}

export type Fit = 'fits' | 'tight' | 'too-big' | 'unknown';

/**
 * Does a pick fit this machine? `vramGb` is the GPU's total memory (0/undefined = unknown).
 * On Apple Silicon memory is shared, so pass the unified memory and Lotus keeps a quarter for macOS.
 */
export function fitFor(pick: Pick, vramGb: number | undefined, unified = false): Fit {
  if (!vramGb || vramGb <= 0) return pick.vramGb <= 2 ? 'fits' : 'unknown';
  const usable = unified ? vramGb * 0.75 : vramGb;
  if (pick.vramGb <= usable * 0.9) return 'fits';
  if (pick.vramGb <= usable * 1.15) return 'tight';
  return 'too-big';
}

/** The tier to pre-select: the best one that fits, else Quick. */
export function suggestedTier(picks: Pick[], vramGb: number | undefined, unified = false): Tier {
  const order: Tier[] = ['best', 'balanced', 'quick'];
  for (const t of order) {
    const p = picks.find((x) => x.tier === t);
    if (p && fitFor(p, vramGb, unified) === 'fits') return t;
  }
  return 'quick';
}

/** Files to fetch for a set of image picks, without downloading a shared file (e.g. qwen_3_4b) twice. */
export function imageFilesFor(picks: ImagePick[]): ComfyFile[] {
  const seen = new Set<string>();
  const out: ComfyFile[] = [];
  for (const p of picks) for (const f of p.files) {
    const key = `${f.folder}/${f.fileName}`;
    if (!seen.has(key)) { seen.add(key); out.push(f); }
  }
  return out;
}

/** Total download size in GB for a selection (shared image files counted once). */
export function selectionGb(picks: Pick[]): number {
  const imgs = picks.filter((p): p is ImagePick => p.kind === 'image');
  const rest = picks.filter((p) => p.kind !== 'image').reduce((s, p) => s + p.diskGb, 0);
  const img = imageFilesFor(imgs).reduce((s, f) => s + f.gb, 0);
  return Math.round((rest + img) * 10) / 10;
}

/** The recipe for an image model file name (as ComfyUI lists it), if Lotus knows it. */
export function recipeFor(modelName: string): ImageRecipe | undefined {
  const base = modelName.replace(/\\/g, '/').split('/').pop() ?? modelName;
  return IMAGE_PICKS.find((p) => p.recipe.unet === base)?.recipe;
}
