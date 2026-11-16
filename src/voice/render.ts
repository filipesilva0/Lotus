// Web Audio rendering for the voice studio (0.8.2): effects after speaking, long texts joined from
// chunks, and stories mixed to one file. Everything runs in the window with OfflineAudioContext.

import { encodeWav } from '../lib/audio';
import { Effects, effectTail, pitchRate, withEffects } from './studio';

const RATE = 24000;

async function decode(blob: Blob): Promise<AudioBuffer> {
  const ctx = new AudioContext();
  try { return await ctx.decodeAudioData(await blob.arrayBuffer()); } finally { void ctx.close(); }
}

/** A reverb impulse: decaying noise, longer for bigger rooms. */
function impulse(ctx: BaseAudioContext, room: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * (0.3 + room * 2.7)));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 2 - 1; };
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = rnd() * Math.pow(1 - i / len, 2 + (1 - room) * 3);
  }
  return buf;
}

/** Builds the effect chain from `input` to `ctx.destination` (used for files and for live preview). */
export function effectChain(ctx: BaseAudioContext, input: AudioNode, fx: Effects, start = 0, duration = 0): void {
  let node: AudioNode = input;
  const link = (n: AudioNode) => { node.connect(n); node = n; return n; };
  if (fx.band !== 'off') {
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = fx.band === 'phone' ? 300 : 500; link(hp);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = fx.band === 'phone' ? 3400 : 2800; link(lp);
    if (fx.band === 'radio') { const sh = ctx.createWaveShaper(); const k = 4; const c = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; c[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); } sh.curve = c; link(sh); }
  }
  if (fx.bass) { const f = ctx.createBiquadFilter(); f.type = 'lowshelf'; f.frequency.value = 200; f.gain.value = fx.bass; link(f); }
  if (fx.treble) { const f = ctx.createBiquadFilter(); f.type = 'highshelf'; f.frequency.value = 4000; f.gain.value = fx.treble; link(f); }
  if (fx.robot > 0) {
    // Ring modulation: the signal times a 50 Hz wave, mixed with the dry voice.
    const ring = ctx.createGain(); ring.gain.value = 0;
    const osc = ctx.createOscillator(); osc.frequency.value = 50; osc.connect(ring.gain); osc.start(start);
    const dry = ctx.createGain(); dry.gain.value = 1 - fx.robot;
    const wet = ctx.createGain(); wet.gain.value = fx.robot;
    const sum = ctx.createGain();
    node.connect(dry).connect(sum); node.connect(ring).connect(wet).connect(sum);
    node = sum;
  }
  const out = ctx.createGain();
  out.gain.value = Math.pow(10, fx.volume / 20);
  if (duration > 0 && (fx.fadeIn > 0 || fx.fadeOut > 0)) {
    const g = out.gain, v = g.value;
    if (fx.fadeIn > 0) { g.setValueAtTime(0.0001, start); g.linearRampToValueAtTime(v, start + Math.min(fx.fadeIn, duration / 2)); }
    if (fx.fadeOut > 0) { const t = start + duration; g.setValueAtTime(v, Math.max(start, t - fx.fadeOut)); g.linearRampToValueAtTime(0.0001, t); }
  }
  const pre = node;
  if (fx.room > 0 || fx.echo > 0) {
    const dry = ctx.createGain(); dry.gain.value = 1;
    pre.connect(dry).connect(out);
    if (fx.room > 0) { const cv = ctx.createConvolver(); cv.buffer = impulse(ctx, fx.room); const wet = ctx.createGain(); wet.gain.value = fx.room * 0.6; pre.connect(cv).connect(wet).connect(out); }
    if (fx.echo > 0) {
      const d = ctx.createDelay(2); d.delayTime.value = 0.28;
      const fb = ctx.createGain(); fb.gain.value = Math.min(0.75, fx.echo * 0.7);
      const wet = ctx.createGain(); wet.gain.value = fx.echo * 0.6;
      pre.connect(d); d.connect(fb).connect(d); d.connect(wet).connect(out);
    }
  } else pre.connect(out);
  out.connect(ctx.destination);
}

function normalize(buf: AudioBuffer) {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) for (const v of buf.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
  if (peak < 1e-4) return;
  const k = 0.891 / peak; // −1 dB
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= k; }
}

/** Applies effects to a spoken clip and returns a new WAV. */
export async function applyEffects(blob: Blob, effects: Partial<Effects>): Promise<Blob> {
  const fx = withEffects(effects);
  const src = await decode(blob);
  const rate = pitchRate(fx.pitch);
  const dur = src.duration / rate;
  const ctx = new OfflineAudioContext(1, Math.ceil((dur + effectTail(fx)) * src.sampleRate) + 1, src.sampleRate);
  const node = ctx.createBufferSource(); node.buffer = src; node.playbackRate.value = rate;
  effectChain(ctx, node, fx, 0, dur);
  node.start(0);
  const out = await ctx.startRendering();
  if (fx.normalize) normalize(out);
  return encodeWav(out);
}

/** Joins clips (long texts spoken in parts) with a short pause between them. */
export async function joinClips(blobs: Blob[], pause = 0.25): Promise<Blob> {
  if (blobs.length === 1) return blobs[0];
  const bufs = await Promise.all(blobs.map(decode));
  const rate = bufs[0]?.sampleRate ?? RATE;
  const total = bufs.reduce((s, b) => s + b.duration, 0) + pause * (bufs.length - 1);
  const ctx = new OfflineAudioContext(1, Math.ceil(total * rate) + 1, rate);
  let t = 0;
  for (const b of bufs) { const n = ctx.createBufferSource(); n.buffer = b; n.connect(ctx.destination); n.start(t); t += b.duration + pause; }
  return encodeWav(await ctx.startRendering());
}

/** Length of a clip in seconds. */
export async function clipSeconds(blob: Blob): Promise<number> { return (await decode(blob)).duration; }

/** Mixes a story's clips at their places (start seconds, volume) into one WAV. */
export async function mixStory(parts: { blob: Blob; start: number; gain: number }[]): Promise<Blob> {
  const bufs = await Promise.all(parts.map((p) => decode(p.blob)));
  const rate = bufs[0]?.sampleRate ?? RATE;
  const end = parts.reduce((m, p, i) => Math.max(m, p.start + bufs[i].duration), 0);
  const ctx = new OfflineAudioContext(1, Math.max(1, Math.ceil(end * rate) + 1), rate);
  parts.forEach((p, i) => { const n = ctx.createBufferSource(); n.buffer = bufs[i]; const g = ctx.createGain(); g.gain.value = p.gain; n.connect(g).connect(ctx.destination); n.start(p.start); });
  const out = await ctx.startRendering();
  let peak = 0;
  for (const v of out.getChannelData(0)) peak = Math.max(peak, Math.abs(v));
  if (peak > 0.99) normalize(out);
  return encodeWav(out);
}

/** Plays several clips together at their places (story preview). Returns a stop function. */
export function playTogether(parts: { blob: Blob; start: number; gain: number }[], onEnd: () => void, from = 0): () => void {
  const ctx = new AudioContext();
  let stopped = false;
  void (async () => {
    const bufs = await Promise.all(parts.map(async (p) => ctx.decodeAudioData(await p.blob.arrayBuffer())));
    if (stopped) return;
    const t0 = ctx.currentTime + 0.05;
    let last = 0;
    parts.forEach((p, i) => {
      const end = p.start + bufs[i].duration;
      if (end <= from) return;
      const n = ctx.createBufferSource(); n.buffer = bufs[i];
      const g = ctx.createGain(); g.gain.value = p.gain;
      n.connect(g).connect(ctx.destination);
      const offset = Math.max(0, from - p.start);
      n.start(t0 + Math.max(0, p.start - from), offset);
      last = Math.max(last, end - from);
    });
    setTimeout(() => { if (!stopped) { stopped = true; void ctx.close(); onEnd(); } }, last * 1000 + 200);
  })();
  return () => { if (!stopped) { stopped = true; void ctx.close(); onEnd(); } };
}

/** Plays a clip through effects live (effect preview while adjusting). Returns a stop function. */
export function previewEffects(blob: Blob, effects: Partial<Effects>, onEnd: () => void): () => void {
  const fx = withEffects(effects);
  const ctx = new AudioContext();
  let stopped = false;
  void (async () => {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (stopped) return;
    const n = ctx.createBufferSource(); n.buffer = buf; n.playbackRate.value = pitchRate(fx.pitch);
    const dur = buf.duration / n.playbackRate.value;
    effectChain(ctx, n, fx, ctx.currentTime, dur);
    n.start();
    setTimeout(() => { if (!stopped) { stopped = true; void ctx.close(); onEnd(); } }, (dur + effectTail(fx)) * 1000 + 100);
  })();
  return () => { if (!stopped) { stopped = true; void ctx.close(); onEnd(); } };
}
