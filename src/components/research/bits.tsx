import React, { useState } from 'react';
import { X } from 'lucide-react';
import { Credibility, Phase, RepoId } from '../../research/types';
import { REPO_INFO } from '../../research/repos';
import { cx } from '../common/ui';

const CRED: Record<Credibility, { label: string; cls: string; tip: string }> = {
  high: { label: 'High', cls: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300', tip: 'Government, university, major publisher or PubMed-indexed' },
  medium: { label: 'Medium', cls: 'bg-sky-500/12 text-sky-700 dark:text-sky-300', tip: 'Recognised scholarly index or open-access publisher' },
  preprint: { label: 'Preprint', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', tip: 'Not yet peer reviewed' },
  unknown: { label: 'Unrated', cls: 'bg-black/5 dark:bg-white/10 text-[#6B7280] dark:text-slate-400', tip: 'Domain not recognised' },
};

export const CredBadge: React.FC<{ c: Credibility }> = ({ c }) => (
  <span title={CRED[c].tip} className={cx('inline-flex items-center h-[18px] px-1.5 rounded-full text-[10px] font-semibold', CRED[c].cls)}>{CRED[c].label}</span>
);

export const RepoTag: React.FC<{ repo: RepoId }> = ({ repo }) => (
  <span className="inline-flex items-center h-[18px] px-1.5 rounded-full text-[10px] font-semibold bg-[var(--color-accent-pastel)] text-[var(--color-accent-vibrant)]">{REPO_INFO[repo].name}</span>
);

const PHASE: Record<Phase, { label: string; cls: string }> = {
  scoping: { label: 'Scoping', cls: 'bg-black/5 dark:bg-white/10 text-[#6B7280] dark:text-slate-300' },
  planning: { label: 'Plan ready', cls: 'bg-[var(--color-accent-pastel)] text-[var(--color-accent-vibrant)]' },
  running: { label: 'Researching', cls: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300' },
  synthesizing: { label: 'Writing', cls: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300' },
  done: { label: 'Complete', cls: 'bg-sky-500/12 text-sky-700 dark:text-sky-300' },
  stopped: { label: 'Stopped', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
};
export const PhaseBadge: React.FC<{ phase: Phase; paused?: boolean }> = ({ phase, paused }) => {
  const p = paused && (phase === 'running' || phase === 'synthesizing') ? { label: 'Paused', cls: PHASE.stopped.cls } : PHASE[phase];
  return <span className={cx('inline-flex items-center h-5 px-2 rounded-full text-[10px] font-semibold', p.cls)}>{p.label}</span>;
};

/** Type and press Enter (or comma) to add a chip. */
export const ChipInput: React.FC<{ values: string[]; onChange: (v: string[]) => void; placeholder: string; label: string }> = ({ values, onChange, placeholder, label }) => {
  const [draft, setDraft] = useState('');
  const add = () => {
    const parts = draft.split(',').map((x) => x.trim()).filter(Boolean);
    if (parts.length) onChange([...new Set([...values, ...parts])]);
    setDraft('');
  };
  return (
    <div className="rounded-[10px] border border-[#E4E6EB] dark:border-[#2C2F38] bg-white dark:bg-[#1D1F25] p-1.5 flex flex-wrap gap-1.5 focus-within:border-[var(--color-accent-vibrant)] focus-within:ring-2 focus-within:ring-[var(--color-accent-vibrant)]/20">
      {values.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-full bg-[var(--color-accent-pastel)] text-[var(--color-accent-vibrant)] text-[11px] font-semibold">
          {v}
          <button aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="w-4 h-4 rounded-full hover:bg-black/10 flex items-center justify-center"><X className="w-2.5 h-2.5" /></button>
        </span>
      ))}
      <input aria-label={label} value={draft} placeholder={values.length ? '' : placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={add}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } if (e.key === 'Backspace' && !draft && values.length) onChange(values.slice(0, -1)); }}
        className="flex-1 min-w-[90px] h-6 bg-transparent outline-none text-xs text-[#111827] dark:text-slate-100 placeholder:text-[#9CA3AF] px-1" />
    </div>
  );
};

export const fmtNum = (n: number) => (n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
export const fmtClock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export function fmtEta(ms: number | null): string {
  if (ms === null || !isFinite(ms)) return 'Estimating…';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `~${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `~${m} min` : `~${Math.floor(m / 60)}h ${m % 60}m`;
}
