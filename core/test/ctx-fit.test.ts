// 0.15.1: the built-in chat engine sizes its context to the video memory that is free, instead of
// starting llama-server with up to 64K and letting llama.cpp push layers onto the CPU (Gemma 12B on an
// 8 GB RTX 4060 ran at about 10 tokens/s).

import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ggufInfo, readGgufInfo, readGgufMeta } from '../src/engines/gguf';
import { fitChatCtx, MB } from '../src/engines/chatFit';
import { Builtins, MAX_CHAT_CTX, MIN_CHAT_CTX } from '../src/engines/manager';

const dirs: string[] = [];
const tmp = (tag: string) => { const d = mkdtempSync(join(tmpdir(), `lotus-ctxfit-${tag}-`)); dirs.push(d); return d; };
// Windows keeps an open database file locked, so a leftover temp folder is not an error.
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows */ } } });

// ── A small GGUF writer (metadata only; the tensor count is 0) ──────────────────────────────────────
type V = { t: 'u32'; v: number } | { t: 'str'; v: string } | { t: 'f32'; v: number } | { t: 'arr-u32'; v: number[] } | { t: 'arr-bool'; v: boolean[] } | { t: 'arr-str'; v: string[] } | { t: 'bool'; v: boolean };
function gguf(kv: Record<string, V>): Buffer {
  const parts: Buffer[] = [];
  const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); parts.push(b); };
  const u64 = (n: number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); parts.push(b); };
  const str = (s: string) => { const b = Buffer.from(s, 'utf8'); u64(b.length); parts.push(b); };
  u32(0x46554747); u32(3); u64(0); u64(Object.keys(kv).length);
  for (const [k, val] of Object.entries(kv)) {
    str(k);
    switch (val.t) {
      case 'u32': u32(4); u32(val.v); break;
      case 'f32': { u32(6); const b = Buffer.alloc(4); b.writeFloatLE(val.v); parts.push(b); break; }
      case 'bool': u32(7); parts.push(Buffer.from([val.v ? 1 : 0])); break;
      case 'str': u32(8); str(val.v); break;
      case 'arr-u32': u32(9); u32(4); u64(val.v.length); val.v.forEach(u32); break;
      case 'arr-bool': u32(9); u32(7); u64(val.v.length); parts.push(Buffer.from(val.v.map((x) => (x ? 1 : 0)))); break;
      case 'arr-str': u32(9); u32(8); u64(val.v.length); val.v.forEach(str); break;
    }
  }
  return Buffer.concat(parts);
}
const u = (v: number): V => ({ t: 'u32', v });
const s = (v: string): V => ({ t: 'str', v });

/** Llama 3.1 8B's shape: 32 layers, 8 KV heads of 128, 128K vocabulary. */
const llama8b = (extra: Record<string, V> = {}) => gguf({
  'general.architecture': s('llama'), 'general.name': s('Llama 3.1 8B'),
  'llama.block_count': u(32), 'llama.context_length': u(131072), 'llama.embedding_length': u(4096),
  'llama.attention.head_count': u(32), 'llama.attention.head_count_kv': u(8),
  'tokenizer.ggml.model': s('gpt2'),
  // A long word list (several MB), like a real tokenizer, read across buffer refills.
  'tokenizer.ggml.tokens': { t: 'arr-str', v: Array.from({ length: 128256 }, (_, i) => `tok${i}-${'x'.repeat(i % 40)}`) },
  'tokenizer.chat_template': s('{% for m in messages %}{{ m.content }}{% endfor %}'),
  ...extra,
});

describe('reading a GGUF header', () => {
  test('a Llama-style model: KV bytes per token, trained context and vocabulary', () => {
    const dir = tmp('gguf');
    const p = join(dir, 'llama.gguf');
    writeFileSync(p, llama8b());
    const meta = readGgufMeta(p);
    expect(meta.get('general.name')).toBe('Llama 3.1 8B');
    const info = readGgufInfo(p)!;
    // 32 layers × 8 heads × (128 + 128) × 2 bytes = 128 KB per token.
    expect(info).toMatchObject({ arch: 'llama', layers: 32, ctxTrain: 131072, vocab: 128256, kvFullBytes: 131072, kvSwaBytes: 0, swaWindow: 0 });
  });

  test('Gemma 3: five of every six layers only keep a 1,024-token window', () => {
    const meta = readGgufMeta(writeTmp(gguf({
      'general.architecture': s('gemma3'), 'gemma3.block_count': u(48), 'gemma3.context_length': u(131072), 'gemma3.embedding_length': u(3840),
      'gemma3.attention.head_count': u(16), 'gemma3.attention.head_count_kv': u(8), 'gemma3.attention.key_length': u(256), 'gemma3.attention.value_length': u(256),
      'gemma3.attention.sliding_window': u(1024),
    })));
    const info = ggufInfo(meta)!;
    const perLayer = 8 * 512 * 2;
    expect(info.kvFullBytes).toBe(8 * perLayer);
    expect(info.kvSwaBytes).toBe(40 * perLayer);
    expect(info.swaWindow).toBe(1024);
  });

  test('Gemma 4 style: the pattern spelled out per layer, separate window head sizes, shared KV layers', () => {
    const pattern = Array.from({ length: 30 }, (_, i) => i % 6 !== 5);
    const info = ggufInfo(readGgufMeta(writeTmp(gguf({
      'general.architecture': s('gemma4'), 'gemma4.block_count': u(30), 'gemma4.context_length': u(262144), 'gemma4.embedding_length': u(2816),
      'gemma4.attention.head_count': u(16), 'gemma4.attention.head_count_kv': u(8), 'gemma4.attention.key_length': u(512), 'gemma4.attention.value_length': u(512),
      'gemma4.attention.key_length_swa': u(256), 'gemma4.attention.value_length_swa': u(256), 'gemma4.attention.sliding_window': u(1024),
      'gemma4.attention.sliding_window_pattern': { t: 'arr-bool', v: pattern }, 'gemma4.attention.shared_kv_layers': u(6),
    }))))!;
    // Layers 0–23 keep a cache: 4 full (5, 11, 17, 23) and 20 windowed.
    expect(info.kvFullBytes).toBe(4 * 8 * 1024 * 2);
    expect(info.kvSwaBytes).toBe(20 * 8 * 512 * 2);
  });

  test('a hybrid model: layers with no KV heads (Mamba-style) keep no cache', () => {
    const kvHeads = Array.from({ length: 12 }, (_, i) => (i % 4 === 3 ? 8 : 0));
    const info = ggufInfo(readGgufMeta(writeTmp(gguf({
      'general.architecture': s('nemotron_h'), 'nemotron_h.block_count': u(12), 'nemotron_h.embedding_length': u(2048),
      'nemotron_h.attention.head_count': u(16), 'nemotron_h.attention.head_count_kv': { t: 'arr-u32', v: kvHeads }, 'nemotron_h.attention.key_length': u(128),
    }))))!;
    expect(info.kvFullBytes).toBe(3 * 8 * 256 * 2);
  });

  test('anything that is not GGUF gives null instead of throwing', () => {
    expect(readGgufInfo(writeTmp(Buffer.from('GGUFmodel')))).toBeNull();
    expect(readGgufInfo(writeTmp(Buffer.from('not a model at all')))).toBeNull();
    expect(readGgufInfo(join(tmp('none'), 'missing.gguf'))).toBeNull();
  });
});

function writeTmp(b: Buffer): string { const p = join(tmp('f'), 'm.gguf'); writeFileSync(p, b); return p; }

describe('picking the context', () => {
  const llama = { arch: 'llama', layers: 32, ctxTrain: 131072, vocab: 128256, kvFullBytes: 131072, kvSwaBytes: 0, swaWindow: 0 };
  const base = { min: MIN_CHAT_CTX, max: MAX_CHAT_CTX, hasVision: false };

  test('8 GB card, 7.3 GB of weights (a 12B model): the smallest context, and it says it does not fit', () => {
    const f = fitChatCtx({ ...base, info: { ...llama, layers: 48, kvFullBytes: 48 * 8 * 256 * 2, vocab: 262144 }, weightsMb: 7300, budgetMb: 8188 - 600 - 1024 });
    expect(f.ctx).toBe(MIN_CHAT_CTX);
    expect(f.fits).toBe(false);
  });

  test('8 GB card, Llama 8B at 4.9 GB: a context that fits next to the weights, well under 64K', () => {
    const budget = 8188 - 600 - 1024;
    const f = fitChatCtx({ ...base, info: llama, weightsMb: 4900, budgetMb: budget });
    expect(f.fits).toBe(true);
    expect(f.ctx).toBeGreaterThanOrEqual(8192);
    expect(f.ctx).toBeLessThanOrEqual(16384);
    expect(f.baseMb + (f.ctx * llama.kvFullBytes * 1.05) / MB).toBeLessThanOrEqual(budget);
  });

  test('a sliding-window model gets far more context in the same memory', () => {
    const gemma = { arch: 'gemma3', layers: 48, ctxTrain: 131072, vocab: 262144, kvFullBytes: 8 * 8192, kvSwaBytes: 40 * 8192, swaWindow: 1024 };
    const full = fitChatCtx({ ...base, info: { ...gemma, kvFullBytes: 48 * 8192, kvSwaBytes: 0, swaWindow: 0 }, weightsMb: 2500, budgetMb: 6500 });
    const swa = fitChatCtx({ ...base, info: gemma, weightsMb: 2500, budgetMb: 6500 });
    expect(swa.ctx).toBeGreaterThan(full.ctx * 3);
  });

  test('a big card stops at 64K, and never above what the model was trained for', () => {
    expect(fitChatCtx({ ...base, info: llama, weightsMb: 4900, budgetMb: 23000 }).ctx).toBe(MAX_CHAT_CTX);
    expect(fitChatCtx({ ...base, info: { ...llama, ctxTrain: 32768 }, weightsMb: 4900, budgetMb: 23000 }).ctx).toBe(32768);
  });

  test('nothing measured: 16K, as modest as before', () => {
    const f = fitChatCtx({ ...base, info: llama, weightsMb: 4900, budgetMb: null });
    expect(f).toMatchObject({ ctx: 16384, measured: false });
  });

  test('unreadable model file: KV estimated from the file size, still within the limits', () => {
    const f = fitChatCtx({ ...base, info: null, weightsMb: 4900, budgetMb: 6500 });
    expect(f.ctx).toBeGreaterThanOrEqual(MIN_CHAT_CTX);
    expect(f.ctx).toBeLessThan(MAX_CHAT_CTX);
  });
});

// ── The engine manager with a stand-in llama-server ─────────────────────────────────────────────────

const FAKES = resolve(import.meta.dir, 'fake-engines');

describe.skipIf(process.platform === 'win32')('starting the built-in chat engine', () => {
  function setup(gpu: { usedMb: number; totalMb: number }, settings: Record<string, unknown> = {}) {
    const studio = tmp('studio');
    const argsLog = join(studio, 'args.log');
    const bin = join(studio, 'Engines', 'llama.cpp', 'b200');
    mkdirSync(bin, { recursive: true });
    const exe = join(bin, 'llama-server');
    writeFileSync(exe, `#!/bin/sh\necho "$@" >> "${argsLog}"\nexec "${process.execPath}" "${join(FAKES, 'fake-llama.ts')}" "$@"\n`);
    chmodSync(exe, 0o755);
    writeFileSync(join(studio, 'Engines', 'builtin.json'), JSON.stringify({ llama: { tag: 'b200', flavour: 'cpu', dir: bin, exes: { 'llama-server': exe }, installedAt: 1 } }));
    mkdirSync(join(studio, 'Models', 'chat'), { recursive: true });
    writeFileSync(join(studio, 'Models', 'chat', 'llama.gguf'), llama8b());
    writeFileSync(join(studio, 'Models', 'models.json'), JSON.stringify({ version: 1, installed: { 'llama-8b': { id: 'llama-8b', kind: 'chat', title: 'Llama 8B', files: ['chat/llama.gguf'], gguf: 'chat/llama.gguf', bytes: 1, at: 1 } } }));
    const kv: Record<string, string> = { 'lotus.settings.v1': JSON.stringify({ vramReserveMb: 1024, ...settings }) };
    const reading = { ...gpu };
    const b = new Builtins({ studio, broadcast: () => undefined, kvGet: (k) => kv[k] ?? null, kvSet: (k, v) => { kv[k] = v; }, gpuMemory: async () => ({ ...reading }) });
    const ctxArgs = () => readFileSync(argsLog, 'utf8').split('\n').filter((l) => l.includes('--port')).map((l) => Number(/-c (\d+)/.exec(l)?.[1]));
    return { b, reading, ctxArgs };
  }

  test('Auto starts llama-server with the context that fits the free video memory', async () => {
    // A 24 GB card with 1 GB in use: the tiny test model fits 64K easily.
    const big = setup({ usedMb: 1000, totalMb: 24000 });
    await big.b.ensureChat('llama-8b', { auto: true });
    expect(big.ctxArgs()).toEqual([MAX_CHAT_CTX]);
    expect(big.b.chatStatus()).toMatchObject({ state: 'ready', ctx: MAX_CHAT_CTX, auto: true });
    big.b.stopChat();

    // Only 3 GB free: 3000 − 1024 reserve − ~550 MB overhead leaves room for about 11K tokens at 128 KB each.
    const small = setup({ usedMb: 5188, totalMb: 8188 });
    await small.b.ensureChat('llama-8b', { auto: true });
    const [ctx] = small.ctxArgs();
    expect(ctx).toBeGreaterThanOrEqual(MIN_CHAT_CTX);
    expect(ctx).toBeLessThan(16384);
    expect(small.b.chatStatus().fit?.fits).toBe(true);
    small.b.stopChat();
  }, 20_000);

  test('a server started by hand at 64K is restarted at the size that fits; a grown one is kept', async () => {
    const t = setup({ usedMb: 5188, totalMb: 8188 });
    await t.b.ensureChat('llama-8b', { ctx: 65536 });
    // The running server holds its own estimate; the reading includes it.
    t.reading.usedMb += t.b.chatStatus().memMb ?? 0;
    await t.b.ensureChat('llama-8b', { auto: true });
    const [first, second] = t.ctxArgs();
    expect(first).toBe(65536);
    expect(second).toBeLessThan(16384);

    // A long conversation grows it; the next Auto request keeps it instead of shrinking it again.
    await t.b.ensureChat('llama-8b', { ctx: 24576, grow: true });
    await t.b.ensureChat('llama-8b', { auto: true });
    expect(t.ctxArgs()).toEqual([65536, second, 24576]);
    t.b.stopChat();
  }, 30_000);
});

// ── A shorter system prompt for everyday messages ───────────────────────────────────────────────────

describe('trimming the chat prompt', () => {
  test('install instructions only go with messages about getting a model', async () => {
    const { wantsInstall } = await import('../../src/chat/promptParts');
    for (const q of ['Install Gemma 4 for me', 'can you download a voice model?', 'Which model should I use for coding?', 'pull qwen3:8b', 'set up Flux', ''])
      expect([q, wantsInstall(q)]).toEqual([q, true]);
    for (const q of ['hi', 'What is the capital of France?', 'Write a haiku about rain', 'Summarise this file'])
      expect([q, wantsInstall(q)]).toEqual([q, false]);
  });

  test('image instructions only go with messages about pictures, or right after an image card', async () => {
    const { wantsImage } = await import('../../src/chat/promptParts');
    for (const q of ['Draw a cat in space', 'make me a logo for my bakery', 'Write a prompt for a sunset photo', 'generate a wallpaper', ''])
      expect([q, wantsImage(q)]).toEqual([q, true]);
    for (const q of ['hi', 'What is the capital of France?', 'Explain quantum tunnelling simply'])
      expect([q, wantsImage(q)]).toEqual([q, false]);
    expect(wantsImage('make it bluer', 'Here you go.\n```image\n{"prompt":"a cat"}\n```')).toBe(true);
  });

  test('the face designer only joins chats that talk about faces; Work always has it', async () => {
    const { openDb } = await import('../src/db');
    const { AgentService } = await import('../src/agent/service');
    const svc = new AgentService({ db: openDb(tmp('gate')), studio: tmp('gate-s'), broadcast: () => undefined });
    const names = (a: { prompt?: string; workId?: string; memoryOn?: boolean }) => svc.toolsFor(a).map((t) => t.name);
    expect(names({ prompt: 'hi' })).not.toContain('avatar.create');
    expect(names({ prompt: 'Design an avatar for my assistant' })).toContain('avatar.create');
    expect(names({ workId: 'w1', prompt: 'compare keyboards' })).toContain('avatar.create');
    expect(names({ prompt: 'hi', memoryOn: true })).toEqual(expect.arrayContaining(['task.add', 'files.read', 'memory.save']));
  });
});
