// Live hardware monitor: polls free video memory, reads the selected model's real memory needs,
// and keeps a current ScalePlan that chat, the agent pool, tasks and routines read.
// One instance for the whole app; components subscribe with `useHardware()`.

import { useSyncExternalStore } from 'react';
import { invokeNative } from '../lib/bus';
import { isTauri } from '../lib/http';
import { hasLiveSettings, liveSettings, onSettings } from '../lib/liveSettings';
import { ollamaClient } from '../services/ollamaService';
import { comfy } from '../services/comfyService';
import { llamacpp } from '../services/llm';
import {
  estimateKvBytes, HardwareReading, kvFromModelInfo, LlamaCppProps, ModelProfile, parseParams, pickAgentModel, planScale, ScalePlan,
} from './scaler';

interface NativeSnapshot {
  source: string;
  gpus: { name: string; totalMb: number; usedMb: number; freeMb: number }[];
  ramTotalMb: number; ramFreeMb: number; note: string;
}

export interface HardwareState {
  hw: HardwareReading | null;
  model: ModelProfile | null;
  llamacpp: LlamaCppProps | null;
  plan: ScalePlan;
  /** Model background agents use (see pickAgentModel). */
  agentModel: string;
  installed: { name: string; sizeMb: number }[];
  /** Capabilities of the selected model as Ollama reports them (vision, thinking, tools…). */
  caps: string[];
  updatedAt: number;
}

const showCache = new Map<string, Promise<Awaited<ReturnType<typeof ollamaClient.show>> | null>>();
function showModel(name: string) {
  if (!showCache.has(name)) showCache.set(name, ollamaClient.show(name).catch(() => { showCache.delete(name); return null; }));
  return showCache.get(name)!;
}

/** Capabilities of an Ollama model ("thinking", "vision", "tools"…). Empty when unknown. */
export async function modelCapabilities(name: string): Promise<string[]> {
  if (!name) return [];
  const s = await showModel(name);
  return s?.capabilities ?? [];
}

const initialPlan = (): ScalePlan => planScale({ hw: null, model: null, reserveMb: 1024, maxSubagents: 1, manualCtx: 4096, autoScale: true, backend: 'ollama' });

let state: HardwareState = { hw: null, model: null, llamacpp: null, plan: initialPlan(), agentModel: '', installed: [], caps: [], updatedAt: 0 };
const subs = new Set<() => void>();
const set = (p: Partial<HardwareState>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };

export const hardware = {
  get: () => state,
  subscribe: (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn); }; },
  /** Re-measure now (also used right before spawning agents). */
  refresh: () => tick(),
};

export function useHardware(): HardwareState {
  return useSyncExternalStore(hardware.subscribe, hardware.get, hardware.get);
}

async function readHardware(): Promise<HardwareReading | null> {
  const at = Date.now();
  if (isTauri) {
    try {
      const s = await invokeNative<NativeSnapshot>('hw_snapshot');
      if (s && s.source !== 'none' && s.gpus.length) {
        // Several GPUs: Ollama spreads one model across them, so add them up.
        const g = s.gpus.reduce((a, b) => ({ name: a.name ? `${a.name} + ${b.name}` : b.name, totalMb: a.totalMb + b.totalMb, usedMb: a.usedMb + b.usedMb, freeMb: a.freeMb + b.freeMb }), { name: '', totalMb: 0, usedMb: 0, freeMb: 0 });
        return { source: s.source as HardwareReading['source'], gpu: g, ramTotalMb: s.ramTotalMb, ramFreeMb: s.ramFreeMb, at };
      }
      if (s) {
        const viaComfy = await fromComfy(at);
        return viaComfy ?? { source: 'none', gpu: null, ramTotalMb: s.ramTotalMb, ramFreeMb: s.ramFreeMb, at };
      }
    } catch { /* fall through to ComfyUI */ }
  }
  return fromComfy(at);
}

async function fromComfy(at: number): Promise<HardwareReading | null> {
  try {
    const st = await comfy.stats();
    if (!st.vramTotalGb) return null;
    const gb = 1024;
    return { source: 'comfyui', gpu: { name: st.device ?? 'GPU', totalMb: st.vramTotalGb * gb, freeMb: st.vramFreeGb * gb, usedMb: (st.vramTotalGb - st.vramFreeGb) * gb }, ramTotalMb: st.ramTotalGb * gb, ramFreeMb: st.ramFreeGb * gb, at };
  } catch { return null; }
}

async function readModel(name: string): Promise<{ profile: ModelProfile | null; installed: { name: string; sizeMb: number }[]; caps: string[] }> {
  if (!name) return { profile: null, installed: [], caps: [] };
  try {
    const [list, ps, show] = await Promise.all([
      ollamaClient.listModels().catch(() => []),
      ollamaClient.runningModels().catch(() => []),
      showModel(name),
    ]);
    const installed = list.map((m) => ({ name: m.name, sizeMb: m.size / (1024 * 1024) }));
    const tag = list.find((m) => m.name === name);
    const run = ps.find((p) => p.name === name);
    const paramsB = parseParams(show?.details?.parameter_size ?? tag?.details?.parameter_size);
    const kv = kvFromModelInfo(show?.model_info);
    const kvBytes = kv?.bytes || estimateKvBytes(paramsB);
    return {
      installed,
      caps: show?.capabilities ?? [],
      profile: {
        name,
        weightsMb: tag ? tag.size / (1024 * 1024) : paramsB * 0.6 * 1024,
        loadedVramMb: run ? run.size_vram / (1024 * 1024) : 0,
        contextMax: kv?.contextMax ?? 0,
        kvBytesPerToken: kvBytes,
        kvMeasured: !!kv?.bytes,
        paramsB,
      },
    };
  } catch {
    return { profile: null, installed: [], caps: [] };
  }
}

let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastModelRead = 0;
let lastModelName = '';

async function tick(): Promise<void> {
  if (!hasLiveSettings()) return;
  const s = liveSettings();
  const hw = await readHardware();
  let { model, installed, caps } = state;
  // Model metadata changes rarely: re-read every 20 s or when the selection changes.
  if (s.llmBackend === 'ollama' && (s.selectedModel !== lastModelName || Date.now() - lastModelRead > 20_000)) {
    const r = await readModel(s.selectedModel);
    model = r.profile; installed = r.installed; caps = r.caps;
    lastModelName = s.selectedModel; lastModelRead = Date.now();
  }
  let lp: LlamaCppProps | null = null;
  if (s.llmBackend === 'llamacpp') lp = await llamacpp.props().catch(() => null);
  const plan = planScale({ hw, model, reserveMb: s.vramReserveMb, maxSubagents: s.maxSubagents, manualCtx: s.contextWindow, autoScale: s.autoScale, backend: s.llmBackend, llamacpp: lp });
  const agentModel = s.llmBackend === 'llamacpp' ? s.selectedModel : pickAgentModel(plan, s.selectedModel, installed, hw, s.vramReserveMb);
  set({ hw, model, llamacpp: lp, plan, agentModel, installed, caps, updatedAt: Date.now() });
}

function schedule() {
  if (timer) clearTimeout(timer);
  // Fast sources every 5 s; the PowerShell counter and ComfyUI every 15 s.
  const fast = state.hw?.source === 'nvidia-smi' || state.hw?.source === 'amdgpu-sysfs';
  timer = setTimeout(() => { void tick().finally(schedule); }, document.hidden ? 30_000 : fast ? 5000 : 15_000);
}

/** Starts polling (idempotent). Called once from App. */
export function startHardwareMonitor() {
  if (running) return;
  running = true;
  void tick().finally(schedule);
  let last = '';
  onSettings(() => {
    const s = liveSettings();
    const key = [s.selectedModel, s.autoScale, s.vramReserveMb, s.maxSubagents, s.contextWindow, s.llmBackend, s.llamacppUrl].join('|');
    if (key !== last) { last = key; void tick(); }
  });
}

/** The context window to send right now: the auto-scaled one, or the manual setting. */
export function effectiveNumCtx(): number {
  const s = hasLiveSettings() ? liveSettings() : null;
  if (!s) return 4096;
  return s.autoScale ? state.plan.numCtx : s.contextWindow;
}
