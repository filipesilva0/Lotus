import React, { useEffect, useRef, useState } from 'react';
import { Mic, Square, Copy, Check, Trash2, Sparkles, MessageSquare, Volume2 } from 'lucide-react';
import { voicebox, Capture, STT_LANGUAGES, LANGUAGES, fmtDuration } from '../../services/voicebox';
import { MicRecorder, micErrorMessage } from '../../lib/audio';
import { emitEvent } from '../../lib/bus';
import { Btn, Card, Select, Label, Banner, Empty, Spinner, IconBtn, useFlash, cx } from '../common/ui';

export const DictateTab: React.FC<{ onSpeak: (text: string) => void; onOpenModels: () => void }> = ({ onSpeak, onOpenModels }) => {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [level, setLevel] = useState(0);
  const [secs, setSecs] = useState(0);
  const [language, setLanguage] = useState(() => localStorage.getItem('tomo.dictate.lang') || '');
  const [items, setItems] = useState<Capture[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const rec = useRef<MicRecorder | null>(null);

  const load = () => voicebox.listCaptures(30).then((r) => setItems(r.items)).catch((e) => setErr(e.message));
  useEffect(() => { void load(); return () => rec.current?.cancel(); }, []);

  const start = async () => {
    setErr(null);
    try {
      rec.current = new MicRecorder((l, t) => { setLevel(l); setSecs(t); });
      await rec.current.start();
      setRecording(true);
    } catch (e) { setErr(micErrorMessage(e)); }
  };
  const stop = async () => {
    setRecording(false); setLevel(0); setBusy(true);
    try {
      const r = await rec.current!.stop();
      const cap = await voicebox.createCapture(r.wav, { language: language || undefined, source: 'tomo' });
      setItems((c) => [cap, ...c]);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const modelHint = err && /model|download/i.test(err);
  const langs = LANGUAGES.filter((l) => STT_LANGUAGES.includes(l.code));

  return (
    <div className="p-5 grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5">
      <Card className="p-5 self-start space-y-5">
        <div className="flex flex-col items-center gap-3 py-2">
          <button onClick={recording ? stop : start} disabled={busy} aria-label={recording ? 'Stop dictation' : 'Start dictation'}
            className={cx('relative w-20 h-20 rounded-full flex items-center justify-center text-white transition-all disabled:opacity-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-[var(--color-accent-vibrant)]/30',
              recording ? 'bg-rose-500' : 'bg-[var(--color-accent-vibrant)] hover:bg-[var(--color-accent-hover)]')}>
            {recording && <span className="absolute inset-0 rounded-full bg-rose-500/30" style={{ transform: `scale(${1 + level * 0.6})`, transition: 'transform 80ms' }} aria-hidden />}
            <span className="relative">{busy ? <Spinner className="w-7 h-7" /> : recording ? <Square className="w-6 h-6" fill="currentColor" /> : <Mic className="w-7 h-7" />}</span>
          </button>
          <p className="text-xs text-[#6B7280] dark:text-slate-400 tabular-nums h-4">
            {recording ? `Listening… ${fmtDuration(secs)}` : busy ? 'Transcribing on your device…' : 'Tap to dictate'}
          </p>
        </div>
        <div>
          <Label>Spoken language</Label>
          <Select value={language} onChange={(e) => { setLanguage(e.target.value); localStorage.setItem('tomo.dictate.lang', e.target.value); }}>
            <option value="">Detect automatically</option>
            {langs.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </Select>
        </div>
        <p className="text-[11px] text-[#9CA3AF] leading-relaxed">Audio is transcribed by Whisper running on this PC. Nothing leaves your machine.</p>
      </Card>

      <div className="space-y-3 min-w-0">
        {err && <Banner tone="error" action={modelHint ? <Btn size="sm" variant="secondary" onClick={onOpenModels}>Open models</Btn> : undefined}>{err}</Banner>}
        {items.length === 0 ? (
          <Empty icon={<Mic className="w-5 h-5" />} title="No dictations yet" body="Your transcripts will appear here, ready to copy, speak back, or send to chat." />
        ) : items.map((c) => <CaptureCard key={c.id} c={c} onSpeak={onSpeak}
          onChange={(n) => setItems((cur) => cur.map((x) => (x.id === n.id ? n : x)))}
          onDelete={async () => { await voicebox.deleteCapture(c.id).catch(() => undefined); setItems((cur) => cur.filter((x) => x.id !== c.id)); }} />)}
      </div>
    </div>
  );
};

const CaptureCard: React.FC<{ c: Capture; onChange: (c: Capture) => void; onDelete: () => void; onSpeak: (t: string) => void }> = ({ c, onChange, onDelete, onSpeak }) => {
  const [copied, flash] = useFlash();
  const [refining, setRefining] = useState(false);
  const text = c.transcript_refined || c.transcript_raw;
  return (
    <Card className="p-4">
      <p className="text-sm leading-relaxed text-[#111827] dark:text-slate-100 whitespace-pre-wrap">{text || <span className="text-[#9CA3AF]">No speech detected.</span>}</p>
      <div className="flex items-center gap-1 mt-3">
        <span className="text-[11px] text-[#9CA3AF] flex-1 tabular-nums">
          {new Date(c.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · {fmtDuration((c.duration_ms ?? 0) / 1000)}{c.transcript_refined && ' · cleaned up'}
        </span>
        {!c.transcript_refined && c.transcript_raw && (
          <Btn size="sm" variant="ghost" loading={refining} icon={<Sparkles className="w-3 h-3" />}
            onClick={async () => { setRefining(true); try { onChange(await voicebox.refineCapture(c.id)); } finally { setRefining(false); } }}>Clean up</Btn>
        )}
        <IconBtn label={copied ? 'Copied' : 'Copy'} onClick={() => { void navigator.clipboard.writeText(text); flash(); }}>{copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}</IconBtn>
        <IconBtn label="Speak this" onClick={() => onSpeak(text)}><Volume2 className="w-3.5 h-3.5" /></IconBtn>
        <IconBtn label="Send to chat" onClick={() => void emitEvent('chat:prefill', text)}><MessageSquare className="w-3.5 h-3.5" /></IconBtn>
        <IconBtn label="Delete" onClick={onDelete}><Trash2 className="w-3.5 h-3.5" /></IconBtn>
      </div>
    </Card>
  );
};
