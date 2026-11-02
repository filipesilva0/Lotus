import React, { useState } from 'react';
import { ExternalLink, Lock } from 'lucide-react';
import { ResearchApi } from '../../research/store';
import { Project, RepoId, ResearchLimits } from '../../research/types';
import { REPO_INFO } from '../../research/repos';
import { openExternal } from '../../lib/open';
import { Segmented, Slider, Select, Label, Card, Banner, cx } from '../common/ui';
import { Toggle } from '../common/Toggle';
import { ChipInput, CredBadge, RepoTag, fmtNum } from './bits';

type TabA = 'repos' | 'depth' | 'filters';
type TabB = 'sources' | 'graph' | 'context';
const YEAR = new Date().getFullYear();

export const Inspector: React.FC<{ r: ResearchApi; p: Project; mode: 'A' | 'B' }> = ({ r, p, mode }) => {
  const [a, setA] = useState<TabA>('repos');
  const [b, setB] = useState<TabB>('sources');
  return (
    <aside className="w-[292px] shrink-0 border-l border-[var(--color-border-subtle)] flex flex-col min-h-0" aria-label="Research inspector">
      <div className="p-3 border-b border-[var(--color-border-subtle)]">
        {mode === 'A'
          ? <Segmented<TabA> value={a} onChange={setA} className="w-full [&>button]:flex-1 [&>button]:px-1" options={[{ id: 'repos', label: 'Repos' }, { id: 'depth', label: 'Depth' }, { id: 'filters', label: 'Filters' }]} />
          : <Segmented<TabB> value={b} onChange={setB} className="w-full [&>button]:flex-1 [&>button]:px-1" options={[{ id: 'sources', label: 'Sources' }, { id: 'graph', label: 'Agents' }, { id: 'context', label: 'Context' }]} />}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {mode === 'A' && a === 'repos' && <Repos r={r} p={p} />}
        {mode === 'A' && a === 'depth' && <Depth r={r} p={p} />}
        {mode === 'A' && a === 'filters' && <Filters r={r} p={p} />}
        {mode === 'B' && b === 'sources' && <LiveSources r={r} p={p} />}
        {mode === 'B' && b === 'graph' && <AgentGraph p={p} />}
        {mode === 'B' && b === 'context' && <Context r={r} p={p} />}
      </div>
    </aside>
  );
};

const useLimits = (r: ResearchApi, p: Project) => {
  const locked = p.phase === 'running' || p.phase === 'synthesizing';
  return { locked, set: (patch: Partial<ResearchLimits>) => r.patch(p.id, (q) => ({ ...q, limits: { ...q.limits, ...patch } })) };
};

// ── Mode A ──────────────────────────────────────────────────────────────────

export const Repos: React.FC<{ r: ResearchApi; p: Project }> = ({ r, p }) => {
  const { locked, set } = useLimits(r, p);
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">Pick where agents may search. Only short keyword queries leave your computer; nothing else is uploaded.</p>
      {(Object.keys(REPO_INFO) as RepoId[]).map((id) => (
        <Card key={id} className="p-3 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-[var(--color-text-main)]">{REPO_INFO[id].name}</p>
            <p className="text-xs text-[var(--color-text-muted)] leading-snug mt-0.5">{REPO_INFO[id].blurb}</p>
            <p className="text-xs font-mono text-[var(--color-text-muted)] mt-1">{REPO_INFO[id].host}</p>
          </div>
          <Toggle checked={p.limits.repos[id]} disabled={locked} onChange={(v) => set({ repos: { ...p.limits.repos, [id]: v } })} ariaLabel={`Search ${REPO_INFO[id].name}`} />
        </Card>
      ))}
      <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">Agents read titles and abstracts only. Full-text and PDF reading aren't supported yet.</p>
    </div>
  );
};

const Field: React.FC<{ label: string; value: string; children: React.ReactNode }> = ({ label, value, children }) => (
  <div><div className="flex justify-between mb-1.5"><span className="text-xs font-semibold text-[var(--color-text-muted)]">{label}</span><span className="text-xs font-semibold text-[var(--color-text-main)] tabular-nums">{value}</span></div>{children}</div>
);

export const Depth: React.FC<{ r: ResearchApi; p: Project }> = ({ r, p }) => {
  const { locked, set } = useLimits(r, p);
  const L = p.limits;
  return (
    <div className="space-y-5">
      <Field label="Search depth" value={`${L.maxDepth} round${L.maxDepth > 1 ? 's' : ''}`}><Slider min={1} max={5} step={1} value={L.maxDepth} disabled={locked} label="Search depth" onChange={(v) => set({ maxDepth: v })} /></Field>
      <p className="text-xs text-[var(--color-text-muted)] -mt-2 leading-relaxed">Each round writes new queries from what was learned so far. More rounds find more but take longer.</p>
      <Field label="Max sources per agent" value={String(L.maxSourcesPerAgent)}><Slider min={3} max={20} step={1} value={L.maxSourcesPerAgent} disabled={locked} label="Max sources per agent" onChange={(v) => set({ maxSourcesPerAgent: v })} /></Field>
      <Field label="Agents at once" value={String(L.parallelAgents)}><Slider min={1} max={4} step={1} value={L.parallelAgents} disabled={locked} label="Agents at once" onChange={(v) => set({ parallelAgents: v })} /></Field>
      <p className="text-xs text-[var(--color-text-muted)] -mt-2 leading-relaxed">Ollama usually answers one request at a time, so extra agents mostly overlap their web searches.</p>
      <div>
        <div className="flex items-center justify-between mb-1.5"><span className="text-xs font-semibold text-[var(--color-text-muted)]">Publication year cutoff</span><span className="text-xs font-semibold tabular-nums text-[var(--color-text-main)]">{L.yearCutoff ? `${L.yearCutoff}+` : 'Any year'}</span></div>
        <Slider min={1990} max={YEAR} step={1} value={L.yearCutoff ?? 1990} disabled={locked} label="Publication year cutoff" onChange={(v) => set({ yearCutoff: v <= 1990 ? null : v })} />
      </div>
    </div>
  );
};

const LANGS: [string, string][] = [['', 'Any language'], ['eng', 'English'], ['ger', 'German'], ['fre', 'French'], ['spa', 'Spanish'], ['chi', 'Chinese'], ['jpn', 'Japanese']];
export const Filters: React.FC<{ r: ResearchApi; p: Project }> = ({ r, p }) => {
  const { locked, set } = useLimits(r, p);
  return (
    <div className={cx('space-y-5', locked && 'opacity-60 pointer-events-none')}>
      <div><Label hint="match any">Required keywords</Label><ChipInput label="Required keywords" values={p.limits.requiredKeywords} onChange={(v) => set({ requiredKeywords: v })} placeholder="e.g. randomised, placebo" />
        <p className="text-xs text-[var(--color-text-muted)] mt-1.5">A paper must mention at least one of these in its title or abstract.</p></div>
      <div><Label>Excluded domains</Label><ChipInput label="Excluded domains" values={p.limits.excludedDomains} onChange={(v) => set({ excludedDomains: v })} placeholder="e.g. example.com" /></div>
      <div><Label>Language</Label>
        <Select aria-label="Language" value={p.limits.language} onChange={(e) => set({ language: e.target.value })}>{LANGS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</Select>
        <p className="text-xs text-[var(--color-text-muted)] mt-1.5">Applied by PubMed and OpenAlex. arXiv and Crossref don't filter by language.</p></div>
    </div>
  );
};

// ── Mode B ──────────────────────────────────────────────────────────────────

export const LiveSources: React.FC<{ r: ResearchApi; p: Project }> = ({ r, p }) => {
  if (!p.sources.length) return <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">Papers appear here as agents find them. Untick a source to leave it out of the report.</p>;
  const kept = p.sources.filter((s) => !s.rejected).length;
  return (
    <div className="space-y-2.5">
      <p className="text-xs text-[var(--color-text-muted)] tabular-nums">{kept} of {p.sources.length} included in the report</p>
      <ul className="space-y-2">
        {[...p.sources].reverse().map((s) => (
          <li key={s.id} className={cx('rounded-[10px] border border-[var(--color-border-subtle)] p-2.5 flex gap-2.5 transition-opacity', s.rejected && 'opacity-50')}>
            <input type="checkbox" checked={!s.rejected} onChange={() => r.toggleSource(p.id, s.id)} aria-label={`Include ${s.title}`} className="mt-0.5 accent-[var(--color-accent-vibrant)] shrink-0" />
            <div className="min-w-0 flex-1 space-y-1">
              <button onClick={() => void openExternal(s.url)} title="Open in browser" className="text-left text-xs font-semibold text-[var(--color-text-main)] line-clamp-2 hover:text-[var(--color-accent-vibrant)] leading-snug">{s.title}<ExternalLink className="inline w-2.5 h-2.5 ml-1 opacity-50" /></button>
              <div className="flex flex-wrap items-center gap-1.5"><RepoTag repo={s.repo} /><CredBadge c={s.credibility} />{s.year && <span className="text-xs text-[var(--color-text-muted)] tabular-nums">{s.year}</span>}
                {s.relevance && <span className="text-xs text-[var(--color-text-muted)] tabular-nums" title="Relevance to the sub-topic">{'●'.repeat(s.relevance)}{'○'.repeat(5 - s.relevance)}</span>}</div>
              {s.finding && <p className="text-xs text-[var(--color-text-muted)] leading-snug line-clamp-3">{s.finding}</p>}
              <p className="text-xs text-[var(--color-text-muted)] font-mono truncate">{s.domain}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export const AgentGraph: React.FC<{ p: Project }> = ({ p }) => {
  if (!p.agents.length) return <p className="text-xs text-[var(--color-text-muted)]">The agent graph appears when research starts.</p>;
  const n = p.agents.length, rowH = 62, H = Math.max(150, n * rowH + 30), W = 260, midY = H / 2;
  const ay = (i: number) => 24 + i * rowH + 12;
  const col = (s: string) => (s === 'running' ? 'text-emerald-500' : s === 'done' ? 'text-sky-500' : s === 'error' ? 'text-rose-500' : 'text-[var(--color-text-muted)]');
  const synth = p.phase === 'synthesizing' ? 'text-emerald-500' : p.phase === 'done' ? 'text-sky-500' : 'text-[var(--color-text-muted)]';
  return (
    <div className="space-y-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Supervisor, sub-agents and the report">
        {p.agents.map((a, i) => (
          <g key={a.id} className={col(a.status)}>
            <path d={`M34 ${midY} C 70 ${midY}, 70 ${ay(i)}, 110 ${ay(i)}`} fill="none" stroke="currentColor" strokeWidth="1.4" opacity=".45" />
            <path d={`M130 ${ay(i)} C 170 ${ay(i)}, 170 ${midY}, 224 ${midY}`} fill="none" stroke="currentColor" strokeWidth="1.4" opacity=".45" />
            <circle cx="120" cy={ay(i)} r="11" fill="currentColor" opacity=".16" /><circle cx="120" cy={ay(i)} r="6" fill="currentColor"><title>{`${a.title}: ${a.action}`}</title></circle>
            {a.status === 'running' && <circle cx="120" cy={ay(i)} r="11" fill="none" stroke="currentColor" strokeWidth="1.5" className="animate-ping" style={{ transformOrigin: `120px ${ay(i)}px` }} />}
            <text x="120" y={ay(i) + 25} textAnchor="middle" fontSize="8.5" fill="currentColor" className="font-semibold">{a.title.length > 20 ? `${a.title.slice(0, 19)}…` : a.title}</text>
            <text x="120" y={ay(i) + 36} textAnchor="middle" fontSize="8" className="fill-[#9CA3AF]">{a.sourceIds.length} sources</text>
          </g>
        ))}
        <g className="text-[var(--color-accent-vibrant)]"><circle cx="24" cy={midY} r="14" fill="currentColor" opacity=".16" /><circle cx="24" cy={midY} r="8" fill="currentColor" /><text x="24" y={midY + 28} textAnchor="middle" fontSize="8.5" fill="currentColor" className="font-semibold">Supervisor</text></g>
        <g className={synth}><rect x="224" y={midY - 13} width="26" height="26" rx="7" fill="currentColor" opacity=".16" /><rect x="230" y={midY - 7} width="14" height="14" rx="4" fill="currentColor" /><text x="237" y={midY + 28} textAnchor="middle" fontSize="8.5" fill="currentColor" className="font-semibold">Report</text></g>
      </svg>
      <div className="flex flex-wrap gap-3 text-xs text-[var(--color-text-muted)]">{[['text-emerald-500', 'Running'], ['text-sky-500', 'Done'], ['text-[var(--color-text-muted)]', 'Waiting'], ['text-rose-500', 'Error']].map(([c, l]) => <span key={l} className="inline-flex items-center gap-1"><span className={cx('w-2 h-2 rounded-full bg-current', c)} />{l}</span>)}</div>
    </div>
  );
};

const Meter: React.FC<{ label: string; value: number; max: number; note?: string }> = ({ label, value, max, note }) => {
  const pct = Math.min(100, (value / max) * 100);
  const hot = pct > 85, warm = pct > 65;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1"><span className="font-semibold text-[var(--color-text-main)] truncate pr-2">{label}</span><span className="tabular-nums text-[var(--color-text-muted)] shrink-0">{fmtNum(value)} / {fmtNum(max)}</span></div>
      <div className="h-1.5 rounded-[6px] bg-black/10 dark:bg-white/10 overflow-hidden" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
        <div className={cx('h-full transition-[width]', hot ? 'bg-[var(--c-red)]' : warm ? 'bg-amber-500' : 'bg-[var(--color-accent-vibrant)]')} style={{ width: `${pct}%` }} />
      </div>
      {note && <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">{note}</p>}
    </div>
  );
};

export const Context: React.FC<{ r: ResearchApi; p: Project }> = ({ r, p }) => {
  const locked = p.phase === 'running' || p.phase === 'synthesizing';
  const supHot = p.supervisorCtx / p.numCtx > 0.85;
  return (
    <div className="space-y-5">
      <div>
        <Label>Context window</Label>
        <Select aria-label="Context window" value={p.numCtx} disabled={locked} onChange={(e) => r.patch(p.id, (q) => ({ ...q, numCtx: Number(e.target.value) }))}>
          {[4096, 8192, 16384, 32768].map((n) => <option key={n} value={n}>{fmtNum(n)} tokens</option>)}
        </Select>
        <p className="text-xs text-[var(--color-text-muted)] mt-1.5 leading-relaxed">Larger windows let the report cite more sources but use more GPU memory. Applies to the next run.</p>
      </div>
      <div className="space-y-3.5">
        <h4 className="text-xs font-semibold text-[var(--color-text-muted)]">Largest prompt so far</h4>
        <Meter label="Supervisor (report)" value={p.supervisorCtx} max={p.numCtx} note={supHot ? 'Close to the limit. Lower sources per agent or raise the window.' : undefined} />
        {p.agents.map((a) => <Meter key={a.id} label={a.title} value={a.ctxPeak} max={p.numCtx} />)}
        {!p.agents.length && <p className="text-xs text-[var(--color-text-muted)]">Meters appear once agents start.</p>}
      </div>
      <Card className="p-3 space-y-1">
        <div className="flex justify-between text-xs"><span className="text-[var(--color-text-muted)]">Tokens in</span><span className="tabular-nums font-semibold text-[var(--color-text-main)]">{p.tokensIn.toLocaleString()}</span></div>
        <div className="flex justify-between text-xs"><span className="text-[var(--color-text-muted)]">Tokens out</span><span className="tabular-nums font-semibold text-[var(--color-text-main)]">{p.tokensOut.toLocaleString()}</span></div>
        <div className="flex justify-between text-xs"><span className="text-[var(--color-text-muted)]">Cost</span><span className="font-semibold text-[var(--c-green)]">$0.00 · runs locally</span></div>
      </Card>
      {p.model && <p className="text-xs text-[var(--color-text-muted)] flex items-center gap-1"><Lock className="w-3 h-3" />Model: <span className="font-mono">{p.model}</span></p>}
    </div>
  );
};
