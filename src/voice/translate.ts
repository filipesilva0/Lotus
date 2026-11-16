// Translating transcripts (0.9.6). Whisper writes what was said in the language it was said in; the
// chat model translates it into any language, part by part (studio.ts translationParts).

import { llm } from '../services/llm';
import { hasLiveSettings, liveSettings } from '../lib/liveSettings';
import { cleanModelText, translatePrompt, translationParts } from './studio';

export async function translateText(text: string, target: string, o: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}): Promise<string> {
  const model = hasLiveSettings() ? liveSettings().selectedModel : '';
  if (!model) throw new Error('Translating needs a chat model. Pick or get one in Chat first.');
  const parts = translationParts(text);
  const out: string[] = [];
  o.onProgress?.(0, parts.length);
  for (let i = 0; i < parts.length; i++) {
    if (o.signal?.aborted) throw new DOMException('Stopped', 'AbortError');
    const r = await llm.chatOnce([{ role: 'user', content: translatePrompt(target, parts[i]) }], { model, temperature: 0.2, signal: o.signal });
    const t = cleanModelText(r.content);
    if (!t) throw new Error('The chat model returned an empty translation. Try again, or pick another model in Chat.');
    out.push(t);
    o.onProgress?.(i + 1, parts.length);
  }
  return out.join('\n\n');
}
