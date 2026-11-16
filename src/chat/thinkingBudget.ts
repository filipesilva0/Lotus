// Thinking budget (0.9.1): how long a reasoning model may think before it must answer.
// Nemotron 3 is trained for budget control; llama-server (b11669+) takes `reasoning_budget_tokens`
// per request and ends the thinking at the model's own end tag, and `chat_template_kwargs.
// enable_thinking: false` turns thinking off. Ollama can only turn thinking on or off.
// Pure: shared by the window (Chat, Work) and the core (agent/llm.ts), tested in core/test/s18.test.ts.

/** -1 = no limit (the model decides), 0 = don't think, N = at most N thinking tokens. */
export type ThinkingBudget = number;

export const BUDGET_PRESETS: { id: string; label: string; tokens: ThinkingBudget }[] = [
  { id: 'off', label: 'Off', tokens: 0 },
  { id: 'short', label: 'Short', tokens: 512 },
  { id: 'medium', label: 'Medium', tokens: 2048 },
  { id: 'long', label: 'Long', tokens: 8192 },
  { id: 'none', label: 'No Limit', tokens: -1 },
];

/** Models trained to follow a thinking budget (where the right panel offers it). */
export const hasThinkingBudget = (model: string) => /nemotron/i.test(model);

/** The budget to send for this model, or undefined to leave the model alone. */
export function budgetFor(model: string, setting: ThinkingBudget | undefined): ThinkingBudget | undefined {
  if (!hasThinkingBudget(model) || setting === undefined || setting < 0) return undefined;
  return Math.max(0, Math.round(setting));
}

/** Extra fields for an OpenAI-style request to llama-server. */
export function llamaThinkingFields(budget: ThinkingBudget | undefined, think?: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (think === false || budget === 0) out.chat_template_kwargs = { enable_thinking: false };
  else if (think === true) out.chat_template_kwargs = { enable_thinking: true };
  if (budget !== undefined && budget > 0 && think !== false) out.reasoning_budget_tokens = budget;
  return out;
}

/** Ollama's `think` field: only on/off; a budget of 0 turns thinking off. */
export const ollamaThink = (budget: ThinkingBudget | undefined, think?: boolean): boolean | undefined => (think !== undefined ? think : budget === 0 ? false : undefined);

/** "Short · up to 512 tokens", for the panel. */
export function describeBudget(b: ThinkingBudget): string {
  const p = BUDGET_PRESETS.find((x) => x.tokens === b);
  if (b < 0) return 'No limit: the model thinks as long as it wants';
  if (b === 0) return 'Off: answers straight away';
  return `${p ? `${p.label} · ` : ''}up to ${b.toLocaleString()} thinking tokens`;
}
