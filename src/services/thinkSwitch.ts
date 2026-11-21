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

/** The request field that carries the switch (the chat template's `enable_thinking`); nothing when unset. */
export function thinkingKwargs(think: Think): { chat_template_kwargs?: { enable_thinking: boolean } } {
  return think === undefined ? {} : { chat_template_kwargs: { enable_thinking: think !== false } };
}
