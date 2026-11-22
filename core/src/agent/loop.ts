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
import { alwaysRuleFor, decide, Rule } from './policy';
import { claimText, unbackedClaims } from './claims';
import { checkReferences, claimsSources, cleanReferences, refusalText, SeenSources, urlsIn } from './sources';
import { parseTags, TagFilter, tagInstructions } from './tags';
import { callsInText } from './textCalls';
import { analysePrompt, isNoIssues, reviewPrompt, reviewFix, stepsDigest } from './think';
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
  /** Allow rules (Always allow), read at each call so one saved mid-run counts for the rest of it. */
  allow?: () => Rule[];
  maxTurns?: number;
  /** Ollama capabilities when the caller already knows them (tests). */
  capabilities?: string[];
  /** Think mode (Chat's brain button): an analysis turn before acting and a review of the answer after (think.ts). */
  think?: boolean;
  /** 0.21: false when the model can't see pictures (a built-in model without a vision projector). */
  vision?: boolean;
}

export interface AgentDeps {
  llm: Omit<ChatOpts, 'model' | 'signal'>;
  registry: Registry;
  ctx: Omit<ToolCtx, 'progress' | 'signal'>;
  signal: AbortSignal;
  emit: (e: AgentEvent) => void;
  /** Saves the step (called on every change). */
  record: (s: Step, seq: number) => void;
  /** Waits for the user's Allow (true) or Deny (false); 'timeout' when an unattended run got no answer in time. */
  approve: (s: Step) => Promise<boolean | 'timeout'>;
}

export interface AgentOutcome {
  content: string; steps: Step[]; unverified: string[]; mode: 'native' | 'tags';
  /** 0.20.0: false when the model never gave a final answer (it ran out of steps, or wrote nothing), so
   *  the content is Lotus's own note about what went wrong. A run like that is not "Done". */
  finished: boolean;
}

const RULES = `\n\nWhen the user asks you to do something one of your tools can do (files, tasks, images, memory, web, the computer, the browser), use the tool; don't describe how they could do it themselves. Never say you did something unless a tool call in this conversation did it and its result said so. If a tool fails or is denied, say so plainly.`;

const MAX_CALLS_PER_TURN = 6;
/** 0.16.5: web searches one run may make. The 0.16.0 test saw a model search 8 times for the Formula 1
 *  results and the Lisbon weather, run out of steps and never answer. After this many it is told to answer. */
export const MAX_SEARCHES = 5;
/** Asked when a run used up its tool steps without answering: one more turn, with no tools, to answer from what it found. */
export const FINAL_ANSWER_PROMPT = "(Lotus) You have used all your tool steps, so you can't call any more tools. Answer the user's request now, using only what the tool results above say. If something couldn't be found or done, say so plainly. Don't mention tools or steps.";
const NO_SOURCES_CLAIM = 'cite sources (none were found)';
/** 0.20.0: after this many web searches in a row fail, the run stops searching (the engines are refusing;
 *  more searches only make them refuse longer). The 0.19 review saw 8 failed searches in one agent. */
export const MAX_FAILED_SEARCHES = 2;

/** The reply when the model never answered: what went wrong, in plain words, from the steps' own results. */
export function unfinishedNote(steps: Step[], why: 'steps' | 'empty' = 'steps'): string {
  const failed = steps.filter((s) => s.status === 'error');
  const searches = steps.filter((s) => s.tool === 'web.search');
  const badSearches = searches.filter((s) => s.status === 'error');
  const lines = [why === 'steps' ? "I couldn't finish this: I ran out of steps before I had an answer." : "I couldn't finish this: the model stopped without writing an answer."];
  if (searches.length && badSearches.length === searches.length) {
    lines.push(`Web search didn't work: ${badSearches.length === 1 ? 'the search' : `all ${badSearches.length} searches`} failed (${badSearches[badSearches.length - 1].detail ?? 'no reason given'}).`);
  } else if (failed.length) {
    lines.push(`${failed.length} of ${steps.length} steps failed. The last error: ${failed[failed.length - 1].detail ?? 'no reason given'}.`);
  }
  lines.push('The steps above show what was done. You can try again, or ask for a smaller piece of the job.');
  return lines.join(' ');
}
/** How long an unattended run (a task, a routine) waits for Allow / Deny; interactive runs wait until answered or stopped. */
export const APPROVAL_WAIT_MS = { value: 15 * 60_000 };
/** A turn stops after this many tokens (thinking included) unless the user set a limit, so a model that
 *  rambles or loops can't hold the chat forever. */
const TURN_TOKENS = 4096;
const short = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function runAgent(req: AgentRequest, d: AgentDeps): Promise<AgentOutcome> {
  const steps: Step[] = [];
  let mode: 'native' | 'tags' = 'tags';
  let think = d.llm.think;
  let caps: string[] = [];
  // The built-in llama-server runs with --jinja, so it takes an OpenAI tool list (falls back to tags below).
  if (d.llm.backend === 'llamacpp' && d.llm.nativeTools && req.tools.length) mode = 'native';
  // llama.cpp can't tell Lotus whether a model reasons, and its templates reason by default: Think off
  // means no reasoning (seen: Gemma 4 12B reasoned 108-155 s on a one-line question and never answered).
  if (d.llm.backend === 'llamacpp' && d.llm.think === undefined) think = false;
  if (d.llm.backend === 'ollama' && req.tools.length) {
    caps = req.capabilities ?? (await ollamaCapabilities({ ...d.llm, model: req.model, signal: d.signal }));
    mode = caps.length === 0 || caps.includes('tools') ? 'native' : 'tags';
    // Thinking models answer tool requests without a long think first, and some (seen: an abliterated
    // qwen3 8B on an RTX 4060) think for minutes and never call the tool. Thinking mode stays on the Think button.
    if (caps.includes('thinking') && d.llm.think === undefined) think = false;
  }

  const messages: WireMsg[] = req.messages.map((m) => ({ ...m }));
  // Think mode reasons in its analysis and review turns (native reasoning when the model has it); tool turns stay as above.
  const reasoning = req.think && (caps.includes('thinking') || d.llm.backend === 'llamacpp') ? true : think;
  const aside = async (extra: WireMsg[], numPredict: number, temperature: number, title: string): Promise<string> => {
    d.emit({ kind: 'thinking', text: `\n\n### ${title}\n` });
    const r = await chatTurn({ ...d.llm, think: reasoning, numPredict, temperature, model: req.model, signal: d.signal }, [...messages, ...extra], null, {
      token: (t) => d.emit({ kind: 'thinking', text: t }),
      thinking: (t) => d.emit({ kind: 'thinking', text: t }),
    });
    return parseTags(r.content).text.trim();
  };
  if (req.think && !d.signal.aborted) {
    // STATE #5: Think mode used to skip the agent (no tools, no claim check). Now it analyses first, then acts.
    const analysis = await aside([{ role: 'user', content: analysePrompt(req.tools) }], 1200, 0.3, 'Analysis');
    if (analysis) {
      const note = `\n\nYour private analysis of the user's latest message (use it; don't show it to the user):\n<analysis>\n${analysis.slice(0, 6000)}\n</analysis>`;
      if (messages[0]?.role === 'system') messages[0] = { ...messages[0], content: `${messages[0].content}${note}` };
      else messages.unshift({ role: 'system', content: note.trim() });
    }
  }
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
  let reviewed = !req.think;
  let lastCall = '';
  let repeats = 0;
  let searches = 0;
  let failedSearches = 0;
  let searchDown = '';
  let sourcesNudged = false;
  /** Web addresses that really came back from a tool (or that the user gave), for "no invented references". */
  const seen = new SeenSources();
  seen.add(urlsIn(req.messages.map((m) => m.content).join('\n')));
  /** Documents already sent back once for made-up links; the second try is saved cleaned. */
  const refused = new Set<string>();
  const maxTurns = req.maxTurns ?? 8;

  for (let turn = 0; turn < maxTurns; turn++) {
    if (d.signal.aborted) break;
    const keep = shown;
    const sep = !shown.trim() ? '' : shown.endsWith('\n\n') ? '' : shown.endsWith('\n') ? '\n' : '\n\n';
    let firstToken = true;
    let filter = mode === 'tags' ? new TagFilter() : null;
    // Think mode, before the review: the answer is written into the reasoning drawer, not the chat, so
    // the review happens inside the reasoning and the chat ends when the answer appears (it used to
    // stream the answer, then keep "thinking" for a while to check it, and sometimes rewrite it).
    const hold = !reviewed;
    let held = '';
    const emitText = (t: string) => {
      const text = firstToken ? sep + t.replace(/^\s+/, '') : t;
      if (!text) return;
      firstToken = false;
      shown += text;
      d.emit({ kind: 'token', text });
    };
    const show = (t: string) => {
      if (!t) return;
      if (!hold) { emitText(t); return; }
      if (!held) d.emit({ kind: 'thinking', text: '\n\n### Draft answer\n' });
      held += t;
      d.emit({ kind: 'thinking', text: t });
    };
    /** Puts the held answer in the chat (all at once: it was already written in the reasoning). */
    const release = () => { const t = held; held = ''; if (t.trim()) emitText(t); };

    let result;
    try {
      result = await chatTurn({ ...d.llm, think, numPredict: d.llm.numPredict ?? TURN_TOKENS, model: req.model, signal: d.signal }, messages, mode === 'native' ? wireTools(req.tools) : null, {
        token: (t) => show(filter ? filter.push(t) : t),
        thinking: (t) => d.emit({ kind: 'thinking', text: t }),
        // What was shown this turn was the model's thinking (`</think>` with no opening tag): take it back.
        retract: () => { d.emit({ kind: 'reset', keep: keep.length }); shown = keep; held = ''; firstToken = true; if (filter) filter = new TagFilter(); },
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
      held = '';
      const known = req.tools.some((t) => t.name === fromWire(asText.name));
      if (known) { calls = [asText]; turnText = ''; }
      else if (!fixedText && turn < maxTurns - 1) {
        fixedText = true;
        messages.push({ role: 'assistant', content: result.content });
        messages.push({ role: 'user', content: asText.name ? `(Lotus check) There is no tool called ${asText.name}. Answer the user in plain words.` : '(Lotus check) Answer the user in plain words.' });
        continue;
      }
    }
    // The call inside other text: "Let me check.\n```json\n{"name": …}\n```" (Qwen 2.5 Coder 7B, 0.15.0 review).
    const inside = !calls.length && !asText ? callsInText(turnText, (n) => req.tools.some((t) => t.name === fromWire(n))) : null;
    if (inside) {
      d.emit({ kind: 'reset', keep: keep.length });
      shown = keep;
      held = '';
      calls = inside.calls.map((c) => ({ name: c.name, args: c.args }));
      turnText = '';
    }

    if (!calls.length) {
      // Final answer. Check its claims against the steps that really succeeded.
      const ok = steps.filter((s) => s.status === 'done');
      const missing = unbackedClaims(turnText, ok);
      // "…done, with a Reference List" when no search or page returned anything (0.16.0 Work test).
      const noSources = steps.length > 0 && seen.size === 0 && claimsSources(turnText);
      if (noSources && !sourcesNudged && turn < maxTurns - 1) {
        sourcesNudged = true;
        d.emit({ kind: 'reset', keep: keep.length });
        shown = keep;
        messages.push({ role: 'assistant', content: result.content });
        messages.push({ role: 'user', content: '(Lotus check) Your reply mentions references, sources or citations, but no web search or page in this work returned any sources. Answer again without claiming references, and say plainly that it was written without sources.' });
        continue;
      }
      if (missing.length && !nudged && turn < maxTurns - 1 && req.tools.length) {
        nudged = true;
        d.emit({ kind: 'reset', keep: keep.length });
        shown = keep;
        messages.push({ role: 'assistant', content: result.content });
        messages.push({ role: 'user', content: `(Lotus check) Your reply says you ${missing.map((c) => `did this: “${short(c.sentence, 90)}”`).join('; ')} — but ${missing.some((c) => c.count) ? 'the tool calls in this conversation did not do that much (count what the results say)' : 'no tool call in this conversation did it'}. If the user asked for it, call the tool now. Otherwise answer again without claiming it was done.` });
        continue;
      }
      if (!reviewed && !missing.length && turn < maxTurns - 1 && !d.signal.aborted) {
        // Think mode: review the answer against the request and what the steps really did.
        reviewed = true;
        const review = await aside([{ role: 'assistant', content: result.content }, { role: 'user', content: reviewPrompt(stepsDigest(steps)) }], 900, 0.2, 'Review');
        if (review && !isNoIssues(review)) {
          d.emit({ kind: 'reset', keep: keep.length });
          shown = keep;
          held = '';
          messages.push({ role: 'assistant', content: result.content });
          messages.push({ role: 'user', content: reviewFix(review) });
          continue;
        }
      }
      release();
      const content = shown.trim();
      if (!content && steps.length && !d.signal.aborted) {
        const note = unfinishedNote(steps, 'empty');
        d.emit({ kind: 'token', text: note });
        return { content: note, steps, unverified: [], mode, finished: false };
      }
      return { content, steps, unverified: [...missing.map(claimText), ...(noSources ? [NO_SOURCES_CLAIM] : [])], mode, finished: true };
    }

    // Tool calls. Text written before them ("Let me look that up.") goes to the chat as it always did.
    release();
    if (mode === 'native') messages.push({ role: 'assistant', content: result.content, tool_calls: calls.map((c) => ({ function: { name: c.name, arguments: c.args } })) });
    else messages.push({ role: 'assistant', content: result.content });

    const results: string[] = [];
    const images: Shot[] = [];
    for (const call of calls.slice(0, MAX_CALLS_PER_TURN)) {
      if (d.signal.aborted) break;
      const sig = `${call.name}:${JSON.stringify(call.args)}`;
      repeats = sig === lastCall ? repeats + 1 : 0;
      lastCall = sig;
      const tool = fromWire(call.name);
      let text: string;
      if (repeats >= 2) text = 'You already made this exact call twice. Stop calling it and answer with what you have.';
      else if (tool === 'web.search' && searchDown) {
        text = `Web search is not working right now (${searchDown}). Don't search again in this reply: answer with what you already know or found, and say plainly that you couldn't search the web.`;
      } else if (tool === 'web.search' && ++searches > MAX_SEARCHES) {
        text = `You have already searched ${MAX_SEARCHES} times. Don't search again: answer now with what the results above say, and say plainly what you couldn't find.`;
      } else {
        let args = call.args;
        let refusal: string | null = null;
        if (tool === 'artifact.write' && typeof args.content === 'string') {
          const file = String(args.filename ?? '');
          const check = checkReferences(file, args.content, seen);
          if (check.invented.length || check.refsWithoutSources) {
            const key = file.toLowerCase();
            if (!refused.has(key)) { refused.add(key); refusal = refusalText(check); }
            else args = { ...args, content: cleanReferences(file, args.content, check) };
          }
        }
        if (refusal) text = refusal;
        else {
          const before = steps.length;
          text = await runStep(call.name, args, req, d, steps, images);
          const step = steps.length > before ? steps[steps.length - 1] : null;
          if (step?.status === 'done') seen.add(sourcesOf(step, text));
          if (tool === 'web.search' && step) {
            failedSearches = step.status === 'error' ? failedSearches + 1 : 0;
            if (failedSearches >= MAX_FAILED_SEARCHES) {
              searchDown = step.detail ?? 'the search engines refused';
              text += `\n\n(Lotus) ${failedSearches} searches in a row failed, so web search is off for the rest of this reply. Answer with what you have and say plainly that the web search failed.`;
            }
          }
        }
      }
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
    if (images.length) {
      const shot = images[images.length - 1];
      // 0.21: video.inspect brings its own note; a model that can't see gets told instead of a picture it would choke on.
      const blind = shot.note && (req.vision === false || (d.llm.backend === 'ollama' && caps.length > 0 && !caps.includes('vision')));
      if (blind) messages.push({ role: 'user', content: '(Lotus) The picture could not be shown: this model can\'t see images. Work from the text the tool returned, and tell the user that a chat model that reads images (for example Gemma 3 or Qwen 2.5 VL) would let you see the video.' });
      else messages.push({ role: 'user', content: shot.note ?? '(Lotus) The screenshot you asked for is attached. Coordinates you give to computer.click are pixels in this image.', images: [shot.b64] });
    }
  }

  // Out of turns without a final answer (0.16.0: "I stopped… without a final answer" after 8 searches):
  // one more turn without tools, so the model answers from what it found.
  let answeredAtEnd = false;
  if (steps.length && !d.signal.aborted) {
    const keep = shown;
    try {
      messages.push({ role: 'user', content: FINAL_ANSWER_PROMPT });
      const filter = mode === 'tags' ? new TagFilter() : null;
      let text = '';
      // No reasoning here: a long think could use up the turn's tokens and leave no answer again.
      const r = await chatTurn({ ...d.llm, think: false, numPredict: d.llm.numPredict ?? TURN_TOKENS, model: req.model, signal: d.signal }, messages, null, {
        token: (t) => { text += filter ? filter.push(t) : t; },
        thinking: (t) => d.emit({ kind: 'thinking', text: t }),
        retract: () => { text = ''; },
      });
      if (filter) text += filter.end();
      const parsed = mode === 'tags' ? parseTags(r.content).text : r.content;
      let answer = (text.trim() ? text : parsed).trim();
      // A model that still writes a tool call gets no say here.
      if (textCall(answer) || callsInText(answer, (n) => req.tools.some((t) => t.name === fromWire(n)))) answer = '';
      if (answer) {
        // Text from earlier turns ("Let me search again…") is replaced by the answer.
        d.emit({ kind: 'reset', keep: 0 });
        shown = answer;
        answeredAtEnd = true;
        d.emit({ kind: 'token', text: answer });
      }
    } catch {
      shown = keep; // no final answer after all: the note below says so
    }
  }

  const ok = steps.filter((s) => s.status === 'done');
  const answered = !!shown.trim() && (answeredAtEnd || !steps.length);
  if (!answered && steps.length && !d.signal.aborted) {
    const note = unfinishedNote(steps);
    // Text from earlier turns ("Let me search again…") is not an answer: the note replaces it.
    if (shown.trim()) d.emit({ kind: 'reset', keep: 0 });
    d.emit({ kind: 'token', text: note });
    return { content: note, steps, unverified: [], mode, finished: false };
  }
  const content = shown.trim();
  return { content, steps, unverified: unbackedClaims(content, ok).map(claimText), mode, finished: answered };
}

/** Web addresses a finished step really returned: search results and pages read, a helper's sources,
 *  and links in what a file or page said. A helper's own written answer doesn't count (it may be made up). */
export function sourcesOf(step: Step, text: string): string[] {
  const data = (step.data ?? {}) as { results?: { url?: string }[]; url?: string; sources?: { url?: string }[] };
  const fromData = [...(data.results ?? []), ...(data.sources ?? []), ...(data.url ? [{ url: data.url }] : [])].map((r) => String(r.url ?? '')).filter(Boolean);
  if (step.tool === 'agent.delegate' || step.tool === 'agents.deploy' || step.tool === 'artifact.write' || step.tool === 'artifact.read') return fromData;
  return [...fromData, ...urlsIn(text)];
}

/** One tool call: checks, approval, run, record. Returns the text the model reads. */
/** A picture a tool returned for the model to look at (screenshots, video frames). */
interface Shot { b64: string; note?: string }

async function runStep(name: string, rawArgs: Record<string, unknown>, req: AgentRequest, d: AgentDeps, steps: Step[], images: Shot[] = []): Promise<string> {
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

  const verdict = decide(tool, args, req.approval, req.rules, req.allow?.() ?? []);
  if (verdict.decision === 'deny') {
    update({ status: 'denied', detail: `Blocked by your rule “${verdict.rule}”`, finished: Date.now() });
    return `The user's settings block this (${verdict.rule}). Don't try it again; tell the user it is blocked.`;
  }
  let harm: string | null = null;
  try { harm = tool.destructive ? tool.destructive(args, d.ctx) : null; } catch { harm = null; }
  if (verdict.decision === 'ask' || harm) {
    const what = tool.describe ? tool.describe(args) : `${tool.label}`;
    // A destructive call (emptying a file…) asks every time, so it offers no "Always allow".
    update({ status: 'waiting', ask: harm ? `${harm}. ${what}` : what, always: harm ? undefined : alwaysRuleFor(tool.name, args) ?? undefined });
    const allowed = await d.approve({ ...step });
    if (allowed === 'timeout') {
      update({ status: 'denied', ask: undefined, always: undefined, detail: `No answer within ${Math.round(APPROVAL_WAIT_MS.value / 60_000)} minutes, so Lotus didn't do it`, finished: Date.now() });
      return 'Nobody answered the permission request in time (the user may be away), so it was not done. Do not do it another way; say in your answer that it is waiting for their permission next time.';
    }
    if (!allowed) {
      update({ status: 'denied', ask: undefined, always: undefined, detail: d.signal.aborted ? 'Stopped' : 'You said no', finished: Date.now() });
      return 'The user denied this action. Do not do it another way; tell them it was not done.';
    }
    update({ status: 'running', ask: undefined, always: undefined });
  } else update({});

  let r: ToolResult;
  try {
    r = await tool.run(args, { ...d.ctx, signal: d.signal, progress: (detail) => update({ detail }) });
  } catch (e) {
    const msg = (e as Error)?.name === 'AbortError' ? (d.signal.aborted ? 'Stopped by you' : 'Cut off: the request was cancelled before it finished (a timeout, or the engine restarted)') : (e as Error)?.message || String(e);
    update({ status: 'error', detail: msg, finished: Date.now() });
    return `Error: ${msg}`;
  }
  const { imageB64, imageNote, ...data } = (r.data ?? {}) as Record<string, unknown> & { imageB64?: string; imageNote?: string };
  if (typeof imageB64 === 'string' && imageB64) images.push({ b64: imageB64, note: typeof imageNote === 'string' ? imageNote : undefined });
  update({ status: r.ok ? 'done' : 'error', detail: r.summary, media: r.media, data: r.data ? data : undefined, finished: Date.now() });
  return r.ok ? r.text : `Error: ${r.text}`;
}

/** A reply that is only a JSON tool call written as text (or an empty object). */
export function textCall(text: string): { name: string; args: Record<string, unknown> } | null {
  // Nemotron and Qwen-style templates sometimes leave the call as text (seen 15 Nov with nemotron-3-nano):
  //   <tool_call><function=files_read><parameter=path>notes.txt</parameter></function></tool_call>
  const fx = /<function=([A-Za-z0-9_.-]+)>([\s\S]*?)(?:<\/function>|$)/.exec(text);
  if (fx) {
    const args: Record<string, unknown> = {};
    for (const m of fx[2].matchAll(/<parameter=([A-Za-z0-9_]+)>\s*([\s\S]*?)\s*(?:<\/parameter>|(?=<parameter=)|$)/g)) {
      const raw = m[2];
      let v: unknown = raw;
      if (/^(?:-?\d+(?:\.\d+)?|true|false|null|[[{][\s\S]*[\]}])$/.test(raw)) { try { v = JSON.parse(raw); } catch { v = raw; } }
      args[m[1]] = v;
    }
    return { name: fx[1], args };
  }
  // <tool_call>{"name": …, "arguments": …}</tool_call> (Hermes/Qwen format written as text).
  const tc = /<tool_call>\s*([\s\S]*?)\s*(?:<\/tool_call>|$)/.exec(text);
  if (tc && tc[1].trim().startsWith('{')) return textCall(tc[1]);
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
