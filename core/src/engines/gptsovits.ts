// GPT-SoVITS (0.15.0): an optional voice engine for very natural cloned voices
// (https://github.com/RVC-Boss/GPT-SoVITS, MIT). It is a Python program with its own runtime, several
// GB, so Lotus doesn't download it: you download GPT-SoVITS's Windows package (or set it up yourself),
// pick its folder in Voice → Voices, and Lotus starts its API server (api_v2.py) when a voice needs it.
//
// A voice made with it is one of your voices whose model is `gptsovits`: its recording (3-10 s) is
// the reference and the words in it are the prompt text. GPT-SoVITS speaks Chinese, English,
// Japanese, Korean and Cantonese only.
//
// API (api_v2.py): POST /tts with JSON { text, text_lang, ref_audio_path, prompt_text, prompt_lang, … }
// → audio bytes (media_type wav). A JSON body is an error ({ message }).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Subprocess } from 'bun';
import { readWav } from './sttServer';

export const GSV_ID = 'gptsovits';
export const GSV_LANGS = ['en', 'zh', 'ja', 'ko', 'yue'];
const DEFAULT_PORT = 9880;

/** How to start GPT-SoVITS's API from its folder: the Windows package's own Python, else the system's. */
export function gsvCommand(dir: string, port: number, platform = process.platform): { exe: string; args: string[] } | null {
  if (!existsSync(join(dir, 'api_v2.py'))) return null;
  const runtime = platform === 'win32' ? join(dir, 'runtime', 'python.exe') : join(dir, 'runtime', 'bin', 'python');
  const exe = existsSync(runtime) ? runtime : platform === 'win32' ? 'python' : 'python3';
  const cfg = join('GPT_SoVITS', 'configs', 'tts_infer.yaml');
  return { exe, args: ['api_v2.py', '-a', '127.0.0.1', '-p', String(port), ...(existsSync(join(dir, cfg)) ? ['-c', cfg] : [])] };
}

/** 16-bit mono WAV. */
function wavBytes(samples: Float32Array, rate: number): Uint8Array {
  const b = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(b.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return b;
}

/**
 * GPT-SoVITS refuses references outside 3-10 seconds. Longer ones are cut at the quietest moment
 * between 6 and 9.5 s; the words then no longer match, so the prompt text is dropped (`cut: true`).
 */
export function fitReference(wav: Uint8Array): { wav: Uint8Array | null; seconds: number; cut: boolean } {
  const w = readWav(wav);
  if (!w) return { wav: null, seconds: 0, cut: false };
  const seconds = w.samples.length / w.rate;
  if (seconds <= 9.8) return { wav: null, seconds, cut: false };
  const win = Math.round(w.rate * 0.05);
  let best = Math.round(9.5 * w.rate), quiet = Infinity;
  for (let i = Math.round(6 * w.rate); i + win < Math.round(9.5 * w.rate); i += win) {
    let e = 0; for (let k = i; k < i + win; k++) e += w.samples[k] * w.samples[k];
    if (e < quiet) { quiet = e; best = i + Math.round(win / 2); }
  }
  return { wav: wavBytes(w.samples.subarray(0, best), w.rate), seconds: best / w.rate, cut: true };
}

/** The language to ask for: the text's own when it is one GPT-SoVITS knows, else "auto". */
export function gsvLang(lang?: string): string {
  const l = (lang ?? '').toLowerCase().slice(0, 3).replace(/[^a-z]/g, '');
  return GSV_LANGS.includes(l) ? l : 'auto';
}

export class GptSovits {
  private proc: Subprocess | null = null;
  private dir = '';
  private port = DEFAULT_PORT;
  private starting: Promise<void> | null = null;
  private lastError = '';

  constructor(private d: { tempDir: string; log?: (s: string) => void; fetch?: typeof fetch }) {}

  private url() { return `http://127.0.0.1:${this.port}`; }
  private f() { return this.d.fetch ?? fetch; }

  /** Whether its API answers (any HTTP reply counts; there is no health endpoint). */
  async up(): Promise<boolean> {
    try { await this.f()(`${this.url()}/`, { signal: AbortSignal.timeout(1500) }); return true; } catch { return false; }
  }

  async status(dir: string): Promise<{ folderOk: boolean; running: boolean; startedByLotus: boolean; error?: string }> {
    return { folderOk: !!dir && !!gsvCommand(dir, this.port), running: await this.up(), startedByLotus: !!this.proc, error: this.lastError || undefined };
  }

  /** Starts api_v2.py from the folder (if it isn't running) and waits until it answers. */
  async start(dir: string, port = DEFAULT_PORT): Promise<void> {
    if (this.dir && dir !== this.dir) this.stop();
    this.dir = dir; this.port = port;
    if (await this.up()) return;
    if (this.starting) return this.starting;
    const cmd = gsvCommand(dir, port);
    if (!cmd) throw new Error('That folder doesn\'t look like GPT-SoVITS (no api_v2.py in it). Pick the folder you unpacked GPT-SoVITS into.');
    this.lastError = '';
    this.starting = (async () => {
      let log = '';
      const proc = Bun.spawn([cmd.exe, ...cmd.args], { cwd: dir, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore', windowsHide: true });
      this.proc = proc;
      const keep = async (s: ReadableStream | null) => { if (!s) return; const r = s.getReader(); const dec = new TextDecoder(); for (;;) { const { done, value } = await r.read(); if (done) break; log = (log + dec.decode(value)).slice(-4000); } };
      void keep(proc.stdout as ReadableStream); void keep(proc.stderr as ReadableStream);
      let exited = false; void proc.exited.then(() => { exited = true; if (this.proc === proc) this.proc = null; });
      // Loading its models takes a while the first time (longer without an NVIDIA card).
      const until = Date.now() + 240_000;
      while (Date.now() < until) {
        if (exited) {
          const why = log.split(/\r?\n/).map((l) => l.trim()).filter((l) => /error|exception|not found|no module/i.test(l)).slice(-2).join(' ').slice(0, 300);
          throw new Error(`GPT-SoVITS stopped while starting${why ? `: ${why}` : '.'} Try starting it from its own folder (go-webui) once to check it works.`);
        }
        if (await this.up()) { this.d.log?.(`GPT-SoVITS listening on ${port}`); return; }
        await Bun.sleep(1000);
      }
      try { proc.kill(); } catch { /* */ }
      throw new Error('GPT-SoVITS took more than four minutes to start. Check it works from its own folder.');
    })().catch((e) => { this.lastError = (e as Error).message; throw e; }).finally(() => { this.starting = null; });
    return this.starting;
  }

  /** Stops the server Lotus started (one you started yourself is left alone). */
  stop() { try { this.proc?.kill(); } catch { /* gone */ } this.proc = null; }

  /** Speaks `text` in the voice of `refAudio` (a WAV file); returns WAV bytes. */
  async speak(o: { dir: string; text: string; refAudio: string; refText?: string; lang?: string; speed?: number }): Promise<Uint8Array> {
    if (!(await this.up())) {
      if (!o.dir) throw new Error('GPT-SoVITS isn\'t running. Pick its folder in Voice → Voices so Lotus can start it.');
      await this.start(o.dir, this.port);
    }
    let ref = o.refAudio, prompt = (o.refText ?? '').replace(/\s+/g, ' ').trim();
    try {
      const fit = fitReference(new Uint8Array(readFileSync(o.refAudio)));
      if (fit.seconds && fit.seconds < 3) throw new Error('GPT-SoVITS needs a recording of 3 to 10 seconds; this voice\'s is shorter. Record a little more in Voice → Voices.');
      if (fit.wav) {
        ref = join(this.d.tempDir, `gsv-ref-${Bun.hash(o.refAudio).toString(36)}.wav`);
        mkdirSync(dirname(ref), { recursive: true });
        writeFileSync(ref, fit.wav);
        prompt = '';
      }
    } catch (e) { if (/GPT-SoVITS/.test((e as Error).message)) throw e; }
    const lang = gsvLang(o.lang);
    const body = {
      text: o.text, text_lang: lang, ref_audio_path: ref, prompt_text: prompt, prompt_lang: prompt ? 'auto' : lang,
      text_split_method: 'cut5', batch_size: 1, speed_factor: Math.max(0.5, Math.min(2, o.speed ?? 1)), media_type: 'wav', streaming_mode: false,
      top_k: 5, top_p: 1, temperature: 1, repetition_penalty: 1.35, parallel_infer: true,
    };
    const r = await this.f()(`${this.url()}/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(180_000) });
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (!r.ok || (bytes[0] === 0x7b /* { */)) {
      let msg = '';
      try { const j = JSON.parse(new TextDecoder().decode(bytes)) as { message?: string; Exception?: string }; msg = j.message || j.Exception || ''; } catch { /* not JSON */ }
      throw new Error(`GPT-SoVITS couldn't speak that${msg ? `: ${msg}` : ` (HTTP ${r.status})`}.`);
    }
    return bytes;
  }
}
