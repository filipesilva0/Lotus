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
// Pure: shared with the core (which downloads the files) and tested in Claude/handover/verification/s17-tests.ts.

import { IMAGE_PICKS, VOICE_PICKS, DICTATION_PICK, type Tier, type ImagePick } from '../setup/catalog';
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
  engine: 'kokoro' | 'piper' | 'whisper' | 'pocket' | 'zipvoice';
  /** Copies the voice in a reference recording (voice cloning); no speakers of its own. */
  clones?: boolean;
  /** Also needs the words spoken in the reference recording (ZipVoice). */
  needsReferenceText?: boolean;
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

/**
 * What a model's licence lets people do with it, for the badge on its card (0.17.0). Read from the
 * licence name so a new model only needs its licence written correctly.
 *   open            commercial use allowed (Apache, MIT, NVIDIA Open Model, OpenMDW, CC-BY…)
 *   limits          commercial use allowed with conditions (OpenRAIL use limits, Llama's licence)
 *   non-commercial  personal or research use only
 *   varies          depends on the file (e.g. each Piper voice's recordings)
 */
export type LicenceUse = 'open' | 'limits' | 'non-commercial' | 'varies';
export function licenceUse(licence: string): LicenceUse {
  const l = licence.toLowerCase();
  if (/non[- ]?commercial|\bcc-by(-sa)?-nc|research[- ]only/.test(l)) return 'non-commercial';
  if (/varies|unknown|check/.test(l)) return 'varies';
  if (/rail|llama|gemma terms/.test(l)) return 'limits';
  return 'open';
}
export const LICENCE_BADGE: Record<Exclude<LicenceUse, 'open'>, { label: string; hint: string }> = {
  'non-commercial': { label: 'Non-commercial', hint: 'Its licence allows personal, non-commercial use only. Don\'t use what it makes for paid or business work.' },
  limits: { label: 'Use limits', hint: 'Commercial use is allowed, but its licence lists uses that aren\'t. Read the licence before using it for work.' },
  varies: { label: 'Check licence', hint: 'The licence depends on the recordings or data it was trained on. Check its model card before using it for work.' },
};

// ── Chat ───────────────────────────────────────────────────────────────────

const chat = (e: Omit<LibEntry, 'kind'>): LibEntry => ({ ...e, kind: 'chat' });

// T71 (17 Nov 2026): a catalog for every kind of computer, from a laptop with no graphics card to a
// 128 GB Mac. Repos, file names and sizes were read from Hugging Face's file lists that day
// (Q4_K_M, the vision file "mmproj-F16" where the model reads images); `diskGb` is the model file plus
// that vision file. `vramGb` is the file plus room for the conversation (about 1–2 GB). Only the
// models marked `tools` have been through Lotus's real tasks; the rest are untested in Lotus.
// Which three to suggest on each kind of computer is in CHAT_CLASS_PICKS below.
export const CHAT_MODELS: LibEntry[] = [
  // Tiny: any computer, even without a graphics card.
  chat({ id: 'qwen3.5-0.8b', title: 'Qwen 3.5 0.8B', maker: 'Alibaba', licence: 'Apache-2.0', tags: ['Tiny', 'Vision'], vision: true,
    blurb: 'The smallest useful model: quick on any processor, reads photos. Good for short questions, not long tasks.', vramGb: 1.5, diskGb: 0.7,
    builtin: { gguf: { repo: 'unsloth/Qwen3.5-0.8B-GGUF', quant: 'Q4_K_M', mmproj: 'F16' } }, ollama: 'qwen3.5:0.8b' }),
  chat({ id: 'qwen3.5-2b', title: 'Qwen 3.5 2B', maker: 'Alibaba', licence: 'Apache-2.0', tags: ['Tiny', 'Vision'], vision: true,
    blurb: 'Small enough for a laptop processor, still reads screenshots and photos.', vramGb: 3, diskGb: 2,
    builtin: { gguf: { repo: 'unsloth/Qwen3.5-2B-GGUF', quant: 'Q4_K_M', mmproj: 'F16' } }, ollama: 'qwen3.5:2b' }),
  chat({ id: 'phi-4-mini', title: 'Phi-4 Mini', maker: 'Microsoft', licence: 'MIT', tags: ['Small', 'Reasoning'],
    blurb: 'A 3.8B model that is good at maths and step-by-step answers for its size. Text only.', vramGb: 3.5, diskGb: 2.5,
    builtin: { gguf: { repo: 'unsloth/Phi-4-mini-instruct-GGUF', quant: 'Q4_K_M' } }, ollama: 'phi4-mini:3.8b' }),
  chat({ id: 'gemma-4-e2b', title: 'Gemma 4 E2B', maker: 'Google', licence: 'Apache-2.0', tags: ['Small', 'Vision'], vision: true,
    blurb: 'Google\'s model for phones and laptops: light, multilingual, reads images.', vramGb: 4.5, diskGb: 4.1,
    builtin: { gguf: { repo: 'unsloth/gemma-4-E2B-it-GGUF', quant: 'Q4_K_M', mmproj: 'F16' } }, ollama: 'gemma4:e2b' }),
  chat({ id: 'llama3.2-3b', title: 'Llama 3.2 3B', maker: 'Meta', licence: 'Llama 3.2 licence', tags: ['Small'],
    blurb: 'Compact and quick on modest hardware. Picks the wrong tool often (22 of 31 real tasks).', vramGb: 3, diskGb: 2,
    builtin: { gguf: { repo: 'unsloth/Llama-3.2-3B-Instruct-GGUF', quant: 'Q4_K_M' } }, ollama: 'llama3.2:3b' }),

  // Small: 4–6 GB graphics cards, 8 GB Macs.
  chat({ id: 'qwen3.5-4b', title: 'Qwen 3.5 4B', maker: 'Alibaba', licence: 'Apache-2.0', tags: ['Small', 'Vision'], vision: true,
    blurb: 'Quick replies and reads screenshots and photos. Runs on laptops.', vramGb: 5, diskGb: 3.4,
    builtin: { gguf: { repo: 'unsloth/Qwen3.5-4B-GGUF', quant: 'Q4_K_M', mmproj: 'F16' } }, ollama: 'qwen3.5:4b' }),
  chat({ id: 'nemotron-3-nano-4b', title: 'Nemotron 3 Nano 4B', maker: 'NVIDIA', licence: 'NVIDIA Open Model', tags: ['Small', 'Tools'], tools: true,
    blurb: 'Fast and light with a long memory. Passed 26 of Lotus\'s 31 real tasks in about two minutes.', vramGb: 4, diskGb: 2.8,
    builtin: { gguf: { repo: 'unsloth/NVIDIA-Nemotron-3-Nano-4B-GGUF', quant: 'Q4_K_M' } }, ollama: 'nemotron-3-nano:4b' }),
  chat({ id: 'gemma-4-e4b', title: 'Gemma 4 E4B', maker: 'Google', licence: 'Apache-2.0', tags: ['Small', 'Vision'], vision: true,
    blurb: 'The bigger of Google\'s laptop models: better writing and reasoning than E2B, reads images.', vramGb: 6.5, diskGb: 6,
    builtin: { gguf: { repo: 'unsloth/gemma-4-E4B-it-GGUF', quant: 'Q4_K_M', mmproj: 'F16' } }, ollama: 'gemma4:e4b' }),
  chat({ id: 'nemotron-3.5-bolt-e4b', title: 'Nemotron 3.5 Bolt E4B', maker: 'NVIDIA', licence: 'OpenMDW-1.1', tags: ['Small', 'Tools'],
    blurb: 'NVIDIA\'s newest small model (October 2026), built for tool use and coding on small GPUs. Text only in Lotus.', vramGb: 7, diskGb: 6.2,
    builtin: { gguf: { repo: 'nvidia/NVIDIA-Nemotron-3.5-Bolt-E4B-4GB', quant: 'Q4_K_M' } }, ollama: 'nemotron-3.5-bolt:e4b' }),

  // Medium: 8 GB graphics cards, 16 GB Macs.
  chat({ id: 'qwen3-8b', title: 'Qwen 3 8B', maker: 'Alibaba', licence: 'Apache-2.0', tags: ['Tools', 'Reasoning'], tools: true,
    blurb: 'The best tool user Lotus has tested on an 8 GB GPU: 30 of 31 real tasks.', vramGb: 6.5, diskGb: 5,
    builtin: { gguf: { repo: 'unsloth/Qwen3-8B-GGUF', quant: 'Q4_K_M' } }, ollama: 'qwen3:8b' }),
  chat({ id: 'qwen3.5-9b', title: 'Qwen 3.5 9B', maker: 'Alibaba', licence: 'Apache-2.0', tags: ['Vision', 'Reasoning'], vision: true,
    blurb: 'Newer than Qwen 3 8B and reads images; a tight fit on an 8 GB card.', vramGb: 7.5, diskGb: 6.6,
    builtin: { gguf: { repo: 'unsloth/Qwen3.5-9B-GGUF', quant: 'Q4_K_M', mmproj: 'F16' } }, ollama: 'qwen3.5:9b' }),
  chat({ id: 'qwen2.5-coder-7b', title: 'Qwen 2.5 Coder 7B', maker: 'Alibaba', licence: 'Apache-2.0', tags: ['Coding'],
    blurb: 'Tuned for writing and reviewing code.', vramGb: 6, diskGb: 4.7,
    builtin: { gguf: { repo: 'unsloth/Qwen2.5-Coder-7B-Instruct-GGUF', quant: 'Q4_K_M' } }, ollama: 'qwen2.5-coder:7b' }),
  chat({ id: 'deepseek-r1-8b', title: 'DeepSeek-R1 8B', maker: 'DeepSeek', licence: 'MIT', tags: ['Reasoning'],
    blurb: 'Shows its reasoning before answering.', vramGb: 6.5, diskGb: 5,
    builtin: { gguf: { repo: 'unsloth/DeepSeek-R1-0528-Qwen3-8B-GGUF', quant: 'Q4_K_M' } }, ollama: 'deepseek-r1:8b' }),

  // Large: 12–16 GB graphics cards, 16–24 GB Macs.
  chat({ id: 'gemma-4-12b', title: 'Gemma 4 12B', maker: 'Google', licence: 'Apache-2.0', tags: ['Vision', 'Tools'], vision: true, tools: true,
    blurb: 'Strong all-rounder with vision and tool use. Great for daily chat.', vramGb: 9, diskGb: 7.3,
    builtin: { gguf: { repo: 'unsloth/gemma-4-12b-it-GGUF', quant: 'Q4_K_M', mmproj: 'F16' } }, ollama: 'gemma4:12b' }),
  chat({ id: 'qwen3-14b', title: 'Qwen 3 14B', maker: 'Alibaba', licence: 'Apache-2.0', tags: ['Reasoning'],
    blurb: 'The bigger Qwen 3: more knowledge and steadier long answers than the 8B. Text only.', vramGb: 10.5, diskGb: 9,
    builtin: { gguf: { repo: 'unsloth/Qwen3-14B-GGUF', quant: 'Q4_K_M' } }, ollama: 'qwen3:14b' }),
  chat({ id: 'gpt-oss-20b', title: 'gpt-oss 20B', maker: 'OpenAI', licence: 'Apache-2.0', tags: ['Reasoning'],
    blurb: 'OpenAI\'s open model: quick for its size because only part of it works on each word. Text only.', vramGb: 13, diskGb: 11.6,
    builtin: { gguf: { repo: 'unsloth/gpt-oss-20b-GGUF', quant: 'Q4_K_M' } }, ollama: 'gpt-oss:20b' }),
  chat({ id: 'mistral-small-3.2-24b', title: 'Mistral Small 3.2 24B', maker: 'Mistral AI', licence: 'Apache-2.0', tags: ['Vision'], vision: true,
    blurb: 'A careful writer that follows instructions closely and reads images. Strong in European languages.', vramGb: 16.5, diskGb: 15.2,
    builtin: { gguf: { repo: 'unsloth/Mistral-Small-3.2-24B-Instruct-2506-GGUF', quant: 'Q4_K_M', mmproj: 'F16' } }, ollama: 'mistral-small3.2:24b' }),

  // Very large: 24–32 GB graphics cards, 32–48 GB Macs.
  chat({ id: 'gemma-4-26b-a4b', title: 'Gemma 4 26B A4B', maker: 'Google', licence: 'Apache-2.0', tags: ['Vision', 'Fast'], vision: true,
    blurb: 'Nearly as smart as Gemma 4 31B but answers about as fast as a 4B model.', vramGb: 19.5, diskGb: 18.1,
    builtin: { gguf: { repo: 'unsloth/gemma-4-26B-A4B-it-GGUF', quant: 'Q4_K_M', mmproj: 'F16' } }, ollama: 'gemma4:26b' }),
  chat({ id: 'qwen3.8-27b', title: 'Qwen 3.8 27B', maker: 'Alibaba', licence: 'Apache-2.0', tags: ['Vision', 'Reasoning', 'Coding'], vision: true,
    blurb: 'The strongest open model that fits one 24 GB card (August 2026): agents, coding, reasoning, images.', vramGb: 20, diskGb: 17.5,
    builtin: { gguf: { repo: 'unsloth/Qwen3.8-27B-GGUF', quant: 'Q4_K_M', mmproj: 'F16' } }, ollama: 'qwen3.8:27b' }),
  chat({ id: 'qwen3.6-27b', title: 'Qwen 3.6 27B', maker: 'Alibaba', licence: 'Apache-2.0', tags: ['Vision', 'Reasoning', 'Coding'], vision: true,
    blurb: 'Qwen 3.8 27B\'s predecessor; well tested by the community for coding and agents.', vramGb: 20, diskGb: 17.7,
    builtin: { gguf: { repo: 'unsloth/Qwen3.6-27B-GGUF', quant: 'Q4_K_M', mmproj: 'F16' } }, ollama: 'qwen3.6:27b' }),
  chat({ id: 'qwen3.5-27b', title: 'Qwen 3.5 27B', maker: 'Alibaba', licence: 'Apache-2.0', tags: ['Vision', 'Reasoning', 'Tools'], vision: true, tools: true,
    blurb: 'The February 2026 27B: strong reasoning and writing, reads images. Qwen 3.6 and 3.8 27B are newer.', vramGb: 20, diskGb: 17.7,
    builtin: { gguf: { repo: 'unsloth/Qwen3.5-27B-GGUF', quant: 'Q4_K_M', mmproj: 'F16' } }, ollama: 'qwen3.5:27b' }),
  chat({ id: 'qwen3-coder-30b-a3b', title: 'Qwen 3 Coder 30B A3B', maker: 'Alibaba', licence: 'Apache-2.0', tags: ['Coding', 'Fast'],
    blurb: 'A fast coding model: writes, fixes and explains code across a whole project. Text only.', vramGb: 20.5, diskGb: 18.6,
    builtin: { gguf: { repo: 'unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF', quant: 'Q4_K_M' } }, ollama: 'qwen3-coder:30b' }),
  chat({ id: 'gemma-4-31b', title: 'Gemma 4 31B', maker: 'Google', licence: 'Apache-2.0', tags: ['Vision', 'Reasoning'], vision: true,
    blurb: 'Google\'s largest open model: excellent writing and many languages, reads images.', vramGb: 21.5, diskGb: 19.5,
    builtin: { gguf: { repo: 'unsloth/gemma-4-31B-it-GGUF', quant: 'Q4_K_M', mmproj: 'F16' } }, ollama: 'gemma4:31b' }),
  chat({ id: 'qwen3.6-35b-a3b', title: 'Qwen 3.6 35B A3B', maker: 'Alibaba', licence: 'Apache-2.0', tags: ['Vision', 'Coding', 'Fast'], vision: true,
    blurb: 'Big knowledge, small-model speed: only 3B of its 35B work on each word. Needs a 32 GB card or Mac to fit well.', vramGb: 24.5, diskGb: 23,
    builtin: { gguf: { repo: 'unsloth/Qwen3.6-35B-A3B-GGUF', quant: 'Q4_K_M', mmproj: 'F16' } }, ollama: 'qwen3.6:35b-a3b' }),
  chat({ id: 'nemotron-3.5-lightning-30b', title: 'Nemotron 3.5 Lightning 30B', maker: 'NVIDIA', licence: 'OpenMDW-1.1', tags: ['Fast', 'Reasoning'],
    blurb: 'NVIDIA\'s fast agent model (August 2026) with a very long memory. Text only; needs 32 GB.', vramGb: 27, diskGb: 25.3,
    builtin: { gguf: { repo: 'unsloth/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF', quant: 'Q4_K_M' } }, ollama: 'nemotron-3.5-lightning:30b' }),

  // Workstation: 48 GB+ graphics memory, 64–128 GB Macs. Hugging Face splits these into parts.
  chat({ id: 'gpt-oss-120b', title: 'gpt-oss 120B', maker: 'OpenAI', licence: 'Apache-2.0', tags: ['Reasoning', 'Huge'],
    blurb: 'OpenAI\'s large open model. Needs about 70 GB of memory: a 96 GB Mac or a workstation. Text only.', vramGb: 66, diskGb: 62.8,
    builtin: { gguf: { repo: 'unsloth/gpt-oss-120b-GGUF', quant: 'Q4_K_M' } }, ollama: 'gpt-oss:120b' }),
  chat({ id: 'qwen3.5-122b-a10b', title: 'Qwen 3.5 122B A10B', maker: 'Alibaba', licence: 'Apache-2.0', tags: ['Vision', 'Reasoning', 'Huge'], vision: true,
    blurb: 'The largest model here; reads images. Needs a 128 GB Mac or a workstation.', vramGb: 82, diskGb: 77.4,
    builtin: { gguf: { repo: 'unsloth/Qwen3.5-122B-A10B-GGUF', quant: 'Q4_K_M', mmproj: 'F16' } }, ollama: 'qwen3.5:122b-a10b' }),
];

// ── Kinds of computer (T71) ────────────────────────────────────────────────

/** What Lotus reads about this computer (core `machine_info`). */
export interface MachineFacts { gpu: string; vramGb: number; unified: boolean; ramGb?: number }

export type MachineClass = 'cpu' | 'gpu-6' | 'gpu-8' | 'gpu-16' | 'gpu-24' | 'gpu-48' | 'apple-8' | 'apple-16' | 'apple-32' | 'apple-64';

export const CLASS_LABEL: Record<MachineClass, string> = {
  cpu: 'No graphics card',
  'gpu-6': '4–6 GB graphics card',
  'gpu-8': '8–10 GB graphics card',
  'gpu-16': '12–16 GB graphics card',
  'gpu-24': '24–32 GB graphics card',
  'gpu-48': '48 GB+ graphics memory',
  'apple-8': 'Mac with 8 GB',
  'apple-16': 'Mac with 16–24 GB',
  'apple-32': 'Mac with 32–48 GB',
  'apple-64': 'Mac with 64 GB or more',
};

/** Sorts a computer into one of the classes the catalog is planned for. */
export function machineClass(m: MachineFacts): MachineClass {
  if (m.unified) return m.vramGb <= 12 ? 'apple-8' : m.vramGb <= 28 ? 'apple-16' : m.vramGb <= 56 ? 'apple-32' : 'apple-64';
  const v = m.gpu === 'none' ? 0 : m.vramGb;
  if (v < 3.5) return 'cpu';
  if (v < 7) return 'gpu-6';
  if (v < 11.5) return 'gpu-8';
  if (v < 20) return 'gpu-16';
  if (v < 40) return 'gpu-24';
  return 'gpu-48';
}

/**
 * The three chat models to suggest for each kind of computer (first-run guide and the top of the
 * Models page). Every id must be in CHAT_MODELS and fit the class's smallest machine except "best",
 * which may need the top of the range (the guide then falls back to "balanced").
 */
export const CHAT_CLASS_PICKS: Record<MachineClass, Record<Tier, string>> = {
  cpu: { quick: 'qwen3.5-0.8b', balanced: 'qwen3.5-2b', best: 'qwen3.5-4b' },
  'gpu-6': { quick: 'qwen3.5-2b', balanced: 'nemotron-3-nano-4b', best: 'qwen3.5-4b' },
  'gpu-8': { quick: 'nemotron-3-nano-4b', balanced: 'qwen3-8b', best: 'qwen3.5-9b' },
  'gpu-16': { quick: 'qwen3-8b', balanced: 'gemma-4-12b', best: 'gpt-oss-20b' },
  'gpu-24': { quick: 'gemma-4-26b-a4b', balanced: 'qwen3.6-27b', best: 'qwen3.8-27b' },
  'gpu-48': { quick: 'qwen3.6-35b-a3b', balanced: 'nemotron-3.5-lightning-30b', best: 'qwen3.8-27b' },
  'apple-8': { quick: 'qwen3.5-0.8b', balanced: 'qwen3.5-2b', best: 'qwen3.5-4b' },
  'apple-16': { quick: 'qwen3.5-4b', balanced: 'qwen3-8b', best: 'gemma-4-12b' },
  'apple-32': { quick: 'gemma-4-26b-a4b', balanced: 'qwen3.6-27b', best: 'qwen3.8-27b' },
  'apple-64': { quick: 'qwen3.6-35b-a3b', balanced: 'qwen3.8-27b', best: 'qwen3.5-122b-a10b' },
};

/**
 * The three image models to suggest for each kind of computer (T71). Without a graphics card every
 * image model is slow; Stable Diffusion 1.5 is the one that stays bearable, so it leads there.
 */
export const IMAGE_CLASS_PICKS: Record<MachineClass, Record<Tier, string>> = {
  cpu: { quick: 'sd15', balanced: 'flux2-klein-4b-q4', best: 'z-image-turbo-q4' },
  'gpu-6': { quick: 'sd15', balanced: 'flux2-klein-4b-q4', best: 'z-image-turbo-q4' },
  'gpu-8': { quick: 'flux2-klein-4b-q4', balanced: 'sdxl-base', best: 'z-image-turbo-q4' },
  'gpu-16': { quick: 'flux2-klein-4b', balanced: 'z-image-turbo-q4', best: 'flux2-klein-9b-q4' },
  'gpu-24': { quick: 'flux2-klein-4b', balanced: 'z-image-turbo', best: 'qwen-image-q4' },
  'gpu-48': { quick: 'z-image-turbo', balanced: 'qwen-image-q4', best: 'qwen-image' },
  'apple-8': { quick: 'sd15', balanced: 'flux2-klein-4b-q4', best: 'z-image-turbo-q4' },
  'apple-16': { quick: 'flux2-klein-4b-q4', balanced: 'z-image-turbo-q4', best: 'flux2-klein-9b-q4' },
  'apple-32': { quick: 'z-image-turbo-q4', balanced: 'z-image-turbo', best: 'qwen-image-q4' },
  'apple-64': { quick: 'z-image-turbo', balanced: 'qwen-image-q4', best: 'qwen-image' },
};

const CLASS_PICKS: Partial<Record<ModelKind, Record<MachineClass, Record<Tier, string>>>> = { chat: CHAT_CLASS_PICKS, image: IMAGE_CLASS_PICKS };

/** The suggested models of a kind (chat or image) for a computer, each carrying its tier for this class. */
export function picksFor(kind: ModelKind, m: MachineFacts | null | undefined): LibEntry[] {
  const table = CLASS_PICKS[kind];
  if (!table) return [];
  const p = table[m ? machineClass(m) : 'gpu-8'];
  const out: LibEntry[] = [];
  for (const t of ['quick', 'balanced', 'best'] as Tier[]) {
    const e = LIBRARY.find((x) => x.id === p[t]);
    if (e) out.push({ ...e, tier: t });
  }
  return out;
}

/** The suggested chat models for a computer, each carrying its tier for this class. */
export const chatPicksFor = (m: MachineFacts | null | undefined) => picksFor('chat', m);

// ── Images ─────────────────────────────────────────────────────────────────

const imgPath = (folder: ImageFolder, file: string) => `image/${folder}/${file}`;
const fromPick = (p: ImagePick, family: ImageFamily): LibEntry => ({
  id: p.id, kind: 'image', tier: p.tier, title: p.title, maker: p.maker, licence: p.licence, blurb: p.blurb, tags: [], vramGb: p.vramGb, diskGb: p.diskGb,
  builtin: { files: p.files.map((f) => ({ url: f.url, path: imgPath(f.folder, f.fileName), gb: f.gb })) },
  image: { family, files: { model: p.recipe.unet, llm: p.recipe.clip, vae: p.recipe.vae } },
});
const FAMILY_OF: Record<string, ImageFamily> = { 'flux2-klein-4b': 'flux2', 'z-image-turbo': 'zimage', 'qwen-image': 'qwen-image' };

const HF = (repo: string, file: string) => `https://huggingface.co/${repo}/resolve/main/${file}`;

// T71: smaller GGUF versions for stable-diffusion.cpp, so the newer models also run on 6–8 GB cards
// and 16 GB Macs. Files from the repos stable-diffusion.cpp's own docs point to (leejet's GGUF
// conversions, unsloth/mradermacher text encoders), sizes read from Hugging Face on 17 Nov 2026.
// sd.cpp loads the text encoder and the image model one after the other, so the memory needed is
// about the larger of the two plus room to work. ComfyUI can't read GGUF without an add-on, so these
// are offered for Lotus's own engine only (availableOn).
const ggufImage = (e: Omit<LibEntry, 'kind' | 'builtin' | 'image'> & { family: ImageFamily; model: [string, string, number]; llm: [string, string, number]; vae: [string, number] }): LibEntry => {
  const { family, model, llm, vae, ...rest } = e;
  const file = (url: string) => url.split('/').pop()!;
  return {
    ...rest, kind: 'image',
    builtin: { files: [
      { url: HF(model[0], model[1]), path: imgPath('diffusion_models', model[1]), gb: model[2] },
      { url: HF(llm[0], llm[1]), path: imgPath('text_encoders', llm[1]), gb: llm[2] },
      { url: vae[0], path: imgPath('vae', file(vae[0])), gb: vae[1] },
    ] },
    image: { family, files: { model: model[1], llm: llm[1], vae: file(vae[0]) } },
  };
};
const FLUX2_VAE = 'https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/vae/flux2-vae.safetensors';
const ZIMAGE_VAE = 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors';
const QWEN_IMAGE_VAE = 'https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors';

export const IMAGE_MODELS: LibEntry[] = [
  ...IMAGE_PICKS.map((p) => ({ ...fromPick(p, FAMILY_OF[p.id]), tier: undefined })),
  ggufImage({ id: 'flux2-klein-4b-q4', title: 'FLUX.2 Klein 4B (small)', maker: 'Black Forest Labs', licence: 'Apache-2.0', tags: ['Small', 'Fast'], vramGb: 4.5, diskGb: 5.3,
    blurb: 'The 4-step FLUX.2 Klein in a smaller file: drafts and photo edits on a 6 GB card. Lotus\'s own engine only.',
    family: 'flux2', model: ['leejet/FLUX.2-klein-4B-GGUF', 'flux-2-klein-4b-Q4_0.gguf', 2.46], llm: ['unsloth/Qwen3-4B-GGUF', 'Qwen3-4B-Q4_K_M.gguf', 2.5], vae: [FLUX2_VAE, 0.34] }),
  ggufImage({ id: 'z-image-turbo-q4', title: 'Z-Image Turbo (small)', maker: 'Alibaba Tongyi', licence: 'Apache-2.0', tags: ['Photoreal'], vramGb: 5.4, diskGb: 6.7,
    blurb: 'Photoreal images with readable text in eight steps, sized for 8 GB cards. Lotus\'s own engine only.',
    family: 'zimage', model: ['leejet/Z-Image-Turbo-GGUF', 'z_image_turbo-Q4_K.gguf', 3.86], llm: ['unsloth/Qwen3-4B-Instruct-2507-GGUF', 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf', 2.5], vae: [ZIMAGE_VAE, 0.33] }),
  ggufImage({ id: 'flux2-klein-9b-q4', title: 'FLUX.2 Klein 9B (small)', maker: 'Black Forest Labs', licence: 'FLUX Non-Commercial', tags: ['Non-commercial'], vramGb: 7.5, diskGb: 11,
    blurb: 'Sharper and more varied than Klein 4B, still four steps. Personal, non-commercial use only. Lotus\'s own engine only.',
    family: 'flux2', model: ['leejet/FLUX.2-klein-9B-GGUF', 'flux-2-klein-9b-Q4_0.gguf', 5.62], llm: ['unsloth/Qwen3-8B-GGUF', 'Qwen3-8B-Q4_K_M.gguf', 5.03], vae: [FLUX2_VAE, 0.34] }),
  ggufImage({ id: 'qwen-image-q4', title: 'Qwen-Image (small)', maker: 'Alibaba Qwen', licence: 'Apache-2.0', tags: ['Text in images'], vramGb: 15, diskGb: 18,
    blurb: 'Qwen-Image\'s prompt following and text rendering in a 13 GB file, for 16–24 GB cards. Lotus\'s own engine only.',
    family: 'qwen-image', model: ['QuantStack/Qwen-Image-GGUF', 'Qwen_Image-Q4_K_M.gguf', 13.07], llm: ['mradermacher/Qwen2.5-VL-7B-Instruct-GGUF', 'Qwen2.5-VL-7B-Instruct.Q4_K_M.gguf', 4.68], vae: [QWEN_IMAGE_VAE, 0.25] }),
  { id: 'sdxl-base', kind: 'image', title: 'Stable Diffusion XL', maker: 'Stability AI', licence: 'CreativeML Open RAIL++-M', tags: ['Classic'], vramGb: 7, diskGb: 7.3,
    blurb: 'The classic 1024 px model most LoRAs are made for. Comes with the fixed SDXL VAE.',
    builtin: { files: [
      { url: HF('stabilityai/stable-diffusion-xl-base-1.0', 'sd_xl_base_1.0.safetensors'), path: imgPath('checkpoints', 'sd_xl_base_1.0.safetensors'), gb: 6.9 },
      { url: HF('madebyollin/sdxl-vae-fp16-fix', 'sdxl.vae.safetensors'), path: imgPath('vae', 'sdxl.vae.safetensors'), gb: 0.3 },
    ] },
    image: { family: 'sdxl', files: { model: 'sd_xl_base_1.0.safetensors', vae: 'sdxl.vae.safetensors' } } },
  { id: 'sd15', kind: 'image', title: 'Stable Diffusion 1.5', maker: 'RunwayML', licence: 'CreativeML Open RAIL-M', tags: ['Classic', 'Small'], vramGb: 4, diskGb: 4.4,
    blurb: 'Small and fast 512 px model with thousands of add-ons. The only image model that is bearable without a graphics card (about a minute an image).',
    builtin: { files: [
      { url: HF('stable-diffusion-v1-5/stable-diffusion-v1-5', 'v1-5-pruned-emaonly.safetensors'), path: imgPath('checkpoints', 'v1-5-pruned-emaonly.safetensors'), gb: 4.3 },
      { url: HF('stabilityai/sd-vae-ft-mse-original', 'vae-ft-mse-840000-ema-pruned.safetensors'), path: imgPath('vae', 'vae-ft-mse-840000-ema-pruned.safetensors'), gb: 0.3 },
    ] },
    image: { family: 'sd15', files: { model: 'v1-5-pruned-emaonly.safetensors', vae: 'vae-ft-mse-840000-ema-pruned.safetensors' } } },
];

// ── Voice ──────────────────────────────────────────────────────────────────

const SHERPA = (tag: 'tts-models' | 'asr-models' | 'vocoder-models', file: string) => `https://github.com/k2-fsa/sherpa-onnx/releases/download/${tag}/${file}`;
const voicePick = (id: string) => [...VOICE_PICKS, DICTATION_PICK].find((p) => p.id === id);
const KOKORO_EN = ['af_alloy', 'af_aoede', 'af_bella', 'af_heart', 'af_jessica', 'af_kore', 'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky', 'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael', 'am_onyx', 'am_puck', 'am_santa', 'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily', 'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis'];

export const VOICE_MODELS: LibEntry[] = [
  { id: 'kokoro', kind: 'voice', tier: 'balanced', title: 'Kokoro', maker: 'hexgrad', licence: 'Apache-2.0', tags: ['Many voices'], vramGb: 0, diskGb: 0.35,
    blurb: voicePick('kokoro')?.blurb ?? 'Natural voices, fast even without a GPU.',
    builtin: { files: [{ url: SHERPA('tts-models', 'kokoro-en-v0_19.tar.bz2'), path: 'voice/kokoro', gb: 0.33, archive: true }] },
    voice: { engine: 'kokoro', languages: ['en'], speakers: KOKORO_EN.map((name, id) => ({ id, name })) }, voicebox: voicePick('kokoro')?.match },
  { id: 'piper-en-us-lessac', kind: 'voice', tier: 'quick', title: 'Piper · Lessac (US English)', maker: 'Rhasspy', licence: 'Varies by voice', tags: ['Tiny'], vramGb: 0, diskGb: 0.07,
    blurb: 'A clear, tiny voice that speaks instantly on any computer.',
    builtin: { files: [{ url: SHERPA('tts-models', 'vits-piper-en_US-lessac-medium.tar.bz2'), path: 'voice/piper-en-us-lessac', gb: 0.07, archive: true }] },
    voice: { engine: 'piper', languages: ['en'] } },
  { id: 'piper-en-gb-alba', kind: 'voice', title: 'Piper · Alba (British English)', maker: 'Rhasspy', licence: 'Varies by voice', tags: ['Tiny'], vramGb: 0, diskGb: 0.07,
    blurb: 'A tiny British English voice.',
    builtin: { files: [{ url: SHERPA('tts-models', 'vits-piper-en_GB-alba-medium.tar.bz2'), path: 'voice/piper-en-gb-alba', gb: 0.07, archive: true }] },
    voice: { engine: 'piper', languages: ['en'] } },
  { id: 'piper-pt-pt-tugao', kind: 'voice', title: 'Piper · Tugão (European Portuguese)', maker: 'Rhasspy', licence: 'Varies by voice', tags: ['Tiny'], vramGb: 0, diskGb: 0.07,
    blurb: 'A tiny voice for Portuguese from Portugal.',
    builtin: { files: [{ url: SHERPA('tts-models', 'vits-piper-pt_PT-tugao-medium.tar.bz2'), path: 'voice/piper-pt-pt-tugao', gb: 0.07, archive: true }] },
    voice: { engine: 'piper', languages: ['pt'] } },
  { id: 'piper-pt-br-faber', kind: 'voice', title: 'Piper · Faber (Brazilian Portuguese)', maker: 'Rhasspy', licence: 'Varies by voice', tags: ['Tiny'], vramGb: 0, diskGb: 0.07,
    blurb: 'A tiny voice for Brazilian Portuguese.',
    builtin: { files: [{ url: SHERPA('tts-models', 'vits-piper-pt_BR-faber-medium.tar.bz2'), path: 'voice/piper-pt-br-faber', gb: 0.07, archive: true }] },
    voice: { engine: 'piper', languages: ['pt'] } },
  // T71: more Piper voices (medium quality unless "high"), one or two per language. Archive names read
  // from sherpa-onnx's tts-models release on 17 Nov 2026. Each voice's licence follows the recording
  // it was trained on, so it is shown as "varies"; the archive's MODEL_CARD says which.
  ...([
    ['pt_PT-dii-high', 'Dii (European Portuguese)', 'pt', 0.064], ['pt_PT-miro-high', 'Miro (European Portuguese)', 'pt', 0.064],
    ['pt_BR-cadu-medium', 'Cadu (Brazilian Portuguese)', 'pt', 0.064],
    ['en_US-amy-medium', 'Amy (US English)', 'en', 0.064], ['en_US-ryan-high', 'Ryan (US English)', 'en', 0.11],
    ['es_ES-davefx-medium', 'Davefx (Spanish, Spain)', 'es', 0.064], ['es_MX-ald-medium', 'Ald (Spanish, Mexico)', 'es', 0.064],
    ['fr_FR-siwis-medium', 'Siwis (French)', 'fr', 0.064], ['de_DE-thorsten-medium', 'Thorsten (German)', 'de', 0.064],
    ['it_IT-paola-medium', 'Paola (Italian)', 'it', 0.064], ['nl_NL-pim-medium', 'Pim (Dutch)', 'nl', 0.064],
    ['pl_PL-gosia-medium', 'Gosia (Polish)', 'pl', 0.064], ['ru_RU-irina-medium', 'Irina (Russian)', 'ru', 0.064],
    ['uk_UA-ukrainian_tts-medium', 'Ukrainian TTS (Ukrainian)', 'uk', 0.077], ['tr_TR-dfki-medium', 'DFKI (Turkish)', 'tr', 0.064],
    ['ar_JO-kareem-medium', 'Kareem (Arabic)', 'ar', 0.064], ['hi_IN-priyamvada-medium', 'Priyamvada (Hindi)', 'hi', 0.064],
    ['zh_CN-huayan-medium', 'Huayan (Chinese)', 'zh', 0.064],
  ] as const).map(([name, label, lang, gb]): LibEntry => {
    const id = `piper-${name.toLowerCase().replace(/_/g, '-')}`;
    return { id, kind: 'voice', title: `Piper · ${label}`, maker: 'Rhasspy', licence: 'Varies by voice', tags: ['Tiny', lang.toUpperCase()], vramGb: 0, diskGb: gb,
      blurb: name.endsWith('-high') ? 'A clearer, more natural Piper voice; still small and quick on any computer.' : 'A small, clear voice that speaks instantly on any computer.',
      builtin: { files: [{ url: SHERPA('tts-models', `vits-piper-${name}.tar.bz2`), path: `voice/${id}`, gb, archive: true }] },
      voice: { engine: 'piper', languages: [lang] } };
  }),
  // Voice cloning with Lotus's own engine (0.8.2): a few seconds of someone speaking → that voice.
  // No tier: they can't speak without a recording, so the first-run guide never suggests them.
  { id: 'pocket-tts', kind: 'voice', title: 'PocketTTS (voice cloning)', maker: 'Kyutai', licence: 'MIT code, CC-BY-4.0 weights', tags: ['Cloning', 'Small'], vramGb: 0, diskGb: 0.2,
    blurb: 'Copies any voice from a few seconds of clear speech. Small and fast on the processor; English.',
    builtin: { files: [{ url: SHERPA('tts-models', 'sherpa-onnx-pocket-tts-int8-2026-01-26.tar.bz2'), path: 'voice/pocket-tts', gb: 0.2, archive: true }] },
    voice: { engine: 'pocket', languages: ['en'], clones: true } },
  { id: 'zipvoice', kind: 'voice', title: 'ZipVoice (voice cloning)', maker: 'k2-fsa', licence: 'Apache-2.0', tags: ['Cloning', 'Chinese'], vramGb: 0, diskGb: 0.2,
    blurb: 'Copies a voice from a recording plus its words (Lotus writes them with Whisper). English and Chinese.',
    builtin: { files: [
      { url: SHERPA('tts-models', 'sherpa-onnx-zipvoice-distill-int8-zh-en-emilia.tar.bz2'), path: 'voice/zipvoice', gb: 0.15, archive: true },
      { url: SHERPA('vocoder-models', 'vocos_24khz.onnx'), path: 'voice/zipvoice/vocos_24khz.onnx', gb: 0.05 },
    ] },
    voice: { engine: 'zipvoice', languages: ['en', 'zh'], clones: true, needsReferenceText: true } },
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
  // T71: the other multilingual sizes (archive names and sizes from sherpa-onnx's asr-models release, 17 Nov 2026).
  // Speech runs on the processor here, so bigger means slower, not "needs a graphics card".
  { id: 'whisper-tiny', kind: 'dictation', title: 'Whisper Tiny', maker: 'OpenAI', licence: 'MIT', tags: ['99 languages', 'Tiny'], vramGb: 0, diskGb: 0.11,
    blurb: 'The smallest Whisper: instant on old laptops, but makes more mistakes.',
    builtin: { files: [{ url: SHERPA('asr-models', 'sherpa-onnx-whisper-tiny.tar.bz2'), path: 'voice/whisper-tiny', gb: 0.11, archive: true }] },
    voice: { engine: 'whisper', languages: ['multi'] } },
  { id: 'whisper-base', kind: 'dictation', title: 'Whisper Base', maker: 'OpenAI', licence: 'MIT', tags: ['99 languages', 'Tiny'], vramGb: 0, diskGb: 0.2,
    blurb: 'Small and quick in any language; fine for short dictation.',
    builtin: { files: [{ url: SHERPA('asr-models', 'sherpa-onnx-whisper-base.tar.bz2'), path: 'voice/whisper-base', gb: 0.2, archive: true }] },
    voice: { engine: 'whisper', languages: ['multi'] } },
  { id: 'whisper-medium', kind: 'dictation', title: 'Whisper Medium', maker: 'OpenAI', licence: 'MIT', tags: ['99 languages'], vramGb: 0, diskGb: 1.8,
    blurb: 'More accurate than Small for accents and names; noticeably slower on long recordings.',
    builtin: { files: [{ url: SHERPA('asr-models', 'sherpa-onnx-whisper-medium.tar.bz2'), path: 'voice/whisper-medium', gb: 1.8, archive: true }] },
    voice: { engine: 'whisper', languages: ['multi'] } },
  { id: 'whisper-large-v3', kind: 'dictation', title: 'Whisper Large v3', maker: 'OpenAI', licence: 'MIT', tags: ['99 languages', 'Accurate'], vramGb: 0, diskGb: 1.0,
    blurb: 'The most accurate Whisper, for lectures and interviews. Several times slower than Turbo; give long files time.',
    builtin: { files: [{ url: SHERPA('asr-models', 'sherpa-onnx-whisper-large-v3.tar.bz2'), path: 'voice/whisper-large-v3', gb: 1.02, archive: true }] },
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
 * Without a GPU, `ramGb` (the computer's memory) decides whether a model can load at all: the system
 * and other apps keep about 40%. Models that run on the processor (voice, dictation) always fit.
 */
export function fitOf(e: Pick<LibEntry, 'vramGb'>, vramGb: number | undefined, unified = false, ramGb?: number): Fit {
  if (e.vramGb <= 0.5) return 'fits';
  if (!vramGb || vramGb <= 0) {
    if (ramGb && ramGb > 0 && e.vramGb > ramGb * 0.6) return 'too-big';
    return e.vramGb <= 2 ? 'fits' : 'unknown';
  }
  const usable = unified ? vramGb * 0.75 : vramGb;
  if (e.vramGb <= usable * 0.9) return 'fits';
  if (e.vramGb <= usable * 1.25) return 'tight';
  return 'too-big';
}

/**
 * 0.20.0: the chat model to select when none is chosen yet: the biggest installed one that fits this
 * computer, not simply the first in the list (alphabetical order made Gemma 4 12B the default on 8 GB
 * cards, where it only partly fits). Without a GPU reading, or when nothing known fits, the first.
 */
export function preferredChatModel<T>(list: T[], entryOf: (m: T) => Pick<LibEntry, 'vramGb'> | undefined, vramGb?: number, unified = false): T | undefined {
  if (!list.length || !vramGb) return list[0];
  const fitting = list.map((m) => ({ m, e: entryOf(m) }))
    .filter((x) => x.e && fitOf(x.e, vramGb, unified) === 'fits')
    .sort((a, b) => b.e!.vramGb - a.e!.vramGb);
  return fitting[0]?.m ?? list[0];
}

export const FIT_LABEL: Record<Fit, string> = { fits: 'Fits this computer', tight: 'Tight fit, runs slower', 'too-big': 'Too big for this computer', unknown: 'Slow without a GPU' };

/**
 * The entry to suggest for a kind on this computer. Chat and images: the best of this kind of
 * computer's three picks that fits (without a graphics card: the balanced pick, else the quick one).
 * When none of the picks can run on the chosen engine (ComfyUI can't read Lotus's GGUF image files),
 * the biggest model for that engine that fits. Voice and dictation: the catalog's tiers.
 */
export function suggest(kind: ModelKind, vramGb: number | undefined, unified = false, engine: 'builtin' | 'ollama' | 'comfyui' | 'voicebox' = 'builtin', ramGb?: number): LibEntry | undefined {
  if (CLASS_PICKS[kind]) {
    const m: MachineFacts = { gpu: vramGb ? (unified ? 'apple' : 'gpu') : 'none', vramGb: vramGb ?? 0, unified, ramGb };
    const cpu = machineClass(m) === 'cpu';
    const ok = (e: LibEntry) => { const f = fitOf(e, vramGb, unified, ramGb); return f === 'fits' || (cpu && f === 'unknown'); };
    const picks = picksFor(kind, m).filter((e) => availableOn(e, engine)).reverse();
    if (picks.length) return (cpu ? picks.filter((e) => e.tier !== 'best') : picks).find(ok) ?? picks[picks.length - 1];
    const all = LIBRARY.filter((e) => e.kind === kind && availableOn(e, engine)).sort((a, b) => b.vramGb - a.vramGb);
    return all.find(ok) ?? all[all.length - 1];
  }
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
  // ComfyUI reads the same files from Lotus Studio, except GGUF image models (they need an add-on there).
  if (engine === 'comfyui') return e.kind === 'image' && !!e.builtin?.files && !e.builtin.files.some((f) => /\.gguf$/i.test(f.path));
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

/**
 * Picks the files of a GGUF repo for a quantisation from its file list (Hugging Face tree API).
 * Big models come split ("…-Q4_K_M-00001-of-00003.gguf", usually in a folder named after the
 * quantisation): `parts` then lists every part in order and `model` is the first, which is the one
 * llama.cpp opens (it finds the rest beside it). Files in other folders (MTP drafts, BF16) are ignored.
 */
export type HfFile = { path: string; size?: number };
export function pickGguf(files: HfFile[], quant: string, mmproj?: string): { model?: HfFile; mmproj?: HfFile; parts?: HfFile[] } {
  const q = quant.toUpperCase();
  const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  // Root files, or files in a folder named for this quantisation (Q4_K_M/ or UD-Q4_K_M/).
  const inPlace = (f: HfFile) => { const d = dirOf(f.path).toUpperCase(); return d === '' || d === q || d === `UD-${q}`; };
  const ggufs = files.filter((f) => /\.gguf$/i.test(f.path) && inPlace(f) && !/(^|\/)mmproj/i.test(f.path) && !/(^|\/)mtp-/i.test(f.path));
  const split = /-(\d{5})-of-(\d{5})\.gguf$/i;
  // Exact "-Q4_K_M.gguf" first, then any file containing the quant, then (one-file repos) the only one.
  const model = ggufs.find((f) => new RegExp(`[-_.]${q}\\.gguf$`, 'i').test(f.path) && !/-UD-/i.test(f.path))
    ?? ggufs.find((f) => f.path.toUpperCase().includes(q) && (!split.test(f.path) || /-00001-of-/i.test(f.path)))
    // One file with no quantisation in its name (a repo that ships just one): take it.
    ?? (ggufs.length === 1 && !/[-_.](UD-)?(I?Q\d|BF16|F16|F32|MXFP4)/i.test(ggufs[0].path) ? ggufs[0] : undefined);
  const proj = mmproj ? files.find((f) => new RegExp(`(^|/)mmproj-${mmproj}\\.gguf$`, 'i').test(f.path)) ?? files.find((f) => /(^|\/)mmproj.*\.gguf$/i.test(f.path)) : undefined;
  let parts: HfFile[] | undefined;
  const m = model ? split.exec(model.path) : null;
  if (model && m) {
    const stem = model.path.slice(0, m.index);
    const want = Number(m[2]);
    parts = ggufs.filter((f) => f.path.startsWith(stem) && split.test(f.path) && split.exec(f.path)![2] === m[2])
      .sort((a, b) => a.path.localeCompare(b.path));
    if (parts.length !== want) parts = undefined; // incomplete listing: refuse rather than half-download
  }
  if (model && m && !parts) return { mmproj: proj };
  return { model, mmproj: proj, ...(parts ? { parts } : {}) };
}

/** The folder of a split quantisation to list next, when the repo's top level has no file for it. */
export function quantFolder(entries: { path: string; dir?: boolean }[], quant: string): string | undefined {
  const q = quant.toUpperCase();
  return entries.find((e) => e.dir && (e.path.toUpperCase() === q || e.path.toUpperCase() === `UD-${q}`))?.path;
}

// ── Sizes (moved from the old models/catalog.ts, T71) ─────────────────────

/** Rough VRAM need in GB: weights plus ~15% working memory and ~0.5 GB for the context cache. */
export const estimateVram = (billions: number, bpw: number) => Math.round((billions * bpw / 8 * 1.15 + 0.5) * 10) / 10;
/** Billions of parameters from Ollama's "8.2B" / "600M". */
export const paramsOf = (sizeStr?: string) => { const m = /([\d.]+)\s*([BM])/i.exec(sizeStr ?? ''); return m ? parseFloat(m[1]) * (m[2].toUpperCase() === 'M' ? 0.001 : 1) : 0; };
export const fmtGB = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
