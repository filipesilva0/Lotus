import React, { useEffect } from 'react';
import { BookOpen, Brain, Flower2, Puzzle } from 'lucide-react';
import { LotusSettings } from '../../types/lotus';
import { usePersisted } from '../../lib/persist';
import { useAssistantName } from '../../lib/identity';
import { SidebarPane } from '../common/Pane';
import { Segmented, cx } from '../common/ui';
import { LibraryPane, type LibraryTab } from '../library/LibraryPane';
import { MemoryPane } from '../library/MemoryPane';
import { SkillsView } from '../tasks/SkillsView';

export type AssistantTab = LibraryTab;
const TABS: AssistantTab[] = ['memory', 'soul', 'skills', 'plugins'];

/** The sections of the Assistant page, in sidebar order. Exported for tests and screenshots. */
export const ASSISTANT_SECTIONS: { id: AssistantTab; label: string; hint: string }[] = [
  { id: 'memory', label: 'Memory', hint: 'Long-term, short-term and chat notes' },
  { id: 'soul', label: 'Soul', hint: 'Its name and personality' },
  { id: 'skills', label: 'Skills', hint: 'Procedures it has learned' },
  { id: 'plugins', label: 'Plugins', hint: 'Extra abilities you add' },
];
const ICONS: Record<AssistantTab, React.ReactNode> = {
  memory: <Brain className="w-4 h-4" />, soul: <Flower2 className="w-4 h-4" />, skills: <BookOpen className="w-4 h-4" />, plugins: <Puzzle className="w-4 h-4" />,
};

/**
 * Assistant (0.21): everything that shapes the assistant itself, split out of the Tasks page, where these
 * were tabs since 0.11.0. Memory, Soul, Skills and Plugins use the same panes as before.
 */
export const AssistantWorkspace: React.FC<{ settings: LotusSettings; onSettings: (p: Partial<LotusSettings>) => void; request?: { tab: AssistantTab; n: number } | null; folder?: string }> = ({ settings, onSettings, request, folder }) => {
  const [saved, setTab] = usePersisted<AssistantTab>('lotus.assistant.tab.v1', 'memory');
  const tab: AssistantTab = TABS.includes(saved) ? saved : 'memory';
  // Another place (a chat's /library, the View menu, the composer's Skills button) asked for a section.
  useEffect(() => { if (request) setTab(request.tab); }, [request?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  // Kept under its old key so the choice made on the Tasks page before 0.21 carries over.
  const [skillView, setSkillView] = usePersisted<'yours' | 'all'>('lotus.tasks.skillView.v1', 'yours');
  const name = useAssistantName();

  const navBtn = (on: boolean) => cx('w-full min-h-9 px-2.5 py-1.5 flex items-center gap-2.5 rounded-[8px] text-[13px] text-left', on ? 'bg-[var(--pressed)] font-medium' : 'text-[var(--color-text-muted)] hover:bg-[var(--hover)] hover:text-[var(--color-text-main)]');

  return (
    <div className="flex-1 min-h-0 flex bg-[var(--color-bg-panel)] overflow-hidden">
      <SidebarPane label="Assistant">
        <div className="px-4 pt-4 pb-3">
          <p className="text-[15px] font-semibold truncate">{name}</p>
          <p className="text-[12px] text-[var(--color-text-muted)]">What shapes how {name} thinks, remembers and works.</p>
        </div>
        <nav className="px-2 space-y-0.5" aria-label="Assistant sections">
          {ASSISTANT_SECTIONS.map((t) => (
            <button key={t.id} type="button" aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)} className={navBtn(tab === t.id)}>
              {ICONS[t.id]}
              <span className="min-w-0">
                <span className="block">{t.label}</span>
                <span className="block text-[12px] font-normal text-[var(--color-text-muted)] truncate">{t.hint}</span>
              </span>
            </button>
          ))}
        </nav>
        {tab === 'skills' && <div className="px-3 pt-3"><Segmented<'yours' | 'all'> label="Which skills" value={skillView} onChange={setSkillView} options={[{ id: 'yours', label: 'Yours' }, { id: 'all', label: 'All' }]} /></div>}
      </SidebarPane>
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        {tab === 'skills' && skillView === 'yours' && <SkillsView settings={settings} onSettings={onSettings} />}
        {tab === 'skills' && skillView === 'all' && <LibraryPane tab="skills" settings={settings} onSettings={onSettings} folder={folder} />}
        {tab === 'memory' && <MemoryPane folder={folder} />}
        {(tab === 'soul' || tab === 'plugins') && <LibraryPane tab={tab} settings={settings} onSettings={onSettings} folder={folder} />}
      </div>
    </div>
  );
};
