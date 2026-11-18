// Tasks → Activity (roadmap phase 2): every run of Lotus's agent, from Chat, Work, the island, voice
// calls, tasks and routines, with each step it took and its real result. Kept by the core in lotus.db
// (agent_runs / agent_steps, the last 2000 runs).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, History, Loader2, Square, X } from 'lucide-react';
import { agentAvailable, getRun, listRuns, type RunDetail, type RunSource, type RunSummary } from '../../lib/agent';
import { onCoreEvent } from '../../lib/core';
import { MarkdownLite } from '../../lib/markdownLite';
import { AgentSteps } from '../chat/AgentSteps';
import { InspectorPane, PaneBar, Section } from '../common/Pane';
import { Banner, Btn, Empty, IconBtn, Segmented, TextInput, cx } from '../common/ui';

type Filter = 'all' | RunSource;
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'chat', label: 'Chat' }, { id: 'work', label: 'Work' }, { id: 'task', label: 'Tasks' },
  { id: 'routine', label: 'Routines' }, { id: 'island', label: 'Island' }, { id: 'call', label: 'Calls' },
];
const SOURCE: Record<RunSource, string> = { chat: 'Chat', work: 'Work', task: 'Task', routine: 'Routine', island: 'Island', call: 'Call' };
const PAGE = 60;

const when = (t: number) => {
  const d = new Date(t);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const took = (r: { created: number; finished: number | null }) => (r.finished ? `${Math.max(0, (r.finished - r.created) / 1000).toFixed(1)} s` : '');

const StatusIcon: React.FC<{ s: RunSummary['status'] }> = ({ s }) =>
  s === 'running' ? <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--color-accent-vibrant)]" aria-label="Running" />
    : s === 'done' ? <Check className="w-3.5 h-3.5 text-[var(--c-green)]" aria-label="Done" />
      : s === 'stopped' ? <Square className="w-3 h-3 text-[var(--color-text-muted)]" aria-label="Stopped" />
        : <AlertCircle className="w-3.5 h-3.5 text-[var(--c-red)]" aria-label="Failed" />;

/** `focus`: show only the runs of one task or routine (from its inspector). */
export const ActivityView: React.FC<{ focus?: { ref: string; label: string } | null; onClearFocus?: () => void }> = ({ focus, onClearFocus }) => {
  const live = agentAvailable();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const args = useRef({ filter, query, focus });
  args.current = { filter, query, focus };

  const load = useCallback(async (before?: number) => {
    const { filter: f, query: q, focus: fo } = args.current;
    setBusy(true);
    try {
      const got = await listRuns({ limit: PAGE, ...(f !== 'all' ? { source: f } : {}), ...(q.trim() ? { query: q.trim() } : {}), ...(fo ? { ref: fo.ref } : {}), ...(before ? { before } : {}) });
      setRuns((cur) => (before ? [...cur, ...got] : got));
      setMore(got.length === PAGE);
      setError(null);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, []);

  // Reload when the filters change (typing waits a moment).
  useEffect(() => {
    if (!live) return;
    const t = setTimeout(() => void load(), query ? 250 : 0);
    return () => clearTimeout(t);
  }, [live, filter, query, focus?.ref, load]);

  // New and finished runs show up while the tab is open.
  useEffect(() => {
    if (!live) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const off = onCoreEvent((e) => {
      const a = e as { type: string; kind?: string; runId?: string };
      if (a.type !== 'agent' || (a.kind !== 'done' && a.kind !== 'error')) return;
      if (t) clearTimeout(t);
      t = setTimeout(() => { void load(); if (a.runId && a.runId === sel) void getRun(a.runId).then(setDetail).catch(() => undefined); }, 400);
    });
    return () => { off(); if (t) clearTimeout(t); };
  }, [live, load, sel]);

  useEffect(() => {
    if (!sel) { setDetail(null); return; }
    let on = true;
    getRun(sel).then((d) => { if (on) setDetail(d); }).catch((e) => { if (on) setError((e as Error).message); });
    return () => { on = false; };
  }, [sel]);

  if (!live) return <Empty icon={<History />} title="No activity here" body="Run history is kept by Lotus’s background service, which runs in the desktop app." />;

  return (
    <div className="flex-1 min-h-0 flex">
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        <div className="px-4 pt-3 pb-2 flex flex-wrap items-center gap-2">
          <Segmented<Filter> label="Where runs came from" value={filter} onChange={setFilter} options={FILTERS} className="flex-wrap" />
          <TextInput aria-label="Search runs" placeholder="Search requests and replies" value={query} onChange={(e) => setQuery(e.target.value)} className="!w-[220px]" />
        </div>
        {focus && (
          <div className="px-4 pb-2">
            <span className="inline-flex items-center gap-1.5 h-7 pl-2.5 pr-1 rounded-full bg-[var(--hover)] text-[12px]">
              Only {focus.label}
              <IconBtn label="Show all runs" className="!w-5 !h-5" onClick={onClearFocus}><X className="w-3 h-3" /></IconBtn>
            </span>
          </div>
        )}
        {error && <div className="px-4 pb-2"><Banner tone="error">Couldn’t read the run history: {error}</Banner></div>}
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3">
          {!runs.length && !busy && <Empty icon={<History />} title={query || filter !== 'all' || focus ? 'No runs match' : 'Nothing yet'} body={query || filter !== 'all' || focus ? undefined : 'Each time Lotus works on something (a chat reply with tools, a Work job, a task, a routine), it shows up here with every step it took.'} />}
          <ul aria-label="Agent runs">
            {runs.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setSel(sel === r.id ? null : r.id)} aria-current={sel === r.id ? 'true' : undefined}
                  className={cx('w-full flex items-center gap-2.5 px-2.5 h-9 rounded-[8px] text-[13px] text-left', sel === r.id ? 'bg-[var(--pressed)]' : 'hover:bg-[var(--hover)]')}>
                  <StatusIcon s={r.status} />
                  <span className="w-[58px] shrink-0 text-[12px] text-[var(--color-text-muted)]">{r.source ? SOURCE[r.source] : 'Earlier'}</span>
                  <span className="flex-1 min-w-0 truncate">{r.prompt || '(no request text)'}</span>
                  {!!r.steps && <span className="shrink-0 text-[12px] text-[var(--color-text-muted)] tabular-nums">{r.steps} step{r.steps === 1 ? '' : 's'}</span>}
                  {r.unverified.length > 0 && <AlertCircle className="w-3.5 h-3.5 shrink-0 text-[var(--c-orange,var(--c-red))]" aria-label="Says it did things no step did" />}
                  <span className="w-[110px] shrink-0 text-right text-[12px] text-[var(--color-text-muted)] tabular-nums">{when(r.created)}</span>
                </button>
              </li>
            ))}
          </ul>
          {more && <div className="pt-2 flex justify-center"><Btn size="sm" loading={busy} onClick={() => void load(runs[runs.length - 1]?.created)}>Show Older</Btn></div>}
        </div>
      </div>

      {sel && (
        <InspectorPane label="Run" pinned>
          <PaneBar>
            <span className="flex-1 truncate text-[13px] font-semibold">{detail?.source ? SOURCE[detail.source] : 'Run'}{detail ? ` · ${when(detail.created)}` : ''}</span>
            <IconBtn label="Close" onClick={() => setSel(null)}><X className="w-4 h-4" /></IconBtn>
          </PaneBar>
          {!detail ? <div className="p-4 text-[13px] text-[var(--color-text-muted)]">Loading…</div> : (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <Section title="Request">
                <p className="text-[13px] whitespace-pre-wrap break-words">{detail.prompt || '(no request text)'}</p>
                <p className="mt-1.5 text-[12px] text-[var(--color-text-muted)]">{detail.model}{detail.mode ? ` · ${detail.mode === 'native' ? 'native tool calls' : 'text tool calls'}` : ''}{took(detail) ? ` · ${took(detail)}` : ''}</p>
              </Section>
              <Section title={`Steps${detail.steps.length ? ` · ${detail.steps.length}` : ''}`}>
                {detail.steps.length ? <AgentSteps steps={detail.steps.map((s) => (s.status === 'waiting' ? { ...s, status: 'running', detail: 'Waiting for your permission (answer it in the chat, on the Tasks page or on the island)' } : s)) as never} />
                  : <p className="text-[13px] text-[var(--color-text-muted)]">No tool steps: Lotus only wrote a reply.</p>}
              </Section>
              {detail.unverified.length > 0 && (
                <div className="px-4 pt-3"><Banner tone="warn">The reply says Lotus did things no step did: {detail.unverified.join(', ')}.</Banner></div>
              )}
              <Section title={detail.status === 'error' ? 'Error' : 'Reply'}>
                {detail.status === 'running' ? <p className="text-[13px] text-[var(--color-text-muted)]">Still working…</p>
                  : <div className={cx('text-[13px] leading-relaxed', detail.status === 'error' && 'text-[var(--c-red)]')}><MarkdownLite text={detail.reply || (detail.status === 'stopped' ? 'Stopped.' : '(empty)')} onDark={false} /></div>}
              </Section>
            </div>
          )}
        </InspectorPane>
      )}
    </div>
  );
};
