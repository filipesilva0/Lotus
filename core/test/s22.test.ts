// 0.10.6: on a Mac, nothing worked. Chat: llama-server ran with a 4,096-token context, smaller than
// Lotus's own system prompt and tools (5,118 tokens). Images: Metal ran out of memory with the chat
// model still loaded, and the error wasn't recognised as a memory one.

import { describe, expect, test } from 'bun:test';
import { MIN_CHAT_CTX, sdcppMemoryError } from '../src/engines/manager';
import { chatTurn } from '../src/agent/llm';
import { sdcppArgs, type ImageProfile } from '../../src/models/imageProfiles';

const METAL_LOG = `[E] ggml: ggml_metal_synchronize: error: command buffer 0 failed with status 5
[E] ggml: error: Insufficient Memory (00000008:kIOGPUCommandBufferCallbackErrorOutOfMemory)
[E] generate failed`;

describe('Mac image memory', () => {
  test("Metal's out-of-memory error is recognised", () => {
    expect(sdcppMemoryError(METAL_LOG, 16)).toContain('The Mac ran out of graphics memory');
  });
  test('vaeTiling adds only --vae-tiling', () => {
    const p = { id: 'x', name: 'x', family: 'sdxl', files: { model: 'm.safetensors' } } as unknown as ImageProfile;
    const run = { prompt: 'a', width: 1024, height: 1024, seed: 1, count: 1, steps: 20, cfg: 5, sampler: 'euler', scheduler: 'normal', output: 'o.png' };
    const a = sdcppArgs(p, { ...run, vaeTiling: true }, (f, n) => `${f}/${n}`);
    expect(a).toContain('--vae-tiling');
    expect(a).not.toContain('--offload-to-cpu');
    expect(sdcppArgs(p, run, (f, n) => `${f}/${n}`)).not.toContain('--vae-tiling');
  });
});

describe('chat context', () => {
  test('the built-in engine never starts below 8K', () => { expect(MIN_CHAT_CTX).toBe(8192); });
  test('a too-long request restarts the server with more room and retries', async () => {
    const urls: string[] = [];
    let grown = 0;
    const fetch = async (url: string) => {
      urls.push(url);
      if (url.startsWith('http://small')) return new Response('{"error":{"code":400,"message":"request (5118 tokens) exceeds the available context size (4096 tokens), try increasing it","type":"exceed_context_size_error","n_prompt_tokens":5118,"n_ctx":4096}}', { status: 400 });
      return new Response('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    const out = await chatTurn({ backend: 'llamacpp', url: 'http://small', model: 'm', signal: new AbortController().signal, fetch, growCtx: async (n) => { grown = n; return 'http://big'; } },
      [{ role: 'user', content: 'x' }], null, { token: () => {}, thinking: () => {} });
    expect(out.content).toBe('hi');
    expect(grown).toBe(8192);
    expect(urls[1]).toStartWith('http://big');
  });
  test('without a way to grow, the error says what to do', async () => {
    const fetch = async () => new Response('{"error":{"type":"exceed_context_size_error","n_prompt_tokens":90000}}', { status: 400 });
    await expect(chatTurn({ backend: 'llamacpp', url: 'http://s', model: 'm', signal: new AbortController().signal, fetch }, [{ role: 'user', content: 'x' }], null, { token: () => {}, thinking: () => {} }))
      .rejects.toThrow('longer than the model');
  });
});
