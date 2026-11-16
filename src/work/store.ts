// Work mode state (session 16): pieces of work, each a conversation with the agent plus the
// artifacts it saved in Lotus Studio/Work/<id>. Lives in App, so a job keeps running (and its
// questions keep arriving) while you use other pages.

import { useCallback, useEffect, useRef, useState } from 'react';
import { agentAvailable, AgentStep, answerAsk, ArtifactInfo, decideStep, runAgent, workArtifacts } from '../lib/agent';
import { kv } from '../lib/store';
import { reportActivity } from '../lib/bus';
import { uid } from '../lib/persist';
import type { LotusSettings } from '../types/lotus';
import { speak, voicePrefs } from '../voice/voice';

export const WORK_KEY = 'lotus.work.v1';

export interface WorkMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  steps?: AgentStep[];
  error?: string;
  unverified?: string[];
  /** Files attached to a request (names shown on the message). */
  files?: { name: string; kind: 'image' | 'text' }[];
  /** Text of attached text/code files, sent to the model with this message (kept for later turns). */
  attached?: string;
  ts: number;
}

/** A file attached in the Work chat bar, already read: images as base64, text as UTF-8. */
export interface WorkAttachment { name: string; kind: 'image' | 'text'; data: string }

/** Attached text files, as the model sees them after the request (capped so one file can't fill the context). */
export function attachedText(files: WorkAttachment[], cap = 60_000): string {
  let left = cap;
  return files.filter((f) => f.kind === 'text').map((f) => {
    const body = f.data.length > left ? `${f.data.slice(0, Math.max(0, left))}\n[…cut: the file is longer]` : f.data;
    left = Math.max(0, left - f.data.length);
    return `Attached file "${f.name}":\n\`\`\`\n${body}\n\`\`\``;
  }).join('\n\n');
}
export interface WorkItem { id: string; title: string; ts: number; pinned?: boolean; messages: WorkMsg[] }
export interface PendingAsk { workId: string; runId: string; askId: string; question: string; options: string[] }

const blank = (): WorkItem => ({ id: uid('work'), title: 'New work', ts: Date.now(), messages: [] });
const load = (): WorkItem[] => { const l = kv.getJson<WorkItem[]>(WORK_KEY, []); return Array.isArray(l) ? l : []; };

/** The plan the agent wrote (latest plan.set) and which steps it ticked since. */
export function planOf(item: WorkItem | undefined): { steps: string[]; done: Set<number> } | null {
  if (!item) return null;
  for (let i = item.messages.length - 1; i >= 0; i--) {
    const st = item.messages[i].steps ?? [];
    const k = [...st].reverse().findIndex((s) => s.tool === 'plan.set' && s.status === 'done');
    if (k < 0) continue;
    const at = st.length - 1 - k;
    const steps = (st[at].data?.plan as string[]) ?? [];
    const done = new Set<number>();
    item.messages.slice(i).forEach((m, mi) => (m.steps ?? []).forEach((s, si) => {
      if (mi === 0 && si <= at) return;
      if (s.tool === 'plan.check' && s.status === 'done' && typeof s.data?.checked === 'number') done.add(s.data.checked as number);
    }));
    return { steps, done };
  }
  return null;
}

/** Helpers (agent.delegate) that worked on an item, with their steps. */
export function helpersOf(steps: AgentStep[] = []): { name: string; goal: string; steps: AgentStep[] }[] {
  const by = new Map<string, { name: string; goal: string; steps: AgentStep[] }>();
  for (const s of steps) {
    const name = s.data?.helper as string | undefined;
    if (!name) continue;
    if (!by.has(name)) by.set(name, { name, goal: String(s.data?.goal ?? ''), steps: [] });
    by.get(name)!.steps.push(s);
  }
  return [...by.values()];
}

export function useWork(settings: LotusSettings) {
  const [items, setItems] = useState<WorkItem[]>(() => { const l = load(); return l.length ? l : [blank()]; });
  const [activeId, setActiveId] = useState(() => items[0].id);
  const [running, setRunning] = useState<Record<string, { runId: string; ctrl: AbortController }>>({});
  const [asks, setAsks] = useState<PendingAsk[]>([]);
  const [artifacts, setArtifacts] = useState<Record<string, ArtifactInfo[]>>({});
  const ref = useRef(items); ref.current = items;
  const settingsRef = useRef(settings); settingsRef.current = settings;

  useEffect(() => { kv.setJson(WORK_KEY, items.filter((i) => i.messages.length)); }, [items]);

  const refreshArtifacts = useCallback(async (id: string) => {
    if (!agentAvailable()) return;
    try { const list = await workArtifacts(id); setArtifacts((a) => ({ ...a, [id]: list })); } catch { /* core busy */ }
  }, []);
  useEffect(() => { void refreshArtifacts(activeId); }, [activeId, refreshArtifacts]);

  const patch = useCallback((id: string, fn: (w: WorkItem) => WorkItem) => setItems((l) => l.map((w) => (w.id === id ? fn(w) : w))), []);
  const patchMsg = useCallback((id: string, mid: string, fn: (m: WorkMsg) => WorkMsg) => patch(id, (w) => ({ ...w, messages: w.messages.map((m) => (m.id === mid ? fn(m) : m)) })), [patch]);

  const newWork = useCallback(() => {
    const empty = ref.current.find((w) => !w.messages.length);
    if (empty) { setActiveId(empty.id); return empty.id; }
    const w = blank();
    setItems((l) => [w, ...l]);
    setActiveId(w.id);
    return w.id;
  }, []);

  const remove = useCallback((id: string) => {
    running[id]?.ctrl.abort();
    const rest = ref.current.filter((w) => w.id !== id);
    const next = rest.length ? rest : [blank()];
    setItems(next);
    if (activeId === id) setActiveId(next[0].id);
  }, [activeId, running]);

  const send = useCallback(async (text: string, workId = activeId, files: WorkAttachment[] = []): Promise<string> => {
    const t = text.trim() || (files.length ? 'Look at the attached files.' : '');
    const item = ref.current.find((w) => w.id === workId);
    if (!t || !item || running[workId]) return '';
    if (!agentAvailable()) throw new Error('Work mode needs the Lotus core, which runs with the desktop app.');
    const s = settingsRef.current;
    const attached = attachedText(files);
    const images = files.filter((f) => f.kind === 'image').map((f) => f.data);
    const user: WorkMsg = { id: uid('wm'), role: 'user', content: t, ts: Date.now(),
      ...(files.length ? { files: files.map((f) => ({ name: f.name, kind: f.kind })) } : {}), ...(attached ? { attached } : {}) };
    const reply: WorkMsg = { id: uid('wm'), role: 'assistant', content: '', steps: [], ts: Date.now() };
    patch(workId, (w) => ({ ...w, ts: Date.now(), title: w.messages.length ? w.title : t.slice(0, 48), messages: [...w.messages, user, reply] }));
    const history = [...item.messages, user].filter((m) => m.content.trim()).slice(-16)
      .map((m) => ({ role: m.role, content: m.attached ? `${m.content}\n\n${m.attached}` : m.content, ...(m === user && images.length ? { images } : {}) }));
    const ctrl = new AbortController();
    const activity = `work-${workId}`;
    reportActivity({ id: activity, kind: 'build', label: 'Working' });
    let runId = '';
    try {
      setRunning((r) => ({ ...r, [workId]: { runId: '', ctrl } }));
      const done = await runAgent({
        model: s.selectedModel, prompt: t, workId, memoryOn: s.autoMemory !== false, web: true, folders: s.agentFolders,
        options: { temperature: s.temperature, topP: s.topP, topK: s.topK, numCtx: s.contextWindow },
        messages: [{ role: 'system', content: s.systemPrompt }, ...history],
      }, (e) => {
        const rid = (e as unknown as { runId?: string }).runId;
        if (rid && !runId) { runId = rid; setRunning((r) => (r[workId] ? { ...r, [workId]: { ...r[workId], runId } } : r)); }
        if (e.kind === 'token') patchMsg(workId, reply.id, (m) => ({ ...m, content: m.content + e.text }));
        else if (e.kind === 'reset') patchMsg(workId, reply.id, (m) => ({ ...m, content: m.content.slice(0, e.keep) }));
        else if (e.kind === 'step') {
          patchMsg(workId, reply.id, (m) => {
            const list = m.steps ?? [];
            const i = list.findIndex((x) => x.id === e.step.id);
            return { ...m, steps: i < 0 ? [...list, e.step] : list.map((x, k) => (k === i ? e.step : x)) };
          });
          if (e.step.status === 'done' && e.step.tool === 'artifact.write') void refreshArtifacts(workId);
          reportActivity({ id: activity, kind: 'build', label: e.step.status === 'waiting' ? 'Needs you' : e.step.label });
        } else if (e.kind === 'ask') {
          setAsks((a) => [...a, { workId, runId: rid ?? runId, askId: e.askId, question: e.question, options: e.options }]);
          reportActivity({ id: activity, kind: 'build', label: 'Asking you' });
        } else if (e.kind === 'answered') setAsks((a) => a.filter((x) => x.askId !== e.askId || x.runId !== (rid ?? runId)));
      }, ctrl.signal);
      patchMsg(workId, reply.id, (m) => ({ ...m, content: done.content || m.content, unverified: done.unverified.length ? done.unverified : undefined }));
      reportActivity({ id: activity, kind: 'build', label: 'Work done', done: true });
      void refreshArtifacts(workId);
      if (voicePrefs().notify && done.content) void speak(`Done. ${done.content.split(/(?<=[.!?])\s/)[0]}`);
      return done.content;
    } catch (e) {
      const msg = (e as Error).message;
      patchMsg(workId, reply.id, (m) => ({ ...m, error: ctrl.signal.aborted ? undefined : msg }));
      reportActivity({ id: activity, kind: 'build', label: ctrl.signal.aborted ? 'Stopped' : 'Failed', done: true });
      if (!ctrl.signal.aborted) throw e;
      return '';
    } finally {
      setRunning((r) => { const { [workId]: _gone, ...rest } = r; return rest; });
      setAsks((a) => a.filter((x) => x.workId !== workId));
    }
  }, [activeId, running, patch, patchMsg, refreshArtifacts]);

  const stop = useCallback((workId = activeId) => running[workId]?.ctrl.abort(), [activeId, running]);
  const answer = useCallback(async (a: PendingAsk, text: string) => {
    setAsks((l) => l.filter((x) => x !== a));
    await answerAsk(a.runId, a.askId, text);
  }, []);
  const decide = useCallback((step: AgentStep, allow: boolean) => decideStep(step.runId, step.id, allow), []);

  const active = items.find((w) => w.id === activeId) ?? items[0];
  return { items, active, activeId: active.id, setActiveId, newWork, remove, patch, send, stop, answer, decide,
    busy: !!running[active.id], runningIds: Object.keys(running), asks: asks.filter((a) => a.workId === active.id), allAsks: asks,
    artifacts: artifacts[active.id] ?? [], refreshArtifacts };
}

export type Work = ReturnType<typeof useWork>;
