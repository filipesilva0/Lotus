// Model names for people (0.20). Get Models said "Gemma 4 12B" while the chat bar, its placeholder, the
// Arena and the Engines card said "gemma-4-12b". Every label in the UI now goes through prettyModelName;
// the raw ID stays in tooltips and in Advanced settings, where people who need it look for it.

import { LIBRARY } from './library';

const SPECIAL: Record<string, string> = {
  gpt: 'GPT', oss: 'OSS', llama: 'Llama', qwen: 'Qwen', phi: 'Phi', sdxl: 'SDXL', sd: 'SD', flux: 'FLUX', vl: 'VL',
  it: '', instruct: 'Instruct', gguf: '', ai: 'AI', r1: 'R1', moe: 'MoE', tts: 'TTS', stt: 'STT', hd: 'HD', xl: 'XL',
};
const QUANT = /[-_.]?(q\d(?:_[a-z0-9]+)*|iq\d\w*|f16|fp16|bf16|f32|q8_0|gguf)$/i;

/** "gemma-4-12b" → "Gemma 4 12B"; "qwen3:8b" → "Qwen 3 8B"; unknown files get a tidy version of their name. */
export function prettyModelName(id: string | undefined | null): string {
  const raw = String(id ?? '').trim();
  if (!raw) return '';
  const hit = LIBRARY.find((e) => e.id === raw || e.ollama === raw || (e.ollama && raw === `${e.ollama}`.replace(/:latest$/, '')));
  if (hit) return hit.title;
  // Remote/cloud and other engines' ids keep a prefix ("ollama:", "openai/") that tells nothing here.
  let s = raw.replace(/^[a-z]+:\/\//i, '').split(/[\\/]/).pop()!.replace(/\.(gguf|safetensors|ckpt|bin|onnx)$/i, '');
  s = s.replace(/:latest$/i, '');
  for (let i = 0; i < 2; i++) s = s.replace(QUANT, '');
  const words = s.replace(/[:_]/g, '-').split('-').filter(Boolean).flatMap((w) => {
    // "qwen3" → "Qwen 3", "llama3.2" → "Llama 3.2"
    const m = /^([a-z]+)(\d[\d.]*)$/i.exec(w);
    return m && !/^(r|v|e)$/i.test(m[1]) ? [m[1], m[2]] : [w];
  });
  const out = words.map((w) => {
    const k = w.toLowerCase();
    if (k in SPECIAL) return SPECIAL[k];
    if (/^\d+(\.\d+)?[bmk]$/i.test(w)) return w.toUpperCase();      // 8b → 8B
    if (/^[a-z]\d+[a-z]?$/i.test(w)) return w.toUpperCase();         // e2b → E2B, r1 → R1
    return w[0].toUpperCase() + w.slice(1);
  }).filter(Boolean).join(' ');
  return out || raw;
}
