// GPT-SoVITS as an optional cloning engine (0.15.0). See core/src/engines/gptsovits.ts.
// Its folder is saved in `lotus.voice.gptsovits.v1`; once set, "GPT-SoVITS" appears as a cloning model
// in Voice → Voices, and Lotus starts its server when a voice made with it speaks.
// 0.22: on Windows Lotus installs it with one click (core/src/engines/gsvInstall.ts), and the core
// saves the folder with `managed: true`; picking a folder you set up yourself still works.

import { useCallback, useEffect, useState } from 'react';
import { kv } from '../lib/store';
import { rpc, type SavedMedia } from '../lib/core';
import { isTauri } from '../lib/http';
import { cancelJob, jobFor, refreshBuiltins, useBuiltins } from '../lib/builtins';

export const GSV_ID = 'gptsovits';
export const GSV_KEY = 'lotus.voice.gptsovits.v1';
export const GSV_DOWNLOAD = 'https://github.com/RVC-Boss/GPT-SoVITS#installation';
export const GSV_NOTE = 'GPT-SoVITS speaks English, Chinese, Japanese, Korean and Cantonese (not Portuguese). It runs best on an NVIDIA graphics card.';

interface GsvSaved { dir?: string; managed?: boolean; version?: string }
const gsvSaved = (): GsvSaved => { try { return JSON.parse(kv.getItem(GSV_KEY) || '{}') as GsvSaved; } catch { return {}; } };
export const gsvDir = (): string => gsvSaved().dir ?? '';
const setGsvDir = (dir: string) => { kv.setItem(GSV_KEY, JSON.stringify({ dir })); window.dispatchEvent(new Event(GSV_KEY)); };

/** The cloning model entry for the Voices page (only once its folder is picked). */
export const gsvModel = () => (gsvDir() ? [{ id: GSV_ID, title: 'GPT-SoVITS (most natural)', speakers: [] as { id: number; name: string }[], clones: true, needsReferenceText: true }] : []);

/** Speaks with GPT-SoVITS in the voice of a recording; saved in Lotus Studio/Audio like the built-in voices. */
export async function gsvSpeech(text: string, o: { reference?: string; referenceText?: string; speed?: number; language?: string }): Promise<SavedMedia> {
  if (!o.reference) throw new Error('This voice has no recording yet. Add one in Voice → Voices.');
  return rpc<SavedMedia>('tts_gptsovits', { dir: gsvDir(), text, reference: o.reference, referenceText: o.referenceText, speed: o.speed, language: o.language });
}

export interface GsvStatus { folderOk: boolean; running: boolean; startedByLotus: boolean; error?: string; root?: string }
/** What a one-click install would download (Windows only). */
export interface GsvOffer { name: string; bytes: number | null; needs: number | null; supported: boolean; why?: string }

/** Folder, status and actions for the GPT-SoVITS card. */
export function useGptSovits() {
  const [saved, setSaved] = useState(gsvSaved);
  const dir = saved.dir ?? '';
  const [status, setStatus] = useState<GsvStatus | null>(null);
  const [offer, setOffer] = useState<GsvOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const b = useBuiltins();
  const job = jobFor(b, 'gptsovits');
  const installing = job?.state === 'running';
  const refresh = useCallback(async () => { const d = gsvDir(); if (!d) { setStatus(null); return; } try { setStatus(await rpc<GsvStatus>('gsv_status', { dir: d })); } catch { setStatus(null); } }, []);
  useEffect(() => {
    const on = () => { setSaved(gsvSaved()); void refresh(); };
    // The core saves the folder when its install finishes; that arrives as a storage event.
    const onStorage = (e: StorageEvent) => { if (e.key === GSV_KEY) on(); };
    window.addEventListener(GSV_KEY, on); window.addEventListener('storage', onStorage);
    void refresh();
    return () => { window.removeEventListener(GSV_KEY, on); window.removeEventListener('storage', onStorage); };
  }, [refresh]);
  // The download size, once, while nothing is installed.
  useEffect(() => { if (dir || offer) return; void rpc<GsvOffer>('gsv_offer', {}).then(setOffer).catch(() => undefined); }, [dir, offer]);

  const pick = useCallback(async () => {
    setErr(null);
    if (!isTauri) { setErr('Picking a folder needs the Lotus desktop app.'); return; }
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({ title: 'Pick the GPT-SoVITS folder (the one with api_v2.py)', directory: true, multiple: false });
    if (typeof picked !== 'string') return;
    const s = await rpc<GsvStatus>('gsv_status', { dir: picked }).catch(() => null);
    if (s && !s.folderOk) { setErr('That folder doesn’t look like GPT-SoVITS: there’s no api_v2.py in it. Pick the folder you unpacked it into.'); return; }
    setGsvDir(s?.root || picked);
  }, []);
  const install = useCallback(async () => { setErr(null); try { await rpc('gsv_install', {}); void refreshBuiltins(); } catch (e) { setErr((e as Error).message); } }, []);
  const cancel = useCallback(() => { if (job) void cancelJob(job.id); }, [job]);
  /** Lotus's own install is deleted; a folder you picked is only forgotten. */
  const remove = useCallback(async () => { setErr(null); try { await rpc('gsv_remove', {}); } catch { kv.setItem(GSV_KEY, '{}'); } setOffer(null); window.dispatchEvent(new Event(GSV_KEY)); }, []);
  const start = useCallback(async () => { setBusy(true); setErr(null); try { await rpc('gsv_start', { dir: gsvDir() }); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); void refresh(); } }, [refresh]);
  const stop = useCallback(async () => { await rpc('gsv_stop', {}).catch(() => undefined); void refresh(); }, [refresh]);
  return { dir, managed: !!saved.managed, version: saved.version, status, offer, job, installing, busy, err, pick, install, cancel, remove, start, stop, refresh };
}
