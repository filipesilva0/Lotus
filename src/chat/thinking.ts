// Thinking mode (the brain button): the model works through the question in several passes before
// the user sees an answer. It takes noticeably longer and usually answers better.
//   1. Analyse  – restate the question, list what is needed, facts, traps, an outline (no answer yet)
//   2. Draft    – a complete answer that follows the analysis
//   3. Check    – a strict review of the draft: errors, gaps, unsupported claims, unclear parts
//   4. Final    – the answer, rewritten with the fixes (streamed to the user)
// Models that support native reasoning (Ollama reports a "thinking" capability) also reason inside
// each pass. Pass outputs are shown in the reply's "Thought for…" drawer, never mixed into the answer.

import type { ChatOptions, ChatStats, ChatTurn } from '../services/ollamaService';
import { llm } from '../services/llm';

export interface Stage { id: 'analyse' | 'draft' | 'check' | 'final'; label: string }
export const STAGES: Stage[] = [
  { id: 'analyse', label: 'Analysing the question' },
  { id: 'draft', label: 'Writing a draft' },
  { id: 'check', label: 'Checking the draft' },
  { id: 'final', label: 'Writing the final answer' },
];

export interface ThinkingCallbacks {
  onStage: (id: Stage['id'], status: 'running' | 'done' | 'error', detail?: string) => void;
  /** Text for the reasoning drawer (pass outputs and native reasoning). */
  onThinking: (text: string) => void;
}

export const ANALYSE_PROMPT = `Before answering, analyse the user's latest message carefully. Do NOT answer it yet.
Write, briefly and concretely:
1. What exactly is being asked (and any hidden or implied sub-questions).
2. What facts, definitions, numbers or steps the answer depends on. Mark anything you are unsure of as UNSURE.
3. Likely traps: ambiguity, common misconceptions, edge cases, outdated information.
4. If sources or web results were provided, which ones are relevant and what they say.
5. An outline of the best possible answer (sections or steps, in order).`;

export const DRAFT_PROMPT = (analysis: string) => `Here is your private analysis of the user's latest message:
<analysis>
${analysis}
</analysis>
Now write a complete, accurate answer to the user's latest message, following the outline. Use GitHub Flavored Markdown where it helps (headings, lists, tables, code blocks). Cite provided sources as [n] only where you use them.`;

export const CHECK_PROMPT = (draft: string) => `Review this draft answer to the user's latest message as a strict expert reviewer:
<draft>
${draft}
</draft>
List every concrete problem: factual errors, wrong numbers or code, missing parts of the question, claims not supported by the provided sources, unclear or padded wording, wrong format. For each, say exactly how to fix it.
If the draft is already correct and complete, reply with exactly: NO ISSUES`;

export const FINAL_PROMPT = (draft: string, review: string) => `Write the final answer to the user's latest message.
<draft>
${draft}
</draft>
<review>
${review}
</review>
Apply every fix from the review${/^\s*NO ISSUES\s*$/i.test(review) ? ' (there were none: keep the draft, tightening only the wording)' : ''}. Reply with the answer only: do not mention the draft, the review or this process.`;

/** Name-based hint for models whose `think` takes a level instead of true/false. */
export const thinkValue = (model: string): boolean | 'high' => (/gpt-oss/i.test(model) ? 'high' : true);

/**
 * Runs the passes and yields the final answer's tokens. `turns` is the normal request
 * (system prompt + history ending with the user's message).
 */
export async function* thinkingStream(
  turns: ChatTurn[],
  o: ChatOptions & { nativeThinking: boolean },
  cb: ThinkingCallbacks,
  onStats?: (s: ChatStats) => void,
): AsyncGenerator<string, void, unknown> {
  const { nativeThinking, ...base } = o;
  const think = nativeThinking ? thinkValue(o.model) : undefined;
  let log = '';
  const note = (title: string, body: string) => { log += `${log ? '\n\n' : ''}### ${title}\n${body.trim()}`; cb.onThinking(log); };
  const ask = async (extra: string, maxTokens: number, temperature: number) => {
    const r = await llm.chatOnce([...turns, { role: 'user', content: extra }], { ...base, temperature, numPredict: maxTokens, think });
    if (r.thinking) note('Reasoning', r.thinking.slice(0, 4000));
    return r.content.trim();
  };

  cb.onStage('analyse', 'running');
  const analysis = await ask(ANALYSE_PROMPT, 1200, 0.3);
  note('Analysis', analysis || '(empty)');
  cb.onStage('analyse', 'done');

  cb.onStage('draft', 'running');
  const draft = await ask(DRAFT_PROMPT(analysis), base.numPredict && base.numPredict > 0 ? base.numPredict : 3000, Math.min(0.7, base.temperature ?? 0.7));
  if (!draft) throw new Error('The model returned an empty draft. Try again, or turn Thinking off for this model.');
  note('Draft', draft.length > 1500 ? `${draft.slice(0, 1500)}…` : draft);
  cb.onStage('draft', 'done', `${draft.length.toLocaleString()} characters`);

  cb.onStage('check', 'running');
  const review = await ask(CHECK_PROMPT(draft), 900, 0.2);
  const clean = /^\s*NO ISSUES\s*\.?\s*$/i.test(review);
  note('Review', clean ? 'No issues found.' : review);
  cb.onStage('check', 'done', clean ? 'No issues found' : 'Fixes needed');

  cb.onStage('final', 'running');
  // Final pass: the model's default reasoning behaviour; any reasoning it streams is appended to the drawer.
  let finalReasoning = '';
  yield* llm.streamChat([...turns, { role: 'user', content: FINAL_PROMPT(draft, clean ? 'NO ISSUES' : review) }], {
    ...base, think: undefined,
    onThinking: (t) => { finalReasoning += t; cb.onThinking(`${log}\n\n### Final pass reasoning\n${finalReasoning}`); },
  }, onStats);
  cb.onStage('final', 'done');
}
