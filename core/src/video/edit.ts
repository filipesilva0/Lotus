// The Video editor's thinking (0.22): everything here is pure and tested (core/test/video-edit.test.ts).
// Running ffmpeg and Whisper is in video/editRun.ts.
//
//   speech      where people talk, found from the sound itself (loudness every 50 ms), so captions get
//               real times and pauses can be cut without asking a model
//   captions    what is said as short timed lines, in a few looks (clean, bold for Shorts, boxed)
//   scenes      where the picture changes (ffmpeg's scene score)
//   shorts      the best 15–60 s moments of a long video for Shorts, Reels and TikTok
//   auto edit   a first cut from the footage you added: the best bit of each shot, or a talking video
//               with its pauses taken out
//   segments    each clip of the timeline made the same size and frame rate, with sound, before joining
//
// Everything stays light enough for an 8 GB graphics card and a normal laptop: the sound is read once
// at 16 kHz, scene changes are found on a 192-pixel-wide copy, and the export makes one clip at a time.

import type { Line } from './ffmpeg';

export interface Span { start: number; end: number }
export interface Cue { start: number; end: number; text: string }

// ── Sound ──────────────────────────────────────────────────────────────────

/** The samples of a 16-bit PCM WAV (the first channel), or null when it isn't one. */
export function pcmFromWav(b: Uint8Array): { samples: Int16Array; rate: number } | null {
  if (b.length < 44 || String.fromCharCode(...b.slice(0, 4)) !== 'RIFF' || String.fromCharCode(...b.slice(8, 12)) !== 'WAVE') return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 12, rate = 0, channels = 1, bits = 16;
  while (p + 8 <= b.length) {
    const id = String.fromCharCode(...b.slice(p, p + 4));
    let size = dv.getUint32(p + 4, true);
    if (id === 'fmt ') { channels = dv.getUint16(p + 10, true) || 1; rate = dv.getUint32(p + 12, true); bits = dv.getUint16(p + 22, true); }
    if (id === 'data') {
      if (!size || size === 0xffffffff || p + 8 + size > b.length) size = b.length - p - 8;
      if (bits !== 16 || !rate) return null;
      const n = Math.floor(size / 2 / channels);
      const out = new Int16Array(n);
      for (let i = 0; i < n; i++) out[i] = dv.getInt16(p + 8 + i * 2 * channels, true);
      return { samples: out, rate };
    }
    p += 8 + size + (size % 2);
  }
  return null;
}

/** Loudness (dBFS) of every `frame` seconds of sound. Silence reads as -90. */
export function loudness(samples: Int16Array, rate: number, frame = 0.05): Float32Array {
  const step = Math.max(1, Math.round(rate * frame));
  const out = new Float32Array(Math.ceil(samples.length / step));
  for (let f = 0; f < out.length; f++) {
    let sum = 0;
    const a = f * step, b = Math.min(samples.length, a + step);
    for (let i = a; i < b; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / Math.max(1, b - a)) / 32768;
    out[f] = rms > 0 ? Math.max(-90, 20 * Math.log10(rms)) : -90;
  }
  return out;
}

const percentile = (xs: ArrayLike<number>, q: number) => {
  const s = Array.from(xs).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))] : -90;
};

/**
 * Where there is speech (or any sound worth keeping), from the loudness frames. The line between
 * sound and quiet is set from this recording's own quiet and loud parts, so it works for a quiet
 * phone recording and a loud screen capture alike.
 */
export function speechSpans(db: ArrayLike<number>, frame = 0.05, o: { minSilence?: number; minSpeech?: number; pad?: number } = {}): Span[] {
  const minSilence = o.minSilence ?? 0.35, minSpeech = o.minSpeech ?? 0.2, pad = o.pad ?? 0.08;
  if (!db.length) return [];
  const floor = percentile(db, 0.1), peak = percentile(db, 0.95);
  if (peak < -60 || peak - floor < 6) return peak < -60 ? [] : [{ start: 0, end: r3(db.length * frame) }];
  const line = Math.max(floor + 6, floor + 0.3 * (peak - floor));
  const spans: Span[] = [];
  let start = -1, quiet = 0;
  for (let i = 0; i <= db.length; i++) {
    const loud = i < db.length && db[i] >= line;
    if (loud) { if (start < 0) start = i; quiet = 0; continue; }
    if (start < 0) continue;
    quiet++;
    if (quiet * frame >= minSilence || i === db.length) {
      const end = i - quiet + 1;
      if ((end - start) * frame >= minSpeech) spans.push({ start: start * frame, end: end * frame });
      start = -1; quiet = 0;
    }
  }
  const total = db.length * frame;
  return spans.map((s) => ({ start: r3(Math.max(0, s.start - pad)), end: r3(Math.min(total, s.end + pad)) }));
}

/**
 * Speech cut into pieces short enough for one caption and for Whisper (at most `max` seconds),
 * cutting long ones at their quietest moment so a word isn't cut in half.
 */
export function phrasePieces(spans: Span[], db: ArrayLike<number>, frame = 0.05, max = 7): Span[] {
  const out: Span[] = [];
  const cut = (s: Span) => {
    if (s.end - s.start <= max) { out.push(s); return; }
    // The quietest frame between 40% and 75% of the way, so pieces come out even-ish.
    const a = Math.floor((s.start + (s.end - s.start) * 0.4) / frame), b = Math.ceil((s.start + Math.min(max, (s.end - s.start) * 0.75)) / frame);
    let best = a;
    for (let i = a; i <= b && i < db.length; i++) if (db[i] < db[best]) best = i;
    const at = Math.min(s.end - 0.5, Math.max(s.start + 0.5, best * frame));
    cut({ start: s.start, end: r3(at) });
    cut({ start: r3(at), end: s.end });
  };
  spans.forEach(cut);
  return out;
}

/** Average loudness of each whole second (for picking lively moments). */
export function perSecond(db: ArrayLike<number>, frame = 0.05): number[] {
  const n = Math.max(1, Math.round(1 / frame));
  const out: number[] = [];
  for (let i = 0; i < db.length; i += n) {
    let s = 0, k = 0;
    for (let j = i; j < Math.min(db.length, i + n); j++) { s += db[j]; k++; }
    out.push(k ? s / k : -90);
  }
  return out;
}

// ── Captions ───────────────────────────────────────────────────────────────

export type CaptionStyle = 'clean' | 'bold' | 'boxed' | 'big';

export const CAPTION_STYLES: Record<CaptionStyle, { label: string; hint: string; words: number }> = {
  clean: { label: 'Clean', hint: 'White words with a thin outline at the bottom. Fits anything.', words: 12 },
  bold: { label: 'Bold', hint: 'Big yellow words, a few at a time, low in the middle. Made for Shorts and Reels.', words: 4 },
  boxed: { label: 'Boxed', hint: 'White words on a dark box. Easy to read on busy footage.', words: 10 },
  big: { label: 'One word', hint: 'One or two huge words at a time, in the middle. Punchy.', words: 2 },
};

/** Whisper's text tidied: no "[music]" or "(laughs)" tags, single spaces. */
export function cleanCaption(t: string): string {
  return String(t ?? '').replace(/\[[^\]]*\]|\([^)]*\)|♪/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Captions split for a look: long lines become pieces of at most `words` words, each shown for its
 * share of the time (by letters, since long words take longer to say).
 */
export function splitCues(cues: Cue[], words: number): Cue[] {
  const out: Cue[] = [];
  for (const c of cues) {
    const w = cleanCaption(c.text).split(' ').filter(Boolean);
    if (!w.length) continue;
    if (w.length <= words) { out.push({ ...c, text: w.join(' ') }); continue; }
    const groups: string[][] = [];
    const n = Math.ceil(w.length / words);
    const per = Math.ceil(w.length / n);
    for (let i = 0; i < w.length; i += per) groups.push(w.slice(i, i + per));
    const letters = groups.map((g) => g.join(' ').length + 2);
    const all = letters.reduce((s, x) => s + x, 0);
    let t = c.start;
    groups.forEach((g, i) => {
      const len = ((c.end - c.start) * letters[i]) / all;
      out.push({ start: r3(t), end: r3(i === groups.length - 1 ? c.end : t + len), text: g.join(' ') });
      t += len;
    });
  }
  return out;
}

/** A caption broken into at most two lines of about `max` letters. */
export function wrapCaption(text: string, max = 42): string {
  const t = cleanCaption(text);
  if (t.length <= max) return t;
  const words = t.split(' ');
  let best = 0, bestDiff = Infinity, left = 0;
  for (let i = 1; i < words.length; i++) {
    left += words[i - 1].length + (i > 1 ? 1 : 0);
    const diff = Math.abs(left - (t.length - left - 1));
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  }
  return best ? `${words.slice(0, best).join(' ')}\n${words.slice(best).join(' ')}` : t;
}

/** Captions as SubRip (with each wrapped to two lines). */
export function cuesToSrt(cues: Cue[], style: CaptionStyle = 'clean', vertical = false): string {
  const max = vertical ? 24 : 42;
  const ts = (s: number) => {
    const ms = Math.max(0, Math.round(s * 1000));
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  return splitCues(cues, CAPTION_STYLES[style].words).filter((c) => c.end > c.start)
    .map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${wrapCaption(c.text, max)}\n`).join('\n');
}

/** SubRip text → captions (for files people bring, or ones Lotus made before). */
export function parseSrt(text: string): Cue[] {
  const t = (s: string) => { const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(s); return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0').slice(0, 3)) / 1000 : NaN; };
  return String(text ?? '').replace(/\r/g, '').split(/\n\s*\n/).map((block) => {
    const lines = block.split('\n').filter((l) => l.trim());
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0) return null;
    const [a, b] = lines[at].split('-->');
    const start = t(a), end = t(b);
    const text = lines.slice(at + 1).join(' ').trim();
    return Number.isFinite(start) && Number.isFinite(end) && text ? { start, end, text } : null;
  }).filter((c): c is Cue => !!c);
}

/** Voiceover lines (video.voiceover's timing) → captions. */
export const linesToCues = (lines: Line[]): Cue[] => lines.map((l) => ({ start: l.start, end: l.end, text: l.text }));

/**
 * libass's look for each style. Sizes are in libass's 288-line canvas, so they scale with the video;
 * a tall video gets smaller letters so a line still fits across.
 */
export function assStyle(style: CaptionStyle, width: number, height: number): string {
  const tall = height > width;
  const k = tall ? 0.62 : 1;
  const base = ['FontName=Arial', 'Bold=1', 'Alignment=2', 'Shadow=0'];
  const s = {
    clean: [...base.filter((x) => x !== 'Bold=1'), `FontSize=${Math.round(16 * k)}`, 'PrimaryColour=&H00FFFFFF', 'OutlineColour=&H00000000', 'BorderStyle=1', 'Outline=1.2', `MarginV=${tall ? 40 : 16}`],
    bold: [...base, `FontSize=${Math.round(24 * k)}`, 'PrimaryColour=&H0000E5FF', 'OutlineColour=&H00000000', 'BorderStyle=1', 'Outline=2.4', `MarginV=${tall ? 70 : 30}`],
    boxed: [...base.filter((x) => x !== 'Bold=1'), `FontSize=${Math.round(15 * k)}`, 'PrimaryColour=&H00FFFFFF', 'OutlineColour=&H80000000', 'BackColour=&H80000000', 'BorderStyle=3', 'Outline=4', `MarginV=${tall ? 40 : 16}`],
    big: [...base.filter((x) => x !== 'Alignment=2'), 'Alignment=5', `FontSize=${Math.round(34 * k)}`, 'PrimaryColour=&H00FFFFFF', 'OutlineColour=&H00000000', 'BorderStyle=1', 'Outline=3'],
  }[style];
  return s.join(',');
}

/** The fonts file that lets FFmpeg's captions find this computer's fonts (the Windows build has none). */
export function fontsConf(platform: string, cache: string, home = ''): string {
  const dirs = platform === 'win32' ? ['C:\\Windows\\Fonts', `${home}\\AppData\\Local\\Microsoft\\Windows\\Fonts`]
    : platform === 'darwin' ? ['/System/Library/Fonts', '/Library/Fonts', `${home}/Library/Fonts`]
    : ['/usr/share/fonts', '/usr/local/share/fonts', `${home}/.local/share/fonts`, `${home}/.fonts`];
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n${dirs.filter((d) => !d.startsWith('\\') && !d.startsWith('/.')).map((d) => `  <dir>${esc(d)}</dir>`).join('\n')}\n  <cachedir>${esc(cache)}</cachedir>\n  <alias><family>Arial</family><prefer><family>Arial</family><family>Liberation Sans</family><family>DejaVu Sans</family><family>Helvetica</family></prefer></alias>\n</fontconfig>\n`;
}

// ── Scenes ─────────────────────────────────────────────────────────────────

/** Finds where the picture changes, on a tiny copy so it's quick. Read the times with parseSceneTimes. */
export const sceneArgs = (file: string, threshold = 0.32) => ['-hide_banner', '-nostdin', '-i', file, '-an', '-sn', '-vf', `scale=192:-2,select='gt(scene\\,${threshold})',showinfo`, '-f', 'null', '-'];

/** ffmpeg's showinfo lines → the times of the scene changes (sorted, at least 0.5 s apart). */
export function parseSceneTimes(stderr: string): number[] {
  const out: number[] = [];
  for (const m of String(stderr).matchAll(/pts_time:\s*([\d.]+)/g)) {
    const t = Number(m[1]);
    if (Number.isFinite(t) && t > 0.2 && (!out.length || t - out[out.length - 1] >= 0.5)) out.push(r3(t));
  }
  return out.sort((a, b) => a - b);
}

/** A video's shots: the stretches between scene changes. */
export function shotsOf(duration: number, cuts: number[]): Span[] {
  const pts = [0, ...cuts.filter((c) => c > 0.2 && c < duration - 0.2), duration];
  const out: Span[] = [];
  for (let i = 0; i < pts.length - 1; i++) if (pts[i + 1] - pts[i] > 0.05) out.push({ start: pts[i], end: pts[i + 1] });
  return out;
}

const overlap = (a: Span, b: Span) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
const covered = (s: Span, spans: Span[]) => spans.reduce((x, p) => x + overlap(s, p), 0);

// ── Shorts ─────────────────────────────────────────────────────────────────

export interface Analysis { duration: number; speech: Span[]; loud: number[]; scenes: number[]; hasAudio: boolean }
export interface Moment extends Span { score: number; text: string }

/**
 * The best moments of a long video for Shorts: each starts where someone starts talking (or a new
 * shot), ends at the end of a sentence near the length asked for, and is scored by how much is said,
 * how lively the sound is and how much happens on screen. They never overlap.
 */
export function findMoments(a: Analysis, o: { count?: number; seconds?: number; min?: number; max?: number; cues?: Cue[] } = {}): Moment[] {
  const target = clampN(o.seconds ?? 30, 10, 90);
  const min = o.min ?? Math.max(8, target * 0.6), max = o.max ?? Math.min(90, target * 1.4);
  const count = clampN(o.count ?? 3, 1, 10);
  if (a.duration <= min + 1) return [{ start: 0, end: r3(a.duration), score: 1, text: textIn(o.cues, { start: 0, end: a.duration }) }];
  const ends = [...a.speech.map((s) => s.end), ...a.scenes, a.duration].sort((x, y) => x - y);
  const starts = [...new Set([0, ...a.speech.map((s) => s.start), ...a.scenes].map((x) => r3(x)))].filter((s) => s <= a.duration - min).sort((x, y) => x - y);
  const loudMax = Math.max(...a.loud, -90), loudMin = Math.min(...a.loud, loudMax);
  const cands: Moment[] = [];
  for (const s of starts) {
    const fits = ends.filter((e) => e - s >= min && e - s <= max);
    const end = fits.length ? fits.reduce((b, e) => (Math.abs(e - s - target) < Math.abs(b - s - target) ? e : b)) : Math.min(a.duration, s + target);
    const span = { start: s, end };
    const len = end - s;
    if (len < Math.min(min, a.duration) - 0.01) continue;
    const talk = a.hasAudio ? covered(span, a.speech) / len : 0;
    const secs = a.loud.slice(Math.floor(s), Math.ceil(end));
    const lively = secs.length && loudMax > loudMin ? (secs.reduce((x, y) => x + y, 0) / secs.length - loudMin) / (loudMax - loudMin) : 0.5;
    const cuts = a.scenes.filter((c) => c > s && c < end).length / Math.max(1, len / 10);
    // A start mid-sentence reads badly: count it down.
    const clean = a.speech.some((p) => Math.abs(p.start - s) < 0.3) || a.scenes.some((c) => Math.abs(c - s) < 0.3) || s === 0 ? 1 : 0.6;
    const score = (talk * 1 + lively * 0.6 + Math.min(1, cuts) * 0.3 + 0.1) * clean;
    cands.push({ start: r3(s), end: r3(end), score: Math.round(score * 1000) / 1000, text: '' });
  }
  cands.sort((x, y) => y.score - x.score || x.start - y.start);
  const picked: Moment[] = [];
  for (const c of cands) {
    if (picked.length >= count) break;
    if (picked.some((p) => overlap(p, c) > 0.5)) continue;
    picked.push({ ...c, text: textIn(o.cues, c) });
  }
  return picked;
}

const textIn = (cues: Cue[] | undefined, s: Span) => (cues ?? []).filter((c) => overlap(c, s) > 0.3 * (c.end - c.start)).map((c) => cleanCaption(c.text)).join(' ').slice(0, 280);

// ── Auto edit ──────────────────────────────────────────────────────────────

export interface Footage { file: string; kind: 'video' | 'picture'; duration: number; analysis?: Analysis }
export interface EditClip { file: string; from: number; to: number }

/**
 * A highlight reel from all the footage: the liveliest 1.5–4 s of each shot (where someone talks,
 * if anyone does), kept in the order the footage was added, cut down to about `seconds`. Every file
 * gets at least one piece when there's room, so nothing you added is left out by surprise.
 */
export function planHighlights(items: Footage[], o: { seconds?: number; shortest?: number; longest?: number } = {}): EditClip[] {
  const lo = o.shortest ?? 1.5, hi = o.longest ?? 4;
  type Piece = EditClip & { item: number; score: number };
  const pieces: Piece[] = [];
  items.forEach((it, item) => {
    if (it.kind === 'picture') { pieces.push({ file: it.file, from: 0, to: 3, item, score: 0.5 }); return; }
    const a = it.analysis;
    const shots = shotsOf(it.duration, a?.scenes ?? []);
    // One long shot (a phone video) is cut into a piece every ~6 s instead.
    const parts = shots.length === 1 && it.duration > 8 ? Array.from({ length: Math.floor(it.duration / 6) }, (_, k) => ({ start: k * 6, end: Math.min(it.duration, k * 6 + 6) })) : shots;
    const loudMax = Math.max(-90, ...(a?.loud ?? [-90])), loudMin = Math.min(loudMax, ...(a?.loud ?? [loudMax]));
    for (const s of parts) {
      const len = s.end - s.start;
      if (len < 0.8) continue;
      const take = Math.min(hi, Math.max(Math.min(lo, len), len * 0.5));
      // Start at the first speech in the shot, else in the middle of it.
      const talk = (a?.speech ?? []).find((p) => p.end > s.start + 0.2 && p.start < s.end - 0.5);
      let from = talk ? Math.max(s.start, talk.start) : s.start + (len - take) / 2;
      from = Math.min(from, s.end - take);
      const span = { start: from, end: from + take };
      const secs = (a?.loud ?? []).slice(Math.floor(span.start), Math.ceil(span.end));
      const lively = secs.length && loudMax > loudMin ? (secs.reduce((x, y) => x + y, 0) / secs.length - loudMin) / (loudMax - loudMin) : 0.4;
      const speech = a?.speech.length ? covered(span, a.speech) / take : 0;
      pieces.push({ file: it.file, from: r3(from), to: r3(from + take), item, score: speech + lively * 0.7 + (len > 2 ? 0.2 : 0) });
    }
  });
  if (!pieces.length) return [];
  const all = pieces.reduce((s, p) => s + p.to - p.from, 0);
  const target = o.seconds && o.seconds > 0 ? o.seconds : Math.min(all, 60);
  const keep = new Set<Piece>();
  let used = 0;
  // First the best piece of each file, then the best of the rest, until the length is reached.
  for (let i = 0; i < items.length; i++) {
    const best = pieces.filter((p) => p.item === i).sort((x, y) => y.score - x.score)[0];
    if (best && used + (best.to - best.from) <= target + 1) { keep.add(best); used += best.to - best.from; }
  }
  for (const p of [...pieces].sort((x, y) => y.score - x.score)) {
    if (keep.has(p)) continue;
    if (used + (p.to - p.from) > target + 0.5) continue;
    keep.add(p); used += p.to - p.from;
  }
  return pieces.filter((p) => keep.has(p)).sort((x, y) => x.item - y.item || x.from - y.from).map(({ file, from, to }) => ({ file, from, to }));
}

/**
 * A talking video tightened: only the parts where someone speaks, with a little air around each,
 * and pauses shorter than `gap` kept so it doesn't feel chopped.
 */
export function planTighten(items: Footage[], o: { pad?: number; gap?: number } = {}): EditClip[] {
  const pad = o.pad ?? 0.15, gap = o.gap ?? 0.45;
  const out: EditClip[] = [];
  for (const it of items) {
    if (it.kind === 'picture') { out.push({ file: it.file, from: 0, to: 3 }); continue; }
    const speech = it.analysis?.speech ?? [];
    if (!speech.length) { out.push({ file: it.file, from: 0, to: r3(it.duration) }); continue; }
    const keep: Span[] = [];
    for (const s of speech) {
      const p = { start: Math.max(0, s.start - pad), end: Math.min(it.duration, s.end + pad) };
      const last = keep[keep.length - 1];
      if (last && p.start - last.end < gap) last.end = p.end; else keep.push(p);
    }
    for (const k of keep) if (k.end - k.start >= 0.3) out.push({ file: it.file, from: r3(k.start), to: r3(k.end) });
  }
  return out;
}

/** How much shorter a tightened cut is, for "Took out 1:12 of pauses". */
export const savedSeconds = (items: Footage[], clips: EditClip[]) => r3(items.reduce((s, i) => s + (i.kind === 'picture' ? 3 : i.duration), 0) - clips.reduce((s, c) => s + c.to - c.from, 0));

// ── Making the clips one size (the export's first pass) ─────────────────────

export type Fit = 'fit' | 'fill' | 'blur';

/**
 * The video filter that makes any footage exactly W×H: 'fit' shows all of it with bars, 'fill' crops
 * to fill the frame, 'blur' fills the bars with a blurred, zoomed copy (the Shorts look).
 */
export function fitFilter(fit: Fit, W: number, H: number, input = '0:v', out = 'v'): string {
  if (fit === 'fill') return `[${input}]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[${out}]`;
  if (fit === 'blur') {
    const bw = Math.max(2, Math.round(W / 8 / 2) * 2), bh = Math.max(2, Math.round(H / 8 / 2) * 2);
    return `[${input}]split=2[bg${out}][fg${out}];[bg${out}]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},boxblur=6:2,scale=${W}:${H},setsar=1[bb${out}];[fg${out}]scale=${W}:${H}:force_original_aspect_ratio=decrease,setsar=1[ff${out}];[bb${out}][ff${out}]overlay=(W-w)/2:(H-h)/2[${out}]`;
  }
  return `[${input}]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[${out}]`;
}

export interface SegmentPlan {
  file: string; kind: 'video' | 'picture'; from: number; seconds: number; hasAudio: boolean;
  width: number; height: number; fps: number; fit: Fit; volume?: number; motion?: 'in' | 'out' | 'left' | 'right' | 'none';
}

/**
 * One timeline clip as a W×H segment with stereo 48 kHz sound (silence when the clip has none), so
 * the join afterwards is simple and light: every input looks the same. Add the encoder's own
 * arguments and the output after these.
 */
export function segmentArgs(s: SegmentPlan): string[] {
  const len = Math.max(0.2, s.seconds).toFixed(3);
  const W = s.width, H = s.height, fps = s.fps;
  const args = ['-y', '-nostdin', '-v', 'error', '-stats'];
  const f: string[] = [];
  if (s.kind === 'picture') {
    args.push('-loop', '1', '-framerate', String(fps), '-t', len, '-i', s.file);
    const n = Math.round(Number(len) * fps);
    const m = s.motion ?? 'none';
    const zoom = m === 'in' ? `z='1+0.12*on/${n}'` : m === 'out' ? `z='1.12-0.12*on/${n}'` : m === 'none' ? `z='1'` : `z='1.1'`;
    const x = m === 'right' ? `x='(iw-iw/zoom)*on/${n}'` : m === 'left' ? `x='(iw-iw/zoom)*(1-on/${n})'` : `x='iw/2-(iw/zoom/2)'`;
    f.push(`[0:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=${s.fit === 'fit' ? 'decrease' : 'increase'},${s.fit === 'fit' ? `pad=${W * 2}:${H * 2}:(ow-iw)/2:(oh-ih)/2:black` : `crop=${W * 2}:${H * 2}`},setsar=1,zoompan=${zoom}:${x}:y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${fps},trim=duration=${len},setpts=PTS-STARTPTS,format=yuv420p[v]`);
  } else {
    args.push('-ss', String(Math.max(0, s.from)), '-t', len, '-i', s.file);
    f.push(fitFilter(s.fit, W, H, '0:v', 'vf'));
    f.push(`[vf]fps=${fps},tpad=stop_mode=clone:stop_duration=${len},trim=duration=${len},setpts=PTS-STARTPTS,format=yuv420p[v]`);
  }
  args.push('-f', 'lavfi', '-t', len, '-i', 'anullsrc=r=48000:cl=stereo');
  const vol = clampN(s.volume ?? 1, 0, 2);
  if (s.kind === 'video' && s.hasAudio && vol > 0) {
    const fadeOut = Math.max(0, Number(len) - 0.06).toFixed(3);
    f.push(`[0:a]aresample=48000,aformat=channel_layouts=stereo,volume=${vol},afade=t=in:d=0.03,afade=t=out:st=${fadeOut}:d=0.06,apad=whole_dur=${len},atrim=0:${len},asetpts=PTS-STARTPTS[a]`);
  } else f.push(`[1:a]atrim=0:${len},asetpts=PTS-STARTPTS[a]`);
  args.push('-filter_complex', f.join(';'), '-map', '[v]', '-map', '[a]', '-t', len);
  return args;
}

/**
 * Joins same-size segments (crossfades or straight cuts), keeps each one's sound, lays the voiceover
 * and music on top (the clips' sound goes down while the voice speaks), and burns in or attaches
 * captions. Add the encoder's arguments and output after these.
 */
export function joinArgs(p: {
  segments: { file: string; seconds: number }[]; fade: number; voiceover?: string; voiceVolume?: number; music?: string; musicVolume?: number;
  duck?: boolean; captions?: { file: string; burn: boolean; style: CaptionStyle; width: number; height: number }; fps: number;
}): { args: string[]; total: number } {
  const segs = p.segments;
  if (!segs.length) throw new Error('The timeline is empty: add a clip first.');
  const fade = segs.length > 1 ? Math.max(0, Math.min(p.fade, ...segs.map((s) => s.seconds / 3))) : 0;
  const args = ['-y', '-nostdin', '-v', 'error', '-stats'];
  const f: string[] = [];
  // Every segment but the last plays `fade` longer under the next one, so cuts don't shorten anything:
  // segments were made that much longer by the first pass (see timelineSegments).
  segs.forEach((s) => args.push('-i', s.file));
  let last = '[0:v]', at = 0;
  for (let i = 1; i < segs.length; i++) {
    at += segs[i - 1].seconds;
    const label = `[x${i}]`;
    f.push(fade > 0 ? `${last}[${i}:v]xfade=transition=fade:duration=${fade.toFixed(3)}:offset=${at.toFixed(3)}${label}` : `${last}[${i}:v]concat=n=2:v=1:a=0${label}`);
    last = label;
  }
  const total = r3(segs.reduce((s, x) => s + x.seconds, 0));
  // The clips' own sound, each at its place in time.
  let t0 = 0;
  const own: string[] = [];
  segs.forEach((s, i) => {
    f.push(`[${i}:a]adelay=${Math.round(t0 * 1000)}:all=1[o${i}]`);
    own.push(`[o${i}]`);
    t0 += s.seconds;
  });
  f.push(`${own.join('')}${own.length > 1 ? `amix=inputs=${own.length}:normalize=0:duration=longest,` : 'anull,'}volume=${p.voiceover && p.duck !== false ? '0.35' : '1'}[own]`);
  const mix = ['[own]'];
  let idx = segs.length;
  if (p.voiceover) { args.push('-i', p.voiceover); f.push(`[${idx}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${clampN(p.voiceVolume ?? 1, 0, 2)}[vo]`); mix.push('[vo]'); idx++; }
  if (p.music) {
    args.push('-stream_loop', '-1', '-i', p.music);
    f.push(`[${idx}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${clampN(p.musicVolume ?? (p.voiceover ? 0.12 : 0.5), 0, 2)},atrim=0:${total.toFixed(3)},afade=t=out:st=${Math.max(0, total - 2).toFixed(3)}:d=2[mus]`);
    mix.push('[mus]'); idx++;
  }
  f.push(`${mix.join('')}${mix.length > 1 ? `amix=inputs=${mix.length}:normalize=0:duration=longest,` : ''}alimiter=limit=0.95,apad=whole_dur=${total.toFixed(3)},atrim=0:${total.toFixed(3)}[aout]`);
  const vEnd = segs.length > 1 ? last : '[0:v]';
  const c = p.captions;
  if (c?.burn) f.push(`${vEnd}subtitles=filename=${c.file}:force_style='${assStyle(c.style, c.width, c.height)}'[vout]`);
  else f.push(`${vEnd}null[vout]`);
  const soft = c && !c.burn ? idx : -1;
  if (soft >= 0) args.push('-i', c!.file);
  args.push('-filter_complex', f.join(';'), '-map', '[vout]', '-map', '[aout]');
  if (soft >= 0) args.push('-map', `${soft}:s`, '-c:s', 'mov_text');
  args.push('-r', String(p.fps), '-t', total.toFixed(3), '-metadata', 'comment=Made with Lotus');
  return { args, total };
}

/** A small, quick copy of a video for the editor's preview (360p, light to play and to send). */
export const proxyArgs = (file: string) => ['-y', '-nostdin', '-v', 'error', '-stats', '-i', file, '-map', '0:v:0', '-map', '0:a:0?', '-vf', "scale=-2:'min(360,ih)':flags=fast_bilinear,fps=30,format=yuv420p", '-ac', '2', '-ar', '44100'];

/** A thumbnail: one frame a tenth of the way in, 320 pixels wide. */
export const thumbArgs = (file: string, at: number, out: string) => ['-y', '-nostdin', '-v', 'error', '-ss', String(Math.max(0, at)), '-i', file, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '5', out];

/** The sound as one 16 kHz mono WAV (what Whisper hears and what speech is found in). */
export const soundArgs = (file: string, out: string, o: { from?: number; seconds?: number } = {}) => [
  '-y', '-nostdin', '-v', 'error', ...(o.from ? ['-ss', String(o.from)] : []), ...(o.seconds ? ['-t', String(o.seconds)] : []), '-i', file, '-vn', '-sn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out,
];

/** A slice of 16 kHz mono samples as a WAV file's bytes (one piece for Whisper). */
export function wavBytes(samples: Int16Array, rate: number): Uint8Array {
  const data = samples.length * 2;
  const b = new Uint8Array(44 + data);
  const dv = new DataView(b.buffer);
  const put = (p: number, s: string) => { for (let i = 0; i < s.length; i++) b[p + i] = s.charCodeAt(i); };
  put(0, 'RIFF'); dv.setUint32(4, 36 + data, true); put(8, 'WAVE'); put(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  put(36, 'data'); dv.setUint32(40, data, true);
  for (let i = 0; i < samples.length; i++) dv.setInt16(44 + i * 2, samples[i], true);
  return b;
}

// ── The timeline ───────────────────────────────────────────────────────────

/** Timeline clips → the first-pass segments: each but the last plays `fade` longer, under the next. */
export function timelineSegments(clips: { seconds: number }[], fade: number): { seconds: number; play: number }[] {
  const f = clips.length > 1 ? Math.max(0, Math.min(fade, ...clips.map((c) => c.seconds / 3))) : 0;
  return clips.map((c, i) => ({ seconds: r3(c.seconds), play: r3(c.seconds + (i < clips.length - 1 ? f : 0)) }));
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const clampN = (x: number, a: number, b: number) => Math.max(a, Math.min(b, Number.isFinite(x) ? x : a));
