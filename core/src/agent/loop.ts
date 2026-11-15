// The agent loop: one loop for every place that talks to a model with tools (Chat today; Tasks,
// routines, the island and the messaging gateway next).
//
//   model turn → tool calls? → for each: deny rules → approval → run → result back to the model → …
//   final text → "no step, no claim" check → (once) ask the model to fix a claim it didn't back → done
//
// Native tool calling when Ollama says the model has the `tools` capability; otherwise tool tags
// (agent/tags.ts) that any model can follow.

import { chatTurn, ChatOpts, ollamaCapabilities, ToolsUnsupported, WireMsg } from './llm';
import { checkArgs, fromWire, Registry, toWire, wireTools } from './registry';
import { decide, Rule } from './policy';
import { claimText, unbackedClaims } from './claims';
import { parseTags, TagFilter, tagInstructions } from './tags';
import type { AgentEvent, ApprovalMode, Step, Tool, ToolCtx, ToolResult } from './types';

export interface AgentRequest {
  runId: string;
  model: string;
  /** System prompt first, then the conversation, ending with the user's message. */
  messages: WireMsg[];
  /** Tool names this run may use (the registry filtered by what's on for the chat). */
  tools: Tool[];
  approval: ApprovalMode;
  rules: Rule[];
  maxTurns?: number;
  /** Ollama capabilities when the caller already knows them (tests). */
  capabilities?: string[];
}

export interface AgentDeps {
  llm: Omit<ChatOpts, 'model' | 'signal'>;
  registry: Registry;
  ctx: Omit<ToolCtx, 'progress' | 'signal'>;
  signal: AbortSignal;
  emit: (e: AgentEvent) => void;
  /** Saves the step (called on every change). */
  record: (s: Step, seq: number) => void;
  /** Waits for the user's Allow (true) or Deny (false). */
  approve: (s: Step) => Promise<boolean>;
}

export interface AgentOutcome { content: string; steps: Step[]; unverified: string[]; mode: 'native' | 'tags' }

const RULES = `\n\nWhen the user asks you to do something one of your tools can do (files, tasks, images, memory, web, the computer, the browser), use the tool; don't describe how they could do it themselves. Never say you did something unless a tool call in this conversation did it and its result said so. If a tool fails or is denied, say so plainly.`;

const MAX_CALLS_PER_TURN = 6;
/** A turn stops after this many tokens (thinking included) unless the user set a limit, so a model that
 *  rambles or loops can't hold the chat forever. */
const TURN_TOKENS = 4096;
const short = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function runAgent(req: AgentRequest, d: AgentDeps): Promise<AgentOutcome> {
  const steps: Step[] = [];
  let mode: 'native' | 'tags' = 'tags';
  let think = d.llm.think;
  if (d.llm.backend === 'ollama' && req.tools.length) {
    const caps = req.capabilities ?? (await ollamaCapabilities({ ...d.llm, model: req.model, signal: d.signal }));
    mode = caps.length === 0 || caps.includes('tools') ? 'native' : 'tags';
    // Thinking models answer tool requests without a long think first, and some (seen: an abliterated
    // qwen3 8B on an RTX 4060) think for minutes and never call the tool. Thinking mode stays on the Think button.
    if (caps.includes('thinking') && d.llm.think === undefined) think = false;
  }

  const messages: WireMsg[] = req.messages.map((m) => ({ ...m }));
  const withInstructions = (m: 'native' | 'tags') => {
    const extra = req.tools.length ? (m === 'tags' ? tagInstructions(req.tools) : '') + RULES : '';
    if (messages[0]?.role === 'system') messages[0] = { ...messages[0], content: `${messages[0].content}${extra}` };
    else messages.unshift({ role: 'system', content: extra.trim() });
  };
  const baseSystem = messages[0]?.role === 'system' ? messages[0].content : null;
  withInstructions(mode);

  let shown = '';
  let nudged = false;
  let fixedText = false;
  let lastCall = '';
  let repeats = 0;
  const maxTurns = req.maxTurns ?? 8;

  for (let turn = 0; turn < maxTurns; turn++) {
    if (d.signal.aborted) break;
    const keep = shown;
    const sep = !shown.trim() ? '' : shown.endsWith('\n\n') ? '' : shown.endsWith('\n') ? '\n' : '\n\n';
    let firstToken = true;
    const filter = mode === 'tags' ? new TagFilter() : null;
    const show = (t: string) => {
      if (!t) return;
      const text = firstToken ? sep + t.replace(/^\s+/, '') : t;
      if (!text) return;
      firstToken = false;
      shown += text;
      d.emit({ kind: 'token', text });
    };

    let result;
    try {
      result = await chatTurn({ ...d.llm, think, numPredict: d.llm.numPredict ?? TURN_TOKENS, model: req.model, signal: d.signal }, messages, mode === 'native' ? wireTools(req.tools) : null, {
        token: (t) => show(filter ? filter.push(t) : t),
        thinking: (t) => d.emit({ kind: 'thinking', text: t }),
      });
    } catch (e) {
      if (e instanceof ToolsUnsupported && mode === 'native') {
        // The model can't take a tool list: use tags instead and redo this turn.
        mode = 'tags';
        if (baseSystem !== null) messages[0] = { role: 'system', content: baseSystem };
        withInstructions('tags');
        turn--;
        continue;
      }
      throw e;
    }
    if (filter) show(filter.end());
    if (result.tokensPerSec) d.emit({ kind: 'stats', tokensPerSec: result.tokensPerSec, durationMs: result.durationMs, promptTokens: result.promptTokens, evalTokens: result.evalTokens });

    let calls = mode === 'native' ? result.calls : parseTags(result.content).calls;
    let turnText = mode === 'native' ? result.content : parseTags(result.content).text;

    // Small models (seen: llama3.2 3B) sometimes write the call as text: {"name": "task_add", "parameters": {…}}.
    const asText = !calls.length ? textCall(turnText) : null;
    if (asText) {
      d.emit({ kind: 'reset', keep: keep.length });
      shown = keep;
      const known = req.tools.some((t) => t.name === fromWire(asText.name));
      if (known) { calls = [asText]; turnText = ''; }
      else if (!fixedText && turn < maxTurns - 1) {
        fixedText = true;
        messages.push({ role: 'assistant', content: result.content });
        messages.push({ role: 'user', content: asText.name ? `(Lotus check) There is no tool called ${asText.name}. Answer the user in plain words.` : '(Lotus check) Answer the user in plain words.' });
        continue;
      }
    }

    if (!calls.length) {
      // Final answer. Check its claims against the steps that really succeeded.
      const ok = steps.filter((s) => s.status === 'done').map((s) => s.tool);
      const missing = unbackedClaims(turnText, ok);
      if (missing.length && !nudged && turn < maxTurns - 1 && req.tools.length) {
        nudged = true;
        d.emit({ kind: 'reset', keep: keep.length });
        shown = keep;
        messages.push({ role: 'assistant', content: result.content });
        messages.push({ role: 'user', content: `(Lotus check) Your reply says you ${missing.map((c) => `did this: “${short(c.sentence, 90)}”`).join('; ')} — but no tool call in this conversation did it. If the user asked for it, call the tool now. Otherwise answer again without claiming it was done.` });
        continue;
      }
      return { content: shown.trim(), steps, unverified: missing.map(claimText), mode };
    }

    // Tool calls.
    if (mode === 'native') messages.push({ role: 'assistant', content: result.content, tool_calls: calls.map((c) => ({ function: { name: c.name, arguments: c.args } })) });
    else messages.push({ role: 'assistant', content: result.content });

    const results: string[] = [];
    const images: string[] = [];
    for (const call of calls.slice(0, MAX_CALLS_PER_TURN)) {
      if (d.signal.aborted) break;
      const sig = `${call.name}:${JSON.stringify(call.args)}`;
      repeats = sig === lastCall ? repeats + 1 : 0;
      lastCall = sig;
      const text = repeats >= 2
        ? 'You already made this exact call twice. Stop calling it and answer with what you have.'
        : await runStep(call.name, call.args, req, d, steps, images);
      if (mode === 'native') messages.push({ role: 'tool', tool_name: toWire(call.name), content: text });
      else results.push(`Tool result for ${call.name}:\n${text}`);
    }
    if (calls.length > MAX_CALLS_PER_TURN) {
      const note = `Only the first ${MAX_CALLS_PER_TURN} tool calls ran; ask for the rest in your next turn.`;
      if (mode === 'native') messages.push({ role: 'tool', tool_name: toWire(calls[MAX_CALLS_PER_TURN].name), content: note });
      else results.push(note);
    }
    if (mode === 'tags') messages.push({ role: 'user', content: results.join('\n\n') });
    // Screenshots (computer.screenshot, browser.screenshot) go to the model as images so a vision
    // model can see the screen. Only the newest is kept to save context.
    if (images.length) messages.push({ role: 'user', content: '(Lotus) The screenshot you asked for is attached. Coordinates you give to computer.click are pixels in this image.', images: [images[images.length - 1]] });
  }

  const ok = steps.filter((s) => s.status === 'done').map((s) => s.tool);
  const content = shown.trim() || (d.signal.aborted ? '' : 'I stopped after several tool steps without a final answer. The steps above show what was done.');
  return { content, steps, unverified: unbackedClaims(content, ok).map(claimText), mode };
}

/** One tool call: checks, approval, run, record. Returns the text the model reads. */
async function runStep(name: string, rawArgs: Record<string, unknown>, req: AgentRequest, d: AgentDeps, steps: Step[], images: string[] = []): Promise<string> {
  const tool = d.registry.get(name);
  const offered = tool && req.tools.some((t) => t.name === tool.name);
  if (!tool || !offered) {
    return `There is no tool called ${name} here. Tools you can use: ${req.tools.map((t) => t.name).join(', ') || 'none'}.`;
  }
  const seq = steps.length;
  const step: Step = { id: `${req.runId}-s${seq}`, runId: req.runId, tool: tool.name, label: tool.label, args: rawArgs, status: 'running', started: Date.now() };
  steps.push(step);
  const update = (p: Partial<Step>) => { Object.assign(step, p); d.record(step, seq); d.emit({ kind: 'step', step: { ...step } }); };

  const { args, error } = checkArgs(tool, rawArgs);
  step.args = Object.keys(args).length ? args : rawArgs;
  if (error) { update({ status: 'error', detail: error, finished: Date.now() }); return `Error: ${error} Fix the arguments and try again.`; }

  const verdict = decide(tool, args, req.approval, req.rules);
  if (verdict.decision === 'deny') {
    update({ status: 'denied', detail: `Blocked by your rule “${verdict.rule}”`, finished: Date.now() });
    return `The user's settings block this (${verdict.rule}). Don't try it again; tell the user it is blocked.`;
  }
  if (verdict.decision === 'ask') {
    update({ status: 'waiting', ask: tool.describe ? tool.describe(args) : `${tool.label}` });
    const allowed = await d.approve({ ...step });
    if (!allowed) {
      update({ status: 'denied', ask: undefined, detail: d.signal.aborted ? 'Stopped' : 'You said no', finished: Date.now() });
      return 'The user denied this action. Do not do it another way; tell them it was not done.';
    }
    update({ status: 'running', ask: undefined });
  } else update({});

  let r: ToolResult;
  try {
    r = await tool.run(args, { ...d.ctx, signal: d.signal, progress: (detail) => update({ detail }) });
  } catch (e) {
    const msg = (e as Error)?.name === 'AbortError' ? 'Stopped' : (e as Error)?.message || String(e);
    update({ status: 'error', detail: msg, finished: Date.now() });
    return `Error: ${msg}`;
  }
  const { imageB64, ...data } = (r.data ?? {}) as Record<string, unknown> & { imageB64?: string };
  if (typeof imageB64 === 'string' && imageB64) images.push(imageB64);
  update({ status: r.ok ? 'done' : 'error', detail: r.summary, media: r.media, data: r.data ? data : undefined, finished: Date.now() });
  return r.ok ? r.text : `Error: ${r.text}`;
}

/** A reply that is only a JSON tool call written as text (or an empty object). */
export function textCall(text: string): { name: string; args: Record<string, unknown> } | null {
  const t = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  if (!t.startsWith('{') || !t.endsWith('}')) return null;
  let j: unknown;
  try { j = JSON.parse(t); } catch { return null; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const o = j as Record<string, unknown>;
  if (!Object.keys(o).length) return { name: '', args: {} };
  const fn = (o.function && typeof o.function === 'object' ? o.function : o) as Record<string, unknown>;
  const name = typeof fn.name === 'string' ? fn.name : '';
  if (!name) return null;
  const raw = fn.parameters ?? fn.arguments ?? {};
  let args: unknown = raw;
  if (typeof raw === 'string') { try { args = JSON.parse(raw); } catch { args = {}; } }
  return { name, args: args && typeof args === 'object' ? (args as Record<string, unknown>) : {} };
}
