// Prompts and tolerant JSON handling for the research pipeline.

import { ollamaClient, ChatTurn } from '../services/ollamaService';
import { Clarification, Persona, SubTopic, Source } from './types';

export interface LlmCtx {
  model: string;
  numCtx: number;
  signal?: AbortSignal;
  /** Called after every request with real token counts. */
  onUsage: (promptTokens: number, evalTokens: number) => void;
}

export const uid = () => Math.random().toString(36).slice(2, 10);

/** Pull the first balanced JSON object out of a model reply (handles code fences and chatter). */
export function parseJson<T = any>(text: string): T | null {
  const t = text.replace(/```(?:json)?/gi, '');
  const start = t.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(t.slice(start, i + 1)) as T; } catch { return null; }
    }
  }
  return null;
}

async function askJson<T>(ctx: LlmCtx, system: string, user: string, validate: (j: any) => T | null): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const turns: ChatTurn[] = [
      { role: 'system', content: `${system}\nReply with a single JSON object and nothing else.` },
      { role: 'user', content: attempt ? `${user}\n\nYour previous reply was not valid. Return ONLY the JSON object.` : user },
    ];
    const r = await ollamaClient.chatOnce(turns, { model: ctx.model, numCtx: ctx.numCtx, temperature: 0.3, signal: ctx.signal, json: true });
    ctx.onUsage(r.promptTokens, r.evalTokens);
    const ok = validate(parseJson(r.content));
    if (ok) return ok;
  }
  return null;
}

const strs = (v: unknown, max = 8): string[] => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, max) : []);

export async function proposeQuestions(ctx: LlmCtx, topic: string): Promise<Clarification[]> {
  const out = await askJson(ctx,
    'You are a research librarian scoping a literature investigation. Ask 3 to 5 short, specific questions that would narrow the topic: population or domain, time range, study types, outcomes, exclusions. Each question must be answerable in one line.',
    `Research topic: ${topic}\nJSON shape: {"questions":[{"question":"...","why":"one short reason"}]}`,
    (j) => (Array.isArray(j?.questions) && j.questions.length ? j.questions.slice(0, 5).map((q: any) => ({ id: uid(), question: String(q.question ?? q).trim(), why: q.why ? String(q.why) : undefined, answer: '' })).filter((q: Clarification) => q.question) : null));
  return out ?? [
    'Which time period should the research cover (for example, only papers after 2020)?',
    'Which study types or methods matter most (for example, trials, reviews, benchmarks)?',
    'Is there a specific population, domain or application to focus on?',
  ].map((question) => ({ id: uid(), question, answer: '' }));
}

export async function proposePlan(ctx: LlmCtx, topic: string, answers: Clarification[]): Promise<{ title: string; plan: SubTopic[] }> {
  const brief = answers.filter((a) => a.answer.trim()).map((a) => `- ${a.question} ${a.answer}`).join('\n') || '(no extra constraints given)';
  const out = await askJson(ctx,
    'You plan research. Split the topic into 3 or 4 independent sub-topics that can be investigated in parallel. Each has a one-sentence objective and 2 to 4 concrete sub-questions.',
    `Research topic: ${topic}\nScoping answers:\n${brief}\nJSON shape: {"title":"short report title","subtopics":[{"title":"...","objective":"...","questions":["...","..."]}]}`,
    (j) => {
      if (!Array.isArray(j?.subtopics) || !j.subtopics.length) return null;
      const plan: SubTopic[] = j.subtopics.slice(0, 5).map((s: any) => ({ id: uid(), title: String(s.title ?? '').trim(), objective: String(s.objective ?? '').trim(), questions: strs(s.questions, 5) })).filter((s: SubTopic) => s.title);
      return plan.length ? { title: String(j.title ?? topic).slice(0, 120), plan } : null;
    });
  return out ?? { title: topic.slice(0, 120), plan: [{ id: uid(), title: 'Overview', objective: `Summarise what is known about: ${topic}`, questions: [topic] }] };
}

export async function proposePersonas(ctx: LlmCtx, topic: string): Promise<Persona[]> {
  const out = await askJson(ctx,
    'You assemble a panel of 3 to 5 expert personas who will interrogate a research topic from different angles. Always include one sceptical peer reviewer.',
    `Research topic: ${topic}\nJSON shape: {"personas":[{"name":"Role title","role":"one-line background","focus":"what they challenge or look for"}]}`,
    (j) => (Array.isArray(j?.personas) && j.personas.length ? j.personas.slice(0, 5).map((p: any) => ({ id: uid(), name: String(p.name ?? '').trim(), role: String(p.role ?? '').trim(), focus: String(p.focus ?? '').trim() })).filter((p: Persona) => p.name) : null));
  return out ?? [
    { id: uid(), name: 'Domain specialist', role: 'Practitioner with deep field knowledge', focus: 'Accuracy, terminology and what is already established' },
    { id: uid(), name: 'Sceptical peer reviewer', role: 'Reviewer looking for weak evidence', focus: 'Small samples, confounders, overclaiming and conflicts of interest' },
    { id: uid(), name: 'Methodologist', role: 'Statistics and study-design expert', focus: 'Whether the methods support the conclusions' },
  ];
}

export async function proposeQueries(ctx: LlmCtx, a: { topic: SubTopic; question: string; notes: string[]; injected: string[]; iteration: number; tried: string[] }): Promise<{ queries: string[]; done: boolean }> {
  const out = await askJson(ctx,
    'You write search queries for scholarly databases. Use 3 to 6 plain keywords per query (no boolean syntax). Vary the wording. If the notes already answer the sub-questions well, set "done" to true.',
    `Overall topic: ${a.question}\nSub-topic: ${a.topic.title} - ${a.topic.objective}\nSub-questions: ${a.topic.questions.join(' | ')}\nIteration: ${a.iteration}\n` +
    (a.notes.length ? `Findings so far:\n${a.notes.slice(-8).map((n) => `- ${n}`).join('\n')}\n` : 'No findings yet.\n') +
    (a.tried.length ? `Queries already tried (do not repeat): ${a.tried.slice(-8).join(' | ')}\n` : '') +
    (a.injected.length ? `Extra instructions from the user (follow them): ${a.injected.join(' | ')}\n` : '') +
    `JSON shape: {"queries":["...","..."],"done":false}`,
    (j) => { const q = strs(j?.queries, 4); return q.length || j?.done ? { queries: q, done: !!j?.done } : null; });
  return out ?? { queries: [a.iteration === 1 ? `${a.topic.title} ${a.question}`.slice(0, 80) : a.topic.title], done: false };
}

/** Reads a few abstracts at a time and extracts the finding that matters for the sub-topic. */
export async function extractFindings(ctx: LlmCtx, topic: SubTopic, batch: Source[]): Promise<Record<string, { finding: string; relevance: number }>> {
  const list = batch.map((s, i) => `[${i + 1}] ${s.title} (${s.year ?? 'n.d.'})\n${s.abstract.slice(0, 1200)}`).join('\n\n');
  const out = await askJson(ctx,
    'You read paper abstracts for a literature review. For each numbered abstract give ONE finding in under 45 words using only what the abstract states, and rate its relevance to the sub-topic from 1 (off topic) to 5 (directly answers it). Never add facts that are not in the abstract.',
    `Sub-topic: ${topic.title} - ${topic.objective}\nSub-questions: ${topic.questions.join(' | ')}\n\n${list}\n\nJSON shape: {"items":[{"n":1,"finding":"...","relevance":4}]}`,
    (j) => (Array.isArray(j?.items) ? j.items : null));
  const map: Record<string, { finding: string; relevance: number }> = {};
  (out ?? []).forEach((it: any) => {
    const s = batch[Number(it.n) - 1];
    if (s) map[s.id] = { finding: String(it.finding ?? '').trim(), relevance: Math.max(1, Math.min(5, Math.round(Number(it.relevance) || 3))) };
  });
  return map;
}

export function buildSynthesisPrompt(p: { question: string; clarifications: Clarification[]; plan: SubTopic[]; personas: Persona[]; refs: Source[]; sourcesByTopic: Record<string, number[]> }): ChatTurn[] {
  const scoped = p.clarifications.filter((c) => c.answer.trim()).map((c) => `- ${c.question} ${c.answer}`).join('\n');
  const notes = p.plan.map((t) => `### ${t.title}\nObjective: ${t.objective}\n${(p.sourcesByTopic[t.id] ?? []).map((n) => `[${n}] ${p.refs[n - 1].title} (${p.refs[n - 1].year ?? 'n.d.'}): ${p.refs[n - 1].finding || p.refs[n - 1].abstract.slice(0, 220)}`).join('\n') || '(no sources found)'}`).join('\n\n');
  return [
    { role: 'system', content: 'You write a careful literature-review report in Markdown. Use ONLY the numbered evidence provided. Cite with bracketed numbers like [3] right after each claim. If the evidence is thin or conflicting, say so plainly. Never invent sources, numbers or quotes. Do not write a reference list; it is added automatically.' },
    { role: 'user', content:
`Research question: ${p.question}
${scoped ? `Scope:\n${scoped}\n` : ''}
Expert panel to channel in a final "Critical review" section: ${p.personas.map((x) => `${x.name} (${x.focus})`).join('; ')}

Evidence by sub-topic:
${notes}

Write: a title (#), an Executive summary, one section per sub-topic, a Critical review (one short paragraph per expert), Limitations, and Open questions.` },
  ];
}
