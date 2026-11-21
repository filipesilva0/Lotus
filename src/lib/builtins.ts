// The built-in engines and the Models page's data, as the web layer sees them (session 17).
// Everything here is a thin client of the core (core/src/engines/*): the core downloads, unpacks,
// runs and reports; this file keeps a live copy of its state for React.

import { useEffect, useSyncExternalStore } from 'react';
import { coreReady, onCoreEvent, rpc } from './core';
import { kv } from './store';
import { hasLiveSettings, liveSettings } from './liveSettings';
import type { ImageFolder, ImageProfile } from '../models/imageProfiles';
import type { ModelKind } from '../models/library';

export type BuiltinId = 'llama' | 'sd' | 'sherpa';
export interface Machine { os: 'windows' | 'macos' | 'linux'; arch: 'x64' | 'arm64'; gpu: 'nvidia' | 'amd' | 'intel' | 'apple' | 'none'; gpuName: string; vramGb: number; unified: boolean; ramGb: number }
export interface EngineInfo { id: BuiltinId; name: string; role: string; licence: string; installed: boolean; /** Installed, but a release Lotus can't use (sherpa-onnx 2.x). */ outdated?: boolean; note?: string | null; version: string | null; flavour: string | null; folder: string }
export interface Job { id: string; kind: 'engine' | 'model'; target: string; label: string; state: 'running' | 'done' | 'error' | 'stopped'; done: number; total: number; step: string; error?: string; started: number }
/** How the core sized the built-in chat engine's context (core/src/engines/chatFit.ts). */
export interface ChatFit { ctx: number; fits: boolean; budgetMb: number | null; baseMb: number; kvMb: number; kvPerToken: number; measured: boolean }
export interface ChatServer { state: 'stopped' | 'starting' | 'ready' | 'error'; model?: string; url?: string; error?: string; ctx?: number; auto?: boolean; fit?: ChatFit }
export interface InstalledModel { id: string; kind: ModelKind; title: string; files: string[]; gguf?: string; mmproj?: string; dir?: string; entryId?: string; custom?: boolean; source?: string; bytes: number; at: number }
export type ImageFiles = Record<ImageFolder, { file: string; bytes: number }[]>;

interface State {
  available: boolean;
  machine: Machine | null;
  engines: EngineInfo[];
  jobs: Job[];
  chat: ChatServer;
  models: InstalledModel[];
  imageFiles: ImageFiles;
  modelsDir: string;
  loaded: boolean;
}

const EMPTY_FILES: ImageFiles = { checkpoints: [], diffusion_models: [], text_encoders: [], vae: [], loras: [] };
let state: State = { available: false, machine: null, engines: [], jobs: [], chat: { state: 'stopped' }, models: [], imageFiles: EMPTY_FILES, modelsDir: '', loaded: false };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };

let started = false;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

/** Reloads engines, jobs and installed models from the core. */
export async function refreshBuiltins(): Promise<void> {
  const core = await coreReady();
  if (!core) { set({ available: false, loaded: true }); return; }
  try {
    const [st, inst] = await Promise.all([
      rpc<{ engines: EngineInfo[]; jobs: Job[]; chat: ChatServer }>('builtin_status'),
      rpc<{ models: InstalledModel[]; imageFiles: ImageFiles; modelsDir: string }>('models_installed'),
    ]);
    set({ available: true, engines: st.engines, jobs: st.jobs, chat: st.chat, models: inst.models, imageFiles: inst.imageFiles, modelsDir: inst.modelsDir, loaded: true });
  } catch {
    // An older core without these methods: built-in engines are simply not offered.
    set({ available: false, loaded: true });
  }
}

function start() {
  if (started) return;
  started = true;
  void refreshBuiltins();
  void coreReady().then((c) => { if (c) void rpc<Machine>('machine_info').then((machine) => set({ machine })).catch(() => undefined); });
  onCoreEvent((e) => {
    if (e.type !== 'builtin') return;
    const jobs = e.jobs as Job[];
    const finished = jobs.some((j) => j.state !== 'running' && !state.jobs.some((o) => o.id === j.id && o.state === j.state));
    set({ jobs, chat: e.chat as ChatServer });
    // A job that just finished changes what is installed.
    if (finished) { if (refreshTimer) clearTimeout(refreshTimer); refreshTimer = setTimeout(() => void refreshBuiltins(), 150); }
  });
}

export function useBuiltins(): State {
  useEffect(start, []);
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => state, () => state);
}
export const builtinsNow = () => state;

export const installEngine = (engine: BuiltinId) => rpc<{ jobId: string }>('builtin_install', { engine }).then((r) => { void refreshBuiltins(); return r.jobId; });
export const removeEngine = (engine: BuiltinId) => rpc('builtin_remove', { engine }).then(refreshBuiltins);
export const installModel = (id: string) => rpc<{ jobId: string }>('models_install', { id }).then((r) => { void refreshBuiltins(); return r.jobId; });
export const installCustomModel = (a: { source: string; kind: ModelKind; folder?: ImageFolder; title?: string }) => rpc<{ jobId: string }>('models_install_custom', a).then((r) => { void refreshBuiltins(); return r.jobId; });
export const removeModel = (id: string) => rpc('models_remove', { id }).then(refreshBuiltins);
export const removeImageFile = (folder: ImageFolder, file: string) => rpc('image_file_remove', { folder, file }).then(refreshBuiltins);
export const cancelJob = (jobId: string) => rpc('job_cancel', { jobId });
/** Auto-scale on (the default): the core sizes the context to free video memory itself. */
function autoContext(): boolean {
  try { return (hasLiveSettings() ? liveSettings().autoScale : JSON.parse(kv.getItem('lotus.settings.v1') || '{}').autoScale) !== false; } catch { return true; }
}
/** Starts (or reuses) the built-in chat engine. `ctx` only counts when auto-scaling is off. */
export const ensureChat = (model: string, ctx?: number) => rpc<{ url: string }>('chat_ensure', autoContext() ? { model, auto: true } : { model, ctx }).then((r) => r.url);
/** The context Auto would give this model right now, and why. */
export const chatFit = (model: string) => rpc<ChatFit>('chat_fit', { model });
export const stopChat = () => rpc('chat_stop');

export const engineReady = (s: State, id: BuiltinId) => !!s.engines.find((e) => e.id === id)?.installed;
export const installedOfKind = (s: State, kind: ModelKind) => s.models.filter((m) => m.kind === kind);
export const jobFor = (s: State, target: string) => s.jobs.find((j) => j.target === target && j.state === 'running') ?? s.jobs.find((j) => j.target === target);

// ── Image setups (lotus.imageProfiles.v1; the core adds one when a catalog image model is installed) ──

export const PROFILES_KEY = 'lotus.imageProfiles.v1';

export function loadProfiles(): ImageProfile[] {
  const l = kv.getJson<ImageProfile[]>(PROFILES_KEY, []);
  return Array.isArray(l) ? l.filter((p) => p && p.id && p.family && p.files) : [];
}
export function saveProfiles(list: ImageProfile[]) { kv.setJson(PROFILES_KEY, list); }

const profileSubs = new Set<() => void>();
let profilesSnap = loadProfiles();
let profileListen = false;
function listenProfiles() {
  if (profileListen || typeof window === 'undefined') return;
  profileListen = true;
  window.addEventListener('storage', (e) => { if (e.key === PROFILES_KEY) { profilesSnap = loadProfiles(); profileSubs.forEach((f) => f()); } });
}
export function useProfiles(): [ImageProfile[], (next: ImageProfile[]) => void] {
  useEffect(listenProfiles, []);
  const list = useSyncExternalStore((f) => { profileSubs.add(f); return () => { profileSubs.delete(f); }; }, () => profilesSnap, () => profilesSnap);
  const update = (next: ImageProfile[]) => { saveProfiles(next); profilesSnap = next; profileSubs.forEach((f) => f()); };
  return [list, update];
}

/** Is a file present in the Models folder (per the last listing)? */
export const hasImageFile = (files: ImageFiles) => (folder: ImageFolder, file: string) => (files[folder] ?? []).some((f) => f.file === file);

export const fmtSize = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes >= 1e6 ? `${Math.round(bytes / 1e6)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);
