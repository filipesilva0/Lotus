// Warm dictation (0.15.0). Each transcription used to start sherpa-onnx-offline, which loads Whisper
// from disk every time: on a call that cost a second or more per turn (more with Whisper small or
// medium). sherpa-onnx's own sherpa-onnx-offline-websocket-server keeps the model loaded, so Lotus
// starts one per (model, language) when it's first needed and stops it after a few idle minutes.
//
// Protocol (sherpa-onnx offline websocket server): one binary message made of
//   int32 sample rate (little endian) · int32 byte length of the samples · float32 samples
// sent in pieces; the server answers with the recognition result as JSON text, and the client says
// "Done". The server resamples to what the model needs.
//
// Anything that goes wrong here returns null, so the caller falls back to the one-off program.

import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Subprocess } from 'bun';

/** Mono float samples and their rate from a WAV file (16-bit PCM, 32-bit float, any channel count). */
export function readWav(buf: Uint8Array): { rate: number; samples: Float32Array } | null {
  if (buf.length < 44) return null;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o: number) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let off = 12, rate = 0, channels = 1, bits = 16, format = 1;
  while (off + 8 <= buf.length) {
    const id = tag(off), size = v.getUint32(off + 4, true), body = off + 8;
    if (id === 'fmt ') {
      format = v.getUint16(body, true); channels = v.getUint16(body + 2, true) || 1;
      rate = v.getUint32(body + 4, true); bits = v.getUint16(body + 14, true);
      if (format === 0xfffe && size >= 26) format = v.getUint16(body + 24, true); // WAVE_FORMAT_EXTENSIBLE
    } else if (id === 'data') {
      const end = Math.min(buf.length, body + size);
      const width = bits / 8;
      if (!rate || !(format === 1 && bits === 16) && !(format === 3 && bits === 32)) return null;
      const frames = Math.floor((end - body) / (width * channels));
      const out = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let s = 0;
        for (let c = 0; c < channels; c++) {
          const p = body + (i * channels + c) * width;
          s += format === 3 ? v.getFloat32(p, true) : v.getInt16(p, true) / 32768;
        }
        out[i] = s / channels;
      }
      return { rate, samples: out };
    }
    off = body + size + (size & 1);
  }
  return null;
}

/** The text in sherpa-onnx's JSON result ('' when there is none). */
export function resultText(msg: string): string {
  try { const j = JSON.parse(msg) as { text?: unknown }; return typeof j.text === 'string' ? j.text.trim() : ''; }
  catch { return msg.trim(); }
}

interface Running { key: string; port: number; proc: Subprocess; ready: Promise<boolean>; idle: ReturnType<typeof setTimeout> | null; busy: number }

export class SttServers {
  private servers = new Map<string, Running>();
  private broken = new Set<string>();

  constructor(private d: { freePort: () => Promise<number>; log?: (s: string) => void; idleMs?: number }) {}

  /** Starts (or keeps) a warm server for these arguments; resolves whether it is listening. */
  async warm(exe: string, args: string[]): Promise<boolean> {
    return (await this.get(exe, args)) !== null;
  }

  /** Transcribes a WAV file with a warm server; null when that isn't possible (use the one-off program). */
  async transcribe(exe: string, args: string[], wavPath: string, signal?: AbortSignal): Promise<string | null> {
    const wav = readWav(new Uint8Array(readFileSync(wavPath)));
    if (!wav) return null;
    const s = await this.get(exe, args);
    if (!s) return null;
    s.busy++;
    try { return await this.send(s.port, wav, signal); }
    catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      this.d.log?.(`warm dictation failed, using the one-off program: ${(e as Error).message}`);
      this.stop(s.key);
      return null;
    } finally { s.busy--; this.touch(s); }
  }

  stopAll() { for (const k of [...this.servers.keys()]) this.stop(k); }

  private stop(key: string) {
    const s = this.servers.get(key);
    if (!s) return;
    this.servers.delete(key);
    if (s.idle) clearTimeout(s.idle);
    try { s.proc.kill(); } catch { /* gone */ }
  }

  private touch(s: Running) {
    if (s.idle) clearTimeout(s.idle);
    s.idle = setTimeout(() => { if (!s.busy) this.stop(s.key); else this.touch(s); }, this.d.idleMs ?? 10 * 60_000);
  }

  private async get(exe: string, args: string[]): Promise<Running | null> {
    if (!existsSync(exe)) return null;
    const key = `${exe}\n${args.join('\n')}`;
    if (this.broken.has(key)) return null;
    let s = this.servers.get(key);
    if (!s) {
      // One warm model at a time: a different Whisper or language replaces the old one.
      for (const k of [...this.servers.keys()]) if (!this.servers.get(k)!.busy) this.stop(k);
      const port = await this.d.freePort();
      const proc = Bun.spawn([exe, `--port=${port}`, '--num-work-threads=2', '--num-io-threads=1', '--max-batch-size=1', ...args],
        { cwd: dirname(exe), stdout: 'ignore', stderr: 'pipe', stdin: 'ignore', windowsHide: true });
      const ready = this.waitListening(port, proc);
      s = { key, port, proc, ready, idle: null, busy: 0 };
      this.servers.set(key, s);
      void proc.exited.then(() => { if (this.servers.get(key) === s) this.servers.delete(key); });
    }
    this.touch(s);
    if (!(await s.ready)) {
      this.broken.add(key);
      this.stop(key);
      return null;
    }
    return s;
  }

  /** Waits until the server accepts websocket connections (loading a large Whisper takes a while). */
  private async waitListening(port: number, proc: Subprocess): Promise<boolean> {
    let exited = false;
    void proc.exited.then(() => { exited = true; });
    const until = Date.now() + 90_000;
    while (Date.now() < until && !exited) {
      const ok = await new Promise<boolean>((r) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        const t = setTimeout(() => { try { ws.close(); } catch { /* */ } r(false); }, 1500);
        ws.onopen = () => { clearTimeout(t); try { ws.close(); } catch { /* */ } r(true); };
        ws.onerror = () => { clearTimeout(t); r(false); };
      });
      if (ok) return true;
      await Bun.sleep(250);
    }
    return false;
  }

  private send(port: number, wav: { rate: number; samples: Float32Array }, signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.binaryType = 'arraybuffer';
      let done = false;
      const finish = (f: () => void) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort); f(); };
      // Whisper on a CPU writes about 5-20 times faster than speech; allow plenty.
      const timer = setTimeout(() => finish(() => { try { ws.close(); } catch { /* */ } reject(new Error('no answer from the dictation server')); }), 30_000 + (wav.samples.length / wav.rate) * 3000);
      const onAbort = () => finish(() => { try { ws.close(); } catch { /* */ } reject(new DOMException('Stopped', 'AbortError')); });
      signal?.addEventListener('abort', onAbort, { once: true });
      ws.onopen = () => {
        const bytes = wav.samples.byteLength;
        const all = new Uint8Array(8 + bytes);
        const h = new DataView(all.buffer);
        h.setInt32(0, wav.rate, true); h.setInt32(4, bytes, true);
        all.set(new Uint8Array(wav.samples.buffer, wav.samples.byteOffset, bytes), 8);
        for (let i = 0; i < all.length; i += 10240) ws.send(all.subarray(i, i + 10240));
      };
      ws.onmessage = (m) => finish(() => {
        const text = resultText(typeof m.data === 'string' ? m.data : new TextDecoder().decode(m.data as ArrayBuffer));
        try { ws.send('Done'); ws.close(); } catch { /* */ }
        resolve(text);
      });
      ws.onerror = () => finish(() => reject(new Error('the dictation server closed the connection')));
      ws.onclose = () => finish(() => reject(new Error('the dictation server closed the connection')));
    });
  }
}
