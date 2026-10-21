import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, Square, Shuffle, ChevronDown, Wand2, Star, Plus } from 'lucide-react';
import {
  voicebox, Generation, TTS_ENGINES, LANGUAGES, EffectConfig, engineLabel, fmtDuration, GenerateInput, TtsEngine,
} from '../../services/voicebox';
import { downloadBlob } from '../../lib/audio';
import { Btn, Card, Select, TextArea, TextInput, Label, Banner, Spinner, Empty, cx } from '../common/ui';
import { AudioPlayer } from './AudioPlayer';
import { EffectsChain } from './EffectsChain';
import { VoiceData, avatarGradient } from './useVoiceData';
import { VoiceProfile } from '../../services/voicebox';

interface Props {
  data: VoiceData;
  profile: VoiceProfile | null;
  onSelectProfile: (id: string) => void;
  text: string;
  onText: (t: string) => void;
  onOpenModels: () => void;
  onCreateVoice: () => void;
  onAddToStory: (generationId: string) => void;
}

export const Avatar: React.FC<{ name: string; size?: number; className?: string }> = ({ name, size = 32, className }) => (
  <div className={cx('rounded-full flex items-center justify-center text-white font-semibold shrink-0 select-none', className)}
    style={{ width: size, height: size, background: avatarGradient(name), fontSize: size * 0.4 }}>
    {name.trim().charAt(0).toUpperCase() || '?'}
  </div>
);

export const SpeakTab: React.FC<Props> = ({ data, profile, onSelectProfile, text, onText, onOpenModels, onCreateVoice, onAddToStory }) => {
  const [engine, setEngine] = useState<TtsEngine | ''>('');
  const [language, setLanguage] = useState('en');
  const [instruct, setInstruct] = useState('');
  const [personality, setPersonality] = useState(false);
  const [seed, setSeed] = useState('');
  const [fx, setFx] = useState<EffectConfig[] | null>(null);
  const [fxOpen, setFxOpen] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const [normalize, setNormalize] = useState(true);
  const [chunk, setChunk] = useState(800);
  const [crossfade, setCrossfade] = useState(50);

  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ gen: Generation; url: string } | null>(null);
  const [recent, setRecent] = useState<Generation[]>([]);
  const ctrl = useRef<AbortController | null>(null);
  const genId = useRef<string | null>(null);

  // A new voice resets per-voice choices to that voice's defaults.
  useEffect(() => {
    setEngine('');
    setFx(null);
    setPersonality(false);
    setLanguage(profile?.language || 'en');
  }, [profile?.id, profile?.language]);

  const loadRecent = () => voicebox.history({ limit: 6 }).then((p) => setRecent(p.items)).catch(() => undefined);
  useEffect(() => { if (data.status === 'online') void loadRecent(); }, [data.status]);

  useEffect(() => {
    if (!busy) return;
    const t0 = Date.now();
    const t = setInterval(() => setElapsed((Date.now() - t0) / 1000), 200);
    return () => { clearInterval(t); setElapsed(0); };
  }, [busy]);

  const effectiveFx = fx ?? profile?.effects_chain ?? [];
  const canRun = !!profile && text.trim().length > 0 && !busy;

  const run = async () => {
    if (!profile || !canRun) return;
    setErr(null);
    setBusy(true);
    setResult(null);
    const c = new AbortController();
    ctrl.current = c;
    try {
      const body: GenerateInput = {
        profile_id: profile.id,
        text: text.trim(),
        language,
        normalize,
        max_chunk_chars: chunk,
        crossfade_ms: crossfade,
        ...(engine && { engine }),
        ...(instruct.trim() && { instruct: instruct.trim() }),
        ...(seed.trim() && /^\d+$/.test(seed.trim()) && { seed: parseInt(seed, 10) }),
        ...(personality && { personality: true }),
        ...(fx !== null && { effects_chain: fx }),
      };
      const queued = await voicebox.generate(body);
      genId.current = queued.id;
      const done = await voicebox.waitFor(queued.id, undefined, c.signal);
      setResult({ gen: done, url: await voicebox.audioUrl(done.id) });
      void loadRecent();
    } catch (e) {
      if (!c.signal.aborted) setErr((e as Error).message);
    } finally {
      setBusy(false);
      ctrl.current = null;
    }
  };

  const cancel = async () => {
    ctrl.current?.abort();
    if (genId.current) await voicebox.cancel(genId.current).catch(() => undefined);
    setBusy(false);
  };

  const modelHint = err && /model|download|not (found|loaded)/i.test(err);

  if (data.profilesLoading) return <div className="p-6 flex justify-center"><Spinner className="w-5 h-5 text-[var(--color-accent-vibrant)]" /></div>;
  if (!profile) {
    return (
      <Empty icon={<Wand2 className="w-5 h-5" />} title="Create your first voice"
        body="Clone a voice from a few seconds of audio, pick a built-in voice, or describe one in words."
        action={<Btn variant="primary" icon={<Plus className="w-3.5 h-3.5" />} onClick={onCreateVoice}>New voice</Btn>} />
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5 p-5 min-h-0">
      {/* Composer */}
      <div className="space-y-4 min-w-0">
        <div className="flex items-center gap-3">
          <Avatar name={profile.name} size={36} />
          <div className="flex-1 min-w-0">
            <Select aria-label="Voice" value={profile.id} onChange={(e) => onSelectProfile(e.target.value)}>
              {data.profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </div>
          <Btn variant="ghost" size="sm" className="h-9" icon={<Plus className="w-3.5 h-3.5" />} onClick={onCreateVoice}>New voice</Btn>
        </div>

        <div>
          <TextArea aria-label="Text to speak" rows={9} value={text} maxLength={50000}
            placeholder="Type or paste what this voice should say…"
            onChange={(e) => onText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void run(); } }}
            className="!text-sm min-h-[220px]" />
          <div className="flex items-center justify-between mt-1.5 text-xs text-[var(--color-text-muted)]">
            <span>Ctrl + Enter to generate</span>
            <span className="tabular-nums">{text.length.toLocaleString()} / 50,000</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {busy ? (
            <>
              <Btn variant="secondary" icon={<Square className="w-3.5 h-3.5" fill="currentColor" />} onClick={cancel}>Cancel</Btn>
              <span className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                <Spinner className="w-3.5 h-3.5 text-[var(--color-accent-vibrant)]" />
                Generating… <span className="tabular-nums">{elapsed.toFixed(1)}s</span>
              </span>
            </>
          ) : (
            <Btn variant="primary" disabled={!canRun} icon={<Sparkles className="w-3.5 h-3.5" />} onClick={run}>Generate speech</Btn>
          )}
        </div>

        {err && (
          <Banner tone="error" action={modelHint ? <Btn size="sm" variant="secondary" onClick={onOpenModels}>Open models</Btn> : undefined}>
            {err}
          </Banner>
        )}

        {result && (
          <Card className="p-4 space-y-3">
            <AudioPlayer src={result.url} autoPlay
              onDownload={async () => downloadBlob(await voicebox.exportAudio(result.gen.id), `${profile.name}-${result.gen.id.slice(0, 6)}.wav`)} />
            <div className="flex items-center justify-between">
              <p className="text-xs text-[var(--color-text-muted)] tabular-nums">
                {engineLabel(result.gen.engine)} · {fmtDuration(result.gen.duration)}
                {result.gen.seed != null && <> · seed {result.gen.seed}</>}
              </p>
              <Btn size="sm" variant="ghost" onClick={() => onAddToStory(result.gen.id)}>Add to story</Btn>
            </div>
          </Card>
        )}

        {recent.length > 0 && (
          <div>
            <Label>Recent</Label>
            <ul className="space-y-1.5">
              {recent.map((g) => (
                <li key={g.id}>
                  <button
                    onClick={async () => setResult({ gen: g, url: await voicebox.audioUrl(g.id) })}
                    className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-black/[.04] dark:hover:bg-white/5 transition-colors">
                    {g.is_favorited && <Star className="w-3 h-3 text-amber-500 shrink-0" fill="currentColor" />}
                    <span className="text-xs text-[var(--color-text-main)] dark:text-slate-200 truncate flex-1">{g.text}</span>
                    <span className="text-xs text-[var(--color-text-muted)] tabular-nums shrink-0">{g.profile_name ?? ''} · {fmtDuration(g.duration)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Inspector */}
      <Card className="p-4 space-y-4 self-start">
        <div>
          <Label>Engine</Label>
          <Select value={engine} onChange={(e) => setEngine(e.target.value as TtsEngine | '')}>
            <option value="">{`Voice default (${engineLabel(profile.default_engine ?? profile.preset_engine ?? 'qwen')})`}</option>
            {TTS_ENGINES.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
          </Select>
        </div>
        <div>
          <Label>Language</Label>
          <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </Select>
        </div>
        <div>
          <Label hint="optional">Delivery</Label>
          <TextInput value={instruct} maxLength={500} placeholder="e.g. whispering, warm and slow" onChange={(e) => setInstruct(e.target.value)} />
        </div>

        {profile.personality && (
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={personality} onChange={(e) => setPersonality(e.target.checked)} className="mt-0.5 accent-[var(--color-accent-vibrant)]" />
            <span className="text-xs leading-snug">
              <span className="font-semibold text-[var(--color-text-main)] block">Speak in character</span>
              <span className="text-[var(--color-text-muted)]">Rewrites your text in this voice's personality using the local LLM.</span>
            </span>
          </label>
        )}

        <div>
          <Label hint="blank = random">Seed</Label>
          <div className="flex gap-2">
            <TextInput inputMode="numeric" value={seed} placeholder="Random" onChange={(e) => setSeed(e.target.value.replace(/\D/g, ''))} />
            <Btn variant="ghost" className="h-9 px-2.5" aria-label="Random seed" onClick={() => setSeed(String(Math.floor(Math.random() * 2 ** 31)))}>
              <Shuffle className="w-3.5 h-3.5" />
            </Btn>
          </div>
        </div>

        <div className="border-t border-[var(--color-border-subtle)] pt-3">
          <button onClick={() => setFxOpen(!fxOpen)} aria-expanded={fxOpen} className="w-full flex items-center justify-between text-xs font-semibold text-[var(--color-text-main)]">
            <span>Effects <span className="text-[var(--color-text-muted)] font-medium tabular-nums">{effectiveFx.filter((e) => e.enabled).length || ''}</span></span>
            <ChevronDown className={cx('w-3.5 h-3.5 transition-transform', fxOpen && 'rotate-180')} />
          </button>
          {fxOpen && (
            <div className="mt-3">
              <EffectsChain chain={effectiveFx} onChange={setFx} available={data.effects} presets={data.presets}
                onSavePreset={async (n, c) => { await voicebox.saveEffectPreset(n, c); await data.refreshPresets(); }} />
            </div>
          )}
        </div>

        <div className="border-t border-[var(--color-border-subtle)] pt-3">
          <button onClick={() => setAdvOpen(!advOpen)} aria-expanded={advOpen} className="w-full flex items-center justify-between text-xs font-semibold text-[var(--color-text-main)]">
            Advanced
            <ChevronDown className={cx('w-3.5 h-3.5 transition-transform', advOpen && 'rotate-180')} />
          </button>
          {advOpen && (
            <div className="mt-3 space-y-3">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} className="accent-[var(--color-accent-vibrant)]" />
                Even out loudness
              </label>
              <div>
                <Label hint="characters">Split long text every</Label>
                <TextInput type="number" min={100} max={5000} step={100} value={chunk} onChange={(e) => setChunk(Math.min(5000, Math.max(100, +e.target.value || 800)))} />
              </div>
              <div>
                <Label hint="ms">Blend between parts</Label>
                <TextInput type="number" min={0} max={500} step={10} value={crossfade} onChange={(e) => setCrossfade(Math.min(500, Math.max(0, +e.target.value || 0)))} />
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};
