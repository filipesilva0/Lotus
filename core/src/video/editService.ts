// The Video editor's side of the core (0.22). The editor page calls these directly, without a chat
// model: reading footage, captions, Shorts, a first cut and the export are all done by Lotus itself,
// so they work the same on every computer and never depend on a small model following steps.
//
// RPC (server.ts):
//   video_project_get  { projectId } → the saved editor state (or null)
//   video_project_put  { projectId, project } → true
//   video_media        { projectId, files? } → MediaInfo[] (length, size, thumbnail) for the project's files
//   video_job          { projectId, op, args } → { jobId }; progress and the result come as events
//   video_stop         { jobId } → true when it was running
//   video_jobs         → the jobs still running (a page opened later picks them up)
//   video_copy         { fromId, toId, files } → names copied (project ⇄ a Work job's folder)
// GET /v1/video-preview?projectId=&file=   the 360p preview copy of a video (or the picture/sound itself)
// Events: { type: 'video', jobId, projectId, op, state: 'running' | 'done' | 'error' | 'stopped', detail?, fraction?, result?, error? }
//
// Ops: proxy · analyse · captions · shorts.find · shorts.make · autoedit · voiceover · export

import { copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { ToolCtx } from '../agent/types';
import { analyse, captionsFor, exportTimeline, freeName, makeProxy, proxyPath, readMedia, safeName, type EditCtx, type MediaInfo, type TimelineClip } from './editRun';
import { CAPTION_STYLES, findMoments, planHighlights, planTighten, savedSeconds, type CaptionStyle, type Cue, type Fit, type Footage } from './edit';
import { videoTools, videoVoiceover, timingFile, type Timing } from '../tools/video';

export interface VideoJob { jobId: string; projectId: string; op: string; state: 'running' | 'done' | 'error' | 'stopped'; detail?: string; fraction?: number; started: number }

const MEDIA = /\.(mp4|mov|mkv|webm|avi|m4v|gif|png|jpe?g|webp|bmp|wav|mp3|m4a|ogg|flac|opus|aac)$/i;
const MAX_PROJECT = 2 * 1024 * 1024;

export class VideoEditService {
  private jobs = new Map<string, { info: VideoJob; ctrl: AbortController }>();
  constructor(private o: { workDir: (id: string) => string | null; toolCtx: (dir: string, signal: AbortSignal, progress: (d: string) => void) => ToolCtx; broadcast: (e: Record<string, unknown>) => void }) {}

  private dir(projectId: string): string {
    const d = this.o.workDir(projectId);
    if (!d) throw new Error('That video project has no folder.');
    mkdirSync(d, { recursive: true });
    return d;
  }

  projectGet(projectId: string): unknown {
    const f = join(this.dir(projectId), '.edit', 'project.json');
    try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
  }

  projectPut(projectId: string, project: unknown): boolean {
    const text = JSON.stringify(project ?? null);
    if (text.length > MAX_PROJECT) throw new Error('This project is too big to save (over 2 MB). Remove some captions or clips.');
    const d = join(this.dir(projectId), '.edit');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'project.json'), text);
    return true;
  }

  /** The videos, pictures and sounds in the project's folder (or just `files`), with thumbnails. */
  async media(projectId: string, files?: string[]): Promise<(MediaInfo | { file: string; error: string })[]> {
    const dir = this.dir(projectId);
    const t = videoTools(this.o.toolCtx(dir, new AbortController().signal, () => undefined));
    if ('error' in t) throw new Error(t.error);
    const names = (files?.length ? files.map((f) => basename(String(f))) : readdirSync(dir).filter((f) => !f.startsWith('.') && MEDIA.test(f))).slice(0, 200);
    const c: EditCtx = { t, dir, progress: () => undefined };
    const out: (MediaInfo | { file: string; error: string })[] = [];
    for (const f of names) out.push(await readMedia(c, f).catch((e) => ({ file: f, error: (e as Error).message })));
    return out;
  }

  /** The preview copy of a file, or the file itself for pictures and sounds; null when there's none. */
  previewPath(projectId: string, file: string): string | null {
    const dir = this.o.workDir(projectId);
    if (!dir) return null;
    const name = basename(String(file ?? ''));
    if (!name || name.startsWith('.') || !MEDIA.test(name)) return null;
    const proxy = proxyPath(dir, name);
    if (existsSync(proxy)) return proxy;
    const full = join(dir, name);
    return existsSync(full) ? full : null;
  }

  /**
   * Copies files between a video project and a Work job's folder (an AI preset sends the footage to
   * Work; a video Work made comes back into the project). Linked when the disk allows, so a big video
   * isn't stored twice. Returns the names copied.
   */
  copy(fromId: string, toId: string, files: string[]): string[] {
    const from = this.dir(fromId), to = this.dir(toId);
    const out: string[] = [];
    for (const raw of files.slice(0, 60)) {
      const name = basename(String(raw ?? ''));
      if (!name || name.startsWith('.') || !MEDIA.test(name) || !existsSync(join(from, name))) continue;
      let dest = name;
      if (existsSync(join(to, dest))) { if (statSync(join(to, dest)).size === statSync(join(from, name)).size) { out.push(dest); continue; } dest = `${Date.now().toString(36)}-${name}`; }
      try { linkSync(join(from, name), join(to, dest)); } catch { copyFileSync(join(from, name), join(to, dest)); }
      out.push(dest);
    }
    return out;
  }

  list(): VideoJob[] { return [...this.jobs.values()].map((j) => j.info); }

  stop(jobId: string): boolean {
    const j = this.jobs.get(jobId);
    if (!j) return false;
    j.ctrl.abort();
    return true;
  }

  start(projectId: string, op: string, args: Record<string, unknown>): { jobId: string } {
    if (!OPS.has(op)) throw new Error(`The video editor can't do "${op}".`);
    const dir = this.dir(projectId);
    // One heavy job per project at a time: two exports at once would fight over the graphics card.
    const busy = [...this.jobs.values()].find((j) => j.info.projectId === projectId && j.info.state === 'running' && HEAVY.has(j.info.op) && HEAVY.has(op));
    if (busy) throw new Error('This project is already busy with something. Wait for it to finish, or stop it first.');
    const jobId = `vj-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const ctrl = new AbortController();
    const info: VideoJob = { jobId, projectId, op, state: 'running', started: Date.now() };
    this.jobs.set(jobId, { info, ctrl });
    const send = (e: Record<string, unknown>) => this.o.broadcast({ type: 'video', jobId, projectId, op, ...e });
    let lastSent = 0;
    const progress = (detail: string, fraction?: number) => {
      info.detail = detail; info.fraction = fraction;
      const now = Date.now();
      if (now - lastSent < 250) return;
      lastSent = now;
      send({ state: 'running', detail, fraction });
    };
    send({ state: 'running', detail: 'Starting' });
    const tctx = this.o.toolCtx(dir, ctrl.signal, (d) => progress(d));
    void (async () => {
      try {
        const t = videoTools(tctx);
        if ('error' in t) throw new Error(t.error);
        const b = tctx.builtins;
        const model = b?.engineInfo('sherpa').installed ? b.installed().find((m) => m.kind === 'dictation')?.id : undefined;
        const c: EditCtx = { t, dir, signal: ctrl.signal, progress, transcribe: model && b ? (wav, o) => b.transcribe(model, wav, { language: o.language, signal: o.signal, warm: true }) : undefined };
        const result = await runOp(c, op, args, tctx);
        info.state = 'done';
        send({ state: 'done', result });
      } catch (e) {
        const stopped = (e as Error).name === 'AbortError' || ctrl.signal.aborted;
        info.state = stopped ? 'stopped' : 'error';
        send(stopped ? { state: 'stopped' } : { state: 'error', error: (e as Error).message || String(e) });
      } finally {
        // Kept a little while so a page that opens now still sees how it ended.
        const tm = setTimeout(() => this.jobs.delete(jobId), 60_000);
        (tm as { unref?: () => void }).unref?.();
      }
    })();
    return { jobId };
  }
}

const OPS = new Set(['proxy', 'analyse', 'captions', 'shorts.find', 'shorts.make', 'autoedit', 'voiceover', 'export']);
const HEAVY = new Set(['shorts.make', 'export', 'voiceover']);

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const files = (v: unknown) => (Array.isArray(v) ? v.map((x) => basename(String(x))).filter(Boolean) : []);
const style = (v: unknown): CaptionStyle => (typeof v === 'string' && v in CAPTION_STYLES ? (v as CaptionStyle) : 'clean');
const fitOf = (v: unknown, d: Fit): Fit => (v === 'fit' || v === 'fill' || v === 'blur' ? v : d);
const cuesOf = (v: unknown): Cue[] => (Array.isArray(v) ? v : []).map((c) => c as Cue).filter((c) => c && Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start && typeof c.text === 'string').slice(0, 5000);

/** What one job does. Results are plain JSON for the page. */
export async function runOp(c: EditCtx, op: string, a: Record<string, unknown>, tctx?: ToolCtx): Promise<unknown> {
  switch (op) {
    case 'proxy': {
      const out: string[] = [];
      const list = files(a.files);
      for (let i = 0; i < list.length; i++) {
        const m = await readMedia(c, list[i]);
        if (m.kind !== 'video') continue;
        await makeProxy({ ...c, progress: (d, f) => c.progress(list.length > 1 ? `${d} (${i + 1} of ${list.length})` : d, f) }, m.file, m.duration);
        out.push(m.file);
      }
      return { files: out };
    }
    case 'analyse': return analyse(c, str(a.file));
    case 'captions': {
      // A timeline's captions: each clip is listened to on its own and its captions moved to where
      // the clip sits; a voiceover's captions come from its lines (no listening needed).
      const out: Cue[] = [];
      const clips = (Array.isArray(a.clips) ? a.clips : []) as TimelineClip[];
      let at = 0;
      const withSound = new Set(files(a.withSound));
      for (let i = 0; i < clips.length; i++) {
        const x = clips[i];
        const len = Math.max(0, num(x.to, 0) - num(x.from, 0));
        if (withSound.has(basename(String(x.file))) && len > 0.5) {
          const part = await captionsFor({ ...c, progress: (d, f) => c.progress(`Clip ${i + 1} of ${clips.length} · ${d}`, f) }, String(x.file), { from: num(x.from, 0), seconds: len, offset: at, language: str(a.language) || undefined });
          out.push(...part);
        }
        at += len;
      }
      if (a.voiceover) {
        try { const tm = JSON.parse(readFileSync(timingFile(c.dir, basename(String(a.voiceover))), 'utf8')) as Timing; out.push(...tm.lines.map((l) => ({ start: l.start, end: l.end, text: l.text }))); } catch { /* no lines kept */ }
      }
      out.sort((x, y) => x.start - y.start);
      return { cues: out };
    }
    case 'shorts.find': {
      const file = str(a.file);
      const an = await analyse(c, file);
      const cues = c.transcribe && a.listen !== false && an.hasAudio ? await captionsFor(c, file).catch((e) => { if ((e as Error).name === 'AbortError') throw e; return [] as Cue[]; }) : [];
      c.progress('Picking the best moments');
      return { moments: findMoments(an, { count: num(a.count, 3), seconds: num(a.seconds, 30), cues }), heard: cues.length > 0 };
    }
    case 'shorts.make': {
      const file = basename(str(a.file));
      const moments = (Array.isArray(a.moments) ? a.moments : []).map((m) => m as { start: number; end: number; title?: string }).filter((m) => m.end - m.start > 1).slice(0, 10);
      if (!moments.length) throw new Error('Pick at least one moment to make into a Short.');
      const media = await readMedia(c, file);
      const made: { file: string; seconds: number; captions: string }[] = [];
      for (let i = 0; i < moments.length; i++) {
        const m = moments[i];
        const step = (d: string, f?: number) => c.progress(`Short ${i + 1} of ${moments.length} · ${d}`, f);
        const cap = a.captions !== false && media.hasAudio && c.transcribe ? await captionsFor({ ...c, progress: step }, file, { from: m.start, seconds: m.end - m.start }) : [];
        const base = freeName(c.dir, safeName(m.title, `short-${file.replace(/\.[^.]+$/, '')}`).slice(0, 50));
        const r = await exportTimeline({ ...c, progress: step }, {
          clips: [{ file, from: m.start, to: m.end }], aspect: str(a.aspect, '9:16'), fit: fitOf(a.fit, 'blur'), fade: 0,
          captions: cap, captionStyle: style(a.style ?? 'bold'), burn: true, filename: base,
        }, new Map([[media.file, { kind: media.kind, hasAudio: media.hasAudio }]]));
        made.push({ file: r.file, seconds: r.seconds, captions: r.captions });
      }
      return { files: made, heard: !!c.transcribe };
    }
    case 'autoedit': {
      const list = files(a.files);
      if (!list.length) throw new Error('Add some footage first, then try the auto edit again.');
      const items: Footage[] = [];
      for (let i = 0; i < list.length; i++) {
        const m = await readMedia(c, list[i]);
        if (m.kind === 'audio') continue;
        const an = m.kind === 'video' ? await analyse({ ...c, progress: (d, f) => c.progress(`${i + 1} of ${list.length} · ${d}`, f) }, m.file) : undefined;
        items.push({ file: m.file, kind: m.kind, duration: m.duration, analysis: an });
      }
      const mode = a.mode === 'tighten' ? 'tighten' : 'highlights';
      const clips = mode === 'tighten' ? planTighten(items) : planHighlights(items, { seconds: num(a.seconds, 0) || undefined });
      return { clips, mode, saved: mode === 'tighten' ? savedSeconds(items, clips) : 0, talking: items.some((i) => i.analysis?.speech.length) };
    }
    case 'voiceover': {
      if (!tctx) throw new Error('Voiceovers need Lotus\'s voices.');
      const lines = (Array.isArray(a.lines) ? a.lines : []).map((x) => String(x).trim()).filter(Boolean);
      if (!lines.length) throw new Error('Write the script first: one line per sentence.');
      const name = `${freeName(c.dir, 'voiceover', 'wav')}.wav`;
      const r = await videoVoiceover.run({ voice: a.voice || undefined, lines, starts: Array.isArray(a.starts) ? a.starts : undefined, filename: name }, tctx);
      if (!r.ok) throw new Error(r.text);
      const timing = JSON.parse(readFileSync(timingFile(c.dir, name), 'utf8')) as Timing;
      return { file: name, seconds: timing.total, voice: timing.voice, lines: timing.lines };
    }
    case 'export': {
      const p = a.plan as Record<string, unknown> | undefined;
      if (!p) throw new Error('Nothing to export.');
      const media = new Map<string, { kind: 'video' | 'picture' | 'audio'; hasAudio: boolean }>();
      for (const m of (Array.isArray(a.media) ? a.media : []) as MediaInfo[]) media.set(basename(String(m.file)), { kind: m.kind, hasAudio: !!m.hasAudio });
      const clips = (Array.isArray(p.clips) ? p.clips : []) as TimelineClip[];
      for (const x of clips) if (!media.has(basename(String(x.file)))) { const m = await readMedia(c, String(x.file)); media.set(m.file, { kind: m.kind, hasAudio: m.hasAudio }); }
      const base = freeName(c.dir, safeName(str(p.filename), 'my-video'));
      return exportTimeline(c, {
        clips: clips.map((x) => ({ file: basename(String(x.file)), from: num(x.from, 0), to: num(x.to, 0), volume: num(x.volume, 1) })),
        aspect: str(p.aspect, '16:9'), fit: fitOf(p.fit, 'fit'), fade: Math.max(0, Math.min(1.5, num(p.fade, 0))),
        voiceover: str(p.voiceover) || undefined, voiceVolume: num(p.voiceVolume, 1), music: str(p.music) || undefined, musicVolume: typeof p.musicVolume === 'number' ? p.musicVolume : undefined,
        captions: cuesOf(p.captions), captionStyle: style(p.captionStyle), burn: p.burn !== false, filename: base,
      }, media);
    }
    default: throw new Error(`The video editor can't do "${op}".`);
  }
}
