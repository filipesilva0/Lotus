import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, PanelRight, FlaskConical, Check } from 'lucide-react';
import { useResearch } from '../../research/store';
import { Project } from '../../research/types';
import { Btn, Segmented, Empty, IconBtn, cx } from '../common/ui';
import { PhaseBadge } from './bits';
import { ScopingView } from './ScopingView';
import { LiveView } from './LiveView';
import { Inspector } from './Inspector';

interface Props { model: string; models: string[]; ollamaUp: boolean | null; onOpenEngines: () => void }

const defaultMode = (p: Project | null): 'A' | 'B' => (p && (p.phase === 'running' || p.phase === 'synthesizing' || p.phase === 'done' || (p.phase === 'stopped' && (p.sources.length > 0 || p.report))) ? 'B' : 'A');
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'Just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
};

export const ResearchWorkspace: React.FC<Props> = ({ model, models, ollamaUp, onOpenEngines }) => {
  const r = useResearch({ model });
  const p = r.active;
  const [mode, setMode] = useState<'A' | 'B'>(defaultMode(p));
  const [tag, setTag] = useState<string | null>(null);
  const [inspector, setInspector] = useState(() => window.innerWidth >= 1240);
  const [confirm, setConfirm] = useState<string | null>(null);

  // Switch mode automatically when a project is opened or its run starts, but never fight the user mid-run.
  useEffect(() => { setMode(defaultMode(p)); }, [r.activeId, p?.phase === 'running']); // eslint-disable-line react-hooks/exhaustive-deps

  const tags = useMemo(() => [...new Set(r.projects.flatMap((x) => x.tags))].sort(), [r.projects]);
  const list = tag ? r.projects.filter((x) => x.tags.includes(tag)) : r.projects;

  return (
    <div className="flex-1 flex h-full min-h-0 bg-[var(--color-bg-panel)] rounded-[24px] overflow-hidden border border-black/5 dark:border-[var(--color-border-subtle)]">
      {/* Panel 1 · modes & project vault */}
      <nav className="w-[236px] shrink-0 border-r border-[var(--color-border-subtle)] flex flex-col min-h-0" aria-label="Research projects">
        <div className="p-3 space-y-3 border-b border-[var(--color-border-subtle)]">
          <Btn variant="primary" className="w-full" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => { r.create(); setMode('A'); }}>New deep research task</Btn>
          <Segmented<'A' | 'B'> value={mode} onChange={setMode} className="w-full [&>button]:flex-1 [&>button]:px-1" options={[{ id: 'A', label: 'Scoping' }, { id: 'B', label: 'Live' }]} />
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by tag">
              {[null, ...tags].map((t) => (
                <button key={t ?? 'all'} onClick={() => setTag(t)} aria-pressed={tag === t}
                  className={cx('h-6 px-2 rounded-full text-xs font-semibold transition-colors', tag === t ? 'bg-[var(--color-accent-vibrant)] text-white' : 'bg-black/[.05] dark:bg-white/[.07] text-[var(--color-text-muted)] hover:bg-black/10 dark:hover:bg-white/10')}>
                  {t ? (t.startsWith('#') ? t : `#${t}`) : 'All'}
                </button>
              ))}
            </div>
          )}
        </div>
        <ul className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
          {list.length === 0 && <li className="px-3 py-6 text-center text-xs text-[var(--color-text-muted)]">{r.projects.length ? 'No tasks with this tag.' : 'Your research tasks will be listed here.'}</li>}
          {list.map((x) => (
            <li key={x.id} className="group relative">
              <button onClick={() => r.setActiveId(x.id)} aria-current={x.id === r.activeId}
                className={cx('w-full text-left rounded-xl px-3 py-2.5 transition-colors', x.id === r.activeId ? 'bg-[var(--color-accent-pastel)]' : 'hover:bg-black/[.04] dark:hover:bg-white/5')}>
                <span className="block text-xs font-semibold text-[var(--color-text-main)] line-clamp-2 pr-5 leading-snug">{x.title}</span>
                <span className="flex items-center gap-2 mt-1.5"><PhaseBadge phase={x.phase} paused={x.paused} /><span className="text-xs text-[var(--color-text-muted)]">{ago(x.updatedAt)}</span></span>
                {x.tags.length > 0 && <span className="block text-xs text-[var(--color-accent-vibrant)] mt-1 truncate">{x.tags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ')}</span>}
              </button>
              <span className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                {confirm === x.id
                  ? <IconBtn label="Confirm delete" className="!w-6 !h-6 !text-rose-600" onClick={() => { r.remove(x.id); setConfirm(null); }}><Check className="w-3.5 h-3.5" /></IconBtn>
                  : <IconBtn label="Delete task" className="!w-6 !h-6" onClick={() => setConfirm(x.id)} onBlur={() => setConfirm(null)}><Trash2 className="w-3 h-3" /></IconBtn>}
              </span>
            </li>
          ))}
        </ul>
      </nav>

      {/* Panel 2 · adaptive workspace */}
      <section className="flex-1 min-w-0 flex flex-col min-h-0">
        <header className="flex items-center gap-3 px-5 h-12 border-b border-[var(--color-border-subtle)] shrink-0">
          <FlaskConical className="w-4 h-4 text-[var(--color-accent-vibrant)]" />
          <h2 className="text-sm font-semibold text-[var(--color-text-main)] flex-1 truncate">{p ? (mode === 'A' ? 'Scoping & brief' : 'Live research') : 'Deep research'}</h2>
          {p && <PhaseBadge phase={p.phase} paused={p.paused} />}
          {p && <IconBtn label={inspector ? 'Hide inspector' : 'Show inspector'} active={inspector} onClick={() => setInspector(!inspector)}><PanelRight className="w-4 h-4" /></IconBtn>}
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {!p ? (
            <Empty className="h-full" icon={<FlaskConical className="w-5 h-5" />} title="Investigate a topic in depth"
              body="Describe a question, approve a plan, and parallel agents search scholarly databases, read abstracts and write a cited report. Your local model does all the thinking."
              action={<Btn variant="primary" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => { r.create(); setMode('A'); }}>New deep research task</Btn>} />
          ) : mode === 'A' ? (
            <ScopingView key={p.id} r={r} p={p} models={models} ollamaUp={ollamaUp} onOpenEngines={onOpenEngines} />
          ) : p.agents.length === 0 && !p.report && p.phase !== 'running' ? (
            <Empty className="h-full" icon={<FlaskConical className="w-5 h-5" />} title="Nothing is running yet" body="Finish scoping and approve the plan to start the agents."
              action={<Btn variant="secondary" onClick={() => setMode('A')}>Go to scoping</Btn>} />
          ) : (
            <LiveView key={p.id} r={r} p={p} onOpenEngines={onOpenEngines} />
          )}
        </div>
      </section>

      {/* Panel 3 · adaptive inspector */}
      {p && inspector && <Inspector r={r} p={p} mode={mode} />}
    </div>
  );
};
