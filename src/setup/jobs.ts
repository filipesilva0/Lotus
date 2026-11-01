// Downloads started by the Welcome guide (session 10). They live outside React so they keep going when
// the guide closes; the island shows them through reportActivity, and the guide's last step lists them.

import { useSyncExternalStore } from 'react';
import { reportActivity } from '../lib/bus';
import { ollamaClient } from '../services/ollamaService';
import { voicebox } from '../services/voicebox';
import { downloadModel, findModelsDir, folderPath, listModelFiles } from '../services/downloadService';
import { isRemote, type EngineId } from '../services/engineConfig';
import type { InstallTarget } from '../chat/install';
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
export async function pullChat(p: Pick<ChatPick, 'tag' | 'title'>): Promise<void> {
  const id = `chat-${p.tag}`;
  if (running(id)) return;
  put({ id, engine: 'ollama', label: p.title, status: 'running', detail: 'Starting…' });
  try {
    let last = '';
    for await (const ev of ollamaClient.pull(p.tag)) {
      const progress = ev.total ? (ev.completed ?? 0) / ev.total : undefined;
      last = ev.status ?? last;
      patch(id, { progress, detail: ev.status });
    }
    // Ollama ends a finished pull with "success"; a stream that just stops was cut off.
    if (last !== 'success') { patch(id, { status: 'error', detail: 'The download stopped before it finished. Try again.' }); return; }
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

// ── Installs approved from Chat (session 11) ─────────────────────────────────

/** The job ids an approved install creates, so its card can show their progress. */
export function jobIdsFor(t: InstallTarget): string[] {
  if (t.engine === 'ollama') return [`chat-${t.id}`];
  if (t.engine === 'voicebox') return [`voice-${t.id}`];
  const pick = t.pick as ImagePick | undefined;
  return pick ? imageFilesFor([pick]).map((f) => `img-${f.folder}-${f.fileName}`) : [];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Runs an install the user allowed on a chat card. Throws (with a message that says what to do) when
 * it cannot start; once started, progress and errors are reported through the jobs list.
 */
export async function installTarget(t: InstallTarget): Promise<void> {
  if (t.engine === 'ollama') { await pullChat({ tag: t.id, title: t.title }); return; }
  if (t.engine === 'comfyui') {
    const pick = t.pick as ImagePick | undefined;
    if (!pick) throw new Error('Lotus does not know how to set up this image model.');
    if (isRemote('comfyui')) throw new Error('ComfyUI runs on another computer, so its model files have to be added there. Lotus downloads into a folder on this computer.');
    const dir = await findModelsDir();
    if (!dir) throw new Error("Lotus doesn't know ComfyUI's models folder yet. Choose it in Engines → Models, then allow the install again.");
    await fetchImages([pick], dir);
    return;
  }
  const pick: VoicePick = (t.pick as VoicePick | undefined) ?? {
    kind: 'voice', id: t.id, tier: 'balanced', title: t.title, maker: '', licence: '', blurb: '', vramGb: 0, diskGb: 0, clones: false,
    match: new RegExp(`^${escapeRe(t.id)}$`, 'i'),
  };
  await fetchVoices([pick]);
}
