// Voice calls (0.9.6): the middle of the Voice page's Call tab. One big button starts the call; Lotus
// listens, answers aloud and remembers across calls and chats. A finished call can be read again.
// The call itself runs in voice/call.ts, so it keeps going on other pages.

import React, { useEffect, useRef } from 'react';
import { BrainCircuit, Ear, Hand, Mic, MicOff, MessageSquare, Phone, PhoneOff } from 'lucide-react';
import { Banner, Btn, cx } from '../../common/ui';
import { usePanels } from '../../../lib/panels';
import { AgentFace } from '../../common/AgentFace';
import { currentAssistantName, useAssistantName } from '../../../lib/identity';
import { prettyModelName } from '../../../models/names';
import { CallLog } from '../../../voice/studio';
import { callBlocker, endCall, interrupt, setBargeIn, setCallMemory, setMuted, startCall, useCall } from '../../../voice/call';

const PHASE: Record<string, string> = {
  idle: 'Ready', starting: 'Connecting…', listening: 'Listening', thinking: 'Thinking…', speaking: 'Speaking',
};

const Bubble: React.FC<{ role: 'user' | 'assistant'; text: string; live?: boolean }> = ({ role, text, live }) => (
  <div className={cx('flex', role === 'user' ? 'justify-end' : 'justify-start')}>
    <p className={cx('max-w-[80%] px-3.5 py-2 rounded-[16px] text-[14px] leading-relaxed whitespace-pre-wrap',
      role === 'user' ? 'bg-[var(--color-accent-pastel)]' : 'bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)]', live && 'opacity-70')}>{text}</p>
  </div>
);

/** A finished call, read again. */
export const PastCall: React.FC<{ call: CallLog; onCallAgain: () => void; onOpenInChat?: (a: { name: string; text: string; prompt: string }) => void }> = ({ call, onCallAgain, onOpenInChat }) => {
  const mins = call.ended ? Math.max(1, Math.round((call.ended - call.started) / 60000)) : null;
  const text = call.turns.map((t) => `${t.role === 'user' ? 'Me' : currentAssistantName()}: ${t.text}`).join('\n');
  return (
    <div className="max-w-[760px] mx-auto px-6 py-6 space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <h2 className="text-[18px] font-semibold truncate">{call.title}</h2>
          <p className="text-[12px] text-[var(--color-text-muted)]">{new Date(call.started).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{mins ? ` · ${mins} min` : ''} · {call.memory ? 'Remembered' : 'Not remembered (memory was off)'}</p>
        </div>
        {onOpenInChat && <Btn icon={<MessageSquare className="w-3.5 h-3.5" />} onClick={() => onOpenInChat({ name: `${call.title} (call)`, text, prompt: 'Summarize this voice call in a few bullet points, and list anything I said I would do.' })}>Summarize in Chat</Btn>}
        <Btn variant="primary" icon={<Phone className="w-3.5 h-3.5" />} onClick={onCallAgain}>Call Again</Btn>
      </div>
      <div className="space-y-3">{call.turns.map((t) => <Bubble key={t.ts + t.role} role={t.role} text={t.text} />)}</div>
    </div>
  );
};

/** The call screen: face, status, what was said, and the controls. */
export const CallView: React.FC<{ model: string; dictation: boolean; voice: string | null; memoryDefault: boolean; onMemoryDefault: (on: boolean) => void; onOpenModels: () => void }> = ({ model, dictation, voice, memoryDefault, onMemoryDefault, onOpenModels }) => {
  const c = useCall();
  const { setRight } = usePanels();
  const live = !!c.call;
  const blocker = callBlocker({ model, dictation, voice: !!voice });
  const end = useRef<HTMLDivElement>(null);
  const turns = c.call?.turns ?? [];
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [turns.length, c.partial]);
  const memoryOn = c.call ? c.call.memory : memoryDefault;
  const name = useAssistantName();

  // 0.20: before a call the button sits right under the intro, in one centred group (it used to be pinned
  // to the bottom of the page with a large empty gap above it). During a call it moves to the bottom.
  const controls = (
    <>
      <div className={cx('shrink-0 flex items-center justify-center gap-3', live ? 'pt-3 pb-1' : 'pt-6 pb-1')}>
        {live && (
          <button type="button" onClick={() => setMuted(!c.muted)} aria-pressed={c.muted} aria-label={c.muted ? 'Unmute' : 'Mute'} data-tip={c.muted ? 'Unmute' : `Mute (${name} stops listening)`} className="tip w-12 h-12 rounded-full flex items-center justify-center bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)] hover:bg-[var(--hover)]">
            {c.muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>
        )}
        {live
          ? <button type="button" onClick={endCall} aria-label="End call" className="w-16 h-16 rounded-full flex items-center justify-center text-white bg-[var(--c-red)] hover:brightness-110"><PhoneOff className="w-6 h-6" /></button>
          : <button type="button" onClick={() => startCall({ memory: memoryOn })} disabled={!!blocker} aria-label="Start call" className="w-16 h-16 rounded-full flex items-center justify-center text-white bg-[var(--c-green)] hover:brightness-110 disabled:opacity-40"><Phone className="w-6 h-6" /></button>}
        {live && (
          <button type="button" onClick={interrupt} disabled={c.phase !== 'speaking' && c.phase !== 'thinking'} aria-label="Interrupt" data-tip={`Interrupt: stop ${name} and listen`} className="tip w-12 h-12 rounded-full flex items-center justify-center bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)] hover:bg-[var(--hover)] disabled:opacity-40">
            <Hand className="w-5 h-5" />
          </button>
        )}
      </div>
      <div className="shrink-0 flex flex-wrap justify-center gap-x-1 pb-4">
        <button type="button" onClick={() => (live ? setCallMemory(!memoryOn) : onMemoryDefault(!memoryOn))} aria-pressed={memoryOn}
          className={cx('h-7 px-2.5 rounded-[8px] inline-flex items-center gap-1.5 text-[12px]', memoryOn ? 'text-[var(--color-text-main)]' : 'text-[var(--color-text-muted)]', 'hover:bg-[var(--hover)]')}>
          <BrainCircuit className="w-3.5 h-3.5" />{memoryOn ? 'Memory on: remembers across calls and chats' : 'Memory off: this call is not remembered'}
        </button>
        <button type="button" onClick={() => setBargeIn(!c.bargeIn)} aria-pressed={c.bargeIn}
          data-tip={c.bargeIn ? `${name} keeps listening while it talks and stops when you speak. Headphones work best; on speakers, speak up a little.` : `Only the Interrupt button stops ${name}.`}
          className={cx('tip h-7 px-2.5 rounded-[8px] inline-flex items-center gap-1.5 text-[12px]', c.bargeIn ? 'text-[var(--color-text-main)]' : 'text-[var(--color-text-muted)]', 'hover:bg-[var(--hover)]')}>
          <Ear className="w-3.5 h-3.5" />{c.bargeIn ? 'Interrupt by voice: on' : 'Interrupt by voice: off'}
        </button>
      </div>
    </>
  );

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-[760px] mx-auto px-6 pt-6 min-h-full flex flex-col">
      <div className={cx('flex flex-col items-center text-center', live ? 'pt-2' : 'flex-1 justify-center')}>
        <div className="relative" style={{ width: 112, height: 112 }}>
          {/* The ring follows your voice while Lotus listens. */}
          <span aria-hidden="true" className="absolute inset-0 rounded-full transition-transform duration-100"
            style={{ boxShadow: '0 0 0 2px var(--color-accent-fill)', opacity: live && c.phase === 'listening' && !c.muted ? 0.35 + c.level : 0, transform: `scale(${1 + (c.phase === 'listening' ? c.level * 0.25 : 0)})` }} />
          <div className="absolute inset-[16px] flex items-center justify-center">
            <AgentFace size={80} animate={live && c.phase !== 'listening'} mood={c.phase === 'thinking' ? 'thinking' : c.phase === 'speaking' ? 'happy' : undefined} label={name} />
          </div>
        </div>
        <h2 className="mt-3 text-[18px] font-semibold">{live ? (c.muted ? 'Muted' : PHASE[c.phase]) : `Talk with ${name}`}</h2>
        <p className="mt-1 text-[13px] text-[var(--color-text-muted)] max-w-md leading-relaxed">
          {live ? (c.phase === 'listening' && !c.muted ? `Speak whenever you like. ${name} answers when you pause.` : c.phase === 'speaking' || c.phase === 'thinking' ? (c.bargeIn && !c.muted ? 'Just start talking to cut in.' : 'Press Interrupt to cut in.') : ' ')
            : `A voice call with ${model ? prettyModelName(model) : 'your chat model'}, all on this computer. ${name} answers in the language you speak, with ${voice ?? 'your voice'}${memoryOn ? ', and remembers what matters for later calls and chats' : ''}.`}
        </p>
        {!live && controls}
      </div>

      {live && (
        <div className="mt-6 pb-4 space-y-3" aria-live="polite">
          {!turns.length && !c.partial && <p className="text-center text-[13px] text-[var(--color-text-muted)]">Say hello.</p>}
          {turns.map((t) => <Bubble key={t.ts + t.role} role={t.role} text={t.text} />)}
          {c.partial && <Bubble role="assistant" text={c.partial} live />}
          <div ref={end} />
        </div>
      )}

      {c.error && <Banner tone="error" className="mt-4" action={/microphone/i.test(c.error) ? <Btn size="sm" onClick={() => setRight(true)}>Microphone Settings</Btn> : undefined}>{c.error}</Banner>}
      {!live && blocker && <Banner tone="info" className="mt-4" action={<Btn size="sm" onClick={onOpenModels}>Open Models</Btn>}>{blocker}</Banner>}
      </div>
      </div>

      {live && controls}
    </div>
  );
};

