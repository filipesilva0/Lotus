import React, { useEffect, useRef, useState } from 'react';
import { Mic, Upload, Square, Trash2, Wand2 } from 'lucide-react';
import {
  voicebox, VoiceProfile, VoiceType, LANGUAGES, TTS_ENGINES, PresetVoice, ProfileSample, fmtDuration, TtsEngine,
} from '../../services/voicebox';
import { MicRecorder, micErrorMessage } from '../../lib/audio';
import { Modal } from '../common/Modal';
import { Btn, Segmented, Label, TextInput, TextArea, Select, Banner, Spinner, IconBtn, cx } from '../common/ui';

interface NewSample {
  key: string;
  blob: Blob;
  fileName: string;
  text: string;
  durationSec?: number;
  transcribing?: boolean;
}

const PRESET_ENGINES: TtsEngine[] = ['kokoro', 'qwen_custom_voice'];

export const VoiceEditor: React.FC<{
  open: boolean;
  profile: VoiceProfile | null; // null = create
  onClose: () => void;
  onSaved: (p: VoiceProfile) => void;
}> = ({ open, profile, onClose, onSaved }) => {
  const editing = !!profile;
  const [type, setType] = useState<VoiceType>('cloned');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [language, setLanguage] = useState('en');
  const [defaultEngine, setDefaultEngine] = useState('');
  const [personality, setPersonality] = useState('');
  const [designPrompt, setDesignPrompt] = useState('');
  const [presetEngine, setPresetEngine] = useState<TtsEngine>('kokoro');
  const [presetVoice, setPresetVoice] = useState('');
  const [presetList, setPresetList] = useState<PresetVoice[] | null>(null);
  const [existing, setExisting] = useState<ProfileSample[]>([]);
  const [samples, setSamples] = useState<NewSample[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Recording
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [secs, setSecs] = useState(0);
  const rec = useRef<MicRecorder | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null); setSamples([]); setRecording(false); setPresetList(null);
    setType(profile?.voice_type ?? 'cloned');
    setName(profile?.name ?? '');
    setDescription(profile?.description ?? '');
    setLanguage(profile?.language ?? 'en');
    setDefaultEngine(profile?.default_engine ?? '');
    setPersonality(profile?.personality ?? '');
    setDesignPrompt(profile?.design_prompt ?? '');
    setPresetEngine((profile?.preset_engine as TtsEngine) ?? 'kokoro');
    setPresetVoice(profile?.preset_voice_id ?? '');
    setExisting([]);
    if (profile?.voice_type === 'cloned') voicebox.listSamples(profile.id).then(setExisting).catch(() => undefined);
    return () => rec.current?.cancel();
  }, [open, profile]);

  useEffect(() => {
    if (!open || type !== 'preset') return;
    setPresetList(null);
    voicebox.presetVoices(presetEngine).then(setPresetList).catch((e) => { setPresetList([]); setErr(e.message); });
  }, [open, type, presetEngine]);

  const addSample = (s: Omit<NewSample, 'key' | 'text'>) =>
    setSamples((cur) => [...cur, { ...s, key: crypto.randomUUID(), text: '' }]);

  const startRec = async () => {
    setErr(null);
    try {
      rec.current = new MicRecorder((l, t) => { setLevel(l); setSecs(t); });
      await rec.current.start();
      setRecording(true);
    } catch (e) {
      setErr(micErrorMessage(e));
    }
  };
  const stopRec = async () => {
    const r = await rec.current?.stop();
    setRecording(false); setLevel(0);
    if (r) addSample({ blob: r.wav, fileName: `recording-${samples.length + 1}.wav`, durationSec: r.durationSec });
  };

  const transcribe = async (key: string) => {
    const s = samples.find((x) => x.key === key);
    if (!s) return;
    setSamples((c) => c.map((x) => (x.key === key ? { ...x, transcribing: true } : x)));
    setErr(null);
    try {
      const t = await voicebox.transcribe(s.blob, { language: language });
      setSamples((c) => c.map((x) => (x.key === key ? { ...x, text: t.text.trim(), transcribing: false } : x)));
    } catch (e) {
      setErr(`Couldn't transcribe automatically: ${(e as Error).message}`);
      setSamples((c) => c.map((x) => (x.key === key ? { ...x, transcribing: false } : x)));
    }
  };

  const clone = type === 'cloned';
  const valid =
    name.trim().length > 0 &&
    (type !== 'designed' || designPrompt.trim().length > 0) &&
    (type !== 'preset' || !!presetVoice) &&
    (!clone || editing || (samples.length > 0 && samples.every((s) => s.text.trim())));

  const save = async () => {
    setBusy(true); setErr(null);
    let saved: VoiceProfile | null = profile;
    try {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        language,
        voice_type: type,
        default_engine: defaultEngine || null,
        personality: personality.trim() || null,
        preset_engine: type === 'preset' ? presetEngine : null,
        preset_voice_id: type === 'preset' ? presetVoice : null,
        design_prompt: type === 'designed' ? designPrompt.trim() : null,
      };
      saved = editing ? await voicebox.updateProfile(profile!.id, body) : await voicebox.createProfile(body);
      for (const s of samples) await voicebox.addSample(saved.id, s.blob, s.fileName, s.text.trim());
      onSaved(saved);
      onClose();
    } catch (e) {
      setErr((e as Error).message + (saved && !editing ? ' The voice was created; reopen it to add samples again.' : ''));
      if (saved && !editing) onSaved(saved);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={busy ? () => undefined : onClose} wide title={editing ? `Edit ${profile!.name}` : 'New voice'}
      footer={<>
        <Btn variant="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn variant="primary" loading={busy} disabled={!valid} onClick={save}>{editing ? 'Save changes' : 'Create voice'}</Btn>
      </>}>
      <div className="space-y-4">
        {!editing && (
          <Segmented value={type} onChange={setType} options={[
            { id: 'cloned', label: 'Clone a voice' }, { id: 'preset', label: 'Built-in voice' }, { id: 'designed', label: 'Describe a voice' },
          ]} />
        )}

        <div className="grid grid-cols-2 gap-3">
          <div><Label>Name</Label><TextInput autoFocus value={name} maxLength={100} placeholder="e.g. Narrator" onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>Language</Label>
            <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
            </Select>
          </div>
        </div>

        {clone && (
          <section>
            <Label hint="A few seconds of clear speech is enough">Voice samples</Label>

            {existing.map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-lg bg-black/[.03] dark:bg-white/[.04] px-3 py-2 mb-2">
                <span className="text-xs flex-1 truncate text-[var(--color-text-main)] dark:text-slate-200">“{s.reference_text}”</span>
                <IconBtn label="Delete sample" onClick={async () => { await voicebox.deleteSample(s.id); setExisting((c) => c.filter((x) => x.id !== s.id)); }}>
                  <Trash2 className="w-3.5 h-3.5" />
                </IconBtn>
              </div>
            ))}

            {samples.map((s) => (
              <div key={s.key} className="rounded-xl border border-[var(--color-border-subtle)] p-3 mb-2 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold flex-1 truncate text-[var(--color-text-main)]">{s.fileName}</span>
                  {s.durationSec != null && <span className="text-xs text-[var(--color-text-muted)] tabular-nums">{fmtDuration(s.durationSec)}</span>}
                  <IconBtn label="Remove sample" onClick={() => setSamples((c) => c.filter((x) => x.key !== s.key))}><Trash2 className="w-3.5 h-3.5" /></IconBtn>
                </div>
                <TextArea rows={2} value={s.text} placeholder="Type exactly what is said in this clip" maxLength={1000}
                  onChange={(e) => setSamples((c) => c.map((x) => (x.key === s.key ? { ...x, text: e.target.value } : x)))} />
                <Btn size="sm" variant="secondary" loading={s.transcribing} icon={<Wand2 className="w-3 h-3" />} onClick={() => transcribe(s.key)}>
                  Transcribe for me
                </Btn>
              </div>
            ))}

            <div className="flex items-center gap-2">
              {recording ? (
                <>
                  <Btn variant="primary" icon={<Square className="w-3.5 h-3.5" fill="currentColor" />} onClick={stopRec}>Stop · <span className="tabular-nums">{fmtDuration(secs)}</span></Btn>
                  <div className="flex-1 h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden" aria-hidden>
                    <div className="h-full bg-[var(--color-accent-vibrant)] transition-[width] duration-75" style={{ width: `${level * 100}%` }} />
                  </div>
                </>
              ) : (
                <>
                  <Btn variant="secondary" icon={<Mic className="w-3.5 h-3.5" />} onClick={startRec}>Record</Btn>
                  <Btn variant="secondary" icon={<Upload className="w-3.5 h-3.5" />} onClick={() => fileInput.current?.click()}>Upload audio</Btn>
                  <input ref={fileInput} type="file" accept="audio/*" multiple hidden onChange={(e) => {
                    Array.from(e.target.files ?? []).forEach((f) => addSample({ blob: f, fileName: f.name }));
                    e.target.value = '';
                  }} />
                </>
              )}
            </div>
          </section>
        )}

        {type === 'preset' && (
          <section>
            <div className="mb-3">
              <Label>Engine</Label>
              <Select value={presetEngine} onChange={(e) => { setPresetEngine(e.target.value as TtsEngine); setPresetVoice(''); }}>
                {PRESET_ENGINES.map((id) => <option key={id} value={id}>{TTS_ENGINES.find((e) => e.id === id)!.label}</option>)}
              </Select>
            </div>
            <Label>Voice</Label>
            {presetList === null ? <Spinner className="w-4 h-4 text-[var(--color-accent-vibrant)]" /> : (
              <div className="grid grid-cols-2 gap-1.5 max-h-52 overflow-y-auto pr-1" role="radiogroup" aria-label="Built-in voices">
                {presetList.map((v) => (
                  <button key={v.voice_id} role="radio" aria-checked={presetVoice === v.voice_id}
                    onClick={() => { setPresetVoice(v.voice_id); if (!name) setName(v.name); if (v.language) setLanguage(v.language.slice(0, 2).toLowerCase()); }}
                    className={cx('text-left px-3 py-2 rounded-lg border text-xs transition-colors',
                      presetVoice === v.voice_id
                        ? 'bg-[var(--color-accent-pastel)] border-[var(--color-accent-vibrant)] text-[var(--color-accent-vibrant)]'
                        : 'border-[var(--color-border-subtle)] hover:bg-black/[.03] dark:hover:bg-white/5 text-[var(--color-text-main)] dark:text-slate-200')}>
                    <span className="font-semibold block truncate">{v.name}</span>
                    <span className="text-xs text-[var(--color-text-muted)]">{[v.gender, v.language].filter(Boolean).join(' · ')}</span>
                  </button>
                ))}
                {presetList.length === 0 && <p className="text-xs text-[var(--color-text-muted)] col-span-2">This engine has no built-in voices.</p>}
              </div>
            )}
          </section>
        )}

        {type === 'designed' && (
          <section>
            <Label hint="plain language">Voice description</Label>
            <TextArea rows={3} value={designPrompt} maxLength={2000}
              placeholder="A calm, low-pitched woman in her forties, warm and unhurried, like a late-night radio host"
              onChange={(e) => setDesignPrompt(e.target.value)} />
          </section>
        )}

        <details className="group">
          <summary className="text-xs font-semibold text-[var(--color-text-muted)] cursor-pointer select-none">More options</summary>
          <div className="mt-3 space-y-3">
            <div><Label hint="optional">Description</Label><TextInput value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} /></div>
            <div><Label>Preferred engine</Label>
              <Select value={defaultEngine} onChange={(e) => setDefaultEngine(e.target.value)}>
                <option value="">Automatic</option>
                {TTS_ENGINES.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
              </Select>
            </div>
            <div><Label hint="used by “Speak in character” and by agents">Personality</Label>
              <TextArea rows={3} value={personality} maxLength={2000} placeholder="Dry-witted, speaks in short sentences, never uses exclamation marks."
                onChange={(e) => setPersonality(e.target.value)} />
            </div>
          </div>
        </details>

        {err && <Banner tone="error">{err}</Banner>}
      </div>
    </Modal>
  );
};
