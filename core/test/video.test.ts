// 0.21: videos with voiceover in Work mode (core/src/tools/video.ts, core/src/video/*).
//   1. FFmpeg is a Lotus Engine: the LGPL build for each computer, never a GPL or shared one.
//   2. The ffmpeg commands: frame sheets, voiceover layout, subtitles, scene lengths, crossfades.
//   3. Voices: the agent sees the same list as the Voice page; copied voices need the consent promise
//      and follow the Pro switch.
//   4. End to end with a real ffmpeg (skipped when there is none): pictures + voiceover → MP4 with
//      sound and subtitles; a video narrated over its own sound; a video watched and listened to.
//   5. The agent loop shows video frames to models that can see, and tells the others.

import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pickAssets, RUNTIMES, BUILTIN_ORDER, type Platform } from '../src/engines/assets';
import { effectFilters, layoutLines, mixArgs, motionFor, parseProbe, renderArgs, sceneDurations, sheetArgs, sheetGrid, sheetTimes, sizeFor, srt, usableEncoders, wavSeconds, ENCODERS } from '../src/video/ffmpeg';
import { probe, runProgram } from '../src/video/run';
import { findVoice, videoInspect, videoMake, videoVoiceover, videoVoices, voiceList, MINE_KEY, VIDEO_TOOLS } from '../src/tools/video';
import { artifactKind, listArtifacts } from '../src/tools/work';
import type { ToolCtx } from '../src/agent/types';
import type { MyVoice } from '../../src/voice/studio';
import { runAgent, type AgentDeps } from '../src/agent/loop';
import { Registry } from '../src/agent/registry';
import { parseRules } from '../src/agent/policy';
import { fakeOllama, last } from './fakes';
import type { WireMsg } from '../src/agent/llm';
import { ALL_TOOLS } from '../src/agent/service';

const dirs: string[] = [];
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), `lotus-video-${p}-`)); dirs.push(d); return d; };
const stops: (() => void)[] = [];
afterAll(() => { stops.forEach((s) => s()); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

// ── 1. The engine ──────────────────────────────────────────────────────────

// Names from BtbN/FFmpeg-Builds' "latest" release (seen 21 Nov 2026).
const BTBN = [
  'ffmpeg-master-latest-win64-gpl.zip', 'ffmpeg-master-latest-win64-lgpl.zip', 'ffmpeg-master-latest-win64-lgpl-shared.zip',
  'ffmpeg-n9.0-latest-win64-gpl-9.0.zip', 'ffmpeg-n9.0-latest-win64-lgpl-9.0.zip', 'ffmpeg-n9.0-latest-win64-lgpl-shared-9.0.zip',
  'ffmpeg-n8.1-latest-win64-lgpl-8.1.zip', 'ffmpeg-n9.0-latest-winarm64-lgpl-9.0.zip',
  'ffmpeg-master-latest-linux64-lgpl.tar.xz', 'ffmpeg-n9.0-latest-linux64-gpl-9.0.tar.xz', 'ffmpeg-n9.0-latest-linux64-lgpl-9.0.tar.xz',
  'ffmpeg-n9.0-latest-linuxarm64-lgpl-9.0.tar.xz', 'checksums.sha256',
].map((name) => ({ name, url: `https://example/${name}`, size: 160e6 }));
const pc = (os: Platform['os'], arch: Platform['arch'] = 'x64', gpu: Platform['gpu'] = 'nvidia'): Platform => ({ os, arch, gpu });

describe('FFmpeg engine', () => {
  test('is the fourth Lotus Engine, LGPL', () => {
    expect(BUILTIN_ORDER).toEqual(['llama', 'sd', 'sherpa', 'ffmpeg']);
    expect(RUNTIMES.ffmpeg.licence).toBe('LGPL-2.1');
    expect(RUNTIMES.ffmpeg.exes).toEqual([['ffmpeg'], ['ffprobe']]);
  });
  test('picks a release-branch LGPL static build for each computer, never GPL or shared', () => {
    expect(pickAssets('ffmpeg', BTBN, pc('windows'))?.main.name).toBe('ffmpeg-n9.0-latest-win64-lgpl-9.0.zip');
    expect(pickAssets('ffmpeg', BTBN, pc('windows', 'arm64'))?.main.name).toBe('ffmpeg-n9.0-latest-winarm64-lgpl-9.0.zip');
    expect(pickAssets('ffmpeg', BTBN, pc('linux'))?.main.name).toBe('ffmpeg-n9.0-latest-linux64-lgpl-9.0.tar.xz');
    expect(pickAssets('ffmpeg', BTBN, pc('linux', 'arm64'))?.main.name).toBe('ffmpeg-n9.0-latest-linuxarm64-lgpl-9.0.tar.xz');
    expect(pickAssets('ffmpeg', BTBN, pc('macos', 'arm64', 'apple'))).toBeNull();
    // Only master builds left: those, still LGPL.
    const master = BTBN.filter((a) => a.name.includes('master'));
    expect(pickAssets('ffmpeg', master, pc('windows'))?.main.name).toBe('ffmpeg-master-latest-win64-lgpl.zip');
    for (const p of [pc('windows'), pc('linux'), pc('windows', 'arm64')]) expect(pickAssets('ffmpeg', BTBN, p)?.main.name).not.toMatch(/-gpl|shared/);
  });
});

// ── 2. Commands ─────────────────────────────────────────────────────────────

describe('ffmpeg commands', () => {
  test('ffprobe output is read; pictures read as 0 s', () => {
    expect(parseProbe({ format: { duration: '12.48' }, streams: [{ codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '30000/1001' }, { codec_type: 'audio' }] }))
      .toEqual({ duration: 12.48, width: 1920, height: 1080, fps: 29.97, hasVideo: true, hasAudio: true });
    expect(parseProbe({ streams: [{ codec_type: 'video', width: 512, height: 512, avg_frame_rate: '0/0', r_frame_rate: '25/1' }] }).duration).toBe(0);
    expect(parseProbe(null)).toMatchObject({ hasVideo: false, hasAudio: false });
  });

  test('frame sheet: a grid and the time of each tile', () => {
    expect(sheetGrid(4)).toEqual({ cols: 2, rows: 2 });
    expect(sheetGrid(9)).toEqual({ cols: 3, rows: 3 });
    expect(sheetGrid(16)).toEqual({ cols: 4, rows: 4 });
    expect(sheetTimes(90, 9)).toEqual([5, 15, 25, 35, 45, 55, 65, 75, 85]);
    const a = sheetArgs('in.mp4', 'out.jpg', { duration: 90 }, 9);
    expect(a.join(' ')).toContain('fps=9/90.000,scale=426:-2,tile=3x3');
  });

  test('voiceover lines follow each other, or their start times without overlapping', () => {
    const seq = layoutLines(['a', 'b', 'c'], [2, 1.5, 3]);
    expect(seq.lines.map((l) => [l.start, l.end])).toEqual([[0.3, 2.3], [2.65, 4.15], [4.5, 7.5]]);
    expect(seq.total).toBe(8.1);
    const timed = layoutLines(['a', 'b'], [3, 2], { starts: [1, 2] });
    expect(timed.lines.map((l) => l.start)).toEqual([1, 4.1]);
    expect(timed.moved).toBe(1);
  });

  test('subtitles are SubRip', () => {
    expect(srt([{ text: 'Hello  there', start: 0.3, end: 2.05 }, { text: 'Bye', start: 61.5, end: 3725.25 }]))
      .toBe('1\n00:00:00,300 --> 00:00:02,050\nHello there\n\n2\n00:01:01,500 --> 01:02:05,250\nBye\n');
  });

  test('scene lengths: given, fitted to the lines, shared out, or the clip\'s own', () => {
    const lines = layoutLines(['a', 'b', 'c'], [2, 2, 2]).lines;
    expect(sceneDurations(3, { lines, total: 8 })).toEqual([2.65, 2.35, 3]);
    expect(sceneDurations(2, { lines, total: 8 })).toEqual([4, 4]);
    expect(sceneDurations(2, { given: [5, undefined], total: 8 })).toEqual([5, 3]);
    expect(sceneDurations(2, { clipLengths: [undefined, 7] })).toEqual([4, 7]);
  });

  test('render: pictures move, scenes crossfade at the right times, and the length is kept', () => {
    const enc = ENCODERS.find((e) => e.name === 'libx264')!;
    const a = renderArgs({ scenes: [{ file: 'a.png', kind: 'image', duration: 3, motion: 'in' }, { file: 'b.png', kind: 'image', duration: 2, motion: 'right' }, { file: 'c.mp4', kind: 'video', duration: 4 }], width: 1280, height: 720, voiceover: 'vo.wav', subtitles: 's.srt', encoder: enc, out: 'v.mp4' });
    const f = a[a.indexOf('-filter_complex') + 1];
    expect(f).toContain("zoompan=z='1+0.12*on/105':");
    expect(f).toContain('xfade=transition=fade:duration=0.500:offset=3.000');
    expect(f).toContain('xfade=transition=fade:duration=0.500:offset=5.000');
    expect(a.slice(a.indexOf('-t', a.indexOf('-filter_complex')))[1]).toBe('9.000');
    expect(a).toContain('mov_text');
    expect(a.join(' ')).toContain('comment=Made with Lotus');
    expect(motionFor(0)).toBe('in'); expect(motionFor(1)).toBe('right');
    expect(sizeFor('9:16')).toEqual({ width: 720, height: 1280 });
  });

  test('narrating one video lowers its own sound under the voice', () => {
    const enc = ENCODERS.find((e) => e.name === 'libx264')!;
    const a = renderArgs({ scenes: [{ file: 'c.mp4', kind: 'video', duration: 6 }], width: 1280, height: 720, voiceover: 'vo.wav', original: 'lower', encoder: enc, out: 'v.mp4' });
    const f = a[a.indexOf('-filter_complex') + 1];
    expect(f).toContain('volume=0.25[orig]');
    expect(f).toContain('[vo][orig]amix=inputs=2');
  });

  test('encoders: the best this ffmpeg has, hardware first; WebM only as a fallback', () => {
    const listing = ' V....D libx264              libx264 H.264\n V....D h264_nvenc           NVIDIA NVENC\n V....D libvpx-vp9           VP9\n A....D aac                  AAC\n';
    expect(usableEncoders(listing).map((e) => e.name)).toEqual(['h264_nvenc', 'libx264', 'libvpx-vp9']);
    expect(usableEncoders(' V....D libvpx-vp9  x\n V....D mpeg4  y\n').map((e) => e.container)).toEqual(['webm', 'mp4']);
  });

  test('voice effects that ffmpeg can apply', () => {
    expect(effectFilters({ bass: 4, treble: 2, volume: -3, normalize: true })).toEqual(['bass=g=4:f=200', 'treble=g=2:f=4000', 'volume=-3dB', 'dynaudnorm=p=0.89']);
    expect(effectFilters(undefined)).toEqual([]);
    expect(mixArgs([{ file: 'a.wav', start: 0.3 }], 'o.wav', 3).join(' ')).toContain('adelay=300:all=1');
  });

  test('WAV length from its header', () => {
    expect(wavSeconds(wav(1.5, 24000))).toBe(1.5);
    expect(wavSeconds(new Uint8Array(10))).toBe(0);
  });

  test('the Artifacts panel lists videos, sounds and pictures as media', () => {
    expect(['video.mp4', 'voiceover.wav', 'scene.png', 'voiceover.srt', 'x.md'].map(artifactKind)).toEqual(['video', 'audio', 'picture', 'document', 'document']);
  });
});

/** A silent mono 16-bit WAV of `s` seconds. */
function wav(s: number, rate = 16000): Uint8Array {
  const n = Math.round(s * rate) * 2;
  const h = Buffer.alloc(44 + n); h.write('RIFF', 0); h.writeUInt32LE(36 + n, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(n, 40);
  return new Uint8Array(h);
}

// ── 3. Voices ───────────────────────────────────────────────────────────────

const INSTALLED = [
  { id: 'kokoro', kind: 'voice', title: 'Kokoro', entryId: 'kokoro' },
  { id: 'piper-pt', kind: 'voice', title: 'Piper · Tugão (Portuguese, Portugal)', entryId: 'piper-pt-pt-tugao' },
  { id: 'pocket', kind: 'voice', title: 'PocketTTS', entryId: 'pocket-tts' },
  { id: 'whisper', kind: 'dictation', title: 'Whisper', entryId: 'whisper-turbo' },
];
const MINE: MyVoice[] = [
  { id: 'v-me', name: 'Filipe', model: 'pocket', reference: 'Audio/2026-11/me.wav', created: 1, consentAt: 2 },
  { id: 'v-old', name: 'Old clone', model: 'pocket', reference: 'Audio/2026-11/old.wav', created: 1 },
];

describe('voices for videos', () => {
  test('built-in speakers and the user\'s own voices, with languages', () => {
    const list = videoVoices(INSTALLED, MINE, { selected: 'preset:kokoro:3' });
    const heart = list.find((v) => v.id === 'preset:kokoro:3')!;
    expect(heart.name).toBe('Heart · US English, female');
    expect(heart.usual).toBe(true);
    expect(heart.languages).toEqual(['en']);
    expect(list.filter((v) => v.model === 'kokoro').length).toBe(28);
    expect(list.find((v) => v.id === 'v-me')).toMatchObject({ mine: true, copied: true, ready: true });
  });

  test('a copied voice without the consent promise is not used; Pro locks copied voices', () => {
    const list = videoVoices(INSTALLED, MINE);
    expect(list.find((v) => v.id === 'v-old')).toMatchObject({ ready: false });
    expect(list.find((v) => v.id === 'v-old')!.why).toContain('consent promise');
    const locked = videoVoices(INSTALLED, MINE, { proLocked: true });
    expect(locked.find((v) => v.id === 'v-me')).toMatchObject({ ready: false, why: 'Cloned voices are part of Lotus Pro.' });
    expect(locked.find((v) => v.id === 'preset:kokoro:0')!.ready).toBe(true);
  });

  test('the model can name a voice by id or by name; no name means the usual voice', () => {
    const list = videoVoices(INSTALLED, MINE, { selected: 'preset:kokoro:3' });
    expect(findVoice(list, 'preset:kokoro:12')?.name).toContain('Echo');
    expect(findVoice(list, 'Heart')?.id).toBe('preset:kokoro:3');
    expect(findVoice(list, 'filipe')?.id).toBe('v-me');
    expect(findVoice(list, '')?.id).toBe('preset:kokoro:3');
    expect(findVoice(list, 'Morgan Freeman')).toBeNull();
  });

  test('the video tools are in Work only, with the right risk', () => {
    expect(VIDEO_TOOLS.map((t) => [t.name, t.risk])).toEqual([['voice.list', 'read'], ['video.inspect', 'read'], ['video.voiceover', 'write'], ['video.make', 'write']]);
    for (const t of VIDEO_TOOLS) expect(ALL_TOOLS).toContain(t);
  });
});

// ── 4. End to end with a real ffmpeg ────────────────────────────────────────

const FFMPEG = Bun.which('ffmpeg');
const FFPROBE = Bun.which('ffprobe');

/** A stand-in for Lotus's engines: speaks a tone as long as the words take, hears "hello world". */
function fakeBuiltins(o: { sherpa?: boolean; ffmpeg?: boolean } = {}) {
  const spoken: { voice: string; text: string; speaker?: number; ref?: unknown }[] = [];
  const out = tmp('tts');
  let n = 0;
  return {
    spoken,
    installed: () => INSTALLED,
    engineInfo: (id: string) => ({ installed: id === 'sherpa' ? o.sherpa !== false : true }),
    videoTool: (name: 'ffmpeg' | 'ffprobe') => (o.ffmpeg === false ? null : name === 'ffmpeg' ? FFMPEG : FFPROBE),
    async speak(voice: string, text: string, opt: { speaker?: number; ref?: unknown } = {}) {
      spoken.push({ voice, text, speaker: opt.speaker, ref: opt.ref });
      const f = join(out, `${n++}.wav`);
      writeFileSync(f, wav(Math.max(0.6, text.split(/\s+/).length * 0.35), 24000));
      return f;
    },
    async transcribe() { return 'hello world'; },
  };
}

function videoCtx(b: ReturnType<typeof fakeBuiltins>, kv: Record<string, string> = {}): ToolCtx & { workDir: string } {
  const studio = tmp('studio');
  const workDir = join(studio, 'Work', 'w1');
  mkdirSync(workDir, { recursive: true });
  mkdirSync(join(studio, 'Audio', '2026-11'), { recursive: true });
  writeFileSync(join(studio, 'Audio', '2026-11', 'me.wav'), wav(2));
  const store = new Map(Object.entries({ [MINE_KEY]: JSON.stringify(MINE), ...kv }));
  return { db: null as never, studio, workDir, folders: [studio], signal: new AbortController().signal, memoryOn: false, fetch, progress: () => undefined,
    kvSet: (k, v) => void store.set(k, v), kvGet: (k) => store.get(k) ?? null, builtins: b as never };
}

const run = (t: { run: (a: Record<string, unknown>, c: ToolCtx) => Promise<{ ok: boolean; text: string; data?: Record<string, unknown> }> }, a: Record<string, unknown>, c: ToolCtx) => t.run(a, c);

describe.skipIf(!FFMPEG)('making videos with a real ffmpeg', () => {
  test('pictures + voiceover → an MP4 with sound and subtitles, scenes timed to the lines', async () => {
    const b = fakeBuiltins();
    const ctx = videoCtx(b);
    for (const [i, c] of ['orange', 'teal', 'purple'].entries()) await runProgram(FFMPEG!, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${c}:s=640x480`, '-frames:v', '1', join(ctx.workDir, `scene${i + 1}.png`)]);

    const voices = await run(voiceList, {}, ctx);
    expect(voices.ok).toBe(true);
    expect(voices.text).toContain('preset:kokoro:3 · Heart · US English, female');
    expect(voices.text).toContain('v-old · Old clone');
    expect(voices.text).toContain('NOT USABLE');

    const vo = await run(videoVoiceover, { voice: 'Heart', lines: ['Mornings at the clinic start quietly.', 'Then the first patient walks in.', 'We help you move again.'] }, ctx);
    expect(vo.ok).toBe(true);
    expect(b.spoken.map((s) => [s.voice, s.speaker])).toEqual([['kokoro', 3], ['kokoro', 3], ['kokoro', 3]]);
    const voWav = readFileSync(join(ctx.workDir, 'voiceover.wav'));
    expect(new TextDecoder().decode(voWav)).toContain('Made with Lotus');
    expect(readFileSync(join(ctx.workDir, 'voiceover.srt'), 'utf8')).toContain('Then the first patient walks in.');
    const total = vo.data!.seconds as number;
    expect(Math.abs(wavSeconds(new Uint8Array(voWav)) - total)).toBeLessThan(0.05);

    const made = await run(videoMake, { scenes: ['scene1.png', 'scene2.png', 'scene3.png'], voiceover: 'voiceover.wav', filename: 'clinic.mp4' }, ctx);
    expect(made.ok).toBe(true);
    const file = join(ctx.workDir, made.data!.file as string);
    expect(existsSync(file)).toBe(true);
    const info = await probe({ ffmpeg: FFMPEG!, ffprobe: FFPROBE }, file);
    expect(info).toMatchObject({ width: 1280, height: 720, hasVideo: true, hasAudio: true });
    expect(Math.abs(info.duration - total)).toBeLessThan(0.25);
    if (FFPROBE) {
      const { stdout } = await runProgram(FFPROBE, ['-v', 'error', '-show_streams', '-print_format', 'json', file]);
      expect(JSON.parse(stdout).streams.map((s: { codec_type: string }) => s.codec_type)).toContain('subtitle');
    }
    const listed = listArtifacts(ctx.workDir).map((a) => [a.file, a.kind]);
    expect(listed).toEqual(expect.arrayContaining([['clinic.mp4', 'video'], ['voiceover.wav', 'audio'], ['voiceover.srt', 'document']]));
    expect(listed.some(([f]) => f.startsWith('.'))).toBe(false);
  }, 120_000);

  test('watching a video: facts, a frame sheet for the model, and what is said', async () => {
    const b = fakeBuiltins();
    const ctx = videoCtx(b);
    await runProgram(FFMPEG!, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=s=640x360:d=6:r=25', '-f', 'lavfi', '-i', 'sine=f=440:d=6', '-shortest', '-c:v', 'mpeg4', '-c:a', 'aac', join(ctx.workDir, 'clip.mp4')]);
    const r = await run(videoInspect, { file: 'clip.mp4' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.text).toContain('640×360');
    expect(r.text).toContain('with sound');
    expect(r.text).toContain('[0:00] hello world');
    expect(String(r.data!.imageB64).startsWith('/9j/')).toBe(true); // a JPEG
    expect(String(r.data!.imageNote)).toContain('9 frames');
    expect(existsSync(join(ctx.workDir, 'clip-transcript.md'))).toBe(true);
    const one = await run(videoInspect, { file: 'clip.mp4', at: 3, listen: false }, ctx);
    expect(String(one.data!.imageNote)).toContain('0:03');
  }, 60_000);

  test('narrating a video: the voice goes on top, its own sound is lowered, the video keeps its length', async () => {
    const b = fakeBuiltins();
    const ctx = videoCtx(b);
    await runProgram(FFMPEG!, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=s=640x360:d=5:r=25', '-f', 'lavfi', '-i', 'sine=f=220:d=5', '-shortest', '-c:v', 'mpeg4', '-c:a', 'aac', join(ctx.workDir, 'walk.mp4')]);
    const vo = await run(videoVoiceover, { voice: 'Filipe', lines: ['Here we go.', 'Nice and slow.'], starts: [0.5, 2.5] }, ctx);
    expect(vo.ok).toBe(true);
    // The copied voice speaks with its recording.
    expect(b.spoken[0]).toMatchObject({ voice: 'pocket' });
    expect(JSON.stringify(b.spoken[0].ref)).toContain('me.wav');
    const made = await run(videoMake, { scenes: ['walk.mp4'], voiceover: 'voiceover.wav', original_sound: 'lower' }, ctx);
    expect(made.ok).toBe(true);
    const info = await probe({ ffmpeg: FFMPEG!, ffprobe: FFPROBE }, join(ctx.workDir, 'video.mp4'));
    expect(info.hasAudio).toBe(true);
    expect(Math.abs(info.duration - 5)).toBeLessThan(0.25);
  }, 60_000);

  test('refusals: no ffmpeg, a voice without consent, a file that is not there', async () => {
    const ctx = videoCtx(fakeBuiltins({ ffmpeg: false }));
    expect((await run(videoMake, { scenes: ['a.png'] }, ctx)).text).toContain('Settings → Models');
    const ok = videoCtx(fakeBuiltins());
    const old = await run(videoVoiceover, { voice: 'v-old', lines: ['Hi'] }, ok);
    expect(old.ok).toBe(false);
    expect(old.text).toContain('consent promise');
    expect((await run(videoMake, { scenes: ['nope.png'] }, ok)).ok).toBe(false);
    expect((await run(videoVoiceover, { voice: 'Morgan Freeman', lines: ['Hi'] }, ok)).text).toContain('voice.list');
  }, 30_000);
});

// ── 5. Pictures in the agent loop ───────────────────────────────────────────

describe('video frames reach the model only when it can see', () => {
  const look = { name: 'video.inspect', label: 'Watching', risk: 'read' as const, description: 'x', parameters: { type: 'object' as const, properties: { file: { type: 'string' as const, description: 'f' } } },
    async run() { return { ok: true, text: 'A 0:06 video.', summary: '0:06 video', data: { imageB64: '/9j/AAAA', imageNote: '(Lotus) A sheet of 9 frames is attached.' } }; } };
  const go = async (vision: boolean | undefined, caps: string[]) => {
    const ol = fakeOllama((ms) => (last(ms, 'tool') ? { content: 'It shows a test pattern.' } : { calls: [{ name: 'video_inspect', args: { file: 'clip.mp4' } }] }), { capabilities: caps });
    stops.push(ol.stop);
    const deps: AgentDeps = { llm: { backend: 'ollama', url: ol.url, fetch }, registry: new Registry([look]), ctx: { db: null as never, studio: tmp('loop'), folders: [], memoryOn: false, fetch, kvSet: () => undefined, kvGet: () => null },
      signal: new AbortController().signal, emit: () => undefined, record: () => undefined, approve: async () => true };
    await runAgent({ runId: 'v', model: 'fake', messages: [{ role: 'user', content: 'what is in clip.mp4?' }] as WireMsg[], tools: [look], approval: 'auto', rules: parseRules([]), vision, capabilities: caps }, deps);
    return ol.requests[1].messages;
  };
  test('a vision model gets the sheet with its note', async () => {
    const ms = await go(undefined, ['completion', 'tools', 'vision']);
    const shot = ms.find((m) => m.role === 'user' && 'images' in m && m.images?.length);
    expect(shot?.content).toContain('9 frames');
  });
  test('a model without vision is told instead', async () => {
    const ms = await go(undefined, ['completion', 'tools']);
    expect(ms.some((m) => 'images' in m && m.images?.length)).toBe(false);
    expect(ms.some((m) => m.role === 'user' && m.content.includes("can't see images"))).toBe(true);
    const ms2 = await go(false, []);
    expect(ms2.some((m) => 'images' in m && m.images?.length)).toBe(false);
  });
});

// ── 6. The Video page and the Video plugin ─────────────────────────────────

import { videoRequest } from '../../src/work/videoBrief';
import { mediaUploadName } from '../src/server';
import { builtinPlugins } from '../../src/plugins/builtin';
import { matchPluginSkills } from '../../src/plugins/block';

describe('Video page', () => {
  test('narrating: watch, script to the moments, the chosen voice, the video\'s own sound', () => {
    const t = videoRequest({ mode: 'narrate', files: ['walk.mp4'], brief: 'Explain the exercise', voice: { id: 'preset:kokoro:3', name: 'Heart' }, shape: '16:9', original: 'mute' });
    expect(t).toContain('"walk.mp4"');
    expect(t).toContain('video.inspect');
    expect(t).toContain('Use the voice preset:kokoro:3 (Heart)');
    expect(t).toContain('original_sound "mute"');
    expect(t).toContain('Explain the exercise');
  });
  test('from an idea: Lotus picks the voice and makes the pictures; from pictures: uses them in order', () => {
    const idea = videoRequest({ mode: 'idea', files: [], brief: 'Back stretches', shape: '9:16', seconds: 45 });
    expect(idea).toContain('45-second');
    expect(idea).toContain('voice.list');
    expect(idea).toContain('image.generate, aspect 9:16');
    expect(idea).toContain('aspect "9:16"');
    const pics = videoRequest({ mode: 'pictures', files: ['a.png', 'b.jpg'], brief: '', shape: '1:1' });
    expect(pics).toContain('"a.png", "b.jpg"');
    expect(pics).not.toContain('image.generate');
  });
  test('only videos, pictures and sound can be added to a job\'s folder', () => {
    expect(mediaUploadName('My Walk.MP4')).toBe('My Walk.MP4');
    expect(mediaUploadName('../../evil.mp4')).toBe('evil.mp4');
    expect(mediaUploadName('.hidden.png')).toBe('hidden.png');
    expect(mediaUploadName('notes.exe')).toBeNull();
    expect(mediaUploadName('')).toBeNull();
  });
});

describe('Video plugin', () => {
  const all = builtinPlugins();
  const top = (q: string) => matchPluginSkills(q, all, 2)[0]?.skill.name ?? null;
  test('is built in, on, original, and says why onetake was not copied', () => {
    const v = all.find((p) => p.id === 'builtin-video')!;
    expect(v.enabled).toBe(true);
    expect(v.credit?.license).toBe('Original');
    expect(v.credit?.note).toContain('onetake');
  });
  test('the right skill for each kind of request', () => {
    expect(top('make a 30 second promo video with voiceover for my physio clinic')).toBe('narrated-video');
    expect(top('add a voiceover narration to my existing video of the exercises')).toBe('narrate-a-video');
    expect(top('summarise what happens in this video recording')).toBe('understanding-a-video');
    expect(top('hello how are you')).toBeNull();
  });
});
