import React, { useEffect, useRef, useState } from 'react';
import { AudioLines, ChevronDown, Copy, Mic, Plus, Search, SlidersHorizontal, Square, Trash2, Volume2, Boxes } from 'lucide-react';
import { Banner, Btn, Empty, IconBtn, Select, cx } from '../common/ui';
import { InspectorPane, KV, MenuItem, Popover, Section, SidebarPane, SliderField, groupByDate } from '../common/Pane';
import { ModeButton, PickerButton, PromptShell, SendButton, TrayButton, TrayNote, VramMeter } from '../common/PromptBox';
import { BuiltinNotice } from '../common/EngineNotice';
import { AudioPlayer } from './AudioPlayer';
import { offerUndo } from '../common/Alerts';
import { useBuiltins } from '../../lib/builtins';
import { usePanels } from '../../lib/panels';
import { deleteMedia, loadMedia } from '../../lib/core';
import { kv } from '../../lib/store';
import { uid } from '../../lib/persist';
import { MicRecorder, micErrorMessage } from '../../lib/audio';
import { builtinSpeech, builtinTranscribe } from '../../voice/voice';
import { entryById } from '../../models/library';
import type { LotusSettings } from '../../types/lotus';

/*
 * The Voice page with Lotus's own voice engine (session 17; laid out like the other pages since
 * 0.8.2): left, Speak / Dictate and everything made so far; middle, the clips or transcripts with
 * the shared chat bar at the bottom; right, the voice settings (title bar shows/hides it).
 * Every clip is saved in Lotus Studio/Audio; the list is kept in `lotus.voice.builtin.v1`.
 * Cloning, stories and the voice library are Voicebox features; the inspector says so.
 */

type Mode = 'speak' | 'dictate';
interface Clip { id: string; text: string; path: string; voice: string; ts: number }
interface Transcript { id: string; text: string; model: string; ts: number }
interface Saved { clips: Clip[]; transcripts: Transcript[] }

const KEY = 'lotus.voice.builtin.v1';
const load = (): Saved => {
  try { const v = JSON.parse(kv.getItem(KEY) || '{}') as Partial<Saved>; return { clips: v.clips ?? [], transcripts: v.transcripts ?? [] }; }
  catch { return { clips: [], transcripts: [] }; }
};

/** Kokoro voice ids ("af_heart") → "Heart · US English, female". */
const speakerLabel = (n: string) => { const m = /^([ab])([fm])_(\w+)$/.exec(n); return m ? `${m[3][0].toUpperCase()}${m[3].slice(1)} · ${m[1] === 'a' ? 'US' : 'UK'} English, ${m[2] === 'f' ? 'female' : 'male'}` : n; };

/** A clip's audio, read from Lotus Studio when it is first shown. */
const ClipAudio: React.FC<{ path: string; autoPlay?: boolean }> = ({ path, autoPlay }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    let u = '';
    loadMedia(path).then((b) => { u = URL.createObjectURL(b); setUrl(u); }).catch(() => setGone(true));
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [path]);
  if (gone) return <p className="text-[12px] text-[var(--color-text-muted)]">The audio file is no longer in Lotus Studio.</p>;
  return <AudioPlayer src={url} autoPlay={autoPlay} onDownload={url ? () => { const a = document.createElement('a'); a.href = url; a.download = path.split('/').pop() || 'clip.wav'; a.click(); } : undefined} />;
};

export const BuiltinVoice: React.FC<{ settings: LotusSettings; onSettings: (p: Partial<LotusSettings>) => void; onOpenModels: () => void }> = ({ settings, onSettings, onOpenModels }) => {
  const b = useBuiltins();
  const { setRight } = usePanels();
  const voices = b.models.filter((m) => m.kind === 'voice');
  const dictation = b.models.filter((m) => m.kind === 'dictation');
  const engineOk = b.engines.some((e) => e.id === 'sherpa' && e.installed);
  const voice = voices.find((m) => m.id === settings.builtinVoice) ?? voices[0];
  const speakers = voice?.entryId ? entryById(voice.entryId)?.voice?.speakers ?? [] : [];
  const dictModel = dictation.find((d) => d.id === settings.builtinDictation) ?? dictation[0];

  const [mode, setMode] = useState<Mode>(() => (kv.getItem('lotus.voice.builtin.mode') as Mode) || 'speak');
  const [saved, setSaved] = useState<Saved>(load);
  const [q, setQ] = useState('');
  const [text, setText] = useState('');
  const [speed, setSpeed] = useState(1);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [rec, setRec] = useState<MicRecorder | null>(null);
  const [level, setLevel] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);

  const go = (m: Mode) => { setMode(m); kv.setItem('lotus.voice.builtin.mode', m); setSelected(null); };
  const save = (fn: (s: Saved) => Saved) => setSaved((s) => { const n = fn(s); kv.setItem(KEY, JSON.stringify({ clips: n.clips.slice(0, 200), transcripts: n.transcripts.slice(0, 200) })); return n; });
  const recRef = useRef<MicRecorder | null>(null);
  recRef.current = rec;
  useEffect(() => () => recRef.current?.cancel(), []);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }, [saved, mode]);
  useEffect(() => { const el = ta.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 200)}px`; } }, [text]);
  useEffect(() => {
    if (!selected) return;
    document.getElementById(`v-${selected}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [selected]);

  const speakNow = async () => {
    const t = text.trim();
    if (!t || !voice || busy) return;
    setBusy(true); setError(null);
    try {
      const m = await builtinSpeech(t, { voice: voice.id, speaker: settings.builtinSpeaker, speed });
      const clip: Clip = { id: uid('vc'), text: t, path: m.path, voice: voice.title, ts: Date.now() };
      save((s) => ({ ...s, clips: [clip, ...s.clips] }));
      setFresh(clip.id); setText('');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const toggleRecord = async () => {
    if (rec) {
      setRec(null); setTranscribing(true);
      try {
        const r = await rec.stop();
        const t = (await builtinTranscribe(r.wav, dictModel?.id)).trim();
        if (t) save((s) => ({ ...s, transcripts: [{ id: uid('vt'), text: t, model: dictModel?.title ?? 'Whisper', ts: Date.now() }, ...s.transcripts] }));
        else setError('Heard nothing. Try again a little closer to the mic.');
      } catch (e) { setError((e as Error).message); } finally { setTranscribing(false); setLevel(0); }
      return;
    }
    setError(null);
    const r = new MicRecorder((l) => setLevel(l));
    try { await r.start(); setRec(r); } catch (e) { setError(micErrorMessage(e)); }
  };

  const remove = (id: string) => {
    const clip = saved.clips.find((c) => c.id === id);
    setHidden((h) => new Set(h).add(id));
    const unhide = () => setHidden((h) => { const n = new Set(h); n.delete(id); return n; });
    offerUndo(clip ? 'Clip deleted' : 'Transcript deleted', unhide, () => {
      save((s) => ({ clips: s.clips.filter((c) => c.id !== id), transcripts: s.transcripts.filter((t) => t.id !== id) }));
      if (clip) void deleteMedia(clip.path).catch(() => undefined);
      unhide();
    });
  };

  const needle = q.trim().toLowerCase();
  const clips = saved.clips.filter((c) => !hidden.has(c.id));
  const transcripts = saved.transcripts.filter((t) => !hidden.has(t.id));
  const listed = (mode === 'speak' ? clips : transcripts).filter((x) => !needle || x.text.toLowerCase().includes(needle));
  const shown = [...(mode === 'speak' ? clips : transcripts)].sort((a, b) => a.ts - b.ts);

  const navBtn = (m: Mode, icon: React.ReactNode, label: string) => (
    <button type="button" aria-current={mode === m ? 'page' : undefined} onClick={() => go(m)}
      className={cx('w-full h-9 px-2.5 flex items-center gap-2.5 rounded-[8px] text-[13px] text-left', mode === m ? 'bg-[var(--pressed)] font-medium' : 'text-[var(--color-text-muted)] hover:bg-[var(--hover)] hover:text-[var(--color-text-main)]')}>{icon}{label}</button>
  );

  return (
    <div className="flex-1 min-h-0 flex bg-[var(--color-bg-panel)] overflow-hidden">
      <SidebarPane label="Voice">
        <div className="p-3 space-y-2">
          <Btn variant="primary" className="w-full" icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => { if (mode === 'speak') { setText(''); setSelected(null); ta.current?.focus(); } else void toggleRecord(); }}
            disabled={mode === 'dictate' && (!dictation.length || !engineOk || transcribing)}>{mode === 'speak' ? 'New Speech' : rec ? 'Stop Dictation' : 'New Dictation'}</Btn>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-muted)]" aria-hidden="true" />
            <input type="search" data-page-search aria-label="Search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)}
              className="w-full h-7 pl-8 pr-2 rounded-[6px] bg-[var(--hover)] text-[13px] placeholder:text-[var(--color-text-muted)] focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)]" />
          </div>
        </div>
        <nav className="px-2 space-y-0.5" aria-label="Voice modes">
          {navBtn('speak', <AudioLines className="w-4 h-4" />, 'Speak')}
          {navBtn('dictate', <Mic className="w-4 h-4" />, 'Dictate')}
        </nav>
        <div className="flex-1 min-h-0 overflow-y-auto px-2 py-3 mt-2 border-t border-[var(--sep)] space-y-3">
          {groupByDate(listed).map((g) => (
            <div key={g.label}>
              <h3 className="px-1.5 mb-1 text-[12px] font-semibold text-[var(--color-text-muted)]">{g.label}</h3>
              <div className="space-y-0.5">
                {g.items.map((x) => (
                  <div key={x.id} role="button" tabIndex={0} onClick={() => setSelected(x.id)} onKeyDown={(e) => { if (e.key === 'Enter') setSelected(x.id); }}
                    className={cx('group flex items-center gap-2 px-2.5 h-9 rounded-[8px] cursor-default', selected === x.id ? 'bg-[var(--pressed)] font-medium' : 'text-[var(--color-text-muted)] hover:bg-[var(--hover)] hover:text-[var(--color-text-main)]')}>
                    <span className="flex-1 min-w-0 truncate text-[13px]">{x.text}</span>
                    <span className="hidden group-hover:flex group-focus-within:flex shrink-0" onClick={(e) => e.stopPropagation()}>
                      <IconBtn label="Delete" className="!w-6 !h-6 hover:!text-[var(--c-red)]" onClick={() => remove(x.id)}><Trash2 className="w-3.5 h-3.5" /></IconBtn>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {!listed.length && <p className="px-2.5 text-[13px] text-[var(--color-text-muted)]">{needle ? `Nothing matches “${q.trim()}”.` : mode === 'speak' ? 'No clips yet.' : 'No dictations yet.'}</p>}
        </div>
      </SidebarPane>

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-[760px] mx-auto px-6 py-6 h-full">
            {(!engineOk || (mode === 'speak' ? !voices.length : !dictation.length)) && <BuiltinNotice kind="voice" purpose={mode === 'speak' ? 'to speak' : 'to dictate'} className="mb-4" />}
            {!shown.length ? (
              <Empty className="h-full" icon={mode === 'speak' ? <AudioLines /> : <Mic />}
                title={mode === 'speak' ? 'Nothing spoken yet' : 'Nothing dictated yet'}
                body={mode === 'speak' ? 'Type what Lotus should say below and press Speak. Clips are made on this computer and saved in Lotus Studio.' : 'Press Record below, talk, then press it again. Whisper turns it into text on this computer.'} />
            ) : (
              <div className="space-y-5">
                {mode === 'speak' ? (shown as Clip[]).map((c) => (
                  <div key={c.id} id={`v-${c.id}`} className={cx('rounded-[12px] p-3 -mx-3', selected === c.id && 'bg-[var(--hover)]')}>
                    <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{c.text}</p>
                    <div className="mt-2"><ClipAudio path={c.path} autoPlay={fresh === c.id} /></div>
                    <p className="mt-1 flex items-center gap-1 text-[12px] text-[var(--color-text-muted)]">
                      <span className="truncate">{c.voice} · {new Date(c.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="flex-1" />
                      <IconBtn label="Use this text again" className="!w-6 !h-6" onClick={() => setText(c.text)}><Copy className="w-3.5 h-3.5" /></IconBtn>
                      <IconBtn label="Delete clip" className="!w-6 !h-6 hover:!text-[var(--c-red)]" onClick={() => remove(c.id)}><Trash2 className="w-3.5 h-3.5" /></IconBtn>
                    </p>
                  </div>
                )) : (shown as Transcript[]).map((t) => (
                  <div key={t.id} id={`v-${t.id}`} className={cx('rounded-[12px] p-3 -mx-3', selected === t.id && 'bg-[var(--hover)]')}>
                    <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{t.text}</p>
                    <p className="mt-1 flex items-center gap-1 text-[12px] text-[var(--color-text-muted)]">
                      <span className="truncate">{t.model} · {new Date(t.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="flex-1" />
                      <IconBtn label="Copy" className="!w-6 !h-6" onClick={() => void navigator.clipboard.writeText(t.text)}><Copy className="w-3.5 h-3.5" /></IconBtn>
                      <IconBtn label="Speak this" className="!w-6 !h-6" onClick={() => { setText(t.text); go('speak'); }}><Volume2 className="w-3.5 h-3.5" /></IconBtn>
                      <IconBtn label="Delete transcript" className="!w-6 !h-6 hover:!text-[var(--c-red)]" onClick={() => remove(t.id)}><Trash2 className="w-3.5 h-3.5" /></IconBtn>
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* The shared chat bar (same shape as Chat, Work and Images). */}
        <div className="px-6 pb-4 pt-2 shrink-0">
          <div className="max-w-[760px] mx-auto">
            {error && <Banner tone="error" className="mb-2">{error}</Banner>}
            <PromptShell tray={<>
              <TrayButton onClick={() => setRight(true)} icon={<SlidersHorizontal className="w-4 h-4" />} label="Settings" title="Voice, speaker, speed and dictation model" />
              <TrayButton onClick={onOpenModels} icon={<Boxes className="w-4 h-4" />} label="Models" title="Get voices and Whisper" />
              <div className="flex-1" />
              {mode === 'speak' ? <TrayNote>{speed.toFixed(2)}× speed</TrayNote> : <TrayNote>{dictModel?.title ?? 'No dictation model'}</TrayNote>}
            </>}>
              <VramMeter />
              {mode === 'speak' ? (<>
                <textarea ref={ta} value={text} onChange={(e) => setText(e.target.value)} rows={1} aria-label="Text to speak"
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void speakNow(); } }}
                  placeholder="Type or paste what Lotus should say…"
                  className="w-full resize-none bg-transparent px-4 pt-4 pb-1 text-[14px] leading-relaxed placeholder:text-[var(--color-text-muted)] focus:outline-none" />
                <div className="flex items-center gap-1 px-2.5 pb-2.5">
                  <ModeButton on={false} onClick={() => go('dictate')} icon={<Mic className="w-4 h-4" />} label="Dictate" title="Switch to dictation" />
                  <div className="flex-1" />
                  {speakers.length > 1 && (
                    <Popover up align="right" className="w-[280px]" trigger={(o, t) => <PickerButton open={o} onClick={t} title="Speaker" text={speakerLabel(speakers.find((s) => s.id === settings.builtinSpeaker)?.name ?? speakers[0].name)} chevron={<ChevronDown className={cx('w-3.5 h-3.5 shrink-0 opacity-70', o && 'rotate-180')} />} />}>
                      {(close) => speakers.map((s) => <MenuItem key={s.id} active={s.id === settings.builtinSpeaker} onClick={() => { onSettings({ builtinSpeaker: s.id }); close(); }}>{speakerLabel(s.name)}</MenuItem>)}
                    </Popover>
                  )}
                  <Popover up align="right" className="w-[280px]" trigger={(o, t) => <PickerButton open={o} onClick={t} title="Voice" text={voice?.title ?? 'No voice'} chevron={<ChevronDown className={cx('w-3.5 h-3.5 shrink-0 opacity-70', o && 'rotate-180')} />} />}>
                    {(close) => (<>
                      {voices.map((v) => <MenuItem key={v.id} active={v.id === voice?.id} onClick={() => { onSettings({ builtinVoice: v.id, builtinSpeaker: 0 }); close(); }}><span className="truncate">{v.title}</span></MenuItem>)}
                      {!voices.length && <p className="p-2.5 text-[12px] text-[var(--color-text-muted)]">No voice downloaded yet.</p>}
                      <div className="my-1 border-t border-[var(--sep)]" />
                      <MenuItem onClick={() => { close(); onOpenModels(); }}><Boxes className="w-3.5 h-3.5" />Get more voices…</MenuItem>
                    </>)}
                  </Popover>
                  <SendButton disabled={!text.trim() || !voice || !engineOk || busy} onClick={() => void speakNow()} label={busy ? 'Speaking…' : 'Speak'} tip="Speak (Enter)" icon={<Volume2 className="w-4 h-4" />} />
                </div>
              </>) : (
                <div className="flex items-center gap-2 px-2.5 pt-3 pb-2.5">
                  <ModeButton on={false} onClick={() => go('speak')} icon={<AudioLines className="w-4 h-4" />} label="Speak" title="Switch to speaking" />
                  <div className="flex-1 flex items-center justify-center gap-3 min-w-0">
                    {rec ? <span className="h-1.5 w-full max-w-[260px] rounded-full bg-[var(--hover)] overflow-hidden" aria-hidden="true"><span className="block h-full bg-[var(--color-accent-fill)] transition-[width]" style={{ width: `${Math.min(100, level * 300)}%` }} /></span>
                      : <span className="text-[13px] text-[var(--color-text-muted)] truncate">{transcribing ? 'Transcribing…' : 'Press the mic and start talking'}</span>}
                  </div>
                  {dictation.length > 1 && (
                    <Popover up align="right" className="w-[260px]" trigger={(o, t) => <PickerButton open={o} onClick={t} title="Dictation model" text={dictModel?.title ?? 'Whisper'} chevron={<ChevronDown className={cx('w-3.5 h-3.5 shrink-0 opacity-70', o && 'rotate-180')} />} />}>
                      {(close) => dictation.map((d) => <MenuItem key={d.id} active={d.id === dictModel?.id} onClick={() => { onSettings({ builtinDictation: d.id }); close(); }}>{d.title}</MenuItem>)}
                    </Popover>
                  )}
                  {rec ? <SendButton stop onClick={() => void toggleRecord()} label="Stop and transcribe" tip="Stop and transcribe" />
                    : <SendButton disabled={!dictation.length || !engineOk || transcribing} onClick={() => void toggleRecord()} label="Record" tip="Record" icon={<Mic className="w-4 h-4" />} />}
                </div>
              )}
            </PromptShell>
          </div>
        </div>
      </div>

      <InspectorPane label="Voice settings">
        <div className="h-11 shrink-0 flex items-center px-4 border-b border-[var(--sep)] text-[13px] font-semibold">Settings</div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <Section title="Voice">
            <Select aria-label="Voice" value={voice?.id ?? ''} disabled={!voices.length} onChange={(e) => onSettings({ builtinVoice: e.target.value, builtinSpeaker: 0 })}>
              {!voices.length && <option value="">No voice downloaded</option>}
              {voices.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
            </Select>
            {speakers.length > 1 && (
              <div className="mt-2">
                <Select aria-label="Speaker" value={settings.builtinSpeaker} onChange={(e) => onSettings({ builtinSpeaker: Number(e.target.value) })}>
                  {speakers.map((s) => <option key={s.id} value={s.id}>{speakerLabel(s.name)}</option>)}
                </Select>
              </div>
            )}
            <div className="mt-3"><SliderField label="Speed" value={speed} min={0.6} max={1.6} step={0.05} onChange={setSpeed} format={(v) => `${v.toFixed(2)}×`} /></div>
          </Section>
          <Section title="Dictation">
            {dictation.length ? (
              <Select aria-label="Dictation model" value={dictModel?.id ?? ''} onChange={(e) => onSettings({ builtinDictation: e.target.value })}>
                {dictation.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
              </Select>
            ) : <p className="text-[12px] text-[var(--color-text-muted)]">Get Whisper in <button type="button" className="underline" onClick={onOpenModels}>Models</button> to dictate.</p>}
          </Section>
          <Section title="Engine">
            <KV k="Engine" v={engineOk ? 'Lotus (sherpa-onnx)' : 'Not installed'} />
            <KV k="Saved in" v="Lotus Studio/Audio" />
            <KV k="Clips" v={clips.length} />
            <p className="mt-2 text-[12px] text-[var(--color-text-muted)] leading-snug">Voice cloning, stories and the voice library use Voicebox. Switch Voice to Voicebox in Settings → Engines to use them.</p>
          </Section>
        </div>
      </InspectorPane>
    </div>
  );
};
