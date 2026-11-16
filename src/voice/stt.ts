// Speech to text for long recordings (0.8.2). Decodes the file at 16 kHz mono (what Whisper uses,
// and small enough for a couple of hours of audio), cuts it at quiet moments into parts Whisper can
// hear (≤ 28 s), transcribes them one by one, and keeps going while you use other pages. The
// finished transcript is added to the Voice page's history (`lotus.voice.builtin.v1`).

import { useSyncExternalStore } from 'react';
import { kv } from '../lib/store';
import { uid } from '../lib/persist';
import { reportActivity } from '../lib/bus';
import { builtinTranscribe } from './voice';
import { Segment, splitPoints } from './studio';

const RATE = 16000;
export const HISTORY_EVENT = 'lotus-voice-history';

export interface SttJob {
  id: string;
  name: string;
  state: 'reading' | 'working' | 'done' | 'error' | 'stopped';
  part: number;
  parts: number;
  seconds: number;
  segments: Segment[];
  started: number;
  error?: string;
  /** Recordings waiting their turn (0.9.5: several can be dropped at once). */
  waiting?: string[];
}

let job: SttJob | null = null;
let ctrl: AbortController | null = null;
/** Recordings queued behind the one being written down. */
let queue: { blob: Blob; o: { name: string; model?: string; modelTitle: string } }[] = [];
const waitingNames = () => queue.map((q) => q.o.name);
const subs = new Set<() => void>();
const set = (j: SttJob | null) => { job = j && { ...j, waiting: j.state === 'reading' || j.state === 'working' ? waitingNames() : [] }; subs.forEach((f) => f()); };

export const sttJob = () => job;
export function useSttJob(): SttJob | null {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => job, () => job);
}

/** 16-bit PCM WAV from mono samples. */
function wavOf(samples: Float32Array, rate = RATE): Blob {
  const data = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(data);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Blob([data], { type: 'audio/wav' });
}

/** Any audio or video the window can decode → 16 kHz mono samples. */
async function decodeMono(blob: Blob): Promise<Float32Array> {
  const ctx = new AudioContext({ sampleRate: RATE });
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (buf.numberOfChannels === 1) return buf.getChannelData(0);
    const out = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) out[i] += d[i] / buf.numberOfChannels; }
    return out;
  } finally { void ctx.close(); }
}

/** Adds a finished transcript to the Voice page history. */
function keep(j: SttJob, model: string) {
  let h: { clips: unknown[]; transcripts: unknown[] } = { clips: [], transcripts: [] };
  try { h = { clips: [], transcripts: [], ...JSON.parse(kv.getItem('lotus.voice.builtin.v1') || '{}') }; } catch { /* fresh */ }
  const text = j.segments.map((s) => s.text.trim()).filter(Boolean).join(' ');
  h.transcripts = [{ id: j.id, text, model, source: j.name, seconds: j.seconds, segments: j.segments, ts: Date.now() }, ...h.transcripts].slice(0, 300);
  kv.setItem('lotus.voice.builtin.v1', JSON.stringify(h));
  window.dispatchEvent(new Event(HISTORY_EVENT));
}

/**
 * Transcribes a recording of any length. One at a time: while one is being written down, more are
 * queued and start on their own (returns 'queued').
 */
export function transcribeLong(blob: Blob, o: { name: string; model?: string; modelTitle: string }): 'started' | 'queued' {
  if (job && (job.state === 'reading' || job.state === 'working')) {
    queue.push({ blob, o });
    set({ ...job, waiting: waitingNames() });
    return 'queued';
  }
  start(blob, o);
  return 'started';
}

function next() {
  const n = queue.shift();
  if (n) start(n.blob, n.o);
}

function start(blob: Blob, o: { name: string; model?: string; modelTitle: string }) {
  const c = new AbortController(); ctrl = c;
  const j: SttJob = { id: uid('vt'), name: o.name, state: 'reading', part: 0, parts: 0, seconds: 0, segments: [], started: Date.now(), waiting: waitingNames() };
  set(j);
  const activity = `stt-${j.id}`;
  reportActivity({ id: activity, kind: 'voice', label: 'Reading audio' });
  void (async () => {
    try {
      let samples: Float32Array;
      try { samples = await decodeMono(blob); }
      catch { throw new Error(`Lotus couldn’t read ${o.name}. Try a WAV, MP3, M4A, OGG or an MP4 video.`); }
      const seconds = samples.length / RATE;
      if (seconds < 0.3) throw new Error(`${o.name} has no sound in it.`);
      const cuts = splitPoints(samples, RATE);
      set({ ...j, state: 'working', parts: cuts.length, seconds });
      let from = 0;
      for (let i = 0; i < cuts.length; i++) {
        if (c.signal.aborted) throw new DOMException('Stopped', 'AbortError');
        const part = samples.subarray(from, cuts[i]);
        const text = (await builtinTranscribe(wavOf(part), o.model)).trim();
        const seg: Segment = { start: from / RATE, end: cuts[i] / RATE, text };
        from = cuts[i];
        const cur = sttJob()!;
        set({ ...cur, part: i + 1, segments: [...cur.segments, seg] });
        reportActivity({ id: activity, kind: 'voice', label: `${i + 1}/${cuts.length}`, progress: (i + 1) / cuts.length });
      }
      const done = { ...sttJob()!, state: 'done' as const };
      set(done);
      if (done.segments.some((s) => s.text)) keep(done, o.modelTitle);
      else set({ ...done, state: 'error', error: `Lotus heard no speech in ${o.name}.` });
      reportActivity({ id: activity, kind: 'voice', label: 'Transcript ready', done: true });
    } catch (e) {
      const cur = sttJob() ?? j;
      const stopped = c.signal.aborted;
      // Whatever was already written down is kept when you stop.
      if (stopped && cur.segments.some((s) => s.text)) keep({ ...cur, name: `${cur.name} (stopped)` }, o.modelTitle);
      set({ ...cur, state: stopped ? 'stopped' : 'error', error: stopped ? undefined : (e as Error).message });
      reportActivity({ id: activity, kind: 'voice', label: 'Transcript', done: true });
    } finally {
      if (ctrl === c) ctrl = null;
      // Stop also drops the ones waiting; otherwise the next recording starts.
      if (c.signal.aborted) { queue = []; const cur = sttJob(); if (cur) set({ ...cur, waiting: [] }); } else next();
    }
  })();
}

export const stopTranscribing = () => ctrl?.abort();
export const clearSttJob = () => { if (job && job.state !== 'reading' && job.state !== 'working') set(null); };
