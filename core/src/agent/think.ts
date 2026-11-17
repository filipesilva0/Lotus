// Think mode on the agent (pure, tested). Chat's brain button used to run a tool-less 4-pass pipeline
// (src/chat/thinking.ts), so a "thinking" reply could neither use tools nor be checked against them.
// Now the agent does: one analysis turn without tools → the normal tool loop → one review of the
// final answer against the steps that really ran → (if the review finds problems) one more go.

import type { Step, Tool } from './types';

export function analysePrompt(tools: Pick<Tool, 'name' | 'label'>[]): string {
  const list = tools.length ? `\nTools you will be able to use next: ${tools.map((t) => `${t.name} (${t.label.toLowerCase()})`).join(', ')}.` : '';
  return `Before answering, analyse the user's latest message carefully. Do NOT answer it yet and do NOT call tools yet.
Write, briefly and concretely:
1. What exactly is being asked or should be done (including implied parts).
2. Which steps need a tool, which tool, and in what order. Anything that needs no tool.
3. Facts, numbers or definitions the answer depends on; mark anything you are unsure of as UNSURE.
4. Likely traps: ambiguity, edge cases, things that must not be changed or deleted.
5. An outline of the final answer.${list}`;
}

/** One line per step, so the review can check the answer against what really happened. */
export function stepsDigest(steps: Pick<Step, 'tool' | 'status' | 'detail'>[]): string {
  if (!steps.length) return 'No tool steps ran in this conversation turn.';
  return steps.map((s) => `- ${s.tool}: ${s.status}${s.detail ? ` — ${s.detail.slice(0, 160)}` : ''}`).join('\n');
}

export function reviewPrompt(digest: string): string {
  return `Review your answer above as a strict expert reviewer, against the user's request and these tool steps (what really happened):
${digest}
List every concrete problem: parts of the request not done or not answered, claims of actions that no successful step backs, wrong numbers or facts, unclear or padded wording. Say how to fix each.
If the answer is already correct and complete, reply with exactly: NO ISSUES`;
}

export const isNoIssues = (review: string) => /^\s*\**\s*NO ISSUES\b/i.test(review) || review.trim().length < 3;

export function reviewFix(review: string): string {
  return `(Lotus check) A review of your answer found:\n${review.slice(0, 3000)}\nFix it: if something the user asked for wasn't done, call the tool now. Then write the whole answer again (the answer only; don't mention the review).`;
}
