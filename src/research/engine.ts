// The research pipeline. A supervisor starts one agent per sub-topic (a few at a time);
// each agent loops: write queries -> search repositories -> filter -> read abstracts.
// The supervisor then writes a cited report from the collected evidence.
//
// All state lives in the Project object; the engine only calls api.patch().

import { ollamaClient } from '../services/ollamaService';
import { EngineError } from '../lib/http';
import { Project, Source, AgentState, RepoId, SubTopic } from './types';
import { searchRepo, REPO_INFO } from './repos';
import { LlmCtx, proposeQueries, extractFindings, buildSynthesisPrompt } from './llm';

export interface RunApi {
  get(): Project;
  patch(fn: (p: Project) => Project): void;
}

export class RunControl {
  paused = false;
  private abortCtl = new AbortController();
  private waiters: (() => void)[] = [];
  get signal() { return this.abortCtl.signal; }
  get stopped() { return this.abortCtl.signal.aborted; }
  pause() { this.paused = true; }
  resume() { this.paused = false; this.waiters.splice(0).forEach((w) => w()); }
  stop() { this.abortCtl.abort(); this.resume(); }
  /** Agents call this between steps: it blocks while paused and throws once stopped. */
  async gate(): Promise<void> {
    while (this.paused && !this.stopped) await new Promise<void>((r) => this.waiters.push(r));
    if (this.stopped) throw new EngineError('Stopped', 'Research');
  }
}

const now = () => Date.now();
const agentIdFor = (t: SubTopic) => `agent-${t.id}`;
const keyOf = (s: Source) => (s.doi ? s.doi.toLowerCase() : s.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());

export function newAgent(t: SubTopic): AgentState {
  return { id: agentIdFor(t), topicId: t.id, title: t.title, status: 'queued', action: 'Waiting for a free slot', iteration: 0, log: [], sourceIds: [], tokensIn: 0, tokensOut: 0, ctxPeak: 0 };
}

const credWeight = { high: 3, medium: 2, preprint: 1.5, unknown: 1 } as const;

/** Why a source is skipped (or null to keep it). Reads limits fresh so steering applies immediately. */
export function rejectReason(s: Source, p: Project): string | null {
  const L = p.limits;
  if (s.abstract.length < 60) return 'no abstract to read';
  if (L.yearCutoff && s.year && s.year < L.yearCutoff) return `older than ${L.yearCutoff}`;
  if (L.excludedDomains.some((d) => d && (s.domain === d || s.domain.endsWith(`.${d}`)))) return 'excluded domain';
  if (L.requiredKeywords.length) {
    const hay = `${s.title} ${s.abstract}`.toLowerCase();
    if (!L.requiredKeywords.some((k) => hay.includes(k.toLowerCase()))) return 'missing required keywords';
  }
  return null;
}

export async function runResearch(api: RunApi, ctl: RunControl): Promise<void> {
  const p0 = api.get();
  const plan = p0.plan;
  api.patch((p) => ({
    ...p, phase: 'running', startedAt: now(), finishedAt: undefined, error: undefined, paused: false, progress: 0, report: '',
    agents: plan.map(newAgent), sources: [], queries: [], tokensIn: 0, tokensOut: 0, supervisorCtx: 0,
  }));

  const seen = new Set<string>();
  const totalSteps = Math.max(1, plan.length * p0.limits.maxDepth);
  let doneSteps = 0;
  const bump = () => api.patch((p) => ({ ...p, progress: Math.min(0.92, ++doneSteps / totalSteps) * 0.92, updatedAt: now() }));

  const queue = [...plan];
  const worker = async () => {
    while (queue.length && !ctl.stopped) {
      const topic = queue.shift()!;
      try { await runAgent(api, ctl, topic, seen, bump); }
      catch (e) {
        if (ctl.stopped) return;
        if (e instanceof EngineError && e.unreachable) throw e;
        patchAgent(api, agentIdFor(topic), { status: 'error', action: (e as Error).message });
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.max(1, Math.min(p0.limits.parallelAgents, plan.length)) }, worker));
    if (ctl.stopped) throw new EngineError('Stopped', 'Research');
    await synthesize(api, ctl);
  } catch (e) {
    const unreachable = e instanceof EngineError && e.unreachable;
    api.patch((p) => ({ ...p, phase: 'stopped', paused: false, error: ctl.stopped ? undefined : unreachable ? `Can't reach Ollama. Start it from the Engines tab, then use "Resume" to continue.` : (e as Error).message }));
  }
}

function patchAgent(api: RunApi, id: string, patch: Partial<AgentState>) {
  api.patch((p) => ({ ...p, agents: p.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
}
function logLine(api: RunApi, id: string, text: string, action?: string) {
  api.patch((p) => ({ ...p, agents: p.agents.map((a) => (a.id === id ? { ...a, action: action ?? a.action, log: [...a.log.slice(-59), { t: now(), text }] } : a)) }));
}

async function runAgent(api: RunApi, ctl: RunControl, topic: SubTopic, seen: Set<string>, bump: () => void) {
  const id = agentIdFor(topic);
  patchAgent(api, id, { status: 'running', action: 'Starting' });
  const llm = (): LlmCtx => ({
    model: api.get().model, numCtx: api.get().numCtx, signal: ctl.signal,
    onUsage: (pt, et) => api.patch((p) => ({
      ...p, tokensIn: p.tokensIn + pt, tokensOut: p.tokensOut + et,
      agents: p.agents.map((a) => (a.id === id ? { ...a, tokensIn: a.tokensIn + pt, tokensOut: a.tokensOut + et, ctxPeak: Math.max(a.ctxPeak, pt) } : a)),
    })),
  });

  const notes: string[] = [];
  const tried: string[] = [];
  let collected = 0;

  for (let iter = 1; iter <= api.get().limits.maxDepth; iter++) {
    await ctl.gate();
    const L = api.get().limits;
    if (collected >= L.maxSourcesPerAgent) break;
    patchAgent(api, id, { iteration: iter });
    logLine(api, id, `Round ${iter}: thinking about what to search for`, `Planning round ${iter} queries`);

    const { queries, done } = await proposeQueries(llm(), { topic, question: api.get().question, notes, injected: api.get().injected, iteration: iter, tried });
    const fresh = queries.filter((q) => !tried.includes(q)).slice(0, 3);
    if ((done && iter > 1) || !fresh.length) { logLine(api, id, 'Enough evidence gathered; wrapping up'); bump(); break; }
    tried.push(...fresh);

    const repos = (Object.keys(L.repos) as RepoId[]).filter((r) => L.repos[r]);
    const candidates: Source[] = [];
    for (const q of fresh) {
      await ctl.gate();
      logLine(api, id, `Searching: "${q}"`, `Querying ${repos.map((r) => REPO_INFO[r].name).join(', ')}`);
      const results = await Promise.all(repos.map((r) => searchRepo(r, q, { limit: 6, yearFrom: L.yearCutoff, language: L.language, signal: ctl.signal })));
      for (const r of results) {
        api.patch((p) => ({ ...p, queries: [...p.queries.slice(-199), { t: now(), agentId: id, repo: r.repo, query: q, status: r.status, ms: r.ms, count: r.sources.length }] }));
        if (r.error) logLine(api, id, `${REPO_INFO[r.repo].name}: ${r.error}`);
        for (const s of r.sources) {
          const k = keyOf(s);
          if (seen.has(k)) continue;
          const why = rejectReason(s, api.get());
          if (why) continue;
          seen.add(k);
          candidates.push({ ...s, agentId: id, query: q });
        }
      }
    }

    const room = L.maxSourcesPerAgent - collected;
    const take = candidates
      .sort((a, b) => credWeight[b.credibility] - credWeight[a.credibility] || b.abstract.length - a.abstract.length)
      .slice(0, Math.max(0, Math.min(room, 12)));
    if (!take.length) { logLine(api, id, 'No new usable papers this round'); bump(); continue; }

    api.patch((p) => ({ ...p, sources: [...p.sources, ...take], agents: p.agents.map((a) => (a.id === id ? { ...a, sourceIds: [...a.sourceIds, ...take.map((s) => s.id)] } : a)) }));
    collected += take.length;

    for (let i = 0; i < take.length; i += 4) {
      await ctl.gate();
      const batch = take.slice(i, i + 4);
      logLine(api, id, `Reading ${batch.length} abstract${batch.length > 1 ? 's' : ''}`, `Reading abstracts (${Math.min(i + 4, take.length)}/${take.length})`);
      const found = await extractFindings(llm(), topic, batch);
      Object.values(found).forEach((f) => { if (f.finding) notes.push(f.finding); });
      api.patch((p) => ({ ...p, sources: p.sources.map((s) => (found[s.id] ? { ...s, finding: found[s.id].finding, relevance: found[s.id].relevance } : s)) }));
    }
    bump();
  }

  patchAgent(api, id, { status: 'done', action: `Done: ${collected} source${collected === 1 ? '' : 's'}` });
}

// ── Synthesis ───────────────────────────────────────────────────────────────

const shortAuthors = (a: string[]) => (a.length === 0 ? 'Unknown' : a.length <= 2 ? a.join(' & ') : `${a[0]} et al.`);

export function formatReferences(refs: Source[]): string {
  return refs.map((s, i) => `${i + 1}. ${shortAuthors(s.authors)} (${s.year ?? 'n.d.'}). ${s.title}. *${REPO_INFO[s.repo].name}*. ${s.doi ? `https://doi.org/${s.doi}` : s.url}`).join('\n');
}

/** Removes citations that do not point at a real reference, so the model cannot cite what was never fetched. */
export function cleanCitations(text: string, refCount: number): string {
  return text.replace(/\[(\d+(?:\s*[,;-]\s*\d+)*)\]/g, (m, inner: string) => {
    const nums = inner.split(/[,;-]/).map((n) => Number(n.trim()));
    return nums.every((n) => n >= 1 && n <= refCount) ? m : nums.filter((n) => n >= 1 && n <= refCount).length ? `[${nums.filter((n) => n >= 1 && n <= refCount).join(', ')}]` : '';
  });
}

export async function synthesize(api: RunApi, ctl: RunControl): Promise<void> {
  api.patch((p) => ({ ...p, phase: 'synthesizing', paused: false, error: undefined, report: '', progress: 0.93 }));
  const p = api.get();
  const usable = p.sources.filter((s) => !s.rejected && (s.relevance ?? 3) >= 2);
  const order = new Map(p.plan.map((t, i) => [agentIdFor(t), i]));
  const refs = usable
    .sort((a, b) => (order.get(a.agentId ?? '') ?? 99) - (order.get(b.agentId ?? '') ?? 99) || (b.relevance ?? 3) - (a.relevance ?? 3))
    .slice(0, 40);

  if (!refs.length) {
    api.patch((q) => ({ ...q, phase: 'done', finishedAt: now(), progress: 1, report: `# ${q.title}\n\nNo usable sources were found, so there is nothing to summarise.\n\nTry broader wording, enable more repositories, or relax the year, keyword or domain filters in the inspector, then start a new run.` }));
    return;
  }

  const sourcesByTopic: Record<string, number[]> = {};
  p.plan.forEach((t) => { sourcesByTopic[t.id] = refs.map((s, i) => (s.agentId === agentIdFor(t) ? i + 1 : 0)).filter(Boolean); });
  const turns = buildSynthesisPrompt({ question: p.question, clarifications: p.clarifications, plan: p.plan, personas: p.personas, refs, sourcesByTopic });
  const promptChars = turns.reduce((n, t) => n + t.content.length, 0);
  api.patch((q) => ({ ...q, supervisorCtx: Math.round(promptChars / 4) }));

  let text = '';
  let lastPush = 0;
  let tokens = 0;
  try {
    for await (const tok of ollamaClient.streamChat(turns, { model: p.model, numCtx: p.numCtx, temperature: 0.4, signal: ctl.signal }, (s) => { tokens = s.totalTokens; })) {
      text += tok;
      if (Date.now() - lastPush > 150) { lastPush = Date.now(); const snap = text; api.patch((q) => ({ ...q, report: snap })); }
    }
  } catch (e) {
    if (ctl.stopped) { api.patch((q) => ({ ...q, report: text, phase: 'stopped' })); return; }
    throw e;
  }
  const final = `${cleanCitations(text.trim(), refs.length)}\n\n## References\n\n${formatReferences(refs)}`;
  api.patch((q) => ({ ...q, report: final, phase: 'done', finishedAt: now(), progress: 1, tokensIn: q.tokensIn + Math.round(promptChars / 4), tokensOut: q.tokensOut + tokens }));
}
