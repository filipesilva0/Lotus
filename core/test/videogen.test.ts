// 0.21: AI video generation (src/models/videoModels.ts, Builtins.generateVideoClip, video.generate).
//   1. The size of Wan is picked from the graphics card and the computer's memory; no card → no AI video.
//   2. The clip plan: sizes, frame counts (4n+1), clips for a length, the out-of-memory ladder.
//   3. sd-cli's video arguments, using only switches the installed build lists.
//   4. The engine with a stand-in sd-cli: retries smaller when memory runs out, stops a silent run,
//      refuses with too little free RAM, reads old builds' PNG frames.
//   5. video.generate end to end with a real ffmpeg: clips joined into an MP4; plain fallbacks.

import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  aboutTime, clipFrames, clipSize, pickVideoModel, planVideo, sdcppHasVideo, sdcppVideoArgs, usableVram, VIDEO_FAMILIES, videoFamilyFor, videoFit, videoLadder, videoPrompt, videoStepTotals, wanFrames,
  type VideoFamily, type VideoFiles,
} from '../../src/models/videoModels';
import { LIBRARY, VIDEO_MODELS, fitOf, licenceUse, filesFor } from '../../src/models/library';
import { videoRequest } from '../../src/work/videoBrief';
import { Builtins } from '../src/engines/manager';
import { noVideoModel, videoGenerate, VIDEO_TOOLS } from '../src/tools/video';
import { probe } from '../src/video/run';
import { ALL_TOOLS } from '../src/agent/service';
import type { ToolCtx } from '../src/agent/types';

const dirs: string[] = [];
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), `lotus-vgen-${p}-`)); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const RTX4060 = { gpu: 'nvidia', vramGb: 8, unified: false, ramGb: 32 };
const RTX3060 = { gpu: 'nvidia', vramGb: 12, unified: false, ramGb: 32 };
const RTX4090 = { gpu: 'nvidia', vramGb: 24, unified: false, ramGb: 64 };
const NO_GPU = { gpu: 'none', vramGb: 0, unified: false, ramGb: 16 };

// ── 1. Which size ──────────────────────────────────────────────────────────

describe('picking the video model for the computer', () => {
  test('8 GB → Wan 2.1 1.3B, 12 GB → Wan 2.2 5B, 24 GB with 64 GB RAM → A14B', () => {
    expect(videoFamilyFor(RTX4060)).toBe('wan21-1.3b');
    expect(videoFamilyFor({ ...RTX4060, vramGb: 6 })).toBe('wan21-1.3b');
    expect(videoFamilyFor(RTX3060)).toBe('wan22-5b');
    expect(videoFamilyFor({ ...RTX3060, vramGb: 16 })).toBe('wan22-5b');
    expect(videoFamilyFor(RTX4090)).toBe('wan22-a14b');
  });

  test('too little RAM steps down a size; no card, or a 4 GB one, gets no AI video and a plain reason', () => {
    expect(videoFamilyFor({ ...RTX4090, ramGb: 32 })).toBe('wan22-5b');
    expect(videoFamilyFor({ ...RTX4060, ramGb: 8 })).toBeNull();
    expect(videoFamilyFor(NO_GPU)).toBeNull();
    expect(videoFamilyFor({ ...RTX4060, vramGb: 4 })).toBeNull();
    const why = videoFit('wan21-1.3b', NO_GPU);
    expect(why.ok).toBe(false);
    expect((why as { why: string }).why).toMatch(/graphics card/);
    expect((videoFit('wan21-1.3b', { ...RTX4060, ramGb: 8 }) as { why: string }).why).toMatch(/RAM/);
  });

  test('Macs count three quarters of their shared memory and need no separate RAM check', () => {
    expect(usableVram({ gpu: 'apple', vramGb: 16, unified: true, ramGb: 16 })).toBe(12);
    expect(videoFamilyFor({ gpu: 'apple', vramGb: 16, unified: true, ramGb: 16 })).toBe('wan22-5b');
    expect(videoFamilyFor({ gpu: 'apple', vramGb: 8, unified: true, ramGb: 8 })).toBe('wan21-1.3b');
  });

  test('of the installed models, the biggest that fits; one too big for the card is skipped', () => {
    const installed = [{ id: 'a', family: 'wan22-a14b' as VideoFamily }, { id: 's', family: 'wan21-1.3b' as VideoFamily }];
    expect(pickVideoModel(installed, RTX4090)?.id).toBe('a');
    expect(pickVideoModel(installed, RTX4060)?.id).toBe('s');
    expect(pickVideoModel([{ id: 'a', family: 'wan22-a14b' as VideoFamily }], RTX4060)).toBeNull();
    expect(pickVideoModel(installed, NO_GPU)).toBeNull();
  });

  test('the catalog has one Wan per size, all Apache-2.0, sharing one text encoder, and fit badges match', () => {
    expect(VIDEO_MODELS.map((e) => e.video!.family).sort()).toEqual(['wan21-1.3b', 'wan22-5b', 'wan22-a14b']);
    for (const e of VIDEO_MODELS) {
      expect(e.kind).toBe('video');
      expect(licenceUse(e.licence)).toBe('open');
      expect(LIBRARY).toContain(e);
      // Each file the setup names is one the download fetches.
      const names = e.builtin!.files!.map((f) => f.path.split('/').pop());
      for (const f of Object.values(e.video!.files)) expect(names).toContain(f);
      for (const f of e.builtin!.files!) expect(f.url).toMatch(/^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/main\//);
      expect(Math.abs(e.builtin!.files!.reduce((s, f) => s + f.gb, 0) - e.diskGb)).toBeLessThan(0.2);
    }
    expect(filesFor(VIDEO_MODELS).filter((f) => /umt5/.test(f.path))).toHaveLength(1);
    expect(fitOf(VIDEO_MODELS.find((e) => e.video!.family === 'wan21-1.3b')!, 8)).toBe('fits');
    expect(fitOf(VIDEO_MODELS.find((e) => e.video!.family === 'wan22-a14b')!, 8)).toBe('too-big');
  });
});

// ── 2. The plan ────────────────────────────────────────────────────────────

describe('planning the clips', () => {
  test('sizes follow the shape, in multiples the model needs', () => {
    expect(clipSize('wan21-1.3b', '16:9', 8)).toEqual({ width: 832, height: 464 });
    expect(clipSize('wan21-1.3b', '9:16', 8)).toEqual({ width: 464, height: 832 });
    expect(clipSize('wan22-5b', '16:9', 12)).toEqual({ width: 960, height: 512 });
    expect(clipSize('wan22-5b', '16:9', 24)).toEqual({ width: 1280, height: 704 });
    for (const f of Object.keys(VIDEO_FAMILIES) as VideoFamily[]) for (const sh of ['16:9', '9:16', '1:1']) {
      const s = clipSize(f, sh, 24);
      expect(s.width % VIDEO_FAMILIES[f].align).toBe(0);
      expect(s.height % VIDEO_FAMILIES[f].align).toBe(0);
    }
  });

  test('frame counts are 4n+1: 2 s clips on 8 GB, longer on bigger cards', () => {
    expect([1, 5, 16, 33, 34, 80].map(wanFrames)).toEqual([5, 5, 17, 33, 33, 81]);
    expect(clipFrames('wan21-1.3b', 8)).toBe(33);
    expect(clipFrames('wan22-5b', 12)).toBe(49);
    expect(clipFrames('wan22-5b', 24)).toBe(97);
  });

  test('30 seconds on an 8 GB card: 15 two-second clips, weights in RAM, about an hour and a half', () => {
    const p = planVideo('wan21-1.3b', RTX4060, { seconds: 30 });
    expect(p).toMatchObject({ width: 832, height: 464, frames: 33, clips: 15, fps: 16, seconds: 30, lowVram: true });
    expect(aboutTime(p.minutes)).toBe('about 1.5 hours');
    expect(planVideo('wan22-a14b', RTX4090, { seconds: 3 }).lowVram).toBe(false);
    // Lengths are kept sensible.
    expect(planVideo('wan21-1.3b', RTX4060, { seconds: 5000 }).clips).toBe(30);
    expect(planVideo('wan21-1.3b', RTX4060).clips).toBe(1);
  });

  test('out of memory: more spare memory first, then half the frames, then a smaller picture', () => {
    const l = videoLadder('wan21-1.3b', { width: 832, height: 464, frames: 33 });
    expect(l.map((x) => [x.width, x.height, x.frames, x.reserveGb, x.temporal])).toEqual([
      [832, 464, 33, 2, false], [832, 464, 33, 3, true], [832, 464, 17, 3, true], [624, 352, 17, 3, true],
    ]);
  });

  test('a plain request becomes a prompt with motion and quality words, without doubling a camera move', () => {
    expect(videoPrompt('a cat on a sofa.')).toBe('a cat on a sofa, smooth natural motion, steady camera, high quality, detailed, cinematic lighting');
    expect(videoPrompt('a cat, camera slowly pans left', 'warm light')).toBe('a cat, camera slowly pans left, warm light, high quality, detailed, cinematic lighting');
  });
});

// ── 3. sd-cli arguments ────────────────────────────────────────────────────

const HELP = '-M, --mode [img_gen, vid_gen]\n--video-frames\n--max-vram\n--auto-fit\n--temporal-tiling\n--diffusion-fa\n';
const FILES: VideoFiles = { model: 'wan.safetensors', vae: 'wan_vae.safetensors', t5xxl: 'umt5.gguf' };
const P = (folder: string, file: string) => `/m/${folder}/${file}`;
const flag = (args: string[], f: string) => args[args.indexOf(f) + 1];

describe('sd-cli video arguments', () => {
  test('Wan 2.1 1.3B on an 8 GB card: video mode, its files, 2 GiB spare, tiles, the size and frames', () => {
    const at = videoLadder('wan21-1.3b', { width: 832, height: 464, frames: 33 })[0];
    const a = sdcppVideoArgs('wan21-1.3b', FILES, at, { prompt: 'a cat', seed: 7, output: '/o/clip.avi', lowVram: true, help: HELP }, P);
    expect(a.slice(0, 2)).toEqual(['-M', 'vid_gen']);
    expect(flag(a, '--diffusion-model')).toBe('/m/diffusion_models/wan.safetensors');
    expect(flag(a, '--vae')).toBe('/m/vae/wan_vae.safetensors');
    expect(flag(a, '--t5xxl')).toBe('/m/text_encoders/umt5.gguf');
    expect([flag(a, '-W'), flag(a, '-H'), flag(a, '--video-frames'), flag(a, '-s'), flag(a, '--flow-shift'), flag(a, '--cfg-scale')]).toEqual(['832', '464', '33', '7', '3', '6']);
    expect(flag(a, '--max-vram')).toBe('-2');
    expect(a).toContain('--vae-tiling');
    expect(a).not.toContain('--offload-to-cpu');
    expect(a).not.toContain('--temporal-tiling');
    expect(a).not.toContain('-i');
    expect(flag(a, '-n')).toMatch(/blurry/);
    expect(a[a.length - 1]).toBe('/o/clip.avi');
  });

  test('older builds: --offload-to-cpu instead of --max-vram, and no switches they do not list', () => {
    const at = videoLadder('wan21-1.3b', { width: 832, height: 464, frames: 33 })[1];
    const a = sdcppVideoArgs('wan21-1.3b', FILES, at, { prompt: 'x', seed: 1, output: 'o.avi', lowVram: true, help: '--video-frames\n--offload-to-cpu\n' }, P);
    expect(a).toContain('--offload-to-cpu');
    expect(a).not.toContain('--max-vram');
    expect(a).not.toContain('--temporal-tiling');
    expect(a).not.toContain('--diffusion-fa');
    expect(sdcppHasVideo('--offload-to-cpu\n')).toBe(false);
    expect(sdcppHasVideo(HELP)).toBe(true);
  });

  test('A14B passes both experts with their own steps; a start picture only reaches models that can use it', () => {
    const at = { width: 832, height: 464, frames: 49, reserveGb: 3, temporal: true };
    const a = sdcppVideoArgs('wan22-a14b', { ...FILES, high: 'high.gguf' }, at, { prompt: 'x', seed: 1, init: '/p.png', output: 'o.avi', lowVram: false, help: HELP }, P);
    expect(flag(a, '--high-noise-diffusion-model')).toBe('/m/diffusion_models/high.gguf');
    expect([flag(a, '--steps'), flag(a, '--high-noise-steps'), flag(a, '--cfg-scale')]).toEqual(['10', '8', '3.5']);
    expect(a).not.toContain('-i');
    expect(a).not.toContain('--max-vram');
    expect(a).toContain('--temporal-tiling');
    const b = sdcppVideoArgs('wan22-5b', FILES, at, { prompt: 'x', seed: 1, init: '/p.png', output: 'o.avi', lowVram: true, help: HELP }, P);
    expect(flag(b, '-i')).toBe('/p.png');
    expect(flag(b, '--max-vram')).toBe('-3');
    expect(videoStepTotals('wan22-a14b')).toEqual([8, 10, 18]);
  });
});

// ── 4. The engine with a stand-in sd-cli ──────────────────────────────────

const FAKES = resolve(import.meta.dir, 'fake-engines');
const FFMPEG = Bun.which('ffmpeg');
const FFPROBE = Bun.which('ffprobe');

function engine(env: Record<string, string> = {}, o: { freeRamGb?: number; machine?: typeof RTX4060 } = {}) {
  const studio = tmp('studio');
  const argsLog = join(studio, 'sd.args');
  const bin = join(studio, 'Engines', 'stable-diffusion.cpp', 'master-1');
  mkdirSync(bin, { recursive: true });
  const exe = join(bin, 'sd-cli');
  const vars = Object.entries({ FAKE_LOG: argsLog, FAKE_FFMPEG: FFMPEG ?? 'ffmpeg', ...env }).map(([k, v]) => `${k}="${v}" `).join('');
  writeFileSync(exe, `#!/bin/sh\n${vars}exec "${process.execPath}" "${join(FAKES, 'fake-sd-video.ts')}" "$@"\n`);
  chmodSync(exe, 0o755);
  writeFileSync(join(studio, 'Engines', 'builtin.json'), JSON.stringify({ sd: { tag: 'master-1', flavour: 'cuda', dir: bin, exes: { 'sd-cli': exe }, installedAt: 1 } }));
  const e = VIDEO_MODELS.find((x) => x.video!.family === 'wan21-1.3b')!;
  for (const f of e.builtin!.files!) { mkdirSync(join(studio, 'Models', f.path, '..'), { recursive: true }); writeFileSync(join(studio, 'Models', f.path), 'x'.repeat(1000)); }
  writeFileSync(join(studio, 'Models', 'models.json'), JSON.stringify({ version: 1, installed: { [e.id]: { id: e.id, kind: 'video', title: e.title, files: e.builtin!.files!.map((f) => f.path), entryId: e.id, bytes: 1, at: 1 } } }));
  const kv: Record<string, string> = {};
  const m = o.machine ?? RTX4060;
  const b = new Builtins({ studio, broadcast: () => undefined, kvGet: (k) => kv[k] ?? null, kvSet: (k, v) => { kv[k] = v; }, machine: async () => ({ os: 'linux', arch: 'x64', gpuName: 'RTX', ...m }) as never, freeRamGb: () => o.freeRamGb ?? 24, systemTool: (n) => (n === 'ffmpeg' ? FFMPEG : FFPROBE) });
  const calls = () => (existsSync(argsLog) ? readFileSync(argsLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as string[]) : []);
  return { b, studio, calls };
}

describe.skipIf(process.platform === 'win32' || !FFMPEG)('the video engine with a stand-in sd-cli', () => {
  test('lists the installed video model and makes a clip; out of memory → retried smaller, never a crash', async () => {
    // This "card" fits 832×464 at 17 frames but not 33.
    const { b, calls } = engine({ FAKE_BUDGET: String(832 * 464 * 20) });
    const [model] = b.videoModels();
    expect(model).toMatchObject({ id: 'wan21-t2v-1.3b', family: 'wan21-1.3b' });
    const steps: string[] = [], retries: string[] = [];
    const ladder = videoLadder('wan21-1.3b', { width: 832, height: 464, frames: 33 });
    const r = await b.generateVideoClip(model, ladder, { prompt: 'a cat', seed: 3, lowVram: true }, { onProgress: (s, t) => steps.push(`${s}/${t}`), onRetry: (why, n) => retries.push(`${why} ${n.frames}`) });
    expect(r.attempt).toBe(ladder[2]);
    expect(r.files[0]).toMatch(/clip\.avi$/);
    expect(existsSync(r.files[0])).toBe(true);
    expect(retries).toEqual(['ran out of graphics memory 33', 'ran out of graphics memory 17']);
    expect(steps).toContain('30/30');
    expect(calls().map((a) => a[a.indexOf('--video-frames') + 1])).toEqual(['33', '33', '17']);
    expect(calls()[1]).toContain('--temporal-tiling');
    expect(b.imageEngineBusy()).toBe(false);
    b.cleanOutputs(r.files);
  }, 30_000);

  test('when even the smallest try runs out, a plain sentence, and the engine is free again', async () => {
    const { b } = engine({ FAKE_BUDGET: '1000' });
    const [model] = b.videoModels();
    await expect(b.generateVideoClip(model, videoLadder('wan21-1.3b', { width: 832, height: 464, frames: 33 }), { prompt: 'x', seed: 1, lowVram: true })).rejects.toThrow(/ran out of memory making this clip.*already tried smaller settings/);
    expect(b.imageEngineBusy()).toBe(false);
  }, 30_000);

  test('a run that goes silent is stopped; too little free RAM is refused before starting; old builds are told to update', async () => {
    const hang = engine({ FAKE_HANG: '1' });
    const [m1] = hang.b.videoModels();
    await expect(hang.b.generateVideoClip(m1, videoLadder('wan21-1.3b', { width: 832, height: 464, frames: 33 }), { prompt: 'x', seed: 1, lowVram: true }, { watchdogMs: 1500 })).rejects.toThrow(/stopped answering/);
    expect(hang.b.imageEngineBusy()).toBe(false);

    const low = engine({}, { freeRamGb: 0.000001 });
    const [m2] = low.b.videoModels();
    await expect(low.b.generateVideoClip(m2, videoLadder('wan21-1.3b', { width: 832, height: 464, frames: 33 }), { prompt: 'x', seed: 1, lowVram: true })).rejects.toThrow(/free computer memory/);
    expect(low.calls()).toHaveLength(0);

    const old = engine({ FAKE_OLD: '1' });
    const [m3] = old.b.videoModels();
    await expect(old.b.generateVideoClip(m3, videoLadder('wan21-1.3b', { width: 832, height: 464, frames: 33 }), { prompt: 'x', seed: 1, lowVram: true })).rejects.toThrow(/too old to make video/);
  }, 30_000);

  test('stop works mid-clip', async () => {
    const { b } = engine({ FAKE_HANG: '1' });
    const [model] = b.videoModels();
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 500);
    await expect(b.generateVideoClip(model, videoLadder('wan21-1.3b', { width: 832, height: 464, frames: 33 }), { prompt: 'x', seed: 1, lowVram: true }, { signal: ctrl.signal })).rejects.toThrow(/Stopped/);
    expect(b.imageEngineBusy()).toBe(false);
  }, 30_000);
});

// ── 5. video.generate ──────────────────────────────────────────────────────

function ctxFor(b: unknown): ToolCtx & { workDir: string; notes: string[] } {
  const studio = tmp('work');
  const workDir = join(studio, 'Work', 'w1');
  mkdirSync(workDir, { recursive: true });
  const notes: string[] = [];
  const kv = new Map<string, string>();
  return { db: null as never, studio, workDir, folders: [studio], signal: new AbortController().signal, memoryOn: false, fetch, progress: (d) => void notes.push(d),
    kvSet: (k, v) => void kv.set(k, v), kvGet: (k) => kv.get(k) ?? null, builtins: b as never, notes };
}

describe.skipIf(process.platform === 'win32' || !FFMPEG)('video.generate', () => {
  test('is a Work tool', () => {
    expect(VIDEO_TOOLS).toContain(videoGenerate);
    expect(ALL_TOOLS).toContain(videoGenerate);
  });

  test('three shots on an 8 GB card → one MP4 of about 6 s, with progress and how long it took', async () => {
    const { b } = engine();
    const ctx = ctxFor(b);
    const r = await videoGenerate.run({ shots: ['a runner ties her shoes on a bridge', 'she starts running', 'the city at sunrise'], style: 'warm light', aspect: '16:9', filename: 'run.mp4' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/Saved run\.mp4: 6\.\d s of new AI footage \(3 clips, 832×464, no sound\) made with Wan 2\.1 1\.3B/);
    const info = await probe({ ffmpeg: FFMPEG!, ffprobe: FFPROBE }, join(ctx.workDir, 'run.mp4'));
    expect(info.hasVideo).toBe(true);
    expect(info.width).toBe(832);
    expect(info.duration).toBeGreaterThan(5.5);
    expect(ctx.notes.some((n) => /Filming clip 2 of 3 · step \d+ of 30/.test(n))).toBe(true);
  }, 60_000);

  test('an older sd-cli that writes PNG frames still gives an MP4', async () => {
    const { b } = engine({ FAKE_PNG: '1' });
    const ctx = ctxFor(b);
    const r = await videoGenerate.run({ shots: ['waves on a beach'] }, ctx);
    expect(r.ok).toBe(true);
    expect(existsSync(join(ctx.workDir, 'ai-footage.mp4'))).toBe(true);
  }, 60_000);

  test('no graphics card, no model, a model too big, or a failed run: the tool says why and to use pictures', async () => {
    const none = await videoGenerate.run({ shots: ['x'] }, ctxFor(engine({}, { machine: NO_GPU }).b));
    expect(none.ok).toBe(false);
    expect(none.text).toMatch(/needs a graphics card.*Fall back to pictures/);

    const empty = engine();
    rmSync(join(empty.studio, 'Models', 'models.json'));
    const none2 = await videoGenerate.run({ shots: ['x'] }, ctxFor(new Builtins({ studio: empty.studio, broadcast: () => undefined, kvGet: () => null, kvSet: () => undefined, machine: async () => ({ os: 'linux', arch: 'x64', gpuName: 'RTX', ...RTX4060 }) as never, systemTool: (n) => (n === 'ffmpeg' ? FFMPEG : FFPROBE) })));
    expect(none2.text).toMatch(/No AI video model is downloaded yet\. The one for this computer is Wan 2\.1 1\.3B \(video\) \(7\.2 GB download\)/);

    expect(noVideoModel([{ family: 'wan22-a14b', title: 'Wan 2.2 A14B (video)' }], RTX4060)).toMatch(/^Wan 2\.2 A14B \(video\) is too big for this computer\. The one for this computer is Wan 2\.1 1\.3B/);

    const fail = await videoGenerate.run({ shots: ['x'] }, ctxFor(engine({ FAKE_BUDGET: '10' }).b));
    expect(fail.ok).toBe(false);
    expect(fail.text).toMatch(/already tried smaller settings.*Fall back to pictures/);
  }, 60_000);

  test('a picture reaches only models that can start from one; the 1.3B says so', async () => {
    const { b, calls } = engine();
    const ctx = ctxFor(b);
    writeFileSync(join(ctx.workDir, 'me.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
    const r = await videoGenerate.run({ shots: ['me waving'], picture: 'me.png' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/can't start from a picture/);
    expect(calls()[0]).not.toContain('-i');
  }, 60_000);
});

// ── The Video page's request ───────────────────────────────────────────────

describe('the Video page asks for AI footage in words', () => {
  test('"Filmed by AI" asks for one video.generate per line, says it is slow, and keeps the picture fallback', () => {
    const t = videoRequest({ mode: 'idea', files: [], brief: 'stretches for back pain', shape: '9:16', seconds: 30, footage: 'ai' });
    expect(t).toMatch(/new footage filmed by AI/);
    expect(t).toMatch(/video\.generate once with one shot/);
    expect(t).toMatch(/aspect "9:16" and filename shot1\.mp4/);
    expect(t).toMatch(/tell me before you start how long it will take/);
    expect(t).toMatch(/use pictures with slow moves instead/);
    expect(t).toMatch(/video\.make with the shot files in order as the scenes/);
    expect(t).not.toMatch(/image\.generate/);
    const p = videoRequest({ mode: 'pictures', files: ['a.png'], brief: '', shape: '16:9', seconds: 15, footage: 'ai' });
    expect(p).toMatch(/picture set to that picture/);
    // Without the choice, nothing changes from before.
    expect(videoRequest({ mode: 'idea', files: [], brief: 'x', shape: '16:9', seconds: 30 })).toMatch(/image\.generate/);
  });
});
