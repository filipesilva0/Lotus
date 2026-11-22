// 0.21.0: Inkling 2 Mini (Thinking Machines Lab) and mixture-of-experts models on small cards.
//   - The GGUF reader finds each layer's expert weights in the tensor list.
//   - A mixture-of-experts model too big for the card keeps the experts of its first layers in system
//     memory (llama-server --n-cpu-moe), instead of llama.cpp moving whole layers to the processor.
//   - The catalog entry, its download files, the "fits" label on an 8 GB card, the reasoning_effort
//     switch, and the message when the installed llama.cpp doesn't know the model yet.

import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expertBytesByLayer, readGgufFile, readGgufInfo } from '../src/engines/gguf';
import { fitChatCtx, MB, MOE_SPLIT_CTX, planMoe } from '../src/engines/chatFit';
import { Builtins, engineTooOld, MAX_CHAT_CTX, MIN_CHAT_CTX } from '../src/engines/manager';
import { CHAT_MODELS, entryById, FIT_LABEL, fitOf, licenceUse, pickGguf } from '../../src/models/library';
import { thinkingKwargs } from '../../src/services/thinkSwitch';

const dirs: string[] = [];
const tmp = (tag: string) => { const d = mkdtempSync(join(tmpdir(), `lotus-inkling-${tag}-`)); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows */ } } });

// ── A GGUF writer with a tensor list. The weights are left as a sparse hole, so an 18 GB "model" costs no disk. ──
type Kv = Record<string, number | string>;
function writeGguf(path: string, kv: Kv, tensors: [string, number][]) {
  const parts: Buffer[] = [];
  const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); parts.push(b); };
  const u64 = (n: number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); parts.push(b); };
  const str = (x: string) => { const b = Buffer.from(x, 'utf8'); u64(b.length); parts.push(b); };
  u32(0x46554747); u32(3); u64(tensors.length); u64(Object.keys(kv).length);
  for (const [k, v] of Object.entries(kv)) { str(k); if (typeof v === 'number') { u32(4); u32(v); } else { u32(8); str(v); } }
  let off = 0;
  for (const [name, bytes] of tensors) { str(name); u32(1); u64(bytes); u32(0); u64(off); off += Math.ceil(bytes / 32) * 32; }
  const head = Buffer.concat(parts);
  const dataStart = Math.ceil(head.length / 32) * 32;
  const fd = openSync(path, 'w');
  writeSync(fd, head);
  ftruncateSync(fd, dataStart + off);
  closeSync(fd);
}

const LAYERS = 24;
const EXPERT_MB = 230; // each of up, gate and down: 690 MB of experts per layer, about 16.2 GB in all
/** Inkling 2 Mini's shape at IQ4_NL: 24 layers, 128 experts, about 18 GB. */
function inklingTensors(): [string, number][] {
  const t: [string, number][] = [['token_embd.weight', 900 * MB], ['output.weight', 900 * MB], ['output_norm.weight', 10_000]];
  for (let i = 0; i < LAYERS; i++) {
    t.push([`blk.${i}.attn_norm.weight`, 9216], [`blk.${i}.attn_q.weight`, 12 * MB], [`blk.${i}.attn_k.weight`, 3 * MB], [`blk.${i}.attn_v.weight`, 3 * MB], [`blk.${i}.attn_output.weight`, 12 * MB],
      [`blk.${i}.ffn_gate_inp.weight`, MB], [`blk.${i}.ffn_up_shexp.weight`, 6 * MB],
      [`blk.${i}.ffn_up_exps.weight`, EXPERT_MB * MB], [`blk.${i}.ffn_gate_exps.weight`, EXPERT_MB * MB], [`blk.${i}.ffn_down_exps.weight`, EXPERT_MB * MB]);
  }
  return t;
}
const inklingKv: Kv = {
  'general.architecture': 'inkling2_loop', 'general.name': 'Inkling 2 Mini',
  'inkling2_loop.block_count': LAYERS, 'inkling2_loop.context_length': 1_048_576, 'inkling2_loop.embedding_length': 2304,
  'inkling2_loop.attention.head_count': 18, 'inkling2_loop.attention.head_count_kv': 2, 'inkling2_loop.attention.key_length': 128,
  'inkling2_loop.expert_count': 128, 'inkling2_loop.expert_used_count': 8, 'inkling2_loop.vocab_size': 200_000,
};

describe('reading the experts from a GGUF file', () => {
  test('each layer\'s expert weights come from the tensor list; other weights are not counted', () => {
    const p = join(tmp('gguf'), 'inkling.gguf');
    writeGguf(p, inklingKv, inklingTensors());
    const f = readGgufFile(p, true);
    expect(f.tensors.length).toBe(3 + LAYERS * 10);
    const info = readGgufInfo(p)!;
    expect(info.arch).toBe('inkling2_loop');
    expect(info.expertCount).toBe(128);
    expect(info.expertBytes!.length).toBe(LAYERS);
    // Sizes come from the gaps between tensors, so each layer is exactly its three expert tensors.
    for (const b of info.expertBytes!) expect(b).toBe(3 * EXPERT_MB * MB);
  });

  test('an ordinary model has no experts, and names like ffn_up_shexp (shared expert) are not experts', () => {
    expect(expertBytesByLayer([{ name: 'blk.0.ffn_up.weight', bytes: 10 }, { name: 'blk.0.ffn_up_shexp.weight', bytes: 10 }], 2)).toEqual([]);
    expect(expertBytesByLayer([{ name: 'blk.1.ffn_down_exps.weight', bytes: 7 }, { name: 'blk.1.ffn_gate_up_exps.weight', bytes: 3 }], 2)).toEqual([0, 10]);
  });
});

describe('splitting a mixture-of-experts model between the card and system memory', () => {
  const info = () => { const p = join(tmp('plan'), 'inkling.gguf'); writeGguf(p, inklingKv, inklingTensors()); return readGgufInfo(p)!; };
  const weightsMb = (LAYERS * (3 * EXPERT_MB + 30 + 7) + 1800) + 346; // model + vision file

  test('8 GB card: 32K context on the card, and only as many layers\' experts in system memory as needed', () => {
    const i = { info: info(), weightsMb, hasVision: true, budgetMb: 8188 - 500 - 1024, min: MIN_CHAT_CTX, max: MAX_CHAT_CTX };
    expect(fitChatCtx(i).fits).toBe(false);
    const plan = planMoe(i)!;
    expect(plan.ctx).toBe(MOE_SPLIT_CTX);
    expect(plan.fits).toBe(true);
    expect(plan.gpuMb).toBeLessThanOrEqual(i.budgetMb);
    expect(plan.cpuLayers).toBeGreaterThan(10);
    expect(plan.cpuLayers).toBeLessThan(LAYERS);
    // One layer fewer would not fit: the split keeps as many experts on the card as it can.
    expect(plan.gpuMb + 3 * EXPERT_MB).toBeGreaterThan(i.budgetMb);
  });

  test('a card it fits whole, an ordinary model, or no memory reading: no split', () => {
    expect(planMoe({ info: info(), weightsMb, hasVision: true, budgetMb: 40_000, min: MIN_CHAT_CTX, max: MAX_CHAT_CTX })).toBeNull();
    expect(planMoe({ info: { ...info(), expertBytes: [] }, weightsMb, hasVision: true, budgetMb: 6000, min: MIN_CHAT_CTX, max: MAX_CHAT_CTX })).toBeNull();
    expect(planMoe({ info: info(), weightsMb, hasVision: true, budgetMb: null, min: MIN_CHAT_CTX, max: MAX_CHAT_CTX })).toBeNull();
  });

  test('a card too small even for the rest: every expert in system memory, and it says so', () => {
    const plan = planMoe({ info: info(), weightsMb, hasVision: true, budgetMb: 1500, min: MIN_CHAT_CTX, max: MAX_CHAT_CTX })!;
    expect(plan.cpuLayers).toBe(LAYERS);
    expect(plan.fits).toBe(false);
  });
});

describe('Inkling 2 Mini in the catalog', () => {
  const e = entryById('inkling-2-mini')!;

  test('the official ggml-org files, vision, Apache 2.0 (open for work), no Ollama tag yet', () => {
    expect(e.kind).toBe('chat');
    expect(e.maker).toBe('Thinking Machines Lab');
    expect(e.builtin?.gguf).toEqual({ repo: 'ggml-org/Inkling-2-Mini-GGUF', quant: 'IQ4_NL', mmproj: 'Inkling-2-Mini-Q8_0' });
    expect(e.vision).toBe(true);
    expect(licenceUse(e.licence)).toBe('open');
    expect(e.ollama).toBeUndefined();
    expect(CHAT_MODELS.filter((x) => x.id === e.id).length).toBe(1);
  });

  test('the download picks IQ4_NL and the small vision file from the repo\'s real file list', () => {
    const files = ['Inkling-2-Mini-BF16.gguf', 'Inkling-2-Mini-IQ4_NL.gguf', 'Inkling-2-Mini-Q8_0.gguf', 'README.md', 'imatrix.gguf', 'mmproj-Inkling-2-Mini-BF16.gguf', 'mmproj-Inkling-2-Mini-Q8_0.gguf'].map((path) => ({ path }));
    const g = e.builtin!.gguf!;
    const pick = pickGguf(files, g.quant, g.mmproj);
    expect(pick.model?.path).toBe('Inkling-2-Mini-IQ4_NL.gguf');
    expect(pick.mmproj?.path).toBe('mmproj-Inkling-2-Mini-Q8_0.gguf');
  });

  test('8 GB card: a tight fit with 32 GB of RAM, too big with 16 GB; fits a 24 GB card whole', () => {
    expect(fitOf(e, 8, false, 32)).toBe('tight');
    expect(FIT_LABEL[fitOf(e, 8, false, 32)]).toBe('Tight fit, runs slower');
    expect(fitOf(e, 8, false, 16)).toBe('too-big');
    expect(fitOf(e, 24, false, 32)).toBe('fits');
    // A 4 GB card can't hold even the part that stays on the card.
    expect(fitOf(e, 4, false, 64)).toBe('too-big');
    // Ordinary models are unchanged: a 12B model is still too big for a 6 GB card.
    expect(fitOf(entryById('qwen3-14b')!, 6, false, 64)).toBe('too-big');
  });

  test('other mixture-of-experts models get the same help on an 8 GB card', () => {
    for (const id of ['gpt-oss-20b', 'qwen3-coder-30b-a3b', 'gemma-4-26b-a4b']) expect(fitOf(entryById(id)!, 8, false, 32)).toBe('tight');
  });
});

describe('Think on and off for Inkling', () => {
  test('Inkling gets reasoning_effort ("none" when off); other models keep only enable_thinking', () => {
    expect(thinkingKwargs(false, 'inkling-2-mini')).toEqual({ chat_template_kwargs: { enable_thinking: false, reasoning_effort: 'none' } });
    expect(thinkingKwargs(true, 'inkling-2-mini')).toEqual({ chat_template_kwargs: { enable_thinking: true, reasoning_effort: 'high' } });
    expect(thinkingKwargs('low', 'inkling-2-mini')).toEqual({ chat_template_kwargs: { enable_thinking: true, reasoning_effort: 'low' } });
    expect(thinkingKwargs(false, 'gpt-oss-20b')).toEqual({ chat_template_kwargs: { enable_thinking: false } });
    expect(thinkingKwargs(undefined, 'inkling-2-mini')).toEqual({});
  });
});

describe('a llama.cpp that does not know the model yet', () => {
  test('the log line becomes a plain message that says to update the engine', () => {
    const msg = engineTooOld("llama_model_load: error loading model: error loading model architecture: unknown model architecture: 'inkling2_loop'", 'Inkling 2 Mini', 'b12380')!;
    expect(msg).toContain('Inkling 2 Mini needs a newer llama.cpp');
    expect(msg).toContain('(b12380)');
    expect(msg).toContain('inkling2_loop');
    expect(msg).toContain('Click Update in Settings');
    expect(engineTooOld('CUDA error: out of memory', 'X')).toBeNull();
  });
});

// ── The engine manager with a stand-in llama-server ─────────────────────────────────────────────────

const FAKES = resolve(import.meta.dir, 'fake-engines');

describe.skipIf(process.platform === 'win32')('starting Inkling 2 Mini on the built-in engine', () => {
  function setup(gpu: { usedMb: number; totalMb: number }, fails = false) {
    const studio = tmp('studio');
    const argsLog = join(studio, 'args.log');
    const bin = join(studio, 'Engines', 'llama.cpp', 'b200');
    mkdirSync(bin, { recursive: true });
    const exe = join(bin, 'llama-server');
    const run = fails
      ? `if [ "$1" = "--help" ]; then echo "  --n-cpu-moe N"; exit 0; fi\necho "llama_model_load: error loading model architecture: unknown model architecture: 'inkling2_loop'" >&2\nexit 1\n`
      : `exec "${process.execPath}" "${join(FAKES, 'fake-llama.ts')}" "$@"\n`;
    writeFileSync(exe, `#!/bin/sh\necho "$@" >> "${argsLog}"\n${run}`);
    chmodSync(exe, 0o755);
    writeFileSync(join(studio, 'Engines', 'builtin.json'), JSON.stringify({ llama: { tag: 'b200', flavour: 'cpu', dir: bin, exes: { 'llama-server': exe }, installedAt: 1 } }));
    mkdirSync(join(studio, 'Models', 'chat', 'inkling-2-mini'), { recursive: true });
    writeGguf(join(studio, 'Models', 'chat', 'inkling-2-mini', 'Inkling-2-Mini-IQ4_NL.gguf'), inklingKv, inklingTensors());
    writeFileSync(join(studio, 'Models', 'models.json'), JSON.stringify({ version: 1, installed: { 'inkling-2-mini': { id: 'inkling-2-mini', kind: 'chat', title: 'Inkling 2 Mini', files: ['chat/inkling-2-mini/Inkling-2-Mini-IQ4_NL.gguf'], gguf: 'chat/inkling-2-mini/Inkling-2-Mini-IQ4_NL.gguf', bytes: 1, at: 1 } } }));
    const kv: Record<string, string> = { 'lotus.settings.v1': JSON.stringify({ vramReserveMb: 1024 }) };
    const b = new Builtins({ studio, broadcast: () => undefined, kvGet: (k) => kv[k] ?? null, kvSet: (k, v) => { kv[k] = v; }, gpuMemory: async () => ({ ...gpu }) });
    const launches = () => readFileSync(argsLog, 'utf8').split('\n').filter((l) => l.includes('--port'));
    return { b, launches };
  }

  test('RTX 4060 (8 GB): Auto starts it with 32K context and --n-cpu-moe, and reuses that server next time', async () => {
    const t = setup({ usedMb: 500, totalMb: 8188 });
    await t.b.ensureChat('inkling-2-mini', { auto: true });
    const [line] = t.launches();
    expect(line).toContain(`-c ${MOE_SPLIT_CTX}`);
    const n = Number(/--n-cpu-moe (\d+)/.exec(line)?.[1]);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(LAYERS);
    const st = t.b.chatStatus();
    expect(st.fit?.moe?.cpuLayers).toBe(n);
    // What the server holds on the card is the part that stays there, not the whole 17 GB file.
    expect(st.memMb).toBeLessThan(8188);
    // Asking again doesn't restart it.
    await t.b.ensureChat('inkling-2-mini', { auto: true });
    expect(t.launches().length).toBe(1);
    t.b.stopChat();
  }, 20_000);

  test('a 48 GB card runs it whole: no --n-cpu-moe', async () => {
    const t = setup({ usedMb: 500, totalMb: 49152 });
    await t.b.ensureChat('inkling-2-mini', { auto: true });
    expect(t.launches()[0]).not.toContain('--n-cpu-moe');
    t.b.stopChat();
  }, 20_000);

  test('an engine without Inkling support: the error says to update llama.cpp', async () => {
    const t = setup({ usedMb: 500, totalMb: 8188 }, true);
    await expect(t.b.ensureChat('inkling-2-mini', { auto: true })).rejects.toThrow(/needs a newer llama\.cpp than the one installed \(b200\)/);
    expect(t.b.chatStatus().state).toBe('error');
  }, 20_000);
});
