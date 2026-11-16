import React, { useEffect, useRef, useState } from 'react';
import { AudioLines, BookOpen, Phone, Boxes, Copy, FileAudio, FileText, Film, Mic, Mic2, Plus, Search, SlidersHorizontal, Star, Trash2, Upload, Volume2, ListPlus, ChevronDown } from 'lucide-react';
import { Banner, Btn, Empty, IconBtn, Select, cx } from '../common/ui';
import { InspectorPane, KV, MenuItem, Popover, Section, SidebarPane, SliderField, groupByDate } from '../common/Pane';
import { PickerButton, PromptShell, SendButton, TrayButton, TrayNote, VramMeter } from '../common/PromptBox';
import { BuiltinNotice } from '../common/EngineNotice';
import { offerUndo } from '../common/Alerts';
import { ClipAudio, EffectsButton, EffectsPanel, VoicePicker } from './studio/parts';
import { VoicesView } from './studio/VoicesView';
import { StoriesView, newStory } from './studio/StoriesView';
import { SttEmpty, SttProgress, TranscriptCard } from './studio/SttView';
import { CallView, PastCall } from './studio/CallView';
import { saveCalls, startCall, useCall, useSavedCalls } from '../../voice/call';
import { transcribeLong, useSttJob } from '../../voice/stt';
import { sortFiles, useFileIntake } from '../../lib/fileDrop';
import { usePanels } from '../../lib/panels';
import { deleteMedia } from '../../lib/core';
import { kv } from '../../lib/store';
import { uid } from '../../lib/persist';
import { MicRecorder, micErrorMessage } from '../../lib/audio';
import { Effects, clock, effectsNeutral, withEffects } from '../../voice/studio';
import { speakWith, useStudio, Clip } from '../../voice/useStudio';
import type { LotusSettings } from '../../types/lotus';

/*
 * The Voice page with Lotus's own voice engine (0.8.2): everything Voicebox did, without it.
 *   Call     a voice call with the chat model that remembers across calls and chats (0.9.6)
 *   Speak    type, pick a voice (yours or built-in), optional effects, press Speak; long texts work
 *   Voices   make a voice from a few seconds of speech (cloning) or tune a built-in one
 *   Stories  a script with several speakers on four tracks, played together and exported as one file
 *   Speech to Text  long recordings (any length, audio or video) → transcript → Open in Chat (summary…)
 * Same three panes and chat bar as the other pages. Data: voice/useStudio.ts; audio in Lotus Studio/Audio.
 */

type Mode = 'call' | 'speak' | 'voices' | 'stories' | 'dictate';
const LANGS = ['Auto', 'English', 'Portuguese', 'Spanish', 'French', 'German', 'Italian', 'Dutch', 'Japanese', 'Chinese', 'Korean', 'Russian'];
const STARTERS = ['Good morning! Here is your plan for today.', 'Once upon a time, in a quiet village by the sea, there lived a curious little fox.', 'Welcome to our podcast. Today we talk about local AI.'];

export const BuiltinVoice: React.FC<{ settings: LotusSettings; onSettings: (p: Partial<LotusSettings>) => void; onOpenModels: () => void; onOpenInChat?: (a: { name: string; text: string; prompt: string }) => void }> = ({ settings, onSettings, onOpenModels, onOpenInChat }) => {
  const studio = useStudio();
  const b = studio.builtins;
  const { setRight } = usePanels();
  const dictation = b.models.filter((m) => m.kind === 'dictation');
  const engineOk = b.engines.some((e) => e.id === 'sherpa' && e.installed);
  const dictModel = dictation.find((d) => d.id === settings.builtinDictation) ?? dictation[0];
  const voice = studio.voice;
  const voiceModel = studio.models.find((m) => m.id === voice?.model);

  const [mode, setMode] = useState<Mode>(() => (kv.getItem('lotus.voice.builtin.mode') as Mode) || 'call');
  const [q, setQ] = useState('');
  const [text, setText] = useState('');
  const [speed, setSpeed] = useState(1);
  const [fx, setFx] = useState<Effects>(() => { try { return withEffects(JSON.parse(kv.getItem('lotus.voice.fx.v1') || '{}')); } catch { return withEffects(); } });
  const [busy, setBusy] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [voiceSel, setVoiceSel] = useState<string | null>(null);
  const [storySel, setStorySel] = useState<string | null>(() => studio.stories[0]?.id ?? null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [rec, setRec] = useState<MicRecorder | null>(null);
  const [level, setLevel] = useState(0);
  const job = useSttJob();
  const call = useCall();
  const calls = useSavedCalls();
  const [callSel, setCallSel] = useState<string | null>(null);
  const [callMemory, setCallMemoryDefault] = useState(() => kv.getItem('lotus.voice.callMemory') !== '0');
  const pastCall = !call.call && callSel ? calls.find((c) => c.id === callSel) ?? null : null;
  const transcribing = job?.state === 'reading' || job?.state === 'working';
  const scroller = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const textFile = useRef<HTMLInputElement>(null);
  const audioFile = useRef<HTMLInputElement>(null);
  const recRef = useRef<MicRecorder | null>(null);
  recRef.current = rec;
  useEffect(() => () => recRef.current?.cancel(), []);

  const go = (m: Mode) => { setMode(m); kv.setItem('lotus.voice.builtin.mode', m); setSelected(null); setError(null); };
  const setEffects = (f: Effects) => { setFx(f); kv.setItem('lotus.voice.fx.v1', JSON.stringify(f)); };
  const { clips: allClips, transcripts: allTranscripts } = studio.history;
  useEffect(() => { if (mode === 'speak') scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }, [allClips.length, allTranscripts.length, mode]);
  useEffect(() => { const el = ta.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 200)}px`; } }, [text]);
  useEffect(() => { if (selected) document.getElementById(`v-${selected}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [selected]);

  const speakNow = async () => {
    const t = text.trim();
    if (!t || !voice || busy) return;
    setBusy('Speaking…'); setError(null);
    try {
      const r = await speakWith(voice, t, { speed: voiceModel?.clones ? undefined : speed, effects: fx });
      const clip: Clip = { id: uid('vc'), text: t, path: r.path, voice: voice.name, voiceId: voice.id, seconds: r.seconds, ts: Date.now() };
      studio.saveHistory((h) => ({ ...h, clips: [clip, ...h.clips] }));
      setFresh(clip.id); setText('');
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  const startJob = (blob: Blob, name: string) => {
    setError(null);
    if (!dictModel || !engineOk) { setError('Speech to text needs Lotus’s voice engine and a Whisper model. Get them in Models.'); return; }
    transcribeLong(blob, { name, model: dictModel.id, modelTitle: dictModel.title, language: settings.whisperLanguage && settings.whisperLanguage !== 'Auto' ? settings.whisperLanguage : undefined });
  };
  const toggleRecord = async () => {
    if (rec) {
      setRec(null); setLevel(0);
      try { const r = await rec.stop(); startJob(r.wav, `Recording ${new Date().toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`); }
      catch (e) { setError((e as Error).message); }
      return;
    }
    setError(null);
    const r = new MicRecorder((l) => setLevel(l));
    try { await r.start(); setRec(r); } catch (e) { setError(micErrorMessage(e)); }
  };
  const transcribeFile = (f?: File) => { if (f) startJob(f, f.name); };
  /**
   * Files dropped or pasted on the Speak or Speech to Text page: recordings and videos are written
   * down one after another; text files are put in the Speak box (0.9.5).
   */
  const takeFiles = async (files: File[]) => {
    const { media, other } = sortFiles(files);
    const texts = other.filter((f) => f.type.startsWith('text/') || /\.(txt|md|markdown|srt|vtt)$/i.test(f.name));
    const skipped = files.length - media.length - texts.length;
    if (media.length) { if (mode !== 'dictate') go('dictate'); media.forEach((f) => startJob(f, f.name)); }
    else if (texts.length) {
      const body = (await Promise.all(texts.map((f) => f.text()))).map((t) => t.trim()).filter(Boolean).join('\n\n');
      if (mode !== 'speak') go('speak');
      setText((t) => (t.trim() ? `${t.trim()}\n\n${body}` : body));
    }
    if (skipped) setError(`${skipped} file${skipped > 1 ? 's' : ''} skipped: Voice takes recordings, videos and text files.`);
  };
  const drag = useFileIntake((f) => void takeFiles(f), { enabled: mode === 'speak' || mode === 'dictate' });

  const remove = (id: string) => {
    const clip = allClips.find((c) => c.id === id);
    setHidden((h) => new Set(h).add(id));
    const unhide = () => setHidden((h) => { const n = new Set(h); n.delete(id); return n; });
    offerUndo(clip ? 'Clip deleted' : 'Transcript deleted', unhide, () => {
      studio.saveHistory((s) => ({ clips: s.clips.filter((c) => c.id !== id), transcripts: s.transcripts.filter((t) => t.id !== id) }));
      if (clip) void deleteMedia(clip.path).catch(() => undefined);
      unhide();
    });
  };
  const toStory = (clip: Clip, storyId: string) => {
    const item = { id: uid('line'), voice: clip.voiceId ?? voice?.id ?? '', text: clip.text, track: 0, start: null, gain: 1 };
    if (storyId === 'new') { const s = { ...newStory(), name: clip.text.slice(0, 30), items: [item] }; studio.saveStories((l) => [s, ...l]); go('stories'); setStorySel(s.id); return; }
    studio.saveStories((l) => l.map((s) => (s.id === storyId ? { ...s, items: [...s.items, item], updated: Date.now() } : s)));
    go('stories'); setStorySel(storyId);
  };

  const needle = q.trim().toLowerCase();
  const clips = allClips.filter((c) => !hidden.has(c.id));
  const transcripts = allTranscripts.filter((t) => !hidden.has(t.id));
  const lastClip = clips[0]?.path ?? null;

  const navBtn = (m: Mode, icon: React.ReactNode, label: string, extra?: React.ReactNode) => (
    <button key={m} type="button" aria-current={mode === m ? 'page' : undefined} onClick={() => go(m)}
      className={cx('w-full h-9 px-2.5 flex items-center gap-2.5 rounded-[8px] text-[13px] text-left', mode === m ? 'bg-[var(--pressed)] font-medium' : 'text-[var(--color-text-muted)] hover:bg-[var(--hover)] hover:text-[var(--color-text-main)]')}>{icon}{label}{extra}</button>
  );
  const row = (id: string, title: string, on: boolean, onClick: () => void, sub?: string, del?: () => void) => (
    <div key={id} role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}
      className={cx('group flex items-center gap-2 px-2.5 rounded-[8px] cursor-default', sub ? 'py-1.5' : 'h-9', on ? 'bg-[var(--pressed)] font-medium' : 'text-[var(--color-text-muted)] hover:bg-[var(--hover)] hover:text-[var(--color-text-main)]')}>
      <span className="flex-1 min-w-0"><span className="block truncate text-[13px]">{title}</span>{sub && <span className="block truncate text-[12px] font-normal text-[var(--color-text-muted)]">{sub}</span>}</span>
      {del && <span className="hidden group-hover:flex group-focus-within:flex shrink-0" onClick={(e) => e.stopPropagation()}><IconBtn label="Delete" className="!w-6 !h-6 hover:!text-[var(--c-red)]" onClick={del}><Trash2 className="w-3.5 h-3.5" /></IconBtn></span>}
    </div>
  );
  const head = (t: string) => <h3 className="px-1.5 mb-1 text-[12px] font-semibold text-[var(--color-text-muted)]">{t}</h3>;
  const dated = <T extends { id: string; ts: number; text: string; fav?: boolean }>(list: T[], sub: (x: T) => string | undefined, del: (x: T) => void) => {
    const shown = list.filter((x) => !needle || x.text.toLowerCase().includes(needle));
    const favs = shown.filter((x) => x.fav);
    return (<>
      {favs.length > 0 && <div>{head('Favourites')}<div className="space-y-0.5">{favs.map((x) => row(`f-${x.id}`, x.text, selected === x.id, () => setSelected(x.id), sub(x), () => del(x)))}</div></div>}
      {groupByDate(shown).map((g) => <div key={g.label}>{head(g.label)}<div className="space-y-0.5">{g.items.map((x) => row(x.id, x.text, selected === x.id, () => setSelected(x.id), sub(x), () => del(x)))}</div></div>)}
      {!shown.length && <p className="px-2.5 text-[13px] text-[var(--color-text-muted)]">{needle ? `Nothing matches “${q.trim()}”.` : 'Nothing here yet.'}</p>}
    </>);
  };

  const newLabel = { call: 'New Call', speak: 'New Speech', voices: 'New Voice', stories: 'New Story', dictate: 'New Transcript' }[mode];
  const onNew = () => {
    if (mode === 'call') { setCallSel(null); }
    else if (mode === 'speak') { setText(''); setSelected(null); ta.current?.focus(); }
    else if (mode === 'voices') setVoiceSel(null);
    else if (mode === 'stories') { const s = newStory(); studio.saveStories((l) => [s, ...l]); setStorySel(s.id); }
    else audioFile.current?.click();
  };
  const notice = mode !== 'call' && (!engineOk || (mode === 'dictate' ? !dictation.length : !studio.models.length));
  const removeCall = (id: string) => {
    const keep = calls.find((c) => c.id === id);
    if (!keep) return;
    saveCalls((l) => l.filter((c) => c.id !== id));
    if (callSel === id) setCallSel(null);
    offerUndo('Call deleted', () => saveCalls((l) => [keep, ...l].sort((a, b) => b.started - a.started)), () => undefined);
  };

  return (
    <div className="flex-1 min-h-0 flex bg-[var(--color-bg-panel)] overflow-hidden">
      <SidebarPane label="Voice">
        <div className="p-3 space-y-2">
          <Btn variant="primary" className="w-full" icon={<Plus className="w-3.5 h-3.5" />} onClick={onNew} disabled={(mode === 'dictate' && (!dictation.length || !engineOk || transcribing || !!rec)) || (mode === 'call' && !!call.call)}>{newLabel}</Btn>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-muted)]" aria-hidden="true" />
            <input type="search" data-page-search aria-label="Search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)}
              className="w-full h-7 pl-8 pr-2 rounded-[6px] bg-[var(--hover)] text-[13px] placeholder:text-[var(--color-text-muted)] focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)]" />
          </div>
        </div>
        <nav className="px-2 space-y-0.5" aria-label="Voice modes">
          {navBtn('call', <Phone className="w-4 h-4" />, 'Call', call.call ? <span className="ml-auto w-2 h-2 rounded-full bg-[var(--c-green)]" aria-label="On a call" /> : null)}
          {navBtn('speak', <AudioLines className="w-4 h-4" />, 'Speak')}
          {navBtn('voices', <Mic2 className="w-4 h-4" />, 'Voices')}
          {navBtn('stories', <Film className="w-4 h-4" />, 'Stories')}
          {navBtn('dictate', <FileAudio className="w-4 h-4" />, 'Speech to Text')}
        </nav>
        <div className="flex-1 min-h-0 overflow-y-auto px-2 py-3 mt-2 border-t border-[var(--sep)] space-y-3">
          {mode === 'call' && (() => {
            const shown = calls.filter((c) => !needle || c.title.toLowerCase().includes(needle) || c.turns.some((t) => t.text.toLowerCase().includes(needle)));
            return (<>
              {groupByDate(shown.map((c) => ({ ...c, ts: c.started }))).map((g) => <div key={g.label}>{head(g.label)}<div className="space-y-0.5">{g.items.map((c) => row(c.id, c.title, callSel === c.id && !call.call, () => setCallSel(c.id), `${new Date(c.started).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${c.turns.filter((t) => t.role === 'user').length} things said`, () => removeCall(c.id)))}</div></div>)}
              {!shown.length && <p className="px-2.5 text-[13px] text-[var(--color-text-muted)]">{needle ? `Nothing matches “${q.trim()}”.` : 'No calls yet.'}</p>}
            </>);
          })()}
          {mode === 'speak' && dated(clips, (c) => c.voice, (c) => remove(c.id))}
          {mode === 'dictate' && dated(transcripts.map((t) => ({ ...t, text: t.source ?? t.text })), (t) => [t.seconds ? clock(t.seconds) : '', t.source ? (allTranscripts.find((x) => x.id === t.id)?.text ?? '').slice(0, 60) : ''].filter(Boolean).join(' · '), (t) => remove(t.id))}
          {mode === 'voices' && (<>
            <div>{head('Your Voices')}<div className="space-y-0.5">
              {studio.options.filter((o) => o.mine && (!needle || o.name.toLowerCase().includes(needle))).map((o) => row(o.id, o.name, voiceSel === o.id, () => setVoiceSel(o.id), o.ready ? (studio.voice?.id === o.id ? 'In use' : o.detail) : o.why))}
              {!studio.mine.length && <p className="px-2.5 text-[13px] text-[var(--color-text-muted)]">None yet. Make one from a recording.</p>}
            </div></div>
            <div>{head('Built-in Voices')}<div className="space-y-0.5">
              {studio.options.filter((o) => !o.mine && (!needle || o.name.toLowerCase().includes(needle))).map((o) => row(o.id, o.name, voiceSel === o.id, () => setVoiceSel(o.id), studio.voice?.id === o.id ? 'In use' : o.detail))}
              {!studio.options.some((o) => !o.mine) && <p className="px-2.5 text-[13px] text-[var(--color-text-muted)]">None downloaded.</p>}
            </div></div>
          </>)}
          {mode === 'stories' && (<div className="space-y-0.5">
            {studio.stories.filter((s) => !needle || s.name.toLowerCase().includes(needle)).map((s) => row(s.id, s.name, storySel === s.id, () => setStorySel(s.id), `${s.items.length} lines`, () => {
              const keep = s;
              studio.saveStories((l) => l.filter((x) => x.id !== s.id));
              if (storySel === s.id) setStorySel(null);
              offerUndo('Story deleted', () => studio.saveStories((l) => [keep, ...l]), () => keep.items.forEach((it) => { if (it.clip) void deleteMedia(it.clip).catch(() => undefined); }));
            }))}
            {!studio.stories.length && <p className="px-2.5 text-[13px] text-[var(--color-text-muted)]">No stories yet.</p>}
          </div>)}
        </div>
      </SidebarPane>

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {mode === 'call' && (pastCall
          ? <div className="flex-1 min-h-0 overflow-y-auto"><PastCall call={pastCall} onOpenInChat={onOpenInChat} onCallAgain={() => { setCallSel(null); startCall({ memory: callMemory }); }} /></div>
          : <div className="flex-1 min-h-0"><CallView model={settings.selectedModel} dictation={!!dictation.length && engineOk} voice={voice?.ready ? voice.name : null}
              memoryDefault={callMemory} onMemoryDefault={(on) => { setCallMemoryDefault(on); kv.setItem('lotus.voice.callMemory', on ? '1' : '0'); }} onOpenModels={onOpenModels} /></div>)}
        <div ref={scroller} className={cx('flex-1 min-h-0 overflow-y-auto', mode === 'call' && 'hidden')}>
          {notice && <div className="max-w-[760px] mx-auto px-6 pt-4"><BuiltinNotice kind="voice" purpose={mode === 'dictate' ? 'to turn speech into text' : 'to speak'} /></div>}
          {mode === 'voices' && <VoicesView studio={studio} selected={voiceSel} onSelect={setVoiceSel} lastClip={lastClip} onOpenModels={onOpenModels} />}
          {mode === 'stories' && <StoriesView studio={studio} storyId={storySel} onStory={setStorySel} />}
          {(mode === 'speak' || mode === 'dictate') && (
            <div className="max-w-[760px] mx-auto px-6 py-6 min-h-full flex flex-col">
              {mode === 'speak' && !clips.length && (
                <Empty className="flex-1" icon={<AudioLines />} title="Turn text into speech"
                  body="Type below, pick a voice and press Speak. Everything is made on this computer and saved in Lotus Studio."
                  action={<div className="flex flex-col items-center gap-3">
                    <div className="flex flex-wrap justify-center gap-2">{STARTERS.map((s) => <button key={s} type="button" onClick={() => setText(s)} className="max-w-[220px] px-3 py-2 rounded-[10px] text-[12px] text-left bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)] hover:shadow-[0_0_0_1px_var(--color-accent-fill)]">{s}</button>)}</div>
                    <Btn variant="ghost" icon={<Mic2 className="w-3.5 h-3.5" />} onClick={() => { go('voices'); setVoiceSel(null); }}>Make Your Own Voice</Btn>
                  </div>} />
              )}
              {mode === 'dictate' && job && <SttProgress job={job} />}
              {mode === 'dictate' && !transcripts.length && !transcribing && (
                <SttEmpty drag={drag} onPick={() => audioFile.current?.click()} onRecord={() => void toggleRecord()} disabled={!dictation.length || !engineOk || !!rec} />
              )}
              <div className="space-y-5">
                {mode === 'speak' && [...clips].reverse().map((c) => (
                  <div key={c.id} id={`v-${c.id}`} className={cx('rounded-[12px] p-3 -mx-3', selected === c.id && 'bg-[var(--hover)]')}>
                    <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{c.text}</p>
                    <div className="mt-2"><ClipAudio path={c.path} autoPlay={fresh === c.id} /></div>
                    <p className="mt-1 flex items-center gap-1 text-[12px] text-[var(--color-text-muted)]">
                      <span className="truncate">{c.voice}{c.seconds ? ` · ${c.seconds.toFixed(1)} s` : ''} · {new Date(c.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="flex-1" />
                      <IconBtn label={c.fav ? 'Remove from favourites' : 'Add to favourites'} active={c.fav} className="!w-6 !h-6" onClick={() => studio.saveHistory((h) => ({ ...h, clips: h.clips.map((x) => (x.id === c.id ? { ...x, fav: !x.fav } : x)) }))}><Star className="w-3.5 h-3.5" fill={c.fav ? 'currentColor' : 'none'} /></IconBtn>
                      <IconBtn label="Use this text again" className="!w-6 !h-6" onClick={() => setText(c.text)}><Copy className="w-3.5 h-3.5" /></IconBtn>
                      <Popover align="right" trigger={(_o, t) => <IconBtn label="Add to a story" className="!w-6 !h-6" onClick={t}><ListPlus className="w-3.5 h-3.5" /></IconBtn>}>
                        {(close) => (<>
                          <MenuItem onClick={() => { close(); toStory(c, 'new'); }}><Plus className="w-3.5 h-3.5" />New Story</MenuItem>
                          {studio.stories.slice(0, 12).map((s) => <MenuItem key={s.id} onClick={() => { close(); toStory(c, s.id); }}><span className="truncate">{s.name}</span></MenuItem>)}
                        </>)}
                      </Popover>
                      <IconBtn label="Delete clip" className="!w-6 !h-6 hover:!text-[var(--c-red)]" onClick={() => remove(c.id)}><Trash2 className="w-3.5 h-3.5" /></IconBtn>
                    </p>
                  </div>
                ))}
                {mode === 'dictate' && transcripts.map((t) => (
                  <TranscriptCard key={t.id} t={t} selected={selected === t.id} onOpenInChat={onOpenInChat}
                    onTranslated={(lang, text) => studio.saveHistory((h) => ({ ...h, transcripts: h.transcripts.map((x) => (x.id === t.id ? { ...x, translations: [...(x.translations ?? []).filter((y) => y.lang !== lang), { lang, text, ts: Date.now() }] } : x)) }))}
                    onDelete={() => remove(t.id)} onSpeak={(x) => { setText(x); go('speak'); }}
                    onFav={() => studio.saveHistory((h) => ({ ...h, transcripts: h.transcripts.map((x) => (x.id === t.id ? { ...x, fav: !x.fav } : x)) }))} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* The shared chat bar (same shape as Chat, Work and Images); Voices and Stories have their own controls. */}
        {(mode === 'speak' || mode === 'dictate') && (
          <div className="px-6 pb-4 pt-2 shrink-0">
            <div className="max-w-[760px] mx-auto">
              {error && <Banner tone="error" className="mb-2">{error}</Banner>}
              <input ref={textFile} type="file" accept=".txt,.md,text/plain,text/markdown" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); e.target.value = ''; }} />
              <input ref={audioFile} type="file" accept="audio/*,video/*" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { Array.from(e.target.files ?? []).forEach((f) => transcribeFile(f)); e.target.value = ''; }} />
              <PromptShell tray={mode === 'speak' ? <>
                <TrayButton onClick={() => setRight(true)} icon={<SlidersHorizontal className="w-4 h-4" />} label="Settings" title="Voice, speed and every effect" />
                <TrayButton onClick={() => textFile.current?.click()} icon={<FileText className="w-4 h-4" />} label="Open Text" title="Read a .txt or .md file aloud" />
                <TrayButton onClick={onOpenModels} icon={<Boxes className="w-4 h-4" />} label="Models" title="Get voices, cloning models and Whisper" />
                <div className="flex-1" />
                <TrayNote>{text.trim() ? `${text.length.toLocaleString()} characters · about ${Math.max(1, Math.round(text.trim().split(/\s+/).length / 2.5))} s` : voiceModel?.clones ? 'Copied voice' : `${speed.toFixed(2)}× speed`}</TrayNote>
              </> : <>
                <TrayButton onClick={() => audioFile.current?.click()} icon={<Upload className="w-4 h-4" />} label="Choose a File" title="Any length: lectures, meetings, interviews, voice memos, videos" disabled={!dictation.length || !engineOk} />
                <TrayButton onClick={onOpenModels} icon={<Boxes className="w-4 h-4" />} label="Models" title="Get Whisper models" />
                <div className="flex-1" />
                <TrayNote>{dictModel?.title ?? 'No dictation model'}</TrayNote>
              </>}>
                <VramMeter />
                {mode === 'speak' ? (<>
                  <textarea ref={ta} value={text} onChange={(e) => setText(e.target.value)} rows={1} aria-label="Text to speak"
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void speakNow(); } }}
                    placeholder="Type or paste what Lotus should say… (long texts are fine)"
                    className="w-full resize-none bg-transparent px-4 pt-4 pb-1 text-[14px] leading-relaxed placeholder:text-[var(--color-text-muted)] focus:outline-none" />
                  <div className="flex items-center gap-1 px-2.5 pb-2.5">
                    <EffectsButton value={fx} onChange={setEffects} onMore={() => setRight(true)} />
                    {busy && <span role="status" className="ml-1 text-[12px] text-[var(--color-text-muted)] animate-pulse">{busy}</span>}
                    <div className="flex-1" />
                    <VoicePicker options={studio.options} value={voice} onPick={studio.setSelected} onNewVoice={() => { go('voices'); setVoiceSel(null); }} onGetVoices={onOpenModels} />
                    <SendButton disabled={!text.trim() || !voice || !engineOk || !!busy} onClick={() => void speakNow()} label="Speak" tip="Speak (Enter)" icon={<Volume2 className="w-4 h-4" />} />
                  </div>
                </>) : (
                  <div className="flex items-center gap-2 px-2.5 pt-3 pb-2.5">
                    <div className="flex-1 flex items-center gap-3 min-w-0 pl-2">
                      {rec ? <span className="h-1.5 w-full max-w-[260px] rounded-full bg-[var(--hover)] overflow-hidden" aria-hidden="true"><span className="block h-full bg-[var(--color-accent-fill)] transition-[width]" style={{ width: `${Math.min(100, level * 300)}%` }} /></span>
                        : <span className="text-[13px] text-[var(--color-text-muted)] truncate">{transcribing ? 'Writing it down… you can use other pages meanwhile' : 'Record with the mic, or drop a recording anywhere above'}</span>}
                    </div>
                    <Popover up align="right" className="w-[220px]" trigger={(o, t) => <PickerButton open={o} onClick={t} title="Language" text={settings.whisperLanguage && settings.whisperLanguage !== 'Auto' ? settings.whisperLanguage : 'Detect Language'} chevron={<ChevronDown className={cx('w-3.5 h-3.5 shrink-0 opacity-70', o && 'rotate-180')} />} />}>
                      {(close) => LANGS.map((l) => <MenuItem key={l} active={(settings.whisperLanguage || 'Auto') === l} onClick={() => { onSettings({ whisperLanguage: l }); close(); }}>{l === 'Auto' ? 'Detect Automatically' : l}</MenuItem>)}
                    </Popover>
                    {rec ? <SendButton stop onClick={() => void toggleRecord()} label="Stop and write it down" tip="Stop and write it down" />
                      : <SendButton disabled={!dictation.length || !engineOk} onClick={() => void toggleRecord()} label="Record" tip="Record" icon={<Mic className="w-4 h-4" />} />}
                  </div>
                )}
              </PromptShell>
            </div>
          </div>
        )}
      </div>

      <InspectorPane label="Voice settings">
        <div className="h-11 shrink-0 flex items-center px-4 border-b border-[var(--sep)] text-[13px] font-semibold">Settings</div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <Section title="Voice">
            <Select aria-label="Voice" value={voice?.id ?? ''} onChange={(e) => studio.setSelected(e.target.value)} disabled={!studio.options.length}>
              {!studio.options.length && <option value="">No voice downloaded</option>}
              {studio.options.some((o) => o.mine) && <optgroup label="Your Voices">{studio.options.filter((o) => o.mine).map((o) => <option key={o.id} value={o.id} disabled={!o.ready}>{o.name}</option>)}</optgroup>}
              {studio.options.some((o) => !o.mine) && <optgroup label="Built-in Voices">{studio.options.filter((o) => !o.mine).map((o) => <option key={o.id} value={o.id}>{o.name}{o.detail !== 'Built-in voice' ? ` · ${o.detail}` : ''}</option>)}</optgroup>}
            </Select>
            <div className="mt-3">
              {voiceModel?.clones
                ? <p className="text-[12px] text-[var(--color-text-muted)]">Quality and recording are set on the voice’s page in <button type="button" className="underline" onClick={() => { go('voices'); setVoiceSel(voice?.id ?? null); }}>Voices</button>.</p>
                : <SliderField label="Speed" value={speed} min={0.6} max={1.6} step={0.05} onChange={setSpeed} format={(v) => `${v.toFixed(2)}×`} />}
            </div>
            <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">This voice also reads Lotus’s spoken questions and notices.</p>
          </Section>
          <Section title="Effects">
            <EffectsPanel value={fx} onChange={setEffects} sample={lastClip} />
            {!effectsNeutral(voice?.effects) && <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">{voice?.name} has its own effects too; these are added on top.</p>}
          </Section>
          <Section title="Speech to Text">
            {dictation.length ? (
              <Select aria-label="Dictation model" value={dictModel?.id ?? ''} onChange={(e) => onSettings({ builtinDictation: e.target.value })}>
                {dictation.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
              </Select>
            ) : <p className="text-[12px] text-[var(--color-text-muted)]">Get Whisper in <button type="button" className="underline" onClick={onOpenModels}>Models</button> to turn speech into text.</p>}
          </Section>
          <Section title="Engine">
            <KV k="Engine" v={engineOk ? 'Lotus (sherpa-onnx)' : 'Not installed'} />
            <KV k="Voices" v={studio.options.length} />
            <KV k="Saved in" v="Lotus Studio/Audio" />
            <p className="mt-2 flex items-start gap-1.5 text-[12px] text-[var(--color-text-muted)] leading-snug"><BookOpen className="w-3.5 h-3.5 shrink-0 mt-0.5" />Copying a voice needs PocketTTS or ZipVoice from Models. Only copy voices you have permission to use.</p>
          </Section>
        </div>
      </InspectorPane>
    </div>
  );
};
