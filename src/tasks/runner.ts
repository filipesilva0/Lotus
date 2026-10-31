// The task agent: works through a Kanban task step by step with the local model.
//   1. (optional) web search on the task title
//   2. plan: if the task has no steps, the model writes 3–7 concrete steps
//   3. each unfinished step: the model does it, seeing the task, results of earlier steps, results of
//      the tasks this one depended on, and any learned skill that matches
//   4. a short write-up of the outcome
// Runs through the agent pool, so parallel tasks stay within the VRAM-safe limit.

import { extractJson, llm } from '../services/llm';
import { uid } from '../lib/persist';
import { memoryStore, Skill } from '../memory/store';
import { readPage, searchWeb } from '../chat/webSearch';
import { hasLiveSettings, liveSettings } from '../lib/liveSettings';
import { JobCtx } from '../agents/pool';
import { parseSteps, Task, TaskStep } from './kanban';

export interface RunHooks {
  get: () => Task | undefined;
  patch: (fn: (t: Task) => Task) => void;
  log: (text: string, kind?: 'agent' | 'error' | 'note') => void;
  /** Results of finished tasks this one was blocked by (dependencies). */
  dependencyResults: () => { title: string; result: string }[];
}

const SYSTEM = (t: Task, skills: Skill[], web: string, deps: { title: string; result: string }[]) => `You are Lotus, an AI agent running on the user's own PC, working through a task from their task board.
You can only think and write: you cannot run programs, open files or browse. When a step needs an action you cannot take, write exactly what the user should do (commands, settings, text to paste) so they can do it in one go.
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

  // Skills that match the task
  const ids = await memoryStore.searchSkills(`${t0.title} ${t0.description}`.slice(0, 400), 2);
  const skills = ids.map((id) => memoryStore.get().skills.find((k) => k.id === id)).filter((k): k is Skill => !!k && k.enabled);
  if (skills.length) h.log(`Using skill${skills.length > 1 ? 's' : ''}: ${skills.map((k) => k.name).join(', ')}`, 'agent');

  // Web
  let web = '';
  if (t0.web && s) {
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

  const system = SYSTEM(t0, skills, web, h.dependencyResults());

  // Plan
  if (!t0.steps.length) {
    h.log('Planning steps', 'agent');
    const r = await llm.chatOnce([{ role: 'system', content: system }, { role: 'user', content: 'Break this task into 3 to 7 concrete steps that, done in order, complete it. Reply with JSON only: {"steps": ["...", "..."]}' }], { ...opts, json: true, numPredict: 600 });
    const steps = parsePlan(r.content);
    if (!steps.length) throw new Error('The model did not return a usable plan. Add steps yourself, or try a larger model.');
    h.patch((t) => ({ ...t, steps: steps.map((text): TaskStep => ({ id: uid('step'), text, done: false })) }));
    h.log(`Planned ${steps.length} steps`, 'agent');
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
    const r = await llm.chatOnce([
      { role: 'system', content: system },
      { role: 'user', content: `${before ? `Work done so far:\n${before}\n\n` : ''}Now do step ${i + 1} of ${t.steps.length}: ${step.text}\nWrite the result of this step only.` },
    ], { ...opts, numPredict: 1800 });
    const result = r.content.trim() || '(no output)';
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
