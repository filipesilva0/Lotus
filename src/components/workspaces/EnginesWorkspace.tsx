import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Play, Square, FolderSearch, ExternalLink, Check, Circle, Download, Trash2, FolderOpen, Cpu, HardDrive, X,
} from 'lucide-react';
import { useEngines, Policy } from '../../hooks/useEngines';
import { EngineId, engineUrl, setEngineUrl, DEFAULT_URLS } from '../../services/engineConfig';
import { browseForExe, appPaths, AppPaths } from '../../services/engineControl';
import { ollamaClient, OllamaModel } from '../../services/ollamaService';
import { voicebox, ModelStatus, DownloadTask } from '../../services/voicebox';
import { comfy } from '../../services/comfyService';
import { reportActivity } from '../../lib/bus';
import { openExternal, revealPath } from '../../lib/open';
import { Btn, Card, Segmented, TextInput, Banner, Spinner, Empty, Label, cx } from '../common/ui';

type Eng = ReturnType<typeof useEngines>;
type Tab = 'engines' | 'models' | 'storage';

const META: Record<EngineId, { name: string; blurb: string; install: string; installLabel: string }> = {
  ollama: {
    name: 'Ollama',
    blurb: 'Runs chat and vision language models on your GPU or CPU.',
    install: 'https://ollama.com/download', installLabel: 'Get Ollama',
  },
  comfyui: {
    name: 'ComfyUI',
    blurb: 'Generates images with Stable Diffusion and FLUX. Needs at least one checkpoint in its models folder.',
    install: 'https://github.com/comfyanonymous/ComfyUI', installLabel: 'Get ComfyUI',
  },
  voicebox: {
    name: 'Voicebox',
    blurb: 'Voice cloning, text-to-speech and speech-to-text, with its own voice library and models.',
    install: 'https://voicebox.sh/download/windows', installLabel: 'Get Voicebox',
  },
};

export const EnginesWorkspace: React.FC<{ eng: Eng; initialTab?: Tab }> = ({ eng, initialTab = 'engines' }) => {
  const [tab, setTab] = useState<Tab>(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 bg-[var(--color-bg-panel)] overflow-hidden">
      <header className="flex items-center justify-between gap-4 px-6 pt-5 pb-4 border-b border-[var(--color-border-subtle)]">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text-main)] leading-tight">Engines</h2>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">The local programs Lotus talks to. Everything runs on this PC.</p>
        </div>
        <Segmented value={tab} onChange={setTab} options={[{ id: 'engines', label: 'Engines' }, { id: 'models', label: 'Models' }, { id: 'storage', label: 'Storage' }]} />
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        {tab === 'engines' && <EnginesTab eng={eng} goModels={() => setTab('models')} />}
        {tab === 'models' && <ModelsTab eng={eng} goEngines={() => setTab('engines')} />}
        {tab === 'storage' && <StorageTab />}
      </div>
    </div>
  );
};

// ── Engines ────────────────────────────────────────────────────────────────

const EnginesTab: React.FC<{ eng: Eng; goModels: () => void }> = ({ eng, goModels }) => {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem('lotus.setup.dismissed') === '1');
  const { engines, gpu } = eng;
  const showSetup = !dismissed && (engines.ollama.up === false || engines.voicebox.up === false);

  return (
    <div className="space-y-5 max-w-6xl">
      {showSetup && (
        <Card className="p-5 border-[var(--color-accent-pastel-border)] bg-[var(--color-accent-pastel)]/40">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-text-main)]">Get set up</h3>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Lotus works with three local engines. Chat and voice are the quickest to start with.</p>
            </div>
            <Btn size="sm" variant="ghost" onClick={() => { localStorage.setItem('lotus.setup.dismissed', '1'); setDismissed(true); }}>Dismiss</Btn>
          </div>
          <ul className="mt-4 space-y-2">
            {(['ollama', 'voicebox', 'comfyui'] as EngineId[]).map((id) => (
              <li key={id} className="flex items-center gap-3 text-xs">
                {engines[id].up ? <Check className="w-4 h-4 text-emerald-500 shrink-0" /> : <Circle className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" />}
                <span className="font-semibold text-[var(--color-text-main)] w-20">{META[id].name}</span>
                <span className="text-[var(--color-text-muted)] flex-1">
                  {engines[id].up ? 'Running' : id === 'comfyui' ? 'Optional, for images' : 'Not running'}
                </span>
                {engines[id].up && id !== 'comfyui' && <Btn size="sm" variant="secondary" onClick={goModels}>Get models</Btn>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {gpu && (
        <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
          <Cpu className="w-3.5 h-3.5" />
          <span className="font-semibold text-[var(--color-text-main)]">{gpu.name}</span>
          {gpu.vramTotalGb > 0 && <span className="tabular-nums">· {(gpu.vramTotalGb - gpu.vramFreeGb).toFixed(1)} of {gpu.vramTotalGb.toFixed(0)} GB VRAM in use</span>}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {(['ollama', 'voicebox', 'comfyui'] as EngineId[]).map((id) => <EngineCard key={id} id={id} eng={eng} />)}
      </div>
    </div>
  );
};

const EngineCard: React.FC<{ id: EngineId; eng: Eng }> = ({ id, eng }) => {
  const s = eng.engines[id];
  const m = META[id];
  const [editUrl, setEditUrl] = useState(false);
  const [url, setUrl] = useState(engineUrl(id));
  const busy = s.phase !== null;
  const status = s.phase === 'starting' ? 'Starting…' : s.phase === 'stopping' ? 'Stopping…' : s.up === null ? 'Checking…' : s.up ? 'Running' : 'Stopped';

  return (
    <Card className="p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cx('w-2 h-2 rounded-full', s.up ? 'bg-emerald-500' : s.up === null || busy ? 'bg-amber-400 animate-pulse' : 'bg-[#9CA3AF]')} />
            <h3 className="text-sm font-semibold text-[var(--color-text-main)]">{m.name}</h3>
            {s.version && <span className="text-xs font-mono text-[var(--color-text-muted)]">{s.version}</span>}
          </div>
          <p className="text-xs text-[var(--color-text-muted)] mt-1" role="status">{status}</p>
        </div>
        {s.up ? (
          <Btn size="sm" variant="secondary" loading={s.phase === 'stopping'} disabled={!s.supervised || busy} icon={<Square className="w-3 h-3" fill="currentColor" />}
            title={s.supervised ? undefined : 'Started outside Lotus. Close it where you launched it.'} onClick={() => eng.stop(id)}>Stop</Btn>
        ) : (
          <Btn size="sm" variant="primary" loading={s.phase === 'starting'} disabled={busy} icon={<Play className="w-3 h-3" fill="currentColor" />} onClick={() => eng.start(id)}>Start</Btn>
        )}
      </div>

      <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">{m.blurb}</p>

      {s.needsExe && (
        <Banner tone="warn" action={<Btn size="sm" variant="secondary" icon={<FolderSearch className="w-3 h-3" />} onClick={async () => { if (await browseForExe(id)) void eng.start(id); }}>Browse…</Btn>}>
          {id === 'voicebox' ? <>Locate <code>voicebox-server.exe</code> (inside Voicebox's install folder).</>
            : id === 'comfyui' ? <>Locate the file you use to launch ComfyUI (a <code>.bat</code> or <code>.exe</code>).</>
            : <>Locate <code>ollama.exe</code>.</>}
        </Banner>
      )}
      {s.error && <Banner tone="error">{s.error}</Banner>}
      {!s.up && !busy && !s.error && !s.needsExe && s.detail && <Banner tone="warn">{s.detail}</Banner>}

      <div className="mt-auto pt-3 border-t border-[var(--color-border-subtle)] space-y-3">
        <label className="flex items-center gap-2 text-xs cursor-pointer text-[var(--color-text-main)] dark:text-slate-200">
          <input type="checkbox" className="accent-[var(--color-accent-vibrant)]" checked={s.policy === 'on_launch'}
            onChange={(e) => eng.setPolicy(id, (e.target.checked ? 'on_launch' : 'manual') as Policy)} />
          Start with Lotus
        </label>
        <div className="flex items-center gap-2 text-xs">
          {editUrl ? (
            <>
              <TextInput value={url} onChange={(e) => setUrl(e.target.value)} className="!h-7 !text-xs font-mono" aria-label={`${m.name} address`} />
              <Btn size="sm" variant="primary" onClick={() => { setEngineUrl(id, url); setEditUrl(false); void eng.refresh(); }}>Save</Btn>
              <Btn size="sm" variant="ghost" onClick={() => { setUrl(DEFAULT_URLS[id]); setEngineUrl(id, DEFAULT_URLS[id]); setEditUrl(false); void eng.refresh(); }}>Reset</Btn>
            </>
          ) : (
            <>
              <span className="font-mono text-[var(--color-text-muted)] flex-1 truncate">{engineUrl(id).replace('http://', '')}</span>
              <button className="font-semibold text-[var(--color-accent-vibrant)] hover:underline" onClick={() => setEditUrl(true)}>Change</button>
              {!s.up && <button className="font-semibold text-[var(--color-accent-vibrant)] hover:underline inline-flex items-center gap-1" onClick={() => openExternal(m.install)}>{m.installLabel}<ExternalLink className="w-3 h-3" /></button>}
              {!s.up && <button className="font-semibold text-[var(--color-text-muted)] hover:underline" onClick={async () => { if (await browseForExe(id)) void eng.start(id); }}>Locate…</button>}
            </>
          )}
        </div>
      </div>
    </Card>
  );
};

// ── Models ─────────────────────────────────────────────────────────────────

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(bytes < 1024 ** 3 ? 2 : 1)} GB`;
const SUGGESTIONS = ['llama3.2:3b', 'qwen2.5-coder:7b', 'llava:7b', 'deepseek-r1:8b'];

const Section: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({ title, hint, children }) => (
  <section className="space-y-2.5">
    <div><h3 className="text-sm font-semibold text-[var(--color-text-main)]">{title}</h3>{hint && <p className="text-xs text-[var(--color-text-muted)]">{hint}</p>}</div>
    {children}
  </section>
);

const ModelsTab: React.FC<{ eng: Eng; goEngines: () => void }> = ({ eng, goEngines }) => {
  const { engines } = eng;
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [checkpoints, setCheckpoints] = useState<string[]>([]);
  const [vbModels, setVbModels] = useState<ModelStatus[]>([]);
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [pull, setPull] = useState('');
  const [pulling, setPulling] = useState<{ name: string; status: string; pct: number | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const loadOllama = useCallback(() => ollamaClient.listModels().then(setOllamaModels).catch(() => setOllamaModels([])), []);
  const loadVb = useCallback(() => voicebox.modelStatus().then(setVbModels).catch(() => setVbModels([])), []);
  useEffect(() => { if (engines.ollama.up) void loadOllama(); }, [engines.ollama.up, loadOllama]);
  useEffect(() => { if (engines.comfyui.up) comfy.checkpoints().then(setCheckpoints).catch(() => setCheckpoints([])); }, [engines.comfyui.up]);
  useEffect(() => { if (engines.voicebox.up) void loadVb(); }, [engines.voicebox.up, loadVb]);

  // While Voicebox downloads something, follow its progress and mirror it on the island.
  const downloading = vbModels.some((m) => m.downloading);
  useEffect(() => {
    if (!downloading || !engines.voicebox.up) return;
    const t = setInterval(async () => {
      const a = await voicebox.activeTasks().catch(() => null);
      if (a) {
        setTasks(a.downloads);
        a.downloads.forEach((d) => reportActivity({ id: `dl-${d.model_name}`, kind: 'download', label: d.model_name, progress: d.progress != null ? d.progress / 100 : undefined }));
      }
      await loadVb();
    }, 1500);
    return () => clearInterval(t);
  }, [downloading, engines.voicebox.up, loadVb]);

  const doPull = async (name: string) => {
    const n = name.trim();
    if (!n) return;
    setErr(null);
    abort.current = new AbortController();
    setPulling({ name: n, status: 'Starting…', pct: null });
    try {
      for await (const p of ollamaClient.pull(n, abort.current.signal)) {
        const pct = p.total ? (p.completed ?? 0) / p.total : null;
        setPulling({ name: n, status: p.status, pct });
        reportActivity({ id: `pull-${n}`, kind: 'download', label: n, progress: pct ?? undefined });
      }
      setPull('');
      await loadOllama();
      reportActivity({ id: `pull-${n}`, kind: 'download', label: `${n} ready`, done: true });
    } catch (e) {
      if (!abort.current?.signal.aborted) setErr((e as Error).message);
      reportActivity({ id: `pull-${n}`, kind: 'download', label: n, done: true });
    } finally { setPulling(null); abort.current = null; }
  };

  const vbAction = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); await loadVb(); } catch (e) { setErr((e as Error).message); } };

  const Offline: React.FC<{ name: string }> = ({ name }) => (
    <Banner tone="warn" action={<Btn size="sm" variant="secondary" onClick={goEngines}>Engines</Btn>}>{name} isn't running, so its models can't be listed.</Banner>
  );

  return (
    <div className="space-y-8 max-w-4xl">
      {err && <Banner tone="error">{err}</Banner>}

      <Section title="Chat models" hint="Downloaded with Ollama. Type a model name to download it.">
        {engines.ollama.up === false ? <Offline name="Ollama" /> : (
          <>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void doPull(pull); }}>
              <TextInput aria-label="Model name" value={pull} onChange={(e) => setPull(e.target.value)} placeholder="e.g. llama3.2:3b" disabled={!!pulling} className="font-mono" />
              {pulling
                ? <Btn variant="secondary" icon={<X className="w-3.5 h-3.5" />} onClick={() => abort.current?.abort()}>Cancel</Btn>
                : <Btn variant="primary" type="submit" disabled={!pull.trim()} icon={<Download className="w-3.5 h-3.5" />}>Download</Btn>}
            </form>
            {pulling ? (
              <div className="space-y-1.5" role="status">
                <div className="h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                  <div className={cx('h-full bg-[var(--color-accent-vibrant)] transition-[width]', pulling.pct === null && 'animate-pulse w-1/3')} style={pulling.pct !== null ? { width: `${pulling.pct * 100}%` } : undefined} />
                </div>
                <p className="text-xs text-[var(--color-text-muted)] tabular-nums">{pulling.name} · {pulling.status}{pulling.pct !== null && ` · ${Math.round(pulling.pct * 100)}%`}</p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5 text-xs">
                {SUGGESTIONS.filter((x) => !ollamaModels.some((m) => m.name === x)).map((x) => (
                  <button key={x} onClick={() => setPull(x)} className="px-2.5 h-6 rounded-full bg-[var(--color-accent-pastel)] text-[var(--color-accent-vibrant)] font-mono font-semibold hover:brightness-95">{x}</button>
                ))}
              </div>
            )}
            {engines.ollama.up && ollamaModels.length === 0 && !pulling && <Empty title="No chat models yet" body="Download one above to start chatting. A 3B model is a good first choice." className="!py-6" />}
            <ul className="space-y-2">
              {ollamaModels.map((m) => (
                <li key={m.name}><Card className="px-4 py-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-[var(--color-accent-pastel)] text-[var(--color-accent-vibrant)] text-xs font-semibold flex items-center justify-center shrink-0">{m.details?.parameter_size ?? '?'}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[var(--color-text-main)] truncate">{m.name}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">{[m.details?.family, m.details?.quantization_level, gb(m.size)].filter(Boolean).join(' · ')}</p>
                  </div>
                  <Btn size="sm" variant="danger" icon={<Trash2 className="w-3 h-3" />} onClick={async () => { await ollamaClient.deleteModel(m.name).catch((e) => setErr(e.message)); await loadOllama(); }}>Delete</Btn>
                </Card></li>
              ))}
            </ul>
          </>
        )}
      </Section>

      <Section title="Voice models" hint="Speech synthesis and transcription models, managed by Voicebox.">
        {engines.voicebox.up === false ? <Offline name="Voicebox" /> : vbModels.length === 0 ? <Spinner className="w-4 h-4 text-[var(--color-accent-vibrant)]" /> : (
          <ul className="space-y-2">
            {vbModels.map((m) => {
              const t = tasks.find((d) => d.model_name === m.model_name);
              return (
                <li key={m.model_name}><Card className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[var(--color-text-main)] truncate">{m.display_name}</p>
                    <p className="text-xs text-[var(--color-text-muted)] tabular-nums">
                      {m.size_mb ? `${(m.size_mb / 1024).toFixed(1)} GB` : 'Size unknown'}
                      {m.downloaded && !m.downloading && ' · Downloaded'}{m.loaded && ' · In memory'}
                      {m.downloading && ` · Downloading${t?.progress != null ? ` ${Math.round(t.progress)}%` : '…'}`}
                    </p>
                    {m.downloading && <div className="mt-1.5 h-1 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden"><div className="h-full bg-[var(--color-accent-vibrant)] transition-[width]" style={{ width: `${t?.progress ?? 8}%` }} /></div>}
                  </div>
                  {m.downloading ? <Spinner className="w-4 h-4 text-[var(--color-accent-vibrant)]" /> : !m.downloaded ? (
                    <Btn size="sm" variant="primary" icon={<Download className="w-3 h-3" />} onClick={() => vbAction(() => voicebox.downloadModel(m.model_name))}>Download</Btn>
                  ) : (
                    <div className="flex gap-1.5">
                      {m.loaded
                        ? <Btn size="sm" variant="secondary" onClick={() => vbAction(() => voicebox.unloadModel(m.model_name))}>Unload</Btn>
                        : <Btn size="sm" variant="secondary" onClick={() => vbAction(() => voicebox.loadModel(m.model_name))}>Load</Btn>}
                      <Btn size="sm" variant="danger" icon={<Trash2 className="w-3 h-3" />} onClick={() => vbAction(() => voicebox.deleteModel(m.model_name))}>Delete</Btn>
                    </div>
                  )}
                </Card></li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Image checkpoints" hint="Stored in ComfyUI's models/checkpoints folder. Add files there and they appear here.">
        {engines.comfyui.up === false ? <Offline name="ComfyUI" /> : checkpoints.length === 0 ? (
          <Empty title="No checkpoints found" body="Put a Stable Diffusion or FLUX checkpoint file in ComfyUI's models/checkpoints folder, then restart ComfyUI." className="!py-6" />
        ) : (
          <ul className="space-y-2">{checkpoints.map((c) => (
            <li key={c}><Card className="px-4 py-3 text-xs font-semibold text-[var(--color-text-main)] truncate">{c}</Card></li>
          ))}</ul>
        )}
      </Section>
    </div>
  );
};

// ── Storage ────────────────────────────────────────────────────────────────

const StorageTab: React.FC = () => {
  const [paths, setPaths] = useState<AppPaths | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { appPaths().then((p) => setPaths(p ?? null)); }, []);

  if (paths === undefined) return <Spinner className="w-4 h-4 text-[var(--color-accent-vibrant)]" />;
  if (paths === null) return <Banner tone="info">Storage details are available in the Lotus desktop app.</Banner>;

  const rows: [string, string][] = [
    ['Chats, settings and the island', paths.portable ? `${paths.dataDir}\\webview` : "Lotus's app profile in your user folder"],
    ['Voices, history and stories (Voicebox)', `${paths.dataDir}\\voicebox`],
    ['Chat models (Ollama)', "Ollama's own model folder"],
    ['Image checkpoints (ComfyUI)', "ComfyUI's models folder"],
  ];
  return (
    <div className="space-y-5 max-w-3xl">
      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-[var(--color-accent-vibrant)]" />
          <h3 className="text-sm font-semibold text-[var(--color-text-main)]">{paths.portable ? 'Portable mode' : 'Installed mode'}</h3>
        </div>
        <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
          {paths.portable
            ? 'Lotus keeps its data next to the program, so you can move the whole folder or run it from a USB drive.'
            : 'Lotus keeps its data in your user profile. To make it portable, use the portable download, or reinstall and tick "Portable data".'}
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs bg-black/[.04] dark:bg-white/5 rounded-lg px-3 py-2 truncate">{paths.dataDir}</code>
          <Btn variant="secondary" icon={<FolderOpen className="w-3.5 h-3.5" />}
            onClick={async () => { setErr(null); try { await revealPath(paths.dataDir); } catch { setErr('That folder does not exist yet. It is created the first time Voicebox starts.'); } }}>Show</Btn>
        </div>
        {err && <Banner tone="warn">{err}</Banner>}
      </Card>
      <Card className="divide-y divide-[#EBECEF] dark:divide-[#2C2F38]">
        {rows.map(([k, v]) => (
          <div key={k} className="px-5 py-3 grid grid-cols-[1fr_1.4fr] gap-4 text-xs">
            <span className="font-semibold text-[var(--color-text-main)]">{k}</span>
            <span className="text-[var(--color-text-muted)] break-all">{v}</span>
          </div>
        ))}
      </Card>
      <Label>Models are large, so Ollama and ComfyUI keep them in their own folders and Lotus does not copy them.</Label>
    </div>
  );
};
