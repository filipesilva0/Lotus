// Voices (0.8.2): make your own voice from a few seconds of speech (record or upload), or from a
// built-in speaker with your own settings; then test it, tune it and use it everywhere.

import React, { useEffect, useRef, useState } from 'react';
import { Check, Download, ExternalLink, FolderOpen, Mic, Sparkles, Square, Trash2, Upload, Volume2, Wand2 } from 'lucide-react';
import { Banner, Btn, Empty, Select, TextArea, TextInput, cx } from '../../common/ui';
import { SliderField } from '../../common/Pane';
import { SampleHealthPanel } from '../SampleHealth';
import { ClipAudio, EffectsPanel } from './parts';
import { confirmAlert } from '../../common/Alerts';
import { MicRecorder, micErrorMessage, toWav } from '../../../lib/audio';
import { deleteMedia, saveMedia } from '../../../lib/core';
import { installModel } from '../../../lib/builtins';
import { builtinTranscribePath } from '../../../voice/voice';
import { MyVoice, READING_SCRIPTS, VOICE_CONSENT, VOICE_CONSENT_NOTE, VoiceOption, canCloneVoice, speakerLabel } from '../../../voice/studio';
import { VoiceConsent } from '../VoiceConsent';
import { Studio, speakWith } from '../../../voice/useStudio';
import { GSV_DOWNLOAD, GSV_ID, GSV_NOTE, useGptSovits } from '../../../voice/gptsovits';
import { openExternal } from '../../../lib/open';
import { usePro } from '../../../lib/pro';
import { TryPro } from '../../pro/TryPro';

const TEST_LINE = 'Hello! This is how I sound in Lotus. I can read your notes, stories and messages aloud.';

/** Hear a voice say something (not saved to history). */
const TestVoice: React.FC<{ option: VoiceOption | null }> = ({ option }) => {
  const [text, setText] = useState(TEST_LINE);
  const [busy, setBusy] = useState(false);
  const [clip, setClip] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => () => { if (clip) void deleteMedia(clip).catch(() => undefined); }, [clip]);
  const go = async () => {
    if (!option) return;
    setBusy(true); setErr(null);
    try { const r = await speakWith(option, text); setClip(r.path); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2"><TextInput value={text} onChange={(e) => setText(e.target.value)} aria-label="Test sentence" /><Btn variant="primary" loading={busy} disabled={!option?.ready || !text.trim()} icon={<Volume2 className="w-3.5 h-3.5" />} onClick={() => void go()}>Test</Btn></div>
      {option && !option.ready && <p className="text-[12px] text-[var(--c-orange)]">{option.why}</p>}
      {err && <p className="text-[12px] text-[var(--c-red)]">{err}</p>}
      {clip && <ClipAudio key={clip} path={clip} autoPlay />}
    </div>
  );
};

const H: React.FC<{ children: React.ReactNode }> = ({ children }) => <h3 className="text-[13px] font-semibold mb-2">{children}</h3>;

/**
 * GPT-SoVITS (0.15.0): a separate, free program for the most natural copied voices. Lotus doesn't
 * download it (several GB with its own Python); you pick its folder and Lotus starts it when needed.
 */
const GptSovitsCard: React.FC = () => {
  const g = useGptSovits();
  const s = g.status;
  return (
    <div className="p-3 rounded-[12px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)] space-y-2">
      <div className="flex items-start gap-2">
        <Sparkles className="w-4 h-4 mt-0.5 shrink-0 text-[var(--color-accent-fill)]" />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium">GPT-SoVITS{g.dir ? (s?.running ? ' · running' : ' · starts when a voice speaks') : ''}</p>
          <p className="text-[12px] text-[var(--color-text-muted)] leading-relaxed">
            {g.dir
              ? <>Folder: <span className="break-all">{g.dir}</span>. Pick “GPT-SoVITS” as the cloning model below. {GSV_NOTE}</>
              : <>For the most natural copied voice, use GPT-SoVITS: free, but a separate download of several GB. Download it, unpack it, then pick its folder here. {GSV_NOTE}</>}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {!g.dir && <Btn size="sm" icon={<ExternalLink className="w-3 h-3" />} onClick={() => void openExternal(GSV_DOWNLOAD)}>Download Page</Btn>}
        <Btn size="sm" icon={<FolderOpen className="w-3 h-3" />} onClick={() => void g.pick()}>{g.dir ? 'Change Folder' : 'Pick Its Folder'}</Btn>
        {g.dir && !s?.running && <Btn size="sm" loading={g.busy} onClick={() => void g.start()}>Start Now</Btn>}
        {g.dir && s?.running && s.startedByLotus && <Btn size="sm" onClick={() => void g.stop()}>Stop</Btn>}
        {g.dir && <Btn size="sm" variant="ghost" onClick={g.forget}>Don’t Use It</Btn>}
      </div>
      {(g.err || s?.error) && <p className="text-[12px] text-[var(--c-red)]">{g.err || s?.error}</p>}
    </div>
  );
};

/** Making a voice: name → recording (record or upload, quality check, trim) → model → done. */
const NewVoice: React.FC<{ studio: Studio; onDone: (id: string) => void; onOpenModels: () => void }> = ({ studio, onDone, onOpenModels }) => {
  const cloners = studio.models.filter((m) => m.clones);
  const presetModels = studio.models.filter((m) => !m.clones);
  const [how, setHow] = useState<'clone' | 'preset'>('clone');
  const proOk = usePro().unlocked; // 0.18.0: cloning is Lotus Pro (unlocked until Pro launches)
  const [name, setName] = useState('');
  const [model, setModel] = useState(cloners[0]?.id ?? '');
  const [preset, setPreset] = useState(studio.options.find((o) => !o.mine)?.id ?? '');
  const [sample, setSample] = useState<Blob | null>(null);
  const [sampleUrl, setSampleUrl] = useState<string | null>(null);
  const [rec, setRec] = useState<MicRecorder | null>(null);
  const [level, setLevel] = useState(0);
  const [secs, setSecs] = useState(0);
  const [words, setWords] = useState('');
  const [script] = useState(() => READING_SCRIPTS[Math.floor(Math.random() * READING_SCRIPTS.length)]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [getting, setGetting] = useState(false);
  const [consent, setConsent] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const recRef = useRef<MicRecorder | null>(null); recRef.current = rec;
  useEffect(() => () => recRef.current?.cancel(), []);
  useEffect(() => { if (!model && cloners[0]) setModel(cloners[0].id); }, [cloners, model]);
  useEffect(() => { if (!sample) { setSampleUrl(null); return; } const u = URL.createObjectURL(sample); setSampleUrl(u); return () => URL.revokeObjectURL(u); }, [sample]);
  const chosen = cloners.find((m) => m.id === model);

  const toggleRec = async () => {
    setErr(null);
    if (rec) { setRec(null); try { const r = await rec.stop(); setSample(r.wav); if (!words) setWords(script); } catch (e) { setErr((e as Error).message); } setLevel(0); return; }
    const r = new MicRecorder((l, t) => { setLevel(l); setSecs(t); });
    try { await r.start(); setRec(r); setSample(null); } catch (e) { setErr(micErrorMessage(e)); }
  };
  const upload = async (f?: File) => { if (!f) return; setErr(null); try { setSample(await toWav(f)); setWords(''); } catch { setErr('Lotus couldn’t read that file. Try a WAV, MP3, M4A or OGG recording.'); } };

  const create = async () => {
    setBusy(true); setErr(null);
    try {
      if (how === 'preset') {
        const o = studio.options.find((x) => x.id === preset);
        if (!o) throw new Error('Pick a built-in voice to start from.');
        const v = studio.addVoice({ name: name.trim() || o.name, model: o.model, speaker: o.speaker });
        studio.setSelected(v.id); onDone(v.id); return;
      }
      if (!sample || !chosen) throw new Error('Record or upload a few seconds of speech first.');
      if (!consent) throw new Error('Tick the box to confirm you may copy this voice.');
      const saved = await saveMedia(sample, `voice-${name.trim() || 'sample'}`);
      let text = words.trim();
      // ZipVoice needs the exact words; write them with Whisper when they weren't typed.
      if (chosen.needsReferenceText && !text) { try { text = await builtinTranscribePath(saved.path); } catch { /* the voice asks for them */ } }
      const v = studio.addVoice({ name: name.trim() || 'My Voice', model: chosen.id, reference: saved.path, referenceText: text || undefined, consentAt: Date.now() });
      studio.setSelected(v.id); onDone(v.id);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="max-w-[640px] mx-auto px-6 py-8 space-y-6">
      <div>
        <h2 className="text-[18px] font-semibold">Make a Voice</h2>
        <p className="text-[13px] text-[var(--color-text-muted)] mt-1">Copy a voice from a few seconds of clear speech, or start from a built-in voice and give it your own sound.</p>
      </div>
      <Segmented2 value={how} onChange={setHow} />
      {how === 'clone' && <TryPro feature="voice-clone" />}
      <div><H>Name</H><TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder={how === 'clone' ? 'e.g. My Voice, Grandpa, Narrator' : 'e.g. Calm Narrator'} aria-label="Voice name" /></div>

      {how === 'preset' ? (
        <div><H>Start From</H>
          <Select aria-label="Built-in voice" value={preset} onChange={(e) => setPreset(e.target.value)}>
            {studio.options.filter((o) => !o.mine).map((o) => <option key={o.id} value={o.id}>{o.name}{o.detail !== 'Built-in voice' ? ` · ${o.detail}` : ''}</option>)}
          </Select>
          {!presetModels.length && <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">No built-in voices yet. <button type="button" className="underline" onClick={onOpenModels}>Get Kokoro or Piper</button>.</p>}
          <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">After creating it, add effects and speed in its page.</p>
        </div>
      ) : (<>
        {!cloners.length && (
          <Banner tone="info" action={<Btn size="sm" variant="primary" loading={getting} icon={<Download className="w-3 h-3" />} onClick={async () => { setGetting(true); try { await installModel('pocket-tts'); } catch (e) { setErr((e as Error).message); } finally { setGetting(false); } }}>Get PocketTTS</Btn>}>
            Copying a voice needs a cloning model. PocketTTS is small and runs on the processor, no graphics card needed.
          </Banner>
        )}
        <div>
          <H>Recording</H>
          <p className="text-[12px] text-[var(--color-text-muted)] mb-2">5–15 seconds of one person speaking clearly, in a quiet room. Read this aloud:</p>
          <blockquote className="mb-3 px-3 py-2 rounded-[10px] bg-[var(--hover)] text-[14px] leading-relaxed">{script}</blockquote>
          <div className="flex flex-wrap items-center gap-2">
            <Btn variant={rec ? 'danger' : 'primary'} icon={rec ? <Square className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />} onClick={() => void toggleRec()}>{rec ? `Stop (${Math.floor(secs)}s)` : sample ? 'Record Again' : 'Record'}</Btn>
            <input ref={file} type="file" accept="audio/*" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
            <Btn icon={<Upload className="w-3.5 h-3.5" />} onClick={() => file.current?.click()} disabled={!!rec}>Upload a File</Btn>
            {rec && <span className="h-1.5 w-40 rounded-full bg-[var(--hover)] overflow-hidden" aria-hidden="true"><span className="block h-full bg-[var(--color-accent-fill)]" style={{ width: `${Math.min(100, level * 300)}%` }} /></span>}
          </div>
          {sample && sampleUrl && (
            <div className="mt-3 space-y-2">
              <audio controls src={sampleUrl} className="w-full h-9" aria-label="Your recording" />
              <SampleHealthPanel blob={sample} onTrim={(wav) => setSample(wav)} />
            </div>
          )}
        </div>
        {cloners.length > 1 && (
          <div><H>Cloning Model</H>
            <Select aria-label="Cloning model" value={model} onChange={(e) => setModel(e.target.value)}>{cloners.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</Select>
          </div>
        )}
        <GptSovitsCard />
        {chosen?.id === GSV_ID && <p className="text-[12px] text-[var(--color-text-muted)]">GPT-SoVITS uses 3 to 10 seconds of the recording; Lotus cuts a longer one at a pause.</p>}
        {chosen?.needsReferenceText && sample && (
          <div><H>Words in the Recording</H>
            <TextArea rows={3} value={words} onChange={(e) => setWords(e.target.value)} placeholder="Leave empty and Lotus writes them with Whisper" aria-label="Words in the recording" />
            <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">{chosen.title.replace(/\s*\(.*\)$/, '')} copies the voice better when these match the recording exactly.</p>
          </div>
        )}
        <VoiceConsent checked={consent} onChange={setConsent} />
      </>)}

      {err && <Banner tone="error">{err}</Banner>}
      <Btn variant="primary" loading={busy} disabled={how === 'clone' ? !proOk || !canCloneVoice({ hasSample: !!sample, consent }) || !chosen || !!rec : !preset} icon={<Check className="w-3.5 h-3.5" />} onClick={() => void create()}>Create Voice</Btn>
    </div>
  );
};

const Segmented2: React.FC<{ value: 'clone' | 'preset'; onChange: (v: 'clone' | 'preset') => void }> = ({ value, onChange }) => (
  <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="How to make it">
    {([['clone', 'Copy a Voice', 'From a recording of someone speaking'], ['preset', 'Tune a Built-in Voice', 'Pick a voice, then add your settings']] as const).map(([id, t, d]) => (
      <button key={id} type="button" role="radio" aria-checked={value === id} onClick={() => onChange(id)}
        className={cx('text-left p-3 rounded-[12px]', value === id ? 'bg-[var(--color-accent-pastel)] shadow-[0_0_0_1px_var(--color-accent-fill)]' : 'bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)] hover:bg-[var(--hover)]')}>
        <span className="block text-[13px] font-medium">{t}</span><span className="block text-[12px] text-[var(--color-text-muted)]">{d}</span>
      </button>
    ))}
  </div>
);

/** One voice: yours (editable) or a built-in speaker (test, use, save as yours). */
const VoiceDetail: React.FC<{ studio: Studio; id: string; lastClip: string | null; onSaved: (id: string) => void }> = ({ studio, id, lastClip, onSaved }) => {
  const opt = studio.options.find((o) => o.id === id) ?? null;
  const v: MyVoice | undefined = studio.mine.find((x) => x.id === id);
  const model = studio.models.find((m) => m.id === (v?.model ?? opt?.model));
  const [transcribing, setTranscribing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const replace = useRef<HTMLInputElement>(null);
  if (!opt) return <Empty title="That voice is gone" body="Its voice model may have been removed." />;
  const inUse = studio.voice?.id === opt.id;
  const write = async () => {
    if (!v?.reference) return;
    setTranscribing(true); setErr(null);
    try { studio.patchVoice(v.id, { referenceText: await builtinTranscribePath(v.reference) }); } catch (e) { setErr((e as Error).message); } finally { setTranscribing(false); }
  };
  const swap = async (f?: File) => {
    if (!f || !v) return;
    if (!await confirmAlert({ title: 'Use this recording?', message: `${VOICE_CONSENT}\n\n${VOICE_CONSENT_NOTE}`, confirm: 'I Confirm' })) return;
    try { const saved = await saveMedia(await toWav(f), `voice-${v.name}`); if (v.reference) void deleteMedia(v.reference).catch(() => undefined); studio.patchVoice(v.id, { reference: saved.path, referenceText: undefined, consentAt: Date.now() }); }
    catch { setErr('Lotus couldn’t read that file. Try a WAV, MP3, M4A or OGG recording.'); }
  };
  return (
    <div className="max-w-[640px] mx-auto px-6 py-8 space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {v ? <input value={v.name} onChange={(e) => studio.patchVoice(v.id, { name: e.target.value })} aria-label="Voice name" className="w-full bg-transparent text-[18px] font-semibold focus:outline-none rounded-[6px] focus-visible:shadow-[0_0_0_2px_var(--color-accent-fill)]" />
            : <h2 className="text-[18px] font-semibold">{opt.name}</h2>}
          <p className="text-[13px] text-[var(--color-text-muted)]">{model ? model.title : 'Model not downloaded'}{!v && opt.speaker ? ` · speaker ${opt.speaker}` : ''}</p>
        </div>
        {inUse ? <span className="h-8 px-3 inline-flex items-center gap-1.5 rounded-full bg-[var(--color-accent-pastel)] text-[var(--color-accent-vibrant)] text-[13px] font-medium"><Check className="w-3.5 h-3.5" />In Use</span>
          : <Btn variant="primary" disabled={!opt.ready} onClick={() => studio.setSelected(opt.id)}>Use This Voice</Btn>}
      </div>

      <div><H>Try It</H><TestVoice option={opt} /></div>

      {v?.reference && (
        <div><H>Recording It Copies</H>
          <ClipAudio path={v.reference} />
          <input ref={replace} type="file" accept="audio/*" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { void swap(e.target.files?.[0]); e.target.value = ''; }} />
          <Btn size="sm" className="mt-2" icon={<Upload className="w-3 h-3" />} onClick={() => replace.current?.click()}>Replace Recording</Btn>
        </div>
      )}
      {v && model?.needsReferenceText && (
        <div><H>Words in the Recording</H>
          <TextArea rows={3} value={v.referenceText ?? ''} onChange={(e) => studio.patchVoice(v.id, { referenceText: e.target.value })} aria-label="Words in the recording" />
          <Btn size="sm" className="mt-2" loading={transcribing} icon={<Wand2 className="w-3 h-3" />} onClick={() => void write()}>Write Them with Whisper</Btn>
        </div>
      )}
      {v && (
        <div><H>Sound</H>
          {model?.clones
            ? <SliderField label="Quality" value={v.steps ?? (model.needsReferenceText ? 4 : 2)} min={1} max={model.needsReferenceText ? 16 : 8} step={1} onChange={(s) => studio.patchVoice(v.id, { steps: s })} format={(s) => `${s} steps`} hint="More steps sound cleaner and take longer." />
            : <SliderField label="Speed" value={v.speed ?? 1} min={0.6} max={1.6} step={0.05} onChange={(s) => studio.patchVoice(v.id, { speed: s })} format={(s) => `${s.toFixed(2)}×`} />}
          {!model?.clones && model && model.speakers.length > 1 && (
            <div className="mt-2"><Select aria-label="Speaker" value={v.speaker ?? 0} onChange={(e) => studio.patchVoice(v.id, { speaker: Number(e.target.value) })}>{model.speakers.map((s) => <option key={s.id} value={s.id}>{speakerLabel(s.name)}</option>)}</Select></div>
          )}
        </div>
      )}
      {v && <div><H>Effects</H><EffectsPanel value={v.effects ?? {}} onChange={(fx) => studio.patchVoice(v.id, { effects: fx })} sample={lastClip ?? v.reference} /></div>}
      {v && <div><H>Notes</H><TextArea rows={2} value={v.notes ?? ''} onChange={(e) => studio.patchVoice(v.id, { notes: e.target.value })} placeholder="What this voice is for" aria-label="Notes" /></div>}
      {!v && <Btn onClick={() => { const nv = studio.addVoice({ name: opt.name, model: opt.model, speaker: opt.speaker }); onSaved(nv.id); }}>Save as My Voice</Btn>}
      {err && <Banner tone="error">{err}</Banner>}
      {v && <Btn variant="danger" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={async () => { if (await confirmAlert({ title: `Delete “${v.name}”?`, message: 'Its recording is removed from Lotus Studio too.', confirm: 'Delete' })) { studio.removeVoice(v.id); onSaved(''); } }}>Delete Voice</Btn>}
    </div>
  );
};

export const VoicesView: React.FC<{ studio: Studio; selected: string | null; onSelect: (id: string | null) => void; lastClip: string | null; onOpenModels: () => void }> = ({ studio, selected, onSelect, lastClip, onOpenModels }) =>
  selected ? <VoiceDetail key={selected} studio={studio} id={selected} lastClip={lastClip} onSaved={(id) => onSelect(id || null)} />
    : <NewVoice studio={studio} onDone={(id) => onSelect(id)} onOpenModels={onOpenModels} />;

