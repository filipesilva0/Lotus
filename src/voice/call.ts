// Voice calls (0.9.6): talk with the chat model like on the phone.
//
//   listen  the mic records until you stop talking, Whisper writes it down (voice.ts listen)
//   think   the chat model answers, with long-term memory: remembered facts and instructions, matching
//           parts of past chats and calls (full-text recall) and the end of the previous call
//   speak   finished sentences are spoken while the rest of the reply is still being written; the next
//           sentence's audio is made while the current one plays (0.15.0)
//   cut in  while Lotus thinks or speaks the mic stays open: talk over it and it stops, and what you
//           said becomes your next turn (bargeIn.ts, 0.15.0). The Interrupt button still works.
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
import { agentAvailable, runAgent } from '../lib/agent';
import { effectiveNumCtx } from '../hardware/monitor';
import { buildRecall } from '../memory/recall';
import { loadMemory, memoryStore } from '../memory/store';
import { reflect, shouldReflect } from '../memory/learn';
import { hush, listen, playSpeech, speak, synthesize, warmVoice } from './voice';
import { watchForBargeIn } from './bargeIn';
import type { MicRecorder } from '../lib/audio';
import { CallLog, CallTurn, callSystemPrompt, callTitle, cleanModelText, firstClause, spokenPart, takeSentences } from './studio';

export const CALLS_KEY = 'lotus.voice.calls.v1';
/** Interrupt by voice on or off (Call page; on unless turned off). */
export const BARGE_KEY = 'lotus.voice.callBarge.v1';
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
  /** Talking over Lotus stops it (interrupt by voice). */
  bargeIn: boolean;
}

const bargeDefault = () => { try { return kv.getItem(BARGE_KEY) !== 'off'; } catch { return true; } };
let st: CallState = { phase: 'idle', call: null, partial: '', muted: false, level: 0, error: null, bargeIn: bargeDefault() };
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
  pendingRec?.cancel(); pendingRec = null;
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
export const setBargeIn = (on: boolean) => { try { kv.setItem(BARGE_KEY, on ? 'on' : 'off'); } catch { /* memory only */ } set({ bargeIn: on }); };
export const setCallMemory = (on: boolean) => { if (st.call) set({ call: { ...st.call, memory: on } }); };

/** Stops Lotus mid-sentence and goes back to listening. */
export function interrupt() {
  speakGen++;
  hush();
  replyCtrl?.abort();
}
let replyCtrl: AbortController | null = null;
/** The recording that heard you talk over Lotus; the next listen continues it. */
let pendingRec: MicRecorder | null = null;

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((r) => { const t = setTimeout(r, ms); signal.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true }); });

async function run(c: CallLog, a: AbortController) {
  await loadMemory().catch(() => undefined);
  // The end of the previous call (memory on): a greeting can pick up where it left off.
  const prev = savedCalls().find((x) => x.id !== c.id && x.memory && x.turns.length);
  const recent = c.memory && prev ? prev.turns.slice(-6) : [];
  // Load Whisper and the voice while you say hello (doesn't hold the call up).
  void warmVoice();
  while (!a.signal.aborted) {
    if (st.muted) { pendingRec?.cancel(); pendingRec = null; set({ phase: 'listening', level: 0 }); await sleep(250, a.signal); continue; }
    set({ phase: 'listening', partial: '' });
    let heard = '';
    try {
      const resume = pendingRec ?? undefined; pendingRec = null;
      // A short pause ends your turn (900 ms before 0.15.0, 750 before 0.21.1); Whisper stays loaded between turns.
      heard = await listen({ silenceMs: 700, maxSec: 45, waitSec: 30, signal: a.signal, resume, warm: true, onLevel: (l) => { if (Math.abs(l - st.level) > 0.03) set({ level: l }); } });
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
  // 0.21.6: calls can use their own model (Voice → Call); otherwise the chat model.
  const model = s?.callModel || s?.selectedModel || '';
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
  let take = 0; // bumped when the agent takes back text it already streamed (the claim check)
  let chain: Promise<unknown> = Promise.resolve();
  // Audio is made one sentence at a time, ahead of what is playing, so there's no gap between sentences.
  let making: Promise<Blob | null> = Promise.resolve(null);
  const stale = (mine: number) => gen !== speakGen || mine !== take || a.signal.aborted;
  let said = 0;
  // Sentences already heard in full. When the claim check takes the reply back, the model usually writes
  // much of it again: those sentences aren't said a second time (0.21.1; the call repeated itself).
  const heard = new Set<string>();
  const key = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const say = (sentence: string) => {
    const mine = take;
    if (mine > 0 && heard.has(key(sentence))) return;
    said++;
    const audio = making = making.then(() => (stale(mine) ? null : synthesize(sentence).catch(() => null)));
    chain = chain.then(async () => {
      const clip = await audio;
      if (stale(mine)) return;
      set({ phase: 'speaking' });
      // Without interrupt by voice nothing listens while Lotus talks: play straight out (0.21.6).
      if (clip) await playSpeech(clip, { direct: !watch }); else await speak(sentence);
      if (!stale(mine)) heard.add(key(sentence));
    });
  };
  // Talking over Lotus stops it; your words carry on into the next turn.
  const watch = st.bargeIn && !st.muted ? watchForBargeIn((rec) => { pendingRec = rec; interrupt(); }) : null;
  let raw = '', spoken = 0, pending = '';
  /** The visible reply as far as it was taken for speaking. */
  let said0 = '';
  try {
    for await (const tok of replyStream(turns, { model, temperature: s?.temperature ?? 0.7, numCtx: effectiveNumCtx(), signal: rc.signal, memoryOn: call.memory, prompt: last.text })) {
      if (typeof tok !== 'string') {
        // The agent's claim check asked for the reply again: stop saying the old one.
        take++; hush();
        raw = raw.slice(0, tok.keep); spoken = Math.min(spoken, visibleText(raw).length); pending = ''; said0 = visibleText(raw).slice(0, spoken);
        set({ partial: visibleText(raw) });
        continue;
      }
      raw += tok;
      const visible = visibleText(raw);
      if (!visible.startsWith(said0)) {
        // A closing thinking marker turned up: what was taken for the answer was thinking. Stop saying it.
        take++; hush();
        spoken = 0; pending = ''; said0 = '';
      }
      if (visible.length > spoken) { pending += visible.slice(spoken); spoken = visible.length; said0 = visible; }
      const { sentences, rest } = takeSentences(pending);
      pending = rest;
      sentences.forEach(say);
      // The first words go out at a comma when the first sentence is long, so Lotus starts talking sooner.
      if (!said) { const f = firstClause(pending); if (f) { pending = f.rest; say(f.clause); } }
      set({ partial: visible });
    }
  } catch (e) {
    if (!rc.signal.aborted) { watch?.stop(); throw e; }
  } finally { a.signal.removeEventListener('abort', stopReply); }
  { const all = spokenPart(raw, true); if (all.startsWith(said0) && all.length > spoken) pending += all.slice(spoken); }
  const { sentences } = takeSentences(pending, true);
  if (!rc.signal.aborted) sentences.forEach(say);
  const text = cleanModelText(raw);
  if (text && !a.signal.aborted) {
    const ai: CallTurn = { role: 'assistant', text: rc.signal.aborted ? `${visibleText(raw).trim()} …` : text, ts: Date.now() };
    patchCall((x) => ({ ...x, turns: [...x.turns, ai] }));
    afterTurn(last, ai);
  }
  set({ partial: '' });
  try { await chain; } finally { watch?.stop(); }
}

/** The reply without thinking, in any model's markers (studio.ts spokenPart; only <think> before 0.21.5). */
const visibleText = (raw: string) => spokenPart(raw);

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

/**
 * The reply's text as it streams. With the core it comes from the agent, so a call can use tools (add a
 * task, save a note, search the web when on…) with approvals and the claim check (STATE #6); `{ keep }`
 * means the agent took back what it wrote after that point. Without the core, the plain model stream.
 */
async function* replyStream(turns: { role: 'system' | 'user' | 'assistant'; content: string }[], o: { model: string; temperature: number; numCtx: number; signal: AbortSignal; memoryOn: boolean; prompt: string }): AsyncGenerator<string | { keep: number }> {
  const s = settings();
  if (!agentAvailable() || s?.agentTools === false) {
    yield* llm.streamChat(turns, { model: o.model, temperature: o.temperature, numCtx: o.numCtx, signal: o.signal });
    return;
  }
  const queue: (string | { keep: number })[] = [];
  let wake: (() => void) | null = null;
  let end = false, failed: unknown = null;
  const push = (x: string | { keep: number }) => { queue.push(x); wake?.(); };
  const sys = turns[0]?.role === 'system' ? `${turns[0].content}\n\nOn this call you can use your tools when the user asks for something they can do; say briefly what you did, in one or two spoken sentences.` : '';
  const msgs = sys ? [{ role: 'system' as const, content: sys }, ...turns.slice(1)] : turns;
  void runAgent({ model: o.model, prompt: o.prompt.slice(0, 400), messages: msgs, memoryOn: o.memoryOn, source: 'call', options: { temperature: o.temperature, numCtx: o.numCtx } }, (e) => {
    if (e.kind === 'token') push(e.text);
    else if (e.kind === 'reset') push({ keep: e.keep });
  }, o.signal).catch((e) => { failed = e; }).finally(() => { end = true; wake?.(); });
  for (;;) {
    if (queue.length) { yield queue.shift()!; continue; }
    if (end) break;
    await new Promise<void>((r) => { wake = r; });
    wake = null;
  }
  if (failed && !o.signal.aborted) throw failed;
}
