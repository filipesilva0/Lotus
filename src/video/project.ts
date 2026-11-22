// The Video editor's project (0.22): the footage you added, the timeline of clips cut from it, the
// captions, the voiceover and the music. Pure (tested in core/test/video-editor.test.ts); the page is
// src/components/video/VideoEditor.tsx and the work is done by the core (core/src/video/editService.ts).
//
// A project lives in its own folder, Lotus Studio/Work/<project id>: the footage, what the editor
// makes (exports, Shorts, voiceovers) and .edit/project.json with this state.

export type Aspect = '16:9' | '9:16' | '1:1' | '4:5';
export type Fit = 'fit' | 'fill' | 'blur';
export type CaptionStyle = 'clean' | 'bold' | 'boxed' | 'big';

export interface Media {
  file: string; kind: 'video' | 'picture' | 'audio'; duration: number; width: number; height: number; hasAudio: boolean;
  thumb?: string; proxy?: boolean;
}
export interface Clip { id: string; file: string; from: number; to: number; volume: number }
export interface Cue { start: number; end: number; text: string }
export interface VoiceTrack { file: string; seconds: number; voice: string; lines: Cue[] }

export interface Project {
  v: 1;
  id: string;
  title: string;
  aspect: Aspect;
  fit: Fit;
  /** Crossfade between clips, seconds (0 = straight cuts). */
  fade: number;
  clips: Clip[];
  cues: Cue[];
  captionStyle: CaptionStyle;
  /** Draw the captions onto the picture (else they're attached for players to show). */
  burn: boolean;
  voice?: VoiceTrack;
  voiceVolume: number;
  music?: string;
  musicVolume: number;
  /** The script last typed in the Voiceover panel. */
  script: string;
  /** Files this project exported or cut into Shorts, newest first. */
  exports: string[];
  updated: number;
}

export const ASPECTS: { id: Aspect; label: string; hint: string }[] = [
  { id: '16:9', label: 'Wide 16:9', hint: 'YouTube, a screen' },
  { id: '9:16', label: 'Tall 9:16', hint: 'Shorts, Reels, TikTok' },
  { id: '1:1', label: 'Square 1:1', hint: 'Feeds' },
  { id: '4:5', label: 'Portrait 4:5', hint: 'Instagram posts' },
];

export const CAPTION_LOOKS: { id: CaptionStyle; label: string; hint: string }[] = [
  { id: 'clean', label: 'Clean', hint: 'White words with a thin outline at the bottom.' },
  { id: 'bold', label: 'Bold', hint: 'Big yellow words, a few at a time. Made for Shorts.' },
  { id: 'boxed', label: 'Boxed', hint: 'White words on a dark box. Easy to read anywhere.' },
  { id: 'big', label: 'One word', hint: 'One or two huge words at a time, in the middle.' },
];

/** How long a picture stays on screen when it's added. */
export const PICTURE_SECONDS = 3;

let n = 0;
export const clipId = () => `c${Date.now().toString(36)}${(n++).toString(36)}`;

export function newProject(id: string, title = 'Untitled video'): Project {
  return { v: 1, id, title, aspect: '16:9', fit: 'fit', fade: 0, clips: [], cues: [], captionStyle: 'clean', burn: true, voiceVolume: 1, musicVolume: 0.15, script: '', exports: [], updated: Date.now() };
}

/** A saved project made safe to use (older or hand-edited files fill in what's missing). */
export function loadProject(raw: unknown, id: string): Project {
  const base = newProject(id);
  if (!raw || typeof raw !== 'object') return base;
  const p = { ...base, ...(raw as Partial<Project>), id };
  p.clips = (Array.isArray(p.clips) ? p.clips : []).filter((c) => c && typeof c.file === 'string' && c.to > c.from).map((c) => ({ id: c.id || clipId(), file: c.file, from: Math.max(0, +c.from || 0), to: +c.to, volume: Number.isFinite(c.volume) ? c.volume : 1 }));
  p.cues = (Array.isArray(p.cues) ? p.cues : []).filter((c) => c && c.end > c.start && typeof c.text === 'string');
  p.exports = Array.isArray(p.exports) ? p.exports.filter((x) => typeof x === 'string') : [];
  if (!ASPECTS.some((a) => a.id === p.aspect)) p.aspect = '16:9';
  if (!['fit', 'fill', 'blur'].includes(p.fit)) p.fit = 'fit';
  if (!CAPTION_LOOKS.some((c) => c.id === p.captionStyle)) p.captionStyle = 'clean';
  return p;
}

export const clipSeconds = (c: Pick<Clip, 'from' | 'to'>) => Math.max(0, c.to - c.from);
export const totalSeconds = (p: Pick<Project, 'clips'>) => round(p.clips.reduce((s, c) => s + clipSeconds(c), 0));
/** Where each clip starts on the timeline. */
export const clipStarts = (p: Pick<Project, 'clips'>) => { let t = 0; return p.clips.map((c) => { const s = t; t += clipSeconds(c); return round(s); }); };
/** The whole video's length: the clips, or the voiceover if it runs longer (the export holds the last frame). */
export const videoSeconds = (p: Pick<Project, 'clips'>) => totalSeconds(p);

/** The clip under time `t` and how far into it. */
export function clipAt(p: Pick<Project, 'clips'>, t: number): { index: number; offset: number } | null {
  const starts = clipStarts(p);
  for (let i = 0; i < p.clips.length; i++) {
    const len = clipSeconds(p.clips[i]);
    if (t < starts[i] + len || i === p.clips.length - 1) return { index: i, offset: Math.max(0, Math.min(len, t - starts[i])) };
  }
  return null;
}

/** A file added to the timeline: a whole video, a picture for 3 s. Sound files can't be clips. */
export function addClip(p: Project, m: Media, at = p.clips.length): Project {
  if (m.kind === 'audio') return p;
  const c: Clip = { id: clipId(), file: m.file, from: 0, to: m.kind === 'picture' ? PICTURE_SECONDS : round(Math.max(0.1, m.duration)), volume: 1 };
  const clips = [...p.clips];
  clips.splice(Math.max(0, Math.min(at, clips.length)), 0, c);
  return { ...p, clips };
}

/** Cuts the clip under `t` in two (nothing happens within 0.1 s of a clip's edge). */
export function splitAt(p: Project, t: number): Project {
  const hit = clipAt(p, t);
  if (!hit) return p;
  const c = p.clips[hit.index];
  const cut = round(c.from + hit.offset);
  if (cut - c.from < 0.1 || c.to - cut < 0.1) return p;
  const clips = [...p.clips];
  clips.splice(hit.index, 1, { ...c, to: cut }, { ...c, id: clipId(), from: cut });
  return { ...p, clips };
}

export const removeClip = (p: Project, id: string): Project => ({ ...p, clips: p.clips.filter((c) => c.id !== id) });

export function moveClip(p: Project, id: string, by: number): Project {
  const i = p.clips.findIndex((c) => c.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= p.clips.length) return p;
  const clips = [...p.clips];
  const [c] = clips.splice(i, 1);
  clips.splice(j, 0, c);
  return { ...p, clips };
}

/** Sets where a clip starts and ends in its file, kept inside the file (pictures: 0.5–30 s). */
export function trimClip(p: Project, id: string, from: number, to: number, m?: Pick<Media, 'kind' | 'duration'>): Project {
  return {
    ...p,
    clips: p.clips.map((c) => {
      if (c.id !== id) return c;
      if (m?.kind === 'picture') return { ...c, from: 0, to: round(Math.max(0.5, Math.min(30, to - from))) };
      const max = m?.duration ?? Infinity;
      const f = Math.max(0, Math.min(from, max - 0.1));
      return { ...c, from: round(f), to: round(Math.max(f + 0.1, Math.min(to, max))) };
    }),
  };
}

export const setVolume = (p: Project, id: string, volume: number): Project => ({ ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, volume: Math.max(0, Math.min(2, volume)) } : c)) });

/** The auto edit's cut as the timeline. */
export const fromEdit = (p: Project, edit: { file: string; from: number; to: number }[]): Project => ({ ...p, clips: edit.map((e) => ({ id: clipId(), file: e.file, from: e.from, to: e.to, volume: 1 })) });

/** The caption showing at `t`. */
export const cueAt = (cues: Cue[], t: number) => cues.find((c) => t >= c.start && t < c.end) ?? null;

/** Changes one caption's words or times; an empty caption is removed. */
export function editCue(cues: Cue[], i: number, patch: Partial<Cue>): Cue[] {
  const out = cues.map((c, k) => (k === i ? { ...c, ...patch } : c)).filter((c) => c.text.trim() && c.end > c.start);
  return out.sort((a, b) => a.start - b.start);
}

/** Everything the core's export needs. */
export function exportPlan(p: Project, filename: string) {
  return {
    clips: p.clips.map((c) => ({ file: c.file, from: c.from, to: c.to, volume: c.volume })),
    aspect: p.aspect, fit: p.fit, fade: p.fade,
    voiceover: p.voice?.file, voiceVolume: p.voiceVolume, music: p.music, musicVolume: p.musicVolume,
    captions: p.cues, captionStyle: p.captionStyle, burn: p.burn, filename,
  };
}

/** What a project is still missing before it can be exported, in words (null when it's ready). */
export function notReady(p: Project, media: Media[]): string | null {
  if (!p.clips.length) return 'Add a video or picture to the timeline first.';
  const gone = p.clips.find((c) => !media.some((m) => m.file === c.file));
  if (gone) return `${gone.file} is no longer in this project's folder. Remove it from the timeline.`;
  return null;
}

/** 1:05.3 style time. */
export function clock(s: number, tenths = false): string {
  const t = Math.max(0, s);
  const m = Math.floor(t / 60);
  const sec = t - m * 60;
  return `${m}:${(tenths ? sec.toFixed(1) : String(Math.floor(sec))).padStart(tenths ? 4 : 2, '0')}`;
}

/** Adds made files to the top of the exports list. */
export const addExports = (p: Project, files: string[]): Project => ({ ...p, exports: [...files, ...p.exports.filter((f) => !files.includes(f))].slice(0, 50) });

/** The project list kept in settings: id, title and when it was last changed, newest first. */
export interface ProjectRef { id: string; title: string; updated: number }
export const PROJECTS_KEY = 'lotus.video.projects.v1';
export const upsertRef = (list: ProjectRef[], r: ProjectRef) => [r, ...list.filter((x) => x.id !== r.id)].slice(0, 100);

const round = (x: number) => Math.round(x * 1000) / 1000;
