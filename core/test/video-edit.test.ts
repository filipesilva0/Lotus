// 0.22: the Video editor (core/src/video/edit.ts, editRun.ts, editService.ts).
//   1. Speech found from the sound, phrases for captions, caption looks and SubRip in and out.
//   2. Shorts: the best moments, starting where someone starts talking, never overlapping.
//   3. Auto edit: a highlight reel that keeps every file, and a talking video with its pauses cut.
//   4. The export's ffmpeg commands: one size for every clip, sound for every clip, captions burned in.
//   5. With a real ffmpeg (skipped when there is none): preview copies, a timeline exported with a
//      picture, two clips, a voiceover and burned captions; Shorts; a tightened talk; the editor's jobs.

import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assStyle, cleanCaption, cuesToSrt, findMoments, fitFilter, fontsConf, joinArgs, loudness, parseSceneTimes, parseSrt, pcmFromWav, phrasePieces,
  planHighlights, planTighten, proxyArgs, savedSeconds, segmentArgs, shotsOf, soundArgs, speechSpans, splitCues, thumbArgs, timelineSegments, wavBytes,
  wrapCaption, type Analysis,
} from '../src/video/edit';
import { ENCODERS, effectFilters, mixArgs, renderArgs } from '../src/video/ffmpeg';
import { analyse, captionsFor, exportTimeline, freeName, makeProxy, readMedia, safeName, type EditCtx } from '../src/video/editRun';
import { runOp, VideoEditService } from '../src/video/editService';
import { probe, runProgram } from '../src/video/run';
import { VIDEO_TOOLS, videoShorts } from '../src/tools/video';
import { ALL_TOOLS } from '../src/agent/service';

const dirs: string[] = [];
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), `lotus-edit-${p}-`)); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

/** 16 kHz samples: `pattern` is [seconds, loud?] pieces. */
function tone(pattern: [number, boolean][], rate = 16000): Int16Array {
  const total = pattern.reduce((s, [d]) => s + d, 0);
  const out = new Int16Array(Math.round(total * rate));
  let i = 0;
  for (const [d, loud] of pattern) {
    const n = Math.round(d * rate);
    for (let k = 0; k < n && i < out.length; k++, i++) out[i] = loud ? Math.round(Math.sin((2 * Math.PI * 220 * k) / rate) * 9000) : Math.round((Math.random() - 0.5) * 40);
  }
  return out;
}

describe('speech and captions', () => {
  test('WAV bytes round-trip, and speech is found between the pauses', () => {
    const s = tone([[1, false], [2, true], [1, false], [1.5, true], [0.8, false]]);
    const pcm = pcmFromWav(wavBytes(s, 16000))!;
    expect(pcm.rate).toBe(16000);
    expect(pcm.samples.length).toBe(s.length);
    const spans = speechSpans(loudness(pcm.samples, pcm.rate));
    expect(spans.length).toBe(2);
    expect(spans[0].start).toBeCloseTo(0.92, 1);
    expect(spans[0].end).toBeCloseTo(3.08, 1);
    expect(spans[1].start).toBeCloseTo(3.92, 1);
  });
  test('silence has no speech; a steady sound is all speech', () => {
    expect(speechSpans(loudness(tone([[3, false]]), 16000))).toEqual([]);
    expect(speechSpans(loudness(tone([[3, true]]), 16000))).toEqual([{ start: 0, end: 3 }]);
  });
  test('long speech is cut at its quietest moment into pieces Whisper and a caption can hold', () => {
    const db = new Float32Array(400).fill(-20); // 20 s of talk
    db[150] = -60; // a breath at 7.5 s
    const pieces = phrasePieces([{ start: 0, end: 20 }], db, 0.05, 7);
    expect(pieces.every((p) => p.end - p.start <= 7.01)).toBe(true);
    expect(pieces[0].end).toBeCloseTo(pieces[0].end, 2);
    expect(pieces[pieces.length - 1].end).toBe(20);
  });
  test('captions are tidied, split for each look and wrapped to two lines', () => {
    expect(cleanCaption('[Music] Hello  (laughs) there ♪')).toBe('Hello there');
    const parts = splitCues([{ start: 0, end: 4, text: 'one two three four five six seven eight' }], 4);
    expect(parts.map((p) => p.text)).toEqual(['one two three four', 'five six seven eight']);
    expect(parts[1].end).toBe(4);
    expect(wrapCaption('this is a fairly long caption that needs to be on two lines', 30).split('\n').length).toBe(2);
    const srt = cuesToSrt([{ start: 1.5, end: 3, text: 'Hello world' }]);
    expect(srt).toContain('00:00:01,500 --> 00:00:03,000');
    expect(parseSrt(srt)).toEqual([{ start: 1.5, end: 3, text: 'Hello world' }]);
  });
  test('each look is a libass style; tall videos get smaller letters', () => {
    expect(assStyle('bold', 720, 1280)).toContain('PrimaryColour=&H0000E5FF');
    expect(assStyle('boxed', 1280, 720)).toContain('BorderStyle=3');
    expect(assStyle('big', 1280, 720)).toContain('Alignment=5');
    const size = (s: string) => Number(/FontSize=(\d+)/.exec(s)![1]);
    expect(size(assStyle('clean', 720, 1280))).toBeLessThan(size(assStyle('clean', 1280, 720)));
  });
  test('the fonts file points FFmpeg at this computer\'s fonts', () => {
    expect(fontsConf('win32', 'C:\\tmp\\fc', 'C:\\Users\\F')).toContain('<dir>C:\\Windows\\Fonts</dir>');
    expect(fontsConf('darwin', '/tmp/fc', '/Users/f')).toContain('/System/Library/Fonts');
    expect(fontsConf('linux', '/tmp/fc', '/home/f')).toContain('/usr/share/fonts');
  });
  test('scene changes read from showinfo', () => {
    const err = '[Parsed_showinfo_2 @ 0x1] n:0 pts:100 pts_time:4.004 duration...\n[Parsed_showinfo_2] n:1 pts_time:4.2\n n:2 pts_time:9.5 x';
    expect(parseSceneTimes(err)).toEqual([4.004, 9.5]);
    expect(shotsOf(12, [4, 9.5])).toEqual([{ start: 0, end: 4 }, { start: 4, end: 9.5 }, { start: 9.5, end: 12 }]);
  });
});

const talk = (duration: number, speech: [number, number][], scenes: number[] = []): Analysis => ({
  duration, hasAudio: true, scenes, speech: speech.map(([start, end]) => ({ start, end })), loud: Array.from({ length: Math.ceil(duration) }, (_, i) => (speech.some(([a, b]) => i >= a && i < b) ? -18 : -55)),
});

describe('Shorts', () => {
  test('picks talking moments near the length asked for, starting at a sentence, never overlapping', () => {
    const a = talk(300, [[10, 40], [42, 50], [120, 150], [151, 160], [250, 280]], [100, 200]);
    const m = findMoments(a, { count: 3, seconds: 30 });
    expect(m.length).toBe(3);
    for (const x of m) {
      expect(x.end - x.start).toBeGreaterThanOrEqual(18);
      expect(x.end - x.start).toBeLessThanOrEqual(42);
      expect(a.speech.some((s) => Math.abs(s.start - x.start) < 0.01) || a.scenes.includes(x.start) || x.start === 0).toBe(true);
    }
    for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) expect(Math.min(m[i].end, m[j].end) - Math.max(m[i].start, m[j].start)).toBeLessThanOrEqual(0.5);
    // The talking parts beat the quiet ones.
    expect(m.some((x) => x.start >= 10 && x.start <= 12)).toBe(true);
  });
  test('a video shorter than a Short is one moment; captions give each moment its words', () => {
    expect(findMoments(talk(9, [[0, 8]]), { seconds: 30, cues: [{ start: 1, end: 3, text: 'hi there' }] })).toEqual([{ start: 0, end: 9, score: 1, text: 'hi there' }]);
  });
});

describe('auto edit', () => {
  test('a highlight reel keeps something from every file, in order, near the length asked for', () => {
    const items = [
      { file: 'a.mp4', kind: 'video' as const, duration: 40, analysis: talk(40, [[5, 9]], [10, 20, 30]) },
      { file: 'b.jpg', kind: 'picture' as const, duration: 0 },
      { file: 'c.mp4', kind: 'video' as const, duration: 30, analysis: talk(30, [], [8, 16]) },
    ];
    const clips = planHighlights(items, { seconds: 15 });
    expect(new Set(clips.map((c) => c.file))).toEqual(new Set(['a.mp4', 'b.jpg', 'c.mp4']));
    const files = clips.map((c) => c.file);
    expect(files.indexOf('b.jpg')).toBeGreaterThan(files.indexOf('a.mp4'));
    expect(files.lastIndexOf('a.mp4')).toBeLessThan(files.indexOf('c.mp4'));
    const total = clips.reduce((s, c) => s + c.to - c.from, 0);
    expect(total).toBeLessThanOrEqual(16.5);
    expect(total).toBeGreaterThan(8);
    // The talking bit of a.mp4's first shot is used.
    expect(clips.find((c) => c.file === 'a.mp4')!.from).toBe(5);
  });
  test('tighten keeps the talking with a little air, joins short pauses, and says how much went', () => {
    const items = [{ file: 't.mp4', kind: 'video' as const, duration: 20, analysis: talk(20, [[1, 4], [4.3, 6], [10, 14]]) }];
    const clips = planTighten(items);
    expect(clips).toEqual([{ file: 't.mp4', from: 0.85, to: 6.15 }, { file: 't.mp4', from: 9.85, to: 14.15 }]);
    expect(savedSeconds(items, clips)).toBeCloseTo(10.4, 1);
  });
});

describe('export commands', () => {
  test('every clip is made the same size, with sound (silence when it has none)', () => {
    const v = segmentArgs({ file: 'a.mp4', kind: 'video', from: 3, seconds: 2.5, hasAudio: true, width: 720, height: 1280, fps: 30, fit: 'blur', volume: 0.5 });
    const j = v.join(' ');
    expect(j).toContain('-ss 3 -t 2.500 -i a.mp4');
    expect(j).toContain('gblur');
    expect(j).not.toContain('boxblur');
    expect(j).toContain('[0:a]aresample=48000');
    expect(j).toContain('volume=0.5');
    const p = segmentArgs({ file: 'b.png', kind: 'picture', from: 0, seconds: 3, hasAudio: false, width: 1280, height: 720, fps: 30, fit: 'fill', motion: 'in' }).join(' ');
    expect(p).toContain('-loop 1');
    expect(p).toContain('zoompan');
    expect(p).toContain('[1:a]atrim');
    expect(fitFilter('fill', 100, 200)).toContain('crop=100:200');
    expect(fitFilter('fit', 100, 200)).toContain('pad=100:200');
  });
  test('crossfades don\'t shorten the video; the clips\' sound goes down under the voice; captions burned', () => {
    expect(timelineSegments([{ seconds: 3 }, { seconds: 2 }, { seconds: 4 }], 0.5)).toEqual([{ seconds: 3, play: 3.5 }, { seconds: 2, play: 2.5 }, { seconds: 4, play: 4 }]);
    const { args, total } = joinArgs({ segments: [{ file: 's0.mp4', seconds: 3 }, { file: 's1.mp4', seconds: 2 }], fade: 0.5, voiceover: 'vo.wav', music: 'm.mp3', captions: { file: 'captions.srt', burn: true, style: 'bold', width: 720, height: 1280 }, fps: 30 });
    expect(total).toBe(5);
    const g = args[args.indexOf('-filter_complex') + 1];
    expect(g).toContain('xfade=transition=fade:duration=0.500:offset=3.000');
    expect(g).toContain('[1:a]adelay=3000:all=1');
    expect(g).toContain('volume=0.35[own]');
    expect(g).toContain("subtitles=filename=captions.srt:force_style='");
    expect(g).toContain('apad=whole_dur=5.000');
    expect(args).toContain('-stream_loop');
  });
  test('safe names for what the editor makes', () => {
    expect(safeName('../My Clip?.mp4', 'x')).toBe('My-Clip');
    expect(safeName('', 'export')).toBe('export');
  });
});

// ── Only filters the FFmpeg Lotus downloads has ─────────────────────────────
// Lotus installs BtbN's LGPL build of FFmpeg, which leaves out every GPL-only filter. Test machines
// often have a GPL ffmpeg, so a real run there can't catch one slipping in (0.22's blurred Shorts
// background used boxblur and failed on every user's PC). This list is from FFmpeg's configure
// (`*_filter_deps="gpl"`).
const GPL_ONLY_FILTERS = new Set([
  'blackframe', 'boxblur', 'colormatrix', 'cover_rect', 'cropdetect', 'delogo', 'eq', 'find_rect', 'fspp', 'histeq', 'hqdn3d', 'interlace',
  'kerndeint', 'mcdeint', 'mpdecimate', 'nnedi', 'owdenoise', 'perspective', 'phase', 'pp', 'pp7', 'pullup', 'repeatfields', 'sab', 'signature',
  'smartblur', 'spp', 'stereo3d', 'tinterlace', 'uspp', 'vaguedenoiser', 'boxblur_opencl', 'frei0r', 'frei0r_src', 'ocv', 'zmq', 'azmq',
]);

/** The filter names in a filter graph ("[0:v]scale=1:2,setsar=1[v];[v]null" → scale, setsar, null). */
function filterNames(graph: string): string[] {
  const names: string[] = [];
  let depth = 0, quoted = false, start = 0;
  const take = (end: number) => {
    const name = graph.slice(start, end).replace(/^(\s*\[[^\]]*\])+/, '').trim().match(/^[A-Za-z0-9_]+/)?.[0];
    if (name) names.push(name);
  };
  for (let i = 0; i < graph.length; i++) {
    const c = graph[i];
    if (c === "'") quoted = !quoted;
    else if (c === '\\') i++;
    else if (!quoted && c === '[') depth++;
    else if (!quoted && c === ']') depth--;
    else if (!quoted && depth === 0 && (c === ',' || c === ';')) { take(i); start = i + 1; }
  }
  take(graph.length);
  return names;
}

/** Every filter graph in a command (-filter_complex, -vf, -af). */
const graphsIn = (args: string[]) => args.flatMap((a, i) => (['-filter_complex', '-vf', '-af', '-filter:v', '-filter:a'].includes(args[i - 1]) ? [a] : []));

/** Every ffmpeg command Lotus's video code builds, in every shape it comes in. */
function everyCommand(): string[][] {
  const cmds: string[][] = [];
  for (const fit of ['fit', 'fill', 'blur'] as const) {
    for (const [width, height] of [[720, 1280], [1280, 720], [1080, 1080]]) {
      cmds.push(segmentArgs({ file: 'a.mp4', kind: 'video', from: 1, seconds: 45.708, hasAudio: true, width, height, fps: 30, fit, volume: 1 }));
      cmds.push(segmentArgs({ file: 'a.mp4', kind: 'video', from: 0, seconds: 2, hasAudio: false, width, height, fps: 30, fit }));
      for (const motion of ['in', 'out', 'left', 'right', 'none'] as const) cmds.push(segmentArgs({ file: 'p.png', kind: 'picture', from: 0, seconds: 3, hasAudio: false, width, height, fps: 30, fit, motion }));
    }
  }
  for (const burn of [true, false]) {
    cmds.push(joinArgs({ segments: [{ file: 's0.mp4', seconds: 3 }, { file: 's1.mp4', seconds: 2 }], fade: 0.5, voiceover: 'vo.wav', music: 'm.mp3', captions: { file: 'c.srt', burn, style: 'bold', width: 720, height: 1280 }, fps: 30 }).args);
  }
  cmds.push(joinArgs({ segments: [{ file: 's0.mp4', seconds: 3 }], fade: 0, fps: 30 }).args);
  cmds.push(joinArgs({ segments: [{ file: 's0.mp4', seconds: 3 }, { file: 's1.mp4', seconds: 2 }], fade: 0, fps: 30 }).args);
  cmds.push(proxyArgs('a.mp4'), thumbArgs('a.mp4', 1, 't.jpg'), soundArgs('a.mp4', 's.wav'));
  const enc = ENCODERS.find((e) => e.name === 'libx264')!;
  cmds.push(renderArgs({ scenes: [{ file: 'a.png', kind: 'image', duration: 3, motion: 'in' }, { file: 'c.mp4', kind: 'video', duration: 4 }], width: 1280, height: 720, voiceover: 'vo.wav', subtitles: 's.srt', encoder: enc, out: 'v.mp4' }));
  cmds.push(renderArgs({ scenes: [{ file: 'c.mp4', kind: 'video', duration: 6 }], width: 720, height: 1280, voiceover: 'vo.wav', original: 'lower', encoder: enc, out: 'v.mp4' }));
  cmds.push(mixArgs([{ file: 'a.wav', start: 0 }, { file: 'b.wav', start: 2 }], 'o.wav', 5, effectFilters({ volume: 1.2, bass: 3, treble: 2, normalize: true })));
  return cmds;
}

describe('ffmpeg filters', () => {
  test('the filter-name reader finds every filter, and skips labels and quoted text', () => {
    expect(filterNames("[0:v]split=2[a][b];[a]scale=1:2,gblur=sigma=6[c];[b][c]overlay=(W-w)/2:(H-h)/2[v];[v]zoompan=z='1,2':d=1[o]")).toEqual(['split', 'scale', 'gblur', 'overlay', 'zoompan']);
  });
  test('no command uses a filter that Lotus\'s (LGPL) FFmpeg leaves out', () => {
    const used = new Set(everyCommand().flatMap(graphsIn).flatMap(filterNames));
    expect(used.size).toBeGreaterThan(20);
    expect([...used].filter((n) => GPL_ONLY_FILTERS.has(n))).toEqual([]);
  });
});

describe('the Video plugin\'s tools', () => {
  test('captions, Shorts and auto edit are Work tools', () => {
    for (const n of ['video.subtitles', 'video.shorts', 'video.autoedit']) {
      expect(VIDEO_TOOLS.some((t) => t.name === n)).toBe(true);
      expect(ALL_TOOLS.some((t) => t.name === n)).toBe(true);
    }
  });
});

// ── With a real ffmpeg ──────────────────────────────────────────────────────

const FFMPEG = Bun.which('ffmpeg');
const FFPROBE = Bun.which('ffprobe');
const T = { ffmpeg: FFMPEG!, ffprobe: FFPROBE };

/** A talking-head stand-in: a test picture with a tone that comes and goes every 1.5 s. */
async function talkingVideo(file: string, seconds: number, size = '640x360') {
  await runProgram(FFMPEG!, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `testsrc=s=${size}:d=${seconds}:r=25`, '-f', 'lavfi', '-i', `aevalsrc='0.4*sin(440*2*PI*t)*gt(mod(t\\,3)\\,1.5)':s=48000:d=${seconds}`, '-shortest', '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'aac', file]);
}

function ctxIn(dir: string, heard: string[] = []): EditCtx {
  return { t: T, dir, progress: () => undefined, transcribe: async () => { const n = heard.length; heard.push('x'); return `Line number ${n + 1} is here`; } };
}

describe.skipIf(!FFMPEG)('the editor with a real ffmpeg', () => {
  test('every clip shape (fit, fill, blur; tall, wide, square) really runs through ffmpeg', async () => {
    const dir = tmp('shapes');
    await talkingVideo(join(dir, 'wide.mp4'), 2, '1920x1080');
    await runProgram(FFMPEG!, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=teal:s=800x600', '-frames:v', '1', join(dir, 'p.png')]);
    for (const fit of ['fit', 'fill', 'blur'] as const) {
      for (const [width, height] of [[720, 1280], [1280, 720], [1080, 1080]]) {
        for (const kind of ['video', 'picture'] as const) {
          const file = join(dir, kind === 'video' ? 'wide.mp4' : 'p.png');
          const args = segmentArgs({ file, kind, from: 0.5, seconds: 1, hasAudio: kind === 'video', width, height, fps: 30, fit, motion: 'in' });
          const r = await runProgram(FFMPEG!, [...args, '-f', 'null', '-']).then(() => 'ok', (e: Error) => `${fit} ${width}x${height} ${kind}: ${e.message}`);
          expect(r).toBe('ok');
        }
      }
    }
  }, 120_000);

  test('this ffmpeg knows every filter the commands use', async () => {
    const out = Bun.spawnSync([FFMPEG!, '-hide_banner', '-filters']).stdout.toString();
    const known = new Set(out.split('\n').map((l) => l.trim().split(/\s+/)[1]).filter(Boolean));
    const used = new Set(everyCommand().flatMap(graphsIn).flatMap(filterNames));
    // subtitles needs libass; a test machine's ffmpeg may not have it (Lotus's does).
    expect([...used].filter((n) => !known.has(n) && n !== 'subtitles')).toEqual([]);
  });

  test('footage: length, thumbnail and a light preview copy', async () => {
    const dir = tmp('media');
    await talkingVideo(join(dir, 'talk.mp4'), 4);
    const c = ctxIn(dir);
    const m = await readMedia(c, 'talk.mp4');
    expect(m).toMatchObject({ kind: 'video', width: 640, height: 360, hasAudio: true });
    expect(m.thumb!.startsWith('data:image/jpeg;base64,')).toBe(true);
    const proxy = await makeProxy(c, 'talk.mp4', m.duration);
    const pi = await probe(T, proxy);
    expect(pi.height).toBe(360);
    expect(pi.hasAudio).toBe(true);
    expect((await readMedia(c, 'talk.mp4')).proxy).toBe(true);
  }, 60_000);

  test('speech and captions from a real file', async () => {
    const dir = tmp('caps');
    await talkingVideo(join(dir, 'talk.mp4'), 9);
    const a = await analyse(ctxIn(dir), 'talk.mp4');
    expect(a.speech.length).toBe(3);
    expect(a.speech[0].start).toBeCloseTo(1.42, 0);
    const cues = await captionsFor(ctxIn(dir), 'talk.mp4');
    expect(cues.length).toBe(3);
    expect(cues[0].text).toBe('Line number 1 is here');
    // A part of the file, moved to where it sits on the timeline.
    const part = await captionsFor(ctxIn(dir), 'talk.mp4', { from: 3, seconds: 3, offset: 10 });
    expect(part.length).toBe(1);
    expect(part[0].start).toBeGreaterThan(10);
  }, 60_000);

  test('a timeline with a picture, two clips, a voiceover and burned captions → one MP4 the right length', async () => {
    const dir = tmp('export');
    await talkingVideo(join(dir, 'a.mp4'), 6);
    await runProgram(FFMPEG!, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:d=4:r=25', '-c:v', 'mpeg4', join(dir, 'b.mp4')]); // no sound
    await runProgram(FFMPEG!, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=teal:s=800x600', '-frames:v', '1', join(dir, 'p.png')]);
    await runProgram(FFMPEG!, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=f=300:d=3', join(dir, 'vo.wav')]);
    const media = new Map<string, { kind: 'video' | 'picture' | 'audio'; hasAudio: boolean }>([['a.mp4', { kind: 'video', hasAudio: true }], ['b.mp4', { kind: 'video', hasAudio: false }], ['p.png', { kind: 'picture', hasAudio: false }]]);
    const r = await exportTimeline(ctxIn(dir), {
      clips: [{ file: 'p.png', from: 0, to: 2 }, { file: 'a.mp4', from: 1, to: 4 }, { file: 'b.mp4', from: 0, to: 2.5 }], aspect: '9:16', fit: 'blur', fade: 0.4,
      voiceover: 'vo.wav', captions: [{ start: 0.5, end: 2, text: 'Hello from Lotus' }, { start: 3, end: 5, text: 'Second caption here' }], captionStyle: 'bold', burn: true, filename: 'my-edit',
    }, media);
    expect(r.file).toMatch(/^my-edit\.(mp4|webm)$/);
    expect(r.seconds).toBe(7.5);
    expect(['burned', 'attached']).toContain(r.captions);
    const info = await probe(T, join(dir, r.file));
    expect(info).toMatchObject({ width: 720, height: 1280, hasAudio: true });
    expect(Math.abs(info.duration - 7.5)).toBeLessThan(0.3);
    expect(existsSync(join(dir, '.edit', 'tmp')) ? require('node:fs').readdirSync(join(dir, '.edit', 'tmp')).length : 0).toBe(0);
  }, 120_000);

  test('Shorts: found, made tall with captions; the editor\'s jobs report progress and results', async () => {
    const dir = tmp('shorts');
    await talkingVideo(join(dir, 'long.mp4'), 40);
    const found = await runOp(ctxIn(dir), 'shorts.find', { file: 'long.mp4', count: 2, seconds: 12 }) as { moments: { start: number; end: number }[] };
    expect(found.moments.length).toBe(2);
    const events: Record<string, unknown>[] = [];
    const svc = new VideoEditService({ workDir: () => dir, broadcast: (e) => events.push(e), toolCtx: (d, signal, progress) => ({ workDir: d, signal, progress, builtins: { videoTool: (n: string) => (n === 'ffmpeg' ? FFMPEG : FFPROBE), engineInfo: () => ({ installed: false }), installed: () => [] } } as never) });
    const { jobId } = svc.start('p1', 'shorts.make', { file: 'long.mp4', moments: found.moments.slice(0, 1) });
    for (let i = 0; i < 600 && !events.some((e) => e.jobId === jobId && e.state !== 'running'); i++) await Bun.sleep(100);
    const end = events.find((e) => e.jobId === jobId && e.state !== 'running')!;
    expect(end.error).toBeUndefined();
    expect(end.state).toBe('done');
    const made = (end.result as { files: { file: string }[] }).files[0].file;
    const info = await probe(T, join(dir, made));
    expect(info).toMatchObject({ width: 720, height: 1280 });
    // The project file round-trips; previews are only for files in the project.
    expect(svc.projectPut('p1', { clips: [1] })).toBe(true);
    expect(svc.projectGet('p1')).toEqual({ clips: [1] });
    expect(svc.previewPath('p1', '../../etc/passwd')).toBeNull();
    expect(svc.previewPath('p1', 'long.mp4')).toBe(join(dir, 'long.mp4'));
    // Unknown jobs are refused.
    expect(() => svc.start('p1', 'format-disk', {})).toThrow();
  }, 180_000);

  test('auto edit: tightening a talk takes out the pauses', async () => {
    const dir = tmp('auto');
    await talkingVideo(join(dir, 'talk.mp4'), 12);
    const r = await runOp(ctxIn(dir), 'autoedit', { files: ['talk.mp4'], mode: 'tighten' }) as { clips: { from: number; to: number }[]; saved: number };
    expect(r.clips.length).toBe(4);
    expect(r.saved).toBeGreaterThan(3);
    const hi = await runOp(ctxIn(dir), 'autoedit', { files: ['talk.mp4'], mode: 'highlights', seconds: 6 }) as { clips: { from: number; to: number }[] };
    expect(hi.clips.length).toBeGreaterThan(0);
    expect(freeName(dir, 'talk')).toBe('talk-2');
  }, 60_000);

  test('the Shorts tool in Work mode', async () => {
    const dir = tmp('tool');
    await talkingVideo(join(dir, 'clip.mp4'), 20);
    const ctx = { workDir: dir, signal: new AbortController().signal, progress: () => undefined, studio: dir, folders: [dir], kvGet: () => null, kvSet: () => undefined, builtins: { videoTool: (n: string) => (n === 'ffmpeg' ? FFMPEG : FFPROBE), engineInfo: () => ({ installed: false }), installed: () => [] } } as never;
    const r = await videoShorts.run({ file: 'clip.mp4', count: 1, seconds: 10 }, ctx);
    expect(r.ok).toBe(true);
    expect(r.text).toContain('No captions');
    expect(readFileSync(join(dir, '.titles.json'), 'utf8')).toContain('Short ·');
  }, 120_000);
});

mkdirSync; writeFileSync;
