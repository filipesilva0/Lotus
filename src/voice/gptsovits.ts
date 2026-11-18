// GPT-SoVITS as an optional cloning engine (0.15.0). See core/src/engines/gptsovits.ts.
// Its folder is saved in `lotus.voice.gptsovits.v1`; once set, "GPT-SoVITS" appears as a cloning model
// in Voice → Voices, and Lotus starts its server when a voice made with it speaks.

import { useCallback, useEffect, useState } from 'react';
import { kv } from '../lib/store';
import { rpc, type SavedMedia } from '../lib/core';
import { isTauri } from '../lib/http';

export const GSV_ID = 'gptsovits';
export const GSV_KEY = 'lotus.voice.gptsovits.v1';
export const GSV_DOWNLOAD = 'https://github.com/RVC-Boss/GPT-SoVITS#installation';
export const GSV_NOTE = 'GPT-SoVITS speaks English, Chinese, Japanese, Korean and Cantonese (not Portuguese). It runs best on an NVIDIA graphics card.';

export const gsvDir = (): string => { try { return (JSON.parse(kv.getItem(GSV_KEY) || '{}') as { dir?: string }).dir ?? ''; } catch { return ''; } };
const setGsvDir = (dir: string) => { kv.setItem(GSV_KEY, JSON.stringify({ dir })); window.dispatchEvent(new Event(GSV_KEY)); };

/** The cloning model entry for the Voices page (only once its folder is picked). */
export const gsvModel = () => (gsvDir() ? [{ id: GSV_ID, title: 'GPT-SoVITS (most natural, separate program)', speakers: [] as { id: number; name: string }[], clones: true, needsReferenceText: true }] : []);

/** Speaks with GPT-SoVITS in the voice of a recording; saved in Lotus Studio/Audio like the built-in voices. */
export async function gsvSpeech(text: string, o: { reference?: string; referenceText?: string; speed?: number; language?: string }): Promise<SavedMedia> {
  if (!o.reference) throw new Error('This voice has no recording yet. Add one in Voice → Voices.');
  return rpc<SavedMedia>('tts_gptsovits', { dir: gsvDir(), text, reference: o.reference, referenceText: o.referenceText, speed: o.speed, language: o.language });
}

export interface GsvStatus { folderOk: boolean; running: boolean; startedByLotus: boolean; error?: string }

/** Folder, status and actions for the GPT-SoVITS card. */
export function useGptSovits() {
  const [dir, setDir] = useState(gsvDir);
  const [status, setStatus] = useState<GsvStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const refresh = useCallback(async () => { const d = gsvDir(); if (!d) { setStatus(null); return; } try { setStatus(await rpc<GsvStatus>('gsv_status', { dir: d })); } catch { setStatus(null); } }, []);
  useEffect(() => { const on = () => { setDir(gsvDir()); void refresh(); }; window.addEventListener(GSV_KEY, on); void refresh(); return () => window.removeEventListener(GSV_KEY, on); }, [refresh]);

  const pick = useCallback(async () => {
    setErr(null);
    if (!isTauri) { setErr('Picking a folder needs the Lotus desktop app.'); return; }
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({ title: 'Pick the GPT-SoVITS folder (the one with api_v2.py)', directory: true, multiple: false });
    if (typeof picked !== 'string') return;
    const s = await rpc<GsvStatus>('gsv_status', { dir: picked }).catch(() => null);
    if (s && !s.folderOk) { setErr('That folder doesn’t look like GPT-SoVITS: there’s no api_v2.py in it. Pick the folder you unpacked it into.'); return; }
    setGsvDir(picked);
  }, []);
  const forget = useCallback(() => { void rpc('gsv_stop', {}).catch(() => undefined); kv.removeItem(GSV_KEY); window.dispatchEvent(new Event(GSV_KEY)); }, []);
  const start = useCallback(async () => { setBusy(true); setErr(null); try { await rpc('gsv_start', { dir: gsvDir() }); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); void refresh(); } }, [refresh]);
  const stop = useCallback(async () => { await rpc('gsv_stop', {}).catch(() => undefined); void refresh(); }, [refresh]);
  return { dir, status, busy, err, pick, forget, start, stop, refresh };
}
