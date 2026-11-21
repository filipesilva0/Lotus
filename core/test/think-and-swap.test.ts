// 0.15.x review fixes for 8 GB cards:
// 1. Think off really is off on llama.cpp (built-in engine and a llama-server the user runs): the request
//    carries the chat template's `enable_thinking` switch. Before, Gemma 4 12B reasoned for minutes.
// 2. Housekeeping (memory, skills, chat titles) runs on the model the built-in engine already holds,
//    instead of swapping the chat model out after every reply.

import { describe, expect, test } from 'bun:test';
import { chatTurn, type ChatOpts, type WireMsg } from '../src/agent/llm';
import { runAgent, type AgentDeps } from '../src/agent/loop';
import { Registry } from '../src/agent/registry';
import { parseRules } from '../src/agent/policy';
import { BACKGROUND_KINDS, modelForJob } from '../../src/agents/jobModel';
import { llamaOpts, thinkingKwargs } from '../../src/services/thinkSwitch';

/** A fake llama-server: records each /v1/chat/completions body and streams back one answer. */
function fakeLlama(answer = 'Lisbon.') {
  const bodies: Record<string, unknown>[] = [];
  const fetchFn = (async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\ndata: [DONE]\n\n`;
    return new Response(sse, { headers: { 'content-type': 'text/event-stream' } });
  }) as unknown as typeof fetch;
  return { bodies, fetchFn };
}

const msgs: WireMsg[] = [{ role: 'system', content: 'You are Lotus.' }, { role: 'user', content: 'Capital of Portugal?' }];
const noop = { token: () => undefined, thinking: () => undefined };

describe('Think switch on llama.cpp (core)', () => {
  const base = (fetchFn: typeof fetch): ChatOpts => ({ backend: 'llamacpp', url: 'http://x', model: 'gemma-4-12b', fetch: fetchFn, signal: new AbortController().signal });

  test('think false → enable_thinking false; true → true; unset → nothing sent', async () => {
    const f = fakeLlama();
    await chatTurn({ ...base(f.fetchFn), think: false }, msgs, null, noop);
    await chatTurn({ ...base(f.fetchFn), think: true }, msgs, null, noop);
    await chatTurn(base(f.fetchFn), msgs, null, noop);
    expect(f.bodies[0].chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(f.bodies[1].chat_template_kwargs).toEqual({ enable_thinking: true });
    expect(f.bodies[2].chat_template_kwargs).toBeUndefined();
  });

  function deps(fetchFn: typeof fetch, think?: boolean): AgentDeps {
    return {
      llm: { backend: 'llamacpp', nativeTools: true, url: 'http://x', fetch: fetchFn, ...(think !== undefined ? { think } : {}) },
      registry: new Registry([]),
      ctx: { db: null as never, studio: '', folders: [], memoryOn: false, fetch: fetchFn, kvSet: () => undefined, kvGet: () => null },
      signal: new AbortController().signal, emit: () => undefined, record: () => undefined, approve: async () => true,
    };
  }
  const req = (think?: boolean) => ({ runId: 'r', model: 'gemma-4-12b', messages: msgs, tools: [], approval: 'auto' as const, rules: parseRules([]), think });

  test('Chat with Think off: the agent tells the model not to reason', async () => {
    const f = fakeLlama();
    const out = await runAgent(req(false), deps(f.fetchFn));
    expect(out.content).toBe('Lisbon.');
    expect(f.bodies.length).toBeGreaterThan(0);
    for (const b of f.bodies) expect(b.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  test('Chat with Think on: the analysis and review turns reason, the answer turn does not', async () => {
    const f = fakeLlama('No issues.');
    await runAgent(req(true), deps(f.fetchFn));
    const switches = f.bodies.map((b) => (b.chat_template_kwargs as { enable_thinking: boolean }).enable_thinking);
    expect(switches.length).toBeGreaterThanOrEqual(2);
    expect(switches[0]).toBe(true); // analysis
    expect(switches).toContain(false); // the turn that answers
  });

  test('Work with Think on (options.think true) reasons in every turn', async () => {
    const f = fakeLlama();
    await runAgent(req(false), deps(f.fetchFn, true));
    for (const b of f.bodies) expect(b.chat_template_kwargs).toEqual({ enable_thinking: true });
  });
});

describe('Think switch on llama.cpp (app)', () => {
  test('llamaOpts: unset and false mean off, true and levels mean on', () => {
    expect(llamaOpts({ model: 'm' }).think).toBe(false);
    expect(llamaOpts({ model: 'm', think: false }).think).toBe(false);
    expect(llamaOpts({ model: 'm', think: true }).think).toBe(true);
    expect(llamaOpts({ model: 'm', think: 'high' }).think).toBe(true);
  });

  test('the llama-server request carries the switch (chat titles asked think: false and got reasoning before)', () => {
    expect(thinkingKwargs(llamaOpts({ model: 'nemotron-3-nano-4b', think: false }).think)).toEqual({ chat_template_kwargs: { enable_thinking: false } });
    expect(thinkingKwargs(llamaOpts({ model: 'm' }).think)).toEqual({ chat_template_kwargs: { enable_thinking: false } });
    expect(thinkingKwargs('medium')).toEqual({ chat_template_kwargs: { enable_thinking: true } });
    expect(thinkingKwargs(undefined)).toEqual({});
  });
});

describe('background model on the built-in engine', () => {
  const s = { backgroundModel: 'nemotron-3-nano-4b', selectedModel: 'gemma-4-12b' };

  test('housekeeping runs on the loaded chat model instead of swapping it out', () => {
    for (const kind of BACKGROUND_KINDS) expect(modelForJob(kind, s, 'gemma-4-12b', 'gemma-4-12b')).toBe('gemma-4-12b');
    // The chat in front of the user may use another model than the default one.
    expect(modelForJob('rename', s, 'gemma-4-12b', 'qwen2.5-coder-7b')).toBe('qwen2.5-coder-7b');
  });

  test('nothing loaded, or another engine: the background model as before', () => {
    expect(modelForJob('memory', s, 'gemma-4-12b', null)).toBe('nemotron-3-nano-4b');
    expect(modelForJob('memory', s, 'gemma-4-12b')).toBe('nemotron-3-nano-4b');
    expect(modelForJob('memory', { selectedModel: 'gemma-4-12b' }, '', null)).toBe('gemma-4-12b');
  });

  test('tasks and routines keep the scaler pick', () => {
    expect(modelForJob('task', s, 'gemma-4-12b', 'qwen2.5-coder-7b')).toBe('gemma-4-12b');
    expect(modelForJob('routine', s, '', 'qwen2.5-coder-7b')).toBe('gemma-4-12b');
  });
});
