// Where the island's widgets get their data (0.23): what's playing (Windows media controls, through the
// app shell), the task board and routines and the shelf (the core), and an optional private calendar
// address. In a plain browser (screenshots, previews) `window.__islandDemo` stands in for all of them.

import { useCallback, useEffect, useState } from 'react';
import { invokeNative, onEvent } from '../lib/bus';
import { coreFetch, onCoreEvent, rpc } from '../lib/core';
import { isTauri } from '../lib/http';
import type { NextEvent, NextRoutine, NextTask } from './nextUp';

export interface NowPlaying { title: string; artist: string; app: string; playing: boolean; canNext?: boolean; canPrev?: boolean }
export interface ShelfItem { name: string; bytes: number; added: number; mime: string; /** Demo/browser only: the dropped file itself. */ file?: File }

interface Demo { media?: NowPlaying | null; tasks?: NextTask[]; routines?: NextRoutine[]; meeting?: { title: string; start: number; join?: string }; shelf?: ShelfItem[] }
const demo = (): Demo | undefined => (typeof window !== 'undefined' ? (window as unknown as { __islandDemo?: Demo }).__islandDemo : undefined);

// ── Now playing (idea 5) ────────────────────────────────────────────────────

/** Polls what's playing every 2 s while `on` (the island is open or music is shown). */
export function useNowPlaying(on: boolean): [NowPlaying | null, (a: 'toggle' | 'next' | 'prev') => void] {
  const [np, setNp] = useState<NowPlaying | null>(() => demo()?.media ?? null);
  useEffect(() => {
    if (!on || !isTauri) return;
    let alive = true;
    const tick = () => void invokeNative<NowPlaying | null>('media_now').then((m) => { if (alive) setNp(m && m.title ? m : null); }).catch(() => undefined);
    tick();
    const t = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [on]);
  const control = useCallback((a: 'toggle' | 'next' | 'prev') => {
    if (!isTauri) { setNp((m) => (m && a === 'toggle' ? { ...m, playing: !m.playing } : m)); return; }
    void invokeNative('media_control', { action: a }).then(() => setTimeout(() => void invokeNative<NowPlaying | null>('media_now').then((m) => setNp(m && m.title ? m : null)), 350)).catch(() => undefined);
  }, []);
  return [np, control];
}

/**
 * Music pauses while Lotus listens or talks (dictation, read-aloud, calls) and plays again after.
 * Only music Lotus paused is resumed, so something you paused yourself stays paused.
 */
export function useAutoPause(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !isTauri) return;
    let voiceBusy = false, callBusy = false, pausedByUs = false, timer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      clearTimeout(timer);
      const busy = voiceBusy || callBusy;
      if (busy && !pausedByUs) {
        void invokeNative<boolean>('media_pause_if_playing').then((did) => { if (did) pausedByUs = true; }).catch(() => undefined);
      } else if (!busy && pausedByUs) {
        // A short wait, so the gap between two spoken sentences doesn't start the music for a moment.
        timer = setTimeout(() => { pausedByUs = false; void invokeNative('media_control', { action: 'play' }).catch(() => undefined); }, 1500);
      }
    };
    const offs: (() => void)[] = [];
    void onEvent<string>('voice:state', (s) => { voiceBusy = s === 'listening' || s === 'speaking'; sync(); }).then((u) => offs.push(u));
    void onEvent<boolean>('call:active', (on) => { callBusy = !!on; sync(); }).then((u) => offs.push(u));
    return () => { clearTimeout(timer); offs.forEach((o) => o()); };
  }, [enabled]);
}

// ── Board: tasks and routines ───────────────────────────────────────────────

export function useBoard(on: boolean): { tasks: NextTask[]; routines: NextRoutine[] } {
  const [b, setB] = useState<{ tasks: NextTask[]; routines: NextRoutine[] }>(() => ({ tasks: demo()?.tasks ?? [], routines: demo()?.routines ?? [] }));
  useEffect(() => {
    if (!on || demo()) return;
    let alive = true;
    const load = () => void rpc<{ tasks: NextTask[]; routines: NextRoutine[] }>('board_get').then((s) => { if (alive && s) setB({ tasks: s.tasks ?? [], routines: s.routines ?? [] }); }).catch(() => undefined);
    load();
    const off = onCoreEvent((e) => { if ((e as { type?: string }).type === 'board') load(); });
    return () => { alive = false; off(); };
  }, [on]);
  return b;
}

// ── Calendar ────────────────────────────────────────────────────────────────

const CAL_EVERY = 10 * 60_000;
export function useCalendar(url: string): { events: NextEvent[]; error: string | null } {
  const [s, setS] = useState<{ events: NextEvent[]; error: string | null }>(() => {
    const m = demo()?.meeting;
    return { events: m ? [{ title: m.title, start: m.start, end: m.start + 30 * 60_000, join: m.join ?? null, allDay: false }] : [], error: null };
  });
  useEffect(() => {
    if (!url.trim() || demo()) return;
    let alive = true;
    const load = () => void rpc<{ events: NextEvent[] }>('calendar_fetch', { url })
      .then((r) => { if (alive) setS({ events: r?.events ?? [], error: null }); })
      .catch((e) => { if (alive) setS((p) => ({ ...p, error: (e as Error).message })); });
    // A moment's wait, so typing the address in Settings doesn't fetch every half-typed version.
    const first = setTimeout(load, 900);
    const t = setInterval(load, CAL_EVERY);
    return () => { alive = false; clearTimeout(first); clearInterval(t); };
  }, [url]);
  return s;
}

// ── Shelf (idea 2) ──────────────────────────────────────────────────────────

export const shelf = {
  async list(): Promise<ShelfItem[]> {
    if (demo()?.shelf) return demo()!.shelf!;
    return (await (await coreFetch('/v1/shelf')).json() as { items: ShelfItem[] }).items;
  },
  async add(f: File): Promise<ShelfItem> {
    const d = demo();
    if (d) { const it = { name: f.name, bytes: f.size, added: Date.now(), mime: f.type, file: f }; d.shelf = [it, ...(d.shelf ?? [])]; return it; }
    const res = await coreFetch(`/v1/shelf?name=${encodeURIComponent(f.name)}`, { method: 'POST', headers: { 'content-type': f.type || 'application/octet-stream' }, body: f });
    return (await res.json()) as ShelfItem;
  },
  async remove(name: string): Promise<void> {
    const d = demo();
    if (d) { d.shelf = (d.shelf ?? []).filter((x) => x.name !== name); return; }
    await coreFetch(`/v1/shelf/${encodeURIComponent(name)}`, { method: 'DELETE' });
  },
  async file(it: ShelfItem): Promise<File> {
    if (it.file) return it.file;
    const b = await (await coreFetch(`/v1/shelf/${encodeURIComponent(it.name)}`)).blob();
    return new File([b], it.name, { type: it.mime || b.type });
  },
  convert: (name: string, to: string) => rpc<ShelfItem>('shelf_convert', { name, to }),
  path: (name: string) => rpc<string | null>('shelf_path', { name }),
};
