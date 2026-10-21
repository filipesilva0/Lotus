import { useCallback, useEffect, useRef, useState } from 'react';
import { EngineId } from '../services/engineConfig';
import { ollamaClient } from '../services/ollamaService';
import { voicebox } from '../services/voicebox';
import { comfy } from '../services/comfyService';
import { startEngine, stopEngine, isSupervised, NeedsExecutable, savedExe } from '../services/engineControl';

export type Policy = 'on_launch' | 'manual';

export interface EngineState {
  up: boolean | null;
  version: string | null;
  /** Tomo started this process itself, so Tomo can stop it. */
  supervised: boolean;
  policy: Policy;
  phase: 'starting' | 'stopping' | null;
  error: string | null;
  needsExe: boolean;
}

export interface GpuInfo {
  name: string | null;
  vramTotalGb: number;
  vramFreeGb: number;
}

const IDS: EngineId[] = ['ollama', 'comfyui', 'voicebox'];
const polKey = (id: EngineId) => `tomo.engine.${id}.policy`;
const initial = (id: EngineId): EngineState => ({
  up: null, version: null, supervised: false, phase: null, error: null, needsExe: false,
  policy: (localStorage.getItem(polKey(id)) as Policy) || 'manual',
});

export function useEngines() {
  const [state, setState] = useState<Record<EngineId, EngineState>>({
    ollama: initial('ollama'), comfyui: initial('comfyui'), voicebox: initial('voicebox'),
  });
  const [gpu, setGpu] = useState<GpuInfo | null>(null);
  const patch = useCallback((id: EngineId, p: Partial<EngineState>) => setState((s) => ({ ...s, [id]: { ...s[id], ...p } })), []);
  const autoStarted = useRef(false);

  const probe = useCallback(async () => {
    const [o, c, v, sup] = await Promise.all([
      ollamaClient.version(), comfy.stats().catch(() => null), voicebox.health().catch(() => null),
      Promise.all(IDS.map(isSupervised)),
    ]);
    setState((s) => ({
      ollama: { ...s.ollama, up: o !== null, version: o, supervised: sup[0] },
      comfyui: { ...s.comfyui, up: c !== null, version: c?.version ?? null, supervised: sup[1] },
      voicebox: { ...s.voicebox, up: v !== null, version: null, supervised: sup[2] },
    }));
    if (c?.device) setGpu({ name: c.device, vramTotalGb: c.vramTotalGb, vramFreeGb: c.vramFreeGb });
    else if (v?.gpu_available) setGpu((g) => g ?? { name: v.gpu_type ?? 'GPU', vramTotalGb: 0, vramFreeGb: 0 });
  }, []);

  useEffect(() => { void probe(); const t = setInterval(probe, 4000); return () => clearInterval(t); }, [probe]);

  const start = useCallback(async (id: EngineId) => {
    patch(id, { phase: 'starting', error: null, needsExe: false });
    try {
      await startEngine(id);
      // Engines can take a while on first launch (Python, model loading).
      const t0 = Date.now();
      while (Date.now() - t0 < 120_000) {
        await new Promise((r) => setTimeout(r, 1500));
        const up = id === 'ollama' ? await ollamaClient.checkHealth() : id === 'comfyui' ? await comfy.isUp() : await voicebox.isUp();
        if (up) break;
      }
      await probe();
    } catch (e) {
      if (e instanceof NeedsExecutable) patch(id, { needsExe: true });
      else patch(id, { error: (e as Error).message });
    } finally {
      patch(id, { phase: null });
    }
  }, [patch, probe]);

  const stop = useCallback(async (id: EngineId) => {
    patch(id, { phase: 'stopping', error: null });
    try { await stopEngine(id); await new Promise((r) => setTimeout(r, 600)); await probe(); }
    catch (e) { patch(id, { error: (e as Error).message }); }
    finally { patch(id, { phase: null }); }
  }, [patch, probe]);

  const setPolicy = useCallback((id: EngineId, p: Policy) => { localStorage.setItem(polKey(id), p); patch(id, { policy: p }); }, [patch]);

  // "Start with Tomo": once, after the first probe, bring up engines that are set to launch with the app.
  useEffect(() => {
    if (autoStarted.current || IDS.some((id) => state[id].up === null)) return;
    autoStarted.current = true;
    IDS.forEach((id) => {
      if (state[id].policy === 'on_launch' && !state[id].up && (savedExe(id) || id !== 'comfyui')) void start(id);
    });
  }, [state, start]);

  return { engines: state, gpu, start, stop, setPolicy, refresh: probe };
}
