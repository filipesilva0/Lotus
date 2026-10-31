// The build agent: asks the local model what to do, carries out the actions it writes (files, commands,
// preview) and feeds the results back until the model says it is done, the user stops it, or it runs
// out of steps. Everything the model can do is in protocol.ts; nothing outside the project folder is touched
// by file actions, and commands need the user's approval unless the project was set to run them freely.

import { ollamaClient } from '../services/ollamaService';
import { uid } from '../lib/persist';
import { Action, findServerUrl, lineDelta, parseTurn } from './protocol';
import { AgentItem, BuilderProject, ChatMsg, FileRead, FsEntry } from './types';
import { Template } from './templates';
import { projDelete, projRead, projTree, projWrite, RunResult, squeeze } from './projectFs';

export const MAX_STEPS = 14;

/** Everything the agent needs from the outside world besides commands; replaceable so the loop can be tested without a PC. */
export interface AgentIO {
  tree: (root: string) => Promise<FsEntry[]>;
  read: (root: string, rel: string) => Promise<FileRead>;
  write: (root: string, rel: string, content: string) => Promise<void>;
  remove: (root: string, rel: string) => Promise<void>;
  stream: (messages: ChatMsg[], o: { model: string; numCtx: number; temperature: number; signal: AbortSignal }) => AsyncIterable<string>;
}

export const realIO: AgentIO = {
  tree: async (root) => (await projTree(root)).entries,
  read: projRead,
  write: (root, rel, content) => projWrite(root, rel, content),
  remove: projDelete,
  stream: (messages, o) => ollamaClient.streamChat(messages, { model: o.model, numCtx: o.numCtx, temperature: o.temperature, signal: o.signal }),
};

export interface AgentCtx {
  project: BuilderProject;
  template: Template;
  model: string;
  numCtx: number;
  temperature: number;
  mode: 'plan' | 'fast';
  signal: AbortSignal;
  /** Conversation the model sees, and the plan the user approved. Mutated by the loop. */
  chat: { history: ChatMsg[]; plan: string };
  push: (item: AgentItem) => void;
  patch: (id: string, p: Partial<AgentItem>) => void;
  approve: (command: string, why: 'ask' | 'danger') => Promise<boolean>;
  runCommand: (command: string, signal: AbortSignal, timeoutMs: number) => Promise<RunResult>;
  startServer: (command: string) => Promise<{ url: string | null; output: string }>;
  showPreview: (t: { url?: string; dir?: string }) => Promise<string>;
  onFilesChanged: () => void;
  /** Defaults to the real files and the local model. */
  io?: AgentIO;
  /** Project context files found in the folder (SOUL.md, AGENTS.md, .cursorrules…), already formatted. */
  projectContext?: string;
}

const DANGEROUS: RegExp[] = [
  /\brm\s+(-[a-z]*r[a-z]*f?|-[a-z]*f[a-z]*r?)\s+(\/|~|\$HOME|\*)/i,
  /\b(rd|rmdir)\s+\/s\b[^&|]*\b[a-z]:\\(?!\S*\\)/i,
  /\bdel\b[^&|]*\/s\b[^&|]*\b[a-z]:\\/i,
  /\bformat\s+[a-z]:/i, /\bdiskpart\b/i, /\bshutdown\b/i, /\breg\s+(delete|add)\b/i,
  /\bpowershell\b[^&|]*\b(remove-item|rm)\b[^&|]*-recurse/i,
  /\bcurl\b[^|&]*\|\s*(sh|bash|cmd|powershell)/i, /\biwr\b[^|&]*\|\s*iex/i,
];
export const isDangerous = (cmd: string) => DANGEROUS.some((r) => r.test(cmd));

// ── prompt ────────────────────────────────────────────────────────────────

function treeText(entries: FsEntry[], max = 120): string {
  if (!entries.length) return '(empty)';
  const lines = entries.slice(0, max).map((e) => `${e.isDir ? '[dir] ' : ''}${e.rel}${e.isDir ? '/' : ''}`);
  if (entries.length > max) lines.push(`… and ${entries.length - max} more`);
  return lines.join('\n');
}

export function systemPrompt(ctx: AgentCtx, tree: FsEntry[]): string {
  const planRule = ctx.mode === 'plan' && !ctx.chat.plan
    ? '\nPLAN FIRST: before changing anything, reply with ONE <plan> block: a short markdown checklist ("- [ ] step", at most 8 steps) of how you will build what was asked, and nothing else. The user will approve it before you start.\n'
    : '';
  return `You are Lotus Builder, a coding agent working inside the user's project on their Windows PC. You build real, working apps by creating and editing files and running commands. You act only through the tags below.

PROJECT: ${ctx.project.name} - ${ctx.template.title} (${ctx.template.platforms.join(', ')})
${ctx.template.agentNotes}

ACTIONS (read by a program; write each tag exactly as shown):
<write_file path="src/App.jsx">
the WHOLE file content
</write_file>
<replace_in_file path="style.css"><old>exact existing text</old><new>replacement text</new></replace_in_file>
<read_file path="src/App.jsx"/>
<list_files path="src"/>
<delete_path path="old.js"/>
<run_command>npm install</run_command>
<start_server>npm run dev -- --host 127.0.0.1</start_server>
<preview dir="www"/>
<plan>- [ ] step one
- [x] finished step</plan>
<done>One or two sentences: what was built and what to click or run next.</done>

run_command runs in the project folder with Windows cmd.exe, waits for the command to finish and returns its output (installs, builds, tests). start_server is for programs that keep running (dev servers); the app shows the address in its preview pane. preview shows a static folder from the project in the preview pane.

RULES
1. Say in one short sentence what you are about to do, write the tags, then STOP. You will receive the results and can continue. Never invent results.
2. Paths are relative to the project folder and use forward slashes.
3. Write complete, working code. No placeholders, no TODOs, no "rest of the file". Always the WHOLE file in write_file; use replace_in_file only for small changes, and old must match exactly once.
4. Read a file before changing it unless you wrote it in this conversation.
5. If a result shows an error, fix the cause and try again. Do not repeat the same failing action.
6. Do not put code outside the tags. Do not ask permission to continue.
7. Finish with <done> only when the app works.
${planRule}
FILES NOW:
${treeText(tree)}
${ctx.chat.plan ? `\nAPPROVED PLAN:\n${ctx.chat.plan}\n` : ''}${ctx.projectContext ?? ''}`;
}

const CHARS_PER_TOKEN = 3.4;

/** Shrinks old file bodies and old results, then drops the oldest turns, until the conversation fits the model's context. */
export function fitHistory(history: ChatMsg[], systemChars: number, numCtx: number): ChatMsg[] {
  const budget = Math.floor(numCtx * 0.72 * CHARS_PER_TOKEN) - systemChars;
  const total = (h: ChatMsg[]) => h.reduce((n, m) => n + m.content.length, 0);
  let h = history.slice();
  const recent = 4;
  h = h.map((m, i) => {
    if (i >= h.length - recent) return m;
    if (m.role === 'assistant') return { ...m, content: m.content.replace(/<write_file path="([^"]*)">[\s\S]*?<\/write_file>/g, '<write_file path="$1">(content left out to save space; use read_file to see it)</write_file>') };
    if (m.content.startsWith('Results')) return { ...m, content: m.content.length > 700 ? `${m.content.slice(0, 700)}\n… (older output trimmed)` : m.content };
    return m;
  });
  while (total(h) > budget && h.length > recent + 1) h.splice(1, 1); // keep the first request, drop from the oldest
  return h;
}

// ── action execution ──────────────────────────────────────────────────────

const label = (a: Action): string => {
  switch (a.type) {
    case 'write_file': return `Write ${a.path}`;
    case 'replace_in_file': return `Edit ${a.path}`;
    case 'read_file': return `Read ${a.path}`;
    case 'list_files': return `List ${a.path || 'project'}`;
    case 'delete_path': return `Delete ${a.path}`;
    case 'run_command': return `Run ${a.command}`;
    case 'start_server': return `Start ${a.command}`;
    case 'preview': return a.url ? `Preview ${a.url}` : `Preview ${a.dir || 'project'}`;
    case 'plan': return 'Update plan';
    case 'done': return 'Done';
  }
};

async function execute(a: Action, ctx: AgentCtx, id: string): Promise<{ ok: boolean; result: string; stop?: boolean }> {
  const root = ctx.project.path;
  const io = ctx.io ?? realIO;
  const done = (p: Partial<AgentItem>) => ctx.patch(id, p);
  try {
    switch (a.type) {
      case 'write_file': {
        let before = '';
        try { const r = await io.read(root, a.path); before = r.text ?? ''; } catch { /* new file */ }
        await io.write(root, a.path, a.content);
        const d = lineDelta(before, a.content);
        done({ status: 'ok', added: d.added, removed: d.removed } as Partial<AgentItem>);
        ctx.onFilesChanged();
        return { ok: true, result: `wrote ${a.path} (${a.content.split('\n').length} lines)` };
      }
      case 'replace_in_file': {
        const r = await io.read(root, a.path);
        if (r.text === null) throw new Error(`${a.path} is not a text file.`);
        const first = r.text.indexOf(a.old);
        if (!a.old) throw new Error('The <old> text is empty.');
        if (first === -1) throw new Error(`The <old> text was not found in ${a.path}. Read the file again and copy the text exactly.`);
        if (r.text.indexOf(a.old, first + 1) !== -1) throw new Error(`The <old> text appears more than once in ${a.path}. Include more surrounding lines so it matches once.`);
        const next = r.text.slice(0, first) + a.new + r.text.slice(first + a.old.length);
        await io.write(root, a.path, next);
        const d = lineDelta(r.text, next);
        done({ status: 'ok', added: d.added, removed: d.removed } as Partial<AgentItem>);
        ctx.onFilesChanged();
        return { ok: true, result: `edited ${a.path}` };
      }
      case 'read_file': {
        const r = await io.read(root, a.path);
        if (r.tooLarge) throw new Error(`${a.path} is too large to read (${Math.round(r.size / 1024)} KB).`);
        if (r.binary || r.text === null) throw new Error(`${a.path} is a binary file.`);
        const body = r.text.length > 14000 ? `${r.text.slice(0, 14000)}\n… (file continues; ${r.text.length - 14000} more characters)` : r.text;
        done({ status: 'ok', output: `${r.text.split('\n').length} lines` } as Partial<AgentItem>);
        return { ok: true, result: `contents of ${a.path}:\n${body}` };
      }
      case 'list_files': {
        const all = await io.tree(root);
        const prefix = a.path ? `${a.path}/` : '';
        const list = all.filter((e) => e.rel.startsWith(prefix) && e.rel !== a.path);
        done({ status: 'ok', output: `${list.length} entries` } as Partial<AgentItem>);
        return { ok: true, result: `files under ${a.path || 'the project'}:\n${treeText(list, 200)}` };
      }
      case 'delete_path': {
        await io.remove(root, a.path);
        done({ status: 'ok' } as Partial<AgentItem>);
        ctx.onFilesChanged();
        return { ok: true, result: `deleted ${a.path}` };
      }
      case 'run_command':
      case 'start_server': {
        const danger = isDangerous(a.command);
        if (danger || !ctx.project.autoRun) {
          const yes = await ctx.approve(a.command, danger ? 'danger' : 'ask');
          if (!yes) { done({ status: 'denied' } as Partial<AgentItem>); return { ok: false, result: `the user did not allow: ${a.command}. Choose another approach or explain what you need.` }; }
        }
        if (a.type === 'start_server') {
          const s = await ctx.startServer(a.command);
          const out = squeeze(s.output, 2500);
          done({ status: s.url ? 'ok' : 'error', output: s.url ? `Running at ${s.url}` : out } as Partial<AgentItem>);
          return s.url
            ? { ok: true, result: `server started at ${s.url} and is shown in the preview pane. Output so far:\n${out}` }
            : { ok: false, result: `the server did not print a local address within 25 seconds. Output so far:\n${out}` };
        }
        const r = await ctx.runCommand(a.command, ctx.signal, 240_000);
        ctx.onFilesChanged();
        const out = squeeze(r.output);
        const note = r.cancelled ? ' (stopped by the user)' : r.timedOut ? ' (timed out after 4 minutes and was stopped)' : '';
        const ok = r.code === 0 && !r.timedOut && !r.cancelled;
        done({ status: ok ? 'ok' : 'error', output: squeeze(r.output, 2500) || `exit ${r.code}` } as Partial<AgentItem>);
        return { ok, result: `${a.command}\nexit code ${r.code ?? 'none'}${note}\n${out}` };
      }
      case 'preview': {
        const shown = await ctx.showPreview({ url: a.url, dir: a.dir });
        done({ status: 'ok', output: shown } as Partial<AgentItem>);
        return { ok: true, result: `preview is showing ${shown}` };
      }
      case 'plan':
        ctx.chat.plan = a.markdown;
        done({ status: 'ok' } as Partial<AgentItem>);
        return { ok: true, result: 'plan updated' };
      case 'done':
        return { ok: true, result: 'done', stop: true };
    }
  } catch (e) {
    const msg = (e as Error).message || String(e);
    done({ status: 'error', output: msg } as Partial<AgentItem>);
    return { ok: false, result: `${label(a)} failed: ${msg}` };
  }
}

// ── the loop ──────────────────────────────────────────────────────────────

/**
 * Runs the agent on one user message until it finishes or stops for the user.
 * Returns 'plan' when it is waiting for the user to approve a plan.
 */
export async function runAgent(ctx: AgentCtx, userText: string): Promise<'done' | 'plan' | 'stopped' | 'limit' | 'error'> {
  ctx.chat.history.push({ role: 'user', content: userText });
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      if (ctx.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const io = ctx.io ?? realIO;
      const tree = await io.tree(ctx.project.path).catch(() => [] as FsEntry[]);
      const system = systemPrompt(ctx, tree);
      const messages = [{ role: 'system' as const, content: system }, ...fitHistory(ctx.chat.history, system.length, ctx.numCtx)];

      const aid = uid('as');
      ctx.push({ kind: 'assistant', id: aid, text: '', streaming: true, status: step === 0 ? 'Thinking…' : 'Working…' });
      let text = '';
      let lastUi = 0;
      for await (const tok of io.stream(messages, { model: ctx.model, numCtx: ctx.numCtx, temperature: ctx.temperature, signal: ctx.signal })) {
        text += tok;
        const now = performance.now();
        if (now - lastUi > 120) {
          lastUi = now;
          const t = parseTurn(text);
          ctx.patch(aid, { text: t.prose, status: t.pending ? `${t.pending.type === 'write_file' ? 'Writing' : t.pending.type === 'plan' ? 'Planning' : 'Preparing'} ${t.pending.path ?? ''}${t.pending.chars > 400 ? ` (${Math.round(t.pending.chars / 1000)}k characters)` : ''}`.trim() : 'Thinking…' } as Partial<AgentItem>);
        }
      }
      const turn = parseTurn(text);
      ctx.chat.history.push({ role: 'assistant', content: text });
      ctx.patch(aid, { text: turn.prose, streaming: false, status: undefined } as Partial<AgentItem>);

      if (!text.trim()) {
        ctx.push({ kind: 'note', id: uid('n'), tone: 'error', text: 'The model sent an empty reply. Try again, or pick a larger model for building (code-tuned models work best).' });
        return 'error';
      }

      // Plan gate: the user approves the plan before anything is changed.
      if (ctx.mode === 'plan' && !ctx.chat.plan) {
        const p = turn.actions.find((a): a is Extract<Action, { type: 'plan' }> => a.type === 'plan');
        const md = p?.markdown || turn.prose;
        ctx.patch(aid, { text: p ? turn.prose : '' } as Partial<AgentItem>);
        ctx.push({ kind: 'plan', id: uid('plan'), markdown: md, state: 'proposed' });
        ctx.chat.plan = '';
        return 'plan';
      }

      if (!turn.actions.length) {
        // A reply with no actions: nothing more to do (a question to the user, or a final answer).
        if (turn.pending) ctx.push({ kind: 'note', id: uid('n'), tone: 'error', text: 'The reply was cut off in the middle of an action (the model ran out of room). Ask it to continue, or build smaller pieces.' });
        return turn.pending ? 'error' : 'done';
      }

      const results: string[] = [];
      let finished = false;
      for (let i = 0; i < turn.actions.length; i++) {
        const a = turn.actions[i];
        if (a.type === 'done') { ctx.push({ kind: 'note', id: uid('n'), tone: 'done', text: a.summary || 'Done.' }); finished = true; break; }
        if (a.type === 'plan') { ctx.chat.plan = a.markdown; ctx.push({ kind: 'plan', id: uid('plan'), markdown: a.markdown, state: 'approved' }); results.push('plan updated'); continue; }
        const id = uid('act');
        ctx.push({ kind: 'action', id, tool: a.type, label: label(a), detail: a.type === 'write_file' ? `${a.content.split('\n').length} lines` : undefined, status: 'running' });
        const r = await execute(a, ctx, id);
        results.push(`[${i + 1}] ${r.result}`);
        if (ctx.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      }
      if (finished) return 'done';
      ctx.chat.history.push({ role: 'user', content: `Results of your actions:\n${results.join('\n\n')}\n\nContinue. When everything works, finish with <done>.` });
    }
    ctx.push({ kind: 'note', id: uid('n'), tone: 'info', text: `Paused after ${MAX_STEPS} steps. Say "continue" to keep going.` });
    return 'limit';
  } catch (e) {
    if ((e as Error).name === 'AbortError' || ctx.signal.aborted) { ctx.push({ kind: 'note', id: uid('n'), tone: 'info', text: 'Stopped.' }); return 'stopped'; }
    ctx.push({ kind: 'note', id: uid('n'), tone: 'error', text: (e as Error).message });
    return 'error';
  }
}

export { findServerUrl };
