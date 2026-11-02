// Audio helpers: mic recording with a live level meter, WAV encoding, waveform peaks.

/** Encode a decoded AudioBuffer as 16-bit PCM WAV. */
export function encodeWav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels;
  const frames = buf.length;
  const bytes = 2;
  const data = new ArrayBuffer(44 + frames * ch * bytes);
  const v = new DataView(data);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + frames * ch * bytes, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, buf.sampleRate, true); v.setUint32(28, buf.sampleRate * ch * bytes, true);
  v.setUint16(32, ch * bytes, true); v.setUint16(34, 16, true); str(36, 'data');
  v.setUint32(40, frames * ch * bytes, true);
  const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([data], { type: 'audio/wav' });
}

/** Any browser-decodable audio → WAV. WebView2's WebM output isn't reliably readable server-side. */
export async function toWav(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext();
  try {
    return encodeWav(await ctx.decodeAudioData(await blob.arrayBuffer()));
  } finally {
    void ctx.close();
  }
}

export interface RecordingResult {
  wav: Blob;
  durationSec: number;
}

/** Microphone recorder. `level` is 0..1 and updates ~30×/s while recording. */
export class MicRecorder {
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private ctx: AudioContext | null = null;
  private raf = 0;
  private startedAt = 0;

  constructor(private onLevel?: (level: number, elapsedSec: number) => void) {}

  get active() {
    return this.rec?.state === 'recording';
  }

  async start(deviceId?: string) {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : { echoCancellation: true, noiseSuppression: true },
    });
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : undefined;
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.chunks = [];
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(250);
    this.startedAt = performance.now();

    this.ctx = new AudioContext();
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 512;
    this.ctx.createMediaStreamSource(this.stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const s of data) peak = Math.max(peak, Math.abs(s - 128) / 128);
      this.onLevel?.(Math.min(1, peak * 1.6), (performance.now() - this.startedAt) / 1000);
      this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  async stop(): Promise<RecordingResult> {
    const rec = this.rec;
    if (!rec) throw new Error('Not recording');
    const done = new Promise<void>((res) => (rec.onstop = () => res()));
    rec.stop();
    await done;
    const durationSec = (performance.now() - this.startedAt) / 1000;
    this.cleanup();
    const wav = await toWav(new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' }));
    return { wav, durationSec };
  }

  cancel() {
    try {
      this.rec?.state === 'recording' && this.rec.stop();
    } catch {
      /* already stopped */
    }
    this.cleanup();
  }

  private cleanup() {
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.stream = null;
    this.ctx = null;
  }
}

/** Friendly message for the ways getUserMedia fails. */
export function micErrorMessage(e: unknown): string {
  const name = (e as DOMException)?.name;
  if (name === 'NotAllowedError') {
    const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
    const where = /Mac/.test(ua) ? 'System Settings → Privacy & Security → Microphone' : /Linux/.test(ua) ? "your desktop's privacy or sound settings" : 'Windows Settings → Privacy → Microphone';
    return `Microphone access is blocked. Allow it in ${where}.`;
  }
  if (name === 'NotFoundError') return 'No microphone found. Plug one in or pick another input.';
  return 'Could not start the microphone.';
}

/** Downsampled absolute peaks (0..1) for drawing a waveform. */
export async function waveformPeaks(url: string, buckets = 160): Promise<{ peaks: number[]; duration: number }> {
  const res = await fetch(url);
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(await res.arrayBuffer());
    const data = buf.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / buckets));
    const peaks: number[] = [];
    for (let b = 0; b < buckets; b++) {
      let max = 0;
      for (let i = b * step; i < Math.min(data.length, (b + 1) * step); i += Math.max(1, step >> 5)) {
        max = Math.max(max, Math.abs(data[i]));
      }
      peaks.push(max);
    }
    const norm = Math.max(...peaks, 0.001);
    return { peaks: peaks.map((p) => p / norm), duration: buf.duration };
  } finally {
    void ctx.close();
  }
}

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ── Reference-sample tools ──────────────────────────────────────────────────

export interface SampleHealth {
  durationSec: number;
  sampleRate: number;
  /** Rough signal-to-noise estimate in dB: loudest 10% of 50 ms frames vs quietest 10%. */
  snrDb: number | null;
  peakDb: number;
  clipped: boolean;
  verdict: 'good' | 'ok' | 'poor';
  advice: string;
}

export async function analyzeSample(blob: Blob): Promise<SampleHealth> {
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const ch = buf.getChannelData(0);
    const frame = Math.max(1, Math.floor(buf.sampleRate * 0.05));
    const rms: number[] = [];
    let peak = 0, hot = 0;
    for (let i = 0; i + frame <= ch.length; i += frame) {
      let s = 0;
      for (let j = 0; j < frame; j++) { const v = ch[i + j]; s += v * v; const a = Math.abs(v); if (a > peak) peak = a; if (a >= 0.999) hot++; }
      rms.push(Math.sqrt(s / frame));
    }
    rms.sort((a, b) => a - b);
    const n = Math.max(1, Math.floor(rms.length * 0.1));
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    const noise = avg(rms.slice(0, n)), speech = avg(rms.slice(-n));
    const snr = rms.length >= 10 && noise > 1e-6 ? Math.round(20 * Math.log10(speech / noise)) : null;
    const clipped = hot > 5;
    const dur = buf.duration;
    let verdict: SampleHealth['verdict'] = 'good', advice = 'Looks clean.';
    if (dur < 3) { verdict = 'poor'; advice = 'Too short. Aim for 3–10 seconds of speech.'; }
    else if (clipped) { verdict = 'poor'; advice = 'The recording clips (too loud). Record again a bit quieter.'; }
    else if (snr !== null && snr < 15) { verdict = 'poor'; advice = 'Background noise is high. Try a quieter room or closer mic.'; }
    else if (dur > 15) { verdict = 'ok'; advice = 'Longer than needed. Trim to the clearest 3–10 seconds.'; }
    else if (snr !== null && snr < 25) { verdict = 'ok'; advice = 'Some background noise. Usable, but cleaner is better.'; }
    return { durationSec: dur, sampleRate: buf.sampleRate, snrDb: snr, peakDb: peak > 0 ? Math.round(20 * Math.log10(peak)) : -100, clipped, verdict, advice };
  } finally { void ctx.close(); }
}

/** Cuts a clip to [start, end] seconds and returns a WAV. */
export async function trimAudio(blob: Blob, start: number, end: number): Promise<{ wav: Blob; durationSec: number }> {
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const a = Math.max(0, Math.floor(start * buf.sampleRate)), b = Math.min(buf.length, Math.floor(end * buf.sampleRate));
    const out = ctx.createBuffer(buf.numberOfChannels, Math.max(1, b - a), buf.sampleRate);
    for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).slice(a, b), c);
    return { wav: encodeWav(out), durationSec: out.duration };
  } finally { void ctx.close(); }
}

/** Records what the computer is playing. The system shows its own picker; choose a screen or tab and tick “share audio”. */
export class SystemAudioRecorder {
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private timer = 0;
  constructor(private onTick?: (elapsedSec: number) => void) {}

  async start() {
    const md = navigator.mediaDevices as MediaDevices & { getDisplayMedia?: (c: unknown) => Promise<MediaStream> };
    if (!md.getDisplayMedia) throw new Error('This window can’t capture system audio. Record with the microphone or upload a file instead.');
    const s = await md.getDisplayMedia({ audio: true, video: true });
    const audio = s.getAudioTracks();
    if (!audio.length) { s.getTracks().forEach((t) => t.stop()); throw new Error('No audio was shared. Pick a screen or tab and tick “Share audio” in the picker.'); }
    s.getVideoTracks().forEach((t) => t.stop());
    this.stream = new MediaStream(audio);
    this.rec = new MediaRecorder(this.stream);
    this.chunks = [];
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.rec.start();
    this.startedAt = Date.now();
    this.timer = window.setInterval(() => this.onTick?.((Date.now() - this.startedAt) / 1000), 200);
  }

  async stop(): Promise<RecordingResult> {
    const rec = this.rec!;
    const done = new Promise<void>((r) => { rec.onstop = () => r(); });
    rec.stop(); await done;
    clearInterval(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    const wav = await toWav(new Blob(this.chunks, { type: rec.mimeType }));
    return { wav, durationSec: (Date.now() - this.startedAt) / 1000 };
  }

  cancel() { try { this.rec?.stop(); } catch { /* already stopped */ } clearInterval(this.timer); this.stream?.getTracks().forEach((t) => t.stop()); }
}
