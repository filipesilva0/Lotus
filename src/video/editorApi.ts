// The Video editor's calls to the core (0.22; core/src/video/editService.ts).

import { coreFetch, onCoreEvent, rpc } from '../lib/core';
import { uploadToWork } from '../lib/agent';
import type { Media } from './project';

export interface JobEvent { jobId: string; projectId: string; op: string; state: 'running' | 'done' | 'error' | 'stopped'; detail?: string; fraction?: number; result?: unknown; error?: string }

export const getProject = (projectId: string) => rpc<unknown>('video_project_get', { projectId });
export const putProject = (projectId: string, project: unknown) => rpc<boolean>('video_project_put', { projectId, project });
export const listMedia = (projectId: string, files?: string[]) => rpc<(Media | { file: string; error: string })[]>('video_media', { projectId, files });
/** Copies files between a project and a Work job's folder; returns the names there. */
export const copyFiles = (fromId: string, toId: string, files: string[]) => rpc<string[]>('video_copy', { fromId, toId, files });
export const runningJobs = () => rpc<JobEvent[]>('video_jobs');
export const stopJob = (jobId: string) => rpc<boolean>('video_stop', { jobId });
/** Puts a file into the project's folder (videos, pictures and sound, up to 4 GB). */
export const addFile = (projectId: string, f: File) => uploadToWork(projectId, f);

/**
 * Starts one of the editor's jobs and follows it. `on` hears its progress; the promise ends with
 * its result. Aborting `signal` stops it in the core.
 */
export async function runJob<T>(projectId: string, op: string, args: Record<string, unknown>, on?: (e: JobEvent) => void, signal?: AbortSignal): Promise<T> {
  let jobId = '';
  const early: JobEvent[] = [];
  let finish: (e: JobEvent) => void = () => undefined;
  const ended = new Promise<JobEvent>((r) => { finish = r; });
  const deliver = (e: JobEvent) => { on?.(e); if (e.state !== 'running') finish(e); };
  const off = onCoreEvent((raw) => {
    const e = raw as unknown as JobEvent & { type: string };
    if (e.type !== 'video') return;
    if (!jobId) { early.push(e); return; }
    if (e.jobId === jobId) deliver(e);
  });
  try {
    jobId = (await rpc<{ jobId: string }>('video_job', { projectId, op, args })).jobId;
    early.filter((e) => e.jobId === jobId).forEach(deliver);
    const stop = () => { void stopJob(jobId).catch(() => undefined); };
    if (signal?.aborted) stop(); else signal?.addEventListener('abort', stop, { once: true });
    const last = await ended;
    signal?.removeEventListener('abort', stop);
    if (last.state === 'stopped') throw new DOMException('Stopped', 'AbortError');
    if (last.state === 'error') throw new Error(last.error || 'That didn\'t work.');
    return last.result as T;
  } finally { off(); }
}

const previews = new Map<string, Promise<string>>();
/**
 * A URL the page can play for a file: the 360p preview copy of a video (light, even for an hour of
 * 4K) or the picture or sound itself. Cached for the session; `fresh` asks again (a copy was just made).
 */
export function previewUrl(projectId: string, file: string, fresh = false): Promise<string> {
  const key = `${projectId}/${file}`;
  if (fresh) { const old = previews.get(key); previews.delete(key); void old?.then((u) => URL.revokeObjectURL(u)).catch(() => undefined); }
  let hit = previews.get(key);
  if (!hit) {
    hit = coreFetch(`/v1/video-preview?${new URLSearchParams({ projectId, file })}`).then(async (r) => {
      if (!r.ok) throw new Error(`${file} can't be previewed.`);
      return URL.createObjectURL(await r.blob());
    });
    hit.catch(() => previews.delete(key));
    previews.set(key, hit);
  }
  return hit;
}
