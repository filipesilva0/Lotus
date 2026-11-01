import { useCallback, useEffect, useRef, useState } from 'react';
import { EngineId, isRemote } from '../services/engineConfig';
import { ollamaClient } from '../services/ollamaService';
import { voicebox } from '../services/voicebox';
import { comfy } from '../services/comfyService';
import { startEngine, stopEngine, isSupervised, diagnose, NeedsExecutable, savedExe } from '../services/engineControl';

export type Policy = 'on_launch' | 'manual';

export interface EngineState {
  up: boolean | null;
  version: string | null;
  /** Lotus started this process itself, so Lotus can stop it. */
  supervised: boolean;
  policy: Policy;
  phase: 'starting' | 'stopping' | null;
  error: string | null;
  needsExe: boolean;
  /** Why the engine looks offline (nothing listening, blocked, Lotus bug). Null when up or unknown. */
  detail: string | null;
}

export interface GpuInfo {
  name: string | null;
  vramTotalGb: number;
  vramFreeGb: number;
}

const IDS: EngineId[] = ['ollama', 'comfyui', 'voicebox'];
const polKey = (id: EngineId) => `lotus.engine.${id}.policy`;
const initial = (id: EngineId): EngineState => ({
  up: null, version: null, supervised: false, phase: null, error: null, needsExe: false, detail: null,
  policy: (localStorage.getItem(polKey(id)) as Policy) || 'manual',
});

export function useEngines() {
  const [state, setState] = useState<Record<EngineId, EngineState>>({
    ollama: initial('ollama'), comfyui: initial('comfyui'), voicebox: initial('voicebox'),
  });
  const [gpu, setGpu] = useState<GpuInfo | null>(null);
  const patch = useCallback((id: EngineId, p: Partial<EngineState>) => setState((s) => ({ ...s, [id]: { ...s[id], ...p } })), []);
  const autoStarted = useRef(false);

  const probing = useRef(false);
  const lastDiag = useRef<Record<string, { at: number; text: string | null }>>({});
  const probe = useCallback(async () => {
    if (probing.current) return; // never stack probes if one is slow
    probing.current = true;
    try {
    const [o, c, v, sup] = await Promise.all([
      ollamaClient.version(), comfy.stats().catch(() => null), voicebox.health().catch(() => null),
      Promise.all(IDS.map(isSupervised)),
    ]);
    const ups = [o !== null, c !== null, v !== null];
    // Diagnosing is a raw TCP check; repeat it at most every 30 s per offline engine.
    const detail = await Promise.all(IDS.map(async (id, i) => {
      if (ups[i]) { delete lastDiag.current[id]; return null; }
      const prev = lastDiag.current[id];
      if (prev && Date.now() - prev.at < 30_000) return prev.text;
      const text = await diagnose(id).catch(() => null);
      lastDiag.current[id] = { at: Date.now(), text };
      return text;
    }));
    const next = [
      { up: ups[0], version: o, supervised: sup[0], detail: detail[0] },
      { up: ups[1], version: c?.version ?? null, supervised: sup[1], detail: detail[1] },
      { up: ups[2], version: null, supervised: sup[2], detail: detail[2] },
    ];
    // Only re-render the app when something actually changed.
    setState((s) => {
      const cur = [s.ollama, s.comfyui, s.voicebox];
      if (cur.every((e, i) => e.up === next[i].up && e.version === next[i].version && e.supervised === next[i].supervised && e.detail === next[i].detail)) return s;
      return { ollama: { ...s.ollama, ...next[0] }, comfyui: { ...s.comfyui, ...next[1] }, voicebox: { ...s.voicebox, ...next[2] } };
    });
    if (c?.device) setGpu((g) => (g && g.name === c.device && g.vramFreeGb === c.vramFreeGb && g.vramTotalGb === c.vramTotalGb ? g : { name: c.device, vramTotalGb: c.vramTotalGb, vramFreeGb: c.vramFreeGb }));
    else if (v?.gpu_available) setGpu((g) => g ?? { name: v.gpu_type ?? 'GPU', vramTotalGb: 0, vramFreeGb: 0 });
    } finally { probing.current = false; }
  }, []);

  useEffect(() => {
    void probe();
    const t = setInterval(() => { if (!document.hidden) void probe(); }, 5000);
    return () => clearInterval(t);
  }, [probe]);

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

  // "Start with Lotus": once, after the first probe, bring up engines that are set to launch with the app.
  useEffect(() => {
    if (autoStarted.current || IDS.some((id) => state[id].up === null)) return;
    autoStarted.current = true;
    IDS.forEach((id) => {
      if (state[id].policy === 'on_launch' && !state[id].up && !isRemote(id) && (savedExe(id) || id !== 'comfyui')) void start(id);
    });
  }, [state, start]);

  return { engines: state, gpu, start, stop, setPolicy, refresh: probe };
}
