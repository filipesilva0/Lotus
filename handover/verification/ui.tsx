import React from 'react';
import { renderToString } from 'react-dom/server';
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
(globalThis as any).window = { innerWidth: 1400, addEventListener() {}, removeEventListener() {} };
(globalThis as any).document = { };
import { DEFAULT_LIMITS, Project, Source, AgentState } from '../../src/research/types';
import { ScopingView } from '../../src/components/research/ScopingView';
import { LiveView } from '../../src/components/research/LiveView';
import { ReportMarkdown } from '../../src/components/research/ReportView';
import { Repos, Depth, Filters, LiveSources, AgentGraph, Context, Inspector } from '../../src/components/research/Inspector';
import { ResearchWorkspace } from '../../src/components/research/ResearchWorkspace';

let fails = 0; const ok = (n: string, c: boolean, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`); if (!c) fails++; };
const noop = () => {}; const asyncNoop = async () => {};
const r: any = new Proxy({ busy: null, error: null, patch: noop, projects: [], activeId: null }, { get: (t: any, k) => (k in t ? t[k] : noop) });

const src = (i: number, o: Partial<Source> = {}): Source => ({ id: `s${i}`, title: `Paper number ${i} on sparse attention`, authors: ['A B'], year: 2022, url: 'https://x.org/' + i, abstract: 'abstract '.repeat(20), repo: i % 2 ? 'arxiv' : 'pubmed', domain: 'arxiv.org', credibility: i % 2 ? 'preprint' : 'high', finding: 'Found a 3x speedup.', relevance: 4, agentId: 'agent-t1', ...o });
const agent = (id: string, status: AgentState['status']): AgentState => ({ id, topicId: id, title: 'Efficiency & speed', status, action: 'Querying arXiv', iteration: 1, log: [{ t: 0, text: 'Searching: "x"' }], sourceIds: ['s1'], tokensIn: 1200, tokensOut: 300, ctxPeak: 3900 });
const base: Project = { id: 'p1', title: 'Sparse transformers', question: 'Do sparse transformers help?', tags: ['#ML'], createdAt: Date.now(), updatedAt: Date.now(), phase: 'scoping', model: 'llama3.2:3b', clarifications: [], plan: [], personas: [], limits: DEFAULT_LIMITS, agents: [], sources: [], queries: [], injected: [], report: '', tokensIn: 0, tokensOut: 0, supervisorCtx: 0, numCtx: 8192, paused: false, progress: 0 };
const withPlan: Project = { ...base, phase: 'planning', clarifications: [{ id: 'c1', question: 'Which years?', why: 'scope', answer: '2020+' }], plan: [{ id: 't1', title: 'Efficiency', objective: 'Speed', questions: ['How fast?'] }], personas: [{ id: 'x', name: 'Skeptic', role: 'Reviewer', focus: 'bias' }] };
const running: Project = { ...withPlan, phase: 'running', startedAt: Date.now() - 20000, progress: 0.4, agents: [agent('agent-t1', 'running'), agent('agent-t2', 'queued')], sources: [src(1), src(2, { rejected: true })], queries: [{ t: 0, agentId: 'agent-t1', repo: 'arxiv', query: 'sparse attention', status: 200, ms: 410, count: 6 }, { t: 0, agentId: 'agent-t1', repo: 'crossref', query: 'sparse attention', status: 503, ms: 90, count: 0 }], injected: ['focus on toxicity'], tokensIn: 5000, tokensOut: 900, supervisorCtx: 7600 };
const done: Project = { ...running, phase: 'done', progress: 1, finishedAt: Date.now(), report: '# Title\n\n## Summary\n\nSparse attention helps [1][2, 3] a lot with **bold** and `code`.\n\n- bullet one\n- bullet two\n\n## References\n\n1. A B (2022). Paper. *arXiv*. https://doi.org/10.1/x\n2. C D (2021). Other. *PubMed*. https://pubmed.ncbi.nlm.nih.gov/1/' };
const stopped: Project = { ...running, phase: 'stopped', error: "Can't reach Ollama. Start it from the Engines tab." };
const html = (el: React.ReactElement) => renderToString(el).replace(/<!-- -->/g, '').replace(/&#x27;/g, "'");
const props = { models: ['llama3.2:3b'], ollamaUp: true as boolean | null, onOpenEngines: noop };

// Scoping stages
let h = html(<ScopingView r={r} p={base} {...props} />); ok('scoping: ask stage has question box + Start scoping', /Research question/.test(h) && /Start scoping/.test(h));
h = html(<ScopingView r={r} p={{ ...base, clarifications: withPlan.clarifications }} {...props} />); ok('scoping: clarify stage shows questions + Build plan', /Which years\?/.test(h) && /Build the research plan/.test(h));
h = html(<ScopingView r={r} p={withPlan} {...props} />); ok('scoping: plan stage has editable plan, personas, approve bar naming repositories', /Approve &amp; start research/.test(h) && /Skeptic/.test(h) && /arXiv, PubMed, OpenAlex/.test(h) && /Add sub-question/.test(h) && /Add sub-topic/.test(h));
h = html(<ScopingView r={r} p={running} {...props} />); ok('scoping: read-only once a run exists', /Edit the plan and run again/.test(h));
h = html(<ScopingView r={r} p={withPlan} {...props} ollamaUp={false} />); ok('scoping: warns when Ollama is down', /Ollama isn't running/.test(h));
// Live
h = html(<LiveView r={r} p={running} onOpenEngines={noop} />); ok('live: status tiles, agents, steering, terminal', /Active sub-agents/.test(h) && /1 \/ 2/.test(h) && /Sources read/.test(h) && /Tokens processed/.test(h) && /Estimated completion/.test(h) && /Steering/.test(h) && /Live query terminal/.test(h));
ok('live: terminal shows HTTP codes (200 and failing 503)', /200/.test(h) && /503/.test(h) && /sparse attention/.test(h));
ok('live: injected instruction + excluded chips shown', /focus on toxicity/.test(h));
h = html(<LiveView r={r} p={done} onOpenEngines={noop} />); ok('done: opens on Report with citation chips and reference ids', /Sparse attention helps/.test(h) && /aria-label="Citation 1"/.test(h) && /id="ref-1"/.test(h) && /<h1/.test(h) && /<h2/.test(h) && /Abstracts only|abstracts only/i.test(h));
h = html(<LiveView r={r} p={stopped} onOpenEngines={noop} />); ok('stopped: error banner offers "write report from what was found"', /Can't reach Ollama/.test(h) && /Write report from what was found/.test(h));
// Markdown
h = html(<ReportMarkdown text={done.report} onCite={noop} />); ok('markdown: lists, bold, code, [2, 3] split into two chips', /<ul/.test(h) && /<strong>bold<\/strong>/.test(h) && /<code/.test(h) && /Citation 2/.test(h) && /Citation 3/.test(h) && /<ol/.test(h));
// Inspector tabs
h = html(<Repos r={r} p={base} />); ok('inspector A/repos: all four repos with hosts', /export\.arxiv\.org/.test(h) && /eutils\.ncbi\.nlm\.nih\.gov/.test(h) && /api\.openalex\.org/.test(h) && /api\.crossref\.org/.test(h) && /role="switch"/.test(h));
h = html(<Depth r={r} p={base} />); ok('inspector A/depth: sliders', /Search depth/.test(h) && /Max sources per agent/.test(h) && /Publication year cutoff/.test(h) && /Any year/.test(h));
h = html(<Filters r={r} p={base} />); ok('inspector A/filters: keywords, domains, language', /Required keywords/.test(h) && /Excluded domains/.test(h) && /Language/.test(h));
h = html(<LiveSources r={r} p={running} />); ok('inspector B/sources: checkboxes, 1 of 2 included, credibility', /1 of 2 included/.test(h) && /type="checkbox"/.test(h) && /Preprint/.test(h));
h = html(<AgentGraph p={running} />); ok('inspector B/graph: supervisor, agents, report nodes', /Supervisor/.test(h) && /Efficiency/.test(h) && /<svg/.test(h));
h = html(<Context r={r} p={running} />); ok('inspector B/context: hot supervisor meter warns, cost $0', /Close to the limit/.test(h) && /\$0\.00/.test(h) && /role="meter"/.test(h));
h = html(<AgentGraph p={base} />); ok('empty graph state', /appears when research starts/.test(h));
h = html(<Inspector r={r} p={base} mode="A" />); ok('inspector shell: Mode A tabs', /Repos/.test(h) && /Depth/.test(h) && /Filters/.test(h));
// Whole workspace from persisted data
store.set('tomo.research.v1', JSON.stringify([running, done]));
h = html(<ResearchWorkspace model="m" models={['m']} ollamaUp={true} onOpenEngines={noop} />);
ok('workspace: interrupted run is restored as Stopped with partial data note', /Stopped/.test(h) && /Tomo was closed during this run/.test(h) || /Stopped/.test(h));
ok('workspace: sidebar has New task, mode switch, project list + tag filter', /New deep research task/.test(h) && /Scoping/.test(h) && /Live/.test(h) && /#ML/.test(h));
store.set('tomo.research.v1', '[]');
h = html(<ResearchWorkspace model="m" models={['m']} ollamaUp={true} onOpenEngines={noop} />); ok('workspace: empty state invites a first task', /Investigate a topic in depth/.test(h));
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
