import { useCallback, useEffect, useRef, useState } from 'react';
import { idbDel, idbGet, idbSet } from '../lib/idb';
import { reportActivity } from '../lib/bus';
import { uid } from '../lib/persist';
import { runAgent, AgentCtx } from './agent';
import { AgentItem, BuilderProject, ChatMsg, SavedChat } from './types';
import { Template } from './templates';
import type { Terminal } from './useTerminal';

interface Opts {
  project: BuilderProject | null;
  template: Template;
  model: string;
  numCtx: number;
  mode: 'plan' | 'fast';
  term: Terminal;
  showPreview: (t: { url?: string; dir?: string }) => Promise<string>;
  refreshFiles: () => void;
  setAutoRun: (on: boolean) => void;
  /** Formatted project context files (auto-discovered in the project folder). */
  projectContext?: string;
}

export interface PendingApproval { command: string; why: 'ask' | 'danger'; answer: (a: 'once' | 'always' | 'deny') => void }

const key = (id: string) => `lotus.builder.chat.${id}`;

/** The agent conversation for the open project: messages, running state, approvals, plan. */
export function useAgent(o: Opts) {
  const [items, setItems] = useState<AgentItem[]>([]);
  const [running, setRunning] = useState(false);
  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const chat = useRef<{ history: ChatMsg[]; plan: string }>({ history: [], plan: '' });
  const abort = useRef<AbortController | null>(null);
  const loadedFor = useRef<string | null>(null);
  const opts = useRef(o);
  opts.current = o;
  const pid = o.project?.id ?? null;

  // Load this project's conversation.
  useEffect(() => {
    abort.current?.abort();
    loadedFor.current = null;
    setItems([]); setRunning(false); setApproval(null);
    chat.current = { history: [], plan: '' };
    if (!pid) return;
    let alive = true;
    void idbGet<SavedChat>(key(pid)).then((s) => {
      if (!alive) return;
      if (s) { setItems(s.items.map((i) => (i.kind === 'assistant' ? { ...i, streaming: false, status: undefined } : i.kind === 'action' && i.status === 'running' ? { ...i, status: 'error' as const, output: 'Interrupted' } : i))); chat.current = { history: s.history, plan: s.plan }; }
      loadedFor.current = pid;
    });
    return () => { alive = false; };
  }, [pid]);

  // Save it when it settles.
  useEffect(() => {
    if (!pid || running || loadedFor.current !== pid) return;
    const t = setTimeout(() => { const saved: SavedChat = { items: items.slice(-300), history: chat.current.history.slice(-60), plan: chat.current.plan }; void idbSet(key(pid), saved); }, 500);
    return () => clearTimeout(t);
  }, [items, running, pid]);

  const push = useCallback((item: AgentItem) => setItems((l) => [...l, item]), []);
  const patch = useCallback((id: string, p: Partial<AgentItem>) => setItems((l) => l.map((i) => (i.id === id ? ({ ...i, ...p } as AgentItem) : i))), []);

  const start = useCallback(async (text: string) => {
    const c = opts.current;
    if (!c.project || running) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setRunning(true);
    reportActivity({ id: 'build-agent', kind: 'build', label: 'Building…' });
    const ctx: AgentCtx = {
      project: c.project, template: c.template, model: c.model, numCtx: c.numCtx, temperature: 0.2, mode: c.mode, signal: ctrl.signal, projectContext: c.projectContext,
      chat: chat.current, push, patch,
      approve: (command, why) => new Promise<boolean>((resolve) => {
        const onAbort = () => { setApproval(null); resolve(false); };
        ctrl.signal.addEventListener('abort', onAbort, { once: true });
        setApproval({ command, why, answer: (a) => {
          ctrl.signal.removeEventListener('abort', onAbort);
          setApproval(null);
          if (a === 'always' && why === 'ask') opts.current.setAutoRun(true);
          resolve(a !== 'deny');
        } });
      }),
      runCommand: (command, signal, timeoutMs) => opts.current.term.runAndWait(command, signal, timeoutMs),
      startServer: (command) => opts.current.term.startServer(command),
      showPreview: async (t) => {
        if (t.url) {
          if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(t.url)) throw new Error('Only local addresses (127.0.0.1 or localhost) can be previewed.');
          return opts.current.showPreview({ url: t.url });
        }
        return opts.current.showPreview({ dir: t.dir ?? '' });
      },
      onFilesChanged: () => opts.current.refreshFiles(),
    };
    try { await runAgent(ctx, text); } finally {
      setRunning(false); setApproval(null);
      abort.current = null;
      reportActivity({ id: 'build-agent', kind: 'build', label: 'Build finished', done: true });
      opts.current.refreshFiles();
    }
  }, [running, push, patch]);

  const send = useCallback((text: string) => { push({ kind: 'user', id: uid('u'), text }); return start(text); }, [push, start]);

  const approvePlan = useCallback((planId: string, markdown: string) => {
    chat.current.plan = markdown;
    patch(planId, { markdown, state: 'approved' } as Partial<AgentItem>);
    return start('The plan is approved. Build it now, step by step.');
  }, [patch, start]);

  const stop = useCallback(() => { abort.current?.abort(); }, []);

  const reset = useCallback(() => {
    abort.current?.abort();
    setItems([]); setApproval(null);
    chat.current = { history: [], plan: '' };
    if (pid) void idbDel(key(pid));
  }, [pid]);

  return { items, running, approval, send, approvePlan, stop, reset };
}
