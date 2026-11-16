// Voice calls (0.9.6): talk with the chat model like on the phone.
//
//   listen  the mic records until you stop talking, Whisper writes it down (voice.ts listen)
//   think   the chat model answers, with long-term memory: remembered facts and instructions, matching
//           parts of past chats and calls (full-text recall) and the end of the previous call
//   speak   finished sentences are spoken while the rest of the reply is still being written
//
// The call keeps running when you switch pages. Calls are kept in `lotus.voice.calls.v1`; each turn is
// indexed for recall and the memory learner runs every few turns and when the call ends, so what you
// say on a call is remembered in later calls and chats (unless Memory is off for the call).

import { useSyncExternalStore } from 'react';
import { kv } from '../lib/store';
import { uid } from '../lib/persist';
import { reportActivity } from '../lib/bus';
import { hasLiveSettings, liveSettings } from '../lib/liveSettings';
import { llm } from '../services/llm';
import { effectiveNumCtx } from '../hardware/monitor';
import { buildRecall } from '../memory/recall';
import { loadMemory, memoryStore } from '../memory/store';
import { reflect, shouldReflect } from '../memory/learn';
import { hush, listen, speak } from './voice';
import { CallLog, CallTurn, callSystemPrompt, callTitle, cleanModelText, takeSentences } from './studio';

export const CALLS_KEY = 'lotus.voice.calls.v1';
const MAX_CALLS = 100;

export type CallPhase = 'idle' | 'starting' | 'listening' | 'thinking' | 'speaking';
export interface CallState {
  phase: CallPhase;
  /** The call in progress (null when none). */
  call: CallLog | null;
  /** The reply being written, as far as it goes. */
  partial: string;
  muted: boolean;
  level: number;
  error: string | null;
}

let st: CallState = { phase: 'idle', call: null, partial: '', muted: false, level: 0, error: null };
const subs = new Set<() => void>();
const set = (p: Partial<CallState>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
export const callState = () => st;
export function useCall(): CallState {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => st, () => st);
}

// ── saved calls ─────────────────────────────────────────────────────────────

const callSubs = new Set<() => void>();
let callsCache: CallLog[] | null = null;
export function savedCalls(): CallLog[] {
  if (!callsCache) { try { callsCache = JSON.parse(kv.getItem(CALLS_KEY) || '[]') as CallLog[]; } catch { callsCache = []; } }
  return callsCache;
}
export function saveCalls(fn: (l: CallLog[]) => CallLog[]) {
  callsCache = fn(savedCalls()).slice(0, MAX_CALLS);
  try { kv.setItem(CALLS_KEY, JSON.stringify(callsCache)); } catch { /* keep in memory */ }
  callSubs.forEach((f) => f());
}
export function useSavedCalls(): CallLog[] {
  return useSyncExternalStore((f) => { callSubs.add(f); return () => { callSubs.delete(f); }; }, savedCalls, savedCalls);
}
const keepCall = (c: CallLog) => saveCalls((l) => [c, ...l.filter((x) => x.id !== c.id)]);

// ── the call ────────────────────────────────────────────────────────────────

let ctrl: AbortController | null = null;
/** Bumped by Interrupt: sentences queued under an older number are not spoken. */
let speakGen = 0;

const settings = () => (hasLiveSettings() ? liveSettings() : null);

/** What is missing before a call can start (null when it can). */
export function callBlocker(o: { model: string; dictation: boolean; voice: boolean }): string | null {
  if (!o.model) return 'Pick or get a chat model first (Chat, or Models).';
  if (!o.dictation) return 'Calls need a Whisper model to hear you. Get one in Models.';
  if (!o.voice) return 'Calls need a voice to answer with. Get one in Models.';
  return null;
}

export function startCall(o: { memory: boolean }) {
  if (st.call) return;
  const c: CallLog = { id: uid('call'), title: 'Voice call', started: Date.now(), turns: [], memory: o.memory };
  const a = new AbortController(); ctrl = a;
  set({ call: c, phase: 'starting', partial: '', error: null, muted: false, level: 0 });
  reportActivity({ id: `call-${c.id}`, kind: 'voice', label: 'On a call' });
  void run(c, a);
}

export function endCall() {
  const c = st.call;
  if (!c) return;
  ctrl?.abort(); ctrl = null;
  speakGen++; hush();
  const done: CallLog = { ...st.call!, ended: Date.now(), title: callTitle(st.call!.turns) };
  if (done.turns.length) {
    keepCall(done);
    const s = settings();
    // What was said on the call is learned once more at the end (short calls never reach a reflect turn).
    if (done.memory && s?.autoMemory && done.turns.filter((t) => t.role === 'user').length >= 1) {
      void reflect(done.turns.map((t) => ({ role: t.role, content: t.text })), 'Remembering the call').catch(() => undefined);
    }
  }
  set({ call: null, phase: 'idle', partial: '', level: 0 });
  reportActivity({ id: `call-${c.id}`, kind: 'voice', label: 'Call ended', done: true });
}

export const setMuted = (m: boolean) => set({ muted: m });
export const setCallMemory = (on: boolean) => { if (st.call) set({ call: { ...st.call, memory: on } }); };

/** Stops Lotus mid-sentence and goes back to listening. */
export function interrupt() {
  speakGen++;
  hush();
  replyCtrl?.abort();
}
let replyCtrl: AbortController | null = null;

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((r) => { const t = setTimeout(r, ms); signal.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true }); });

async function run(c: CallLog, a: AbortController) {
  await loadMemory().catch(() => undefined);
  // The end of the previous call (memory on): a greeting can pick up where it left off.
  const prev = savedCalls().find((x) => x.id !== c.id && x.memory && x.turns.length);
  const recent = c.memory && prev ? prev.turns.slice(-6) : [];
  while (!a.signal.aborted) {
    if (st.muted) { set({ phase: 'listening', level: 0 }); await sleep(250, a.signal); continue; }
    set({ phase: 'listening', partial: '' });
    let heard = '';
    try {
      heard = await listen({ silenceMs: 900, maxSec: 45, waitSec: 30, signal: a.signal, onLevel: (l) => { if (Math.abs(l - st.level) > 0.03) set({ level: l }); } });
    } catch (e) {
      if (a.signal.aborted) break;
      set({ error: (e as Error).message });
      endCall();
      return;
    }
    set({ level: 0 });
    if (a.signal.aborted) break;
    if (!heard.trim() || st.muted) continue;
    const user: CallTurn = { role: 'user', text: heard.trim(), ts: Date.now() };
    patchCall((x) => ({ ...x, turns: [...x.turns, user], title: callTitle([...x.turns, user]) }));
    try { await reply(a, recent); }
    catch (e) {
      if (a.signal.aborted) break;
      if ((e as Error).name !== 'AbortError') set({ error: (e as Error).message });
    }
  }
}

function patchCall(fn: (c: CallLog) => CallLog) {
  if (!st.call) return;
  const next = fn(st.call);
  set({ call: next });
  if (next.turns.length) keepCall(next);
}

async function reply(a: AbortController, recent: CallTurn[]) {
  const s = settings();
  const call = st.call!;
  const model = s?.selectedModel ?? '';
  if (!model) throw new Error('No chat model is picked. Pick one in Chat.');
  set({ phase: 'thinking', partial: '', error: null });
  const last = call.turns[call.turns.length - 1];

  // Memory: facts, instructions, matching parts of past chats and calls.
  let memoryBlock = '';
  if (call.memory) {
    try {
      const r = await buildRecall({ query: last.text, sessionId: call.id, memoryOn: true, sessionRecall: s?.sessionRecall !== false, projectFiles: [], budgetChars: 3000 });
      memoryBlock = r.system;
    } catch { /* recall is best effort */ }
  }
  const system = callSystemPrompt({ persona: s?.systemPrompt, date: new Date(), recent }) + memoryBlock;
  const turns = [{ role: 'system' as const, content: system }, ...call.turns.slice(-16).map((t) => ({ role: t.role, content: t.text }))];

  const rc = new AbortController(); replyCtrl = rc;
  const stopReply = () => rc.abort();
  a.signal.addEventListener('abort', stopReply, { once: true });
  const gen = speakGen;
  let chain: Promise<unknown> = Promise.resolve();
  const say = (sentence: string) => {
    chain = chain.then(async () => {
      if (gen !== speakGen || a.signal.aborted) return;
      set({ phase: 'speaking' });
      await speak(sentence);
    });
  };
  let raw = '', spoken = 0, pending = '';
  try {
    for await (const tok of llm.streamChat(turns, { model, temperature: s?.temperature ?? 0.7, numCtx: effectiveNumCtx(), signal: rc.signal })) {
      raw += tok;
      const visible = visibleText(raw);
      if (visible.length > spoken) { pending += visible.slice(spoken); spoken = visible.length; }
      const { sentences, rest } = takeSentences(pending);
      pending = rest;
      sentences.forEach(say);
      set({ partial: visible });
    }
  } catch (e) {
    if (!rc.signal.aborted) throw e;
  } finally { a.signal.removeEventListener('abort', stopReply); }
  const { sentences } = takeSentences(pending, true);
  if (!rc.signal.aborted) sentences.forEach(say);
  const text = cleanModelText(raw);
  if (text && !a.signal.aborted) {
    const ai: CallTurn = { role: 'assistant', text: rc.signal.aborted ? `${visibleText(raw).trim()} …` : text, ts: Date.now() };
    patchCall((x) => ({ ...x, turns: [...x.turns, ai] }));
    afterTurn(last, ai);
  }
  set({ partial: '' });
  await chain;
}

/** The reply without thinking: complete <think> blocks removed, an unfinished one held back. */
function visibleText(raw: string): string {
  const t = raw.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const open = t.search(/<think>/i);
  return open >= 0 ? t.slice(0, open) : t;
}

/** Index the exchange for recall and learn from it now and then (memory on only). */
function afterTurn(user: CallTurn, ai: CallTurn) {
  const c = st.call;
  const s = settings();
  if (!c?.memory) return;
  const title = `Voice call · ${new Date(c.started).toLocaleDateString()}`;
  void memoryStore.index([
    { id: `${c.id}-${user.ts}`, sessionId: c.id, title, role: 'user', content: user.text, ts: user.ts },
    { id: `${c.id}-${ai.ts}`, sessionId: c.id, title, role: 'assistant', content: ai.text, ts: ai.ts },
  ]);
  const userTurns = c.turns.filter((t) => t.role === 'user').length;
  if (s?.autoMemory && shouldReflect(userTurns, user.text)) void reflect(c.turns.map((t) => ({ role: t.role, content: t.text })), 'Remembering the call').catch(() => undefined);
}
