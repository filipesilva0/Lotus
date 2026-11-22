// DOM-free helpers for Work replies (core tests import them).

/**
 * 0.21: thinking a model wrote into its answer (`<think>…</think>`, or a stray `</think>` with the
 * thinking before it) goes in the Thinking pill, never in the answer.
 */
export function splitThink(content: string): { answer: string; thought: string } {
  let thought = '';
  let answer = String(content ?? '').replace(/<think>([\s\S]*?)(<\/think>|$)/gi, (_, t: string) => { thought += t; return ''; });
  const close = answer.indexOf('</think>');
  if (close >= 0) { thought += answer.slice(0, close); answer = answer.slice(close + 8); }
  return { answer: answer.trim(), thought: thought.trim() };
}
