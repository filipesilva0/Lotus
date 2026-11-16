// Talking with Lotus (session 16).
//
//   speak(text)   Lotus's own voice engine when Settings → Engines picks it (session 17: sherpa-onnx with a
//                 Kokoro or Piper voice), else Voicebox when it is running, otherwise the system's own
//                 voice (Windows/macOS speech through the web view). Resolves when it has finished.
//   listen()      records until you stop talking (a short silence after speech), then transcribes with
//                 the built-in Whisper (session 17) or Voicebox's.
//   voiceState    'idle' | 'speaking' | 'listening' | 'transcribing', mirrored to the island.
//
// Settings (Settings → Voice): voiceNotify speaks agent questions and "done" notices; voiceAnswer
// listens for the answer after a spoken question.

import { MicRecorder, micErrorMessage } from '../lib/audio';
import { emitEvent } from '../lib/bus';
import { kv } from '../lib/store';
import { voicebox } from '../services/voicebox';
import { deleteMedia, loadMedia, rpc, saveMedia, type SavedMedia } from '../lib/core';
import { builtinsNow, refreshBuiltins } from '../lib/builtins';

/** Settings → Engines → Voice, and the built-in voice and dictation models picked there. */
export function builtinVoicePrefs(): { on: boolean; voice: string; speaker: number; dictation: string; language: string } {
  let s: Record<string, unknown> = {};
  try { s = JSON.parse(kv.getItem('lotus.settings.v1') || '{}'); } catch { /* defaults */ }
  const b = builtinsNow();
  const voices = b.models.filter((m) => m.kind === 'voice');
  const dict = b.models.filter((m) => m.kind === 'dictation');
  const voice = voices.find((m) => m.id === s.builtinVoice)?.id ?? voices[0]?.id ?? '';
  const dictation = dict.find((m) => m.id === s.builtinDictation)?.id ?? dict[0]?.id ?? '';
  const LANG: Record<string, string> = { English: 'en', Portuguese: 'pt', Spanish: 'es', French: 'fr', German: 'de', Italian: 'it', Dutch: 'nl', Japanese: 'ja', Chinese: 'zh', Korean: 'ko', Russian: 'ru' };
  return { on: s.voiceEngine === 'builtin', voice, speaker: typeof s.builtinSpeaker === 'number' ? s.builtinSpeaker : 0, dictation, language: LANG[String(s.whisperLanguage ?? '')] ?? '' };
}

const builtinReady = (engine: 'sherpa') => builtinsNow().engines.some((e) => e.id === engine && e.installed);

/** Speaks with the built-in engine; returns the saved audio (the caller decides whether to keep it). */
export async function builtinSpeech(text: string, o: { voice?: string; speaker?: number; speed?: number } = {}): Promise<SavedMedia> {
  if (!builtinsNow().loaded) await refreshBuiltins();
  const p = builtinVoicePrefs();
  const voice = o.voice ?? p.voice;
  if (!builtinReady('sherpa')) throw new Error('Lotus\'s voice engine isn\'t installed yet. Get it in Settings → Models.');
  if (!voice) throw new Error('No voice is downloaded yet. Get one in Settings → Models.');
  return rpc<SavedMedia>('tts_builtin', { voice, text, speaker: o.speaker ?? p.speaker, speed: o.speed ?? 1 });
}

async function viaBuiltin(text: string): Promise<boolean> {
  if (!builtinVoicePrefs().on) return false;
  try {
    const m = await builtinSpeech(text);
    const url = URL.createObjectURL(await loadMedia(m.path));
    void deleteMedia(m.path).catch(() => undefined); // spoken notices aren't kept
    const a = new Audio(url);
    current = a;
    await new Promise<void>((done) => { a.onended = () => done(); a.onerror = () => done(); void a.play().catch(() => done()); });
    URL.revokeObjectURL(url);
    return true;
  } catch { return false; }
}

/** Turns a WAV recording into text with the built-in Whisper. */
export async function builtinTranscribe(wav: Blob, model?: string): Promise<string> {
  const p = builtinVoicePrefs();
  const m = model ?? p.dictation;
  if (!builtinReady('sherpa')) throw new Error('Lotus\'s voice engine isn\'t installed yet. Get it in Settings → Models.');
  if (!m) throw new Error('No dictation model is downloaded yet. Get Whisper in Settings → Models.');
  const saved = await saveMedia(wav, 'recording');
  return (await rpc<{ text: string }>('stt_builtin', { model: m, path: saved.path, language: p.language || undefined })).text.trim();
}

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
  try { return (await viaBuiltin(t)) || (await viaVoicebox(t, profile)) || (await viaSystem(t)); } finally { if (state === 'speaking') setState('idle'); }
}

/**
 * Records until a pause after speech (or `maxSec`), then transcribes. Resolves '' when nothing was
 * said. Rejects with a plain message when the mic is blocked or Voicebox isn't running.
 */
export async function listen(o: { maxSec?: number; silenceMs?: number; waitSec?: number; signal?: AbortSignal } = {}): Promise<string> {
  const maxSec = o.maxSec ?? 30, silenceMs = o.silenceMs ?? 1300, waitSec = o.waitSec ?? 8;
  const builtin = builtinVoicePrefs();
  const useBuiltin = builtin.on && builtinReady('sherpa') && !!builtin.dictation;
  if (!useBuiltin && !(await voicebox.health(1000).then(() => true).catch(() => false))) {
    throw new Error(builtin.on ? 'Spoken answers need a dictation model. Get Whisper in Settings → Models, or type your answer.' : 'Spoken answers need Voicebox running (it turns speech into text). Start it in Engines, or type your answer.');
  }
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
    return useBuiltin ? await builtinTranscribe(r.wav) : (await voicebox.transcribe(r.wav)).text.trim();
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
