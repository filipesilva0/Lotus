import React, { useEffect, useRef, useState } from 'react';
import { Pause, Play, Square, ChevronDown, Terminal, Check, AlertCircle, Loader2, Clock, Layers, FileSearch, Coins, Ban, MessageSquarePlus, X } from 'lucide-react';
import { ResearchApi } from '../../research/store';
import { Project, AgentState } from '../../research/types';
import { REPO_INFO, rateDomain } from '../../research/repos';
import { Btn, Card, TextInput, Banner, Segmented, cx } from '../common/ui';
import { CredBadge, RepoTag, fmtNum, fmtClock, fmtEta } from './bits';
import { ReportView } from './ReportView';

const useNow = (on: boolean) => {
  const [t, setT] = useState(Date.now());
  useEffect(() => { if (!on) return; const i = setInterval(() => setT(Date.now()), 1000); return () => clearInterval(i); }, [on]);
  return t;
};

const Stat: React.FC<{ icon: React.ReactNode; label: string; value: string; sub?: string }> = ({ icon, label, value, sub }) => (
  <Card className="px-4 py-3 flex items-center gap-3">
    <div className="w-9 h-9 rounded-full bg-[var(--color-accent-pastel)] text-[var(--color-accent-vibrant)] flex items-center justify-center shrink-0">{icon}</div>
    <div className="min-w-0"><p className="text-xs font-semibold text-[var(--color-text-muted)]">{label}</p><p className="text-base font-semibold text-[var(--color-text-main)] tabular-nums leading-tight">{value}</p>{sub && <p className="text-xs text-[var(--color-text-muted)] tabular-nums">{sub}</p>}</div>
  </Card>
);

const AgentCard: React.FC<{ a: AgentState; maxDepth: number }> = ({ a, maxDepth }) => {
  const [open, setOpen] = useState(a.status === 'running');
  const icon = a.status === 'running' ? <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--c-green)]" /> : a.status === 'done' ? <Check className="w-3.5 h-3.5 text-[var(--c-green)]" /> : a.status === 'error' ? <AlertCircle className="w-3.5 h-3.5 text-[var(--c-red)]" /> : <Clock className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />;
  return (
    <Card className="overflow-hidden">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-black/[.02] dark:hover:bg-white/[.03] transition-colors">
        <span className="mt-0.5">{icon}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-xs font-semibold text-[var(--color-text-main)] truncate">{a.title}</span>
          <span className="block text-xs text-[var(--color-text-muted)] truncate">{a.action}</span>
          <span className="block text-xs text-[var(--color-text-muted)] tabular-nums mt-1">Round {Math.max(1, a.iteration)}/{maxDepth} · {a.sourceIds.length} sources · {fmtNum(a.tokensIn + a.tokensOut)} tokens</span>
        </span>
        <ChevronDown className={cx('w-4 h-4 text-[var(--color-text-muted)] transition-transform mt-0.5', open && 'rotate-180')} />
      </button>
      {open && (
        <ul className="px-4 pb-3 pt-1 space-y-1 border-t border-[var(--color-border-subtle)] max-h-44 overflow-y-auto font-mono text-[10.5px] text-[var(--color-text-muted)]">
          {a.log.length === 0 && <li>No activity yet.</li>}
          {a.log.map((l, i) => <li key={i}><span className="text-[var(--color-text-muted)]">{fmtClock(l.t)}</span> {l.text}</li>)}
        </ul>
      )}
    </Card>
  );
};

export const LiveView: React.FC<{ r: ResearchApi; p: Project; onOpenEngines: () => void }> = ({ r, p, onOpenEngines }) => {
  const live = p.phase === 'running' || p.phase === 'synthesizing';
  const now = useNow(live && !p.paused);
  const [view, setView] = useState<'live' | 'report'>(p.report ? 'report' : 'live');
  const [instruction, setInstruction] = useState('');
  const [domain, setDomain] = useState('');
  const [termOpen, setTermOpen] = useState(true);
  const prev = useRef(p.phase);
  const termRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (prev.current !== p.phase && (p.phase === 'synthesizing' || p.phase === 'done')) setView('report'); prev.current = p.phase; }, [p.phase]);
  useEffect(() => { termRef.current?.scrollTo({ top: termRef.current.scrollHeight }); }, [p.queries.length]);

  const elapsed = p.startedAt ? (p.finishedAt ?? now) - p.startedAt : 0;
  const eta = p.phase === 'done' ? 'Done' : !live ? '—' : p.paused ? 'Paused' : p.progress > 0.04 ? fmtEta((elapsed / p.progress) * (1 - p.progress)) : 'Estimating…';
  const running = p.agents.filter((a) => a.status === 'running').length;
  const phaseText = p.phase === 'synthesizing' ? 'Writing the report' : p.phase === 'running' ? (p.paused ? 'Paused' : 'Agents are researching') : p.phase === 'done' ? 'Complete' : 'Stopped';

  return (
    <div className="p-6 space-y-5 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0"><h2 className="text-lg font-semibold text-[var(--color-text-main)] truncate">{p.title}</h2><p className="text-xs text-[var(--color-text-muted)] truncate">{p.question}</p></div>
        <Segmented value={view} onChange={setView} options={[{ id: 'live', label: 'Live' }, { id: 'report', label: 'Report' }]} />
      </div>

      {p.error && (
        <Banner tone={p.sources.length ? 'warn' : 'error'} action={<div className="flex gap-1.5">
          {p.sources.length > 0 && <Btn size="sm" variant="secondary" onClick={() => r.writeReportFromPartial(p.id)}>Write report from what was found</Btn>}
          <Btn size="sm" variant="ghost" onClick={onOpenEngines}>Engines</Btn>
        </div>}>{p.error}</Banner>
      )}

      {view === 'report' ? <ReportView r={r} p={p} /> : (
        <>
          <div className="grid grid-cols-2 min-[1560px]:grid-cols-4 gap-3">
            <Stat icon={<Layers className="w-4 h-4" />} label="Active sub-agents" value={`${running} / ${p.agents.length}`} sub={`${p.agents.filter((a) => a.status === 'done').length} finished`} />
            <Stat icon={<FileSearch className="w-4 h-4" />} label="Sources read" value={String(p.sources.length)} sub={`${p.queries.length} searches`} />
            <Stat icon={<Coins className="w-4 h-4" />} label="Tokens processed" value={fmtNum(p.tokensIn + p.tokensOut)} sub={`${fmtNum(p.tokensIn)} in · ${fmtNum(p.tokensOut)} out`} />
            <Stat icon={<Clock className="w-4 h-4" />} label="Estimated completion" value={eta} sub={elapsed ? `${Math.round(elapsed / 1000)}s elapsed` : undefined} />
          </div>

          <div>
            <div className="flex justify-between text-xs font-semibold text-[var(--color-text-muted)] mb-1.5"><span>{phaseText}</span><span className="tabular-nums">{Math.round(p.progress * 100)}%</span></div>
            <div className="h-1.5 rounded-[6px] bg-black/10 dark:bg-white/10 overflow-hidden" role="progressbar" aria-valuenow={Math.round(p.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-[var(--color-accent-vibrant)] transition-[width] duration-500" style={{ width: `${p.progress * 100}%` }} />
            </div>
          </div>

          {/* Steering & pause deck */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold text-[var(--color-text-main)] flex-1">Steering</h3>
              {p.paused
                ? <Btn size="sm" variant="primary" icon={<Play className="w-3 h-3" fill="currentColor" />} onClick={() => r.resume(p.id)} disabled={!live}>Resume</Btn>
                : <Btn size="sm" variant="secondary" icon={<Pause className="w-3 h-3" fill="currentColor" />} onClick={() => r.pause(p.id)} disabled={!live}>Pause</Btn>}
              <Btn size="sm" variant="ghost" icon={<Square className="w-3 h-3" fill="currentColor" />} onClick={() => r.stop(p.id)} disabled={!live}>Stop</Btn>
            </div>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); r.inject(p.id, instruction); setInstruction(''); }}>
              <TextInput aria-label="Add an instruction for the agents" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Add an instruction, e.g. “Focus more on toxicity data”" />
              <Btn type="submit" variant="secondary" disabled={!instruction.trim()} icon={<MessageSquarePlus className="w-3.5 h-3.5" />}>Inject</Btn>
            </form>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); r.excludeDomain(p.id, domain); setDomain(''); }}>
              <TextInput aria-label="Exclude a domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="Exclude a domain, e.g. example.com" />
              <Btn type="submit" variant="secondary" disabled={!domain.trim()} icon={<Ban className="w-3.5 h-3.5" />}>Exclude</Btn>
            </form>
            {(p.injected.length > 0 || p.limits.excludedDomains.length > 0) && (
              <div className="flex flex-wrap gap-1.5">
                {p.injected.map((t, i) => <span key={i} className="inline-flex items-center gap-1 h-6 pl-2.5 pr-1 rounded-[6px] bg-[var(--color-accent-pastel)] text-[var(--color-accent-vibrant)] text-xs font-semibold max-w-full"><span className="truncate">{t}</span><button aria-label="Remove instruction" onClick={() => r.removeInjected(p.id, i)} className="w-4 h-4 rounded-full hover:bg-black/10 flex items-center justify-center"><X className="w-2.5 h-2.5" /></button></span>)}
                {p.limits.excludedDomains.map((d) => <span key={d} className="inline-flex items-center h-6 px-2.5 rounded-[6px] bg-[var(--c-red)]/10 text-rose-700 dark:text-rose-300 text-xs font-semibold">Excluding {d}</span>)}
              </div>
            )}
            <p className="text-xs text-[var(--color-text-muted)]">Instructions apply from each agent's next round. Excluded domains also remove sources already collected.</p>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {p.agents.map((a) => <AgentCard key={a.id} a={a} maxDepth={p.limits.maxDepth} />)}
          </div>

          {/* Live query terminal */}
          <Card className="overflow-hidden">
            <button onClick={() => setTermOpen(!termOpen)} aria-expanded={termOpen} className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-[var(--color-text-main)]">
              <Terminal className="w-3.5 h-3.5 text-[var(--color-accent-vibrant)]" />Live query terminal<span className="font-normal text-[var(--color-text-muted)] tabular-nums">· {p.queries.length}</span>
              <ChevronDown className={cx('w-4 h-4 ml-auto text-[var(--color-text-muted)] transition-transform', termOpen && 'rotate-180')} />
            </button>
            {termOpen && (
              <div ref={termRef} className="bg-[#0F1117] text-[#C9D1D9] font-mono text-xs leading-relaxed max-h-56 overflow-y-auto px-4 py-3 space-y-0.5" role="log" aria-live="off">
                {p.queries.length === 0 && <p className="text-[var(--color-text-muted)]">Waiting for the first search…</p>}
                {p.queries.map((q, i) => (
                  <div key={i} className="flex items-baseline gap-2 whitespace-nowrap overflow-hidden">
                    <span className="text-[var(--color-text-muted)]">{fmtClock(q.t)}</span>
                    <span className="w-[68px] shrink-0 text-[#8B949E]">{REPO_INFO[q.repo].name}</span>
                    <span className={cx('w-8 shrink-0 font-semibold', q.status >= 200 && q.status < 300 ? 'text-emerald-400' : 'text-rose-400')}>{q.status || 'ERR'}</span>
                    <span className="w-14 shrink-0 text-[var(--color-text-muted)] text-right tabular-nums">{q.ms}ms</span>
                    <span className="w-12 shrink-0"><CredBadge c={rateDomain(REPO_INFO[q.repo].host, q.repo)} /></span>
                    <span className="truncate">“{q.query}” <span className="text-[var(--color-text-muted)]">→ {q.count}</span></span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
};
