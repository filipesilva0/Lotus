import React, { useEffect, useState } from 'react';
import { useCommand } from '../../lib/commands';
import { BuiltinNotice, EngineNotice } from '../common/EngineNotice';
import { AlarmClock, BookOpen, Bot, Brain, Cpu, Flower2, Puzzle, SquareKanban, Plus, X } from 'lucide-react';
import { LotusSettings } from '../../types/lotus';
import { tasks as store, useTasks } from '../../tasks/store';
import { useAgentPool, agentPool } from '../../agents/pool';
import { useHardware } from '../../hardware/monitor';
import { usePersisted } from '../../lib/persist';
import { Popover, SidebarPane } from '../common/Pane';
import { Banner, Btn, IconBtn, Segmented, cx } from '../common/ui';
import { LibraryPane } from '../library/LibraryPane';
import { KanbanBoard } from '../tasks/KanbanBoard';
import { TaskInspector } from '../tasks/TaskInspector';
import { RoutinesView } from '../tasks/RoutinesView';
import { SkillsView } from '../tasks/SkillsView';
import { ScalingCard } from '../hardware/ScalingCard';
import { PendingApprovals } from '../tasks/PendingApprovals';

export type TasksTab = 'board' | 'routines' | 'skills' | 'memory' | 'soul' | 'plugins';
type Tab = TasksTab;
const TABS: Tab[] = ['board', 'routines', 'skills', 'memory', 'soul', 'plugins'];

const KIND: Record<string, string> = { task: 'Task', routine: 'Routine', skill: 'Skill', memory: 'Memory', other: 'Agent' };

/** Background agents: what is running and waiting, against the VRAM-safe limit. */
const AgentsButton: React.FC = () => {
  const pool = useAgentPool();
  const hw = useHardware();
  const running = pool.jobs.filter((j) => j.status === 'running');
  return (
    <Popover align="right" className="!w-[380px] !max-h-[520px]" trigger={(_o, t) => (
      <button type="button" onClick={t} aria-haspopup="dialog" title="Background agents and video memory"
        className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-[6px] text-[12px] font-medium hover:bg-[var(--hover)]">
        <Bot className="w-3.5 h-3.5 text-[var(--color-accent-vibrant)]" />
        <span className="tabular-nums">{running.length}/{pool.limit} agents</span>
        {hw.hw?.gpu && <span className="text-[var(--color-text-muted)] tabular-nums inline-flex items-center gap-1"><Cpu className="w-3 h-3" />{(hw.hw.gpu.freeMb / 1024).toFixed(1)} GB free</span>}
      </button>
    )}>
      {() => (
        <div className="p-1.5 space-y-2">
          <ScalingCard compact className="!shadow-none !bg-transparent !p-1.5" />
          <div>
            <p className="px-1.5 pb-1 text-[12px] font-semibold text-[var(--color-text-muted)]">Jobs</p>
            {!pool.jobs.length && <p className="px-1.5 pb-1 text-[12px] text-[var(--color-text-muted)]">Nothing running.</p>}
            {pool.jobs.map((j) => (
              <div key={j.id} className="flex items-center gap-2 px-1.5 py-1 text-[12px]">
                <span className={j.status === 'running' ? 'w-1.5 h-1.5 rounded-full bg-[var(--c-green)] animate-pulse' : 'w-1.5 h-1.5 rounded-full bg-[var(--color-text-muted)] opacity-50'} aria-hidden="true" />
                <span className="text-[var(--color-text-muted)] w-[54px] shrink-0">{KIND[j.kind]}</span>
                <span className="flex-1 truncate">{j.label}</span>
                <span className="text-[12px] text-[var(--color-text-muted)]">{j.status === 'running' ? 'running' : 'waiting'}</span>
                <IconBtn label={`Stop ${j.label}`} className="!w-5 !h-5" onClick={() => agentPool.cancel(j.id)}><X className="w-3 h-3" /></IconBtn>
              </div>
            ))}
          </div>
        </div>
      )}
    </Popover>
  );
};

/**
 * Tasks: a Kanban board the user and Lotus share, scheduled routines, and (0.11.0) the library:
 * skills, memory, soul and plugins, which used to be a sheet opened from the profile menu.
 */
export const TasksWorkspace: React.FC<{ settings: LotusSettings; onSettings: (p: Partial<LotusSettings>) => void; ollamaUp: boolean | null; request?: { tab: TasksTab; n: number } | null; folder?: string }> = ({ settings, onSettings, ollamaUp, request, folder }) => {
  const [saved, setTab] = usePersisted<Tab>('lotus.tasks.tab.v1', 'board');
  const tab: Tab = TABS.includes(saved) ? saved : 'board';
  // Another place (a chat's /library, the View menu) asked for one of these tabs.
  useEffect(() => { if (request) setTab(request.tab); }, [request?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const [skillView, setSkillView] = usePersisted<'yours' | 'all'>('lotus.tasks.skillView.v1', 'yours');
  const { tasks, routines, notice } = useTasks();
  const [sel, setSel] = useState<string | null>(null);
  const cur = tasks.find((t) => t.id === sel) ?? null;
  const newTask = () => { setTab('board'); const t = store.add({ title: 'New task', status: 'todo' }); setSel(t.id); };
  useCommand('new-task', newTask);

  // Same layout as the other pages (T71, Filipe): no toolbar strip; the sections live in the sidebar
  // under the full-width "New Task" button, and the background-agents count sits at its foot.
  const SECTIONS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'board', label: 'Board', icon: <SquareKanban className="w-4 h-4" /> },
    { id: 'routines', label: 'Routines', icon: <AlarmClock className="w-4 h-4" /> },
    { id: 'skills', label: 'Skills', icon: <BookOpen className="w-4 h-4" /> },
    { id: 'memory', label: 'Memory', icon: <Brain className="w-4 h-4" /> },
    { id: 'soul', label: 'Soul', icon: <Flower2 className="w-4 h-4" /> },
    { id: 'plugins', label: 'Plugins', icon: <Puzzle className="w-4 h-4" /> },
  ];
  const navBtn = (on: boolean) => cx('w-full h-9 px-2.5 flex items-center gap-2.5 rounded-[8px] text-[13px] text-left', on ? 'bg-[var(--pressed)] font-medium' : 'text-[var(--color-text-muted)] hover:bg-[var(--hover)] hover:text-[var(--color-text-main)]');

  return (
    <div className="flex-1 min-h-0 flex bg-[var(--color-bg-panel)] overflow-hidden">
      <SidebarPane label="Tasks">
        <div className="p-3"><Btn variant="primary" className="w-full" icon={<Plus className="w-3.5 h-3.5" />} onClick={newTask}>New Task</Btn></div>
        <nav className="px-2 space-y-0.5" aria-label="Tasks sections">
          {SECTIONS.map((t) => <button key={t.id} type="button" aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)} className={navBtn(tab === t.id)}>{t.icon}{t.label}</button>)}
        </nav>
        {tab === 'skills' && <div className="px-3 pt-3"><Segmented<'yours' | 'all'> label="Which skills" value={skillView} onChange={setSkillView} options={[{ id: 'yours', label: 'Yours' }, { id: 'all', label: 'All' }]} /></div>}
        <div className="flex-1" />
        <div className="px-2 py-2 border-t border-[var(--sep)]"><AgentsButton /></div>
      </SidebarPane>
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">

      {ollamaUp === false && settings.llmBackend === 'ollama' && <EngineNotice id="ollama" purpose="" note="Lotus can't work on tasks or run routines until it starts. You can still plan on the board." className="px-4 pt-2" />}
      {ollamaUp === false && settings.llmBackend === 'builtin' && <BuiltinNotice kind="chat" purpose="so Lotus can work on tasks" className="px-4 pt-2" />}
      <PendingApprovals className="px-4 pt-3" />
      {notice && <div className="px-4 pt-3"><Banner tone="warn" action={<Btn size="sm" onClick={store.clearNotice}>OK</Btn>}>{notice}</Banner></div>}

      {tab === 'board' && (
        <div className="flex-1 min-h-0 flex">
          <KanbanBoard all={tasks} selected={sel} onSelect={setSel} />
          {cur && <TaskInspector key={cur.id} task={cur} all={tasks} onClose={() => setSel(null)} />}
        </div>
      )}
      {tab === 'routines' && <RoutinesView list={routines} />}
      {tab === 'skills' && skillView === 'yours' && <SkillsView settings={settings} onSettings={onSettings} />}
      {tab === 'skills' && skillView === 'all' && <LibraryPane tab="skills" settings={settings} onSettings={onSettings} folder={folder} />}
      {(tab === 'memory' || tab === 'soul' || tab === 'plugins') && <LibraryPane tab={tab} settings={settings} onSettings={onSettings} folder={folder} />}
      </div>
    </div>
  );
};
