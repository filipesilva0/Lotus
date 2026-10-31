// Session 5 render smoke test: server-side renders every new screen and panel with realistic data
// and checks that key text appears. Catches crashes and missing wiring, not layout.
import './s5-setup';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MarkdownLite } from '../../src/lib/markdownLite';
import { KanbanBoard } from '../../src/components/tasks/KanbanBoard';
import { TaskInspector } from '../../src/components/tasks/TaskInspector';
import { RoutinesView } from '../../src/components/tasks/RoutinesView';
import { SkillsView } from '../../src/components/tasks/SkillsView';
import { ScalingCard } from '../../src/components/hardware/ScalingCard';
import { Composer } from '../../src/components/chat/Composer';
import { ChatStream } from '../../src/components/chat/ChatStream';
import { EngineScalingPanel, MemorySkillsPanel, WebSearchPanel } from '../../src/components/modals/LocalAgentSettings';
import { TasksWorkspace } from '../../src/components/workspaces/TasksWorkspace';
import { AgentPanel } from '../../src/components/builder/AgentPanel';
import { LotusMark } from '../../src/components/common/LotusMark';
import { TitleBar } from '../../src/components/common/TitleBar';
import { LeftRail } from '../../src/components/rail/LeftRail';
import { SidebarPane, InspectorPane } from '../../src/components/common/Pane';
import { PanelsProvider } from '../../src/lib/panels';
import { PAGE_PALETTE, PETAL_ORDER } from '../../src/styles/theme';
import { newTask, addLink, Task } from '../../src/tasks/kanban';
import type { Routine } from '../../src/tasks/store';
import type { ChatSession, LotusSettings } from '../../src/types/lotus';

let pass = 0, fail = 0;
const norm = (h: string) => h.replace(/<!-- -->/g, '').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
function check(name: string, el: React.ReactElement, ...expect: string[]) {
  try {
    const html = norm(renderToString(el));
    const miss = expect.filter((e) => !html.includes(e));
    if (miss.length) throw new Error(`missing: ${miss.join(' | ')}`);
    pass++; console.log(`  ✓ ${name}`);
  } catch (e) { fail++; console.log(`  ✗ ${name}: ${(e as Error).message}`); }
}

function absent(name: string, el: React.ReactElement, ...never: string[]) {
  try {
    const html = norm(renderToString(el));
    const hit = never.filter((e) => html.includes(e));
    if (hit.length) throw new Error(`should not contain: ${hit.join(' | ')}`);
    pass++; console.log(`  ✓ ${name}`);
  } catch (e) { fail++; console.log(`  ✗ ${name}: ${(e as Error).message}`); }
}

const settings = {
  selectedModel: 'qwen3:8b', llmBackend: 'ollama', llamacppUrl: 'http://127.0.0.1:8080', autoScale: true, vramReserveMb: 1024, maxSubagents: 4,
  contextWindow: 4096, webSearchProvider: 'searxng', searxngUrl: 'http://127.0.0.1:8888', webPagesToRead: 3, autoMemory: true, autoSkills: true, sessionRecall: true,
} as unknown as LotusSettings;
const noop = () => undefined;

let tasks: Task[] = [];
tasks.push(newTask('t1', { title: 'Write the release notes', assignee: 'lotus', priority: 'high', labels: ['docs'], due: '2020-01-01' }, tasks));
tasks.push(newTask('t2', { title: 'Publish v0.2', status: 'backlog' }, tasks));
tasks = addLink(tasks, 't1', 'blocks', 't2').tasks;
tasks[0] = { ...tasks[0], steps: [{ id: 's1', text: 'Collect changes', done: true, result: 'Done **well**' }, { id: 's2', text: 'Write it', done: false }], run: { state: 'running', jobId: 'j' }, result: '| a | b |\n|---|---|\n| 1 | 2 |' };

const routine: Routine = { id: 'r1', name: 'Morning briefing', prompt: 'News please', schedule: '45 7 * * 1-5', enabled: true, action: 'log', web: true, catchUp: false, runs: [{ at: Date.now(), ok: true, output: '- item **one**', ms: 1200 }], created: 0 };

const session: ChatSession = {
  id: 's', title: 't', model: 'm', updatedAt: '', category: '', ts: 0, messages: [
    { id: 'u', role: 'user', content: 'Compare **A** and B', timestamp: '' },
    { id: 'a', role: 'assistant', content: '| A | B |\n|:-|-:|\n| x | y |\n\n- [x] done', timestamp: '', thinking: '### Analysis\nok', mode: { thinking: true, web: true }, recall: { memories: 2, sessions: 1, skills: ['Compare products'], projectFiles: 1 }, tools: [{ id: '1', label: 'Searching the web', status: 'done' }] },
  ],
};

check('GFM renderer: table, task list, code, footnote', <MarkdownLite text={'# T\n| A | B |\n|---|:-:|\n| 1 | 2 |\n\n- [x] ok\n\n```ts\nconst a = 1;\n```\n\nNote[^1]\n\n[^1]: Foot'} onDark={false} />, '<table', '<th', 'type="checkbox"', 'const a = 1;', 'Footnotes', '<h1');
check('Kanban board: columns, card, blocked badge, running', <KanbanBoard all={tasks} selected="t1" onSelect={noop} />, 'Backlog', 'To do', 'In progress', 'Review', 'Done', 'Write the release notes', 'Blocked by 1', 'Lotus is working', '1/2');
check('Task inspector: agent, steps, links, result table', <TaskInspector task={tasks[0]} all={tasks} onClose={noop} />, 'Collect changes', 'Blocks', 'Publish v0.2', '<table', 'Search the web first');
check('Routines: list + editor + run history', <RoutinesView list={[routine]} />, 'Morning briefing', 'Weekdays at 07:45', 'Search the web first', 'Runs');
check('Routines: empty state with examples', <RoutinesView list={[]} />, 'Scheduled routines', 'Morning briefing');
check('Skills: empty state', <SkillsView settings={settings} onSettings={noop} />, 'No skills yet', 'Write and improve skills automatically');
check('Scaling card (nothing measured yet)', <ScalingCard />, 'Auto-scaling to video memory', 'Context window', 'Background agents', 'could not be read');
// Session 8: chat bar redesign. Memory and incognito are icon-only toggles in the tray under the box; the
// context gauge is a bar along the box's top edge; + attaches files; Choose folder / Library / Plugins sit in the tray.
check('Composer: Think, Web, model picker, tray, context bar', <Composer model="m" streaming={false} sendOnEnter models={[{ id: 'm', name: 'm', tag: '8B' }]} onModel={noop} onOpenModels={noop} onAttachFolder={async () => undefined} thinkingOn webOn={false} onToggleWeb={noop} onToggleThinking={noop}
  memoryOn incognito={false} onToggleMemory={noop} onToggleIncognito={noop} contextUsed={0.4} contextTitle="Context: 1,000 of 4,096 tokens used" onOpenLibrary={noop} onResearch={noop}
  mentions={[]} onSend={() => []} onCommand={noop} onStop={noop} />, '>Think<', '>Web<', 'aria-pressed="true"', 'Attach files', 'Model for this chat', 'Choose folder', '>Library<', '>Plugins<', 'aria-label="Memory on', 'aria-label="Incognito', 'role="meter"', 'aria-valuenow="40"');
absent('Composer: no separate memory / incognito text buttons, no hint line', <Composer model="m" streaming={false} sendOnEnter models={[]} onModel={noop} onOpenModels={noop} onAttachFolder={async () => undefined} thinkingOn={false} webOn={false} onToggleWeb={noop} onToggleThinking={noop}
  memoryOn incognito={false} onToggleMemory={noop} onToggleIncognito={noop} contextUsed={0} contextTitle="" onOpenLibrary={noop} onResearch={noop}
  mentions={[]} onSend={() => []} onCommand={noop} onStop={noop} />, '>Memory<', '>Incognito<', 'Markdown supported');
check('Chat stream: GFM reply, recall line, mode chips', <ChatStream session={session} isStreaming={false} autoScroll={false} reasoningMode="collapsed" onEdit={noop} onRegenerate={noop} onSwitch={noop} onMemory={noop} onOpenArtifact={noop} />, '<table', 'Thinking mode', 'Web search', 'Used 2 memories · 1 past chat · skill: Compare products · 1 project file', '<strong');
check('Settings: engine & VRAM', <EngineScalingPanel settings={settings} onUpdateSettings={noop} />, 'Model server', 'Auto-scale to video memory', 'Keep free for other apps');
check('Settings: web search', <WebSearchPanel settings={settings} onUpdateSettings={noop} />, 'SearXNG address', 'Pages to read');
check('Settings: memory & skills', <MemorySkillsPanel settings={settings} onUpdateSettings={noop} />, 'Learn from conversations', 'Recall past conversations', 'Clear conversation search index');
check('Tasks workspace (board tab)', <TasksWorkspace settings={settings} onSettings={noop} ollamaUp={false} />, 'Backlog', 'Ollama isn');

// ── Session 8: petal mark, page accents, folded rail, title-bar panel toggles ──
check('Lotus mark: the user\'s own five-petal art, unchanged', <LotusMark label="Lotus" />, '<img', 'alt="Lotus"');
{
  const ok5 = PETAL_ORDER.length === 5 && new Set(PETAL_ORDER.map((v) => PAGE_PALETTE[v])).size === 5 && !(PETAL_ORDER as string[]).includes('research');
  if (ok5) { pass++; console.log('  ✓ Five pages, five petals, five distinct accents (Research lives in Chat)'); }
  else { fail++; console.log('  ✗ Five pages, five petals, five distinct accents'); }
}
check('App Builder agent: same prompt box (Plan first, model picker, round send, New chat in the tray)', <AgentPanel items={[]} running={false} approval={null} mode="plan" onMode={noop} model="qwen2.5-coder:7b" ollamaUp hasProject
  models={[{ id: 'qwen2.5-coder:7b', name: 'qwen2.5-coder:7b' }]} onModel={noop} onSend={noop} onStop={noop} onApprovePlan={noop} onReset={noop} onOpenEngines={noop} />, '>Plan first<', 'Model the agent uses', 'aria-label="Send"', '>New chat<', 'rounded-[24px]');
const eng = { ollama: { up: true }, comfyui: { up: false }, voicebox: { up: false } } as never;
absent('Rail is always folded: no visible page names, no Research page, no Models/Settings in the profile menu', <LeftRail currentView="chat" onSelectView={noop} onOpenSettings={noop} onOpenAccount={noop} onOpenLibrary={noop} engines={eng} dark={false} />, '>Chat<', '>Images<', '>Settings<', '>Profile<', 'data-tip="Research"');
check('Rail: tips name every page', <LeftRail currentView="images" onSelectView={noop} onOpenSettings={noop} onOpenAccount={noop} onOpenLibrary={noop} engines={eng} dark={false} />, 'data-tip="Chat"', 'data-tip="Images"', 'data-tip="App Builder"', 'data-tip="Engines & Models"', 'data-tip="Settings"');
check('Title bar: left and right panel toggles', <TitleBar canGoBack={false} canGoForward={false} onBack={noop} onForward={noop} leftPanel rightPanel={false} onToggleLeft={noop} onToggleRight={noop} menus={[]} />, 'aria-label="Hide left panel"', 'aria-label="Show right panel"');
absent('Title bar: no sidebar toggle any more', <TitleBar canGoBack={false} canGoForward={false} onBack={noop} onForward={noop} leftPanel rightPanel onToggleLeft={noop} onToggleRight={noop} menus={[]} />, 'sidebar');
const panes = <><SidebarPane label="L"><p>left-body</p></SidebarPane><InspectorPane label="R"><p>right-body</p></InspectorPane><InspectorPane label="M" pinned><p>main-body</p></InspectorPane></>;
check('Panels shown by default', <PanelsProvider value={{ left: true, right: true, setLeft: noop, setRight: noop }}>{panes}</PanelsProvider>, 'left-body', 'right-body', 'main-body');
absent('Panels hidden by the title-bar toggles (pinned main content stays)', <PanelsProvider value={{ left: false, right: false, setLeft: noop, setRight: noop }}>{panes}</PanelsProvider>, 'left-body', 'right-body');
check('Pinned pane stays when the right panel is hidden', <PanelsProvider value={{ left: false, right: false, setLeft: noop, setRight: noop }}>{panes}</PanelsProvider>, 'main-body');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
