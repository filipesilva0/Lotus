import React, { useState } from 'react';
import { useCommand } from '../../lib/commands';
import { EngineNotice } from '../common/EngineNotice';
import { AlarmClock, BookOpen, Bot, Cpu, SquareKanban, Plus, X } from 'lucide-react';
import { LotusSettings } from '../../types/lotus';
import { tasks as store, useTasks } from '../../tasks/store';
import { useAgentPool, agentPool } from '../../agents/pool';
import { useHardware } from '../../hardware/monitor';
import { usePersisted } from '../../lib/persist';
import { ToolbarContent } from '../common/ToolbarSlot';
import { Popover } from '../common/Pane';
import { Banner, Btn, IconBtn, Tabs } from '../common/ui';
import { KanbanBoard } from '../tasks/KanbanBoard';
import { TaskInspector } from '../tasks/TaskInspector';
import { RoutinesView } from '../tasks/RoutinesView';
import { SkillsView } from '../tasks/SkillsView';
import { ScalingCard } from '../hardware/ScalingCard';

type Tab = 'board' | 'routines' | 'skills';

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

/** Tasks: a Kanban board the user and Lotus share, scheduled routines, and the skills Lotus has learned. */
export const TasksWorkspace: React.FC<{ settings: LotusSettings; onSettings: (p: Partial<LotusSettings>) => void; ollamaUp: boolean | null }> = ({ settings, onSettings, ollamaUp }) => {
  const [tab, setTab] = usePersisted<Tab>('lotus.tasks.tab.v1', 'board');
  const { tasks, routines, notice } = useTasks();
  const [sel, setSel] = useState<string | null>(null);
  const cur = tasks.find((t) => t.id === sel) ?? null;
  const newTask = () => { setTab('board'); const t = store.add({ title: 'New task', status: 'todo' }); setSel(t.id); };
  useCommand('new-task', newTask);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[var(--color-bg-panel)] overflow-hidden">
      <ToolbarContent>
        <div className="flex items-stretch gap-3 flex-1 min-w-0">
          <Tabs<Tab> label="Tasks sections" value={tab} onChange={setTab} options={[
            { id: 'board', label: 'Board', icon: <SquareKanban className="w-4 h-4" /> },
            { id: 'routines', label: 'Routines', icon: <AlarmClock className="w-4 h-4" /> },
            { id: 'skills', label: 'Skills', icon: <BookOpen className="w-4 h-4" /> },
          ]} />
          <span className="flex-1" />
          <div className="flex items-center gap-2">
            <AgentsButton />
            {tab === 'board' && <Btn size="sm" variant="primary" icon={<Plus className="w-3.5 h-3.5" />} onClick={newTask}>New Task</Btn>}
          </div>
        </div>
      </ToolbarContent>

      {ollamaUp === false && settings.llmBackend === 'ollama' && <EngineNotice id="ollama" purpose="" note="Lotus can't work on tasks or run routines until it starts. You can still plan on the board." className="px-4 pt-2" />}
      {notice && <div className="px-4 pt-3"><Banner tone="warn" action={<Btn size="sm" onClick={store.clearNotice}>OK</Btn>}>{notice}</Banner></div>}

      {tab === 'board' && (
        <div className="flex-1 min-h-0 flex">
          <KanbanBoard all={tasks} selected={sel} onSelect={setSel} />
          {cur && <TaskInspector key={cur.id} task={cur} all={tasks} onClose={() => setSel(null)} />}
        </div>
      )}
      {tab === 'routines' && <RoutinesView list={routines} />}
      {tab === 'skills' && <SkillsView settings={settings} onSettings={onSettings} />}
    </div>
  );
};
