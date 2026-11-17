// T71: a model catalog for every kind of computer (CPU-only, 4–6, 8, 12–16, 24+ GB graphics cards,
// Apple Silicon by memory), fit by the computer's memory when there is no graphics card, and big
// models split into parts on Hugging Face. Hugging Face is faked.

import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Builtins } from '../src/engines/manager';
import {
  CHAT_CLASS_PICKS, CHAT_MODELS, CLASS_LABEL, chatPicksFor, entryById, fitOf, LIBRARY, machineClass, pickGguf, quantFolder, suggest,
  type MachineClass, type MachineFacts,
} from '../../src/models/library';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'lotus-t71-')); dirs.push(d); return d; };
afterAll(() => dirs.forEach((d) => { try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows */ } }));

const gpu = (vramGb: number, ramGb = 32): MachineFacts => ({ gpu: 'nvidia', vramGb, unified: false, ramGb });
const mac = (gb: number): MachineFacts => ({ gpu: 'apple', vramGb: gb, unified: true, ramGb: gb });
const cpu = (ramGb: number): MachineFacts => ({ gpu: 'none', vramGb: 0, unified: false, ramGb });

/** The smallest and the largest common machine in each class. */
const RANGE: Record<MachineClass, [MachineFacts, MachineFacts]> = {
  cpu: [cpu(8), cpu(32)],
  'gpu-6': [gpu(6), gpu(6)],
  'gpu-8': [gpu(8), gpu(10)],
  'gpu-16': [gpu(12), gpu(16)],
  'gpu-24': [gpu(24), gpu(32)],
  'gpu-48': [gpu(48), gpu(96)],
  'apple-8': [mac(8), mac(8)],
  'apple-16': [mac(16), mac(24)],
  'apple-32': [mac(32), mac(48)],
  'apple-64': [mac(64), mac(128)],
};

describe('kinds of computer', () => {
  test('real machines land in the right class', () => {
    expect(machineClass(gpu(8))).toBe('gpu-8'); // Filipe's RTX 4060
    expect(machineClass(gpu(6))).toBe('gpu-6'); // RTX 3060 Laptop
    expect(machineClass(gpu(4))).toBe('gpu-6');
    expect(machineClass(gpu(12))).toBe('gpu-16'); // RTX 3060 12 GB / 4070
    expect(machineClass(gpu(16))).toBe('gpu-16');
    expect(machineClass(gpu(24))).toBe('gpu-24'); // RTX 4090
    expect(machineClass(gpu(32))).toBe('gpu-24'); // RTX 5090
    expect(machineClass(gpu(48))).toBe('gpu-48');
    expect(machineClass(gpu(2))).toBe('cpu'); // too little to help
    expect(machineClass(cpu(16))).toBe('cpu');
    expect(machineClass({ gpu: 'none', vramGb: 8, unified: false })).toBe('cpu'); // vram ignored without a GPU
    expect(machineClass(mac(8))).toBe('apple-8');
    expect(machineClass(mac(16))).toBe('apple-16');
    expect(machineClass(mac(24))).toBe('apple-16');
    expect(machineClass(mac(32))).toBe('apple-32');
    expect(machineClass(mac(36))).toBe('apple-32');
    expect(machineClass(mac(48))).toBe('apple-32');
    expect(machineClass(mac(64))).toBe('apple-64');
    expect(machineClass(mac(128))).toBe('apple-64');
    for (const c of Object.keys(CHAT_CLASS_PICKS) as MachineClass[]) expect(CLASS_LABEL[c]).toBeTruthy();
  });

  test('every class has three real picks: quick and balanced fit its smallest machine, best its largest', () => {
    for (const [c, picks] of Object.entries(CHAT_CLASS_PICKS) as [MachineClass, Record<string, string>][]) {
      const [small, large] = RANGE[c];
      expect(machineClass(small)).toBe(c);
      expect(machineClass(large)).toBe(c);
      for (const t of ['quick', 'balanced', 'best']) {
        const e = CHAT_MODELS.find((x) => x.id === picks[t]);
        expect(e, `${c} ${t} ${picks[t]}`).toBeTruthy();
        expect(e!.builtin?.gguf && e!.ollama, `${e!.id} needs both engines`).toBeTruthy();
        const m = t === 'best' ? large : small;
        const f = fitOf(e!, m.vramGb, m.unified, m.ramGb);
        // Without a graphics card everything above 2 GB is "slow" rather than "fits"; it must still load.
        expect(c === 'cpu' ? f !== 'too-big' : f === 'fits', `${c} ${t} ${e!.id} → ${f}`).toBe(true);
      }
      expect(chatPicksFor(small).map((e) => e.tier)).toEqual(['quick', 'balanced', 'best']);
    }
  });

  test('the guide suggests the best pick that fits', () => {
    expect(suggest('chat', 8)?.id).toBe('qwen3-8b'); // 4060: the tested tool user, not the tight 9B
    expect(suggest('chat', 16)?.id).toBe('gpt-oss-20b');
    expect(suggest('chat', 12)?.id).toBe('gemma-4-12b');
    expect(suggest('chat', 24)?.id).toBe('qwen3.8-27b');
    expect(suggest('chat', 6)?.id).toBe('qwen3.5-4b');
    expect(suggest('chat', 16, true)?.id).toBe('gemma-4-12b');
    expect(suggest('chat', 8, true)?.id).toBe('qwen3.5-4b');
    expect(suggest('chat', 64, true)?.id).toBe('qwen3.8-27b'); // 122B needs more
    expect(suggest('chat', 128, true)?.id).toBe('qwen3.5-122b-a10b');
    // No graphics card: the balanced pick if the memory holds it, else the smallest.
    expect(suggest('chat', 0, false, 'builtin', 16)?.id).toBe('qwen3.5-2b');
    expect(suggest('chat', undefined, false, 'builtin', 4)?.id).toBe('qwen3.5-0.8b');
    // Unknown memory still gets something.
    expect(suggest('chat', undefined)?.id).toBe('qwen3.5-2b');
  });

  test('without a graphics card the computer\'s memory decides what can load', () => {
    const big = entryById('qwen3.5-122b-a10b')!;
    expect(fitOf(big, 0, false, 16)).toBe('too-big');
    expect(fitOf(entryById('qwen3-8b')!, 0, false, 16)).toBe('unknown'); // loads, but slowly
    expect(fitOf(entryById('qwen3-8b')!, 0, false, 8)).toBe('too-big');
    expect(fitOf(entryById('qwen3.5-0.8b')!, 0, false, 4)).toBe('fits');
    expect(fitOf(entryById('kokoro')!, 0, false, 2)).toBe('fits'); // voices run on the processor anyway
    expect(fitOf(big, undefined)).toBe('unknown'); // memory unknown: old behaviour
  });
});

describe('the catalog itself', () => {
  test('a wide range of chat models, each with sane numbers and a Q4_K_M GGUF', () => {
    expect(CHAT_MODELS.length).toBeGreaterThanOrEqual(25);
    expect(new Set(LIBRARY.map((e) => e.id)).size).toBe(LIBRARY.length);
    for (const e of CHAT_MODELS) {
      expect(e.kind).toBe('chat');
      expect(e.tier).toBeUndefined(); // tiers come from the computer's class now
      expect(e.builtin?.gguf?.repo, e.id).toMatch(/^[\w.-]+\/[\w.-]+$/);
      expect(e.builtin?.gguf?.quant).toBe('Q4_K_M');
      expect(e.diskGb).toBeGreaterThan(0);
      expect(e.vramGb, e.id).toBeGreaterThanOrEqual(e.diskGb);
      expect(e.vramGb - e.diskGb, e.id).toBeLessThanOrEqual(5);
      expect(!!e.vision, e.id).toBe(!!e.builtin?.gguf?.mmproj); // vision ⇔ a vision file is downloaded
      expect(e.blurb.length).toBeGreaterThan(20);
      expect(e.ollama, e.id).toMatch(/^[\w.-]+:[\w.-]+$/);
    }
    // Something for every size of computer.
    const sizes = CHAT_MODELS.map((e) => e.vramGb);
    for (const [lo, hi] of [[0, 3.5], [3.5, 7], [7, 11.5], [11.5, 20], [20, 40], [40, 200]]) expect(sizes.some((v) => v >= lo && v < hi), `${lo}–${hi} GB`).toBe(true);
    // Every maker that matters for beginners is there.
    for (const maker of ['Alibaba', 'Google', 'NVIDIA', 'OpenAI', 'Microsoft', 'Mistral AI', 'Meta']) expect(CHAT_MODELS.some((e) => e.maker === maker), maker).toBe(true);
  });
});

describe('split GGUF files', () => {
  // Shapes copied from Hugging Face's listings (17 Nov 2026).
  const ROOT_122B = [
    { path: 'BF16', dir: true }, { path: 'Q4_K_M', dir: true }, { path: 'UD-Q4_K_XL', dir: true }, { path: 'Q8_0', dir: true },
    { path: 'Qwen3.5-122B-A10B-UD-IQ2_M.gguf', size: 39148942528 }, { path: 'mmproj-F16.gguf', size: 908724960 }, { path: 'mmproj-BF16.gguf', size: 912263904 },
  ];
  const PARTS_122B = [
    { path: 'Q4_K_M/Qwen3.5-122B-A10B-Q4_K_M-00002-of-00003.gguf', size: 49968146912 },
    { path: 'Q4_K_M/Qwen3.5-122B-A10B-Q4_K_M-00001-of-00003.gguf', size: 10943552 },
    { path: 'Q4_K_M/Qwen3.5-122B-A10B-Q4_K_M-00003-of-00003.gguf', size: 26557874144 },
  ];

  test('picks every part in order, the first one as the model', () => {
    const files = ROOT_122B.filter((f) => !f.dir) as { path: string; size: number }[];
    expect(pickGguf(files, 'Q4_K_M', 'F16').model).toBeUndefined();
    expect(quantFolder(ROOT_122B, 'Q4_K_M')).toBe('Q4_K_M');
    expect(quantFolder(ROOT_122B, 'Q5_K_M')).toBeUndefined();
    const p = pickGguf([...files, ...PARTS_122B], 'Q4_K_M', 'F16');
    expect(p.model?.path).toBe('Q4_K_M/Qwen3.5-122B-A10B-Q4_K_M-00001-of-00003.gguf');
    expect(p.parts?.map((x) => x.path.slice(-19))).toEqual(['-00001-of-00003.gguf', '-00002-of-00003.gguf', '-00003-of-00003.gguf'].map((s) => s.slice(-19)));
    expect(p.mmproj?.path).toBe('mmproj-F16.gguf');
  });

  test('a missing part means no download rather than half a model', () => {
    const p = pickGguf(PARTS_122B.filter((f) => !f.path.includes('00003-of')), 'Q4_K_M');
    expect(p.model).toBeUndefined();
  });

  test('draft (MTP) and BF16 folders are never picked; one-file repos are unchanged', () => {
    const files = [
      { path: 'MTP/Qwen3.8-27B-MTP-Q4_K_M.gguf', size: 1 },
      { path: 'BF16/Qwen3.8-27B-BF16-00001-of-00002.gguf', size: 1 },
      { path: 'Qwen3.8-27B-Q4_0.gguf', size: 1 },
      { path: 'Qwen3.8-27B-UD-Q4_K_M.gguf', size: 16564259744 },
      { path: 'mtp-gemma.gguf', size: 1 },
      { path: 'mmproj-F16.gguf', size: 927607488 },
    ];
    const p = pickGguf(files, 'Q4_K_M', 'F16');
    expect(p.model?.path).toBe('Qwen3.8-27B-UD-Q4_K_M.gguf');
    expect(p.parts).toBeUndefined();
    expect(pickGguf([{ path: 'Qwen3-8B-Q4_K_M.gguf' }, { path: 'Qwen3-8B-UD-Q4_K_M.gguf' }], 'Q4_K_M').model?.path).toBe('Qwen3-8B-Q4_K_M.gguf');
  });

  test('the downloader lists the quantisation folder and fetches every part beside the first', async () => {
    const asked: string[] = [];
    const fakeFetch = (async (url: string) => {
      const u = new URL(url);
      asked.push(u.pathname);
      if (u.pathname === '/api/models/unsloth/Big-GGUF/tree/main') return Response.json([
        { type: 'directory', path: 'Q4_K_M' }, { type: 'directory', path: 'BF16' }, { type: 'file', path: 'mmproj-F16.gguf', size: 4 },
      ]);
      if (u.pathname === '/api/models/unsloth/Big-GGUF/tree/main/Q4_K_M') return Response.json([
        { type: 'file', path: 'Q4_K_M/Big-Q4_K_M-00002-of-00002.gguf', size: 5 }, { type: 'file', path: 'Q4_K_M/Big-Q4_K_M-00001-of-00002.gguf', size: 5 },
      ]);
      if (u.pathname.includes('/resolve/main/')) { const name = u.pathname.split('/').pop()!; return new Response(name.startsWith('mmproj') ? 'PROJ' : name.includes('00001') ? 'PART1' : 'PART2'); }
      return new Response('nf', { status: 404 });
    }) as unknown as typeof fetch;
    const studio = tmp();
    const b = new Builtins({ studio, broadcast: () => undefined, kvGet: () => null, kvSet: () => undefined, fetch: fakeFetch, hfBase: 'https://hf.test', log: () => undefined } as never);
    b.ensureFolders();
    const jobId = b.installCustom({ source: 'unsloth/Big-GGUF:Q4_K_M', kind: 'chat' });
    const j = await b.wait(jobId, 10_000);
    expect(j?.error ?? j?.state).toBe('done');
    expect(asked).toContain('/api/models/unsloth/Big-GGUF/tree/main/Q4_K_M');
    expect(asked.some((p) => p.includes('BF16'))).toBe(false);
    const m = b.installed().find((x) => x.custom)!;
    expect(m.gguf).toMatch(/Big-Q4_K_M-00001-of-00002\.gguf$/);
    expect(m.mmproj).toMatch(/mmproj-F16\.gguf$/);
    expect(m.files.length).toBe(3);
    const dir = join(studio, 'Models', m.gguf!.replace(/[^/]+$/, ''));
    expect(readFileSync(join(dir, 'Big-Q4_K_M-00001-of-00002.gguf'), 'utf8')).toBe('PART1');
    expect(readFileSync(join(dir, 'Big-Q4_K_M-00002-of-00002.gguf'), 'utf8')).toBe('PART2');
    expect(existsSync(join(dir, 'mmproj-F16.gguf'))).toBe(true);
  });
});
