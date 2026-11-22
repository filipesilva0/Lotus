// Session 17: built-in engines (picking release files, downloading, unpacking, running llama-server,
// sd-cli and sherpa-onnx), one model catalog, image setups (a model tied to its own VAE and text
// encoders) and the agent's native tool calls through llama-server. GitHub and Hugging Face are faked;
// the engines are small scripts that behave like the real programs (tests/fake-engines).

import { listTasks } from '../src/board';
import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { zipSync } from 'fflate';
import { openDb } from '../src/db';
import { kvApply, kvGet } from '../src/kv';
import { pickAssets, pickRelease, parseReleases, type Asset, type Platform } from '../src/engines/assets';
import { safeJoin, unzip } from '../src/engines/files';
import { argForAnsi, Builtins, parseSherpaText } from '../src/engines/manager';
import { parseNvidiaList, parseWinControllers } from '../src/engines/machine';
import { toOpenAi } from '../src/agent/llm';
import { startServer } from '../src/server';
import { parseCustomSource, pickGguf, suggest, fitOf, LIBRARY, entryById, downloadGb, profileForEntry } from '../../src/models/library';
import { comfyWiring, guessFamily, missingFor, sdcppArgs, sdcppProgress, settingsFor, suggestFile, type ImageProfile } from '../../src/models/imageProfiles';
import { graphTxt2Img } from '../../src/services/comfyGraph';
import { moveLegacyData } from '../src/legacyData';
import { linkComfy, mergeSection } from '../src/engines/comfyLink';

const dirs: string[] = [];
const tmp = (tag: string) => { const d = mkdtempSync(join(tmpdir(), `lotus-s17-${tag}-`)); dirs.push(d); return d; };
const stops: (() => void)[] = [];
afterAll(() => { stops.forEach((s) => s()); dirs.forEach((d) => { try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows */ } }); });

// Names copied from the real releases pages (16 Nov 2026).
const LLAMA = ['cudart-llama-b11669-bin-ubuntu-cuda-12.8-x64.tar.gz', 'cudart-llama-bin-win-cuda-12.4-x64.zip', 'cudart-llama-bin-win-cuda-13.4-x64.zip', 'llama-b11669-bin-macos-arm64.tar.gz', 'llama-b11669-bin-macos-x64.tar.gz', 'llama-b11669-bin-ubuntu-arm64.tar.gz', 'llama-b11669-bin-ubuntu-cuda-12.8-x64.tar.gz', 'llama-b11669-bin-ubuntu-vulkan-x64.tar.gz', 'llama-b11669-bin-ubuntu-x64.tar.gz', 'llama-b11669-bin-win-cpu-arm64.zip', 'llama-b11669-bin-win-cpu-x64.zip', 'llama-b11669-bin-win-cuda-12.4-x64.zip', 'llama-b11669-bin-win-cuda-13.4-x64.zip', 'llama-b11669-bin-win-vulkan-x64.zip', 'llama-b11669-ui.tar.gz', 'llama-b11669-xcframework.zip'];
const SD = ['cudart-sd-bin-win-cu12-x64.zip', 'sd-master-fd21ecf-bin-Darwin-macOS-26.6.2-arm64.zip', 'sd-master-fd21ecf-bin-Linux-Ubuntu-24.04-x86_64-rocm-10.1.0.zip', 'sd-master-fd21ecf-bin-Linux-Ubuntu-24.04-x86_64-vulkan.zip', 'sd-master-fd21ecf-bin-Linux-Ubuntu-24.04-x86_64.zip', 'sd-master-fd21ecf-bin-win-cpu-x64.zip', 'sd-master-fd21ecf-bin-win-cuda12-x64.zip', 'sd-master-fd21ecf-bin-win-rocm-10.1.0-x64.zip', 'sd-master-fd21ecf-bin-win-vulkan-x64.zip'];
const SHERPA = ['sherpa-onnx-v1.13.7-win-x64-static-MT-Release-lib.tar.bz2', 'sherpa-onnx-v1.13.7-win-x64-static-MT-Release-no-tts.tar.bz2', 'sherpa-onnx-v1.13.7-win-x64-static-MT-Release.tar.bz2', 'sherpa-onnx-v1.13.7-win-x64-shared-MT-Release.tar.bz2', 'sherpa-onnx-v1.13.7-osx-universal2-static.tar.bz2', 'sherpa-onnx-v1.13.7-osx-universal2-static-lib.tar.bz2', 'sherpa-onnx-v1.13.7-linux-x64-static.tar.bz2', 'sherpa-onnx-v1.13.7-linux-x64-static-no-tts.tar.bz2', 'sherpa-onnx-v1.13.7-linux-aarch64-static.tar.bz2'];
const assets = (names: string[]): Asset[] => names.map((name) => ({ name, url: `https://github.com/x/${name}`, size: 1 }));
const P = (os: Platform['os'], gpu: Platform['gpu'], arch: Platform['arch'] = 'x64'): Platform => ({ os, arch, gpu });

describe('picking engine builds', () => {
  test('llama.cpp: CUDA 12 + its runtime on Windows NVIDIA, Vulkan on AMD, CPU otherwise; Metal on Macs; Linux builds', () => {
    const w = pickAssets('llama', assets(LLAMA), P('windows', 'nvidia'))!;
    expect(w.main.name).toBe('llama-b11669-bin-win-cuda-12.4-x64.zip');
    expect(w.extra.map((a) => a.name)).toEqual(['cudart-llama-bin-win-cuda-12.4-x64.zip']);
    expect(pickAssets('llama', assets(LLAMA), P('windows', 'amd'))!.main.name).toBe('llama-b11669-bin-win-vulkan-x64.zip');
    expect(pickAssets('llama', assets(LLAMA), P('windows', 'none'))!.main.name).toBe('llama-b11669-bin-win-cpu-x64.zip');
    expect(pickAssets('llama', assets(LLAMA), P('macos', 'apple', 'arm64'))!.main.name).toBe('llama-b11669-bin-macos-arm64.tar.gz');
    expect(pickAssets('llama', assets(LLAMA), P('linux', 'nvidia'))!.extra[0].name).toBe('cudart-llama-b11669-bin-ubuntu-cuda-12.8-x64.tar.gz');
    expect(pickAssets('llama', assets(LLAMA), P('linux', 'intel'))!.main.name).toBe('llama-b11669-bin-ubuntu-vulkan-x64.tar.gz');
    expect(pickAssets('llama', assets(LLAMA), P('linux', 'none', 'arm64'))!.main.name).toBe('llama-b11669-bin-ubuntu-arm64.tar.gz');
    // A CUDA build is never picked without its runtime libraries.
    expect(pickAssets('llama', assets(LLAMA.filter((n) => !n.startsWith('cudart-llama-bin-win'))), P('windows', 'nvidia'))!.main.name).toBe('llama-b11669-bin-win-vulkan-x64.zip');
  });

  test('stable-diffusion.cpp and sherpa-onnx', () => {
    const w = pickAssets('sd', assets(SD), P('windows', 'nvidia'))!;
    expect([w.main.name, w.extra[0]?.name]).toEqual(['sd-master-fd21ecf-bin-win-cuda12-x64.zip', 'cudart-sd-bin-win-cu12-x64.zip']);
    expect(pickAssets('sd', assets(SD), P('windows', 'amd'))!.main.name).toBe('sd-master-fd21ecf-bin-win-rocm-10.1.0-x64.zip');
    expect(pickAssets('sd', assets(SD), P('macos', 'apple', 'arm64'))!.main.name).toBe('sd-master-fd21ecf-bin-Darwin-macOS-26.6.2-arm64.zip');
    expect(pickAssets('sd', assets(SD), P('macos', 'none', 'x64'))).toBeNull();
    expect(pickAssets('sd', assets(SD), P('linux', 'nvidia'))!.main.name).toBe('sd-master-fd21ecf-bin-Linux-Ubuntu-24.04-x86_64-vulkan.zip');
    expect(pickAssets('sd', assets(SD), P('linux', 'none'))!.main.name).toBe('sd-master-fd21ecf-bin-Linux-Ubuntu-24.04-x86_64.zip');
    expect(pickAssets('sherpa', assets(SHERPA), P('windows', 'nvidia'))!.main.name).toBe('sherpa-onnx-v1.13.7-win-x64-static-MT-Release.tar.bz2');
    expect(pickAssets('sherpa', assets(SHERPA), P('macos', 'apple', 'arm64'))!.main.name).toBe('sherpa-onnx-v1.13.7-osx-universal2-static.tar.bz2');
    expect(pickAssets('sherpa', assets(SHERPA), P('linux', 'none'))!.main.name).toBe('sherpa-onnx-v1.13.7-linux-x64-static.tar.bz2');
  });

  test('skips releases without binaries (llama.cpp\'s "latest" can be one)', () => {
    const rel = parseReleases([{ tag_name: 'v0.7.0', assets: [{ name: 'gguf-0.7.0.tar.gz', browser_download_url: 'https://x/a', size: 3 }] }, { tag_name: 'b11669', assets: assets(LLAMA).map((a) => ({ name: a.name, browser_download_url: a.url, size: 5 })) }, { tag_name: 'draft', draft: true, assets: [] }]);
    expect(rel.length).toBe(2);
    expect(pickRelease('llama', rel, P('windows', 'none'))!.release.tag).toBe('b11669');
  });

  test('GPU readers', () => {
    expect(parseNvidiaList('NVIDIA GeForce RTX 4060, 8188\n')).toEqual({ name: 'NVIDIA GeForce RTX 4060', vramGb: 8 });
    expect(parseWinControllers('[{"Name":"Microsoft Basic Display Adapter","AdapterRAM":0},{"Name":"AMD Radeon RX 7800 XT","AdapterRAM":4293918720}]')).toMatchObject({ gpu: 'amd', name: 'AMD Radeon RX 7800 XT' });
  });

  test('unpacking refuses paths outside the folder', async () => {
    const d = tmp('zip');
    expect(safeJoin(d, '../evil')).toBeNull();
    expect(safeJoin(d, 'C:/Windows/x')).toBeNull();
    expect(safeJoin(d, 'a/b.txt')).toBe(join(d, 'a', 'b.txt'));
    writeFileSync(join(d, 'ok.zip'), zipSync({ 'bin/hello.txt': new TextEncoder().encode('hi') }));
    expect(await unzip(join(d, 'ok.zip'), join(d, 'out'))).toBe(1);
    expect(readFileSync(join(d, 'out', 'bin', 'hello.txt'), 'utf8')).toBe('hi');
  });
});

describe('one catalog', () => {
  test('every entry can be installed somewhere, ids are unique, and the guide suggests what fits', () => {
    expect(new Set(LIBRARY.map((e) => e.id)).size).toBe(LIBRARY.length);
    for (const e of LIBRARY) expect(!!(e.builtin || e.ollama || e.voicebox)).toBe(true);
    // An RTX 4060 (8 GB) gets an 8B tool-capable chat model and SDXL.
    expect(suggest('chat', 8)?.id).toBe('qwen3-8b');
    expect(suggest('image', 8)?.id).toBe('z-image-turbo-q4'); // T71: the small Z-Image beats SDXL and fits better
    expect(suggest('image', 4)?.id).toBe('sd15');
    expect(suggest('chat', 24)?.id).toBe('qwen3.8-27b');
    expect(suggest('voice', 0)?.id).toBe('kokoro');
    expect(fitOf({ vramGb: 0 }, undefined)).toBe('fits');
    expect(fitOf({ vramGb: 20 }, 8)).toBe('too-big');
    // Shared files (the Qwen3 4B text encoder) are counted once.
    expect(downloadGb([entryById('flux2-klein-4b')!, entryById('z-image-turbo')!])).toBeLessThan(16 + 21);
  });

  test('custom models: Hugging Face repos and links', () => {
    expect(parseCustomSource('unsloth/Qwen3-8B-GGUF')).toEqual({ type: 'hf-gguf', repo: 'unsloth/Qwen3-8B-GGUF', quant: 'Q4_K_M' });
    expect(parseCustomSource('https://huggingface.co/bartowski/x-GGUF:q5_k_m')).toEqual({ type: 'hf-gguf', repo: 'bartowski/x-GGUF', quant: 'Q5_K_M' });
    expect(parseCustomSource('https://huggingface.co/a/b/blob/main/vae/ae.safetensors')).toEqual({ type: 'file', url: 'https://huggingface.co/a/b/resolve/main/vae/ae.safetensors', fileName: 'ae.safetensors' });
    expect(parseCustomSource('http://example.com/x.gguf')).toBeNull();
    expect(parseCustomSource('https://example.com/run.exe')).toBeNull();
    const files = [{ path: 'Qwen3.5-4B-Q4_K_M.gguf', size: 2 }, { path: 'Qwen3.5-4B-UD-Q4_K_XL.gguf' }, { path: 'mmproj-F16.gguf', size: 1 }, { path: 'mmproj-BF16.gguf' }];
    expect(pickGguf(files, 'Q4_K_M', 'F16')).toEqual({ model: files[0], mmproj: files[2] });
    expect(pickGguf(files, 'Q8_0').model).toBeUndefined();
  });
});

describe('image setups', () => {
  const flux1: ImageProfile = { id: 'p1', name: 'My FLUX', family: 'flux1', files: { model: 'flux1-dev-fp8.safetensors', clip_l: 'clip_l.safetensors', t5xxl: 't5xxl_fp8.safetensors', vae: 'ae.safetensors' } };
  const sdxl: ImageProfile = { id: 'p2', name: 'Juggernaut', family: 'sdxl', files: { model: 'juggernautXL.safetensors', vae: 'sdxl.vae.safetensors' }, steps: 35 };

  test('a setup knows what it still needs', () => {
    expect(missingFor({ ...flux1, files: { model: 'x' } })).toEqual(['clip_l', 't5xxl', 'vae']);
    expect(missingFor(sdxl)).toEqual([]);
    expect(missingFor({ ...sdxl, files: { model: 'x' } })).toEqual([]); // the VAE is optional for SDXL
    expect(missingFor(sdxl, (folder, f) => folder === 'checkpoints' && f === 'juggernautXL.safetensors')).toEqual(['vae']);
    expect(guessFamily('juggernautXL_v9.safetensors')).toBe('sdxl');
    expect(guessFamily('flux1-dev-Q4_K_S.gguf')).toBe('flux1');
    expect(guessFamily('z_image_turbo_bf16.safetensors')).toBe('zimage');
    expect(suggestFile('flux1', 'vae', ['sdxl.vae.safetensors', 'ae.safetensors'])).toBe('ae.safetensors');
    expect(settingsFor({ ...flux1, family: 'zimage', steps: 40 }).steps).toBe(8); // distilled: fixed
    expect(settingsFor(sdxl).steps).toBe(35);
  });

  test('ComfyUI uses the setup\'s own VAE and text encoders', () => {
    const g = graphTxt2Img({ prompt: 'a cat', checkpoint: 'juggernautXL.safetensors', steps: 30, cfg: 6, width: 1024, height: 1024, profile: sdxl }, 1) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
    expect(g['41']).toEqual({ class_type: 'VAELoader', inputs: { vae_name: 'sdxl.vae.safetensors' } });
    expect(g['8'].inputs.vae).toEqual(['41', 0]);
    const f = graphTxt2Img({ prompt: 'a cat', checkpoint: '', steps: 20, cfg: 1, width: 1024, height: 1024, profile: flux1 }, 1) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
    expect(f['4'].class_type).toBe('UNETLoader');
    expect(f['40']).toMatchObject({ class_type: 'DualCLIPLoader', inputs: { clip_name1: 'clip_l.safetensors', clip_name2: 't5xxl_fp8.safetensors', type: 'flux' } });
    expect(f['7'].class_type).toBe('ConditioningZeroOut');
    expect(comfyWiring(profileForEntry(entryById('z-image-turbo')!)!).clip).toEqual({ node: 'CLIPLoader', name: 'qwen_3_4b.safetensors', type: 'lumina2' });
  });

  test('stable-diffusion.cpp gets every file of the setup', () => {
    const path = (folder: string, file: string) => `/M/image/${folder}/${file}`;
    const a = sdcppArgs(flux1, { prompt: 'a cat', width: 1024, height: 768, seed: 7, count: 2, steps: 20, cfg: 1, sampler: 'euler', scheduler: 'simple', output: '/o/x.png', lowVram: true }, path, [{ name: 'detail.safetensors', strength: 0.8 }]);
    const v = (f: string) => a[a.indexOf(f) + 1];
    expect(v('--diffusion-model')).toBe('/M/image/diffusion_models/flux1-dev-fp8.safetensors');
    expect(v('--clip_l')).toBe('/M/image/text_encoders/clip_l.safetensors');
    expect(v('--t5xxl')).toBe('/M/image/text_encoders/t5xxl_fp8.safetensors');
    expect(v('--vae')).toBe('/M/image/vae/ae.safetensors');
    expect(v('-p')).toBe('a cat<lora:detail:0.8>');
    expect(v('--lora-model-dir')).toBe('/M/image/loras');
    expect(v('-b')).toBe('2');
    expect(a).toContain('--offload-to-cpu');
    expect(a).not.toContain('-n'); // FLUX ignores negative prompts
    const s = sdcppArgs(sdxl, { prompt: 'x', negative: 'blurry', width: 1024, height: 1024, seed: 1, count: 1, steps: 30, cfg: 6, sampler: 'dpmpp_2m', scheduler: 'karras', output: '/o/y.png' }, path);
    expect(s.slice(0, 4)).toEqual(['-m', '/M/image/checkpoints/juggernautXL.safetensors', '--vae', '/M/image/vae/sdxl.vae.safetensors']);
    expect([s[s.indexOf('--sampling-method') + 1], s[s.indexOf('--scheduler') + 1], s[s.indexOf('-n') + 1]]).toEqual(['dpm++2m', 'karras', 'blurry']);
    expect(sdcppProgress('  |=====>     | 5/20 - 1.23s/it')).toEqual({ step: 5, total: 20 });
    expect(sdcppProgress('loading model')).toBeNull();
  });
});

describe('everything in Lotus Studio', () => {
  test('an older data folder is copied into Lotus Studio/Data once, and kept', () => {
    const old = tmp('old'), data = join(tmp('studio'), 'Data');
    writeFileSync(join(old, 'lotus.db'), 'DB'); writeFileSync(join(old, 'lotus.db-wal'), 'WAL'); mkdirSync(join(old, 'logs')); writeFileSync(join(old, 'logs', 'lotusd.log'), 'L');
    expect(moveLegacyData(old, data)).toEqual(['lotus.db', 'lotus.db-wal', 'logs/lotusd.log']);
    expect(readFileSync(join(data, 'lotus.db'), 'utf8')).toBe('DB');
    expect(existsSync(join(old, 'lotus.db'))).toBe(true);
    writeFileSync(join(old, 'lotus.db'), 'NEWER');
    expect(moveLegacyData(old, data)).toEqual([]); // never overwrites the new folder
    expect(moveLegacyData(undefined, data)).toEqual([]);
  });

  test('ComfyUI gets a lotus_studio section in its model paths file; other sections stay', () => {
    const before = 'comfyui:\n    base_path: C:/Comfy\n    checkpoints: models/checkpoints\n\nlotus_studio:\n    base_path: "old"\n    vae: vae\n';
    const out = mergeSection(before, 'C:\\Users\\F\\Documents\\Lotus Studio\\Models\\image');
    expect(out).toContain('comfyui:\n    base_path: C:/Comfy');
    expect(out.match(/lotus_studio:/g)?.length).toBe(1);
    expect(out).toContain('base_path: "C:/Users/F/Documents/Lotus Studio/Models/image"');
    expect(out).toContain('    text_encoders: text_encoders\n    clip: text_encoders');
    const root = tmp('comfy');
    expect(linkComfy('/S/Models/image', { root })).toEqual([join(root, 'extra_model_paths.yaml')]);
    expect(readFileSync(join(root, 'extra_model_paths.yaml'), 'utf8').startsWith('lotus_studio:')).toBe(true);
  });
});

describe('media without a type (0.8.1)', () => {
  test('PNG and WAV uploads sent as application/octet-stream are recognised', async () => {
    const { sniffMime, saveMedia } = await import('../src/media');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
    expect(sniffMime(png)).toBe('image/png');
    expect(sniffMime(Buffer.from('RIFF\0\0\0\0WAVEfmt '))).toBe('audio/wav');
    expect(sniffMime(Buffer.from('hello'))).toBeNull();
    const db = openDb(tmp('media-db'));
    const row = await saveMedia(db, tmp('media-studio'), png, 'application/octet-stream', 'x');
    expect([row.kind, row.mime, row.path.endsWith('.png')]).toEqual(['image', 'image/png', true]);
  });
});

describe('Windows arguments for sherpa-onnx (0.8.1)', () => {
  test('Portuguese text survives the code page conversion as UTF-8 bytes', () => {
    const t = 'olá, tudo bem? como tens estado? ção — “aspas” €';
    const arg = argForAnsi(t, 1252);
    // What Windows does: each character back to its cp1252 byte, then the program reads the bytes as UTF-8.
    const back: number[] = [];
    for (const ch of arg) { const c = ch.codePointAt(0)!; const i = c >= 0x80 && c <= 0x9f ? -1 : '\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178'.indexOf(ch); back.push(i >= 0 ? 0x80 + i : c); }
    expect(new TextDecoder().decode(new Uint8Array(back))).toBe(t);
    expect(argForAnsi('hello', 1252)).toBe('hello');
    expect(argForAnsi(t, 65001)).toBe(t);
    expect(argForAnsi('olá', 932)).toBe('ola');
  });
});

describe('OpenAI messages for llama-server', () => {
  test('tool calls get ids and results answer them in order', () => {
    const out = toOpenAi([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'a', arguments: { x: 1 } } }, { function: { name: 'b', arguments: {} } }] },
      { role: 'tool', tool_name: 'a', content: 'A' },
      { role: 'tool', tool_name: 'b', content: 'B' },
    ]) as { role: string; tool_call_id?: string; tool_calls?: { id: string; function: { arguments: string } }[] }[];
    expect(out[1].tool_calls!.map((c) => c.id)).toEqual(['call_1', 'call_2']);
    expect(out[1].tool_calls![0].function.arguments).toBe('{"x":1}');
    expect([out[2].tool_call_id, out[3].tool_call_id]).toEqual(['call_1', 'call_2']);
    expect(parseSherpaText('Creating\n/x/a.wav\n{"lang": "", "text": " Olá, mundo", "tokens": []}\nnum threads: 4')).toBe('Olá, mundo');
  });
});

// ── End to end with fake GitHub, Hugging Face and engines (POSIX shells only) ────────────────────

const FAKES = resolve(import.meta.dir, 'fake-engines');
const script = (target: string, env = '') => `#!/bin/sh\n${env}exec "${process.execPath}" "${join(FAKES, target)}" "$@"\n`;

function tgz(dir: string, out: string, flag: '-czf' | '-cjf') { const p = Bun.spawnSync(['tar', flag, out, '-C', dir, '.']); if (p.exitCode !== 0) throw new Error(String(p.stderr)); }

describe.skipIf(process.platform === 'win32')('built-in engines end to end', () => {
  test('installs the three engines and a chat, image and voice model, then chats with tools, makes an image and speaks', async () => {
    const work = tmp('e2e');
    const log = join(work, 'llama.log');
    // Release archives with stand-in programs.
    const mk = (name: string, files: Record<string, string>) => { const d = join(work, 'src', name); for (const [f, body] of Object.entries(files)) { mkdirSync(join(d, f, '..'), { recursive: true }); writeFileSync(join(d, f), body); chmodSync(join(d, f), 0o755); } return d; };
    const llamaDir = mk('llama', { 'build/bin/llama-server': script('fake-llama.ts', `FAKE_LOG="${log}" `), 'build/bin/libggml.so': 'lib' });
    tgz(llamaDir, join(work, 'llama-b200-bin-ubuntu-x64.tar.gz'), '-czf');
    const sdDir = mk('sd', { 'sd-cli': script('fake-sd.ts', `FAKE_LOG="${join(work, 'sd.args')}" `) });
    const sdZip: Record<string, Uint8Array> = { 'sd-cli': new Uint8Array(readFileSync(join(sdDir, 'sd-cli'))) };
    writeFileSync(join(work, 'sd-master-abc-bin-Linux-Ubuntu-24.04-x86_64.zip'), zipSync(sdZip));
    const shDir = mk('sherpa', { 'sherpa-onnx-v1.13.7-linux-x64-static/bin/sherpa-onnx-offline-tts': script('fake-sherpa.ts', 'FAKE_MODE=tts '), 'sherpa-onnx-v1.13.7-linux-x64-static/bin/sherpa-onnx-offline': script('fake-sherpa.ts', 'FAKE_MODE=stt ') });
    tgz(shDir, join(work, 'sherpa-onnx-v1.13.7-linux-x64-static.tar.bz2'), '-cjf');
    // A Piper voice archive and a Whisper archive like sherpa-onnx's.
    const piper = mk('piper', { 'vits-piper-en_US-lessac-medium/en_US-lessac-medium.onnx': 'onnx', 'vits-piper-en_US-lessac-medium/tokens.txt': 't', 'vits-piper-en_US-lessac-medium/espeak-ng-data/phontab': 'p' });
    tgz(piper, join(work, 'vits-piper-en_US-lessac-medium.tar.bz2'), '-cjf');
    const whisper = mk('whisper', { 'sherpa-onnx-whisper-small/small-encoder.int8.onnx': 'e', 'sherpa-onnx-whisper-small/small-decoder.int8.onnx': 'd', 'sherpa-onnx-whisper-small/small-tokens.txt': 't', 'sherpa-onnx-whisper-small/small-encoder.onnx': 'e' });
    tgz(whisper, join(work, 'sherpa-onnx-whisper-small.tar.bz2'), '-cjf');

    const hits: string[] = [];
    const gh = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch(req) {
      const u = new URL(req.url);
      hits.push(u.pathname);
      const rel = (tag: string, names: string[]) => Response.json([{ tag_name: 'v9.9.9', assets: [{ name: 'gguf-py.tar.gz', browser_download_url: `${u.origin}/dl/none`, size: 1 }] }, { tag_name: tag, assets: names.map((n) => ({ name: n, browser_download_url: `${u.origin}/dl/${n}`, size: readFileSync(join(work, n)).length })) }]);
      if (u.pathname === '/repos/ggml-org/llama.cpp/releases') return rel('b200', ['llama-b200-bin-ubuntu-x64.tar.gz']);
      if (u.pathname === '/repos/leejet/stable-diffusion.cpp/releases') return rel('master-1-abc', ['sd-master-abc-bin-Linux-Ubuntu-24.04-x86_64.zip']);
      if (u.pathname === '/repos/k2-fsa/sherpa-onnx/releases') return rel('v1.13.7', ['sherpa-onnx-v1.13.7-linux-x64-static.tar.bz2']);
      if (u.pathname.startsWith('/dl/')) return new Response(Bun.file(join(work, u.pathname.slice(4))));
      if (u.pathname === '/api/models/unsloth/Qwen3-8B-GGUF/tree/main') return Response.json([{ type: 'file', path: 'Qwen3-8B-Q4_K_M.gguf', size: 9 }, { type: 'file', path: 'Qwen3-8B-Q8_0.gguf', size: 9 }]);
      if (u.pathname === '/unsloth/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf') return new Response('GGUFmodel');
      if (u.pathname.includes('/resolve/main/')) return new Response(`file:${u.pathname.split('/').pop()}`);
      if (u.pathname.startsWith('/k2-fsa/sherpa-onnx/releases/download/')) return new Response(Bun.file(join(work, u.pathname.split('/').pop()!)));
      return new Response('nf', { status: 404 });
    } });
    stops.push(() => gh.stop(true));
    // Every outside address goes to the fake server.
    const fakeFetch = ((url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(url instanceof Request ? url.url : url));
      if (/^(api\.github\.com|github\.com|huggingface\.co)$/.test(u.hostname)) return fetch(`${gh.url.origin}${u.pathname}${u.search}`, init);
      return fetch(url, init);
    }) as typeof fetch;

    const studio = tmp('studio');
    const db = openDb(tmp('data'));
    kvApply(db, { set: { 'lotus.settings.v1': JSON.stringify({ llmBackend: 'builtin', imageEngine: 'builtin', agentApproval: 'never' }) }, remove: [] });
    const srv = startServer({ db, studio, token: 'x'.repeat(40), fetch: fakeFetch, builtins: { machine: async () => ({ os: 'linux', arch: 'x64', gpu: 'none', gpuName: '', vramGb: 0, unified: false, ramGb: 16 }) } });
    stops.push(() => { srv.builtins.shutdown(); srv.stop(true); });
    const rpc = async (m: string, a: Record<string, unknown> = {}) => {
      const r = await fetch(`http://127.0.0.1:${srv.port}/v1/rpc/${m}`, { method: 'POST', headers: { authorization: `Bearer ${'x'.repeat(40)}`, 'content-type': 'application/json' }, body: JSON.stringify(a) });
      const j = await r.json() as { result?: unknown; error?: string };
      if (j.error) throw new Error(j.error);
      return j.result as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    const b: Builtins = srv.builtins;

    // Folders exist from the start.
    expect(existsSync(join(studio, 'Models', 'image', 'vae'))).toBe(true);

    // Engines.
    for (const engine of ['llama', 'sd', 'sherpa']) {
      const { jobId } = await rpc('builtin_install', { engine });
      const j = await b.wait(jobId, 20_000);
      expect(j?.error ?? j?.state).toBe('done');
    }
    const st = await rpc('builtin_status');
    expect(st.engines.map((e: { installed: boolean; version: string }) => [e.installed, e.version])).toEqual([[true, 'b200'], [true, 'master-1-abc'], [true, 'v1.13.7'], [false, null]]); // 0.21: FFmpeg is installed on request (Video)
    expect(existsSync(join(studio, 'Engines', 'llama.cpp', 'b200', 'build', 'bin', 'llama-server'))).toBe(true);
    expect(hits.filter((h) => h === '/dl/none').length).toBe(0); // the release without binaries was skipped

    // Models: a chat GGUF resolved from the repo listing, an image model with its VAE, a voice and a dictation model.
    for (const id of ['qwen3-8b', 'sd15', 'piper-en-us-lessac', 'whisper-small']) {
      const { jobId } = await rpc('models_install', { id });
      const j = await b.wait(jobId, 20_000);
      expect(j?.error ?? j?.state).toBe('done');
    }
    const inst = await rpc('models_installed');
    expect(inst.models.map((m: { id: string }) => m.id).sort()).toEqual(['piper-en-us-lessac', 'qwen3-8b', 'sd15', 'whisper-small']);
    expect(readFileSync(join(studio, 'Models', 'chat', 'qwen3-8b', 'Qwen3-8B-Q4_K_M.gguf'), 'utf8')).toBe('GGUFmodel');
    expect(inst.imageFiles.vae.map((f: { file: string }) => f.file)).toEqual(['vae-ft-mse-840000-ema-pruned.safetensors']);
    // Installing a catalog image model creates its setup, tying the checkpoint to its VAE.
    const profiles = JSON.parse(kvGet(db, 'lotus.imageProfiles.v1') || '[]') as ImageProfile[];
    expect(profiles).toEqual([{ id: 'cat-sd15', name: 'Stable Diffusion 1.5', family: 'sd15', files: { model: 'v1-5-pruned-emaonly.safetensors', vae: 'vae-ft-mse-840000-ema-pruned.safetensors' }, catalogId: 'sd15' }]);

    // Chat through the agent: llama-server starts with the model, gets the tool list, and the task is really added.
    const { runId } = b && await rpc('agent_start', { model: 'qwen3-8b', messages: [{ role: 'system', content: 'You are Lotus.' }, { role: 'user', content: 'Add a task to buy milk' }], prompt: 'Add a task to buy milk' });
    let run: { status: string; reply: string; steps: { tool: string; status: string }[] } | null = null;
    for (let i = 0; i < 300; i++) { run = await rpc('agent_run', { runId }); if (run && run.status !== 'running') break; await Bun.sleep(50); }
    expect(run?.status).toBe('done');
    expect(run?.steps.map((s) => [s.tool, s.status])).toEqual([['task.add', 'done']]);
    expect(run?.reply).toContain('Buy milk');
    expect(listTasks(db).some((t) => t.title === 'Buy milk')).toBe(true); // phase 2: the tasks table, not kv
    const sent = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(sent[0].argv).toContain('--jinja');
    expect(sent[0].argv[sent[0].argv.indexOf('--reasoning-format') + 1]).toBe('deepseek'); // 0.14.2
    expect(sent[0].argv[sent[0].argv.indexOf('-m') + 1]).toBe(join(studio, 'Models', 'chat', 'qwen3-8b', 'Qwen3-8B-Q4_K_M.gguf'));
    expect(sent[0].body.tools.length).toBeGreaterThan(3);
    expect(sent[1].body.messages.find((m: { role: string }) => m.role === 'tool')).toMatchObject({ tool_call_id: 'call_1' });
    expect((await rpc('builtin_status')).chat.state).toBe('ready');

    // Images: the setup's checkpoint and its VAE both reach sd-cli; the image is saved in Lotus Studio/Images.
    const ticks: unknown[] = [];
    const img = await builtinImageVia(rpc, profiles[0]);
    expect(img.images.length).toBe(2);
    expect(existsSync(join(studio, img.images[0].path))).toBe(true);
    const sdArgs = JSON.parse(readFileSync(join(work, 'sd.args'), 'utf8')) as string[];
    expect(sdArgs[sdArgs.indexOf('--vae') + 1]).toBe(join(studio, 'Models', 'image', 'vae', 'vae-ft-mse-840000-ema-pruned.safetensors'));
    // No GPU: low-memory mode. This sd-cli has auto-fit, so it keeps 1 GiB spare instead of --offload-to-cpu (0.9.2).
    expect(sdArgs).not.toContain('--offload-to-cpu');
    expect(sdArgs[sdArgs.indexOf('--max-vram') + 1]).toBe('-2');
    // 0.9.5: one folder per generation, named from the prompt, with numbered outputs.
    expect(img.dir).toBe('A lotus flower');
    expect(img.images.map((m: { path: string }) => m.path)).toEqual(['Images/A lotus flower/Output 1.png', 'Images/A lotus flower/Output 2.png']);
    // The next run of the same generation keeps its folder and numbering; references are saved next to them.
    const png = readFileSync(join(studio, img.images[0].path)).toString('base64');
    const again = await rpc('image_builtin', { profile: profiles[0], prompt: 'a lotus flower', aspect: '1:1', count: 1, dir: img.dir, refs: [{ data: png, mime: 'image/png' }, { data: png, mime: 'image/png' }], strength: 0.5 });
    expect(again.dir).toBe('A lotus flower');
    expect(again.references).toEqual(['Images/A lotus flower/Reference 1.png']); // the same picture twice is saved once
    expect(again.images[0].path).toBe('Images/A lotus flower/Output 3.png');
    const sd2 = JSON.parse(readFileSync(join(work, 'sd.args'), 'utf8')) as string[];
    expect(sd2[sd2.indexOf('-i') + 1]).toBe(join(studio, 'Images', 'A lotus flower', 'Reference 1.png'));
    expect(sd2).not.toContain('-r'); // SD 1.5 starts from one image
    // A new generation with the same prompt gets its own folder.
    expect((await builtinImageVia(rpc, profiles[0])).dir).toBe('A lotus flower 2');
    void ticks;
    // A setup that is missing its VAE says so instead of making a wrong image.
    await expect(rpc('image_builtin', { profile: { id: 'x', name: 'Broken FLUX', family: 'flux1', files: { model: 'nope.safetensors' } }, prompt: 'x' })).rejects.toThrow(/missing the model file \(nope\.safetensors\), CLIP-L, T5-XXL, VAE/);

    // Voice: speak with the Piper voice, then transcribe a recording with Whisper.
    const spoken = await rpc('tts_builtin', { voice: 'piper-en-us-lessac', text: 'Hello there' });
    expect(spoken.kind).toBe('audio');
    expect(readFileSync(join(studio, spoken.path)).subarray(0, 4).toString()).toBe('RIFF');
    const heard = await rpc('stt_builtin', { model: 'whisper-small', path: spoken.path });
    expect(heard.text).toBe('Olá, mundo');
    expect(existsSync(join(studio, spoken.path))).toBe(false); // the recording is not kept

    // Removing a model keeps files another model still uses, and removing an engine stops it.
    expect(await rpc('models_remove', { id: 'sd15' })).toBe(true);
    expect(existsSync(join(studio, 'Models', 'image', 'checkpoints', 'v1-5-pruned-emaonly.safetensors'))).toBe(false);
    expect(await rpc('builtin_remove', { engine: 'llama' })).toBe(true);
    expect((await rpc('builtin_status')).chat.state).toBe('stopped');
  }, 60_000);
});

async function builtinImageVia(rpc: (m: string, a?: Record<string, unknown>) => Promise<any>, profile: ImageProfile) { // eslint-disable-line @typescript-eslint/no-explicit-any
  return rpc('image_builtin', { profile, prompt: 'a lotus flower', aspect: '1:1', count: 2, genId: 'g1' });
}
