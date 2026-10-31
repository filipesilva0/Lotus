import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, FileText, FolderOpen, Hammer, PanelBottom, Plus, Save, X } from 'lucide-react';
import { contextBlock, useProjectContext } from '../../context/discover';
import { ToolbarContent } from '../common/ToolbarSlot';
import { Btn, Empty, IconBtn, Segmented, Select, Tabs, cx } from '../common/ui';
import { InspectorPane, Popover, SidebarPane } from '../common/Pane';
import { usePersisted } from '../../lib/persist';
import { isTauri } from '../../lib/http';
import { useProjects } from '../../builder/useProjects';
import { useFiles } from '../../builder/useFiles';
import { useTerminal } from '../../builder/useTerminal';
import { usePreview } from '../../builder/usePreview';
import { useAgent } from '../../builder/useAgent';
import { templateFor } from '../../builder/templates';
import { CodeEditor } from './CodeEditor';
import { FileTree } from './FileTree';
import { TerminalPanel } from './TerminalPanel';
import { PreviewPane } from './PreviewPane';
import { AgentPanel } from './AgentPanel';
import { BuildPanel } from './BuildPanel';
import { NewProjectDialog } from './NewProjectDialog';

type View = 'code' | 'preview' | 'split';
type Side = 'agent' | 'build';

interface Props {
  /** False while another page is showing: the Builder stays mounted so servers and chats keep going, but draws nothing. */
  active: boolean;
  models: { id: string; name: string }[];
  selectedModel: string;
  ollamaUp: boolean | null;
  onOpenEngines: () => void;
}

/** App Builder: a project, its files, an agent that builds it, a terminal, and the app running beside them. */
export const BuilderWorkspace: React.FC<Props> = ({ active, models, selectedModel, ollamaUp, onOpenEngines }) => {
  const projects = useProjects();
  const project = projects.active;
  const template = useMemo(() => templateFor(project?.target ?? 'blank'), [project?.target]);

  const [view, setView] = usePersisted<View>('lotus.builder.view.v1', 'split');
  const [side, setSide] = useState<Side>('agent');
  const [termOpen, setTermOpen] = usePersisted<boolean>('lotus.builder.term.v1', true);
  const [mode, setMode] = usePersisted<'plan' | 'fast'>('lotus.builder.mode.v1', 'plan');
  const [numCtx, setNumCtx] = usePersisted<number>('lotus.builder.ctx.v1', 16384);
  const [chosen, setChosen] = usePersisted<string>('lotus.builder.model.v1', '');
  const [newOpen, setNewOpen] = useState(false);

  const model = models.some((m) => m.id === chosen) ? chosen : (models.some((m) => m.id === selectedModel) ? selectedModel : models[0]?.id ?? '');

  const files = useFiles(project);
  const preview = usePreview(project, template.previewDir);
  const showServer = preview.showServer;
  const term = useTerminal(project, useCallback((url: string) => { showServer(url); setView((v) => (v === 'code' ? 'split' : v)); }, [showServer, setView]));

  // Project context files (SOUL.md, AGENTS.md, .cursorrules…) are found whenever a project is opened.
  const ctxFiles = useProjectContext(project?.path);
  const projectContext = useMemo(() => contextBlock(ctxFiles.files, { includeMemory: true, budgetChars: Math.floor(numCtx * 4 * 0.15) }).text, [ctxFiles.files, numCtx]);

  const agent = useAgent({
    project, template, model, numCtx, mode, term, projectContext,
    showPreview: async (t) => {
      if (t.url) { preview.showServer(t.url); setView((v) => (v === 'code' ? 'split' : v)); return t.url; }
      const url = await preview.serveStatic(t.dir ?? '');
      setView((v) => (v === 'code' ? 'split' : v));
      return url;
    },
    refreshFiles: files.refreshSoon,
    setAutoRun: (on) => project && projects.update(project.id, { autoRun: on }),
  });

  // Hand the files the agent changed to the editor, and keep the tree fresh while it works.
  useEffect(() => { if (!agent.running) return; const t = setInterval(files.refreshSoon, 2500); return () => clearInterval(t); }, [agent.running, files.refreshSoon]);

  const hasWorkflow = files.entries.some((e) => e.rel === '.github/workflows/build.yml');

  const openFolder = async () => {
    if (!isTauri) return;
    const { open } = await import('@tauri-apps/plugin-dialog');
    const p = await open({ title: 'Open a project folder', directory: true, multiple: false });
    if (typeof p === 'string') { await projects.addExisting(p, p.split(/[\\/]/).filter(Boolean).pop() ?? 'Project'); setNewOpen(false); }
  };

  const runAction = (command: string, server: boolean) => {
    if (server) { void term.startServer(command); setTermOpen(true); } else { void term.run(command); setTermOpen(true); }
  };

  const activeBuf = files.activePath ? files.buffers[files.activePath] : undefined;
  const showCode = view !== 'preview';
  const showPrev = view !== 'code';

  return (
    <div className="flex-1 min-h-0 flex bg-[var(--color-bg-panel)] overflow-hidden">
      {active && (
        <ToolbarContent>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Hammer className="w-4 h-4 text-[var(--color-accent-vibrant)] shrink-0" aria-hidden="true" />
            <span className="text-[13px] font-semibold truncate">App Builder</span>
            {ctxFiles.files.length > 0 && (
              <span className="inline-flex items-center gap-1 text-[12px] text-[var(--color-text-muted)]" title={`Applied to the agent: ${ctxFiles.files.map((f) => f.rel).join(', ')}`}>
                <FileText className="w-3.5 h-3.5" />{ctxFiles.files.length} context file{ctxFiles.files.length > 1 ? 's' : ''}
              </span>
            )}
            <span className="flex-1" />
            <Select aria-label="Model the agent uses" value={model} onChange={(e) => setChosen(e.target.value)} className="!w-[190px] !h-7" disabled={!models.length}>
              {!models.length && <option value="">No models installed</option>}
              {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
            <Segmented<View> label="Layout" value={view} onChange={setView} options={[{ id: 'code', label: 'Code' }, { id: 'split', label: 'Split' }, { id: 'preview', label: 'Preview' }]} />
            <IconBtn label={termOpen ? 'Hide terminal' : 'Show terminal'} active={termOpen} onClick={() => setTermOpen(!termOpen)}><PanelBottom className="w-4 h-4" /></IconBtn>
          </div>
        </ToolbarContent>
      )}

      <SidebarPane label="Projects and files">
        <div className="p-2 border-b border-[var(--sep)]">
          <Popover className="w-[232px]" trigger={(_o, t) => (
            <button type="button" onClick={t} aria-haspopup="menu" className="w-full h-8 px-2.5 flex items-center gap-2 rounded-[8px] bg-[var(--hover)] hover:bg-[var(--pressed)] text-[13px] font-medium text-left">
              <span className="flex-1 truncate">{project?.name ?? 'No project'}</span><ChevronDown className="w-3.5 h-3.5 opacity-60 shrink-0" />
            </button>)}>
            {(close) => (
              <div role="menu" aria-label="Projects">
                {projects.projects.map((p) => (
                  <button key={p.id} type="button" role="menuitem" onClick={() => { projects.setActiveId(p.id); close(); }} className={cx('w-full px-2.5 h-8 flex items-center gap-2 rounded-[6px] text-[13px] text-left hover:bg-[var(--hover)]', p.id === project?.id && 'font-semibold')}>
                    <span className="truncate flex-1">{p.name}</span><span className="text-[11px] text-[var(--color-text-muted)] shrink-0">{templateFor(p.target).platforms[0]}</span>
                  </button>
                ))}
                {!projects.projects.length && <p className="px-2.5 py-2 text-[12px] text-[var(--color-text-muted)]">No projects yet.</p>}
                <div className="my-1 border-t border-[var(--sep)]" />
                <button type="button" role="menuitem" onClick={() => { setNewOpen(true); close(); }} className="w-full px-2.5 h-8 flex items-center gap-2 rounded-[6px] text-[13px] text-left hover:bg-[var(--hover)]"><Plus className="w-3.5 h-3.5" />New project…</button>
                <button type="button" role="menuitem" onClick={() => { void openFolder(); close(); }} className="w-full px-2.5 h-8 flex items-center gap-2 rounded-[6px] text-[13px] text-left hover:bg-[var(--hover)]"><FolderOpen className="w-3.5 h-3.5" />Open a folder…</button>
              </div>
            )}
          </Popover>
        </div>
        {project
          ? <FileTree key={project.id} entries={files.entries} truncated={files.truncated} activePath={files.activePath} dirty={files.dirty}
              onOpen={(p) => { void files.open(p); if (view === 'preview') setView('split'); }} onRefresh={() => void files.refresh()}
              onCreateFile={(p) => void files.createFile(p)} onCreateFolder={(p) => void files.createFolder(p)} onRename={(a, b) => void files.rename(a, b)} onDelete={(p) => void files.remove(p)} />
          : <p className="p-3 text-[12px] text-[var(--color-text-muted)]">Projects live in folders on this PC. Create one to begin.</p>}
      </SidebarPane>

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {!project ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <Empty icon={<Hammer className="w-6 h-6" />} title="Build an app with your local model"
              body={isTauri ? 'Pick what you want to make (a website, a web app, a phone app, a desktop app), describe it, and watch it appear in the preview. Everything runs on this PC.' : 'The App Builder works with files and programs on your PC, so it needs the Lotus desktop app.'}
              action={isTauri ? <div className="flex gap-2 justify-center"><Btn variant="primary" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setNewOpen(true)}>New project</Btn><Btn onClick={() => void openFolder()}>Open a folder</Btn></div> : undefined} />
          </div>
        ) : (
          <>
            <div className="flex-1 min-h-0 flex">
              {showCode && (
                <div className={cx('min-w-0 flex flex-col min-h-0', showPrev ? 'basis-1/2 border-r border-[var(--sep)]' : 'flex-1')}>
                  <div className="h-9 shrink-0 flex items-center gap-0.5 px-1.5 border-b border-[var(--sep)] overflow-x-auto" role="tablist" aria-label="Open files">
                    {files.tabs.map((p) => (
                      <span key={p} className={cx('shrink-0 inline-flex items-center h-7 pl-2.5 pr-1 gap-1 rounded-[6px] text-[12px]', files.activePath === p ? 'bg-[var(--pressed)] font-medium' : 'hover:bg-[var(--hover)]')}>
                        <button type="button" role="tab" aria-selected={files.activePath === p} onClick={() => files.setActivePath(p)} className="max-w-[160px] truncate">{p.split('/').pop()}{files.dirty(p) ? ' •' : ''}</button>
                        <IconBtn label={`Close ${p}`} className="!w-4 !h-4" onClick={() => files.close(p)}><X className="w-3 h-3" /></IconBtn>
                      </span>
                    ))}
                    {!files.tabs.length && <span className="px-2 text-[12px] text-[var(--color-text-muted)]">Open a file from the list</span>}
                    <span className="flex-1" />
                    {files.activePath && activeBuf && !activeBuf.note && <Btn size="sm" variant="ghost" icon={<Save className="w-3 h-3" />} disabled={!files.dirty(files.activePath)} onClick={() => void files.save(files.activePath!)}>Save</Btn>}
                  </div>
                  {files.error && <p className="px-3 py-1.5 text-[12px] text-[var(--c-red)] border-b border-[var(--sep)]">{files.error}</p>}
                  {files.activePath && activeBuf
                    ? activeBuf.note
                      ? <p className="p-6 text-[13px] text-[var(--color-text-muted)]">{activeBuf.note}</p>
                      : <CodeEditor key={files.activePath} path={files.activePath} value={activeBuf.text} onChange={(v) => files.edit(files.activePath!, v)} onSave={() => void files.save(files.activePath!)} />
                    : <div className="flex-1 flex items-center justify-center text-[13px] text-[var(--color-text-muted)]">No file open</div>}
                </div>
              )}
              {showPrev && <PreviewPane preview={preview} template={template} onRun={(c) => { void term.run(c); setTermOpen(true); }} />}
            </div>
            {termOpen && <div className="h-[210px] shrink-0 border-t border-[var(--sep)]"><TerminalPanel term={term} disabled={!project} /></div>}
          </>
        )}
      </div>

      <InspectorPane label="Agent and build" className="!w-[360px]">
        <div className="h-10 shrink-0 flex items-center px-3 border-b border-[var(--sep)]">
          <Tabs<Side> label="Panel" value={side} onChange={setSide} options={[{ id: 'agent', label: 'Agent' }, { id: 'build', label: 'Build' }]} />
          {term.anyRunning && <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]"><span className="w-1.5 h-1.5 rounded-full bg-[var(--c-green)] animate-pulse" />Running</span>}
        </div>
        {side === 'agent'
          ? <AgentPanel items={agent.items} running={agent.running} approval={agent.approval} mode={mode} onMode={setMode} model={model} ollamaUp={ollamaUp} hasProject={!!project}
              onSend={(t) => void agent.send(t)} onStop={agent.stop} onApprovePlan={(id, md) => void agent.approvePlan(id, md)} onReset={agent.reset} onOpenEngines={onOpenEngines} />
          : project
            ? <BuildPanel project={project} template={template} hasWorkflow={hasWorkflow} numCtx={numCtx} onNumCtx={setNumCtx} onAutoRun={(on) => projects.update(project.id, { autoRun: on })}
                onAction={runAction} onRemove={() => projects.forget(project.id)} />
            : <p className="p-4 text-[12px] text-[var(--color-text-muted)]">Open a project to see what it can run and build.</p>}
      </InspectorPane>

      <NewProjectDialog open={newOpen} onClose={() => { setNewOpen(false); projects.clearError(); }} busy={projects.busy} error={projects.error}
        defaultParent={projects.defaultParent}
        onCreate={async (o) => !!(await projects.create(o))} onOpenFolder={() => void openFolder()} />
    </div>
  );
};
