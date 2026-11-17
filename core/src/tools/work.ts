// Work mode tools (session 16): a plan the user can watch, artifacts saved as real files, helper
// agents for separate parts of a job, and questions back to the user.
//
//   plan.set        the steps the agent will take (shown as a checklist)
//   plan.check      tick one off
//   artifact.write  create or replace a deliverable (Markdown doc, HTML page, CSV table, SVG, code)
//                   in Lotus Studio/Work/<work id>/
//   artifact.read   read one back to revise it
//   agent.delegate  hand a self-contained part of the job to a helper agent, get its result back
//   agents.deploy   (0.11.0) start several helper agents at once on independent parts, get all results
//   ask.user        ask a question (with optional choices) and wait for the answer

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { Tool } from '../agent/types';

const KINDS: Record<string, string> = {
  '.md': 'document', '.markdown': 'document', '.txt': 'document',
  '.html': 'page', '.htm': 'page',
  '.csv': 'table', '.tsv': 'table',
  '.svg': 'image', '.json': 'data',
  '.py': 'code', '.js': 'code', '.ts': 'code', '.tsx': 'code', '.jsx': 'code', '.css': 'code', '.sh': 'code', '.ps1': 'code', '.sql': 'code', '.java': 'code', '.c': 'code', '.cpp': 'code', '.rs': 'code', '.go': 'code', '.rb': 'code', '.php': 'code', '.yaml': 'code', '.yml': 'code', '.toml': 'code',
};
export const artifactKind = (file: string) => KINDS[extname(file).toLowerCase()] ?? 'file';

/** A safe file name inside the work folder: no folders, no tricks, a known extension. */
export function safeName(raw: string, fallbackTitle = 'artifact'): string | null {
  let n = basename(String(raw ?? '').replace(/\\/g, '/')).trim().replace(/[\u0000-\u001f<>:"|?*]/g, '').replace(/\s+/g, ' ');
  if (!n || n === '.' || n === '..') n = `${fallbackTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'artifact'}.md`;
  if (!extname(n)) n += '.md';
  if (!(extname(n).toLowerCase() in KINDS)) return null;
  return n.slice(0, 120);
}

export interface ArtifactInfo { file: string; title: string; kind: string; bytes: number; updated: number }

/** The artifacts in a work folder, newest first (the Work page's right panel). */
export function listArtifacts(dir: string): ArtifactInfo[] {
  if (!existsSync(dir)) return [];
  let titles: Record<string, string> = {};
  try { titles = JSON.parse(readFileSync(join(dir, '.titles.json'), 'utf8')); } catch { /* none yet */ }
  return readdirSync(dir).filter((f) => !f.startsWith('.')).map((f) => {
    const st = statSync(join(dir, f));
    return st.isFile() ? { file: f, title: titles[f] ?? f, kind: artifactKind(f), bytes: st.size, updated: st.mtimeMs } : null;
  }).filter((a): a is ArtifactInfo => !!a).sort((a, b) => b.updated - a.updated);
}

export const planSet: Tool = {
  name: 'plan.set', label: 'Planning', risk: 'read',
  description: 'Write down your plan as a short list of concrete steps before starting a bigger job (3–8 steps). The user sees it as a checklist. Call it again to change the plan.',
  parameters: { type: 'object', properties: { steps: { type: 'array', items: { type: 'string' }, description: 'The steps, in order, each a few words.' } }, required: ['steps'] },
  async run(a) {
    const steps = (Array.isArray(a.steps) ? a.steps : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 12);
    if (!steps.length) return { ok: false, text: 'The plan needs at least one step.', summary: 'Empty plan' };
    return { ok: true, text: `Plan saved with ${steps.length} steps. Tick each one off with plan.check when it is done.`, summary: `${steps.length}-step plan`, data: { plan: steps } };
  },
};

export const planCheck: Tool = {
  name: 'plan.check', label: 'Ticking off a step', risk: 'read',
  description: 'Mark a step of your plan as done (1 is the first step).',
  parameters: { type: 'object', properties: { step: { type: 'integer', description: 'Step number, starting at 1.' }, note: { type: 'string', description: 'Optional few words on the result.' } }, required: ['step'] },
  async run(a) {
    const n = Number(a.step);
    if (!(n >= 1)) return { ok: false, text: 'step must be 1 or more.', summary: 'Bad step number' };
    return { ok: true, text: `Step ${n} marked done.`, summary: `Step ${n} done${a.note ? `: ${String(a.note).slice(0, 60)}` : ''}`, data: { checked: n } };
  },
};

export const artifactWrite: Tool = {
  name: 'artifact.write', label: 'Writing an artifact', risk: 'write',
  description: 'Save a deliverable for the user as a file they can open, preview and keep: a document (.md), a web page (.html, self-contained), a table (.csv), an image (.svg) or code. Use the same filename again to replace it with a new version. Put the whole content in; never a summary of it.',
  parameters: { type: 'object', properties: {
    title: { type: 'string', description: 'A short human title, e.g. "Trip budget".' },
    filename: { type: 'string', description: 'File name with extension, e.g. budget.csv, report.md, landing.html.' },
    content: { type: 'string', description: 'The full file content.' },
  }, required: ['title', 'filename', 'content'] },
  describe: (a) => `Save “${String(a.title ?? a.filename).slice(0, 80)}” as ${String(a.filename)}`,
  async run(a, ctx) {
    if (!ctx.workDir) return { ok: false, text: 'Artifacts can only be saved in Work mode.', summary: 'Not in Work mode' };
    const file = safeName(String(a.filename ?? ''), String(a.title ?? ''));
    if (!file) return { ok: false, text: `That file type can't be an artifact. Use one of: ${Object.keys(KINDS).join(' ')}.`, summary: 'Unsupported file type' };
    const content = String(a.content ?? '');
    if (!content.trim()) return { ok: false, text: 'The content is empty. Write the whole file.', summary: 'Empty artifact' };
    if (content.length > 2_000_000) return { ok: false, text: 'That is over 2 MB; split it into smaller artifacts.', summary: 'Too large' };
    mkdirSync(ctx.workDir, { recursive: true });
    const full = join(ctx.workDir, file);
    const existed = existsSync(full);
    writeFileSync(full, content, 'utf8');
    const titlesPath = join(ctx.workDir, '.titles.json');
    let titles: Record<string, string> = {};
    try { titles = JSON.parse(readFileSync(titlesPath, 'utf8')); } catch { /* new */ }
    titles[file] = String(a.title ?? file).slice(0, 120);
    writeFileSync(titlesPath, JSON.stringify(titles, null, 1));
    const kind = artifactKind(file);
    return { ok: true, text: `${existed ? 'Updated' : 'Saved'} ${file} (${content.length.toLocaleString()} characters). The user can open it in the Artifacts panel.`, summary: `${existed ? 'Updated' : 'Saved'} ${titles[file]} · ${file}`, data: { artifact: { file, title: titles[file], kind, path: full } } };
  },
};

export const artifactRead: Tool = {
  name: 'artifact.read', label: 'Reading an artifact', risk: 'read',
  description: 'Read an artifact you saved earlier in this piece of work (to revise or continue it). Without a filename, lists them.',
  parameters: { type: 'object', properties: { filename: { type: 'string', description: 'The artifact file name.' } } },
  async run(a, ctx) {
    if (!ctx.workDir) return { ok: false, text: 'Artifacts exist only in Work mode.', summary: 'Not in Work mode' };
    const list = listArtifacts(ctx.workDir);
    if (!a.filename) return { ok: true, text: list.length ? list.map((x) => `- ${x.file} (${x.title}, ${x.kind})`).join('\n') : 'No artifacts yet.', summary: `${list.length} artifacts` };
    const file = safeName(String(a.filename));
    const hit = file && list.find((x) => x.file.toLowerCase() === file.toLowerCase());
    if (!hit) return { ok: false, text: `No artifact called ${a.filename}. There are: ${list.map((x) => x.file).join(', ') || 'none'}.`, summary: 'Not found' };
    const text = readFileSync(join(ctx.workDir, hit.file), 'utf8');
    return { ok: true, text: text.length > 60_000 ? `${text.slice(0, 60_000)}\n…(cut at 60,000 characters)` : text, summary: `Read ${hit.title}` };
  },
};

export const agentDelegate: Tool = {
  name: 'agent.delegate', label: 'Working with a helper agent', risk: 'read',
  description: 'Give one self-contained part of the job to a helper agent (for example: research a topic, draft one section, check a file). It has the same tools except delegating, and returns its result to you. Use it to keep your own context small on long jobs.',
  parameters: { type: 'object', properties: {
    goal: { type: 'string', description: 'Exactly what the helper should do and return.' },
    context: { type: 'string', description: 'Anything it needs to know (facts, file names, constraints).' },
    name: { type: 'string', description: 'Optional name for the helper, e.g. "Researcher". Give it a face first with avatar.create if you like.' },
  }, required: ['goal'] },
  describe: (a) => `Helper: ${String(a.goal).slice(0, 100)}`,
  async run(a, ctx) {
    if (!ctx.delegate) return { ok: false, text: 'Helper agents are only available in Work mode.', summary: 'Not available here' };
    ctx.progress('Helper is working…');
    const r = await ctx.delegate(String(a.goal), String(a.context ?? ''), a.name ? String(a.name) : undefined);
    return { ok: r.ok, text: r.content || 'The helper returned nothing.', summary: `${a.name ? String(a.name).slice(0, 40) : 'Helper'} finished · ${r.steps} step${r.steps === 1 ? '' : 's'}` };
  },
};

/** "Researcher: find X" → name + goal; a plain line is just the goal. */
export function parseJob(raw: string): { name?: string; goal: string } {
  const t = String(raw ?? '').trim();
  const m = /^([A-Z][\w .'-]{0,30}?)\s*:\s+(\S[\s\S]*)$/.exec(t);
  return m && m[1].split(/\s+/).length <= 3 ? { name: m[1].trim(), goal: m[2].trim() } : { goal: t };
}

export const agentsDeploy: Tool = {
  name: 'agents.deploy', label: 'Deploying agents', risk: 'read',
  description: 'Start several helper agents at the same time, each on its own independent part of the job (e.g. research three topics, draft separate sections, check several files). Each has your tools except deploying, delegating and asking, works on its own, and returns its result; you get all results back to combine. The user sees every agent with its task and progress. Prefer this over doing independent parts one by one.',
  parameters: { type: 'object', properties: {
    tasks: { type: 'array', items: { type: 'string' }, description: 'One line per agent: "Name: exactly what it should do and return", e.g. "Researcher: find three budget keyboards with prices". 2–6 agents.' },
    context: { type: 'string', description: 'What every agent needs to know (facts, file names, constraints).' },
  }, required: ['tasks'] },
  describe: (a) => `Deploy ${Array.isArray(a.tasks) ? a.tasks.length : 0} agents`,
  async run(a, ctx) {
    if (!ctx.deploy) return { ok: false, text: 'Agents can only be deployed in Work mode.', summary: 'Not available here' };
    const jobs = (Array.isArray(a.tasks) ? a.tasks : []).map((x) => parseJob(String(x))).filter((j) => j.goal).slice(0, 6);
    if (!jobs.length) return { ok: false, text: 'Give at least one task, one line per agent.', summary: 'No tasks' };
    // Names must tell agents apart (each gets its own face).
    const seen = new Map<string, number>();
    jobs.forEach((j, i) => {
      const base = j.name || `Agent ${i + 1}`;
      const n = (seen.get(base.toLowerCase()) ?? 0) + 1;
      seen.set(base.toLowerCase(), n);
      j.name = n > 1 ? `${base} ${n}` : base;
    });
    ctx.progress(`${jobs.length} agents working…`);
    const out = await ctx.deploy(jobs, String(a.context ?? ''));
    const ok = out.filter((r) => r.ok).length;
    return {
      ok: ok > 0,
      text: out.map((r) => `### ${r.name}${r.ok ? '' : ' (failed)'}\n${r.content || 'Returned nothing.'}`).join('\n\n'),
      summary: `${ok} of ${out.length} agents finished · ${out.map((r) => r.name).join(', ')}`.slice(0, 160),
      data: { agents: out.map((r) => ({ name: r.name, ok: r.ok, steps: r.steps })) },
    };
  },
};

export const askUser: Tool = {
  name: 'ask.user', label: 'Asking you', risk: 'read',
  description: 'Ask the user a question and wait for the answer, when you need a decision or missing information to continue (e.g. "The site needs a login. Should I continue with A, B or C?"). Offer 2–4 short choices when you can. Don\'t ask about things you can find out yourself.',
  parameters: { type: 'object', properties: {
    question: { type: 'string', description: 'The question, in one or two plain sentences.' },
    options: { type: 'array', items: { type: 'string' }, description: 'Optional short choices (2–4).' },
  }, required: ['question'] },
  async run(a, ctx) {
    if (!ctx.ask) return { ok: false, text: 'You cannot ask questions here; answer with what you have and say what is missing.', summary: 'Can\'t ask here' };
    const options = (Array.isArray(a.options) ? a.options : []).map(String).map((s) => s.trim()).filter(Boolean).slice(0, 4);
    const answer = (await ctx.ask(String(a.question), options)).trim();
    if (!answer) return { ok: false, text: 'The user did not answer. Continue with the safest reasonable choice and say which you took, or stop.', summary: 'No answer' };
    return { ok: true, text: `The user answered: ${answer}`, summary: `You answered: ${answer.slice(0, 80)}` };
  },
};

export const WORK_TOOLS: Tool[] = [planSet, planCheck, artifactWrite, artifactRead, agentDelegate, agentsDeploy, askUser];
