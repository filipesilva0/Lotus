// Video work with ffmpeg (0.21): the commands Lotus runs to understand, voice over and put videos
// together. Everything here builds argument lists or reads ffmpeg's output (pure, tested); running
// them is in video/run.ts.
//
//   probe        length, size, frame rate and whether there is sound (ffprobe JSON)
//   sheet        frames from across a video tiled into one picture a vision model can look at
//   chunks       the sound as 16 kHz mono WAV parts of under 30 s, for Whisper
//   mix          voiceover lines placed at their times into one WAV
//   render       scenes (pictures with slow pan and zoom, or video clips) joined with crossfades,
//                with the voiceover, the video's own sound (lowered or muted), music and subtitles

export interface VideoInfo { duration: number; width: number; height: number; fps: number; hasVideo: boolean; hasAudio: boolean }

/** ffprobe's JSON → what Lotus needs. A picture reads as a 0-second "video". */
export function parseProbe(json: unknown): VideoInfo {
  const o = (json ?? {}) as { format?: { duration?: string }; streams?: { codec_type?: string; width?: number; height?: number; r_frame_rate?: string; avg_frame_rate?: string; duration?: string }[] };
  const streams = Array.isArray(o.streams) ? o.streams : [];
  const v = streams.find((s) => s.codec_type === 'video');
  const rate = (r?: string) => { const [a, b] = String(r ?? '').split('/').map(Number); return a > 0 && b > 0 ? a / b : 0; };
  const fps = rate(v?.avg_frame_rate) || rate(v?.r_frame_rate);
  const duration = Number(o.format?.duration) || Number(v?.duration) || 0;
  return { duration: Math.max(0, Math.round(duration * 1000) / 1000), width: v?.width ?? 0, height: v?.height ?? 0, fps: Math.round(fps * 100) / 100, hasVideo: !!v, hasAudio: streams.some((s) => s.codec_type === 'audio') };
}

export const probeArgs = (file: string) => ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file];

/** Columns × rows for a sheet of n frames (n = 4…16). */
export function sheetGrid(n: number): { cols: number; rows: number } {
  const k = Math.max(1, Math.min(16, Math.round(n)));
  const cols = k <= 4 ? 2 : k <= 9 ? 3 : 4;
  return { cols, rows: Math.ceil(k / cols) };
}

/** When each tile of the sheet was taken (seconds), in reading order. */
export function sheetTimes(duration: number, n: number): number[] {
  const { cols, rows } = sheetGrid(n);
  const k = cols * rows;
  return Array.from({ length: k }, (_, i) => Math.round(((i + 0.5) * duration / k) * 10) / 10);
}

/**
 * One JPEG with `n` frames spread over the video, at most 1280 pixels wide, so a small vision model
 * sees the whole video in one look. Taking frames at fixed times (not every frame) keeps it fast.
 */
export function sheetArgs(file: string, out: string, info: Pick<VideoInfo, 'duration'>, n: number): string[] {
  const { cols, rows } = sheetGrid(n);
  const k = cols * rows;
  const w = Math.floor(1280 / cols / 2) * 2;
  const rate = info.duration > 0 ? `${k}/${Math.max(0.1, info.duration).toFixed(3)}` : '1';
  return ['-y', '-v', 'error', '-i', file, '-vf', `fps=${rate},scale=${w}:-2,tile=${cols}x${rows}:padding=4:color=black`, '-frames:v', '1', '-q:v', '4', out];
}

/** One frame at `at` seconds, up to 1024 pixels wide (a closer look than the sheet). */
export const frameArgs = (file: string, at: number, out: string) => ['-y', '-v', 'error', '-ss', String(Math.max(0, at)), '-i', file, '-frames:v', '1', '-vf', 'scale=min(1024\\,iw):-2', '-q:v', '3', out];

/** The sound as 16 kHz mono WAV parts of `seconds` each (Whisper hears 30 s at a time). */
export const chunkArgs = (file: string, pattern: string, seconds = 28) => ['-y', '-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-f', 'segment', '-segment_time', String(seconds), '-c:a', 'pcm_s16le', pattern];

// ── Voiceover ──────────────────────────────────────────────────────────────

export interface Line { text: string; start: number; end: number }

/**
 * Where each spoken line goes. One after another with a short pause, or at the times asked for
 * (narrating a video) but never on top of the line before. Returns the lines and the total length.
 */
export function layoutLines(texts: string[], durations: number[], o: { starts?: (number | undefined)[]; lead?: number; gap?: number; tail?: number; minTotal?: number } = {}): { lines: Line[]; total: number; moved: number } {
  const lead = o.lead ?? 0.3, gap = o.gap ?? 0.35, tail = o.tail ?? 0.6;
  const lines: Line[] = [];
  let t = lead, moved = 0;
  texts.forEach((text, i) => {
    const want = o.starts?.[i];
    let start = t;
    if (typeof want === 'number' && Number.isFinite(want) && want >= 0) {
      start = i === 0 ? want : Math.max(want, lines[i - 1].end + 0.1);
      if (start - want > 0.05) moved++;
    }
    const end = start + Math.max(0, durations[i] ?? 0);
    lines.push({ text, start: round(start), end: round(end) });
    t = end + gap;
  });
  const last = lines.length ? lines[lines.length - 1].end : 0;
  return { lines, total: round(Math.max(last + tail, o.minTotal ?? 0)), moved };
}

const round = (x: number) => Math.round(x * 1000) / 1000;

/** The lines as SubRip subtitles. */
export function srt(lines: Line[]): string {
  const ts = (s: number) => {
    const ms = Math.round(s * 1000);
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  return lines.map((l, i) => `${i + 1}\n${ts(l.start)} --> ${ts(l.end)}\n${l.text.replace(/\s+/g, ' ').trim()}\n`).join('\n');
}

/** Lotus voice effects (Voice → Voices) that ffmpeg can apply: loudness, warmth and clarity. */
export function effectFilters(fx?: { volume?: number; bass?: number; treble?: number; normalize?: boolean } | null): string[] {
  const out: string[] = [];
  if (fx?.bass) out.push(`bass=g=${clamp(fx.bass, -12, 12)}:f=200`);
  if (fx?.treble) out.push(`treble=g=${clamp(fx.treble, -12, 12)}:f=4000`);
  if (fx?.volume) out.push(`volume=${clamp(fx.volume, -12, 12)}dB`);
  if (fx?.normalize) out.push('dynaudnorm=p=0.89');
  return out;
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, Number(x) || 0));

/** The line clips placed at their start times in one mono 24 kHz WAV of `total` seconds. */
export function mixArgs(clips: { file: string; start: number }[], out: string, total: number, effects: string[] = []): string[] {
  const args = ['-y', '-v', 'error'];
  clips.forEach((c) => args.push('-i', c.file));
  const parts = clips.map((c, i) => `[${i}:a]aresample=24000,aformat=channel_layouts=mono,adelay=${Math.round(c.start * 1000)}:all=1[a${i}]`);
  const mixed = clips.length > 1 ? `${clips.map((_, i) => `[a${i}]`).join('')}amix=inputs=${clips.length}:normalize=0:duration=longest` : '[a0]anull';
  const chain = [mixed, ...effects, `apad=whole_dur=${total.toFixed(3)}`, `atrim=0:${total.toFixed(3)}`].join(',');
  args.push('-filter_complex', `${parts.join(';')};${chain}[out]`, '-map', '[out]', '-c:a', 'pcm_s16le', out);
  return args;
}

// ── Putting it together ────────────────────────────────────────────────────

export type Motion = 'in' | 'out' | 'left' | 'right' | 'none';
export interface Scene { file: string; kind: 'image' | 'video'; duration: number; /** Video clips: where to start in the clip (s). */ from?: number; motion?: Motion }

export interface RenderPlan {
  scenes: Scene[];
  width: number;
  height: number;
  fps?: number;
  /** Seconds of crossfade between scenes (0 = straight cuts). */
  fade?: number;
  voiceover?: string;
  /** A video scene's own sound when there is one video scene (narrating a video). */
  original?: 'keep' | 'lower' | 'mute';
  music?: string;
  subtitles?: string;
  encoder: Encoder;
  out: string;
}

export interface Encoder { name: string; container: 'mp4' | 'webm'; args: string[]; audio: string[] }

/** Encoders by preference. NVIDIA first (the RTX 4060 makes a minute of video in seconds). */
export const ENCODERS: Encoder[] = [
  { name: 'h264_nvenc', container: 'mp4', args: ['-c:v', 'h264_nvenc', '-preset', 'p5', '-cq', '23', '-pix_fmt', 'yuv420p'], audio: ['-c:a', 'aac', '-b:a', '160k'] },
  { name: 'libx264', container: 'mp4', args: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p'], audio: ['-c:a', 'aac', '-b:a', '160k'] },
  { name: 'h264_videotoolbox', container: 'mp4', args: ['-c:v', 'h264_videotoolbox', '-b:v', '6M', '-pix_fmt', 'yuv420p'], audio: ['-c:a', 'aac', '-b:a', '160k'] },
  { name: 'h264_qsv', container: 'mp4', args: ['-c:v', 'h264_qsv', '-global_quality', '23', '-pix_fmt', 'nv12'], audio: ['-c:a', 'aac', '-b:a', '160k'] },
  { name: 'h264_amf', container: 'mp4', args: ['-c:v', 'h264_amf', '-quality', 'balanced', '-rc', 'cqp', '-qp_i', '22', '-qp_p', '24', '-pix_fmt', 'yuv420p'], audio: ['-c:a', 'aac', '-b:a', '160k'] },
  { name: 'h264_mf', container: 'mp4', args: ['-c:v', 'h264_mf', '-b:v', '6M', '-pix_fmt', 'nv12'], audio: ['-c:a', 'aac', '-b:a', '160k'] },
  { name: 'libopenh264', container: 'mp4', args: ['-c:v', 'libopenh264', '-b:v', '6M', '-pix_fmt', 'yuv420p'], audio: ['-c:a', 'aac', '-b:a', '160k'] },
  { name: 'libvpx-vp9', container: 'webm', args: ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', '-deadline', 'realtime', '-cpu-used', '6', '-row-mt', '1', '-pix_fmt', 'yuv420p'], audio: ['-c:a', 'libopus', '-b:a', '128k'] },
  { name: 'mpeg4', container: 'mp4', args: ['-c:v', 'mpeg4', '-q:v', '3', '-pix_fmt', 'yuv420p'], audio: ['-c:a', 'aac', '-b:a', '160k'] },
];

/** `ffmpeg -encoders` → the encoders above that this ffmpeg has, best first. */
export function usableEncoders(listing: string): Encoder[] {
  const have = new Set(listing.split('\n').map((l) => /^\s*V[\w.]{5}\s+(\S+)/.exec(l)?.[1]).filter(Boolean) as string[]);
  return ENCODERS.filter((e) => have.has(e.name));
}

/** Size for a shape: 16:9 → 1280×720 (fits small GPUs and makes fast), 9:16 → 720×1280, 1:1 → 1080×1080. */
export function sizeFor(aspect: string | undefined): { width: number; height: number } {
  if (aspect === '9:16') return { width: 720, height: 1280 };
  if (aspect === '1:1') return { width: 1080, height: 1080 };
  if (aspect === '4:5') return { width: 864, height: 1080 };
  return { width: 1280, height: 720 };
}

const MOTIONS: Motion[] = ['in', 'right', 'out', 'left'];
/** A different slow move for each picture, so a slideshow doesn't feel stuck. */
export const motionFor = (i: number): Motion => MOTIONS[i % MOTIONS.length];

/** The zoompan expression for one move over `n` frames (pictures are scaled 2× first, so moves are smooth). */
export function zoompan(m: Motion, n: number, w: number, h: number, fps: number): string {
  const N = Math.max(1, n);
  const centre = `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
  const expr = m === 'in' ? `z='1+0.12*on/${N}':${centre}`
    : m === 'out' ? `z='1.12-0.12*on/${N}':${centre}`
    : m === 'right' ? `z='1.1':x='(iw-iw/zoom)*on/${N}':y='ih/2-(ih/zoom/2)'`
    : m === 'left' ? `z='1.1':x='(iw-iw/zoom)*(1-on/${N})':y='ih/2-(ih/zoom/2)'`
    : `z='1':${centre}`;
  return `zoompan=${expr}:d=${N}:s=${w}x${h}:fps=${fps}`;
}

/** The whole ffmpeg command for a render plan. */
export function renderArgs(p: RenderPlan): string[] {
  const fps = p.fps ?? 30;
  const W = p.width, H = p.height;
  const scenes = p.scenes;
  if (!scenes.length) throw new Error('A video needs at least one scene.');
  const fade = scenes.length > 1 ? Math.max(0, Math.min(p.fade ?? 0.5, ...scenes.map((s) => s.duration / 3))) : 0;
  const args = ['-y', '-nostdin', '-v', 'error', '-stats'];
  const filters: string[] = [];
  scenes.forEach((s, i) => {
    // Each scene but the last runs `fade` longer, so the crossfades don't shorten the video.
    const len = s.duration + (i < scenes.length - 1 ? fade : 0);
    if (s.kind === 'image') {
      args.push('-i', s.file);
      const n = Math.round(len * fps);
      filters.push(`[${i}:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},setsar=1,${zoompan(s.motion ?? 'none', n, W, H, fps)},trim=duration=${len.toFixed(3)},setpts=PTS-STARTPTS,format=yuv420p[v${i}]`);
    } else {
      args.push('-ss', String(Math.max(0, s.from ?? 0)), '-t', len.toFixed(3), '-i', s.file);
      filters.push(`[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${fps},tpad=stop_mode=clone:stop_duration=${len.toFixed(3)},trim=duration=${len.toFixed(3)},setpts=PTS-STARTPTS,format=yuv420p[v${i}]`);
    }
  });
  // Crossfades: each one starts where the scene before it would have ended.
  let last = '[v0]';
  let at = 0;
  for (let i = 1; i < scenes.length; i++) {
    at += scenes[i - 1].duration;
    const label = i === scenes.length - 1 ? '[vout]' : `[x${i}]`;
    filters.push(fade > 0 ? `${last}[v${i}]xfade=transition=fade:duration=${fade.toFixed(3)}:offset=${at.toFixed(3)}${label}` : `${last}[v${i}]concat=n=2:v=1:a=0${label}`);
    last = label;
  }
  if (scenes.length === 1) filters.push('[v0]null[vout]');
  const total = scenes.reduce((s, x) => s + x.duration, 0);

  // Sound: the voiceover, the narrated video's own sound, and music under everything.
  const sounds: string[] = [];
  let idx = scenes.length;
  if (p.voiceover) { args.push('-i', p.voiceover); filters.push(`[${idx}:a]aresample=48000,aformat=channel_layouts=stereo[vo]`); sounds.push('[vo]'); idx++; }
  const videos = scenes.map((s, i) => ({ s, i })).filter((x) => x.s.kind === 'video');
  if (videos.length === 1 && scenes.length === 1 && p.original && p.original !== 'mute') {
    filters.push(`[${videos[0].i}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${p.original === 'lower' && p.voiceover ? '0.25' : '1'}[orig]`);
    sounds.push('[orig]');
  }
  if (p.music) {
    args.push('-stream_loop', '-1', '-i', p.music);
    filters.push(`[${idx}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${p.voiceover ? '0.12' : '0.6'},afade=t=out:st=${Math.max(0, total - 2).toFixed(3)}:d=2[mus]`);
    sounds.push('[mus]'); idx++;
  }
  if (sounds.length) filters.push(`${sounds.join('')}${sounds.length > 1 ? `amix=inputs=${sounds.length}:normalize=0:duration=longest,` : ''}apad=whole_dur=${total.toFixed(3)},atrim=0:${total.toFixed(3)}[aout]`);
  // (A bare apad never ends and can keep ffmpeg running forever with some inputs: always give it the length.)
  const subs = p.subtitles && p.encoder.container === 'mp4' ? idx : -1;
  if (subs >= 0) args.push('-i', p.subtitles!);

  args.push('-filter_complex', filters.join(';'), '-map', '[vout]');
  if (sounds.length) args.push('-map', '[aout]');
  if (subs >= 0) args.push('-map', `${subs}:s`, '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng');
  args.push(...p.encoder.args, '-r', String(fps));
  if (sounds.length) args.push(...p.encoder.audio);
  args.push('-t', total.toFixed(3), '-metadata', 'comment=Made with Lotus');
  if (p.encoder.container === 'mp4') args.push('-movflags', '+faststart');
  args.push(p.out);
  return args;
}

/**
 * How long each scene lasts. Given lengths win; with a voiceover whose lines match the scenes one to
 * one, each scene lasts until the next line starts; otherwise the voiceover's length is shared out.
 */
export function sceneDurations(count: number, o: { given?: (number | undefined)[]; lines?: Line[]; total?: number; clipLengths?: (number | undefined)[]; perPicture?: number }): number[] {
  const out: number[] = [];
  const free: number[] = [];
  for (let i = 0; i < count; i++) {
    const g = o.given?.[i];
    if (typeof g === 'number' && g > 0) out.push(g);
    else { out.push(0); free.push(i); }
  }
  if (!free.length) return out.map(r1);
  if (o.lines?.length === count && o.total && free.length === count) {
    return o.lines.map((l, i) => r1((i === count - 1 ? o.total! : o.lines![i + 1].start) - (i === 0 ? 0 : l.start)));
  }
  if (o.total) {
    const left = Math.max(free.length, o.total - out.reduce((s, x) => s + x, 0));
    for (const i of free) out[i] = left / free.length;
    return out.map(r1);
  }
  for (const i of free) out[i] = o.clipLengths?.[i] || o.perPicture || 4;
  return out.map(r1);
}

const r1 = (x: number) => Math.max(0.5, Math.round(x * 100) / 100);

/** Seconds of audio in a WAV file's bytes (any sample rate or bit depth), 0 if it isn't a WAV. */
export function wavSeconds(b: Uint8Array): number {
  if (b.length < 44 || String.fromCharCode(...b.slice(0, 4)) !== 'RIFF') return 0;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 12, byteRate = 0;
  while (p + 8 <= b.length) {
    const id = String.fromCharCode(...b.slice(p, p + 4));
    let size = dv.getUint32(p + 4, true);
    if (id === 'fmt ') byteRate = dv.getUint32(p + 16, true);
    if (id === 'data') {
      // Streamed WAVs may say 0 or 0xFFFFFFFF; use what is really there.
      if (!size || size === 0xffffffff || p + 8 + size > b.length) size = b.length - p - 8;
      return byteRate ? Math.round((size / byteRate) * 1000) / 1000 : 0;
    }
    p += 8 + size + (size % 2);
  }
  return 0;
}

/** ffmpeg's progress line ("time=00:00:12.40") → seconds done. */
export function progressSeconds(line: string): number | null {
  const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}
