// The task agent: works through a Kanban task step by step with the local model.
//   1. (optional) web search on the task title
//   2. plan: if the task has no steps, the model writes 3–7 concrete steps
//   3. each unfinished step: the model does it, seeing the task, results of earlier steps, results of
//      the tasks this one depended on, and any learned skill that matches
//   4. a short write-up of the outcome
// Runs through the agent pool, so parallel tasks stay within the VRAM-safe limit.
// With the core (the desktop app), each step is a run of the core agent with its tools (files, tasks,
// memory, web, images…), approvals and the claim check (STATE #6); without it, plain model calls.

import { extractJson, llm } from '../services/llm';
import { uid } from '../lib/persist';
import { count } from '../lib/plural';
import { memoryStore, Skill } from '../memory/store';
import { readPage, searchWeb } from '../chat/webSearch';
import { hasLiveSettings, liveSettings } from '../lib/liveSettings';
import { JobCtx } from '../agents/pool';
import { agentAvailable, runAgent, type AgentStep } from '../lib/agent';
import { parseSteps, Task, TaskStep } from './kanban';

export interface RunHooks {
  get: () => Task | undefined;
  patch: (fn: (t: Task) => Task) => void;
  log: (text: string, kind?: 'agent' | 'error' | 'note') => void;
  /** Results of finished tasks this one was blocked by (dependencies). */
  dependencyResults: () => { title: string; result: string }[];
}

const SYSTEM = (t: Task, skills: Skill[], web: string, deps: { title: string; result: string }[], tools = false) => `You are Lotus, an AI agent running on the user's own computer, working through a task from their task board.
${tools ? 'Use your tools for anything they can do (files, the task board, memory, images, the web when it is on). When a step needs an action no tool can take, write exactly what the user should do so they can do it in one go.' : 'You can only think and write: you cannot run programs, open files or browse. When a step needs an action you cannot take, write exactly what the user should do (commands, settings, text to paste) so they can do it in one go.'}
Today's date: ${new Date().toDateString()}.

TASK: ${t.title}
${t.description ? `DETAILS:\n${t.description}\n` : ''}${deps.length ? `\nRESULTS OF TASKS THIS ONE DEPENDS ON:\n${deps.map((d) => `• ${d.title}:\n${d.result.slice(0, 1500)}`).join('\n')}\n` : ''}${skills.length ? `\nSKILLS YOU WROTE EARLIER (follow if relevant):\n${skills.map((s) => `### ${s.name}\n${s.body.slice(0, 1800)}`).join('\n\n')}\n` : ''}${web ? `\nWEB RESULTS (cite as [n] when used):\n${web}\n` : ''}
Write in GitHub Flavored Markdown. Be concrete and complete; no filler.`;

export function parsePlan(text: string): string[] {
  const j = extractJson<{ steps?: unknown }>(text);
  if (j && Array.isArray(j.steps)) return j.steps.filter((s): s is string => typeof s === 'string' && s.trim().length > 2).map((s) => s.trim().slice(0, 200)).slice(0, 8);
  return parseSteps(text, 8);
}

export async function runTaskAgent(h: RunHooks, c: JobCtx): Promise<string> {
  const s = hasLiveSettings() ? liveSettings() : null;
  const t0 = h.get();
  if (!t0) throw new Error('The task was deleted.');
  if (!c.model) throw new Error('No model selected. Choose one in Chat or Engines → Models.');
  const opts = { model: c.model, numCtx: c.numCtx, signal: c.signal, temperature: 0.3 };
  const withTools = agentAvailable() && s?.agentTools !== false;

  // Skills that match the task
  const ids = await memoryStore.searchSkills(`${t0.title} ${t0.description}`.slice(0, 400), 2);
  const skills = ids.map((id) => memoryStore.get().skills.find((k) => k.id === id)).filter((k): k is Skill => !!k && k.enabled);
  if (skills.length) h.log(`Using skill${skills.length > 1 ? 's' : ''}: ${skills.map((k) => k.name).join(', ')}`, 'agent');

  // Web
  let web = '';
  if (t0.web && s && !withTools) {
    try {
      h.log('Searching the web', 'agent');
      const results = await searchWeb(t0.title, { provider: s.webSearchProvider, searxngUrl: s.searxngUrl, limit: 5, signal: c.signal });
      const pages = await Promise.all(results.slice(0, Math.min(3, s.webPagesToRead)).map((r) => readPage(r.url, c.signal)));
      web = results.map((r, i) => `[${i + 1}] ${r.title} — ${r.url}\n${(pages.find((p) => p.url === r.url)?.text || r.snippet).slice(0, 1500)}`).join('\n\n');
      h.log(`Read ${pages.filter((p) => p.text).length} of ${results.length} pages`, 'agent');
    } catch (e) {
      if (c.signal.aborted) throw e;
      h.log(`Web search failed: ${(e as Error).message}`, 'error');
    }
  }

  const system = SYSTEM(t0, skills, web, h.dependencyResults(), withTools);

  // Plan
  if (!t0.steps.length) {
    h.log('Planning steps', 'agent');
    const r = await llm.chatOnce([{ role: 'system', content: system }, { role: 'user', content: 'Break this task into 3 to 7 concrete steps that, done in order, complete it. Reply with JSON only: {"steps": ["...", "..."]}' }], { ...opts, json: true, numPredict: 600 });
    const steps = parsePlan(r.content);
    if (!steps.length) throw new Error('The model did not return a usable plan. Add steps yourself, or try a larger model.');
    h.patch((t) => ({ ...t, steps: steps.map((text): TaskStep => ({ id: uid('step'), text, done: false })) }));
    h.log(`Planned ${count(steps.length, 'step')}`, 'agent');
  }

  // Steps
  for (;;) {
    const t = h.get();
    if (!t) throw new Error('The task was deleted.');
    const step = t.steps.find((x) => !x.done);
    if (!step) break;
    if (c.signal.aborted) throw new DOMException('Stopped', 'AbortError');
    const i = t.steps.indexOf(step);
    h.log(`Step ${i + 1}: ${step.text}`, 'agent');
    const before = t.steps.slice(0, i).filter((x) => x.done).map((x, k) => `Step ${k + 1} (${x.text}):\n${(x.result ?? '').slice(0, 1200)}`).join('\n\n');
    const ask = `${before ? `Work done so far:\n${before}\n\n` : ''}Now do step ${i + 1} of ${t.steps.length}: ${step.text}\nWrite the result of this step only.`;
    const result = withTools
      ? await agentStep(system, ask, step.text, t, h, c)
      : ((await llm.chatOnce([{ role: 'system', content: system }, { role: 'user', content: ask }], { ...opts, numPredict: 1800 })).content.trim() || '(no output)');
    h.patch((x) => ({ ...x, steps: x.steps.map((st) => (st.id === step.id ? { ...st, done: true, result: result.slice(0, 6000) } : st)) }));
  }

  // Write-up
  const t = h.get()!;
  h.log('Writing the summary', 'agent');
  const all = t.steps.map((x, k) => `Step ${k + 1} (${x.text}):\n${(x.result ?? '').slice(0, 1500)}`).join('\n\n');
  const r = await llm.chatOnce([
    { role: 'system', content: system },
    { role: 'user', content: `All steps are done:\n${all}\n\nWrite the final result for the user: what was produced or decided, the key output (complete, ready to use), and anything they must do themselves. Markdown.` },
  ], { ...opts, numPredict: 2000 });
  return r.content.trim();
}

/** One step as a core agent run: its tool steps go to the task's log, waiting approvals included. */
async function agentStep(system: string, ask: string, stepText: string, t: Task, h: RunHooks, c: JobCtx): Promise<string> {
  const seen = new Map<string, string>();
  const note = (st: AgentStep) => {
    const line = st.status === 'waiting' ? `Waiting for your permission: ${st.ask ?? st.label} (Allow or Deny on the Tasks page or the island)`
      : st.status === 'running' ? '' : `${st.label}: ${st.detail ?? st.status}`;
    if (!line || seen.get(st.id) === line) return;
    seen.set(st.id, line);
    h.log(line, st.status === 'error' || st.status === 'denied' ? 'error' : 'agent');
  };
  const done = await runAgent({
    model: c.model, prompt: stepText, unattended: true,
    messages: [{ role: 'system', content: system }, { role: 'user', content: ask }],
    options: { numCtx: c.numCtx, temperature: 0.3, numPredict: 1800 },
    memoryOn: true, web: !!t.web,
  }, (e) => { if (e.kind === 'step') note(e.step); }, c.signal);
  if (done.unverified.length) h.log(`Not backed by a step: ${done.unverified.join(', ')}`, 'error');
  return done.content.trim() || '(no output)';
}
