import React, { useEffect, useRef, useState } from 'react';
import { Copy, Mic, Square, Volume2 } from 'lucide-react';
import { Banner, Btn, TextArea, cx } from '../common/ui';
import { SliderField } from '../common/Pane';
import { BuiltinNotice } from '../common/EngineNotice';
import { useBuiltins } from '../../lib/builtins';
import { loadMedia } from '../../lib/core';
import { MicRecorder, micErrorMessage } from '../../lib/audio';
import { builtinSpeech, builtinTranscribe } from '../../voice/voice';
import { entryById } from '../../models/library';
import type { LotusSettings } from '../../types/lotus';

/*
 * The Voice page with Lotus's own voice engine (session 17): speak text with a downloaded Kokoro or
 * Piper voice, and dictate with Whisper. Every clip is saved in Lotus Studio/Audio. Cloning, stories
 * and the voice library are Voicebox features; the page says so instead of showing them greyed out.
 */

interface Clip { id: string; text: string; url: string; path: string; voice: string }

/** Kokoro voice ids ("af_heart") → "Heart · US English, female". */
const speakerLabel = (n: string) => { const m = /^([ab])([fm])_(\w+)$/.exec(n); return m ? `${m[3][0].toUpperCase()}${m[3].slice(1)} · ${m[1] === 'a' ? 'US' : 'UK'} English, ${m[2] === 'f' ? 'female' : 'male'}` : n; };

const field = 'h-8 px-2 rounded-[6px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)] text-[13px] text-[var(--color-text-main)]';

export const BuiltinVoice: React.FC<{ settings: LotusSettings; onSettings: (p: Partial<LotusSettings>) => void; onOpenModels: () => void }> = ({ settings, onSettings, onOpenModels }) => {
  const b = useBuiltins();
  const voices = b.models.filter((m) => m.kind === 'voice');
  const dictation = b.models.filter((m) => m.kind === 'dictation');
  const engineOk = b.engines.some((e) => e.id === 'sherpa' && e.installed);
  const voice = voices.find((m) => m.id === settings.builtinVoice) ?? voices[0];
  const speakers = voice?.entryId ? entryById(voice.entryId)?.voice?.speakers ?? [] : [];
  const [text, setText] = useState('');
  const [speed, setSpeed] = useState(1);
  const [busy, setBusy] = useState(false);
  const [clips, setClips] = useState<Clip[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rec, setRec] = useState<MicRecorder | null>(null);
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState('');
  const [transcribing, setTranscribing] = useState(false);
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const speakNow = async () => {
    if (!text.trim() || !voice) return;
    setBusy(true); setError(null);
    try {
      const m = await builtinSpeech(text.trim(), { voice: voice.id, speaker: settings.builtinSpeaker, speed });
      const url = URL.createObjectURL(await loadMedia(m.path));
      urls.current.push(url);
      setClips((c) => [{ id: m.path, text: text.trim(), url, path: m.path, voice: voice.title }, ...c].slice(0, 20));
      void new Audio(url).play().catch(() => undefined);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const toggleRecord = async () => {
    if (rec) {
      setRec(null); setTranscribing(true);
      try { const r = await rec.stop(); setHeard(await builtinTranscribe(r.wav, settings.builtinDictation || undefined)); }
      catch (e) { setError((e as Error).message); } finally { setTranscribing(false); setLevel(0); }
      return;
    }
    setError(null);
    const r = new MicRecorder((l) => setLevel(l));
    try { await r.start(); setRec(r); } catch (e) { setError(micErrorMessage(e)); }
  };

  return (
    <div className="max-w-[720px] mx-auto px-6 py-8 space-y-8">
      {(!engineOk || !voices.length) && <BuiltinNotice kind="voice" purpose="to speak and dictate" />}
      {error && <Banner tone="error">{error}</Banner>}

      <section aria-labelledby="speak-h" className="space-y-3">
        <h2 id="speak-h" className="text-[18px] font-semibold">Speak</h2>
        <TextArea value={text} onChange={(e) => setText(e.target.value)} rows={5} aria-label="Text to speak" placeholder="Type or paste what Lotus should say…" />
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[12px] text-[var(--color-text-muted)] flex flex-col gap-1">Voice
            <select aria-label="Voice" className={cx(field, 'min-w-[220px]')} value={voice?.id ?? ''} disabled={!voices.length} onChange={(e) => onSettings({ builtinVoice: e.target.value, builtinSpeaker: 0 })}>
              {!voices.length && <option value="">No voice downloaded</option>}
              {voices.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
            </select>
          </label>
          {speakers.length > 1 && (
            <label className="text-[12px] text-[var(--color-text-muted)] flex flex-col gap-1">Speaker
              <select aria-label="Speaker" className={field} value={settings.builtinSpeaker} onChange={(e) => onSettings({ builtinSpeaker: Number(e.target.value) })}>
                {speakers.map((s) => <option key={s.id} value={s.id}>{speakerLabel(s.name)}</option>)}
              </select>
            </label>
          )}
          <div className="w-[180px]"><SliderField label="Speed" value={speed} min={0.6} max={1.6} step={0.05} onChange={setSpeed} format={(v) => `${v.toFixed(2)}×`} /></div>
          <div className="flex-1" />
          <Btn variant="primary" loading={busy} disabled={!text.trim() || !voice || !engineOk} icon={<Volume2 className="w-3.5 h-3.5" />} onClick={() => void speakNow()}>Speak</Btn>
        </div>
        {clips.length > 0 && (
          <ul className="space-y-2" aria-label="Spoken clips">
            {clips.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-2 border-b border-[var(--sep)] last:border-b-0">
                <audio controls src={c.url} className="h-8 w-[260px] shrink-0" aria-label={`Clip: ${c.text.slice(0, 40)}`} />
                <div className="min-w-0"><p className="text-[13px] truncate">{c.text}</p><p className="text-[12px] text-[var(--color-text-muted)] truncate">{c.voice} · Lotus Studio/{c.path}</p></div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="dictate-h" className="space-y-3">
        <h2 id="dictate-h" className="text-[18px] font-semibold">Dictate</h2>
        <div className="flex items-center gap-3">
          <Btn variant={rec ? 'danger' : 'secondary'} loading={transcribing} disabled={!dictation.length || !engineOk} icon={rec ? <Square className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />} onClick={() => void toggleRecord()}>
            {rec ? 'Stop and Transcribe' : transcribing ? 'Transcribing…' : 'Start Recording'}
          </Btn>
          {rec && <span className="h-1.5 w-40 rounded-full bg-[var(--hover)] overflow-hidden" aria-hidden="true"><span className="block h-full bg-[var(--color-accent-fill)] transition-[width]" style={{ width: `${Math.min(100, level * 300)}%` }} /></span>}
          {dictation.length > 1 && (
            <select aria-label="Dictation model" className={field} value={settings.builtinDictation || dictation[0].id} onChange={(e) => onSettings({ builtinDictation: e.target.value })}>
              {dictation.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
          )}
          {!dictation.length && <span className="text-[12px] text-[var(--color-text-muted)]">Get Whisper in <button type="button" className="underline" onClick={onOpenModels}>Models</button> to dictate.</span>}
        </div>
        {heard && (
          <div className="flex items-start gap-2">
            <p className="flex-1 text-[14px] leading-relaxed whitespace-pre-wrap">{heard}</p>
            <Btn size="sm" variant="ghost" icon={<Copy className="w-3 h-3" />} onClick={() => void navigator.clipboard.writeText(heard)}>Copy</Btn>
            <Btn size="sm" variant="ghost" onClick={() => setText(heard)}>Speak This</Btn>
          </div>
        )}
      </section>

      <p className="text-[12px] text-[var(--color-text-muted)]">Voice cloning, stories and the voice library use Voicebox. Switch Voice to Voicebox in Settings → Engines to use them.</p>
    </div>
  );
};
