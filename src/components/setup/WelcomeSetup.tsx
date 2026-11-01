import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import lotusPetals from '../../assets/lotus-petals.png';
import { Btn, Progress, cx } from '../common/ui';
import { Toggle } from '../common/Toggle';
import { invokeNative, onEvent } from '../../lib/bus';
import { http, isTauri, timeoutSignal } from '../../lib/http';
import { openExternal } from '../../lib/open';
import { desktopOs } from '../../lib/glass';
import { EngineId, engineUrl, setEngineUrl, setEngineToken, engineToken, isRemote, DEFAULT_URLS, LISTEN_HINT, normalizeEngineUrl } from '../../services/engineConfig';
import { setSavedExe, testEngine, EngineTest } from '../../services/engineControl';
import { browseModelsDir, findModelsDir } from '../../services/downloadService';
import type { useEngines } from '../../hooks/useEngines';
import type { ColorPalette } from '../../types/lotus';
import {
  Arch, CHAT_PICKS, COMFY_DESKTOP_URL, DICTATION_PICK, DesktopOs, ENGINES, ENGINE_ORDER, IMAGE_PICKS, Pick, TIERS, Tier,
  VOICEBOX_MANIFEST, VOICE_PICKS, afterOpenHint, fitFor, installerFor, isComfyDesktopPath, selectionGb, suggestedTier,
  ChatPick, ImagePick, VoicePick,
} from '../../setup/catalog';
import { SetupState, StepId, enginesToInstall, initialEngines, modelScreenEngines, saveSetup, visibleSteps } from '../../setup/state';
import { Job, fetchImages, fetchVoices, pullChat, useSetupJobs } from '../../setup/jobs';

/*
 * First-run guide (session 10, second design). A blank Lotus window: the OS material (acrylic on
 * Windows, vibrancy on macOS, a plain surface on Linux) runs edge to edge, title bar included, and
 * one quiet column of content sits on it. One question per screen. Skip on the left, Back and
 * Continue on the right, always in the same place. Every status comes from a real check.
 */

type Eng = ReturnType<typeof useEngines>;

interface SetupInfo {
  studioDir: string;
  defaultStudioDir: string;
  os: string;
  arch: string;
  installer: Partial<Record<EngineId, boolean>> | null;
  found: Partial<Record<EngineId, string | null>>;
}

/** The accent follows the petal of what the screen is about; general screens use the first petal. */
const STEP_PALETTE: Record<StepId, ColorPalette> = {
  welcome: 'blue', folder: 'blue', engines: 'blue', install: 'blue', chat: 'blue', images: 'red', voice: 'amber', done: 'green',
};
type ModelStep = 'chat' | 'images' | 'voice';
const PICKS: Record<ModelStep, Pick[]> = { chat: CHAT_PICKS, images: IMAGE_PICKS, voice: VOICE_PICKS };
const ENGINE_OF: Record<ModelStep, EngineId> = { chat: 'ollama', images: 'comfyui', voice: 'voicebox' };

const sepOf = (p: string) => (p.includes('\\') ? '\\' : '/');
const join = (a: string, b: string) => `${a.replace(/[\\/]+$/, '')}${sepOf(a)}${b}`;
const baseName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p;
function normOs(os: string): DesktopOs { return os === 'macos' || os === 'linux' || os === 'windows' ? os : desktopOs(); }
function normArch(a: string): Arch { return a === 'aarch64' || a === 'arm64' ? 'aarch64' : 'x86_64'; }
const errText = (e: unknown) => (typeof e === 'string' ? e : (e as Error).message);

type InstallPhase =
  | { kind: 'idle' } | { kind: 'resolving' } | { kind: 'downloading'; progress?: number; detail?: string }
  | { kind: 'opened'; hint: string } | { kind: 'ready'; path: string } | { kind: 'manual'; reason: string } | { kind: 'error'; message: string };

export interface WelcomeSetupProps {
  eng: Eng;
  onClose: (s: SetupState) => void;
  onAccent: (p: ColorPalette) => void;
}

export const WelcomeSetup: React.FC<WelcomeSetupProps> = ({ eng, onClose, onAccent }) => {
  const [info, setInfo] = useState<SetupInfo | null>(null);
  const [studioDir, setStudioDir] = useState('');
  const [want, setWant] = useState<Record<EngineId, boolean>>({ ollama: true, comfyui: false, voicebox: false });
  const [stepId, setStepId] = useState<StepId>('welcome');
  const [error, setError] = useState<string | null>(null);
  const [hw, setHw] = useState<{ done: boolean; gb?: number; unified: boolean; name?: string }>({ done: false, unified: false });
  const [phase, setPhase] = useState<Record<EngineId, InstallPhase>>({ ollama: { kind: 'idle' }, comfyui: { kind: 'idle' }, voicebox: { kind: 'idle' } });
  /** One model per engine (null = none for now), plus dictation. */
  const [tier, setTier] = useState<Record<EngineId, Tier | null>>({ ollama: null, comfyui: null, voicebox: null });
  const [dictation, setDictation] = useState(true);
  const [modelsDir, setModelsDir] = useState('');
  const [busy, setBusy] = useState(false);
  /** Engines used from another computer: open = the address form is showing; connected = a test passed and it is saved. */
  const [remote, setRemote] = useState<Record<EngineId, RemoteForm>>(() => ({
    ollama: remoteFormFor('ollama'), comfyui: remoteFormFor('comfyui'), voicebox: remoteFormFor('voicebox'),
  }));
  const remoteOn: Partial<Record<EngineId, boolean>> = { ollama: remote.ollama.connected, comfyui: remote.comfyui.connected, voicebox: remote.voicebox.connected };
  const os = normOs(info?.os ?? desktopOs());
  const arch = normArch(info?.arch ?? 'x86_64');
  const machine = os === 'macos' ? 'Mac' : 'computer';

  // ── What this machine has ──────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    void (async () => {
      const i = await invokeNative<SetupInfo>('setup_info').catch(() => undefined);
      const docs = '~/Documents/Lotus Studio';
      const got = i ?? { studioDir: docs, defaultStudioDir: docs, os: desktopOs(), arch: 'x86_64', installer: null, found: {} };
      if (!alive) return;
      setInfo(got);
      setStudioDir(got.studioDir);
      const w = initialEngines(got.installer, got.found);
      ENGINE_ORDER.forEach((id) => { if (isRemote(id)) w[id] = true; });
      setWant(w);
    })();
    void (async () => {
      const s = await invokeNative<{ gpus: { name: string; totalMb: number }[]; ramTotalMb: number }>('hw_snapshot').catch(() => undefined);
      if (!alive) return;
      const g = s?.gpus[0];
      if (g && g.totalMb > 0) setHw({ done: true, gb: g.totalMb / 1024, unified: false, name: g.name });
      else if (s && desktopOs() === 'macos' && s.ramTotalMb > 0) setHw({ done: true, gb: s.ramTotalMb / 1024, unified: true });
      else setHw({ done: true, unified: false });
    })();
    void findModelsDir().then((d) => alive && d && setModelsDir(d));
    return () => { alive = false; };
  }, []);

  // Pre-pick the best tier that fits, once the hardware is known.
  const picked = useRef(false);
  useEffect(() => {
    if (picked.current || !hw.done) return;
    picked.current = true;
    const t = (list: Pick[]) => suggestedTier(list, hw.gb, hw.unified);
    setTier({ ollama: t(CHAT_PICKS), comfyui: t(IMAGE_PICKS), voicebox: t(VOICE_PICKS) });
  }, [hw]);

  const found = info?.found ?? {};
  const haveEngine = (id: EngineId) => !!found[id] || phase[id].kind === 'ready' || eng.engines[id].up === true;
  const toInstall = enginesToInstall(want, found, remoteOn);
  const modelEngines = modelScreenEngines(want, (id) => haveEngine(id) || !!remoteOn[id], remoteOn);
  const steps = visibleSteps(toInstall.length > 0 || ENGINE_ORDER.some((id) => phase[id].kind !== 'idle'), modelEngines);
  const idx = Math.max(0, steps.indexOf(stepId));
  useEffect(() => { onAccent(STEP_PALETTE[stepId]); }, [stepId, onAccent]);

  // ── Installing engines ─────────────────────────────────────────────────
  const setP = useCallback((id: EngineId, p: InstallPhase) => setPhase((s) => ({ ...s, [id]: p })), []);

  const markReady = useCallback((id: EngineId, path: string) => {
    setP(id, { kind: 'ready', path });
    setInfo((i) => (i ? { ...i, found: { ...i.found, [id]: path } } : i));
    if (id !== 'ollama' || /[\\/]Lotus Studio[\\/]Engines[\\/]/i.test(path)) setSavedExe(id, path);
    // ComfyUI Desktop serves on :8000; keep an address the user set themselves.
    if (id === 'comfyui' && isComfyDesktopPath(path) && engineUrl('comfyui') === DEFAULT_URLS.comfyui) setEngineUrl('comfyui', COMFY_DESKTOP_URL);
  }, [setP]);

  const installOne = useCallback(async (id: EngineId) => {
    if (!isTauri) { setP(id, { kind: 'manual', reason: 'Installing engines needs the Lotus desktop app.' }); return; }
    setP(id, { kind: 'resolving' });
    let version: string | undefined;
    if (id === 'voicebox' && os !== 'linux') {
      try {
        const r = await http(VOICEBOX_MANIFEST, { signal: timeoutSignal(15000) });
        version = (await r.json() as { version?: string }).version;
      } catch {
        setP(id, { kind: 'error', message: 'Could not reach GitHub to find the latest Voicebox. Check your connection and try again.' });
        return;
      }
    }
    const file = installerFor(id, os, arch, version);
    if (!file) { setP(id, { kind: 'manual', reason: ENGINES[id].note[os] ?? `There is no ${ENGINES[id].name} download Lotus can fetch for this ${machine}.` }); return; }
    setP(id, { kind: 'downloading', progress: 0 });
    const dlId = `engine-${id}`;
    const off = await onEvent<{ id: string; received: number; total: number | null; done: boolean }>('download:progress', (p) => {
      if (p.id === dlId && !p.done) setP(id, { kind: 'downloading', progress: p.total ? p.received / p.total : undefined, detail: `${Math.round(p.received / 1024 ** 2)}${p.total ? ` of ${Math.round(p.total / 1024 ** 2)}` : ''} MB` });
    });
    let path: string | undefined;
    try { path = await invokeNative<string>('installer_download', { id: dlId, url: file.url, fileName: file.fileName }); }
    catch (e) { off(); setP(id, { kind: 'error', message: errText(e) }); return; }
    off();
    try {
      const opened = await invokeNative<{ kind: 'opened' | 'ready'; path: string | null }>('installer_open', { path });
      if (opened?.kind === 'ready' && opened.path) markReady(id, opened.path);
      else setP(id, { kind: 'opened', hint: afterOpenHint(id, os) });
    } catch (e) { setP(id, { kind: 'error', message: errText(e) }); }
  }, [arch, os, machine, setP, markReady]);

  // While a vendor installer is open, look for the engine every 3 s.
  const waiting = ENGINE_ORDER.filter((id) => phase[id].kind === 'opened');
  useEffect(() => {
    if (!waiting.length) return;
    const t = setInterval(async () => {
      for (const id of waiting) {
        const p = await invokeNative<string | null>('engine_detect', { name: id }).catch(() => null);
        if (p) markReady(id, p);
      }
    }, 3000);
    return () => clearInterval(t);
  }, [waiting.join(','), markReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Installers open one after another when the Install screen appears.
  const started = useRef(false);
  useEffect(() => {
    if (stepId !== 'install' || started.current) return;
    started.current = true;
    void (async () => { for (const id of toInstall) await installOne(id); })();
  }, [stepId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Choices → downloads ────────────────────────────────────────────────
  const chosen: Pick[] = modelEngines.flatMap((id) => {
    const list = id === 'ollama' ? CHAT_PICKS : id === 'comfyui' ? IMAGE_PICKS : VOICE_PICKS;
    const p = list.find((x) => x.tier === tier[id]);
    return [...(p ? [p] : []), ...(id === 'voicebox' && dictation ? [DICTATION_PICK] : [])];
  });

  const startDownloads = () => {
    const chats = chosen.filter((p): p is ChatPick => p.kind === 'chat');
    const imgs = chosen.filter((p): p is ImagePick => p.kind === 'image');
    const voices = chosen.filter((p): p is VoicePick => p.kind === 'voice');
    // An engine on another computer is never started from here; its downloads go through its own API.
    const ensure = async (id: EngineId) => { if (!eng.engines[id].up && !isRemote(id)) await eng.start(id); };
    if (chats.length) void ensure('ollama').then(async () => { for (const c of chats) await pullChat(c); });
    if (imgs.length && modelsDir) void fetchImages(imgs, modelsDir);
    if (voices.length) void ensure('voicebox').then(() => fetchVoices(voices));
  };

  // ── Navigation ─────────────────────────────────────────────────────────
  const finish = (outcome: 'finished' | 'skipped') => {
    const s: SetupState = { done: true, outcome, studioDir, engines: want, remote: remoteOn, at: Date.now() };
    saveSetup(s);
    onClose(s);
  };

  const next = async () => {
    setError(null);
    if (stepId === 'folder' && isTauri) {
      setBusy(true);
      try { const d = await invokeNative<string>('setup_prepare', { dir: studioDir }); if (d) setStudioDir(d); }
      catch (e) { setError(errText(e)); setBusy(false); return; }
      setBusy(false);
    }
    const after = steps[idx + 1];
    // Leaving the last model screen starts the downloads (they keep going after the guide closes).
    if (after === 'done' && (stepId === 'chat' || stepId === 'images' || stepId === 'voice') && chosen.length) startDownloads();
    if (stepId === 'done') { finish('finished'); return; }
    if (after) setStepId(after);
  };
  const back = () => { const p = steps[idx - 1]; if (p) setStepId(p); };

  const installing = ENGINE_ORDER.some((id) => ['resolving', 'downloading', 'opened'].includes(phase[id].kind));
  const nextLabel = stepId === 'welcome' ? 'Get started' : stepId === 'done' ? 'Open Lotus' : stepId === 'install' && installing ? 'Continue for now' : 'Continue';
  const blocked = stepId === 'images' && tier.comfyui !== null && !modelsDir;

  // Enter continues (outside buttons and fields).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.defaultPrevented || blocked) return;
      if ((e.target as HTMLElement).closest('input, textarea, button, a, [role="switch"], [role="radio"]')) return;
      e.preventDefault(); void next();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
  const headRef = useRef<HTMLDivElement>(null);
  useEffect(() => { headRef.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true }); }, [stepId]);

  const modelStep: ModelStep | null = stepId === 'chat' || stepId === 'images' || stepId === 'voice' ? stepId : null;

  return (
    <div className="setup-stage absolute inset-0 flex flex-col pt-10" data-step={stepId}>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div ref={headRef} key={stepId} className="setup-body mx-auto w-full max-w-[560px] px-8 pt-[11vh] pb-10">
          {stepId === 'welcome' && (
            <Screen
              lead={<img src={lotusPetals} alt="" className="w-14 h-14 object-contain mb-8" />}
              title="Welcome to Lotus"
              body={`Chat, images and voice, running on your own ${machine}. Let's set up the engines and pick a few models. It takes a couple of minutes.`}
            />
          )}

          {stepId === 'folder' && (
            <Screen title="Where should Lotus keep its files?" body="Engines, projects and exports go in one folder, so they are easy to find and back up.">
              <div className="setup-row">
                <span className="flex-1 min-w-0 text-[14px] truncate" title={studioDir}>{studioDir || '…'}</span>
                <LinkBtn onClick={() => void chooseFolder(setStudioDir)} disabled={!isTauri}>Change</LinkBtn>
              </div>
              {info && studioDir !== info.defaultStudioDir && <LinkBtn className="mt-3" onClick={() => setStudioDir(info.defaultStudioDir)}>Use Documents instead</LinkBtn>}
            </Screen>
          )}

          {stepId === 'engines' && (
            <Screen title="Which engines do you want?" body="Lotus is the studio; these free engines do the work. Install them here, or use ones already running on another computer. You can change this later.">
              <div className="setup-list">
                {ENGINE_ORDER.map((id) => {
                  const e = ENGINES[id];
                  const r = remote[id];
                  const status = r.connected ? `On another computer · ${r.url.replace(/^https?:\/\//, '')}` : found[id] ? `Installed on this ${machine}` : e.note[os] ?? `${e.licence} licence`;
                  return (
                    <div key={id} className="setup-row !block">
                      <div className="flex items-center gap-[14px]">
                        <span className="flex-1 min-w-0">
                          <span className="block text-[14px] font-semibold">{e.name} <span className="font-normal text-[var(--color-text-muted)]">· {e.role}</span></span>
                          <span className={cx('block mt-0.5 text-[12px]', r.connected ? 'text-[var(--c-green)]' : 'text-[var(--color-text-muted)]')}>{status}</span>
                        </span>
                        <Toggle checked={want[id]} onChange={(v) => setWant((w) => ({ ...w, [id]: v }))} ariaLabel={`Use ${e.name}`} />
                      </div>
                      {want[id] && !r.open && (
                        <LinkBtn className="mt-1.5 !text-[12px] underline underline-offset-2" onClick={() => setRemote((m) => ({ ...m, [id]: { ...m[id], open: true } }))}>
                          {r.connected ? 'Change address' : 'Use one on another computer'}
                        </LinkBtn>
                      )}
                      {want[id] && r.open && (
                        <RemoteFormView id={id} form={r} onChange={(f) => setRemote((m) => ({ ...m, [id]: f }))} onConnected={() => void eng.refresh()} />
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="mt-5 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
                Each engine's own installer opens so you can read its terms:{' '}
                {ENGINE_ORDER.map((id, i) => (
                  <React.Fragment key={id}>{i > 0 && ', '}<button type="button" className="underline underline-offset-2 hover:text-[var(--color-text-main)]" onClick={() => void openExternal(ENGINES[id].terms)}>{ENGINES[id].name}</button></React.Fragment>
                ))}.
              </p>
            </Screen>
          )}

          {stepId === 'install' && (
            <Screen title="Installing" body="Each installer opens in turn. Lotus notices when one has finished, and you can carry on meanwhile.">
              <div className="setup-list">
                {ENGINE_ORDER.filter((id) => want[id] && (toInstall.includes(id) || phase[id].kind !== 'idle')).map((id) => {
                  const p = phase[id];
                  return (
                    <div key={id} className="setup-row !block">
                      <div className="flex items-baseline gap-4">
                        <span className="flex-1 text-[14px] font-semibold">{ENGINES[id].name}</span>
                        {p.kind === 'error' && <LinkBtn onClick={() => void installOne(id)}>Try again</LinkBtn>}
                        {(p.kind === 'error' || p.kind === 'manual') && <LinkBtn onClick={() => void openExternal(ENGINES[id].downloadPage)}>Download page <ExternalLink className="inline w-3 h-3" aria-hidden="true" /></LinkBtn>}
                      </div>
                      <p className={cx('mt-0.5 text-[12px] leading-snug', p.kind === 'error' ? 'text-[var(--c-red)]' : p.kind === 'ready' ? 'text-[var(--c-green)]' : 'text-[var(--color-text-muted)]')} aria-live="polite">{phaseText(p)}</p>
                      {(p.kind === 'downloading' || p.kind === 'resolving') && <Progress className="mt-2.5" value={p.kind === 'downloading' ? p.progress ?? null : null} label={`Downloading ${ENGINES[id].name}`} />}
                    </div>
                  );
                })}
              </div>
            </Screen>
          )}

          {modelStep && (
            <ModelScreen step={modelStep} hw={hw} value={tier[ENGINE_OF[modelStep]]} onChange={(t) => setTier((s) => ({ ...s, [ENGINE_OF[modelStep]]: t }))}
              dictation={dictation} onDictation={setDictation} modelsDir={modelsDir} onModelsDir={setModelsDir} />
          )}

          {stepId === 'done' && <DoneScreen os={os} total={selectionGb(chosen)} />}

          {error && <p role="alert" className="mt-4 text-[12px] text-[var(--c-red)]">{error}</p>}
        </div>
      </div>

      <footer className="shrink-0 mx-auto w-full max-w-[560px] px-8 pb-8 pt-3 flex items-center gap-2">
        {stepId !== 'done' ? <LinkBtn onClick={() => finish('skipped')}>Skip setup</LinkBtn> : <span />}
        <div className="flex-1 flex justify-center" aria-hidden="true">
          <span className="flex gap-1">{steps.map((s, i) => <span key={s} className={cx('setup-tick', i < idx && 'is-past', i === idx && 'is-now')} />)}</span>
        </div>
        <span className="sr-only">Step {idx + 1} of {steps.length}</span>
        {idx > 0 && stepId !== 'done' && <Btn variant="ghost" onClick={back}>Back</Btn>}
        <Btn variant="primary" loading={busy} disabled={blocked} onClick={() => void next()} className="min-w-[96px]">{nextLabel}</Btn>
      </footer>
    </div>
  );
};

async function chooseFolder(set: (d: string) => void) {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({ title: 'Choose where Lotus keeps its files', directory: true, multiple: false });
  if (typeof picked === 'string') set(baseName(picked) === 'Lotus Studio' ? picked : join(picked, 'Lotus Studio'));
}

function phaseText(p: InstallPhase): string {
  switch (p.kind) {
    case 'idle': return 'Waiting';
    case 'resolving': return 'Finding the latest version';
    case 'downloading': return `Downloading${p.detail ? ` · ${p.detail}` : ''}`;
    case 'opened': return p.hint;
    case 'ready': return 'Installed';
    case 'manual': return p.reason;
    case 'error': return p.message;
  }
}

// ── Engines on another computer (session 11) ──────────────────────────────────

interface RemoteForm { open: boolean; connected: boolean; url: string; token: string; testing: boolean; result: EngineTest | null }

/** Starts from what is saved, so reopening the guide shows an engine that is already used remotely. */
function remoteFormFor(id: EngineId): RemoteForm {
  const on = isRemote(id);
  return { open: false, connected: on, url: on ? engineUrl(id) : '', token: on ? engineToken(id) : '', testing: false, result: null };
}

const RemoteFormView: React.FC<{ id: EngineId; form: RemoteForm; onChange: (f: RemoteForm) => void; onConnected: () => void }> = ({ id, form, onChange, onConnected }) => {
  const name = ENGINES[id].name;
  const port = new URL(DEFAULT_URLS[id]).port;
  const valid = form.url.trim() !== '' && normalizeEngineUrl(id, form.url) !== null;
  const connect = async () => {
    onChange({ ...form, testing: true, result: null });
    const result = await testEngine(id, form.url, form.token);
    if (result.ok) {
      setEngineUrl(id, form.url);
      setEngineToken(id, form.token);
      onConnected();
    }
    onChange({ ...form, testing: false, result, connected: result.ok, open: !result.ok, url: result.ok ? engineUrl(id) : form.url });
  };
  const useHere = () => {
    setEngineUrl(id, DEFAULT_URLS[id]);
    setEngineToken(id, '');
    onConnected();
    onChange({ open: false, connected: false, url: '', token: '', testing: false, result: null });
  };
  return (
    <div className="mt-3 space-y-2.5">
      <input value={form.url} onChange={(e) => onChange({ ...form, url: e.target.value, result: null })} placeholder={`Address, for example 192.168.1.20:${port}`}
        aria-label={`${name} address on the other computer`} spellCheck={false} autoCapitalize="off" className="setup-input" />
      <input type="password" value={form.token} onChange={(e) => onChange({ ...form, token: e.target.value, result: null })} placeholder="Access key, only if it asks for one"
        aria-label={`${name} access key (optional)`} autoComplete="off" className="setup-input" />
      <p className="text-[12px] leading-relaxed text-[var(--color-text-muted)]">{LISTEN_HINT[id]}{id === 'comfyui' ? ' Image models then go on that computer, so this guide skips the image model step.' : ''}</p>
      {form.result && <p role="status" className={cx('text-[12px] leading-snug', form.result.ok ? 'text-[var(--c-green)]' : 'text-[var(--c-red)]')}>{form.result.message}</p>}
      <div className="flex items-center gap-4">
        <Btn variant="secondary" loading={form.testing} disabled={!valid} onClick={() => void connect()}>Connect</Btn>
        <LinkBtn onClick={form.connected ? () => onChange({ ...form, open: false, url: engineUrl(id), result: null }) : useHere}>{form.connected ? 'Cancel' : 'Install here instead'}</LinkBtn>
        {form.connected && <LinkBtn onClick={useHere}>Use this computer instead</LinkBtn>}
      </div>
    </div>
  );
};

// ── Building blocks ─────────────────────────────────────────────────────────

const Screen: React.FC<{ lead?: React.ReactNode; title: string; body?: string; children?: React.ReactNode }> = ({ lead, title, body, children }) => (
  <div>
    {lead}
    <h1 tabIndex={-1} className="text-[28px] leading-[1.15] font-semibold tracking-[-0.025em] outline-none">{title}</h1>
    {body && <p className="mt-3 text-[15px] leading-relaxed text-[var(--color-text-muted)]">{body}</p>}
    {children && <div className="mt-8">{children}</div>}
  </div>
);

const LinkBtn: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ className, children, ...p }) => (
  <button type="button" {...p} className={cx('text-[13px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] disabled:opacity-40 rounded-[4px] focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)]', className)}>{children}</button>
);

const MODEL_COPY: Record<ModelStep, { title: string; body: string }> = {
  chat: { title: 'Pick a chat model', body: 'All three read images as well as text. Bigger is smarter, but slower and heavier.' },
  images: { title: 'Pick an image model', body: 'It goes into ComfyUI and is ready to use in Images.' },
  voice: { title: 'Pick a voice model', body: 'For reading text aloud and copying a voice from a short sample.' },
};

const ModelScreen: React.FC<{
  step: ModelStep; hw: { gb?: number; unified: boolean; name?: string }; value: Tier | null; onChange: (t: Tier | null) => void;
  dictation: boolean; onDictation: (v: boolean) => void; modelsDir: string; onModelsDir: (d: string) => void;
}> = ({ step, hw, value, onChange, dictation, onDictation, modelsDir, onModelsDir }) => {
  const c = MODEL_COPY[step];
  return (
    <Screen title={c.title} body={c.body}>
      <div className="setup-list" role="radiogroup" aria-label={c.title}>
        {PICKS[step].map((p) => {
          const fit = fitFor(p, hw.gb, hw.unified);
          const on = value === p.tier;
          return (
            <button key={p.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(p.tier)} className={cx('setup-row setup-choice w-full text-left', on && 'is-on')}>
              <span className="setup-radio" aria-hidden="true" />
              <span className="flex-1 min-w-0">
                <span className="block text-[14px] font-semibold">{p.title} <span className="font-normal text-[var(--color-text-muted)]">· {TIERS.find((t) => t.id === p.tier)!.label}</span></span>
                <span className="block mt-0.5 text-[12px] leading-snug text-[var(--color-text-muted)]">{p.blurb}</span>
              </span>
              <span className="text-right shrink-0">
                <span className="block text-[13px] tabular-nums">{p.diskGb} GB</span>
                {fit === 'too-big' && <span className="block text-[12px] text-[var(--c-orange)]">Too big for this {hw.unified ? 'Mac' : 'GPU'}</span>}
                {fit === 'tight' && <span className="block text-[12px] text-[var(--color-text-muted)]">Tight fit</span>}
              </span>
            </button>
          );
        })}
        <button type="button" role="radio" aria-checked={value === null} onClick={() => onChange(null)} className={cx('setup-row setup-choice w-full text-left', value === null && 'is-on')}>
          <span className="setup-radio" aria-hidden="true" />
          <span className="flex-1 text-[14px] text-[var(--color-text-muted)]">None for now</span>
        </button>
      </div>

      {step === 'voice' && (
        <div className="setup-row mt-6">
          <span className="flex-1 min-w-0">
            <span className="block text-[14px] font-semibold">Dictation</span>
            <span className="block mt-0.5 text-[12px] text-[var(--color-text-muted)]">{DICTATION_PICK.title}, to type with your voice. {DICTATION_PICK.diskGb} GB.</span>
          </span>
          <Toggle checked={dictation} onChange={onDictation} ariaLabel="Download Whisper Turbo for dictation" />
        </div>
      )}

      {step === 'images' && value !== null && (
        <div className="setup-row mt-6">
          <span className="flex-1 min-w-0 text-[12px] text-[var(--color-text-muted)] truncate" title={modelsDir}>
            {modelsDir ? `Saves to ${modelsDir}` : "Choose ComfyUI's models folder. Open ComfyUI once if it doesn't exist yet."}
          </span>
          <LinkBtn onClick={async () => { const d = await browseModelsDir(); if (d) onModelsDir(d); }} disabled={!isTauri}>{modelsDir ? 'Change' : 'Choose'}</LinkBtn>
        </div>
      )}

      <p className="mt-5 text-[12px] text-[var(--color-text-muted)]">
        {hw.gb ? `Suggested for your ${hw.unified ? `Mac (${hw.gb.toFixed(0)} GB memory)` : `${hw.name ?? 'GPU'} (${hw.gb.toFixed(0)} GB)`}.` : 'Lotus could not read your graphics card, so Quick is a safe start.'}
      </p>
    </Screen>
  );
};

const DoneScreen: React.FC<{ os: DesktopOs; total: number }> = ({ os, total }) => {
  const jobs = useSetupJobs();
  const keys = os === 'macos' ? '⌃⌥Space' : 'Ctrl+Alt+Space';
  return (
    <Screen title="You're ready" body={`${total > 0 ? 'Your models download in the background, so you can start now. ' : ''}The floating island is off; press ${keys} anywhere to open it for a quick chat.`}>
      {jobs.length > 0 && <div className="setup-list">{jobs.map((j) => <JobRow key={j.id} job={j} />)}</div>}
    </Screen>
  );
};

const JobRow: React.FC<{ job: Job }> = ({ job }) => (
  <div className="setup-row !block">
    <p className="text-[14px] font-semibold truncate">{job.label}</p>
    <p className={cx('mt-0.5 text-[12px] leading-snug', job.status === 'error' ? 'text-[var(--c-red)]' : job.status === 'done' ? 'text-[var(--c-green)]' : 'text-[var(--color-text-muted)]')}>
      {job.status === 'done' ? 'Done' : job.detail}
    </p>
    {job.status === 'running' && <Progress className="mt-2.5" value={job.progress ?? null} label={`Downloading ${job.label}`} />}
  </div>
);
