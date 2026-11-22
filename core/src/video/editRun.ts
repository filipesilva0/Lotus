// Runs the Video editor's work (0.22): reading footage (length, picture, preview copy), finding speech
// and scene changes, captions with Whisper, Shorts and the export. The thinking is in video/edit.ts.

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { encode, probe, runProgram, type VideoTools } from './run';
import {
  cleanCaption, cuesToSrt, fontsConf, joinArgs, loudness, pcmFromWav, perSecond, phrasePieces, proxyArgs, sceneArgs, segmentArgs, soundArgs, speechSpans,
  thumbArgs, timelineSegments, wavBytes, type Analysis, type CaptionStyle, type Cue, type Fit,
} from './edit';
import { sizeFor } from './ffmpeg';

/** What the editor's work needs from Lotus. */
export interface EditCtx {
  t: VideoTools;
  /** The project's folder (Lotus Studio/Work/<id>). */
  dir: string;
  signal?: AbortSignal;
  progress: (detail: string, fraction?: number) => void;
  /** Whisper: writes down what a WAV says (absent when no dictation model is downloaded). */
  transcribe?: (wav: string, o: { language?: string; signal?: AbortSignal }) => Promise<string>;
}

export const PICTURES = /\.(png|jpe?g|webp|bmp)$/i;
export const SOUNDS = /\.(wav|mp3|m4a|ogg|flac|opus|aac)$/i;
/** Longest stretch of sound Lotus reads at once (two hours: about 230 MB of samples). */
const MAX_SOUND = 2 * 3600;

const hidden = (dir: string, ...p: string[]) => { const d = join(dir, '.edit', ...p.slice(0, -1)); mkdirSync(d, { recursive: true }); return join(d, p[p.length - 1]); };
const scratch = (dir: string) => { const d = join(dir, '.edit', 'tmp', `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`); mkdirSync(d, { recursive: true }); return d; };
const stamp = (f: string) => { const s = statSync(f); return `${s.size}-${Math.round(s.mtimeMs)}`; };
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ── Reading footage ────────────────────────────────────────────────────────

export interface MediaInfo {
  file: string; kind: 'video' | 'picture' | 'audio'; duration: number; width: number; height: number; hasAudio: boolean;
  /** A small JPEG as a data: URL. */
  thumb?: string;
  /** A 360p copy for the preview exists (videos only). */
  proxy?: boolean;
}

/** Length, size, a thumbnail and a light preview copy of one file in the project. */
export async function readMedia(c: EditCtx, file: string): Promise<MediaInfo> {
  const full = join(c.dir, basename(file));
  if (!existsSync(full)) throw new Error(`${basename(file)} is no longer in this project's folder.`);
  const info = await probe(c.t, full, c.signal);
  const kind: MediaInfo['kind'] = PICTURES.test(file) || (info.hasVideo && info.duration < 0.1) ? 'picture' : !info.hasVideo && info.hasAudio ? 'audio' : 'video';
  if (!info.hasVideo && !info.hasAudio) throw new Error(`${basename(file)} isn't a video, picture or sound FFmpeg can read.`);
  const out: MediaInfo = { file: basename(file), kind, duration: kind === 'picture' ? 0 : info.duration, width: info.width, height: info.height, hasAudio: info.hasAudio };
  if (kind !== 'audio') {
    const thumb = hidden(c.dir, 'thumbs', `${basename(file)}.jpg`);
    try {
      if (!existsSync(thumb)) await runProgram(c.t.ffmpeg, thumbArgs(full, kind === 'video' ? Math.min(info.duration * 0.1, 5) : 0, thumb), { signal: c.signal });
      out.thumb = `data:image/jpeg;base64,${readFileSync(thumb).toString('base64')}`;
    } catch (e) { if ((e as Error).name === 'AbortError') throw e; /* no thumbnail: the bin shows an icon */ }
  }
  if (kind === 'video') out.proxy = existsSync(proxyPath(c.dir, out.file));
  return out;
}

export const proxyPath = (dir: string, file: string) => join(dir, '.edit', 'proxy', `${basename(file)}.mp4`);

/** The 360p preview copy of a video (made once; quick with the graphics card's encoder). */
export async function makeProxy(c: EditCtx, file: string, duration: number): Promise<string> {
  const want = proxyPath(c.dir, file);
  if (existsSync(want)) return want;
  mkdirSync(join(c.dir, '.edit', 'proxy'), { recursive: true });
  const part = `${want}.part`;
  const r = await encode(c.t, proxyArgs(join(c.dir, basename(file))), (k) => (k === 'mp4' ? `${part}.mp4` : `${part}.webm`), {
    signal: c.signal, quality: 'proxy', onSeconds: (s) => c.progress(`Making a preview copy of ${basename(file)}`, duration ? Math.min(1, s / duration) : undefined),
  });
  // A webm preview (no H.264 encoder) is kept under the same name; the browser reads either.
  writeFileSync(want, readFileSync(r.file));
  rmSync(r.file, { force: true });
  return want;
}

// ── Listening and watching ─────────────────────────────────────────────────

/** The sound as 16 kHz samples (first two hours). */
async function samplesOf(c: EditCtx, file: string, o: { from?: number; seconds?: number } = {}): Promise<{ samples: Int16Array; rate: number }> {
  const tmp = scratch(c.dir);
  try {
    const wav = join(tmp, 'sound.wav');
    await runProgram(c.t.ffmpeg, soundArgs(file, wav, { from: o.from, seconds: Math.min(o.seconds ?? MAX_SOUND, MAX_SOUND) }), { signal: c.signal });
    const pcm = pcmFromWav(new Uint8Array(readFileSync(wav)));
    if (!pcm) throw new Error(`Couldn't read the sound of ${basename(file)}.`);
    return pcm;
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/**
 * Where people talk, how loud each second is, and where the picture changes. Kept next to the file
 * so asking again (another Short, another cut) is instant.
 */
export async function analyse(c: EditCtx, file: string): Promise<Analysis> {
  const full = join(c.dir, basename(file));
  const cache = hidden(c.dir, 'analysis', `${basename(file)}.json`);
  const key = stamp(full);
  try { const hit = JSON.parse(readFileSync(cache, 'utf8')); if (hit.key === key) return hit.a as Analysis; } catch { /* first time */ }
  const info = await probe(c.t, full, c.signal);
  const a: Analysis = { duration: info.duration, speech: [], loud: [], scenes: [], hasAudio: info.hasAudio };
  if (info.hasAudio) {
    c.progress(`Listening to ${basename(file)}`);
    const { samples, rate } = await samplesOf(c, full);
    const db = loudness(samples, rate);
    a.speech = speechSpans(db);
    a.loud = perSecond(db).map((x) => Math.round(x * 10) / 10);
  }
  if (info.hasVideo && info.duration > 1.5) {
    c.progress(`Looking for scene changes in ${basename(file)}`, 0);
    const times: number[] = [];
    await runProgram(c.t.ffmpeg, sceneArgs(full), {
      signal: c.signal,
      onLine: (l) => {
        const m = /pts_time:\s*([\d.]+)/.exec(l); if (m) times.push(Number(m[1]));
        const p = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(l); if (p && info.duration) c.progress(`Looking for scene changes in ${basename(file)}`, Math.min(1, (Number(p[1]) * 3600 + Number(p[2]) * 60 + Number(p[3])) / info.duration));
      },
    });
    a.scenes = times.filter((t, i, all) => t > 0.2 && (i === 0 || t - all[i - 1] >= 0.5)).map((t) => Math.round(t * 1000) / 1000);
  }
  writeFileSync(cache, JSON.stringify({ key, a }));
  return a;
}

/**
 * What is said, as captions with real times: the speech is found from the sound, cut into short
 * phrases at pauses, and each phrase goes to Whisper on its own. `from`/`seconds` read only part.
 */
export async function captionsFor(c: EditCtx, file: string, o: { language?: string; from?: number; seconds?: number; offset?: number } = {}): Promise<Cue[]> {
  if (!c.transcribe) throw new Error('Captions need a dictation model (Whisper). Download one in Settings → Models → Dictation, then try again.');
  const full = file.includes('/') || file.includes('\\') ? file : join(c.dir, basename(file));
  c.progress(`Listening to ${basename(file)}`);
  const { samples, rate } = await samplesOf(c, full, { from: o.from, seconds: o.seconds });
  const frame = 0.05;
  const db = loudness(samples, rate, frame);
  const pieces = phrasePieces(speechSpans(db, frame), db, frame, 6.5);
  const tmp = scratch(c.dir);
  const cues: Cue[] = [];
  const shift = o.offset ?? 0;
  try {
    for (let i = 0; i < pieces.length; i++) {
      if (c.signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      const p = pieces[i];
      c.progress(`Writing captions · ${clock(p.start)} of ${clock(samples.length / rate)}`, (i + 1) / pieces.length);
      const a = Math.max(0, Math.floor((p.start - 0.1) * rate)), b = Math.min(samples.length, Math.ceil((p.end + 0.1) * rate));
      const f = join(tmp, `p${i}.wav`);
      writeFileSync(f, wavBytes(samples.subarray(a, b), rate));
      const text = cleanCaption(await c.transcribe(f, { language: o.language, signal: c.signal }).catch((e) => { if ((e as Error).name === 'AbortError') throw e; return ''; }));
      rmSync(f, { force: true });
      // Whisper sometimes "hears" thanks-for-watching in noise: drop pieces that are only that.
      if (text && !/^(thanks? (you )?for watching[.!]?|you|\.+)$/i.test(text)) cues.push({ start: r3(p.start + shift), end: r3(p.end + shift), text });
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  return cues;
}

// ── Making videos ──────────────────────────────────────────────────────────

/** FONTCONFIG_FILE for burned-in captions, so FFmpeg finds this computer's fonts. */
export function fontsEnv(tmp: string): Record<string, string> {
  const f = join(tmp, 'fonts.conf');
  mkdirSync(join(tmp, 'fc'), { recursive: true });
  writeFileSync(f, fontsConf(process.platform, join(tmp, 'fc'), homedir()));
  return { FONTCONFIG_FILE: f };
}

export interface TimelineClip { file: string; from: number; to: number; volume?: number }
export interface ExportPlan {
  clips: TimelineClip[];
  aspect: string;
  fit: Fit;
  fade: number;
  voiceover?: string;
  voiceVolume?: number;
  music?: string;
  musicVolume?: number;
  captions?: Cue[];
  captionStyle?: CaptionStyle;
  burn?: boolean;
  filename: string;
}

/**
 * The export: each clip made the same size with its sound (one at a time, so a long timeline never
 * needs much memory), then joined with the voiceover, music and captions.
 */
export async function exportTimeline(c: EditCtx, p: ExportPlan, media: Map<string, { kind: 'video' | 'picture' | 'audio'; hasAudio: boolean }>): Promise<{ file: string; seconds: number; encoder: string; captions: 'burned' | 'attached' | 'none' }> {
  const clips = p.clips.filter((x) => x.to - x.from > 0.05).slice(0, 300);
  if (!clips.length) throw new Error('The timeline is empty: add a clip first.');
  const { width, height } = sizeFor(p.aspect);
  const fps = 30;
  const segs = timelineSegments(clips.map((x) => ({ seconds: x.to - x.from })), p.fade);
  const total = segs.reduce((s, x) => s + x.seconds, 0);
  const tmp = scratch(c.dir);
  try {
    const made: { file: string; seconds: number }[] = [];
    let done = 0;
    for (let i = 0; i < clips.length; i++) {
      const x = clips[i];
      const m = media.get(basename(x.file));
      if (!m || m.kind === 'audio') throw new Error(`${basename(x.file)} can't be a clip: it isn't a video or picture in this project.`);
      const args = segmentArgs({ file: join(c.dir, basename(x.file)), kind: m.kind, from: x.from, seconds: segs[i].play, hasAudio: m.hasAudio, width, height, fps, fit: p.fit, volume: x.volume, motion: m.kind === 'picture' ? (['in', 'right', 'out', 'left'] as const)[i % 4] : 'none' });
      const r = await encode(c.t, args, (k) => join(tmp, `seg${String(i).padStart(3, '0')}.${k}`), {
        signal: c.signal, quality: 'segment', onSeconds: (s) => c.progress(`Preparing clip ${i + 1} of ${clips.length}`, Math.min(0.85, ((done + Math.min(s, segs[i].play)) / total) * 0.85)),
      });
      made.push({ file: r.file, seconds: segs[i].seconds });
      done += segs[i].seconds;
    }
    const vertical = height > width;
    let captions: { file: string; burn: boolean; style: CaptionStyle; width: number; height: number } | undefined;
    if (p.captions?.length) {
      writeFileSync(join(tmp, 'captions.srt'), cuesToSrt(p.captions.filter((x) => x.start < total), p.captionStyle ?? 'clean', vertical));
      captions = { file: 'captions.srt', burn: p.burn !== false, style: p.captionStyle ?? 'clean', width, height };
    }
    const vo = p.voiceover ? join(c.dir, basename(p.voiceover)) : undefined;
    const mus = p.music ? join(c.dir, basename(p.music)) : undefined;
    const name = safeName(p.filename, 'export');
    const join1 = async (cap: typeof captions) => {
      const { args } = joinArgs({ segments: made.map((m) => ({ file: m.file, seconds: m.seconds })), fade: p.fade, voiceover: vo, voiceVolume: p.voiceVolume, music: mus, musicVolume: p.musicVolume, captions: cap, fps });
      return encode(c.t, args, (k) => join(c.dir, `${name}.${k}`), { signal: c.signal, cwd: tmp, env: cap?.burn ? fontsEnv(tmp) : undefined, onSeconds: (s) => c.progress('Putting it all together', 0.85 + Math.min(0.15, (s / total) * 0.15)) });
    };
    let r: { file: string; encoder: string }, how: 'burned' | 'attached' | 'none' = captions ? (captions.burn ? 'burned' : 'attached') : 'none';
    try { r = await join1(captions); } catch (e) {
      // Burned-in captions need fonts; if this FFmpeg can't draw them, attach them instead of failing.
      if ((e as Error).name === 'AbortError' || !captions?.burn) throw e;
      r = await join1({ ...captions, burn: false }); how = 'attached';
    }
    return { file: basename(r.file), seconds: r3(total), encoder: r.encoder, captions: how };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/** A file name for something the editor makes: letters, numbers, dashes; no folders. */
export function safeName(raw: string | undefined, fallback: string): string {
  const n = String(raw ?? '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, '-').slice(0, 60);
  return n || fallback;
}

/** A free file name in the folder: export.mp4, export-2.mp4… */
export function freeName(dir: string, base: string, ext = 'mp4'): string {
  for (let i = 1; i < 1000; i++) { const n = i === 1 ? base : `${base}-${i}`; if (!existsSync(join(dir, `${n}.${ext}`)) && !existsSync(join(dir, `${n}.webm`))) return n; }
  return `${base}-${Date.now()}`;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
