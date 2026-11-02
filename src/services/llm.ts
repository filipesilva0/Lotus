// One door to the local language model, whichever server the user runs (Settings → Models):
// Ollama (default) or llama.cpp's llama-server. Chat, Thinking mode, background agents, memory
// learning, skills, tasks and routines all call through here.

import { ChatOptions, ChatStats, ChatTurn, ollamaClient } from './ollamaService';
import { LlamaCppService } from './llamacppService';
import { hasLiveSettings, liveSettings } from '../lib/liveSettings';

export const llamacpp = new LlamaCppService(() => (hasLiveSettings() ? liveSettings().llamacppUrl : 'http://127.0.0.1:8080'));

export const backend = (): 'ollama' | 'llamacpp' => (hasLiveSettings() ? liveSettings().llmBackend : 'ollama');

export const llm = {
  name: () => (backend() === 'llamacpp' ? 'llama-server' : 'Ollama'),
  streamChat(turns: ChatTurn[], o: ChatOptions, onStats?: (s: ChatStats) => void): AsyncGenerator<string, void, unknown> {
    if (backend() === 'llamacpp') { const { think: _t, ...rest } = o; return llamacpp.streamChat(turns, rest, onStats); }
    return ollamaClient.streamChat(turns, o, onStats);
  },
  chatOnce(turns: ChatTurn[], o: ChatOptions & { json?: boolean }) {
    if (backend() === 'llamacpp') { const { think: _t, ...rest } = o; return llamacpp.chatOnce(turns, rest); }
    return ollamaClient.chatOnce(turns, o);
  },
  checkHealth: () => (backend() === 'llamacpp' ? llamacpp.checkHealth() : ollamaClient.checkHealth()),
};

/** Pulls the first JSON object or array out of a model reply (tolerates prose and code fences around it). */
export function extractJson<T = unknown>(text: string): T | null {
  const t = text.replace(/```(?:json)?/gi, '');
  for (const [open, close] of [['{', '}'], ['[', ']']] as const) {
    const a = t.indexOf(open), b = t.lastIndexOf(close);
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)) as T; } catch { /* try the other shape */ } }
  }
  return null;
}
