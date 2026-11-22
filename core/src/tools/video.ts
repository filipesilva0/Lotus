// Video tools for Work mode (0.21): understand a video, pick a voice, make a voiceover and put a
// video together. Lotus's own take on what video skills like onetake do, built on Lotus's engines:
// Whisper (sherpa-onnx) to hear, a vision chat model to see, Lotus voices to speak, FFmpeg to cut.
//
//   voice.list       the voices the user can use: built-in speakers and their own voices
//   video.inspect    length, size and sound; a sheet of frames to look at; what is said, with times
//   video.voiceover  a script spoken line by line, laid out in time, saved as WAV + subtitles
//   video.generate   new AI footage from words (or a picture), on this computer's graphics card
//   video.make       pictures and clips joined with slow moves and crossfades, plus the voiceover,
//                    the video's own sound and music; saved as an MP4 in the work folder
//
// Consent (0.17): a voice copied from a recording is used only when its maker ticked the promise.
// Pro (0.18): copied voices follow the Pro switch, like everywhere else in Lotus.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import type { Tool, ToolCtx } from '../agent/types';
import { resolveMedia } from '../media';
import { resolveInFolders } from './files';
import { gptSovits } from '../engines/rpc';
import { tagWav } from '../../../src/lib/wavTag';
import { entryById } from '../../../src/models/library';
import { voiceOptions, type MyVoice, type VoiceModel } from '../../../src/voice/studio';
import { chunkArgs, effectFilters, frameArgs, layoutLines, mixArgs, motionFor, sceneDurations, sheetArgs, sheetTimes, sizeFor, srt, wavSeconds, type Line, type Scene } from '../video/ffmpeg';
import { probe, render, runProgram, type VideoTools } from '../video/run';
import { aboutTime, MAX_VIDEO_SECONDS, pickVideoModel, planVideo, VIDEO_FAMILIES, videoFamilyFor, videoFit, videoLadder, videoPrompt, type VideoAttempt } from '../../../src/models/videoModels';
import { LIBRARY } from '../../../src/models/library';

export const MINE_KEY = 'lotus.voice.mine.v1';
export const SELECTED_KEY = 'lotus.voice.selected.v1';
export const GSV_KEY = 'lotus.voice.gptsovits.v1';
const GSV_ID = 'gptsovits';

const LANGS: Record<string, string> = { en: 'English', pt: 'Portuguese', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', nl: 'Dutch', pl: 'Polish', ru: 'Russian', uk: 'Ukrainian', tr: 'Turkish', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', ar: 'Arabic', hi: 'Hindi', sv: 'Swedish', da: 'Danish', no: 'Norwegian', fi: 'Finnish', cs: 'Czech', el: 'Greek', ro: 'Romanian', hu: 'Hungarian', vi: 'Vietnamese', ca: 'Catalan', multi: 'many languages' };

// ── Voices ─────────────────────────────────────────────────────────────────

export interface VideoVoice {
  id: string; name: string; detail: string; languages: string[];
  mine: boolean; copied: boolean; ready: boolean; why?: string; usual: boolean;
  model: string; speaker: number; reference?: string; referenceText?: string; steps?: number; speed?: number;
  effects?: { volume?: number; bass?: number; treble?: number; normalize?: boolean };
}

/**
 * Every voice the agent may pick, built the same way as the Voice page's list. Copied voices need the
 * consent promise (voices made before 0.17 don't have it) and Pro when Pro is switched on.
 */
export function videoVoices(installed: { id: string; kind: string; title: string; entryId?: string }[], mine: MyVoice[], o: { proLocked?: boolean; gsv?: boolean; selected?: string | null } = {}): VideoVoice[] {
  const models: VoiceModel[] = installed.filter((m) => m.kind === 'voice').map((m) => {
    const spec = m.entryId ? entryById(m.entryId)?.voice : undefined;
    return { id: m.id, title: m.title, entryId: m.entryId, speakers: spec?.speakers ?? [], clones: !!spec?.clones, needsReferenceText: !!spec?.needsReferenceText };
  });
  if (o.gsv) models.push({ id: GSV_ID, title: 'GPT-SoVITS', speakers: [], clones: true, needsReferenceText: true });
  const byId = new Map(models.map((m) => [m.id, m]));
  const langsOf = (model: string) => {
    if (model === GSV_ID) return ['en', 'zh', 'ja', 'ko'];
    const m = installed.find((x) => x.id === model);
    return (m?.entryId ? entryById(m.entryId)?.voice?.languages : undefined) ?? [];
  };
  return voiceOptions(models, mine, { proLocked: o.proLocked }).map((v) => {
    const mv = v.mine ? mine.find((x) => x.id === v.id) : undefined;
    const copied = !!byId.get(v.model)?.clones;
    let ready = v.ready, why = v.why;
    if (ready && copied && !mv?.consentAt) { ready = false; why = 'It was made before Lotus asked for the consent promise. Add its recording again in Voice → Voices and tick the promise to use it.'; }
    return { id: v.id, name: v.name, detail: v.detail, languages: langsOf(v.model), mine: v.mine, copied, ready, why, usual: v.id === o.selected,
      model: v.model, speaker: v.speaker, reference: v.reference, referenceText: v.referenceText, steps: v.steps, speed: v.speed, effects: v.effects };
  });
}

const readJson = <T,>(ctx: Pick<ToolCtx, 'kvGet'>, key: string, fallback: T): T => { try { const v = ctx.kvGet(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; } };
const gsvDir = (ctx: Pick<ToolCtx, 'kvGet'>) => readJson<{ dir?: string }>(ctx, GSV_KEY, {}).dir ?? '';

export function voicesFor(ctx: ToolCtx): VideoVoice[] {
  const installed = ctx.builtins?.installed() ?? [];
  return videoVoices(installed, readJson<MyVoice[]>(ctx, MINE_KEY, []), { proLocked: ctx.proUnlocked ? !ctx.proUnlocked() : false, gsv: !!gsvDir(ctx), selected: ctx.kvGet(SELECTED_KEY) });
}

/** The voice the model named: an id from voice.list, or a name ("Heart", "my voice"). */
export function findVoice(list: VideoVoice[], raw: unknown): VideoVoice | null {
  const want = String(raw ?? '').trim().toLowerCase();
  if (!want) return list.find((v) => v.usual && v.ready) ?? list.find((v) => v.ready) ?? null;
  return list.find((v) => v.id.toLowerCase() === want)
    ?? list.find((v) => v.name.toLowerCase() === want)
    ?? list.find((v) => v.name.toLowerCase().split(' · ')[0] === want)
    ?? list.find((v) => v.name.toLowerCase().includes(want) || want.includes(v.name.toLowerCase().split(' · ')[0]))
    ?? null;
}

const voiceLine = (v: VideoVoice) => `- ${v.id} · ${v.name}${v.detail && !v.name.includes(v.detail) ? ` (${v.detail})` : ''}${v.languages.length ? ` · ${v.languages.map((l) => LANGS[l] ?? l).join(', ')}` : ''}${v.mine ? ' · the user\'s own voice' : ''}${v.copied ? ' · copied from a recording' : ''}${v.usual ? ' · the user\'s usual voice' : ''}${v.ready ? '' : ` · NOT USABLE: ${v.why}`}`;

export const voiceList: Tool = {
  name: 'voice.list', label: 'Looking at voices', risk: 'read',
  description: 'List the voices Lotus can speak with (built-in voices and the user\'s own), with language, accent and gender, so you can pick the best one for a voiceover.',
  parameters: { type: 'object', properties: { language: { type: 'string', description: 'Only voices for this language, e.g. English or pt (optional).' } } },
  async run(a, ctx) {
    if (!ctx.builtins) return { ok: false, text: 'Lotus\'s voice engine is not available here.', summary: 'No voice engine' };
    let list = voicesFor(ctx);
    const lang = String(a.language ?? '').trim().toLowerCase();
    if (lang) {
      const code = Object.entries(LANGS).find(([k, n]) => k === lang || n.toLowerCase() === lang)?.[0] ?? lang.slice(0, 2);
      const hit = list.filter((v) => v.languages.includes(code) || v.languages.includes('multi'));
      if (hit.length) list = hit;
    }
    if (!list.length) return { ok: false, text: 'No voices are downloaded yet. Tell the user to get one in Settings → Models (Kokoro has many English voices) or Voice → Voices.', summary: 'No voices yet' };
    const ready = list.filter((v) => v.ready).length;
    return { ok: true, text: `Voices (${ready} usable). Pass the id to video.voiceover. Pick by language first, then the tone the video needs (warm, calm, energetic) and gender; prefer the user's usual or own voice when it fits.\n${list.slice(0, 45).map(voiceLine).join('\n')}`, summary: `${ready} voice${ready === 1 ? '' : 's'} ready` };
  },
};

/** Speaks one line with a voice; returns WAV bytes. */
async function speakLine(ctx: ToolCtx, v: VideoVoice, text: string, language?: string): Promise<Uint8Array> {
  if (v.model === GSV_ID) {
    const ref = v.reference ? resolveMedia(ctx.studio, v.reference) : null;
    if (!ref) throw new Error(`${v.name} has no recording yet. Add one in Voice → Voices.`);
    return gptSovits(ctx.studio).speak({ dir: gsvDir(ctx), text, refAudio: ref, refText: v.referenceText, lang: language, speed: v.speed });
  }
  const b = ctx.builtins!;
  let ref: { audio: string; text?: string; steps?: number } | undefined;
  if (v.reference) {
    const audio = resolveMedia(ctx.studio, v.reference);
    if (!audio) throw new Error(`${v.name}'s recording is outside the Lotus Studio folder.`);
    ref = { audio, text: v.referenceText, steps: v.steps };
  }
  const wav = await b.speak(v.model, text, { speaker: v.speaker, speed: v.speed ?? 1, signal: ctx.signal, ref });
  try { return new Uint8Array(readFileSync(wav)); } finally { try { rmSync(wav, { force: true }); } catch { /* temp */ } }
}

// ── Files ──────────────────────────────────────────────────────────────────

export const VIDEO_EXT = new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v', '.gif']);
export const PICTURE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp']);
export const AUDIO_EXT = new Set(['.wav', '.mp3', '.m4a', '.ogg', '.flac', '.opus', '.aac']);

/** ffmpeg and ffprobe, or why video work can't happen yet. */
export function videoTools(ctx: ToolCtx): VideoTools | { error: string } {
  const ffmpeg = ctx.builtins?.videoTool('ffmpeg');
  if (!ffmpeg) return { error: 'FFmpeg is not installed, so Lotus can\'t work with video yet. Tell the user to install it in Settings → Models (Lotus Engines → FFmpeg, about 165 MB), then ask again.' };
  return { ffmpeg, ffprobe: ctx.builtins!.videoTool('ffprobe') };
}

/**
 * A file the model named: something in this work's folder, a Lotus Studio picture or recording
 * ("Images/…/Output 1.png"), or a file in a folder the user opened to Lotus.
 */
export function findInput(ctx: ToolCtx, raw: unknown): string | { error: string } {
  const name = String(raw ?? '').trim().replace(/^["']|["']$/g, '');
  if (!name) return { error: 'Say which file to use.' };
  if (ctx.workDir) {
    const p = join(ctx.workDir, basename(name.replace(/\\/g, '/')));
    if (existsSync(p) && statSync(p).isFile() && !basename(p).startsWith('.')) return p;
  }
  const media = resolveMedia(ctx.studio, name.replace(/^Lotus Studio[\\/]/i, ''));
  if (media && existsSync(media)) return media;
  const r = resolveInFolders(ctx.folders, name);
  if ('error' in r) return { error: `${name}: ${r.error}` };
  if (!existsSync(r.path) || !statSync(r.path).isFile()) return { error: `There is no file ${name}. Use files.list or files.search to find it.` };
  return r.path;
}

/** A safe output name in the work folder with one of the allowed extensions. */
function outName(raw: unknown, fallback: string, exts: string[]): string {
  let n = basename(String(raw ?? '').replace(/\\/g, '/')).replace(/[\u0000-\u001f<>:"|?*]/g, '').trim();
  if (!n || n.startsWith('.')) n = fallback;
  const base = n.replace(/\.[a-z0-9]{1,5}$/i, '').slice(0, 80) || fallback.replace(/\.[^.]+$/, '');
  return `${base}${exts.includes(extname(n).toLowerCase()) ? extname(n).toLowerCase() : exts[0]}`;
}

const titleOf = (dir: string, file: string, title: string) => {
  const f = join(dir, '.titles.json');
  let t: Record<string, string> = {};
  try { t = JSON.parse(readFileSync(f, 'utf8')); } catch { /* new */ }
  t[file] = title;
  writeFileSync(f, JSON.stringify(t, null, 1));
};

const tmpDir = (ctx: ToolCtx) => {
  const d = join(ctx.workDir ?? join(ctx.studio, 'Work'), '.video', Date.now().toString(36));
  mkdirSync(d, { recursive: true });
  return d;
};

/** Removes a tool's scratch folder, and the .video folder once nothing else is using it. */
function cleanTmp(d: string) {
  rmSync(d, { recursive: true, force: true });
  try { const parent = dirname(d); if (!readdirSync(parent).length) rmSync(parent, { recursive: true, force: true }); } catch { /* in use */ }
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ── Understanding a video ──────────────────────────────────────────────────

/** Whisper (Settings → Models → Dictation) if it is downloaded and the engine is in. */
const dictationModel = (ctx: ToolCtx) => (ctx.builtins?.engineInfo('sherpa').installed ? ctx.builtins.installed().find((m) => m.kind === 'dictation')?.id : undefined);

export const videoInspect: Tool = {
  name: 'video.inspect', label: 'Watching a video', risk: 'read',
  description: 'Understand a video (or a picture): its length and size, a sheet of frames from across it for you to look at, and what is said in it with times. Use it before scripting a voiceover for an existing video.',
  parameters: { type: 'object', properties: {
    file: { type: 'string', description: 'The video: a file in this work, in Lotus Studio, or in a folder the user opened.' },
    frames: { type: 'integer', description: 'How many frames on the sheet, 4 to 16 (default 9).' },
    at: { type: 'number', description: 'Look closely at one moment instead (seconds from the start).' },
    listen: { type: 'boolean', description: 'Write down what is said (default true).' },
  }, required: ['file'] },
  describe: (a) => `Watch ${basename(String(a.file))}`,
  async run(a, ctx) {
    const t = videoTools(ctx);
    if ('error' in t) return { ok: false, text: t.error, summary: 'FFmpeg not installed' };
    const file = findInput(ctx, a.file);
    if (typeof file !== 'string') return { ok: false, text: file.error, summary: 'File not found' };
    ctx.progress('Reading the video');
    const info = await probe(t, file, ctx.signal);
    if (!info.hasVideo && !info.hasAudio) return { ok: false, text: `${basename(file)} is not a video, picture or sound file FFmpeg can read.`, summary: 'Not a video' };
    const isPicture = PICTURE_EXT.has(extname(file).toLowerCase()) || (info.hasVideo && info.duration < 0.1);
    const tmp = tmpDir(ctx);
    try {
      const parts: string[] = [];
      parts.push(isPicture ? `${basename(file)} is a picture, ${info.width}×${info.height}.` : `${basename(file)}: ${clock(info.duration)} long (${info.duration.toFixed(1)} s)${info.hasVideo ? `, ${info.width}×${info.height}${info.fps ? `, ${Math.round(info.fps)} fps` : ''}` : ', sound only'}, ${info.hasAudio ? 'with sound' : 'no sound'}.`);
      let imageB64: string | undefined, imageNote: string | undefined;
      if (info.hasVideo) {
        ctx.progress('Taking frames');
        const out = join(tmp, 'look.jpg');
        const at = typeof a.at === 'number' ? Math.min(Math.max(0, a.at), Math.max(0, info.duration - 0.05)) : null;
        if (isPicture || at !== null) await runProgram(t.ffmpeg, frameArgs(file, at ?? 0, out), { signal: ctx.signal });
        else await runProgram(t.ffmpeg, sheetArgs(file, out, info, Number(a.frames) || 9), { signal: ctx.signal });
        imageB64 = readFileSync(out).toString('base64');
        if (isPicture) imageNote = `(Lotus) The picture ${basename(file)} is attached. Describe what you see before you use it.`;
        else if (at !== null) imageNote = `(Lotus) The frame at ${clock(at)} of ${basename(file)} is attached.`;
        else {
          const times = sheetTimes(info.duration, Number(a.frames) || 9);
          imageNote = `(Lotus) A sheet of ${times.length} frames from ${basename(file)} is attached, read left to right, top to bottom, taken at ${times.map(clock).join(', ')}. Describe each part of the video from it.`;
          parts.push(`Frame sheet attached (${times.length} frames at ${times.map(clock).join(', ')}). If you can't see pictures, say so and work from the words below.`);
        }
      }
      let transcript = '';
      if (info.hasAudio && a.listen !== false && !isPicture) {
        const model = dictationModel(ctx);
        if (!model) parts.push('What is said was not written down: no dictation model (Whisper) is downloaded. The user can get one in Settings → Models → Dictation.');
        else {
          ctx.progress('Listening');
          await runProgram(t.ffmpeg, chunkArgs(file, join(tmp, 'part%03d.wav')), { signal: ctx.signal });
          const chunks = readdirSync(tmp).filter((f) => /^part\d+\.wav$/.test(f)).sort();
          const max = 40; // about 18 minutes
          const lines: string[] = [];
          for (let i = 0; i < Math.min(chunks.length, max); i++) {
            ctx.progress(`Listening · part ${i + 1} of ${Math.min(chunks.length, max)}`);
            const text = (await ctx.builtins!.transcribe(model, join(tmp, chunks[i]), { signal: ctx.signal, warm: true }).catch((e) => { if ((e as Error).name === 'AbortError') throw e; return ''; })).trim();
            if (text) lines.push(`[${clock(i * 28)}] ${text}`);
          }
          transcript = lines.join('\n');
          parts.push(transcript ? `What is said (times are where each 28-second part starts):\n${transcript}${chunks.length > max ? `\n(Only the first ${clock(max * 28)} was written down.)` : ''}` : 'No speech was heard.');
        }
      }
      if (transcript && ctx.workDir) {
        const name = outName(`${basename(file).replace(/\.[^.]+$/, '')}-transcript.md`, 'transcript.md', ['.md']);
        writeFileSync(join(ctx.workDir, name), `# What is said in ${basename(file)}\n\n${transcript}\n`);
        titleOf(ctx.workDir, name, `Transcript · ${basename(file)}`);
        parts.push(`The transcript is saved as ${name}.`);
      }
      return { ok: true, text: parts.join('\n'), summary: isPicture ? `Picture · ${info.width}×${info.height}` : `${clock(info.duration)} video${transcript ? ' · transcript' : ''}`, data: { duration: info.duration, width: info.width, height: info.height, hasAudio: info.hasAudio, ...(imageB64 ? { imageB64, imageNote } : {}) } };
    } finally { cleanTmp(tmp); }
  },
};

// ── Voiceover ──────────────────────────────────────────────────────────────

/** The hidden timing file next to a voiceover (video.make reads it to fit scenes to lines). */
export const timingFile = (dir: string, wav: string) => join(dir, `.${wav}.json`);
export interface Timing { voice: string; lines: Line[]; total: number }

export const videoVoiceover: Tool = {
  name: 'video.voiceover', label: 'Recording a voiceover', risk: 'write',
  description: 'Speak a voiceover script with one of the user\'s voices (from voice.list). Give the script as lines, one per scene or sentence; they are spoken in order with short pauses (or at the start times you give, to match a video). Saves a WAV and subtitles in this work.',
  parameters: { type: 'object', properties: {
    voice: { type: 'string', description: 'Voice id from voice.list (or its name). Leave out to use the user\'s usual voice.' },
    lines: { type: 'array', items: { type: 'string' }, description: 'The script, one line per scene or sentence, in speaking order. Plain words only, no stage directions.' },
    starts: { type: 'array', items: { type: 'number' }, description: 'Optional: when each line should start (seconds), to match moments in a video.' },
    filename: { type: 'string', description: 'File name, e.g. voiceover.wav (default).' },
    language: { type: 'string', description: 'Language code for GPT-SoVITS voices (en, zh, ja, ko). Optional.' },
  }, required: ['lines'] },
  describe: (a) => `Record a voiceover of ${Array.isArray(a.lines) ? a.lines.length : 0} line${Array.isArray(a.lines) && a.lines.length === 1 ? '' : 's'}${a.voice ? ` with ${String(a.voice)}` : ''}`,
  async run(a, ctx) {
    if (!ctx.workDir) return { ok: false, text: 'Voiceovers are made in Work mode.', summary: 'Not in Work mode' };
    const t = videoTools(ctx);
    if ('error' in t) return { ok: false, text: t.error, summary: 'FFmpeg not installed' };
    const texts = (Array.isArray(a.lines) ? a.lines : []).map((s) => String(s).replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 80);
    if (!texts.length) return { ok: false, text: 'Give the script as lines.', summary: 'No script' };
    const list = voicesFor(ctx);
    const v = findVoice(list, a.voice);
    if (!v) return { ok: false, text: `There is no voice "${String(a.voice ?? '')}". Call voice.list and use an id from it.`, summary: 'Voice not found' };
    if (!v.ready) return { ok: false, text: `${v.name} can't be used: ${v.why} Pick another voice from voice.list.`, summary: `${v.name} not usable` };
    if (v.model !== GSV_ID && !ctx.builtins?.engineInfo('sherpa').installed) return { ok: false, text: 'Lotus\'s voice engine is not installed. Tell the user to install it in Settings → Models.', summary: 'Voice engine not installed' };
    const tmp = tmpDir(ctx);
    try {
      const clips: { file: string; seconds: number }[] = [];
      for (let i = 0; i < texts.length; i++) {
        ctx.progress(`Speaking line ${i + 1} of ${texts.length}`);
        const wav = await speakLine(ctx, v, texts[i], typeof a.language === 'string' ? a.language : undefined);
        const f = join(tmp, `line${String(i).padStart(3, '0')}.wav`);
        writeFileSync(f, wav);
        clips.push({ file: f, seconds: wavSeconds(wav) || (await probe(t, f, ctx.signal)).duration });
      }
      const starts = Array.isArray(a.starts) ? a.starts.map((x) => (typeof x === 'number' ? x : Number(x))) : undefined;
      const { lines, total, moved } = layoutLines(texts, clips.map((c) => c.seconds), { starts });
      const name = outName(a.filename, 'voiceover.wav', ['.wav']);
      ctx.progress('Putting the lines together');
      const mixed = join(tmp, 'mix.wav');
      await runProgram(t.ffmpeg, mixArgs(clips.map((c, i) => ({ file: c.file, start: lines[i].start })), mixed, total, effectFilters(v.effects)), { signal: ctx.signal });
      writeFileSync(join(ctx.workDir, name), tagWav(new Uint8Array(readFileSync(mixed))));
      const subs = name.replace(/\.wav$/, '.srt');
      writeFileSync(join(ctx.workDir, subs), srt(lines));
      writeFileSync(timingFile(ctx.workDir, name), JSON.stringify({ voice: v.id, lines, total } satisfies Timing));
      titleOf(ctx.workDir, name, `Voiceover · ${v.name}`);
      titleOf(ctx.workDir, subs, 'Subtitles');
      return {
        ok: true,
        text: `Saved ${name} (${total.toFixed(1)} s, voice ${v.name}) and subtitles ${subs}. Lines: ${lines.map((l, i) => `${i + 1}) ${l.start.toFixed(1)}–${l.end.toFixed(1)} s`).join(', ')}.${moved ? ` ${moved} line${moved === 1 ? ' was' : 's were'} moved later so lines don't overlap; shorten them if they must hit their moments.` : ''} Next: video.make with voiceover "${name}".`,
        summary: `${total.toFixed(1)} s voiceover · ${v.name}`, data: { file: name, seconds: total, voice: v.id },
      };
    } finally { cleanTmp(tmp); }
  },
};

// ── Putting it together ────────────────────────────────────────────────────

export const videoMake: Tool = {
  name: 'video.make', label: 'Making a video', risk: 'write',
  description: 'Put a video together from scenes: pictures (shown with a slow pan or zoom) and video clips, joined with crossfades, with the voiceover from video.voiceover, optional music and subtitles. To narrate an existing video, give that video as the only scene. Saves an MP4 in this work.',
  parameters: { type: 'object', properties: {
    scenes: { type: 'array', items: { type: 'string' }, description: 'Pictures or video clips in order (file names in this work, Lotus Studio paths such as Images/…/Output 1.png, or files in the user\'s folders).' },
    durations: { type: 'array', items: { type: 'number' }, description: 'Optional seconds for each scene. Leave out to fit the scenes to the voiceover lines.' },
    voiceover: { type: 'string', description: 'The voiceover WAV from video.voiceover (optional).' },
    music: { type: 'string', description: 'Optional music file, played quietly under the voice.' },
    aspect: { type: 'string', description: 'Shape: 16:9 (default, 1280×720), 9:16 for phones, 1:1 or 4:5.', enum: ['16:9', '9:16', '1:1', '4:5'] },
    motion: { type: 'boolean', description: 'Slow pan and zoom on pictures (default true).' },
    original_sound: { type: 'string', description: 'When narrating one video: keep its sound, lower it under the voice (default) or mute it.', enum: ['keep', 'lower', 'mute'] },
    start_at: { type: 'number', description: 'When narrating one video: start this many seconds into it (optional).' },
    subtitles: { type: 'boolean', description: 'Add the voiceover lines as subtitles (default true).' },
    filename: { type: 'string', description: 'File name, e.g. launch-video.mp4 (default video.mp4).' },
  }, required: ['scenes'] },
  describe: (a) => `Make ${outName(a.filename, 'video.mp4', ['.mp4'])} from ${Array.isArray(a.scenes) ? a.scenes.length : 0} scene${Array.isArray(a.scenes) && a.scenes.length === 1 ? '' : 's'}`,
  async run(a, ctx) {
    if (!ctx.workDir) return { ok: false, text: 'Videos are made in Work mode.', summary: 'Not in Work mode' };
    const t = videoTools(ctx);
    if ('error' in t) return { ok: false, text: t.error, summary: 'FFmpeg not installed' };
    // Small models sometimes write "city.png | 5" for a scene with its length.
    const raw = (Array.isArray(a.scenes) ? a.scenes : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 60);
    if (!raw.length) return { ok: false, text: 'Give at least one picture or clip as scenes.', summary: 'No scenes' };
    const given: (number | undefined)[] = raw.map((s, i) => { const n = Array.isArray(a.durations) ? Number(a.durations[i]) : NaN; const m = /\|\s*(\d+(?:\.\d+)?)\s*s?\s*$/.exec(s); return n > 0 ? n : m ? Number(m[1]) : undefined; });
    const files: string[] = [];
    for (const s of raw) {
      const f = findInput(ctx, s.replace(/\|.*$/, '').trim());
      if (typeof f !== 'string') return { ok: false, text: f.error, summary: 'Scene not found' };
      files.push(f);
    }
    ctx.progress('Reading the scenes');
    const infos = await Promise.all(files.map((f) => probe(t, f, ctx.signal)));
    const bad = files.findIndex((f, i) => !infos[i].hasVideo || AUDIO_EXT.has(extname(f).toLowerCase()));
    if (bad >= 0) return { ok: false, text: `${basename(files[bad])} is not a picture or video. Sound goes in voiceover or music.`, summary: 'Not a picture or video' };
    const kinds = files.map((f, i): 'image' | 'video' => (PICTURE_EXT.has(extname(f).toLowerCase()) || infos[i].duration < 0.1 ? 'image' : 'video'));

    let voice: string | undefined, timing: Timing | null = null;
    if (a.voiceover) {
      const v = findInput(ctx, a.voiceover);
      if (typeof v !== 'string') return { ok: false, text: v.error, summary: 'Voiceover not found' };
      voice = v;
      try { timing = JSON.parse(readFileSync(timingFile(ctx.workDir, basename(v)), 'utf8')); } catch { timing = { voice: '', lines: [], total: (await probe(t, v, ctx.signal)).duration }; }
    }
    let music: string | undefined;
    if (a.music) { const m = findInput(ctx, a.music); if (typeof m !== 'string') return { ok: false, text: m.error, summary: 'Music not found' }; music = m; }

    const from = Math.max(0, Number(a.start_at) || 0);
    const narrating = files.length === 1 && kinds[0] === 'video';
    const clipLengths = infos.map((x, i) => (kinds[i] === 'video' ? Math.max(0.5, x.duration - (narrating ? from : 0)) : undefined));
    // Narrating a video: as long as the video, or the voiceover if that runs longer (the last frame holds).
    const durations = narrating && !given[0]
      ? [Math.max(clipLengths[0]!, timing?.total ?? 0)]
      : sceneDurations(files.length, { given, lines: timing?.lines, total: timing?.total, clipLengths, perPicture: 4 });
    const motion = a.motion !== false;
    const scenes: Scene[] = files.map((file, i) => ({ file, kind: kinds[i], duration: durations[i], from: narrating ? from : 0, motion: kinds[i] === 'image' && motion ? motionFor(i) : 'none' }));
    const { width, height } = sizeFor(typeof a.aspect === 'string' ? a.aspect : undefined);
    const total = durations.reduce((s, x) => s + x, 0);

    const tmp = tmpDir(ctx);
    try {
      let subtitles: string | undefined;
      if (a.subtitles !== false && timing?.lines.length) { subtitles = join(tmp, 'subs.srt'); writeFileSync(subtitles, srt(timing.lines)); }
      const name = outName(a.filename, 'video.mp4', ['.mp4', '.webm']);
      ctx.progress('Rendering');
      const r = await render(t, {
        scenes, width, height, fps: 30, fade: 0.5, voiceover: voice, music, subtitles,
        original: narrating && infos[0].hasAudio ? (a.original_sound === 'keep' || a.original_sound === 'mute' ? a.original_sound : 'lower') : 'mute',
        out: (c) => join(ctx.workDir!, name.replace(/\.(mp4|webm)$/, `.${c}`)),
      }, { signal: ctx.signal, onProgress: (done, all) => ctx.progress(`Rendering · ${Math.round(done)} of ${Math.round(all)} s`) });
      const file = basename(r.file);
      titleOf(ctx.workDir, file, `Video · ${file.replace(/\.[^.]+$/, '')}`);
      const mb = statSync(r.file).size / 1e6;
      return {
        ok: true,
        text: `Saved ${file}: ${total.toFixed(1)} s, ${width}×${height}, ${scenes.length} scene${scenes.length === 1 ? '' : 's'}${voice ? ', with voiceover' : ''}${music ? ', with music' : ''}${subtitles && r.file.endsWith('.mp4') ? ', with subtitles' : ''} (${mb.toFixed(1)} MB, ${r.encoder}). The user can play it in the Artifacts panel. Scene times: ${scenes.map((s, i) => `${i + 1}) ${basename(s.file)} ${s.duration.toFixed(1)} s`).join(', ')}.`,
        summary: `${file} · ${clock(total)} · ${width}×${height}`, data: { file, seconds: total, encoder: r.encoder },
      };
    } finally { cleanTmp(tmp); }
  },
};

// ── New footage (AI video) ─────────────────────────────────────────────────

/** The fallback the agent takes when this computer can't film: still pictures with slow moves. */
const FALLBACK = 'Fall back to pictures: make one picture per shot with image.generate and put them together with video.make (slow pans and zooms). Tell the user why in one sentence.';

/** Words for why there is no AI video here, and what to get. */
export function noVideoModel(installed: { family: keyof typeof VIDEO_FAMILIES; title: string }[], m: Parameters<typeof videoFamilyFor>[0]): string {
  const best = videoFamilyFor(m);
  if (!best) return `${(videoFit('wan21-1.3b', m) as { why: string }).why} ${FALLBACK}`;
  const tooBig = installed.filter((x) => !videoFit(x.family, m).ok);
  const entry = LIBRARY.find((e) => e.video?.family === best);
  return `${tooBig.length ? `${tooBig.map((x) => x.title).join(', ')} is too big for this computer. ` : 'No AI video model is downloaded yet. '}The one for this computer is ${entry?.title ?? VIDEO_FAMILIES[best].label} (${entry?.diskGb ?? '?'} GB download) in Settings → Models → Video. ${FALLBACK}`;
}

const frameNo = (f: string) => Number(/(\d+)\.png$/i.exec(f)?.[1] ?? 0);

export const videoGenerate: Tool = {
  name: 'video.generate', label: 'Filming with AI', risk: 'write',
  description: 'Film NEW moving footage with AI on this computer (Wan video models): give what each shot shows, and Lotus makes the clips and joins them into one MP4 in this work (no sound; add a voiceover with video.make, using this file as a scene). Slow: several minutes per 2-second clip on an 8 GB card, so keep shots few and short. On bigger cards it can also bring a picture to life. If it says this computer can\'t, use pictures with video.make instead.',
  parameters: { type: 'object', properties: {
    shots: { type: 'array', items: { type: 'string' }, description: 'What each shot shows, in order: subject, action, place, camera, light, e.g. "a physiotherapist guides a patient through a slow shoulder stretch in a bright clinic, camera slowly pushes in". One clip per shot.' },
    seconds: { type: 'number', description: `Total length to aim for (default: one clip per shot, 2–5 s each depending on the card; at most ${MAX_VIDEO_SECONDS}).` },
    style: { type: 'string', description: 'Style words added to every shot so they look like one film, e.g. "warm natural light, 35mm film look".' },
    picture: { type: 'string', description: 'Optional: a picture to bring to life as the first shot (only on cards that can; otherwise it is made from the words).' },
    aspect: { type: 'string', enum: ['16:9', '9:16', '1:1'], description: 'Shape (default 16:9).' },
    filename: { type: 'string', description: 'File name, e.g. footage.mp4 (default ai-footage.mp4).' },
    seed: { type: 'number', description: 'Optional seed, to make the same footage again.' },
  }, required: ['shots'] },
  describe: (a) => `Film ${Array.isArray(a.shots) ? a.shots.length : 0} AI shot${Array.isArray(a.shots) && a.shots.length === 1 ? '' : 's'} into ${outName(a.filename, 'ai-footage.mp4', ['.mp4'])}`,
  async run(a, ctx) {
    if (!ctx.workDir) return { ok: false, text: 'AI footage is made in Work mode.', summary: 'Not in Work mode' };
    const b = ctx.builtins;
    if (!b) return { ok: false, text: `Lotus's own engines aren't available here. ${FALLBACK}`, summary: 'No engines' };
    const t = videoTools(ctx);
    if ('error' in t) return { ok: false, text: t.error, summary: 'FFmpeg not installed' };
    if (!b.engineInfo('sd').installed) return { ok: false, text: `Lotus's image engine (stable-diffusion.cpp) isn't installed, and it makes the video. Tell the user to install it in Settings → Models → Video. ${FALLBACK}`, summary: 'Image engine not installed' };
    const shots = (Array.isArray(a.shots) ? a.shots : [a.shots]).map((x) => String(x ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 30);
    if (!shots.length) return { ok: false, text: 'Say what each shot shows, in shots.', summary: 'No shots' };
    const m = await b.machine();
    const installed = b.videoModels();
    const model = pickVideoModel(installed, m);
    if (!model) return { ok: false, text: noVideoModel(installed, m), summary: 'No AI video on this computer' };
    const spec = VIDEO_FAMILIES[model.family];
    const plan = planVideo(model.family, m, { seconds: Number(a.seconds) || undefined, aspect: typeof a.aspect === 'string' ? a.aspect : undefined });
    // One clip per shot; a length longer than the shots repeats the last shot with a new take.
    const count = Math.max(shots.length, Number(a.seconds) > 0 ? plan.clips : shots.length);
    const prompts = Array.from({ length: Math.min(30, count) }, (_, i) => videoPrompt(shots[Math.min(i, shots.length - 1)], typeof a.style === 'string' ? a.style : undefined));
    let picture: string | undefined;
    let pictureNote = '';
    if (a.picture) {
      const f = findInput(ctx, a.picture);
      if (typeof f !== 'string') return { ok: false, text: f.error, summary: 'Picture not found' };
      if (spec.fromPicture) picture = f;
      else pictureNote = ` ${model.title} can't start from a picture, so the first shot was made from the words (picture-to-video needs Wan 2.2 5B and a 12 GB card).`;
    }
    const seed0 = Number.isFinite(Number(a.seed)) && a.seed !== undefined ? Math.floor(Number(a.seed)) : Math.floor(Math.random() * 2 ** 31);
    let ladder = videoLadder(model.family, plan);
    const tmp = tmpDir(ctx);
    const clips: string[] = [];
    let shrunk: VideoAttempt | null = null;
    const started = Date.now();
    try {
      ctx.progress(`Filming ${prompts.length} clip${prompts.length === 1 ? '' : 's'} with ${model.title}, ${aboutTime(prompts.length * spec.minutesPerClip)}`);
      for (let i = 0; i < prompts.length; i++) {
        const done = Date.now() - started;
        const left = i ? aboutTime(((done / i) * (prompts.length - i)) / 60_000) + ' left' : aboutTime((prompts.length - i) * spec.minutesPerClip) + ' left (a guess until the first clip is done)';
        // Picture-capable models carry on from the last frame of the shot before when it's the same shot.
        let init = i === 0 ? picture : undefined;
        if (i > 0 && spec.fromPicture && shots[Math.min(i, shots.length - 1)] === shots[Math.min(i - 1, shots.length - 1)]) {
          const last = join(tmp, `last${i}.png`);
          try { await runProgram(t.ffmpeg, ['-y', '-nostdin', '-v', 'error', '-sseof', '-0.2', '-i', clips[i - 1], '-frames:v', '1', '-update', '1', last], { signal: ctx.signal }); if (existsSync(last)) init = last; } catch { /* a fresh take instead */ }
        }
        const r = await b.generateVideoClip(model, ladder, { prompt: prompts[i], seed: seed0 + i, init, lowVram: plan.lowVram }, {
          signal: ctx.signal,
          onProgress: (step, total) => ctx.progress(`Filming clip ${i + 1} of ${prompts.length} · step ${step} of ${total} · ${left}`),
          onRetry: (why, next) => ctx.progress(`Clip ${i + 1}: the graphics card ${why}; trying again at ${next.width}×${next.height}, ${next.frames} frames`),
        });
        // Later clips start where this one succeeded instead of failing the same way first.
        const idx = ladder.findIndex((x) => x === r.attempt);
        if (idx > 0) { shrunk = r.attempt; ladder = ladder.slice(idx); }
        const clip = join(tmp, `clip${String(i).padStart(2, '0')}.avi`);
        try {
          if (r.files.length === 1) writeFileSync(clip, readFileSync(r.files[0]));
          else {
            // Older sd-cli builds write numbered PNG frames: join them first.
            const frames = [...r.files].sort((x, y) => frameNo(x) - frameNo(y));
            const fdir = join(tmp, `frames${i}`); mkdirSync(fdir, { recursive: true });
            frames.forEach((f, k) => writeFileSync(join(fdir, `f${String(k).padStart(4, '0')}.png`), readFileSync(f)));
            await runProgram(t.ffmpeg, ['-y', '-nostdin', '-v', 'error', '-framerate', String(spec.fps), '-i', join(fdir, 'f%04d.png'), '-c:v', 'mjpeg', '-q:v', '2', clip], { signal: ctx.signal });
          }
        } finally { b.cleanOutputs(r.files); }
        clips.push(clip);
      }
      ctx.progress('Joining the clips');
      const infos = await Promise.all(clips.map((c) => probe(t, c, ctx.signal)));
      const scenes: Scene[] = clips.map((file, i) => ({ file, kind: 'video', duration: Math.max(0.3, infos[i].duration || (plan.frames - 1) / spec.fps), from: 0, motion: 'none' }));
      const name = outName(a.filename, 'ai-footage.mp4', ['.mp4', '.webm']);
      const res = await render(t, { scenes, width: plan.width, height: plan.height, fps: spec.fps === 24 ? 24 : 16, fade: spec.fromPicture ? 0 : 0.25, out: (c) => join(ctx.workDir!, name.replace(/\.(mp4|webm)$/, `.${c}`)) }, { signal: ctx.signal });
      const file = basename(res.file);
      titleOf(ctx.workDir, file, `AI footage · ${file.replace(/\.[^.]+$/, '')}`);
      const total = scenes.reduce((s, x) => s + x.duration, 0);
      const minutes = (Date.now() - started) / 60_000;
      return {
        ok: true,
        text: `Saved ${file}: ${total.toFixed(1)} s of new AI footage (${clips.length} clip${clips.length === 1 ? '' : 's'}, ${plan.width}×${plan.height}, no sound) made with ${model.title} in ${aboutTime(minutes).replace('about ', '')}.${shrunk ? ` The graphics card ran short of memory, so clips were made at ${shrunk.width}×${shrunk.height}, ${shrunk.frames} frames.` : ''}${pictureNote} Use it as a scene in video.make to add the voiceover, music and subtitles.`,
        summary: `${file} · ${total.toFixed(1)} s · ${model.title}`, data: { file, seconds: total, model: model.id, clips: clips.length },
      };
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      const made = clips.length ? ` ${clips.length} of ${prompts.length} clips were done before it stopped.` : '';
      return { ok: false, text: `${(e as Error).message}${made} ${FALLBACK}`, summary: 'AI footage failed' };
    } finally { cleanTmp(tmp); }
  },
};

export const VIDEO_TOOLS: Tool[] = [voiceList, videoInspect, videoVoiceover, videoGenerate, videoMake];
