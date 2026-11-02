import React, { useEffect, useState } from 'react';
import { ArrowLeft, FlaskConical } from 'lucide-react';
import type { ResearchApi } from '../../research/store';
import { Project } from '../../research/types';
import { Btn, Segmented, Empty, IconBtn } from '../common/ui';
import { usePanels } from '../../lib/panels';
import { PhaseBadge } from './bits';
import { ScopingView } from './ScopingView';
import { LiveView } from './LiveView';
import { Inspector } from './Inspector';

/*
 * Deep Research inside Chat (session 8: Research is no longer its own page; Lotus has five pages,
 * one per petal of the logo). A research task opens in the chat's centre and right panel; the task
 * list lives in the chat's left panel, under "Deep research". Start one with the Research toggle in
 * the chat bar or /research <question>.
 */

const defaultMode = (p: Project | null): 'A' | 'B' => (p && (p.phase === 'running' || p.phase === 'synthesizing' || p.phase === 'done' || (p.phase === 'stopped' && (p.sources.length > 0 || p.report))) ? 'B' : 'A');

export const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'Just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
};

interface Props { r: ResearchApi; p: Project; models: string[]; ollamaUp: boolean | null; onOpenEngines: () => void; onClose: () => void }

/** One research task: scoping & brief (mode A) or live research & report (mode B), plus its inspector. */
export const ResearchView: React.FC<Props> = ({ r, p, models, ollamaUp, onOpenEngines, onClose }) => {
  const { right } = usePanels();
  const [mode, setMode] = useState<'A' | 'B'>(defaultMode(p));
  // Switch mode automatically when a task is opened or its run starts, but never fight the user mid-run.
  useEffect(() => { setMode(defaultMode(p)); }, [p.id, p.phase === 'running']); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <section className="flex-1 min-w-0 flex flex-col min-h-0" aria-label="Deep research">
        <header className="flex items-center gap-3 px-4 h-12 border-b border-[var(--color-border-subtle)] shrink-0">
          <IconBtn label="Back to the chat" onClick={onClose}><ArrowLeft className="w-4 h-4" /></IconBtn>
          <FlaskConical className="w-4 h-4 text-[var(--color-accent-vibrant)] shrink-0" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-[var(--color-text-main)] flex-1 truncate">{p.question ? p.title : 'New deep research task'}</h2>
          <PhaseBadge phase={p.phase} paused={p.paused} />
          <Segmented<'A' | 'B'> label="Research view" value={mode} onChange={setMode} options={[{ id: 'A', label: 'Scoping' }, { id: 'B', label: 'Live' }]} />
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {mode === 'A' ? (
            <ScopingView key={p.id} r={r} p={p} models={models} ollamaUp={ollamaUp} onOpenEngines={onOpenEngines} />
          ) : p.agents.length === 0 && !p.report && p.phase !== 'running' ? (
            <Empty className="h-full" icon={<FlaskConical className="w-5 h-5" />} title="Nothing is running yet" body="Finish scoping and approve the plan to start the agents."
              action={<Btn variant="secondary" onClick={() => setMode('A')}>Go to Scoping</Btn>} />
          ) : (
            <LiveView key={p.id} r={r} p={p} onOpenEngines={onOpenEngines} />
          )}
        </div>
      </section>
      {right && <Inspector r={r} p={p} mode={mode} />}
    </>
  );
};
