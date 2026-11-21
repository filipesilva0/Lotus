// Microphone choice and check (0.10.1): which input Lotus records from, and a Check button that really
// opens it for a few seconds and shows the level, so "no microphone" can be told apart from "blocked".

import React, { useEffect, useRef, useState } from 'react';
import { Mic, RefreshCw } from 'lucide-react';
import { Btn, IconBtn, Select } from './ui';
import { listMics, micErrorMessage, openMic, preferredMic, setPreferredMic } from '../../lib/audio';
import { count } from '../../lib/plural';

export const MicPicker: React.FC = () => {
  const [mics, setMics] = useState<{ id: string; label: string }[]>([]);
  const [sel, setSel] = useState(preferredMic);
  const [state, setState] = useState<{ kind: 'idle' | 'checking' | 'ok' | 'error'; text?: string }>({ kind: 'idle' });
  const [level, setLevel] = useState(0);
  const stopRef = useRef<(() => void) | null>(null);
  const refresh = () => void listMics().then(setMics);
  useEffect(() => {
    refresh();
    const md = navigator.mediaDevices;
    md?.addEventListener?.('devicechange', refresh);
    return () => { md?.removeEventListener?.('devicechange', refresh); stopRef.current?.(); };
  }, []);

  const check = async () => {
    stopRef.current?.();
    setState({ kind: 'checking' }); setLevel(0);
    try {
      const stream = await openMic(sel);
      refresh(); // names show once a microphone was opened
      const ctx = new AudioContext();
      const an = ctx.createAnalyser(); an.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(an);
      const data = new Uint8Array(an.fftSize);
      let peak = 0, raf = 0;
      const tick = () => { an.getByteTimeDomainData(data); let p = 0; for (const v of data) p = Math.max(p, Math.abs(v - 128) / 128); peak = Math.max(peak, p); setLevel(Math.min(1, p * 1.6)); raf = requestAnimationFrame(tick); };
      tick();
      const stop = () => { cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); void ctx.close(); setLevel(0); stopRef.current = null; };
      stopRef.current = stop;
      const name = stream.getAudioTracks()[0]?.label || 'the microphone';
      setTimeout(() => {
        if (stopRef.current !== stop) return;
        stop();
        setState(peak > 0.02 ? { kind: 'ok', text: `Working: ${name} heard you.` } : { kind: 'ok', text: `${name} opened but heard nothing. Speak while checking, or pick another microphone.` });
      }, 4000);
    } catch (e) { setState({ kind: 'error', text: micErrorMessage(e) }); }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Select aria-label="Microphone" value={sel} onChange={(e) => { setSel(e.target.value); setPreferredMic(e.target.value); setState({ kind: 'idle' }); }}>
          <option value="">System Default</option>
          {mics.filter((m) => m.id && m.id !== 'default' && m.id !== 'communications').map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          {sel && !mics.some((m) => m.id === sel) && <option value={sel}>Microphone not connected</option>}
        </Select>
        <IconBtn label="Look for microphones again" onClick={refresh}><RefreshCw className="w-3.5 h-3.5" /></IconBtn>
      </div>
      <div className="flex items-center gap-2">
        <Btn size="sm" icon={<Mic className="w-3 h-3" />} loading={state.kind === 'checking'} onClick={() => void check()}>Check Microphone</Btn>
        {state.kind === 'checking' && <span className="flex-1 h-1.5 rounded-full bg-[var(--hover)] overflow-hidden" aria-hidden="true"><span className="block h-full bg-[var(--color-accent-fill)] transition-[width]" style={{ width: `${level * 100}%` }} /></span>}
      </div>
      {state.kind === 'checking' && <p role="status" className="text-[12px] text-[var(--color-text-muted)]">Say something…</p>}
      {state.text && <p role="status" className={state.kind === 'error' ? 'text-[12px] text-[var(--c-red)] leading-snug' : 'text-[12px] text-[var(--color-text-muted)] leading-snug'}>{state.text}</p>}
      <p className="text-[12px] text-[var(--color-text-muted)]">{count(mics.filter((m) => m.id !== 'default' && m.id !== 'communications').length, 'microphone')} found. Used for calls, recordings, dictation and spoken answers.</p>
    </div>
  );
};
