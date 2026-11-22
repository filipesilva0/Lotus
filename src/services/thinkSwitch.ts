// The Think switch for llama.cpp servers. Kept free of app imports so the core's tests can check it
// (core/test/think-and-swap.test.ts).

/** Think (ollamaService.ts), repeated here so this file imports nothing. */
type Think = boolean | 'low' | 'medium' | 'high' | undefined;

/**
 * Options for a llama.cpp server. Its chat templates reason by default and it can't say which models
 * reason, so anything that didn't ask to think is told not to (a background chat title, or a Chat reply
 * with Think off, used to wait minutes for hidden reasoning). Levels ('low'…) mean on.
 */
export function llamaOpts<T extends object>(o: T & { think?: Think }): Omit<T, 'think'> & { think: boolean } {
  return { ...o, think: o.think === undefined ? false : o.think !== false };
}

/**
 * Models whose chat template sets reasoning depth with `reasoning_effort` instead of `enable_thinking`
 * (0.21.0: Inkling 2 from Thinking Machines; its lowest level, "none", is as close to off as it gets).
 */
const EFFORT_MODELS = /inkling/i;

/** The request field that carries the switch (the chat template's `enable_thinking`); nothing when unset. */
export function thinkingKwargs(think: Think, model?: string): { chat_template_kwargs?: { enable_thinking: boolean; reasoning_effort?: string } } {
  if (think === undefined) return {};
  const on = think !== false;
  if (model && EFFORT_MODELS.test(model)) return { chat_template_kwargs: { enable_thinking: on, reasoning_effort: on ? (typeof think === 'string' ? think : 'high') : 'none' } };
  return { chat_template_kwargs: { enable_thinking: on } };
}
