import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, LayoutGrid, MessageSquare, Mic, X } from 'lucide-react';
import { invokeNative, onEvent } from '../lib/bus';
import { applyThemeToDocument } from '../styles/theme';
import { Mascot } from './Mascot';
import { IslandChat, IslandChatHandle } from './IslandChat';
import { ApprovalCard } from './ApprovalCard';
import { useActivity, useAgents } from './hooks';
import { Activity, Mood, loadIsland, mainSettings } from './state';
import { onCoreEvent } from '../lib/core';
import { answerAsk, decideStep } from '../lib/agent';
import { describeAllow } from '../lib/allowRules';
import { kv } from '../lib/store';
import { AgentFace } from '../components/common/AgentFace';

/**
 * The island, session 16 redesign ("ugly, useless, doesn't get out of the way"; then: "akin to the
 * macOS floating island"). Pure black and flush with the top edge of the screen, so it reads as
 * growing out of the notch. Compact: Petal on the leading side, what's happening, and a small
 * progress ring on the trailing side. Hover, a question or a permission request expands it with a
 * spring; it shrinks back (or away) when done.
 *
 * It is not there unless something is happening. The window stays hidden while Lotus is idle and
 * appears at the top of the screen only for:
 *   - work in progress (one line: what, with a thin progress bar), then "done" for 4 seconds
 *   - a question from an agent (ask.user) or a permission request: the answer buttons are right there
 *   - voice: while Lotus speaks or listens
 *   - the quick chat, when you summon it (Ctrl+Alt+Space / tray)
 * The × hides it until the next new event. No rainbow rim, no engine petals, no tiles.
 */

type Ask = { runId: string; askId: string; question: string; options: string[] };
type Perm = { runId: string; stepId: string; text: string; always?: string };
type VoiceState = 'idle' | 'speaking' | 'listening' | 'transcribing';
const KIND_WORD: Record<Activity['kind'], string> = { image: 'Images', voice: 'Voice', chat: 'Chat', download: 'Download', research: 'Research', build: 'Work' };

/** A spring with a little overshoot, like the Dynamic Island. */
const ease = 'cubic-bezier(.34,1.36,.64,1)';
const DONE_MS = 4000;
/**
 * macOS: the island sits over the notch. Its compact form keeps Petal and the status on either side
 * of the notch (the middle 200 pt is hidden by the camera housing) and expanded content starts below it.
 * ⚠️ Not yet seen on a real Mac; on Macs without a notch the middle is simply empty black.
 */
const MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
const NOTCH_W = 200, NOTCH_H = 32;
/** Size of the flared top corners. */
const EAR = 9;

export const Island: React.FC = () => {
  const [settings, setSettings] = useState(loadIsland);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMounted, setChatMounted] = useState(false);
  const [hasChat, setHasChat] = useState(false);
  const [chatMood, setChatMood] = useState<Mood>('idle');
  const [dismissed, setDismissed] = useState<string>('');
  const [hovered, setHovered] = useState(false);
  const [asks, setAsks] = useState<Ask[]>([]);
  const [perms, setPerms] = useState<Perm[]>([]);
  const [voice, setVoice] = useState<VoiceState>('idle');
  const [typed, setTyped] = useState('');
  const [hue, setHue] = useState(() => Number(kv.getItem('lotus.petal.hue')) || 330);
  const activity = useActivity();
  const agents = useAgents(settings.agents);
  const chat = useRef<IslandChatHandle>(null);

  useEffect(() => {
    const sync = (e: StorageEvent) => { if (e.key === 'lotus.island.v1') setSettings(loadIsland()); };
    const apply = () => applyThemeToDocument(mainSettings().palette as never, 'jakarta', 'md', true);
    apply();
    window.addEventListener('storage', sync);
    window.addEventListener('storage', apply);
    return () => { window.removeEventListener('storage', sync); window.removeEventListener('storage', apply); };
  }, []);

  // Lotus's own agents: questions and permission requests, from any window's runs.
  useEffect(() => onCoreEvent((raw) => {
    const e = raw as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (e.type !== 'agent') return;
    if (e.kind === 'ask') setAsks((l) => [...l, { runId: e.runId, askId: e.askId, question: e.question, options: e.options ?? [] }]);
    else if (e.kind === 'answered') setAsks((l) => l.filter((a) => !(a.runId === e.runId && a.askId === e.askId)));
    else if (e.kind === 'step') {
      if (e.step?.status === 'waiting') setPerms((l) => (l.some((p) => p.stepId === e.step.id) ? l : [...l, { runId: e.runId, stepId: e.step.id, text: e.step.ask ?? e.step.label, always: e.step.always }]));
      else setPerms((l) => l.filter((p) => p.stepId !== e.step?.id));
    } else if (e.kind === 'done' || e.kind === 'error') {
      setAsks((l) => l.filter((a) => a.runId !== e.runId));
      setPerms((l) => l.filter((p) => p.runId !== e.runId));
    }
  }), []);

  useEffect(() => {
    const offs: (() => void)[] = [];
    const open = () => { setChatMounted(true); setChatOpen(true); setDismissed(''); void invokeNative('island_focus'); setTimeout(() => chat.current?.focusInput(), 80); };
    void onEvent('island:toggle', () => setChatOpen((v) => { if (!v) open(); return !v; })).then((u) => offs.push(u));
    void onEvent('island:open-chat', open).then((u) => offs.push(u));
    void onEvent('island:dictate', () => { open(); setTimeout(() => chat.current?.toggleDictation(), 150); }).then((u) => offs.push(u));
    void onEvent<VoiceState>('voice:state', (s) => setVoice(s)).then((u) => offs.push(u));
    void onEvent<number>('petal:hue', (h) => setHue(h)).then((u) => offs.push(u));
    return () => offs.forEach((o) => o());
  }, []);

  // ── What to show ─────────────────────────────────────────────────────────
  const claude = agents.queue[0];
  const ask = asks[0];
  const perm = perms[0];
  const running = activity.items.filter((a) => !a.done);
  const finished = activity.items.filter((a) => a.done);
  const head: Activity | undefined = running[0] ?? finished[finished.length - 1];
  const agentRows = running.slice(1).filter((a) => a.agent);
  type Mode = 'hidden' | 'pill' | 'ask' | 'perm' | 'claude' | 'chat';
  // A key for "the thing on screen", so × hides only that and the next new thing shows again.
  const key = claude ? `c${claude.requestId}` : ask ? `a${ask.askId}` : perm ? `p${perm.stepId}` : voice !== 'idle' ? `v${voice}` : head ? `h${head.id}${head.done ? 'd' : ''}` : '';
  const mode: Mode = !settings.enabled && !claude && !ask && !perm && !chatOpen ? 'hidden'
    : chatOpen ? 'chat' : claude ? 'claude' : ask ? 'ask' : perm ? 'perm'
    : key && key !== dismissed ? 'pill' : 'hidden';
  const mood: Mood = mode === 'ask' || mode === 'perm' || mode === 'claude' ? 'alert' : voice === 'listening' ? 'listening' : voice === 'speaking' ? 'speaking'
    : mode === 'chat' ? chatMood : running.length ? 'thinking' : head?.done ? 'happy' : 'idle';

  // Like the Dynamic Island, an update (something starts or finishes) shows the expanded view for a
  // moment, then it settles back to compact.
  const [peek, setPeek] = useState(false);
  const peekKey = `${head?.id ?? ''}${head?.done ? 'd' : ''}`;
  useEffect(() => {
    if (!peekKey) return;
    setPeek(true);
    const t = setTimeout(() => setPeek(false), 2600);
    return () => clearTimeout(t);
  }, [peekKey]);
  const open = hovered || peek;

  // "Done" lines leave on their own.
  useEffect(() => {
    if (running.length || !head?.done) return;
    const t = setTimeout(() => setDismissed(`h${head.id}d`), DONE_MS);
    return () => clearTimeout(t);
  }, [head?.id, head?.done, running.length]);

  const line = voice === 'listening' ? 'Listening…' : voice === 'transcribing' ? 'Got it, writing it down…' : voice === 'speaking' ? 'Speaking…'
    : head ? `${head.done ? '' : ''}${head.label}` : '';

  // ── Window size and visibility ───────────────────────────────────────────
  const dims = useMemo(() => {
    const top = MAC ? NOTCH_H : 0;
    if (mode === 'chat') return { w: 460, h: top + (hasChat ? 500 : 214) };
    if (mode === 'claude') return { w: 480, h: top + 236 };
    if (mode === 'ask') return { w: 440, h: top + 92 + (ask?.options.length ? 40 : 0) + 44 };
    if (mode === 'perm') return { w: 420, h: top + 124 };
    // Compact: a slim black bar. Hovered: the expanded view with everything running and two actions.
    // Work's agents are listed whenever the island opens (each with its face and what it is doing).
    if (open) return { w: 372, h: (MAC ? NOTCH_H : 0) + 66 + (hovered ? Math.max(0, running.length - 1) * 24 + 44 : Math.min(4, agentRows.length) * 24 + (agentRows.length ? 8 : 0)) };
    // Compact: a leading glyph and a short trailing value on either side of the (real or imagined) notch.
    return { w: MAC ? NOTCH_W + 92 : 196, h: MAC ? NOTCH_H : 32 };
  }, [mode, hasChat, ask?.options.length, hovered, open, running.length, agentRows.length]);

  const shown = mode !== 'hidden';
  const compact = mode === 'pill' && !open;
  useEffect(() => { void invokeNative(shown ? 'island_show' : 'island_hide'); }, [shown]);
  const prev = useRef({ w: 0, h: 0 });
  useEffect(() => {
    if (!shown) return;
    const p = prev.current;
    void invokeNative('island_resize', { width: Math.max(p.w, dims.w + 2 * EAR), height: Math.max(p.h, dims.h) });
    const t = setTimeout(() => void invokeNative('island_resize', { width: dims.w + 2 * EAR, height: dims.h }), 420);
    prev.current = { w: dims.w + 2 * EAR, h: dims.h };
    return () => clearTimeout(t);
  }, [dims.w, dims.h, shown]);

  const close = useCallback(() => { setChatOpen(false); setDismissed(key); }, [key]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && (mode === 'chat' || mode === 'pill')) close(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [mode, close]);

  const ring = (a?: Activity, size = 18) => {
    const p = a && !a.done && a.progress != null ? a.progress : null;
    const r = 7, c = 2 * Math.PI * r;
    const color = `hsl(${hue} 80% 62%)`;
    if (a?.done) return <Check style={{ color, width: size - 2, height: size - 2 }} aria-label="Done" />;
    return (
      <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden className={p === null ? 'animate-spin' : ''} style={{ animationDuration: '1.1s' }}>
        <circle cx="9" cy="9" r={r} fill="none" stroke="rgba(255,255,255,.18)" strokeWidth="2.2" />
        <circle cx="9" cy="9" r={r} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeDasharray={p === null ? `${c * 0.28} ${c}` : `${c * p} ${c}`} transform="rotate(-90 9 9)" style={{ transition: 'stroke-dasharray .3s' }} />
      </svg>
    );
  };

  // Compact trailing value: a number when there is one, else a word (Dynamic Island keeps it to one value).
  const trailing = voice === 'speaking' ? 'Speaking' : voice === 'transcribing' ? '…' : !head ? '' : head.done ? 'Done'
    : head.progress != null ? `${Math.round(head.progress * 100)}%` : running.length > 1 ? `${running.length}` : '';

  const btn = 'h-7 px-3 rounded-full text-[12px] font-semibold inline-flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60';

  return (
    <div className="w-screen h-screen flex justify-center items-start select-none overflow-hidden">
      {shown && (
        <div className="relative" style={{ width: dims.w + 2 * EAR, height: dims.h, transition: `width .42s ${ease}, height .42s ${ease}` }}>
        {/* The flared top corners notch apps use: the black curves outwards into the screen's top edge. */}
        <span aria-hidden className="absolute top-0 left-0" style={{ width: EAR, height: EAR, background: 'radial-gradient(circle at 0 100%, transparent ' + (EAR - 0.5) + 'px, #000 ' + EAR + 'px)' }} />
        <span aria-hidden className="absolute top-0 right-0" style={{ width: EAR, height: EAR, background: 'radial-gradient(circle at 100% 100%, transparent ' + (EAR - 0.5) + 'px, #000 ' + EAR + 'px)' }} />
        <div role="region" aria-label="Lotus" aria-live="polite"
          onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
          className="absolute top-0 overflow-hidden text-white bg-black"
          style={{ left: EAR, width: dims.w, height: dims.h, borderRadius: `0 0 ${compact ? 16 : 30}px ${compact ? 16 : 30}px`, boxShadow: compact && head && !head.done ? `inset 0 -1px 0 hsl(${hue} 85% 60% / .55), inset 1px 0 0 hsl(${hue} 85% 60% / .25), inset -1px 0 0 hsl(${hue} 85% 60% / .25)` : 'none', transition: `width .42s ${ease}, height .42s ${ease}, border-radius .42s ${ease}` }}>

          <div className="absolute inset-0" style={{ top: MAC && (mode !== 'pill' || open) ? NOTCH_H : 0 }}>
          {mode === 'pill' && (compact ? (
            <div className="h-full flex items-center justify-between px-2.5" title={line}>
              <Mascot hue={hue} mood={mood} size={20} />
              <span className="flex items-center gap-1.5 text-[12px] font-semibold tabular-nums" style={{ color: `hsl(${hue} 85% 66%)` }}>
                {voice === 'listening' ? <Mic className="w-3.5 h-3.5 animate-pulse" /> : <>{trailing}{ring(voice === 'idle' ? head : undefined)}</>}
              </span>
            </div>
          ) : (
            <div className="h-full flex flex-col">
              <div className="h-[66px] px-4 flex items-center gap-3">
                {head?.agent && voice === 'idle' ? <AgentFace name={head.agent} size={38} animate={!head.done} mood={head.done ? undefined : 'thinking'} /> : <Mascot hue={hue} mood={mood} size={38} />}
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-white/45 leading-tight">{voice !== 'idle' ? 'Voice' : head ? KIND_WORD[head.kind] : 'Lotus'}</p>
                  <p className="truncate text-[15px] font-semibold leading-snug">{line}</p>
                </div>
                <span className="flex flex-col items-end gap-0.5">
                  {voice === 'listening' ? <Mic className="w-5 h-5 animate-pulse" style={{ color: `hsl(${hue} 85% 66%)` }} /> : ring(voice === 'idle' ? head : undefined, 26)}
                  {trailing && <span className="text-[12px] font-semibold tabular-nums" style={{ color: `hsl(${hue} 85% 66%)` }}>{trailing}</span>}
                </span>
              </div>
              {!hovered && agentRows.slice(0, 4).map((a) => <div key={a.id} className="h-6 pl-[66px] pr-4 flex items-center gap-2 text-[12px] text-white/60"><AgentFace name={a.agent} size={16} mood="thinking" /><span className="flex-1 truncate">{a.label}</span>{ring(a)}</div>)}
              {hovered && <>
                {running.slice(1).map((a) => <div key={a.id} className="h-6 pl-[66px] pr-4 flex items-center gap-2 text-[12px] text-white/60">{a.agent && <AgentFace name={a.agent} size={16} mood="thinking" />}<span className="flex-1 truncate">{a.label}</span>{ring(a)}</div>)}
                <div className="mt-auto px-3 pb-3 flex gap-1.5">
                  <button onClick={() => { setChatMounted(true); setChatOpen(true); void invokeNative('island_focus'); }} className={`${btn} bg-[#2c2c2e] hover:bg-[#3a3a3c]`}><MessageSquare className="w-3.5 h-3.5" />Ask Lotus</button>
                  <button onClick={() => void invokeNative('open_main', {})} className={`${btn} bg-[#2c2c2e] hover:bg-[#3a3a3c]`}><LayoutGrid className="w-3.5 h-3.5" />Open</button>
                  <span className="flex-1" />
                  <button aria-label="Hide" title="Hide until something new happens" onClick={close} className="w-7 h-7 rounded-full inline-flex items-center justify-center bg-[#2c2c2e] text-white/70 hover:text-white"><X className="w-3.5 h-3.5" /></button>
                </div>
              </>}
            </div>
          ))}

          {mode === 'ask' && ask && (
            <div className="h-full p-3 flex flex-col" role="alertdialog" aria-label="Lotus is asking you">
              <div className="flex items-start gap-2.5">
                <Mascot hue={hue} mood={mood} size={28} />
                <p className="flex-1 text-[13px] font-medium leading-snug pt-1 line-clamp-2">{ask.question}</p>
              </div>
              {ask.options.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5 pl-[38px]">{ask.options.map((o) => <button key={o} className={`${btn} bg-white/10 hover:bg-white/20`} onClick={() => void answerAsk(ask.runId, ask.askId, o)}>{o}</button>)}</div>}
              <form className="mt-auto pl-[38px] flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { void answerAsk(ask.runId, ask.askId, typed.trim()); setTyped(''); } }}>
                <input value={typed} onChange={(e) => setTyped(e.target.value)} onFocus={() => void invokeNative('island_focus')} placeholder={voice === 'listening' ? 'Listening… or type' : 'Type an answer'} aria-label="Your answer"
                  className="flex-1 h-8 px-3 rounded-full bg-white/10 text-[13px] placeholder:text-white/40 focus:outline-none focus:bg-white/15" />
                {voice === 'listening' && <span className="w-8 h-8 inline-flex items-center justify-center text-[var(--petal-red)]" title="Listening"><Mic className="w-4 h-4 animate-pulse" /></span>}
                <button type="submit" disabled={!typed.trim()} className={`${btn} h-8 bg-[var(--color-accent-vibrant)] disabled:opacity-40`}>Answer</button>
              </form>
            </div>
          )}

          {mode === 'perm' && perm && (
            <div className="h-full p-3 flex flex-col" role="alertdialog" aria-label="Lotus needs your permission">
              <div className="flex items-start gap-2.5">
                <Mascot hue={hue} mood={mood} size={28} />
                <div className="flex-1 min-w-0 pt-0.5"><p className="text-[12px] text-white/55">Lotus needs your permission</p><p className="text-[13px] font-medium leading-snug line-clamp-2">{perm.text}</p></div>
              </div>
              <div className="mt-auto flex justify-end gap-2">
                <button className={`${btn} bg-white/10 hover:bg-white/20`} onClick={() => void decideStep(perm.runId, perm.stepId, false)}><X className="w-3.5 h-3.5" />Deny</button>
                {perm.always && <button className={`${btn} bg-white/10 hover:bg-white/20`} title={`Stops asking for ${describeAllow(perm.always)}`} onClick={() => void decideStep(perm.runId, perm.stepId, true, true)}>Always Allow</button>}
                <button className={`${btn} bg-[var(--color-accent-vibrant)] hover:brightness-110`} onClick={() => void decideStep(perm.runId, perm.stepId, true)}><Check className="w-3.5 h-3.5" />Allow</button>
              </div>
            </div>
          )}

          {mode === 'claude' && claude && (
            <div className="h-full relative">
              <div className="absolute left-3 top-3"><Mascot hue={hue} mood={mood} size={28} /></div>
              <ApprovalCard req={claude} more={agents.queue.length - 1} onAnswer={(allow) => void agents.answer(claude, allow)} />
            </div>
          )}

          {chatMounted && (
            <div className={mode === 'chat' ? 'absolute inset-0' : 'hidden'}>
              <div className="absolute left-3 top-[7px] z-10"><Mascot hue={hue} mood={mood} size={24} /></div>
              <IslandChat ref={chat} onMood={setChatMood} onBusy={(busy, tps) => activity.put({ id: 'island-chat', kind: 'chat', label: busy ? (tps ? `${tps} tok/s` : 'Thinking') : 'Answered', done: !busy })} onClose={close} onHasContent={setHasChat} />
            </div>
          )}
          </div>
        </div>
        </div>
      )}
      {mode === 'hidden' && !chatMounted && <span className="sr-only"><MessageSquare /></span>}
    </div>
  );
};
