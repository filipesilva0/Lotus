// State and actions for the Voice page with Lotus's own engine (0.8.2). Saved through `kv`:
//   lotus.voice.mine.v1      your voices (MyVoice[])
//   lotus.voice.selected.v1  the voice option in use (also used for spoken notices)
//   lotus.voice.stories.v1   stories (Story[])
//   lotus.voice.builtin.v1   spoken clips and dictations (history)

import { useCallback, useEffect, useMemo, useState } from 'react';
import { kv } from '../lib/store';
import { uid } from '../lib/persist';
import { deleteMedia, loadMedia, saveMedia } from '../lib/core';
import { builtinsNow, InstalledModel, useBuiltins } from '../lib/builtins';
import { entryById } from '../models/library';
import { builtinSpeech } from './voice';
import { applyEffects, clipSeconds, joinClips } from './render';
import { HISTORY_EVENT } from './stt';
import { chunkText, effectsNeutral, Segment, Effects, MyVoice, pickVoice, Story, VoiceModel, VoiceOption, voiceOptions, withEffects } from './studio';

export const MINE_KEY = 'lotus.voice.mine.v1';
export const SELECTED_KEY = 'lotus.voice.selected.v1';
export const STORIES_KEY = 'lotus.voice.stories.v1';
export const HISTORY_KEY = 'lotus.voice.builtin.v1';

export interface Clip { id: string; text: string; path: string; voice: string; voiceId?: string; seconds?: number; fav?: boolean; ts: number }
export interface Transcript { id: string; text: string; model: string; source?: string; seconds?: number; segments?: Segment[]; fav?: boolean; ts: number; /** Language Whisper heard or was told (0.9.6). */ language?: string; /** Translations made by the chat model (0.9.6). */ translations?: { lang: string; text: string; ts: number }[] }

const read = <T,>(key: string, fallback: T): T => { try { const v = kv.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; } };
const write = (key: string, v: unknown) => kv.setItem(key, JSON.stringify(v));

/** Installed voice models as the studio sees them. */
export function voiceModels(models: InstalledModel[]): VoiceModel[] {
  return models.filter((m) => m.kind === 'voice').map((m) => {
    const spec = m.entryId ? entryById(m.entryId)?.voice : undefined;
    return { id: m.id, title: m.title, entryId: m.entryId, speakers: spec?.speakers ?? [], clones: !!spec?.clones, needsReferenceText: !!spec?.needsReferenceText };
  });
}

/** The voice option in use right now, outside React (spoken notices, the island). */
export function currentVoice(): VoiceOption | null {
  return pickVoice(voiceOptions(voiceModels(builtinsNow().models), read<MyVoice[]>(MINE_KEY, [])), kv.getItem(SELECTED_KEY));
}

/**
 * Speaks `text` with a voice option: long texts in parts (joined), cloning voices with their
 * recording, then the voice's effects and any extra ones. Saves the result in Lotus Studio/Audio.
 */
export async function speakWith(v: VoiceOption, text: string, o: { speed?: number; effects?: Partial<Effects>; steps?: number } = {}): Promise<{ path: string; seconds: number }> {
  const parts = chunkText(text);
  if (!parts.length) throw new Error('There is nothing to say.');
  const temp: string[] = [];
  try {
    const blobs: Blob[] = [];
    for (const p of parts) {
      const m = await builtinSpeech(p, { voice: v.model, speaker: v.speaker, speed: o.speed ?? v.speed ?? 1, reference: v.reference, referenceText: v.referenceText, steps: o.steps ?? v.steps });
      temp.push(m.path);
      blobs.push(await loadMedia(m.path));
    }
    const fx = withEffects({ ...(v.effects ?? {}), ...(o.effects ?? {}) });
    // One part and no effects: keep the engine's own file.
    if (blobs.length === 1 && effectsNeutral(fx)) { const path = temp.pop()!; return { path, seconds: await clipSeconds(blobs[0]) }; }
    let out = await joinClips(blobs);
    if (!effectsNeutral(fx)) out = await applyEffects(out, fx);
    const saved = await saveMedia(out, text.slice(0, 30) || 'speech');
    return { path: saved.path, seconds: await clipSeconds(out) };
  } finally {
    for (const p of temp) void deleteMedia(p).catch(() => undefined);
  }
}

export function useStudio() {
  const b = useBuiltins();
  const models = useMemo(() => voiceModels(b.models), [b.models]);
  const [mine, setMine] = useState<MyVoice[]>(() => read(MINE_KEY, []));
  const [selected, setSelectedRaw] = useState<string | null>(() => kv.getItem(SELECTED_KEY));
  const [stories, setStories] = useState<Story[]>(() => read(STORIES_KEY, []));
  const [history, setHistory] = useState<{ clips: Clip[]; transcripts: Transcript[] }>(() => ({ clips: [], transcripts: [], ...read(HISTORY_KEY, {}) }));

  // Other windows (the island) and the core may write these keys too.
  useEffect(() => {
    const on = (e: StorageEvent) => {
      if (e.key === MINE_KEY) setMine(read(MINE_KEY, []));
      if (e.key === STORIES_KEY) setStories(read(STORIES_KEY, []));
      if (e.key === SELECTED_KEY) setSelectedRaw(kv.getItem(SELECTED_KEY));
    };
    // Long transcriptions finish in the background (voice/stt.ts) and add to the history.
    const reload = () => setHistory(() => ({ clips: [], transcripts: [], ...read(HISTORY_KEY, {}) }));
    window.addEventListener('storage', on);
    window.addEventListener(HISTORY_EVENT, reload);
    return () => { window.removeEventListener('storage', on); window.removeEventListener(HISTORY_EVENT, reload); };
  }, []);

  const options = useMemo(() => voiceOptions(models, mine), [models, mine]);
  const voice = pickVoice(options, selected);
  const setSelected = useCallback((id: string) => { setSelectedRaw(id); kv.setItem(SELECTED_KEY, id); }, []);

  const saveMine = useCallback((fn: (l: MyVoice[]) => MyVoice[]) => setMine((l) => { const n = fn(l); write(MINE_KEY, n); return n; }), []);
  const addVoice = useCallback((v: Omit<MyVoice, 'id' | 'created'>) => { const nv: MyVoice = { ...v, id: uid('voice'), created: Date.now() }; saveMine((l) => [nv, ...l]); return nv; }, [saveMine]);
  const patchVoice = useCallback((id: string, p: Partial<MyVoice>) => saveMine((l) => l.map((v) => (v.id === id ? { ...v, ...p } : v))), [saveMine]);
  const removeVoice = useCallback((id: string) => {
    const v = read<MyVoice[]>(MINE_KEY, []).find((x) => x.id === id);
    saveMine((l) => l.filter((x) => x.id !== id));
    if (v?.reference) void deleteMedia(v.reference).catch(() => undefined);
  }, [saveMine]);

  const saveStories = useCallback((fn: (l: Story[]) => Story[]) => setStories((l) => { const n = fn(l); write(STORIES_KEY, n.slice(0, 100)); return n; }), []);
  const saveHistory = useCallback((fn: (h: { clips: Clip[]; transcripts: Transcript[] }) => { clips: Clip[]; transcripts: Transcript[] }) =>
    setHistory((h) => { const n = fn(h); write(HISTORY_KEY, { clips: n.clips.slice(0, 300), transcripts: n.transcripts.slice(0, 300) }); return n; }), []);

  return { builtins: b, models, mine, options, voice, selected, setSelected, addVoice, patchVoice, removeVoice, stories, saveStories, history, saveHistory };
}
export type Studio = ReturnType<typeof useStudio>;
