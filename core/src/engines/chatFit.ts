// Sizes the built-in chat engine's context window to the memory it can really use (0.15.1).
//
// Before, Lotus started llama-server with whatever context was asked for (up to 64K). On an 8 GB card
// the KV cache for that context doesn't fit next to a 12B model, so llama.cpp moved layers to the CPU
// and replies crawled (about 10 tokens/s). Now the context is the largest that fits next to the
// weights in the memory that is free, and never below MIN_CHAT_CTX (Lotus's own prompt needs that).
//
// The maths:
//   weights      ≈ size of the model file (+ the vision projector)
//   overhead     ≈ 300 MB driver context + the output buffer (vocabulary × 512-token batch × 4 bytes)
//   KV cache     = full-attention bytes/token × context + sliding-window bytes/token × min(context, window + 512)
// Pure function only; the measuring happens in manager.ts.

import type { GgufInfo } from './gguf';

export const MB = 1024 * 1024;
/** Context sizes are picked in steps of this many tokens. */
export const CTX_STEP = 4096;
/** llama-server's default batch, which sliding-window caches keep on top of the window. */
const UBATCH = 512;

export interface FitInput {
  info: GgufInfo | null;
  /** Model file plus vision projector, in MB. */
  weightsMb: number;
  hasVision: boolean;
  /** Memory the model may use (video memory free for it, minus the reserve), in MB. Null when unknown. */
  budgetMb: number | null;
  min: number;
  max: number;
}

export interface ChatFit {
  ctx: number;
  /** True when the weights and this context fit in the budget (no layers on the CPU). */
  fits: boolean;
  budgetMb: number | null;
  /** Weights + overhead, in MB. */
  baseMb: number;
  /** KV cache at `ctx`, in MB. */
  kvMb: number;
  /** KV bytes per extra token of context (full-attention layers). */
  kvPerToken: number;
  measured: boolean;
  /** Mixture-of-experts model split between the card and system memory (planMoe); `ctx` and `fits` follow it. */
  moe?: MoePlan;
}

/** Fallback when the file's metadata can't be read: modern models use roughly 16 KB per token per billion parameters. */
export function estimateKvPerToken(weightsMb: number): number {
  const paramsB = weightsMb / 600; // ~4.7 bits per weight
  return Math.round(Math.min(320 * 1024, Math.max(24 * 1024, paramsB * 16 * 1024)));
}

export function kvBytes(info: Pick<GgufInfo, 'kvFullBytes' | 'kvSwaBytes' | 'swaWindow'>, ctx: number): number {
  return info.kvFullBytes * ctx + info.kvSwaBytes * Math.min(ctx, info.swaWindow + UBATCH);
}

export function overheadMb(info: GgufInfo | null, hasVision: boolean): number {
  const vocab = info?.vocab || 128_000;
  return Math.round(300 + (vocab * UBATCH * 4) / MB + (hasVision ? 256 : 0));
}

/** Memory a llama-server with this model and context holds, in MB (estimate). */
export function memoryMb(info: GgufInfo | null, weightsMb: number, hasVision: boolean, ctx: number): number {
  const kv = info ?? { kvFullBytes: estimateKvPerToken(weightsMb), kvSwaBytes: 0, swaWindow: 0 };
  return Math.round(weightsMb + overheadMb(info, hasVision) + kvBytes(kv, ctx) / MB);
}

export function fitChatCtx(i: FitInput): ChatFit {
  const kv = i.info ?? { kvFullBytes: estimateKvPerToken(i.weightsMb), kvSwaBytes: 0, swaWindow: 0 };
  const max = Math.max(i.min, i.info?.ctxTrain ? Math.min(i.max, i.info.ctxTrain) : i.max);
  const baseMb = Math.round(i.weightsMb + overheadMb(i.info, i.hasVision));
  const need = (ctx: number) => baseMb + (kvBytes(kv, ctx) * 1.05) / MB;
  if (i.budgetMb === null) {
    // Nothing measured: stay modest, the way Lotus started before it measured anything.
    const ctx = Math.min(max, Math.max(i.min, 16384));
    return { ctx, fits: true, budgetMb: null, baseMb, kvMb: Math.round(kvBytes(kv, ctx) / MB), kvPerToken: kv.kvFullBytes, measured: false };
  }
  let ctx = i.min;
  for (let c = i.min; c <= max; c += CTX_STEP) if (need(c) <= i.budgetMb) ctx = c;
  // The model's own maximum may not be a whole step.
  if (max % CTX_STEP && need(max) <= i.budgetMb) ctx = max;
  return { ctx, fits: need(ctx) <= i.budgetMb, budgetMb: Math.round(i.budgetMb), baseMb, kvMb: Math.round(kvBytes(kv, ctx) / MB), kvPerToken: kv.kvFullBytes, measured: true };
}

// ── Mixture-of-experts models bigger than the graphics card (0.21.0) ─────────
//
// A mixture-of-experts model (gpt-oss, Qwen 3 30B A3B, Gemma 4 26B A4B, Inkling 2 Mini…) only uses a
// few of its experts for each word. When the whole file doesn't fit in video memory, the fastest way
// to run it is to keep the attention, the shared weights and the context on the graphics card and the
// expert weights of the first N layers in system memory (llama.cpp's --n-cpu-moe N): the processor
// then reads only the few experts each word picks. Moving whole layers to the processor instead (what
// llama.cpp does with an explicit context and no --n-cpu-moe) runs every part of those layers there
// and is several times slower.

/** Context a model split this way gets: plenty for chat and Work, small enough to leave room for experts. */
export const MOE_SPLIT_CTX = 32768;

export interface MoePlan {
  /** Layers whose experts stay in system memory (--n-cpu-moe). */
  cpuLayers: number;
  ctx: number;
  /** Expert weights in system memory, in MB. */
  cpuMb: number;
  /** What stays on the graphics card (weights + context), in MB. */
  gpuMb: number;
  /** False when even with every expert in system memory the rest is bigger than the card. */
  fits: boolean;
}

/**
 * How to split a mixture-of-experts model that doesn't fit the card. Null when the model fits as it
 * is, isn't a mixture of experts, or the card's free memory is unknown.
 */
export function planMoe(i: FitInput): MoePlan | null {
  const experts = i.info?.expertBytes ?? [];
  if (!i.info || !experts.length || i.budgetMb === null) return null;
  // A model that fits the card whole stays whole: every expert on the card is fastest.
  if (fitChatCtx(i).fits) return null;
  const expertMb = experts.map((b) => b / MB);
  const allMb = expertMb.reduce((s, b) => s + b, 0);
  // The context first: what fits with every expert moved out, capped at MOE_SPLIT_CTX.
  const rest = fitChatCtx({ ...i, weightsMb: Math.max(0, i.weightsMb - allMb), max: Math.min(i.max, MOE_SPLIT_CTX) });
  const ctx = rest.ctx;
  const need = i.weightsMb + overheadMb(i.info, i.hasVision) + (kvBytes(i.info, ctx) * 1.05) / MB;
  // Then as few layers' experts in system memory as possible: the fewer there, the faster each word.
  let cpuLayers = 0, moved = 0;
  while (cpuLayers < expertMb.length && need - moved > i.budgetMb) moved += expertMb[cpuLayers++];
  // (llama.cpp counts layers from the first; a dense layer adds nothing here but still counts.)
  return { cpuLayers, ctx, cpuMb: Math.round(moved), gpuMb: Math.round(need - moved), fits: need - moved <= i.budgetMb };
}
