// VRAM auto-scaling: turns a live memory reading plus what we know about the loaded model into
// concrete limits: context window, chunk size for mounted files, how many background agents may
// run at once, and which model size fits. Pure functions only (unit-tested in handover/verification).
//
// The maths, in short:
//   KV cache per token  = 2 (K and V) × layers × kv_heads × head_dim × 2 bytes (f16)
//   (read from Ollama's /api/show model_info; estimated from the parameter count when missing)
//   main model needs    = weights + runtime overhead + KV(num_ctx)
//   each extra parallel request needs another KV(num_ctx) on the same loaded weights.
// Background agents always use the SAME model and num_ctx as chat: Ollama reloads a model whenever
// num_ctx changes, and loading a second model next to the first is the usual way to run out of memory.
// More requests than the server has slots simply queue, so "1" is always safe.

export interface GpuReading {
  name: string;
  totalMb: number;
  usedMb: number;
  freeMb: number;
}

export interface HardwareReading {
  /** Where the numbers came from; 'none' = nothing measured. */
  source: 'nvidia-smi' | 'amdgpu-sysfs' | 'windows-counters' | 'comfyui' | 'none';
  gpu: GpuReading | null;
  ramTotalMb: number;
  ramFreeMb: number;
  at: number;
}

export interface ModelProfile {
  name: string;
  /** Size of the weights file(s) in MB (≈ what the weights occupy in video memory). */
  weightsMb: number;
  /** Video memory this model holds right now, if loaded (Ollama /api/ps size_vram). */
  loadedVramMb: number;
  /** Longest context the model was trained for (model_info *.context_length), 0 if unknown. */
  contextMax: number;
  /** KV-cache bytes per token; measured from model metadata or estimated. */
  kvBytesPerToken: number;
  kvMeasured: boolean;
  paramsB: number;
}

export interface LlamaCppProps {
  /** Total context the server was started with (-c), shared by its slots. */
  nCtx: number;
  slots: number;
}

export interface ScaleInput {
  hw: HardwareReading | null;
  model: ModelProfile | null;
  reserveMb: number;
  maxSubagents: number;
  /** The user's manual context setting (used when nothing is measured or scaling is off). */
  manualCtx: number;
  autoScale: boolean;
  backend: 'ollama' | 'llamacpp';
  llamacpp?: LlamaCppProps | null;
}

export type Fit = 'fits' | 'partial' | 'too-large' | 'unknown';
export type Pressure = 'ok' | 'tight' | 'critical' | 'unknown';

export interface ScalePlan {
  measured: boolean;
  /** Context window for chat and agents (num_ctx). */
  numCtx: number;
  /** Characters per chunk when a file is mounted into a chat. */
  chunkChars: number;
  /** Tokens a single request may spend on mounted files, recall and web results together. */
  contextBudgetTokens: number;
  /** Background agents allowed to run at the same time (≥ 1). */
  maxSubagents: number;
  /** Video memory one more parallel agent costs (MB). */
  perAgentMb: number;
  /** Video memory left after the main model and its context (MB), before agents. */
  headroomMb: number;
  fit: Fit;
  pressure: Pressure;
  /** Largest model class (billions of parameters, 4-bit) that fits fully with an 8K context. */
  recommendedParamsB: number;
  /** Plain-language reasons, shown in the UI. */
  notes: string[];
  /** For llama.cpp: start flags that would fit this GPU. */
  llamacppFlags?: string;
}

export const CTX_STEPS = [2048, 4096, 8192, 12288, 16384, 24576, 32768, 49152, 65536, 98304, 131072];
export const PARAM_CLASSES = [0.5, 1, 1.5, 3, 4, 7, 8, 12, 14, 22, 24, 27, 32, 70, 72, 123];
/** Runtime buffers the server allocates next to the weights (compute graph, CUDA context). */
export const OVERHEAD_MB = 400;
const MB = 1024 * 1024;

export const kvMb = (bytesPerToken: number, tokens: number) => (bytesPerToken * tokens) / MB;

/** KV bytes/token from GGUF metadata keys that Ollama returns in `model_info`. */
export function kvFromModelInfo(info: Record<string, unknown> | undefined): { bytes: number; contextMax: number } | null {
  if (!info) return null;
  const arch = String(info['general.architecture'] ?? '');
  const num = (k: string) => { const v = info[`${arch}.${k}`]; return typeof v === 'number' && v > 0 ? v : 0; };
  const layers = num('block_count');
  const heads = num('attention.head_count');
  const kvHeads = num('attention.head_count_kv') || heads;
  const embed = num('embedding_length');
  const keyLen = num('attention.key_length');
  const valLen = num('attention.value_length');
  const contextMax = num('context_length');
  if (!layers || !kvHeads || (!keyLen && !(embed && heads))) return contextMax ? { bytes: 0, contextMax } : null;
  const headDim = embed && heads ? embed / heads : keyLen;
  const k = keyLen || headDim, v = valLen || headDim;
  return { bytes: Math.round(layers * kvHeads * (k + v) * 2), contextMax };
}

/** "7.6B" / "8B" / "70.6B" / "500M" → billions. */
export function parseParams(s: string | undefined): number {
  if (!s) return 0;
  const m = /([\d.]+)\s*([BbMm])/.exec(s);
  if (!m) return 0;
  const v = parseFloat(m[1]);
  return m[2].toLowerCase() === 'm' ? v / 1000 : v;
}

/** Fallback when metadata is missing: modern GQA models use roughly 8–16 KB per token per billion parameters. */
export function estimateKvBytes(paramsB: number): number {
  const p = paramsB > 0 ? paramsB : 7;
  return Math.round(Math.min(320 * 1024, Math.max(24 * 1024, p * 16 * 1024)));
}

export function largestClassUnder(b: number): number {
  let best = 0;
  for (const c of PARAM_CLASSES) if (c <= b) best = c;
  return best;
}

/** Largest model (4-bit, ~0.6 GB per billion parameters, 8K context) that fits in `usableMb`. */
export function recommendParams(usableMb: number): number {
  if (usableMb <= 0) return 0;
  const perB = 0.6 * 1024 + kvMb(16 * 1024, 8192); // weights + KV at 8K, per billion parameters
  return largestClassUnder((usableMb - OVERHEAD_MB) / perB);
}

export function pressureOf(g: GpuReading | null): Pressure {
  if (!g || g.totalMb <= 0) return 'unknown';
  const f = g.freeMb / g.totalMb;
  return f < 0.06 ? 'critical' : f < 0.18 ? 'tight' : 'ok';
}

export function chunkCharsFor(numCtx: number): number {
  return Math.round(Math.min(6000, Math.max(800, numCtx * 4 * 0.06)) / 100) * 100;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function planScale(i: ScaleInput): ScalePlan {
  const notes: string[] = [];
  const g = i.hw?.gpu ?? null;
  const manual = clamp(i.manualCtx || 4096, 512, 262144);
  const cap = Math.max(1, Math.floor(i.maxSubagents || 1));
  const base = (numCtx: number): ScalePlan => ({
    measured: false, numCtx, chunkChars: chunkCharsFor(numCtx), contextBudgetTokens: Math.floor(numCtx * 0.45),
    maxSubagents: 1, perAgentMb: 0, headroomMb: 0, fit: 'unknown', pressure: pressureOf(g), recommendedParamsB: 0, notes,
  });

  if (!i.autoScale) {
    notes.push('Auto-scaling is off: using your context setting and one background agent at a time.');
    return base(manual);
  }

  // llama.cpp: context and slots are fixed when the server starts; we can only read and advise.
  if (i.backend === 'llamacpp') {
    const lp = i.llamacpp;
    if (!lp || !lp.nCtx) {
      notes.push('Could not read llama-server settings (/props). Using your context setting and one agent.');
      return base(manual);
    }
    const slots = Math.max(1, lp.slots || 1);
    const perSlot = Math.floor(lp.nCtx / slots);
    const p = base(perSlot);
    p.maxSubagents = clamp(slots, 1, cap);
    p.measured = !!g;
    p.pressure = pressureOf(g);
    notes.push(`llama-server has ${slots} slot${slots > 1 ? 's' : ''} sharing ${lp.nCtx.toLocaleString()} tokens, so each request gets ${perSlot.toLocaleString()}.`);
    if (g && i.model) {
      const usable = g.totalMb - i.reserveMb - i.model.weightsMb - OVERHEAD_MB;
      const kv = i.model.kvBytesPerToken || estimateKvBytes(i.model.paramsB);
      // Prefer several slots of at least 8K each; otherwise one slot as large as fits.
      let best = { c: 2048, np: 1 };
      for (const np of [4, 3, 2, 1]) {
        let c = 0;
        for (const step of CTX_STEPS) if ((!i.model.contextMax || step <= i.model.contextMax) && kvMb(kv, step * np) * 1.1 <= usable) c = step;
        if (c >= 8192) { best = { c, np }; break; }
        if (np === 1 && c) best = { c, np: 1 };
      }
      p.llamacppFlags = `-c ${best.c * best.np} -np ${best.np}${best.np > 1 ? ' --cont-batching' : ''}`;
      p.recommendedParamsB = recommendParams(g.totalMb - i.reserveMb);
    }
    return p;
  }

  if (!g || g.totalMb <= 0) {
    notes.push('Video memory could not be measured on this PC, so Lotus uses your context setting and runs one background agent at a time.');
    return base(manual);
  }

  const pressure = pressureOf(g);
  const recommendedParamsB = recommendParams(g.totalMb - i.reserveMb);
  if (!i.model) {
    const p = base(manual);
    Object.assign(p, { measured: true, pressure, recommendedParamsB });
    notes.push('No model selected yet. Pick one to size the context and agents.');
    return p;
  }

  const m = i.model;
  const kv = m.kvBytesPerToken > 0 ? m.kvBytesPerToken : estimateKvBytes(m.paramsB);
  // Memory the main model may use: what is free now, plus what it already holds if loaded, minus the reserve.
  const avail = g.freeMb + m.loadedVramMb - i.reserveMb;
  const weights = m.weightsMb + OVERHEAD_MB;
  const ctxMax = m.contextMax > 0 ? m.contextMax : 131072;

  if (weights > avail) {
    const fit: Fit = weights > g.totalMb ? 'too-large' : 'partial';
    const numCtx = Math.min(4096, ctxMax);
    notes.push(fit === 'too-large'
      ? `${m.name} (${(m.weightsMb / 1024).toFixed(1)} GB) is larger than this GPU (${(g.totalMb / 1024).toFixed(1)} GB). Part of it runs on the CPU and replies will be slow.`
      : `${m.name} only partly fits in the free video memory right now. Part of it will run on the CPU.`);
    notes.push(`Keeping the context at ${numCtx.toLocaleString()} tokens and one background agent at a time. A model of about ${recommendedParamsB}B parameters or smaller would fit fully.`);
    return { ...base(numCtx), measured: true, fit, pressure, recommendedParamsB, headroomMb: Math.round(avail - weights) };
  }

  // Largest context step that fits with the weights.
  let numCtx = 2048;
  for (const c of CTX_STEPS) if (c <= ctxMax && weights + kvMb(kv, c) * 1.1 <= avail) numCtx = c;
  const headroomMb = Math.round(avail - weights - kvMb(kv, numCtx) * 1.1);
  const perAgentMb = Math.max(1, Math.round(kvMb(kv, numCtx) * 1.1));
  let agents = 1 + Math.floor(Math.max(0, headroomMb) / perAgentMb);
  if (pressure === 'critical') agents = 1;
  const maxSubagents = clamp(agents, 1, cap);

  notes.push(`${(g.freeMb / 1024).toFixed(1)} of ${(g.totalMb / 1024).toFixed(1)} GB video memory free (${(i.reserveMb / 1024).toFixed(1)} GB kept for other apps).`);
  notes.push(`${m.name}: ${(m.weightsMb / 1024).toFixed(1)} GB of weights; ${m.kvMeasured ? '' : '≈ '}${Math.round(kv / 1024)} KB per token of context.`);
  notes.push(`Context set to ${numCtx.toLocaleString()} tokens${numCtx >= ctxMax ? ' (the model’s maximum)' : ''}; each extra agent needs about ${(perAgentMb / 1024).toFixed(2)} GB.`);
  if (maxSubagents < agents) notes.push(`Agents capped at ${cap} by your setting.`);
  if (pressure === 'critical') notes.push('Video memory is almost full, so background agents run one at a time.');
  if (maxSubagents > 1) notes.push(`To actually run agents side by side, Ollama needs OLLAMA_NUM_PARALLEL=${maxSubagents} (otherwise they queue, which is safe but slower).`);

  return {
    measured: true, numCtx, chunkChars: chunkCharsFor(numCtx), contextBudgetTokens: Math.floor(numCtx * 0.45),
    maxSubagents, perAgentMb, headroomMb, fit: 'fits', pressure, recommendedParamsB, notes,
  };
}

/**
 * Model for background agents: the chat model when it fits (its weights are already loaded and
 * shared), otherwise the largest installed model that fits fully, otherwise the chat model anyway.
 */
export function pickAgentModel(plan: ScalePlan, main: string, installed: { name: string; sizeMb: number }[], hw: HardwareReading | null, reserveMb: number): string {
  if (!main || plan.fit === 'fits' || plan.fit === 'unknown' || !hw?.gpu) return main || installed[0]?.name || '';
  const room = hw.gpu.totalMb - reserveMb - OVERHEAD_MB - 512;
  const fitting = installed.filter((m) => m.sizeMb > 0 && m.sizeMb <= room && !/embed/i.test(m.name)).sort((a, b) => b.sizeMb - a.sizeMb);
  return fitting[0]?.name ?? main;
}
