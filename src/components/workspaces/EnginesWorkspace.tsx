import React, { useEffect, useState } from 'react';
import {
  Play, Square, FolderSearch, ExternalLink, Check, Circle, FolderOpen, Cpu, HardDrive, Globe, RefreshCw,
} from 'lucide-react';
import { useEngines, Policy } from '../../hooks/useEngines';
import { EngineId, engineUrl, setEngineUrl, DEFAULT_URLS, isRemote, engineToken, setEngineToken, normalizeEngineUrl, LISTEN_HINT } from '../../services/engineConfig';
import { browseForExe, appPaths, AppPaths, testEngine, EngineTest } from '../../services/engineControl';
import { ModelsWorkspace } from './ModelsWorkspace';
import { EnginesRow } from '../models/ModelLibrary';
import { hasLiveSettings, liveSettings } from '../../lib/liveSettings';
import { browseModelsDir, findModelsDir, folderPath, savedModelsDir } from '../../services/downloadService';
import { openExternal, revealPath } from '../../lib/open';
import { Btn, Card, TextInput, Banner, Spinner, Label, cx } from '../common/ui';
import { kv } from '../../lib/store';

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
  const settings = hasLiveSettings() ? liveSettings() : null;

  // One sidebar for the whole page (T71, Filipe): Get Models, Image Setups, Arena, Engines, Storage.
  // No toolbar strip above it, like Chat, Images and Voice.
  return (
    <ModelsWorkspace engines={eng.engines} onOpenEngines={() => setTab('engines')} page={{
      section: tab === 'models' ? 'models' : tab, go: setTab,
      other: (
        <div className="flex-1 min-h-0 overflow-y-auto p-6">
          {tab === 'engines' && settings && <div className="mb-8 max-w-6xl"><EnginesRow kind="all" settings={settings} /></div>}
          <p className="text-[13px] text-[var(--color-text-muted)] mb-4">{tab === 'engines' ? 'Outside engines Lotus can use instead (Settings → Engines picks which). They run on this computer, or on another one on your network (use Change).' : 'Where Lotus keeps its files.'}</p>
          {tab === 'engines' && <EnginesTab eng={eng} goModels={() => setTab('models')} />}
          {tab === 'storage' && <StorageTab />}
        </div>
      ),
    }} />
  );
};

// ── Engines ────────────────────────────────────────────────────────────────

const EnginesTab: React.FC<{ eng: Eng; goModels: () => void }> = ({ eng, goModels }) => {
  const [dismissed, setDismissed] = useState(() => kv.getItem('lotus.setup.dismissed') === '1');
  const { engines, gpu } = eng;
  const allOwn = hasLiveSettings() && liveSettings().llmBackend === 'builtin' && liveSettings().imageEngine === 'builtin' && liveSettings().voiceEngine === 'builtin';
  const showSetup = !dismissed && !allOwn && (engines.ollama.up === false || engines.voicebox.up === false);

  return (
    <div className="space-y-5 max-w-6xl">
      {showSetup && (
        <Card className="p-5 border-[var(--color-accent-pastel-border)] bg-[var(--color-accent-pastel)]/40">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-text-main)]">Get set up</h3>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Lotus works with three engines, on this computer or another one. Chat and voice are the quickest to start with.</p>
            </div>
            <Btn size="sm" variant="ghost" onClick={() => { kv.setItem('lotus.setup.dismissed', '1'); setDismissed(true); }}>Dismiss</Btn>
          </div>
          <ul className="mt-4 space-y-2">
            {(['ollama', 'voicebox', 'comfyui'] as EngineId[]).map((id) => (
              <li key={id} className="flex items-center gap-3 text-xs">
                {engines[id].up ? <Check className="w-4 h-4 text-[var(--c-green)] shrink-0" /> : <Circle className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" />}
                <span className="font-semibold text-[var(--color-text-main)] w-20">{META[id].name}</span>
                <span className="text-[var(--color-text-muted)] flex-1">
                  {engines[id].up ? 'Running' : id === 'comfyui' ? 'Optional, for images' : 'Not running'}
                </span>
                {engines[id].up && id !== 'comfyui' && <Btn size="sm" variant="secondary" onClick={goModels}>Get Models</Btn>}
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
  const remote = isRemote(id);
  const busy = s.phase !== null;
  const host = engineUrl(id).replace(/^https?:\/\//, '');
  const status = s.phase === 'starting' ? 'Starting…' : s.phase === 'stopping' ? 'Stopping…' : s.up === null ? 'Checking…'
    : remote ? (s.up ? 'Connected' : "Can't reach it") : s.up ? 'Running' : 'Not running';

  return (
    <Card className="p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cx('w-2 h-2 rounded-full', s.up ? 'bg-[var(--c-green)]' : s.up === null || busy ? 'bg-[var(--c-orange)] animate-pulse' : 'bg-[var(--color-text-muted)] opacity-60')} aria-hidden="true" />
            <h3 className="text-sm font-semibold text-[var(--color-text-main)]">{m.name}</h3>
            {s.version && <span className="text-xs font-mono text-[var(--color-text-muted)]">{s.version}</span>}
          </div>
          <p className="text-xs text-[var(--color-text-muted)] mt-1" role="status">{status}{remote && <> · on another computer</>}</p>
        </div>
        {remote ? (
          !s.up && <Btn size="sm" variant="secondary" icon={<RefreshCw className="w-3 h-3" />} onClick={() => void eng.refresh()}>Try Again</Btn>
        ) : s.up ? (
          <Btn size="sm" variant="secondary" loading={s.phase === 'stopping'} disabled={!s.supervised || busy} icon={<Square className="w-3 h-3" fill="currentColor" />}
            title={s.supervised ? undefined : 'Started outside Lotus. Close it where you launched it.'} onClick={() => eng.stop(id)}>Stop</Btn>
        ) : (
          <Btn size="sm" variant="primary" loading={s.phase === 'starting'} disabled={busy} icon={<Play className="w-3 h-3" fill="currentColor" />} onClick={() => eng.start(id)}>Start</Btn>
        )}
      </div>

      <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">{m.blurb}</p>

      {s.needsExe && !remote && (
        <Banner tone="warn" action={<Btn size="sm" variant="secondary" icon={<FolderSearch className="w-3 h-3" />} onClick={async () => { if (await browseForExe(id)) void eng.start(id); }}>Browse…</Btn>}>
          {id === 'voicebox' ? <>Locate <code>voicebox-server.exe</code> (inside Voicebox's install folder).</>
            : id === 'comfyui' ? <>Locate the file you use to launch ComfyUI (a <code>.bat</code> or <code>.exe</code>).</>
            : <>Locate <code>ollama.exe</code>.</>}
        </Banner>
      )}
      {s.error && <Banner tone="error">{s.error}</Banner>}
      {/* 0.20: an optional engine that isn't running is not an error, so its note is plain text, not a yellow warning. */}
      {!s.up && !busy && !s.error && !s.needsExe && s.detail && <p className="text-[12px] leading-snug text-[var(--color-text-muted)]">{s.detail}</p>}

      <div className="mt-auto pt-3 border-t border-[var(--color-border-subtle)] space-y-3">
        {!remote && (
          <label className="flex items-center gap-2 text-xs text-[var(--color-text-main)] dark:text-slate-200">
            <input type="checkbox" className="accent-[var(--color-accent-vibrant)]" checked={s.policy === 'on_launch'}
              onChange={(e) => eng.setPolicy(id, (e.target.checked ? 'on_launch' : 'manual') as Policy)} />
            Start with Lotus
          </label>
        )}
        {editUrl ? (
          <AddressEditor id={id} onDone={() => { setEditUrl(false); void eng.refresh(); }} />
        ) : (
          <div className="flex items-center gap-2 text-xs">
            {remote ? <Globe className="w-3.5 h-3.5 shrink-0 text-[var(--color-text-muted)]" aria-label="Another computer" /> : null}
            <span className="font-mono text-[var(--color-text-muted)] flex-1 truncate" title={engineUrl(id)}>{host}</span>
            <button className="font-semibold text-[var(--color-accent-vibrant)] hover:underline" onClick={() => setEditUrl(true)}>Change</button>
            {!s.up && !remote && <button className="font-semibold text-[var(--color-accent-vibrant)] hover:underline inline-flex items-center gap-1" onClick={() => openExternal(m.install)}>{m.installLabel}<ExternalLink className="w-3 h-3" /></button>}
            {!s.up && !remote && <button className="font-semibold text-[var(--color-text-muted)] hover:underline" onClick={async () => { if (await browseForExe(id)) void eng.start(id); }}>Locate…</button>}
          </div>
        )}
      </div>
    </Card>
  );
};

/** Address + optional access key, with a real connection test before saving (session 11). */
const AddressEditor: React.FC<{ id: EngineId; onDone: () => void }> = ({ id, onDone }) => {
  const name = META[id].name;
  const [url, setUrl] = useState(engineUrl(id));
  const [token, setToken] = useState(engineToken(id));
  const [test, setTest] = useState<EngineTest | null>(null);
  const [testing, setTesting] = useState(false);
  const valid = normalizeEngineUrl(id, url) !== null;
  const run = async () => { setTesting(true); setTest(null); setTest(await testEngine(id, url, token)); setTesting(false); };
  const save = () => { setEngineUrl(id, url); setEngineToken(id, token); onDone(); };
  const useLocal = () => { setEngineUrl(id, DEFAULT_URLS[id]); setEngineToken(id, ''); onDone(); };
  return (
    <div className="space-y-2 text-xs">
      <label className="block">
        <span className="block mb-1 font-medium text-[var(--color-text-muted)]">Address</span>
        <TextInput value={url} onChange={(e) => { setUrl(e.target.value); setTest(null); }} className="w-full !h-7 !text-xs font-mono"
          placeholder={`192.168.1.20:${new URL(DEFAULT_URLS[id]).port}`} aria-label={`${name} address`} spellCheck={false} autoCapitalize="off" />
      </label>
      <label className="block">
        <span className="block mb-1 font-medium text-[var(--color-text-muted)]">Access key <span className="font-normal">(optional, only if a proxy in front of {name} asks for one)</span></span>
        <TextInput type="password" value={token} onChange={(e) => { setToken(e.target.value); setTest(null); }} className="w-full !h-7 !text-xs font-mono"
          placeholder="token, or user:password" aria-label={`${name} access key`} autoComplete="off" />
      </label>
      <p className="text-[var(--color-text-muted)] leading-relaxed">To use {name} on another computer, type its address (for example its IP and port). {LISTEN_HINT[id]}</p>
      {!valid && <p className="text-[var(--c-red)]">That is not a web address.</p>}
      {test && <p role="status" className={test.ok ? 'text-[var(--c-green)]' : 'text-[var(--c-red)]'}>{test.message}</p>}
      <div className="flex items-center gap-2 pt-1">
        <Btn size="sm" variant="secondary" loading={testing} disabled={!valid} onClick={() => void run()}>Test</Btn>
        <Btn size="sm" variant="primary" disabled={!valid} onClick={save}>Save</Btn>
        <Btn size="sm" variant="ghost" onClick={onDone}>Cancel</Btn>
        <span className="flex-1" />
        <button className="font-semibold text-[var(--color-text-muted)] hover:underline" onClick={useLocal}>Use this computer</button>
      </div>
    </div>
  );
};

// ── Storage ────────────────────────────────────────────────────────────────

const StorageTab: React.FC = () => {
  const [paths, setPaths] = useState<AppPaths | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [modelsDir, setModelsDir] = useState(savedModelsDir());
  useEffect(() => { appPaths().then((p) => setPaths(p ?? null)); }, []);
  useEffect(() => { if (!modelsDir) void findModelsDir().then((d) => d && setModelsDir(d)); }, [modelsDir]);

  if (paths === undefined) return <Spinner className="w-4 h-4 text-[var(--color-accent-vibrant)]" />;
  if (paths === null) return <Banner tone="info">Storage details are available in the Lotus desktop app.</Banner>;

  const sep = paths.dataDir.includes('\\') ? '\\' : '/';
  const rows: [string, string][] = [
    ['Chats, settings, tasks and memory', `${paths.dataDir}${sep}lotus.db`],
    ['Models Lotus downloads (chat, images, voice)', paths.studioDir ? `${paths.studioDir}${sep}Models` : 'Lotus Studio/Models'],
    ['Generated images', paths.studioDir ? `${paths.studioDir}${sep}Images` : 'Lotus Studio/Images'],
    ['Voices, history and stories (Voicebox)', `${paths.dataDir}${sep}voicebox`],
    ['Chat models (Ollama)', "Ollama's own model folder"],
    ['Image checkpoints and LoRAs (ComfyUI)', modelsDir ? `${folderPath(modelsDir, 'checkpoints')}  ·  ${folderPath(modelsDir, 'loras')}` : "ComfyUI's models folder (not set yet)"],
    ['Work artifacts', paths.studioDir ? `${paths.studioDir}${sep}Work` : 'Lotus Studio/Work'],
  ];
  return (
    <div className="space-y-5 w-full max-w-4xl mx-auto">
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
          <code className="flex-1 text-xs bg-black/[.04] dark:bg-white/5 rounded-[6px] px-3 py-2 truncate">{paths.dataDir}</code>
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
      <Card className="p-5 space-y-3">
        <h3 className="text-sm font-semibold text-[var(--color-text-main)]">ComfyUI models folder</h3>
        <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">Where downloaded checkpoints and LoRAs are saved: the folder that contains <span className="font-mono">checkpoints</span> and <span className="font-mono">loras</span>.</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs bg-black/[.04] dark:bg-white/5 rounded-[6px] px-3 py-2 truncate">{modelsDir || 'Not set'}</code>
          <Btn variant="secondary" onClick={async () => { const d = await browseModelsDir(); if (d) setModelsDir(d); }}>{modelsDir ? 'Change…' : 'Choose…'}</Btn>
        </div>
      </Card>
      <Label>Models are large, so Ollama and ComfyUI keep them in their own folders and Lotus does not copy them.</Label>
    </div>
  );
};
