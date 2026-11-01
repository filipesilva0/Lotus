// Downloads started by the Welcome guide (session 10). They live outside React so they keep going when
// the guide closes; the island shows them through reportActivity, and the guide's last step lists them.

import { useSyncExternalStore } from 'react';
import { reportActivity } from '../lib/bus';
import { ollamaClient } from '../services/ollamaService';
import { voicebox } from '../services/voicebox';
import { downloadModel, folderPath, listModelFiles } from '../services/downloadService';
import type { EngineId } from '../services/engineConfig';
import { ChatPick, ImagePick, VoicePick, imageFilesFor, matchVoiceModel } from './catalog';

export interface Job {
  id: string;
  engine: EngineId;
  label: string;
  status: 'running' | 'done' | 'error';
  /** 0..1 when known. */
  progress?: number;
  detail?: string;
}

let jobs: Job[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const put = (j: Job) => {
  jobs = jobs.some((x) => x.id === j.id) ? jobs.map((x) => (x.id === j.id ? { ...x, ...j } : x)) : [...jobs, j];
  emit();
  reportActivity({ id: `setup-${j.id}`, kind: 'download', label: j.label, progress: j.progress, done: j.status !== 'running' });
};
const patch = (id: string, p: Partial<Job>) => { const cur = jobs.find((j) => j.id === id); if (cur) put({ ...cur, ...p }); };

export const setupJobs = {
  get: () => jobs,
  subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
  /** Test hook. */
  reset: () => { jobs = []; emit(); },
};
export const useSetupJobs = () => useSyncExternalStore(setupJobs.subscribe, setupJobs.get, setupJobs.get);
const running = (id: string) => jobs.some((j) => j.id === id && j.status === 'running');

/** `ollama pull` for a chat pick. */
export async function pullChat(p: ChatPick): Promise<void> {
  const id = `chat-${p.tag}`;
  if (running(id)) return;
  put({ id, engine: 'ollama', label: p.title, status: 'running', detail: 'Starting…' });
  try {
    for await (const ev of ollamaClient.pull(p.tag)) {
      const progress = ev.total ? (ev.completed ?? 0) / ev.total : undefined;
      patch(id, { progress, detail: ev.status });
    }
    patch(id, { status: 'done', progress: 1, detail: 'Ready in Chat' });
  } catch (e) {
    patch(id, { status: 'error', detail: (e as Error).message });
  }
}

/** Fetches every file of the chosen image models into ComfyUI's models folder, skipping files already there. */
export async function fetchImages(picks: ImagePick[], modelsDir: string): Promise<void> {
  const files = imageFilesFor(picks);
  for (const f of files) {
    const id = `img-${f.folder}-${f.fileName}`;
    if (running(id)) continue;
    const dir = folderPath(modelsDir, f.folder);
    const have = await listModelFiles(dir).catch(() => [] as string[]);
    const label = `${f.fileName}`;
    if (have.includes(f.fileName)) { put({ id, engine: 'comfyui', label, status: 'done', progress: 1, detail: 'Already downloaded' }); continue; }
    put({ id, engine: 'comfyui', label, status: 'running', progress: 0, detail: `About ${f.gb.toFixed(1)} GB` });
    const h = downloadModel({
      url: f.url, destDir: dir, fileName: f.fileName,
      onProgress: (pr) => { if (!pr.done) patch(id, { progress: pr.total ? pr.received / pr.total : undefined, detail: `${(pr.received / 1024 ** 3).toFixed(1)} of ${pr.total ? (pr.total / 1024 ** 3).toFixed(1) : '?'} GB` }); },
    });
    try { await h.promise; patch(id, { status: 'done', progress: 1, detail: 'Saved' }); }
    catch (e) { patch(id, { status: 'error', detail: (e as Error).message }); }
  }
}

/** Asks Voicebox to download the matching model for each voice pick. Voicebox downloads in the background. */
export async function fetchVoices(picks: VoicePick[]): Promise<void> {
  let models: Awaited<ReturnType<typeof voicebox.modelStatus>>;
  try { models = await voicebox.modelStatus(); } catch (e) {
    picks.forEach((p) => put({ id: `voice-${p.id}`, engine: 'voicebox', label: p.title, status: 'error', detail: (e as Error).message }));
    return;
  }
  for (const p of picks) {
    const id = `voice-${p.id}`;
    const m = matchVoiceModel(p, models);
    if (!m) { put({ id, engine: 'voicebox', label: p.title, status: 'error', detail: 'This Voicebox version does not offer it. Update Voicebox, or pick another voice model in Engines → Models.' }); continue; }
    if (m.downloaded) { put({ id, engine: 'voicebox', label: p.title, status: 'done', progress: 1, detail: 'Already downloaded' }); continue; }
    put({ id, engine: 'voicebox', label: p.title, status: 'running', detail: 'Voicebox is downloading it' });
    try {
      await voicebox.downloadModel(m.model_name);
      void watchVoice(id, m.model_name);
    } catch (e) { patch(id, { status: 'error', detail: (e as Error).message }); }
  }
}

async function watchVoice(id: string, name: string) {
  for (let i = 0; i < 2400; i++) { // up to ~1 hour at 1.5 s
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const [st, act] = await Promise.all([voicebox.modelStatus(), voicebox.activeTasks().catch(() => null)]);
      const m = st.find((x) => x.model_name === name);
      const t = act?.downloads.find((d) => d.model_name === name);
      if (t?.error) { patch(id, { status: 'error', detail: t.error }); return; }
      if (m?.downloaded && !m.downloading) { patch(id, { status: 'done', progress: 1, detail: 'Ready in Voice' }); return; }
      patch(id, { progress: t?.progress != null ? t.progress / 100 : undefined });
    } catch { /* Voicebox busy; keep waiting */ }
  }
}
