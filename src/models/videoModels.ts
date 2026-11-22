// AI video generation (0.21): new moving footage from words (and, on bigger cards, from a picture),
// made on this computer by stable-diffusion.cpp's video mode with the open Wan models (Apache-2.0).
//
// Three sizes, picked by the graphics card's memory, because one size can't serve everyone:
//   Wan 2.1 1.3B        6–11 GB   text to video, 832×480, 2–3 s per clip at 16 frames a second
//   Wan 2.2 TI2V 5B     12–23 GB  text or picture to video, up to 1280×704 at 24 frames a second
//   Wan 2.2 A14B        24 GB+    the best motion and detail, text to video, two experts in turn
//
// Slow by design: on an 8 GB card a 2-second clip takes several minutes. What matters is that it never
// crashes: sd-cli runs as its own program (if it fails, Lotus doesn't), weights wait in RAM until
// needed, the video is decoded in tiles, and when memory runs out the run steps down a ladder
// (more memory spare → fewer frames → smaller picture) before it gives up with a plain explanation.
//
// Pure (no DOM, no storage): shared with the core and tested in core/test/videogen.test.ts.

export type VideoFamily = 'wan21-1.3b' | 'wan22-5b' | 'wan22-a14b';

/** File names under Lotus Studio/Models/image/<folder>: model and high (diffusion_models), vae, t5xxl (text_encoders). */
export interface VideoFiles { model: string; high?: string; vae: string; t5xxl: string }

export interface VideoFamilySpec {
  id: VideoFamily;
  label: string;
  /** Can start from a picture (image to video) as well as from words. */
  fromPicture: boolean;
  /** Frames a second the model was trained at. */
  fps: number;
  steps: number; cfg: number; shift: number;
  /** Wan 2.2 A14B: steps for the high-noise expert (it runs first). */
  highSteps?: number;
  /** Picture sides must be multiples of this (the VAE's compression). */
  align: number;
  /** Graphics memory (GB) below which this size isn't picked. */
  minVramGb: number;
  /** Computer memory (GB) it needs: the weights wait there while the card works. */
  minRamGb: number;
  /** A rough guess at minutes for one clip on the smallest card it's picked for, before the first clip measures it. */
  minutesPerClip: number;
}

export const VIDEO_FAMILIES: Record<VideoFamily, VideoFamilySpec> = {
  'wan21-1.3b': { id: 'wan21-1.3b', label: 'Wan 2.1 1.3B', fromPicture: false, fps: 16, steps: 30, cfg: 6, shift: 3, align: 16, minVramGb: 5.5, minRamGb: 12, minutesPerClip: 6 },
  'wan22-5b': { id: 'wan22-5b', label: 'Wan 2.2 5B', fromPicture: true, fps: 24, steps: 30, cfg: 5, shift: 5, align: 32, minVramGb: 11.5, minRamGb: 16, minutesPerClip: 8 },
  'wan22-a14b': { id: 'wan22-a14b', label: 'Wan 2.2 A14B', fromPicture: false, fps: 16, steps: 10, highSteps: 8, cfg: 3.5, shift: 3, align: 16, minVramGb: 23, minRamGb: 40, minutesPerClip: 12 },
};
/** Biggest first. */
export const VIDEO_ORDER: VideoFamily[] = ['wan22-a14b', 'wan22-5b', 'wan21-1.3b'];

export interface VideoMachine { gpu: string; vramGb: number; unified?: boolean; ramGb?: number }

/** Graphics memory a video model may count on: none without a graphics card; Macs keep a quarter for macOS. */
export function usableVram(m: VideoMachine): number {
  if (!m || m.gpu === 'none' || !(m.vramGb > 0)) return 0;
  return m.unified ? m.vramGb * 0.75 : m.vramGb;
}

/** Can this computer make AI video with this size? 'ok', or why not in plain words. */
export function videoFit(f: VideoFamily, m: VideoMachine): { ok: true } | { ok: false; why: string } {
  const s = VIDEO_FAMILIES[f];
  const v = usableVram(m);
  if (!v) return { ok: false, why: 'Making AI video needs a graphics card (6 GB or more). On the processor alone one second of video would take hours.' };
  if (v < s.minVramGb) return { ok: false, why: `${s.label} needs a graphics card with about ${Math.ceil(s.minVramGb)} GB of memory; this one has ${m.vramGb} GB.` };
  // Unified memory is the RAM, so the card check already covers it.
  if (!m.unified && m.ramGb && m.ramGb < s.minRamGb) return { ok: false, why: `${s.label} needs about ${s.minRamGb} GB of computer memory (RAM) to hold the model while the card works; this computer has ${m.ramGb} GB.` };
  return { ok: true };
}

/** The best size for this computer, or null when it can't make AI video. */
export function videoFamilyFor(m: VideoMachine): VideoFamily | null {
  return VIDEO_ORDER.find((f) => videoFit(f, m).ok) ?? null;
}

/**
 * Which installed video model to use: the biggest one that fits this computer. A model too big for
 * this card is skipped (it would only fail, or crawl for hours).
 */
export function pickVideoModel<T extends { family: VideoFamily }>(installed: T[], m: VideoMachine): T | null {
  for (const f of VIDEO_ORDER) {
    if (!videoFit(f, m).ok) continue;
    const hit = installed.find((x) => x.family === f);
    if (hit) return hit;
  }
  return null;
}

export type VideoAspect = '16:9' | '9:16' | '1:1';

const roundTo = (n: number, k: number) => Math.max(k, Math.round(n / k) * k);
const floorTo = (n: number, k: number) => Math.max(k, Math.floor(n / k) * k);

/** Picture size for a clip: the model's own size on bigger cards, a smaller one where memory is tight. */
export function clipSize(f: VideoFamily, aspect: string | undefined, vram: number): { width: number; height: number } {
  // The long side; the short side keeps 16:9 (or the square keeps about the same area).
  const long = f === 'wan21-1.3b' ? 832 : f === 'wan22-5b' ? (vram >= 16 ? 1280 : 960) : vram >= 40 ? 1280 : 832;
  const a = VIDEO_FAMILIES[f].align;
  const short = floorTo((long * 9) / 16, a);
  if (aspect === '9:16') return { width: short, height: long };
  if (aspect === '1:1') { const side = roundTo(Math.sqrt(long * short), a); return { width: side, height: side }; }
  return { width: long, height: short };
}

/** Wan makes 4n+1 frames (it packs four frames into one step of its memory). */
export const wanFrames = (n: number) => Math.max(5, Math.round((Math.max(1, n) - 1) / 4) * 4 + 1);

/** Frames in one clip: 2 s where memory is tight, up to 5 s on big cards. */
export function clipFrames(f: VideoFamily, vram: number): number {
  const s = VIDEO_FAMILIES[f];
  const seconds = f === 'wan21-1.3b' ? (vram < 10 ? 2 : 3) : f === 'wan22-5b' ? (vram < 16 ? 2 : 4) : vram < 40 ? 3 : 5;
  return wanFrames(seconds * s.fps);
}

export interface VideoAttempt {
  width: number; height: number; frames: number;
  /** Graphics memory (GiB) sd.cpp must leave free. */
  reserveGb: number;
  /** Also decode the video a few frames at a time (when this sd-cli has the switch). */
  temporal: boolean;
}

/**
 * What to try, in order, when a clip runs out of memory: the normal settings; then more memory left
 * free and the video decoded a few frames at a time; then half the frames; then a smaller picture.
 */
export function videoLadder(f: VideoFamily, first: Pick<VideoAttempt, 'width' | 'height' | 'frames'>): VideoAttempt[] {
  const a = VIDEO_FAMILIES[f].align;
  const half = wanFrames(Math.max(9, (first.frames - 1) / 2 + 1));
  const small = { width: roundTo(first.width * 0.75, a), height: roundTo(first.height * 0.75, a) };
  return [
    { ...first, reserveGb: 2, temporal: false },
    { ...first, reserveGb: 3, temporal: true },
    { ...first, frames: half, reserveGb: 3, temporal: true },
    { ...small, frames: half, reserveGb: 3, temporal: true },
  ];
}

export interface VideoPlan {
  family: VideoFamily;
  width: number; height: number;
  /** Frames per clip, and how many clips make up the length asked for. */
  frames: number; clips: number;
  fps: number;
  /** Seconds the clips add up to. */
  seconds: number;
  /** Rough minutes for all clips, before the first clip measures it. */
  minutes: number;
  /** Weights wait in RAM and the video is decoded in tiles (cards under 16 GB, and Macs). */
  lowVram: boolean;
}

export const MAX_VIDEO_SECONDS = 60;

/** How a request for `seconds` of footage is made on this computer. */
export function planVideo(f: VideoFamily, m: VideoMachine, o: { seconds?: number; aspect?: string } = {}): VideoPlan {
  const s = VIDEO_FAMILIES[f];
  const vram = usableVram(m);
  const { width, height } = clipSize(f, o.aspect, vram);
  const frames = clipFrames(f, vram);
  const per = (frames - 1) / s.fps;
  const want = Math.max(1, Math.min(MAX_VIDEO_SECONDS, Number(o.seconds) || per));
  const clips = Math.max(1, Math.min(30, Math.ceil(want / per - 0.15)));
  return { family: f, width, height, frames, clips, fps: s.fps, seconds: Math.round(clips * per * 10) / 10, minutes: Math.ceil(clips * s.minutesPerClip), lowVram: !!m.unified || vram < 16 };
}

/** "about 25 minutes", "about 2 hours". */
export function aboutTime(minutes: number): string {
  if (minutes < 90) return `about ${Math.max(1, Math.round(minutes))} minute${Math.round(minutes) === 1 ? '' : 's'}`;
  const h = Math.round(minutes / 30) / 2;
  return `about ${h} hour${h === 1 ? '' : 's'}`;
}

export const VIDEO_NEGATIVE = 'blurry, low quality, jpeg artifacts, flicker, static frame, still picture, watermark, subtitles, text, logo, distorted face, deformed hands, extra fingers, extra limbs, messy background, overexposed';

export interface VideoRun {
  prompt: string; negative?: string; seed: number;
  /** Start from this picture (models that can). */
  init?: string;
  output: string;
  lowVram: boolean;
  /** The installed sd-cli's --help, to pass only the switches it knows. */
  help: string;
}

/**
 * Command-line arguments for `sd-cli -M vid_gen`. `path(folder, file)` gives a file's full path under
 * Lotus Studio/Models/image. Switches an older sd-cli doesn't list in --help are left out.
 */
export function sdcppVideoArgs(f: VideoFamily, files: VideoFiles, at: VideoAttempt, run: VideoRun, path: (folder: 'diffusion_models' | 'vae' | 'text_encoders', file: string) => string): string[] {
  const s = VIDEO_FAMILIES[f];
  const has = (flag: string) => !run.help || run.help.includes(flag);
  const args = ['-M', 'vid_gen', '--diffusion-model', path('diffusion_models', files.model)];
  if (files.high) args.push('--high-noise-diffusion-model', path('diffusion_models', files.high));
  args.push('--vae', path('vae', files.vae), '--t5xxl', path('text_encoders', files.t5xxl));
  args.push('-p', run.prompt, '-n', run.negative || VIDEO_NEGATIVE);
  args.push('--cfg-scale', String(s.cfg), '--sampling-method', 'euler', '--steps', String(s.steps));
  if (files.high && s.highSteps) args.push('--high-noise-cfg-scale', String(s.cfg), '--high-noise-sampling-method', 'euler', '--high-noise-steps', String(s.highSteps));
  args.push('--flow-shift', String(s.shift));
  args.push('-W', String(at.width), '-H', String(at.height), '--video-frames', String(at.frames), '-s', String(run.seed));
  if (run.init && s.fromPicture) args.push('-i', run.init);
  if (has('--diffusion-fa')) args.push('--diffusion-fa');
  if (run.lowVram) {
    // Same rule as images: with auto-fit, leave memory spare and let sd.cpp keep the rest in RAM;
    // older builds only have --offload-to-cpu.
    if (run.help.includes('--auto-fit') && has('--max-vram')) args.push('--max-vram', String(-Math.max(1, Math.min(6, at.reserveGb))));
    else args.push('--offload-to-cpu');
  }
  // The Wan VAE needs a lot of memory for a whole clip: always decode in tiles.
  args.push('--vae-tiling');
  if (at.temporal && run.help.includes('--temporal-tiling')) args.push('--temporal-tiling');
  args.push('-o', run.output);
  return args;
}

/** Can this sd-cli make video at all? (Video mode arrived in sd.cpp in late 2025.) */
export const sdcppHasVideo = (help: string) => !help || /vid_gen|--video-frames/.test(help);

/** Sampling steps sd-cli draws a bar for in a video run (A14B: the high-noise expert's steps, then the rest). */
export function videoStepTotals(f: VideoFamily): number[] {
  const s = VIDEO_FAMILIES[f];
  return s.highSteps ? [s.highSteps, s.steps, s.steps + s.highSteps] : [s.steps];
}

/** Turns a plain request into a prompt Wan follows well: subject, action, place, camera, light. */
export function videoPrompt(text: string, style?: string): string {
  const t = text.replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
  const extra = style?.replace(/\s+/g, ' ').trim();
  const motion = /camera|pan|zoom|dolly|tracking|static shot|handheld/i.test(t) ? '' : ', smooth natural motion, steady camera';
  return `${t}${extra ? `, ${extra}` : ''}${motion}, high quality, detailed, cinematic lighting`;
}
