// Talking with Lotus (session 16).
//
//   speak(text)   Voicebox when it is running (your chosen voice), otherwise the system's own voice
//                 (Windows/macOS speech through the web view). Resolves when it has finished.
//   listen()      records until you stop talking (a short silence after speech), then transcribes
//                 with Voicebox's Whisper. Lotus has no other speech-to-text, so this needs Voicebox.
//   voiceState    'idle' | 'speaking' | 'listening' | 'transcribing', mirrored to the island.
//
// Settings (Settings → Voice): voiceNotify speaks agent questions and "done" notices; voiceAnswer
// listens for the answer after a spoken question.

import { MicRecorder, micErrorMessage } from '../lib/audio';
import { emitEvent } from '../lib/bus';
import { kv } from '../lib/store';
import { voicebox } from '../services/voicebox';

export type VoiceState = 'idle' | 'speaking' | 'listening' | 'transcribing';
let state: VoiceState = 'idle';
const subs = new Set<(s: VoiceState) => void>();
function setState(s: VoiceState) { state = s; subs.forEach((f) => f(s)); void emitEvent('voice:state', s).catch(() => undefined); }
export const voiceState = { get: () => state, on: (f: (s: VoiceState) => void) => { subs.add(f); return () => { subs.delete(f); }; } };

export interface VoicePrefs { notify: boolean; answer: boolean; profile: string }
export function voicePrefs(): VoicePrefs {
  try {
    const s = JSON.parse(kv.getItem('lotus.settings.v1') || '{}');
    return { notify: s.voiceNotify === true, answer: s.voiceAnswer !== false, profile: s.defaultTtsVoice || kv.getItem('lotus.voice.profile') || '' };
  } catch { return { notify: false, answer: true, profile: '' }; }
}

let current: HTMLAudioElement | null = null;
/** Stops anything being spoken. */
export function hush() {
  try { current?.pause(); } catch { /* gone */ }
  current = null;
  try { window.speechSynthesis?.cancel(); } catch { /* none */ }
  if (state === 'speaking') setState('idle');
}

/** Markdown and links read badly aloud; keep the words. */
export function speakable(text: string): string {
  return text.replace(/```[\s\S]*?```/g, ' (code omitted) ').replace(/`([^`]+)`/g, '$1').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_#>|]+/g, ' ').replace(/https?:\/\/\S+/g, 'a link').replace(/\s+/g, ' ').trim().slice(0, 1500);
}

async function viaVoicebox(text: string, profile: string): Promise<boolean> {
  try {
    if (!(await voicebox.health(800).then(() => true).catch(() => false))) return false;
    const q = await voicebox.speak(text, profile ? { profile } : {});
    const g = await voicebox.waitFor(q.id);
    const a = new Audio(await voicebox.audioUrl(g.id));
    current = a;
    await new Promise<void>((done) => { a.onended = () => done(); a.onerror = () => done(); void a.play().catch(() => done()); });
    return true;
  } catch { return false; }
}

function viaSystem(text: string): Promise<boolean> {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  if (!synth) return Promise.resolve(false);
  return new Promise((done) => {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.03;
    u.onend = () => done(true);
    u.onerror = () => done(false);
    synth.speak(u);
  });
}

export async function speak(text: string, profile = voicePrefs().profile): Promise<boolean> {
  const t = speakable(text);
  if (!t) return false;
  hush();
  setState('speaking');
  try { return (await viaVoicebox(t, profile)) || (await viaSystem(t)); } finally { if (state === 'speaking') setState('idle'); }
}

/**
 * Records until a pause after speech (or `maxSec`), then transcribes. Resolves '' when nothing was
 * said. Rejects with a plain message when the mic is blocked or Voicebox isn't running.
 */
export async function listen(o: { maxSec?: number; silenceMs?: number; waitSec?: number; signal?: AbortSignal } = {}): Promise<string> {
  const maxSec = o.maxSec ?? 30, silenceMs = o.silenceMs ?? 1300, waitSec = o.waitSec ?? 8;
  if (!(await voicebox.health(1000).then(() => true).catch(() => false))) throw new Error('Spoken answers need Voicebox running (it turns speech into text). Start it in Engines, or type your answer.');
  let heard = false, quietSince = 0;
  let resolveStop: () => void = () => undefined;
  const stopNow = new Promise<void>((r) => { resolveStop = r; });
  const rec = new MicRecorder((level, t) => {
    if (level > 0.09) { heard = true; quietSince = 0; } else if (heard && !quietSince) quietSince = performance.now();
    if ((heard && quietSince && performance.now() - quietSince > silenceMs) || t > maxSec || (!heard && t > waitSec)) resolveStop();
  });
  try { await rec.start(); } catch (e) { throw new Error(micErrorMessage(e)); }
  setState('listening');
  // The level callback runs on animation frames, which a hidden window may not get; a timer backs it up.
  const guard = setTimeout(resolveStop, (maxSec + 1) * 1000);
  o.signal?.addEventListener('abort', resolveStop, { once: true });
  await stopNow;
  clearTimeout(guard);
  if (o.signal?.aborted) { rec.cancel(); setState('idle'); return ''; }
  if (!heard) { rec.cancel(); setState('idle'); return ''; }
  setState('transcribing');
  try {
    const r = await rec.stop();
    return (await voicebox.transcribe(r.wav)).text.trim();
  } finally { setState('idle'); }
}

/** Picks the option an answer most likely means ("the second one", "B", "five days" → "5"). */
export function matchOption(answer: string, options: string[]): string {
  const a = answer.toLowerCase().replace(/[.!?,]/g, ' ').trim();
  if (!options.length || !a) return answer;
  const ord = ['first', 'second', 'third', 'fourth'];
  const byOrd = ord.findIndex((w) => new RegExp(`\\b${w}\\b`).test(a));
  if (byOrd >= 0 && byOrd < options.length) return options[byOrd];
  const letter = /^(?:option\s+)?([abcd])\b/.exec(a)?.[1];
  if (letter) { const i = 'abcd'.indexOf(letter); if (i < options.length) return options[i]; }
  const words: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };
  const norm = (s: string) => s.toLowerCase().split(/\s+/).map((w) => words[w] ?? w).join(' ');
  const hit = options.find((o) => norm(a).includes(norm(o).replace(/[.!?,]/g, '').trim()));
  return hit ?? answer;
}
