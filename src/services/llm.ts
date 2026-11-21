// One door to the local language model, whichever server the user runs (Settings → Engines):
// Lotus's own llama.cpp (built in, session 17: the core starts llama-server with the chosen model),
// Ollama, or a llama-server the user runs. Chat, Thinking mode, background agents, memory learning,
// skills, tasks and routines all call through here.

import { ChatOptions, ChatStats, ChatTurn, ollamaClient } from './ollamaService';
import { LlamaCppService } from './llamacppService';
import { hasLiveSettings, liveSettings } from '../lib/liveSettings';
import { engineChoice } from '../lib/engineDefaults';
import { kv } from '../lib/store';
import { authHeaderFromToken, llamacppToken } from './engineConfig';
import { builtinsNow, ensureChat } from '../lib/builtins';
import { llamaOpts } from './thinkSwitch';

let builtinUrl = '';
export const llamacpp = new LlamaCppService(
  () => (backend() === 'builtin' ? builtinUrl : hasLiveSettings() ? liveSettings().llamacppUrl : savedLlamacppUrl()),
  () => (backend() === 'llamacpp' ? authHeaderFromToken(llamacppToken()) : null),
);

function savedLlamacppUrl(): string {
  try { return String(JSON.parse(kv.getItem('lotus.settings.v1') || '{}').llamacppUrl || 'http://127.0.0.1:8080'); } catch { return 'http://127.0.0.1:8080'; }
}

// Windows without live settings (the island) read the saved choice, with the same defaults as the core.
export const backend = (): 'builtin' | 'ollama' | 'llamacpp' => (hasLiveSettings() ? liveSettings().llmBackend : engineChoice(kv.getItem('lotus.settings.v1')).llmBackend);

/** The built-in engine loads the model on first use (and swaps when another model is asked for). */
async function ready(model: string) {
  if (backend() !== 'builtin') return;
  builtinUrl = await ensureChat(model, (hasLiveSettings() && liveSettings().contextWindow) || undefined);
}

export const llm = {
  name: () => (backend() === 'builtin' ? 'Lotus' : backend() === 'llamacpp' ? 'llama-server' : 'Ollama'),
  streamChat(turns: ChatTurn[], o: ChatOptions, onStats?: (s: ChatStats) => void): AsyncGenerator<string, void, unknown> {
    if (backend() !== 'ollama') {
      return (async function* () { await ready(o.model); yield* llamacpp.streamChat(turns, llamaOpts(o), onStats); })();
    }
    return ollamaClient.streamChat(turns, o, onStats);
  },
  async chatOnce(turns: ChatTurn[], o: ChatOptions & { json?: boolean }) {
    if (backend() !== 'ollama') { await ready(o.model); return llamacpp.chatOnce(turns, llamaOpts(o)); }
    return ollamaClient.chatOnce(turns, o);
  },
  checkHealth: async () => {
    if (backend() === 'builtin') { const s = builtinsNow(); return s.engines.some((e) => e.id === 'llama' && e.installed) && s.models.some((m) => m.kind === 'chat'); }
    return backend() === 'llamacpp' ? llamacpp.checkHealth() : ollamaClient.checkHealth();
  },
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
