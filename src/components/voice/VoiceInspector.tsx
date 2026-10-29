import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { voicebox, Generation, ModelStatus, ProfileSample, STT_MODELS, TTS_ENGINES, VoiceProfile } from '../../services/voicebox';
import { engineUrl } from '../../services/engineConfig';
import { VoiceData } from './useVoiceData';
import { VoiceMode } from './VoiceSidebar';
import { Banner, Btn, IconBtn, Progress, TextArea, cx } from '../common/ui';
import { InspectorPane, KV, Section } from '../common/Pane';

type Tab = string;
const tabsFor = (mode: VoiceMode): { id: Tab; label: string }[] => {
  switch (mode) {
    case 'voices': return [{ id: 'specs', label: 'Profile specs' }, { id: 'persona', label: 'Personality' }, { id: 'engines', label: 'Engines' }];
    case 'speak': case 'library': return [{ id: 'raw', label: 'Raw inspector' }];
    case 'dictate': return [{ id: 'stt', label: 'STT models' }, { id: 'api', label: 'API' }];
    default: return [];
  }
};

const Specs: React.FC<{ p: VoiceProfile }> = ({ p }) => {
  const [samples, setSamples] = useState<ProfileSample[] | null>(null);
  useEffect(() => { setSamples(null); void voicebox.listSamples(p.id).then(setSamples).catch(() => setSamples([])); }, [p.id]);
  return (
    <div className="overflow-y-auto flex-1">
      <Section title={p.name}>
        <KV k="Kind" v={p.voice_type === 'cloned' ? 'Cloned from samples' : p.voice_type === 'preset' ? 'Built-in voice' : 'Described voice'} />
        <KV k="Language" v={p.language} /><KV k="Default engine" v={p.default_engine ?? 'Automatic'} /><KV k="Created" v={new Date(p.created_at).toLocaleDateString()} />
        {p.description && <p className="mt-2 text-[12px] text-[var(--color-text-muted)] leading-snug">{p.description}</p>}
      </Section>
      {p.voice_type === 'cloned' && (
        <Section title="Sample stack" hint="Add, remove and check clips in the voice editor (Edit on the profile). Each new clip gets a quality check and trimmer there.">
          {samples === null ? <Loader2 className="w-4 h-4 animate-spin" /> : !samples.length ? <p className="text-[13px] text-[var(--color-text-muted)]">No samples.</p> : (
            <ul className="space-y-1.5">{samples.map((s, i) => <li key={s.id} className="p-2 rounded-[8px] bg-[var(--hover)] text-[12px]"><span className="font-medium">Sample {i + 1}</span><span className="block text-[var(--color-text-muted)] line-clamp-2">{s.reference_text}</span></li>)}</ul>)}
        </Section>
      )}
    </div>
  );
};

const Persona: React.FC<{ p: VoiceProfile; onSaved: () => void }> = ({ p, onSaved }) => {
  const [text, setText] = useState(p.personality ?? '');
  const [busy, setBusy] = useState<'save' | 'compose' | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; t: string } | null>(null);
  useEffect(() => { setText(p.personality ?? ''); setMsg(null); }, [p.id, p.personality]);
  const save = async () => {
    setBusy('save'); setMsg(null);
    try {
      await voicebox.updateProfile(p.id, { name: p.name, description: p.description, language: p.language, voice_type: p.voice_type, preset_engine: p.preset_engine, preset_voice_id: p.preset_voice_id, design_prompt: p.design_prompt, default_engine: p.default_engine, personality: text.trim() || null });
      onSaved(); setMsg({ tone: 'ok', t: 'Saved.' });
    } catch (e) { setMsg({ tone: 'err', t: (e as Error).message }); } finally { setBusy(null); }
  };
  const compose = async () => {
    setBusy('compose'); setMsg(null);
    try {
      const q = await voicebox.speak('Say something in character.', { profile: p.id, personality: true });
      const g = await voicebox.waitFor(q.id);
      await new Audio(await voicebox.audioUrl(g.id)).play();
    } catch (e) { setMsg({ tone: 'err', t: (e as Error).message }); } finally { setBusy(null); }
  };
  return (
    <div className="overflow-y-auto flex-1">
      <Section title="Voice persona" hint="Describe how this character talks (up to 2,000 characters). Used when “speak in character” is on.">
        <TextArea rows={7} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} aria-label="Voice persona" placeholder="Warm, dry humour. Short sentences. Never uses slang." />
        <p className="mt-1 text-[11px] text-[var(--color-text-muted)] tabular-nums text-right">{text.length} / 2000</p>
        <div className="mt-2 flex gap-2">
          <Btn size="sm" variant="primary" loading={busy === 'save'} disabled={text === (p.personality ?? '')} onClick={save}>Save</Btn>
          <Btn size="sm" icon={<Sparkles className="w-3 h-3" />} loading={busy === 'compose'} disabled={!p.personality} onClick={compose} title={p.personality ? 'Improvise a line in character and play it' : 'Save a persona first'}>Compose</Btn>
        </div>
        {msg && <p role="status" className={cx('mt-2 text-[12px]', msg.tone === 'err' ? 'text-[var(--c-red)]' : 'text-[var(--c-green)]')}>{msg.t}</p>}
        <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">Compose asks Voicebox's local language model to write a line in character, then speaks it. It needs that model to be downloaded.</p>
      </Section>
    </div>
  );
};

const Engines: React.FC<{ p: VoiceProfile }> = ({ p }) => {
  // Voice-type support is what Lotus itself offers per engine; see the note for what is not claimed.
  const designed = (id: string) => id === 'qwen_voice_design';
  const preset = (id: string) => id === 'qwen_custom_voice' || id === 'kokoro';
  const cloned = (id: string) => !designed(id) && !preset(id);
  const tags = (id: string) => id === 'chatterbox_turbo';
  const Dot: React.FC<{ on: boolean; label: string }> = ({ on, label }) => <span role="img" aria-label={`${label}: ${on ? 'yes' : 'no'}`} className={cx('inline-block w-2.5 h-2.5 rounded-full', on ? 'bg-[var(--c-green)]' : 'bg-[var(--pressed)]')} />;
  return (
    <div className="overflow-y-auto flex-1">
      <Section title="Engine compatibility" hint={`Which engines can use a ${p.voice_type === 'cloned' ? 'cloned' : p.voice_type === 'preset' ? 'built-in' : 'described'} voice like “${p.name}”.`}>
        <table className="w-full text-[12px]">
          <thead><tr className="text-left text-[var(--color-text-muted)]"><th className="font-medium pb-1">Engine</th><th className="font-medium pb-1 text-center">Clone</th><th className="font-medium pb-1 text-center">Built-in</th><th className="font-medium pb-1 text-center">Described</th><th className="font-medium pb-1 text-center">Tags</th></tr></thead>
          <tbody>{TTS_ENGINES.map((e) => (
            <tr key={e.id} className={cx('border-t border-[var(--sep)]', p.default_engine === e.id && 'font-semibold')}>
              <td className="py-1.5">{e.label}</td><td className="text-center"><Dot on={cloned(e.id)} label="Cloning" /></td><td className="text-center"><Dot on={preset(e.id)} label="Built-in voices" /></td><td className="text-center"><Dot on={designed(e.id)} label="Described voices" /></td><td className="text-center"><Dot on={tags(e.id)} label="Expression tags" /></td>
            </tr>))}</tbody>
        </table>
        <p className="mt-2 text-[11px] text-[var(--color-text-muted)] leading-snug">Based on how Voicebox's engines are documented; Lotus can't query this from the server, so a newer Voicebox may differ.</p>
      </Section>
    </div>
  );
};

const Raw: React.FC<{ online: boolean }> = ({ online }) => {
  const [g, setG] = useState<Generation | null>(null);
  const load = useCallback(() => { void voicebox.history({ limit: 1 }).then((r) => setG(r.items[0] ?? null)).catch(() => setG(null)); }, []);
  useEffect(() => { if (online) load(); }, [online, load]);
  const text = g ? JSON.stringify(g, null, 2) : '';
  return (
    <div className="overflow-y-auto flex-1">
      <Section title="Latest generation" action={<Btn size="sm" variant="ghost" onClick={load}>Refresh</Btn>}>
        {g ? (<>
          <KV k="Engine" v={g.engine ?? '—'} /><KV k="Audio length" v={g.duration ? `${g.duration.toFixed(1)} s` : '—'} /><KV k="Seed" v={g.seed ?? '—'} /><KV k="Status" v={g.status} />
          <div className="flex items-center justify-between mt-3 mb-1"><span className="text-[12px] font-medium">Record (JSON)</span><IconBtn label="Copy JSON" className="!w-6 !h-6" onClick={() => void navigator.clipboard.writeText(text)}><Copy className="w-3.5 h-3.5" /></IconBtn></div>
          <pre className="max-h-72 overflow-auto p-2 rounded-[8px] bg-[var(--hover)] text-[11px] font-mono whitespace-pre-wrap break-all">{text}</pre>
        </>) : <p className="text-[13px] text-[var(--color-text-muted)]">Nothing generated yet.</p>}
        <p className="mt-3 text-[11px] text-[var(--color-text-muted)] leading-snug">Engine, delivery, effects, speed and seed controls sit in the card beside the script. Playback speed is in the player.</p>
      </Section>
    </div>
  );
};

const Stt: React.FC<{ online: boolean }> = ({ online }) => {
  const [models, setModels] = useState<ModelStatus[]>([]);
  const [tasks, setTasks] = useState<Record<string, number | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setModels((await voicebox.modelStatus()).filter((m) => STT_MODELS.some((s) => m.model_name.toLowerCase().includes(`whisper-${s}`) || m.model_name.toLowerCase() === `whisper${s}` || m.model_name.toLowerCase().includes(`whisper`) && m.model_name.toLowerCase().includes(s))));
      const t = await voicebox.activeTasks().catch(() => null);
      setTasks(Object.fromEntries((t?.downloads ?? []).map((x) => [x.model_name, x.progress ?? null])));
    } catch { /* offline */ }
  }, []);
  useEffect(() => { if (!online) return; void load(); const i = setInterval(load, 3000); return () => clearInterval(i); }, [online, load]);
  const act = async (name: string, fn: () => Promise<unknown>) => { setBusy(name); setErr(null); try { await fn(); await load(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); } };
  return (
    <div className="overflow-y-auto flex-1">
      <Section title="Speech-to-text models" hint="Whisper models used for dictation and captures. Bigger is more accurate and slower.">
        {err && <Banner tone="error">{err}</Banner>}
        {!models.length && <p className="text-[13px] text-[var(--color-text-muted)]">No Whisper models reported by Voicebox.</p>}
        <ul className="space-y-2 mt-2">{models.map((m) => (
          <li key={m.model_name} className="p-2.5 rounded-[8px] bg-[var(--hover)]">
            <div className="flex items-center justify-between text-[13px]"><span className="font-medium">{m.display_name}</span><span className="text-[11px] text-[var(--color-text-muted)] tabular-nums">{m.size_mb ? `${Math.round(m.size_mb)} MB` : ''}</span></div>
            {m.model_name in tasks && <div className="mt-1.5"><Progress value={tasks[m.model_name]} label={`Downloading ${m.display_name}`} /></div>}
            <div className="mt-1.5 flex gap-1.5">
              {!m.downloaded ? <Btn size="sm" loading={busy === m.model_name || m.downloading} onClick={() => act(m.model_name, () => voicebox.downloadModel(m.model_name))}>Download</Btn>
                : m.loaded ? <Btn size="sm" loading={busy === m.model_name} onClick={() => act(m.model_name, () => voicebox.unloadModel(m.model_name))}>Unload</Btn>
                : <Btn size="sm" variant="primary" loading={busy === m.model_name} onClick={() => act(m.model_name, () => voicebox.loadModel(m.model_name))}>Load</Btn>}
              {m.downloaded && !m.loaded && <IconBtn label={`Delete ${m.display_name}`} className="!w-7 !h-7" onClick={() => { if (window.confirm(`Delete ${m.display_name}?`)) void act(m.model_name, () => voicebox.deleteModel(m.model_name)); }}><Trash2 className="w-3.5 h-3.5" /></IconBtn>}
              {m.loaded && <span className="text-[11px] text-[var(--c-green)] font-medium self-center">In memory</span>}
            </div>
          </li>))}</ul>
      </Section>
    </div>
  );
};

const Api: React.FC<{ data: VoiceData }> = ({ data }) => {
  const url = engineUrl('voicebox');
  const sample = `curl ${url}/speak -H "Content-Type: application/json" -d "{\\"text\\":\\"Hello from my script\\",\\"profile\\":\\"<voice name or id>\\"}"`;
  return (
    <div className="overflow-y-auto flex-1">
      <Section title="Voicebox server">
        <KV k="Address" v={url} mono /><KV k="Status" v={data.status === 'online' ? 'Online' : 'Offline'} /><KV k="Voices" v={data.profiles.length} />
        <div className="flex items-center justify-between mt-3 mb-1"><span className="text-[12px] font-medium">Speak from any script</span><IconBtn label="Copy example" className="!w-6 !h-6" onClick={() => void navigator.clipboard.writeText(sample)}><Copy className="w-3.5 h-3.5" /></IconBtn></div>
        <pre className="p-2 rounded-[8px] bg-[var(--hover)] text-[11px] font-mono whitespace-pre-wrap break-all">{sample}</pre>
        <p className="mt-2 text-[11px] text-[var(--color-text-muted)] leading-snug">Per-agent voice bindings and the global dictation hotkey belong to Voicebox's own app and are not part of Lotus. Change the address in Engines.</p>
      </Section>
    </div>
  );
};

export const VoiceInspector: React.FC<{ mode: VoiceMode; data: VoiceData; profile: VoiceProfile | null }> = ({ mode, data, profile }) => {
  const tabs = tabsFor(mode);
  const [tab, setTab] = useState<Record<string, Tab>>({});
  if (!tabs.length) return null;
  const cur = tabs.find((t) => t.id === tab[mode])?.id ?? tabs[0].id;
  const online = data.status === 'online';
  return (
    <InspectorPane label="Inspector">
      {tabs.length > 1 && (
        <div className="shrink-0 p-2 border-b border-[var(--sep)]"><div role="tablist" aria-label="Inspector" className="flex gap-0.5 p-0.5 rounded-[8px] bg-[var(--hover)]">
          {tabs.map((t) => <button key={t.id} role="tab" aria-selected={cur === t.id} onClick={() => setTab((x) => ({ ...x, [mode]: t.id }))} className={cx('flex-1 h-7 rounded-[6px] text-[12px] font-medium', cur === t.id ? 'bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep),0_1px_2px_rgba(0,0,0,.12)]' : 'text-[var(--color-text-muted)]')}>{t.label}</button>)}
        </div></div>
      )}
      {!online ? <p className="p-4 text-[13px] text-[var(--color-text-muted)]">Start Voicebox to use the inspector.</p>
        : mode === 'voices' ? (!profile ? <p className="p-4 text-[13px] text-[var(--color-text-muted)]">Select a voice profile.</p> : cur === 'specs' ? <Specs p={profile} /> : cur === 'persona' ? <Persona p={profile} onSaved={() => void data.refreshProfiles()} /> : <Engines p={profile} />)
        : mode === 'dictate' ? (cur === 'stt' ? <Stt online={online} /> : <Api data={data} />)
        : <Raw online={online} />}
    </InspectorPane>
  );
};
