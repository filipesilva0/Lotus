// Work mode state (session 16): pieces of work, each a conversation with the agent plus the
// artifacts it saved in Lotus Studio/Work/<id>. Lives in App, so a job keeps running (and its
// questions keep arriving) while you use other pages.

import { useCallback, useEffect, useRef, useState } from 'react';
import { agentAvailable, AgentStep, answerAsk, ArtifactInfo, decideStep, HelperInfo, runAgent, stopRun, workArtifacts } from '../lib/agent';
import { markInterrupted } from './interrupted';
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
  /** 0.11.0: the model's reasoning before and between steps, how long it took, and its speed. */
  thinking?: string;
  thinkingMs?: number;
  tokensPerSec?: number;
  /** 0.11.0: helper agents deployed during this reply, in the order they started. */
  agents?: HelperInfo[];
  /** 0.15.1: the core's run for this reply; `pending` until that run has ended, then when it `ended`. */
  runId?: string;
  pending?: boolean;
  ended?: number;
  /** 0.15.1: you pressed Stop. */
  stopped?: boolean;
  /** 0.15.1: Lotus closed (app or core) before this reply finished; set on startup (interrupted.ts). */
  interrupted?: boolean;
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
export interface WorkItem { id: string; title: string; ts: number; pinned?: boolean; messages: WorkMsg[]; /** A folder the agent may read and edit for this work (0.9.1). */ folder?: string; /** 0.11.0: the model thinks before it acts (shown above the reply). */ think?: boolean }
export interface PendingAsk { workId: string; runId: string; askId: string; question: string; options: string[] }

const blank = (): WorkItem => ({ id: uid('work'), title: 'New work', ts: Date.now(), messages: [] });
const load = (): WorkItem[] => { const l = kv.getJson<WorkItem[]>(WORK_KEY, []); return Array.isArray(l) ? l : []; };

/** Saved Work at startup: nothing is running yet, so a reply that was still going was cut off. */
function loadAtStart(): { items: WorkItem[]; cutOff: string[] } {
  const r = markInterrupted(load());
  return { items: r.items, cutOff: r.runIds };
}

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

/** Merges a helper's latest state into a reply's agent list (new ones at the end). */
export function upsertHelper(list: HelperInfo[] = [], h: HelperInfo): HelperInfo[] {
  const i = list.findIndex((x) => x.id === h.id);
  return i < 0 ? [...list, h] : list.map((x, k) => (k === i ? { ...x, ...h } : x));
}

/** Agents of a reply that are still busy, and how many of them are done (for "2 of 3 agents done"). */
export function agentProgress(list: HelperInfo[] = []): { total: number; done: number; running: number } {
  return { total: list.length, done: list.filter((h) => h.status === 'done' || h.status === 'error' || h.status === 'stopped').length, running: list.filter((h) => h.status === 'running').length };
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
  const [start] = useState(loadAtStart);
  const [items, setItems] = useState<WorkItem[]>(() => (start.items.length ? start.items : [blank()]));
  const [activeId, setActiveId] = useState(() => items[0].id);
  const [running, setRunning] = useState<Record<string, { runId: string; ctrl: AbortController }>>({});
  const [asks, setAsks] = useState<PendingAsk[]>([]);
  const [artifacts, setArtifacts] = useState<Record<string, ArtifactInfo[]>>({});
  const ref = useRef(items); ref.current = items;
  const settingsRef = useRef(settings); settingsRef.current = settings;

  useEffect(() => { kv.setJson(WORK_KEY, items.filter((i) => i.messages.length)); }, [items]);

  // A window reload leaves the core running: stop the runs of replies closed at startup, so no
  // job keeps going (and writing files) where nobody can see it. Best effort; the core may be
  // starting, or already gone and restarted (it closes its own stale runs then).
  useEffect(() => {
    if (!start.cutOff.length) return;
    let tries = 0;
    const t = window.setInterval(() => {
      if (!agentAvailable() && ++tries < 30) return;
      window.clearInterval(t);
      if (agentAvailable()) start.cutOff.forEach((id) => void stopRun(id).catch(() => undefined));
    }, 1000);
    return () => window.clearInterval(t);
  }, [start]);

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

  /**
   * Sends a request. `from` (0.11.0, Edit and Try Again): the id of an earlier request to replace;
   * it and everything after it are dropped first, and its attached files are kept.
   */
  const send = useCallback(async (text: string, workId = activeId, files: WorkAttachment[] = [], from?: string): Promise<string> => {
    const t = text.trim() || (files.length ? 'Look at the attached files.' : '');
    const item0 = ref.current.find((w) => w.id === workId);
    if (!t || !item0 || running[workId]) return '';
    if (!agentAvailable()) throw new Error('Work mode needs the Lotus core, which runs with the desktop app.');
    const cut = from ? item0.messages.findIndex((m) => m.id === from) : -1;
    const old = cut >= 0 ? item0.messages[cut] : undefined;
    const item: WorkItem = cut >= 0 ? { ...item0, messages: item0.messages.slice(0, cut) } : item0;
    const s = settingsRef.current;
    const attached = attachedText(files) || old?.attached || '';
    const images = files.filter((f) => f.kind === 'image').map((f) => f.data);
    const keptFiles = files.length ? files.map((f) => ({ name: f.name, kind: f.kind })) : old?.files;
    const user: WorkMsg = { id: uid('wm'), role: 'user', content: t, ts: Date.now(),
      ...(keptFiles?.length ? { files: keptFiles } : {}), ...(attached ? { attached } : {}) };
    const reply: WorkMsg = { id: uid('wm'), role: 'assistant', content: '', steps: [], pending: true, ts: Date.now() };
    patch(workId, (w) => ({ ...w, ts: Date.now(), title: w.messages.length && cut !== 0 ? w.title : t.slice(0, 48), messages: [...(cut >= 0 ? w.messages.slice(0, cut) : w.messages), user, reply] }));
    let thinkStart = 0;
    const history = [...item.messages, user].filter((m) => m.content.trim()).slice(-16)
      .map((m) => ({ role: m.role, content: m.attached ? `${m.content}\n\n${m.attached}` : m.content, ...(m === user && images.length ? { images } : {}) }));
    const ctrl = new AbortController();
    const activity = `work-${workId}`;
    reportActivity({ id: activity, kind: 'build', label: 'Working' });
    let runId = '';
    try {
      setRunning((r) => ({ ...r, [workId]: { runId: '', ctrl } }));
      const done = await runAgent({
        model: s.selectedModel, prompt: t, workId, memoryOn: s.autoMemory !== false, web: true, folders: [...(item.folder ? [item.folder] : []), ...(s.agentFolders ?? [])],
        options: { temperature: s.temperature, topP: s.topP, topK: s.topK, numCtx: s.contextWindow, ...(item.think ? { think: true } : {}) },
        messages: [{ role: 'system', content: s.systemPrompt }, ...history],
      }, (e) => {
        const rid = (e as unknown as { runId?: string }).runId;
        if (rid && !runId) {
          runId = rid;
          setRunning((r) => (r[workId] ? { ...r, [workId]: { ...r[workId], runId } } : r));
          patchMsg(workId, reply.id, (m) => ({ ...m, runId: rid }));
        }
        if (e.kind === 'token') patchMsg(workId, reply.id, (m) => ({ ...m, content: m.content + e.text, ...(thinkStart && m.thinkingMs === undefined ? { thinkingMs: Date.now() - thinkStart } : {}) }));
        else if (e.kind === 'thinking') {
          if (!thinkStart) thinkStart = Date.now();
          // Thinking again after a step (a later turn): keep the first duration, add the text.
          patchMsg(workId, reply.id, (m) => ({ ...m, thinking: (m.thinking ?? '') + e.text }));
        } else if (e.kind === 'stats') patchMsg(workId, reply.id, (m) => ({ ...m, tokensPerSec: Math.round(e.tokensPerSec) || m.tokensPerSec }));
        else if (e.kind === 'helper') {
          patchMsg(workId, reply.id, (m) => ({ ...m, agents: upsertHelper(m.agents, e.helper) }));
          // Each agent is its own line on the island too (it also reads the core's events directly).
          const h = e.helper, end = h.status !== 'queued' && h.status !== 'running';
          reportActivity({ id: `agent-${h.id}`, kind: 'build', agent: h.name, label: `${h.name} · ${end ? (h.status === 'done' ? 'Done' : h.status === 'error' ? 'Failed' : 'Stopped') : h.status === 'queued' ? 'Waiting its turn' : `${h.current ?? 'Working'}${h.steps ? ` · ${h.steps} step${h.steps === 1 ? '' : 's'}` : ''}`}`, done: end });
        }
        else if (e.kind === 'reset') patchMsg(workId, reply.id, (m) => ({ ...m, content: m.content.slice(0, e.keep) }));
        else if (e.kind === 'step') {
          // Thinking ends when the model starts acting (a step) or writing (a token).
          if (thinkStart) patchMsg(workId, reply.id, (m) => (m.thinkingMs === undefined ? { ...m, thinkingMs: Date.now() - thinkStart } : m));
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
      patchMsg(workId, reply.id, (m) => ({ ...m, content: done.content || m.content, unverified: done.unverified.length ? done.unverified : undefined,
        ...(thinkStart && m.thinkingMs === undefined ? { thinkingMs: Date.now() - thinkStart } : {}) }));
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
      const stopped = ctrl.signal.aborted;
      patchMsg(workId, reply.id, ({ pending: _p, ...m }) => ({ ...m, ended: Date.now(), ...(stopped ? { stopped } : {}) }));
      setRunning((r) => { const { [workId]: _gone, ...rest } = r; return rest; });
      setAsks((a) => a.filter((x) => x.workId !== workId));
    }
  }, [activeId, running, patch, patchMsg, refreshArtifacts]);

  const stop = useCallback((workId = activeId) => running[workId]?.ctrl.abort(), [activeId, running]);
  const answer = useCallback(async (a: PendingAsk, text: string) => {
    setAsks((l) => l.filter((x) => x !== a));
    await answerAsk(a.runId, a.askId, text);
  }, []);
  const decide = useCallback((step: AgentStep, allow: boolean, always = false) => decideStep(step.runId, step.id, allow, always), []);
  /** Edit a request: send the new text in its place (what came after it is replaced). */
  const edit = useCallback((msgId: string, text: string, workId = activeId) => send(text, workId, [], msgId), [activeId, send]);
  /** Try again: send the request before this reply once more. */
  const retry = useCallback((replyId: string, workId = activeId) => {
    const w = ref.current.find((x) => x.id === workId);
    const i = w ? w.messages.findIndex((m) => m.id === replyId) : -1;
    const req = i > 0 ? w!.messages[i - 1] : undefined;
    return req && req.role === 'user' ? send(req.content, workId, [], req.id) : Promise.resolve('');
  }, [activeId, send]);

  const active = items.find((w) => w.id === activeId) ?? items[0];
  return { items, active, activeId: active.id, setActiveId, newWork, remove, patch, send, stop, answer, decide, edit, retry,
    busy: !!running[active.id], runningIds: Object.keys(running), asks: asks.filter((a) => a.workId === active.id), allAsks: asks,
    artifacts: artifacts[active.id] ?? [], refreshArtifacts };
}

export type Work = ReturnType<typeof useWork>;
