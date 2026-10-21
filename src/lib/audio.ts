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
  if (name === 'NotAllowedError') return 'Microphone access is blocked. Allow it in Windows Settings → Privacy → Microphone.';
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
