// GPT-SoVITS (0.15.0): an optional voice engine for very natural cloned voices
// (https://github.com/RVC-Boss/GPT-SoVITS, MIT). It is a Python program with its own runtime, several
// GB. Since 0.22 Lotus installs its Windows package with one click (gsvInstall.ts); you can still pick
// a folder you set up yourself. Lotus starts its API server (api_v2.py) when a voice needs it.
//
// Starting it the way the package's own go-webui.bat does (0.22). 0.15–0.21 failed on Windows:
//   - its output went into a pipe, where Windows Python writes in the old code page (1252 here), so
//     the first Chinese log line it prints while speaking ("并行推理模式已开启") crashed the request;
//     now Python writes UTF-8 (-X utf8, PYTHONIOENCODING);
//   - the package's runtime folder (ffmpeg, CUDA and C++ libraries) wasn't on PATH;
//   - Python also loaded packages from the user's own Python install; now -s, and no PYTHONPATH/HOME;
//   - picking the folder the .7z unpacked into (with the real folder inside) was refused;
//   - any program on port 9880 counted as GPT-SoVITS; now its API is checked, else another port.
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
import { findGsvRoot } from './gsvInstall';
import { freePort, needsShortPath, windowsShortPath } from './manager';

export const GSV_ID = 'gptsovits';
export const GSV_LANGS = ['en', 'zh', 'ja', 'ko', 'yue'];
const DEFAULT_PORT = 9880;

/** The folder with api_v2.py: the one given, or one folder down (a .7z unpacks into a folder of its own). */
export function gsvRoot(dir: string): string | null { return findGsvRoot(dir, 1); }

/** How to start GPT-SoVITS's API from its folder: the Windows package's own Python, else the system's. */
export function gsvCommand(dir: string, port: number, platform = process.platform): { exe: string; args: string[] } | null {
  if (!existsSync(join(dir, 'api_v2.py'))) return null;
  const runtime = platform === 'win32' ? join(dir, 'runtime', 'python.exe') : join(dir, 'runtime', 'bin', 'python');
  const own = existsSync(runtime);
  const exe = own ? runtime : platform === 'win32' ? 'python' : 'python3';
  const cfg = join('GPT_SoVITS', 'configs', 'tts_infer.yaml');
  // -X utf8: print in UTF-8 even into a pipe. -s (package only): leave out the user's own site-packages.
  return { exe, args: [...(own ? ['-s'] : []), '-X', 'utf8', 'api_v2.py', '-a', '127.0.0.1', '-p', String(port), ...(existsSync(join(dir, cfg)) ? ['-c', cfg] : [])] };
}

/** The environment GPT-SoVITS starts with: UTF-8 output, its runtime folder first on PATH, no stray Python settings. */
export function gsvEnv(dir: string, base: Record<string, string | undefined> = process.env, platform = process.platform): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined && !/^PYTHON(PATH|HOME|STARTUP)$/i.test(k)) env[k] = v;
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const runtime = join(dir, 'runtime');
  if (existsSync(runtime)) env[pathKey] = [runtime, ...(platform === 'win32' ? [] : [join(runtime, 'bin')]), env[pathKey] ?? ''].filter(Boolean).join(platform === 'win32' ? ';' : ':');
  env.PYTHONIOENCODING = 'utf-8';
  env.PYTHONUTF8 = '1';
  env.PYTHONUNBUFFERED = '1';
  return env;
}

/** A plain reason from GPT-SoVITS's log when it stops while starting or speaking. */
export function gsvFailure(log: string): string {
  if (/CUDA out of memory|OutOfMemoryError|CUBLAS_STATUS_ALLOC_FAILED/i.test(log)) return 'The graphics card ran out of memory. Close programs that use it (or unload the chat model in Settings → Models) and try again.';
  if (/address already in use|error while attempting to bind|only one usage of each socket/i.test(log)) return 'Another program is using its port. Restart Lotus and try again.';
  if (/No module named|ModuleNotFoundError|DLL load failed|ImportError/i.test(log)) {
    const m = /No module named '([^']+)'/.exec(log);
    return `Its Python files are incomplete${m ? ` (missing ${m[1]})` : ''}. Remove GPT-SoVITS in Voice → Voices and install it again.`;
  }
  if (/FileNotFoundError|No such file or directory|does not exist/i.test(log) && /pretrained|\.pth|\.ckpt|bert|hubert/i.test(log)) return 'Its voice model files are missing. Remove GPT-SoVITS in Voice → Voices and install it again.';
  if (/UnicodeEncodeError|UnicodeDecodeError/i.test(log)) return 'It couldn\'t handle some characters in the text or a folder name.';
  const lines = log.split(/\r?\n/).map((l) => l.trim()).filter((l) => /error|exception|not found|no module|failed/i.test(l));
  return lines.slice(-2).join(' ').slice(0, 300);
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
  /** The end of what the server Lotus started printed (for errors while speaking). */
  private log = '';

  constructor(private d: { tempDir: string; log?: (s: string) => void; fetch?: typeof fetch; spawn?: typeof Bun.spawn }) {}

  private url(port = this.port) { return `http://127.0.0.1:${port}`; }
  private f() { return this.d.fetch ?? fetch; }

  /**
   * Whether GPT-SoVITS's API answers on `port`: its FastAPI page list names /tts, or GET /tts without
   * text says so in JSON. (0.15–0.21 counted any reply, so another program on 9880 looked like it.)
   */
  async isGsv(port = this.port): Promise<boolean> {
    try {
      const r = await this.f()(`${this.url(port)}/openapi.json`, { signal: AbortSignal.timeout(1500) });
      if (r.ok && (await r.text()).includes('"/tts"')) return true;
    } catch { return false; }
    try {
      const r = await this.f()(`${this.url(port)}/tts`, { signal: AbortSignal.timeout(1500) });
      return r.status === 400 && /"message"/.test(await r.text());
    } catch { return false; }
  }

  /** Whether something answers HTTP on `port` (GPT-SoVITS or not). */
  private async taken(port: number): Promise<boolean> {
    try { await this.f()(`${this.url(port)}/`, { signal: AbortSignal.timeout(1000) }); return true; } catch { return false; }
  }

  async up(): Promise<boolean> { return this.isGsv(); }

  async status(dir: string): Promise<{ folderOk: boolean; running: boolean; startedByLotus: boolean; error?: string; root?: string }> {
    const root = dir ? gsvRoot(dir) : null;
    return { folderOk: !!root, root: root ?? undefined, running: await this.up(), startedByLotus: !!this.proc, error: this.lastError || undefined };
  }

  /** Starts api_v2.py from the folder (if it isn't running) and waits until it answers. */
  async start(dir: string): Promise<void> {
    const root = gsvRoot(dir);
    if (this.dir && root !== this.dir) this.stop();
    if (this.starting) return this.starting;
    if (await this.up()) return;
    if (!root) throw new Error('That folder doesn\'t look like GPT-SoVITS (no api_v2.py in it). Install it again in Voice → Voices, or pick the folder you unpacked it into.');
    this.dir = root;
    this.lastError = '';
    this.starting = (async () => {
      // 9880 is its usual port; when another program has it, use a free one.
      const port = (await this.taken(DEFAULT_PORT)) ? await freePort() : DEFAULT_PORT;
      const cmd = gsvCommand(root, port)!;
      // Some of its parts (the Japanese dictionary) can't open folders with accents in their names.
      const cwd = process.platform === 'win32' && needsShortPath(root) ? await windowsShortPath(root) : root;
      this.log = '';
      const spawn = this.d.spawn ?? Bun.spawn;
      const proc = spawn([cmd.exe, ...cmd.args], { cwd, env: gsvEnv(cwd), stdout: 'pipe', stderr: 'pipe', stdin: 'ignore', windowsHide: true });
      this.proc = proc;
      this.port = port;
      const keep = async (st: ReadableStream | null) => { if (!st) return; const r = st.getReader(); const dec = new TextDecoder(); for (;;) { const { done, value } = await r.read(); if (done) break; this.log = (this.log + dec.decode(value, { stream: true })).slice(-8000); } };
      void keep(proc.stdout as ReadableStream); void keep(proc.stderr as ReadableStream);
      let exited = false; void proc.exited.then(() => { exited = true; if (this.proc === proc) this.proc = null; });
      // Loading its models takes a while the first time (longer without an NVIDIA card).
      const until = Date.now() + 300_000;
      while (Date.now() < until) {
        if (exited) {
          await Bun.sleep(200); // the last lines it printed
          this.saveLog();
          const why = gsvFailure(this.log);
          throw new Error(`GPT-SoVITS stopped while starting${why ? `: ${why}` : '.'} Its log is in ${join(this.d.tempDir, 'server.log')}.`);
        }
        if (await this.isGsv(port)) { this.d.log?.(`GPT-SoVITS listening on ${port}`); return; }
        await Bun.sleep(1000);
      }
      try { proc.kill(); } catch { /* */ }
      this.saveLog();
      throw new Error(`GPT-SoVITS took more than five minutes to start. Its log is in ${join(this.d.tempDir, 'server.log')}.`);
    })().catch((e) => { this.lastError = (e as Error).message; throw e; }).finally(() => { this.starting = null; });
    return this.starting;
  }

  private saveLog() { try { mkdirSync(this.d.tempDir, { recursive: true }); writeFileSync(join(this.d.tempDir, 'server.log'), this.log); } catch { /* best effort */ } }

  /** Stops the server Lotus started (one you started yourself is left alone). */
  stop() { try { this.proc?.kill(); } catch { /* gone */ } this.proc = null; this.dir = ''; this.port = DEFAULT_PORT; }

  /** Speaks `text` in the voice of `refAudio` (a WAV file); returns WAV bytes. */
  async speak(o: { dir: string; text: string; refAudio: string; refText?: string; lang?: string; speed?: number }): Promise<Uint8Array> {
    if (!(await this.up())) {
      if (!o.dir) throw new Error('GPT-SoVITS isn\'t installed. Install it in Voice → Voices.');
      await this.start(o.dir);
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
      try { const j = JSON.parse(new TextDecoder().decode(bytes)) as { message?: string; Exception?: string }; msg = [j.message, j.Exception].filter(Boolean).join(': '); } catch { /* not JSON */ }
      const why = gsvFailure(`${msg}\n${this.proc ? this.log.slice(-3000) : ''}`);
      if (this.proc) this.saveLog();
      throw new Error(`GPT-SoVITS couldn't speak that${why && !msg.includes(why) ? `: ${why}` : msg ? `: ${msg}` : ` (HTTP ${r.status})`}.`);
    }
    return bytes;
  }
}
