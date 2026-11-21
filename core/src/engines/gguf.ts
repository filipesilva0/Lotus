// Reads the few facts the context sizer needs from a GGUF model file's header: how many layers keep a
// KV cache, how wide each one is, which layers use a sliding window, the trained context and the
// vocabulary size. Only the metadata at the start of the file is read (a few MB at most, mostly the
// tokenizer's word list, which is skipped); the weights are never touched.
//
// Format: https://github.com/ggml-org/ggml/blob/master/docs/gguf.md

import { closeSync, openSync, readSync } from 'node:fs';

export interface GgufInfo {
  arch: string;
  layers: number;
  ctxTrain: number;
  vocab: number;
  /** KV-cache bytes per token of context for the layers that attend to the whole context (f16 cache). */
  kvFullBytes: number;
  /** KV-cache bytes per cached token for sliding-window layers (they keep at most `swaWindow` tokens). */
  kvSwaBytes: number;
  swaWindow: number;
}

type Val = number | bigint | string | boolean | Val[] | { skipped: number };

const T = { U8: 0, I8: 1, U16: 2, I16: 3, U32: 4, I32: 5, F32: 6, BOOL: 7, STRING: 8, ARRAY: 9, U64: 10, I64: 11, F64: 12 } as const;
const SIZE: Record<number, number> = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };

/** Buffered forward-only reader over a file descriptor. */
class Reader {
  private buf = Buffer.alloc(0);
  private at = 0;
  private fileAt = 0;
  constructor(private fd: number) {}
  private need(n: number) {
    if (this.buf.length - this.at >= n) return;
    const keep = this.buf.subarray(this.at);
    const chunk = Buffer.alloc(Math.max(n - keep.length, 1 << 20));
    const got = readSync(this.fd, chunk, 0, chunk.length, this.fileAt);
    this.fileAt += got;
    this.buf = Buffer.concat([keep, chunk.subarray(0, got)]);
    this.at = 0;
    if (this.buf.length < n) throw new Error('GGUF header ends early');
  }
  skip(n: number) {
    const inBuf = this.buf.length - this.at;
    if (n <= inBuf) { this.at += n; return; }
    this.fileAt += n - inBuf;
    this.buf = Buffer.alloc(0); this.at = 0;
  }
  u32() { this.need(4); const v = this.buf.readUInt32LE(this.at); this.at += 4; return v; }
  u64() { this.need(8); const v = this.buf.readBigUInt64LE(this.at); this.at += 8; return v; }
  scalar(t: number): number | bigint | boolean {
    const n = SIZE[t];
    if (!n) throw new Error(`GGUF: unknown value type ${t}`);
    this.need(n);
    const b = this.buf, o = this.at;
    this.at += n;
    switch (t) {
      case T.U8: return b.readUInt8(o);
      case T.I8: return b.readInt8(o);
      case T.U16: return b.readUInt16LE(o);
      case T.I16: return b.readInt16LE(o);
      case T.U32: return b.readUInt32LE(o);
      case T.I32: return b.readInt32LE(o);
      case T.F32: return b.readFloatLE(o);
      case T.BOOL: return b.readUInt8(o) !== 0;
      case T.U64: return b.readBigUInt64LE(o);
      case T.I64: return b.readBigInt64LE(o);
      default: return b.readDoubleLE(o);
    }
  }
  str(): string {
    const n = Number(this.u64());
    if (n > 1 << 20) throw new Error('GGUF: string too long');
    this.need(n);
    const s = this.buf.toString('utf8', this.at, this.at + n);
    this.at += n;
    return s;
  }
  skipStr() { this.skip(Number(this.u64())); }
  /** A value; arrays longer than `keep` items are skipped and only their length is kept. */
  value(t: number, keep: boolean): Val {
    if (t === T.STRING) { if (keep) return this.str(); this.skipStr(); return ''; }
    if (t !== T.ARRAY) return this.scalar(t);
    const it = this.u32();
    const count = Number(this.u64());
    if (!keep || count > 4096) {
      if (it === T.STRING) for (let i = 0; i < count; i++) this.skipStr();
      else if (SIZE[it]) this.skip(SIZE[it] * count);
      else for (let i = 0; i < count; i++) this.value(it, false);
      return { skipped: count };
    }
    const out: Val[] = [];
    for (let i = 0; i < count; i++) out.push(this.value(it, true));
    return out;
  }
}

/** The metadata key/value pairs of a GGUF file (large arrays such as the tokenizer's are reduced to their length). */
export function readGgufMeta(path: string): Map<string, Val> {
  const fd = openSync(path, 'r');
  try {
    const r = new Reader(fd);
    if (r.u32() !== 0x46554747) throw new Error('Not a GGUF file');
    const version = r.u32();
    if (version < 2) throw new Error('GGUF version 1 is not supported');
    r.u64(); // tensor count
    const kvCount = Number(r.u64());
    const meta = new Map<string, Val>();
    for (let i = 0; i < kvCount; i++) {
      const key = r.str();
      const t = r.u32();
      // Strings are kept except for long chat templates; nothing here needs them.
      const keep = !key.startsWith('tokenizer.') || key === 'tokenizer.ggml.tokens';
      meta.set(key, r.value(t, keep && key !== 'tokenizer.chat_template'));
    }
    return meta;
  } finally { closeSync(fd); }
}

const toNum = (v: Val | undefined): number => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : typeof v === 'boolean' ? Number(v) : 0);

/**
 * Sliding-window layer patterns llama.cpp uses when the file doesn't spell them out
 * (src/models/*.cpp, load_swa_pattern): every n-th layer attends to the whole context.
 */
const SWA_PATTERN: Record<string, { n: number; denseFirst?: boolean }> = {
  gemma2: { n: 2 }, gemma3: { n: 6 }, gemma3n: { n: 5 }, 'gemma-embedding': { n: 6 }, cohere2: { n: 4 }, cohere2moe: { n: 4, denseFirst: true },
  'gpt-oss': { n: 2 }, exaone4: { n: 4 }, olmo2: { n: 4 }, llama4: { n: 4 }, smallthinker: { n: 4, denseFirst: true },
};

/** Works out KV-cache sizes from the metadata. Null when the file doesn't describe its attention. */
export function ggufInfo(meta: Map<string, Val>): GgufInfo | null {
  const arch = String(meta.get('general.architecture') ?? '');
  if (!arch) return null;
  const k = (name: string) => meta.get(`${arch}.${name}`);
  const layersAll = toNum(k('block_count'));
  if (!layersAll) return null;
  const perLayer = (v: Val | undefined, fallback: number): number[] => {
    if (Array.isArray(v)) return Array.from({ length: layersAll }, (_, i) => toNum(v[i]));
    const n = v === undefined ? fallback : toNum(v);
    return Array(layersAll).fill(n);
  };
  const heads = perLayer(k('attention.head_count'), 0);
  const kvHeads = perLayer(k('attention.head_count_kv'), NaN).map((v, i) => (Number.isNaN(v) ? heads[i] : v));
  const embed = toNum(k('embedding_length'));
  const headDim = embed && heads[0] ? embed / heads[0] : 0;
  const keyLen = toNum(k('attention.key_length')) || headDim;
  const valLen = toNum(k('attention.value_length')) || keyLen;
  if (!keyLen || !kvHeads.some((h) => h > 0)) return null;
  const keySwa = toNum(k('attention.key_length_swa')) || keyLen;
  const valSwa = toNum(k('attention.value_length_swa')) || valLen;
  const window = toNum(k('attention.sliding_window'));

  // Which layers use the sliding window.
  const swa: boolean[] = Array(layersAll).fill(false);
  if (window > 0) {
    const pat = k('attention.sliding_window_pattern');
    if (Array.isArray(pat)) pat.forEach((v, i) => { if (i < layersAll) swa[i] = !!toNum(v); });
    else {
      const known = SWA_PATTERN[arch];
      const n = pat !== undefined && !(typeof pat === 'object') ? toNum(pat) : known?.n ?? -1;
      // Unknown pattern: count every layer as full (never underestimates memory).
      if (n >= 0) for (let i = 0; i < layersAll; i++) swa[i] = n === 0 || (known?.denseFirst ? i % n !== 0 : i % n < n - 1);
    }
  }
  // Gemma 3n/4: the last layers reuse earlier layers' cache and keep none of their own.
  const shared = toNum(k('attention.shared_kv_layers'));
  const withCache = Math.max(1, layersAll - shared);

  let full = 0, slid = 0;
  for (let i = 0; i < withCache; i++) {
    if (!kvHeads[i]) continue; // recurrent (Mamba-style) layers keep no KV cache
    if (swa[i]) slid += kvHeads[i] * (keySwa + valSwa);
    else full += kvHeads[i] * (keyLen + valLen);
  }
  const tokens = meta.get('tokenizer.ggml.tokens');
  const vocab = toNum(k('vocab_size')) || (Array.isArray(tokens) ? tokens.length : tokens && typeof tokens === 'object' ? (tokens as { skipped: number }).skipped : 0);
  return { arch, layers: layersAll, ctxTrain: toNum(k('context_length')), vocab, kvFullBytes: full * 2, kvSwaBytes: slid * 2, swaWindow: slid ? window : 0 };
}

const cache = new Map<string, GgufInfo | null>();
/** Cached per file path; null when the file can't be read as GGUF. */
export function readGgufInfo(path: string): GgufInfo | null {
  if (cache.has(path)) return cache.get(path)!;
  let info: GgufInfo | null = null;
  try { info = ggufInfo(readGgufMeta(path)); } catch { info = null; }
  cache.set(path, info);
  return info;
}
