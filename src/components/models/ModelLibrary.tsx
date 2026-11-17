import React, { useEffect, useMemo, useState } from 'react';
import { Check, Download, FolderOpen, HardDrive, Link2, Trash2, X } from 'lucide-react';
import { Banner, Btn, Card, cx } from '../common/ui';
import { confirmAlert } from '../common/Alerts';
import { Tip } from '../common/Tip';
import { cancelJob, fmtSize, installCustomModel, installEngine, installModel, jobFor, removeEngine, removeModel, useBuiltins, type BuiltinId, type Job } from '../../lib/builtins';
import { availableOn, chatPicksFor, CLASS_LABEL, fitOf, FIT_LABEL, KIND_LABEL, LIBRARY, machineClass, type Fit, type LibEntry, type ModelKind } from '../../models/library';
import type { ImageFolder } from '../../models/imageProfiles';
import { ollamaClient, type OllamaModel } from '../../services/ollamaService';
import { voicebox } from '../../services/voicebox';
import { matchVoiceModel, VOICE_PICKS, DICTATION_PICK } from '../../setup/catalog';
import { revealPath } from '../../lib/open';
import type { LotusSettings } from '../../types/lotus';

/*
 * Models → Get Models (session 17): one place to download chat, image and voice models, whichever
 * engine runs them. A model goes to the engine Settings → Engines picked for its kind; Lotus's own
 * engines keep everything in Lotus Studio/Models, and image files go there for ComfyUI too.
 */

export type KindFilter = 'all' | ModelKind;
const ENGINE_OF: Record<ModelKind, BuiltinId> = { chat: 'llama', image: 'sd', voice: 'sherpa', dictation: 'sherpa' };

/** Which engine a kind of model goes to, from Settings → Engines. */
export function engineFor(kind: ModelKind, s: Pick<LotusSettings, 'llmBackend' | 'imageEngine' | 'voiceEngine'>): 'builtin' | 'ollama' | 'comfyui' | 'voicebox' {
  if (kind === 'chat') return s.llmBackend === 'ollama' ? 'ollama' : 'builtin';
  if (kind === 'image') return s.imageEngine === 'comfyui' ? 'comfyui' : 'builtin';
  return s.voiceEngine === 'voicebox' ? 'voicebox' : 'builtin';
}

const ENGINE_LABEL = { builtin: 'Lotus', ollama: 'Ollama', comfyui: 'ComfyUI', voicebox: 'Voicebox' } as const;

const Progress: React.FC<{ job: Job; onCancel?: () => void }> = ({ job, onCancel }) => {
  const pct = job.total ? Math.min(100, Math.round((job.done / job.total) * 100)) : null;
  return (
    <div className="space-y-1 min-w-0 w-full" role="status">
      <div className="flex items-center gap-2 text-[12px] text-[var(--color-text-muted)]">
        <span className="flex-1 min-w-0 truncate">{job.step}{pct !== null ? ` · ${pct}%` : ''}{job.total ? ` of ${fmtSize(job.total)}` : ''}</span>
        {onCancel && <button type="button" className="tip shrink-0 w-5 h-5 inline-flex items-center justify-center rounded hover:bg-[var(--hover)]" data-tip="Stop" aria-label={`Stop downloading ${job.label}`} onClick={onCancel}><X className="w-3 h-3" /></button>}
      </div>
      <div className="h-1 rounded-full bg-[var(--hover)] overflow-hidden"><div className="h-full bg-[var(--color-accent-fill)] transition-[width]" style={{ width: `${pct ?? 15}%` }} /></div>
    </div>
  );
};

const TIER_LABEL = { quick: 'Quick', balanced: 'Balanced', best: 'Best' } as const;

export const ModelLibrary: React.FC<{
  kind: KindFilter; q: string; settings: LotusSettings; ollamaUp: boolean | null; voiceboxUp: boolean | null;
  /** Ollama pulls stay in the Models page's own pull state (one at a time, shown at the top). */
  pullOllama: (tag: string) => void; pulling: string | null;
}> = ({ kind, q, settings, ollamaUp, voiceboxUp, pullOllama, pulling }) => {
  const b = useBuiltins();
  const [onlyFits, setOnlyFits] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ollama, setOllama] = useState<OllamaModel[]>([]);
  const [vbModels, setVbModels] = useState<{ model_name: string; display_name: string; hf_repo_id?: string | null; downloaded?: boolean }[]>([]);
  const vram = b.machine?.vramGb;
  const unified = !!b.machine?.unified;
  const ram = b.machine?.ramGb;
  // T71: the three chat models suggested for this kind of computer come first, then what fits.
  const picks = useMemo(() => new Map(chatPicksFor(b.machine).map((e) => [e.id, e.tier!])), [b.machine]);

  useEffect(() => { if (ollamaUp && settings.llmBackend === 'ollama') void ollamaClient.listModels().then(setOllama).catch(() => setOllama([])); }, [ollamaUp, settings.llmBackend, pulling]);
  useEffect(() => { if (voiceboxUp && settings.voiceEngine === 'voicebox') void voicebox.modelStatus().then((m) => setVbModels(m as typeof vbModels)).catch(() => setVbModels([])); }, [voiceboxUp, settings.voiceEngine]);

  const installedIds = new Set(b.models.map((m) => m.entryId ?? m.id));
  const isInstalled = (e: LibEntry): boolean => {
    const eng = engineFor(e.kind, settings);
    if (eng === 'ollama') return ollama.some((m) => m.name === e.ollama || m.name === `${e.ollama}:latest`);
    if (eng === 'voicebox') { const p = [...VOICE_PICKS, DICTATION_PICK].find((x) => x.id === e.id); const m = p ? matchVoiceModel(p, vbModels) : undefined; return !!m?.downloaded; }
    return installedIds.has(e.id);
  };

  const get = async (e: LibEntry) => {
    setError(null);
    const eng = engineFor(e.kind, settings);
    try {
      if (eng === 'ollama') { if (e.ollama) pullOllama(e.ollama); return; }
      if (eng === 'voicebox') {
        const p = [...VOICE_PICKS, DICTATION_PICK].find((x) => x.id === e.id);
        const m = p ? matchVoiceModel(p, vbModels) : undefined;
        if (!m) throw new Error(`Voicebox doesn't list ${e.title}. Update Voicebox, or switch Voice to Lotus in Settings → Engines.`);
        await voicebox.downloadModel(m.model_name);
        return;
      }
      // Lotus's own engine for this kind is fetched first when it isn't installed yet (images for
      // ComfyUI only need the files).
      const engine = ENGINE_OF[e.kind];
      if (eng === 'builtin' && !b.engines.find((x) => x.id === engine)?.installed && !jobFor(b, `engine:${engine}`)) await installEngine(engine);
      await installModel(e.id);
    } catch (err) { setError((err as Error).message); }
  };

  const needle = q.trim().toLowerCase();
  const KIND_ORDER: ModelKind[] = ['chat', 'image', 'voice', 'dictation'];
  const FIT_ORDER: Record<Fit, number> = { fits: 0, tight: 1, unknown: 1, 'too-big': 2 };
  const cpuOnly = !!b.machine && machineClass(b.machine) === 'cpu';
  /** Kind first; within chat, this computer's picks, then by fit and size. */
  const rankOf = (e: LibEntry): number => {
    const k = KIND_ORDER.indexOf(e.kind) * 1e6;
    if (e.kind !== 'chat' || !b.machine) return k;
    const t = picks.get(e.id);
    if (t) return k + ['quick', 'balanced', 'best'].indexOf(t);
    // With a graphics card bigger is better while it fits; on the processor smaller is faster.
    return k + 10 + FIT_ORDER[fitOf(e, vram, unified, ram)] * 1e4 + (cpuOnly ? Math.round(e.vramGb * 10) : Math.round(1000 - e.vramGb * 10));
  };
  const entries = useMemo(() => LIBRARY.filter((e) => {
    if (kind !== 'all' && e.kind !== kind) return false;
    if (!availableOn(e, engineFor(e.kind, settings))) return false;
    if (needle && !`${e.title} ${e.maker} ${e.tags.join(' ')} ${KIND_LABEL[e.kind]}`.toLowerCase().includes(needle)) return false;
    if (onlyFits && b.machine && fitOf(e, vram, unified, ram) === 'too-big') return false;
    return true;
  }).map((e, i) => ({ e, i })).sort((a, z) => rankOf(a.e) - rankOf(z.e) || a.i - z.i).map((x) => x.e),
  [kind, settings.llmBackend, settings.imageEngine, settings.voiceEngine, needle, onlyFits, b.machine]); // eslint-disable-line react-hooks/exhaustive-deps

  const installed = b.models.filter((m) => (kind === 'all' || m.kind === kind) && (!needle || m.title.toLowerCase().includes(needle)));
  const running = b.jobs.filter((j) => j.state === 'running');
  const failed = b.jobs.filter((j) => j.state === 'error').slice(0, 3);

  return (
    <div className="space-y-6">
      {/* This computer, and where everything goes. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
        <span className="inline-flex items-center gap-1.5"><HardDrive className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
          {b.machine ? (b.machine.gpu === 'none' ? `No graphics card found: models run on the processor${b.machine.ramGb ? ` · ${Math.round(b.machine.ramGb)} GB memory` : ''}` : `${b.machine.gpuName}${b.machine.vramGb ? ` · ${b.machine.vramGb} GB ${b.machine.unified ? 'shared memory' : 'video memory'}` : ''}`) : 'Reading this computer…'}
          {b.machine && <span className="text-[var(--color-text-muted)]">· Suggestions for: {CLASS_LABEL[machineClass(b.machine)]}</span>}
          <Tip label="Video memory" text="VRAM: the graphics card's own memory. A model runs fastest when it fits in it." /></span>
        <label className="inline-flex items-center gap-2 text-[13px]"><input type="checkbox" checked={onlyFits} onChange={(e) => setOnlyFits(e.target.checked)} />Only Models That Fit</label>
        <div className="flex-1" />
        {b.modelsDir && <Btn size="sm" variant="ghost" icon={<FolderOpen className="w-3.5 h-3.5" />} onClick={() => void revealPath(b.modelsDir).catch(() => undefined)}>Show Models Folder</Btn>}
      </div>

      {!b.available && b.loaded && <Banner tone="warn">Lotus's own engines need the Lotus core, which isn't running. Models for Ollama, ComfyUI and Voicebox still work from their own engines.</Banner>}
      {error && <Banner tone="error" action={<Btn size="sm" variant="ghost" onClick={() => setError(null)}>Dismiss</Btn>}>{error}</Banner>}
      {failed.map((j) => <Banner key={j.id} tone="error">{j.label}: {j.error}</Banner>)}

      {running.length > 0 && (
        <section aria-label="Downloads">
          <h2 className="text-[13px] font-semibold mb-2">Downloading</h2>
          <div className="space-y-3">{running.map((j) => <div key={j.id} className="min-w-0"><p className="text-[13px] font-medium mb-1 truncate">{j.label}</p><Progress job={j} onCancel={() => void cancelJob(j.id)} /></div>)}</div>
        </section>
      )}

      <EnginesRow kind={kind} settings={settings} />

      {installed.length > 0 && (
        <section>
          <h2 className="text-[13px] font-semibold mb-2">In Lotus Studio ({installed.length})</h2>
          <ul className="divide-y divide-[var(--sep)]">
            {installed.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-2">
                <span className="w-[72px] shrink-0 text-[12px] text-[var(--color-text-muted)]">{KIND_LABEL[m.kind]}</span>
                <span className="flex-1 min-w-0"><span className="text-[13px] font-medium truncate block">{m.title}</span><span className="text-[12px] text-[var(--color-text-muted)] truncate block">{fmtSize(m.bytes)}{m.mmproj ? ' · reads images' : ''}{m.custom ? ' · added by you' : ''}</span></span>
                <Btn size="sm" variant="ghost" icon={<Trash2 className="w-3 h-3" />} onClick={() => void confirmAlert({ title: `Delete “${m.title}”?`, message: `This removes it from Lotus Studio and frees ${fmtSize(m.bytes)}. Files another model still uses are kept.`, confirm: 'Delete' }).then((ok) => { if (ok) void removeModel(m.id).catch((e) => setError((e as Error).message)); })}>Delete</Btn>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-[13px] font-semibold mb-2">Get Models</h2>
        {!entries.length && <p className="text-[13px] text-[var(--color-text-muted)]">{onlyFits ? 'Nothing here fits this computer. Untick "Only Models That Fit" to see everything.' : 'Nothing matches.'}</p>}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
          {entries.map((e) => {
            const eng = engineFor(e.kind, settings);
            const job = jobFor(b, `model:${e.id}`);
            const busy = job?.state === 'running' || (eng === 'ollama' && pulling === e.ollama);
            const have = isInstalled(e);
            const fit = b.machine ? fitOf(e, vram, unified, ram) : null;
            const tier = picks.get(e.id);
            const offline = (eng === 'ollama' && ollamaUp === false) || (eng === 'voicebox' && voiceboxUp === false) || ((eng === 'builtin' || eng === 'comfyui') && !b.available);
            return (
              <Card key={e.id} className="p-3.5 flex flex-col min-w-0 overflow-hidden">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0"><p className="text-[14px] font-semibold truncate">{e.title}</p><p className="text-[12px] text-[var(--color-text-muted)] truncate">{e.maker} · {e.licence}</p></div>
                  <span className="shrink-0 px-1.5 h-5 inline-flex items-center rounded-[5px] bg-[var(--hover)] text-[12px] font-medium">{KIND_LABEL[e.kind]}</span>
                </div>
                {tier && b.machine && <p className="mt-1 text-[12px] font-medium text-[var(--color-accent-vibrant)]">Suggested for this computer · {TIER_LABEL[tier]}</p>}
                <p className="mt-1.5 text-[12px] text-[var(--color-text-muted)] leading-snug flex-1">{e.blurb}</p>
                <p className="mt-2 text-[12px] tabular-nums">
                  {e.diskGb >= 1 ? `${e.diskGb} GB` : `${Math.round(e.diskGb * 1000)} MB`}
                  {e.image ? ` · includes its ${e.image.files.vae ? 'VAE' : ''}${e.image.files.llm ? ' and text encoder' : ''}` : ''}
                  {fit && <span className={cx('ml-2 font-medium', fit === 'fits' ? 'text-[var(--c-green)]' : fit === 'tight' ? 'text-[var(--c-orange)]' : 'text-[var(--color-text-muted)]')}>{FIT_LABEL[fit]}</span>}
                </p>
                <div className="mt-2.5 flex items-center gap-2 min-w-0">
                  {have ? <span className="inline-flex items-center gap-1 text-[12px] text-[var(--c-green)] font-medium"><Check className="w-3.5 h-3.5" />Installed</span>
                    : busy && job ? <div className="flex-1 min-w-0"><Progress job={job} onCancel={() => void cancelJob(job.id)} /></div>
                    : <Btn size="sm" variant="primary" loading={busy} disabled={offline} icon={<Download className="w-3 h-3" />} onClick={() => void get(e)}>Get</Btn>}
                  <span className="ml-auto shrink-0 text-[12px] text-[var(--color-text-muted)]">{ENGINE_LABEL[eng]}</span>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      <AddByLink kind={kind} onError={setError} available={b.available} />
    </div>
  );
};

/** Lotus's own engines for the kinds on screen: installed version, or Install. */
export const EnginesRow: React.FC<{ kind: KindFilter; settings: LotusSettings }> = ({ kind, settings }) => {
  const b = useBuiltins();
  if (!b.available) return null;
  const want = new Set<BuiltinId>();
  if ((kind === 'all' || kind === 'chat') && settings.llmBackend !== 'ollama') want.add('llama');
  if ((kind === 'all' || kind === 'image') && settings.imageEngine !== 'comfyui') want.add('sd');
  if ((kind === 'all' || kind === 'voice' || kind === 'dictation') && settings.voiceEngine !== 'voicebox') want.add('sherpa');
  const list = b.engines.filter((e) => want.has(e.id));
  if (!list.length) return null;
  return (
    <section>
      <h2 className="text-[13px] font-semibold mb-2 flex items-center gap-1">Lotus Engines<Tip label="Lotus Engines" text="The programs that run the models. Lotus downloads them once into Lotus Studio/Engines; nothing else needs installing." /></h2>
      <ul className="divide-y divide-[var(--sep)]">
        {list.map((e) => {
          const job = jobFor(b, `engine:${e.id}`);
          return (
            <li key={e.id} className="flex items-center gap-3 py-2">
              <span className="w-[72px] shrink-0 text-[12px] text-[var(--color-text-muted)]">{e.role.split(' ')[0]}</span>
              <span className="flex-1 min-w-0"><span className="text-[13px] font-medium">{e.name}</span>
                <span className="block text-[12px] text-[var(--color-text-muted)] truncate">{e.installed ? `${e.version} · ${e.flavour}` : job?.state === 'error' ? job.error : e.outdated ? `${e.version} · ${e.note ?? 'Needs an update'}` : 'Not installed'}</span></span>
              {job?.state === 'running' ? <div className="w-[220px] shrink-0 min-w-0"><Progress job={job} onCancel={() => void cancelJob(job.id)} /></div>
                : e.installed ? <Btn size="sm" variant="ghost" icon={<Trash2 className="w-3 h-3" />} onClick={() => void confirmAlert({ title: `Remove ${e.name}?`, message: 'Your models stay in Lotus Studio/Models. You can install the engine again at any time.', confirm: 'Remove' }).then((ok) => { if (ok) void removeEngine(e.id); })}>Remove</Btn>
                : <Btn size="sm" variant="primary" icon={<Download className="w-3 h-3" />} onClick={() => void installEngine(e.id)}>{e.outdated ? 'Update' : 'Install'}</Btn>}
            </li>
          );
        })}
      </ul>
    </section>
  );
};

const FOLDER_LABEL: Record<ImageFolder, string> = { checkpoints: 'Checkpoint', diffusion_models: 'Diffusion model', text_encoders: 'Text encoder', vae: 'VAE', loras: 'LoRA' };

/** Any other model: a Hugging Face GGUF repo, or a link to one file. */
const AddByLink: React.FC<{ kind: KindFilter; onError: (m: string | null) => void; available: boolean }> = ({ kind, onError, available }) => {
  const [source, setSource] = useState('');
  const [k, setK] = useState<ModelKind>(kind === 'all' ? 'chat' : kind);
  const [folder, setFolder] = useState<ImageFolder>('checkpoints');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (kind !== 'all') setK(kind); }, [kind]);
  if (!available) return null;
  const add = async () => {
    setBusy(true); onError(null);
    try { await installCustomModel({ source: source.trim(), kind: k, folder: k === 'image' ? folder : undefined }); setSource(''); }
    catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  };
  const sel = 'h-8 px-2 rounded-[6px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)] text-[13px] text-[var(--color-text-main)]';
  return (
    <section>
      <h2 className="text-[13px] font-semibold mb-1">Add Any Model</h2>
      <p className="text-[12px] text-[var(--color-text-muted)] mb-2">Paste a Hugging Face model name (owner/model, or owner/model:Q5_K_M for another size) or a link to a .gguf, .safetensors or .onnx file. It goes into Lotus Studio/Models.</p>
      <div className="flex flex-wrap gap-2">
        <span className="relative flex-1 min-w-[260px]"><Link2 className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-muted)]" aria-hidden="true" />
          <input value={source} onChange={(e) => setSource(e.target.value)} aria-label="Model name or link" placeholder="unsloth/Qwen3-14B-GGUF or https://…/model.safetensors" className={cx(sel, 'w-full pl-8')} /></span>
        <select aria-label="Kind of model" className={sel} value={k} onChange={(e) => setK(e.target.value as ModelKind)}>
          {(['chat', 'image', 'voice', 'dictation'] as ModelKind[]).map((x) => <option key={x} value={x}>{KIND_LABEL[x]}</option>)}
        </select>
        {k === 'image' && <select aria-label="What the file is" className={sel} value={folder} onChange={(e) => setFolder(e.target.value as ImageFolder)}>
          {(Object.keys(FOLDER_LABEL) as ImageFolder[]).map((f) => <option key={f} value={f}>{FOLDER_LABEL[f]}</option>)}
        </select>}
        <Btn variant="primary" loading={busy} disabled={!source.trim()} icon={<Download className="w-3.5 h-3.5" />} onClick={() => void add()}>Download</Btn>
      </div>
    </section>
  );
};
