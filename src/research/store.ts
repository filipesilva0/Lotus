import { useCallback, useEffect, useRef, useState } from 'react';
import { Project, DEFAULT_LIMITS, ResearchLimits, Phase } from './types';
import { RunControl, runResearch, synthesize } from './engine';
import { proposeQuestions, proposePlan, proposePersonas, uid, LlmCtx } from './llm';
import { reportActivity } from '../lib/bus';
import { EngineError } from '../lib/http';

import { currentLimit } from '../agents/pool';

const KEY = 'lotus.research.v1';
const LIMITS_KEY = 'lotus.research.limits.v1';

const loadLimits = (): ResearchLimits => {
  try { return { ...DEFAULT_LIMITS, ...JSON.parse(localStorage.getItem(LIMITS_KEY) || '{}') }; } catch { return DEFAULT_LIMITS; }
};

function loadProjects(): Project[] {
  try {
    const list: Project[] = JSON.parse(localStorage.getItem(KEY) || '[]');
    // A run cannot survive closing the app; keep what it collected and say so.
    return list.map((p) => (p.phase === 'running' || p.phase === 'synthesizing'
      ? { ...p, phase: 'stopped' as Phase, paused: false, error: 'Lotus was closed during this run. Partial results are kept; you can write the report from them.' }
      : p));
  } catch { return []; }
}

export function useResearch(opts: { model: string }) {
  const [projects, setProjects] = useState<Project[]>(loadProjects);
  const [activeId, setActiveId] = useState<string | null>(() => loadProjects()[0]?.id ?? null);
  const [busy, setBusy] = useState<null | 'questions' | 'plan' | 'personas'>(null);
  const [error, setError] = useState<string | null>(null);
  const controls = useRef(new Map<string, RunControl>());
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  // Persist (debounced). Large histories may hit the browser quota; fail quietly and keep working in memory.
  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(projects.slice(0, 40))); } catch { /* quota */ }
    }, 600);
    return () => clearTimeout(t);
  }, [projects]);

  const patch = useCallback((id: string, fn: (p: Project) => Project) => {
    setProjects((cur) => cur.map((p) => (p.id === id ? { ...fn(p), updatedAt: Date.now() } : p)));
  }, []);
  const get = useCallback((id: string) => projectsRef.current.find((p) => p.id === id)!, []);
  const active = projects.find((p) => p.id === activeId) ?? null;

  const create = useCallback((): string => {
    const p: Project = {
      id: uid(), title: 'New research task', question: '', tags: [], createdAt: Date.now(), updatedAt: Date.now(), phase: 'scoping', model: opts.model,
      clarifications: [], plan: [], personas: [], limits: loadLimits(), agents: [], sources: [], queries: [], injected: [], report: '',
      tokensIn: 0, tokensOut: 0, supervisorCtx: 0, numCtx: 8192, paused: false, progress: 0,
    };
    setProjects((cur) => [p, ...cur]);
    setActiveId(p.id);
    setError(null);
    return p.id;
  }, [opts.model]);

  const remove = useCallback((id: string) => {
    controls.current.get(id)?.stop();
    setProjects((cur) => cur.filter((p) => p.id !== id));
    setActiveId((a) => (a === id ? projectsRef.current.find((p) => p.id !== id)?.id ?? null : a));
  }, []);

  const llm = (p: Project): LlmCtx => ({
    model: p.model || opts.model, numCtx: p.numCtx, onUsage: (pt, et) => patch(p.id, (q) => ({ ...q, tokensIn: q.tokensIn + pt, tokensOut: q.tokensOut + et })),
  });

  const guard = async (kind: 'questions' | 'plan' | 'personas', fn: () => Promise<void>) => {
    setBusy(kind); setError(null);
    try { await fn(); }
    catch (e) { setError(e instanceof EngineError && e.unreachable ? `Can't reach Ollama. Start it from the Engines tab, then try again.` : (e as Error).message); }
    finally { setBusy(null); }
  };

  /** Step 1: take the question, ask the model for scoping questions. */
  const startScoping = (id: string, question: string) => guard('questions', async () => {
    patch(id, (p) => ({ ...p, question, title: question.slice(0, 70), model: opts.model, phase: 'scoping' }));
    const qs = await proposeQuestions(llm({ ...get(id), model: opts.model }), question);
    patch(id, (p) => ({ ...p, clarifications: qs }));
  });

  /** Step 2: turn the answers into an editable plan and a panel of expert personas. */
  const buildPlan = (id: string) => guard('plan', async () => {
    const p = get(id);
    const ctx = llm(p);
    const { title, plan } = await proposePlan(ctx, p.question, p.clarifications);
    patch(id, (q) => ({ ...q, title, plan, phase: 'planning' }));
    setBusy('personas');
    const personas = await proposePersonas(ctx, p.question);
    patch(id, (q) => ({ ...q, personas }));
  });

  const regeneratePersonas = (id: string) => guard('personas', async () => {
    const p = get(id);
    const personas = await proposePersonas(llm(p), p.question);
    patch(id, (q) => ({ ...q, personas }));
  });

  const report = (p: Project) => {
    const running = p.agents.filter((a) => a.status === 'running').length;
    reportActivity({
      id: `research-${p.id}`, kind: 'research',
      label: p.phase === 'synthesizing' ? 'Writing report' : `${running} agents · ${p.sources.length}`,
      progress: p.progress, done: p.phase === 'done' || p.phase === 'stopped',
    });
  };

  const run = async (id: string, mode: 'full' | 'synthesize') => {
    controls.current.get(id)?.stop();
    const ctl = new RunControl();
    controls.current.set(id, ctl);
    localStorage.setItem(LIMITS_KEY, JSON.stringify(get(id).limits));
    patch(id, (p) => ({ ...p, model: opts.model || p.model }));
    let last = 0;
    const api = {
      // Parallel research agents never exceed what the VRAM auto-scaler allows right now.
      get: () => { const p = get(id); return { ...p, limits: { ...p.limits, parallelAgents: Math.min(p.limits.parallelAgents, currentLimit()) } }; },
      patch: (fn: (p: Project) => Project) => {
        patch(id, fn);
        if (Date.now() - last > 1500 || get(id).phase === 'done') { last = Date.now(); report(get(id)); }
      },
    };
    try { await (mode === 'full' ? runResearch(api, ctl) : synthesize(api, ctl)); }
    catch (e) { patch(id, (p) => ({ ...p, phase: 'stopped', error: (e as Error).message })); }
    finally { report(get(id)); controls.current.delete(id); }
  };

  const approveAndStart = (id: string) => void run(id, 'full');
  const writeReportFromPartial = (id: string) => void run(id, 'synthesize');

  const pause = (id: string) => { controls.current.get(id)?.pause(); patch(id, (p) => ({ ...p, paused: true })); };
  const resume = (id: string) => { controls.current.get(id)?.resume(); patch(id, (p) => ({ ...p, paused: false })); };
  const stop = (id: string) => controls.current.get(id)?.stop();
  const inject = (id: string, text: string) => text.trim() && patch(id, (p) => ({ ...p, injected: [...p.injected, text.trim()] }));
  const removeInjected = (id: string, i: number) => patch(id, (p) => ({ ...p, injected: p.injected.filter((_, j) => j !== i) }));

  /** Excluding a domain also removes sources already collected from it. */
  const excludeDomain = (id: string, domain: string) => {
    const d = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    if (!d) return;
    patch(id, (p) => ({
      ...p,
      limits: { ...p.limits, excludedDomains: [...new Set([...p.limits.excludedDomains, d])] },
      sources: p.sources.map((s) => (s.domain === d || s.domain.endsWith(`.${d}`) ? { ...s, rejected: true } : s)),
    }));
  };
  const toggleSource = (id: string, sourceId: string) =>
    patch(id, (p) => ({ ...p, sources: p.sources.map((s) => (s.id === sourceId ? { ...s, rejected: !s.rejected } : s)) }));
  const backToPlan = (id: string) => patch(id, (p) => ({ ...p, phase: 'planning', error: undefined }));

  // Stop any live runs when the app view unmounts.
  useEffect(() => () => controls.current.forEach((c) => c.stop()), []);

  return {
    projects, active, activeId, setActiveId, busy, error, setError, create, remove, patch,
    startScoping, buildPlan, regeneratePersonas, approveAndStart, writeReportFromPartial,
    pause, resume, stop, inject, removeInjected, excludeDomain, toggleSource, backToPlan,
  };
}

export type ResearchApi = ReturnType<typeof useResearch>;
