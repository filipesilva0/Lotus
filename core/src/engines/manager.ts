// Built-in engines (session 17, rebuild step 3): Lotus downloads, keeps and runs its own engines and
// models inside the Lotus Studio folder, so nothing else has to be installed.
//
//   Lotus Studio/
//     Engines/llama.cpp/<release>/…            llama-server (chat)
//     Engines/stable-diffusion.cpp/<release>/… sd-cli (images)
//     Engines/sherpa-onnx/<release>/…          sherpa-onnx-offline-tts, sherpa-onnx-offline (speech)
//     Engines/builtin.json                     which release of each is installed
//     Models/chat/<model>/…gguf                chat models (+ the vision projector they need)
//     Models/image/<folder>/…                  checkpoints, diffusion_models, text_encoders, vae, loras
//     Models/voice/<model>/…                   voices and dictation models
//     Models/models.json                       what is installed, and from where
//
// Every download is a job with progress, broadcast as { type: 'builtin', jobs, chat }. Nothing here
// claims success without the file on disk or the process answering.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { basename, dirname, join, relative } from 'node:path';
import type { Subprocess } from 'bun';
import { BUILTIN_ORDER, BuiltinId, exeName, parseReleases, pickRelease, releaseAccepted, RUNTIMES } from './assets';
import { download, DownloadError, findFile, folderBytes, listFiles, makeExecutable, removeTree, unpack, type FetchFn } from './files';
import { readMachine, type Machine } from './machine';
import { fitChatCtx, MB, memoryMb, type ChatFit } from './chatFit';
import { readGgufInfo } from './gguf';
import { gpuMemory } from '../hardware';
import { SttServers } from './sttServer';
import { entryById, parseCustomSource, pickGguf, profileForEntry, quantFolder, type LibEntry, type ModelKind } from '../../../src/models/library';
import { missingFor, sdcppArgs, sdcppProgress, sizeFor, type ImageFolder, type Slot, type ImageProfile, type LoraUse, type SdRun } from '../../../src/models/imageProfiles';

export const ENGINE_DIR: Record<BuiltinId, string> = { llama: 'llama.cpp', sd: 'stable-diffusion.cpp', sherpa: 'sherpa-onnx' };
export const IMAGE_FOLDERS: ImageFolder[] = ['checkpoints', 'diffusion_models', 'text_encoders', 'vae', 'loras'];
export const PROFILES_KEY = 'lotus.imageProfiles.v1';

export interface EngineRecord { tag: string; flavour: string; dir: string; exes: Record<string, string>; installedAt: number }
export interface InstalledModel {
  id: string; kind: ModelKind; title: string;
  /** Paths relative to Lotus Studio/Models. */
  files: string[];
  /** Chat: the main GGUF and its vision projector. */
  gguf?: string; mmproj?: string;
  /** Voice: the model folder. */
  dir?: string;
  entryId?: string; custom?: boolean; source?: string;
  bytes: number; at: number;
}
export type JobState = 'running' | 'done' | 'error' | 'stopped';
export interface Job { id: string; kind: 'engine' | 'model'; target: string; label: string; state: JobState; done: number; total: number; step: string; error?: string; started: number }

export interface ChatServer {
  state: 'stopped' | 'starting' | 'ready' | 'error'; model?: string; url?: string; error?: string; port?: number; ctx?: number;
  /** The context was sized to free memory (Auto), or grown because a conversation needed more. */
  auto?: boolean; grown?: boolean;
  /** How the context was sized (shown in Settings). */
  fit?: ChatFit;
  /** Estimated memory this server holds, in MB. */
  memMb?: number;
}

/**
 * Smallest context the built-in chat engine starts with: Lotus's system prompt and tool list alone are
 * about 5,000 tokens, so 4,096 (what the scaler picked on a 16 GB Mac) failed every message (0.10.5).
 */
export const MIN_CHAT_CTX = 8192;
export const MAX_CHAT_CTX = 65536;

interface Deps {
  studio: string;
  broadcast: (e: Record<string, unknown>) => void;
  kvGet: (k: string) => string | null;
  kvSet: (k: string, v: string) => void;
  fetch?: FetchFn;
  log?: (m: string) => void;
  /** Tests: a fixed machine and where to look for releases. */
  machine?: () => Promise<Machine>;
  /** Tests: a fixed video-memory reading. */
  gpuMemory?: () => Promise<{ usedMb: number; totalMb: number } | null>;
  githubApi?: string;
  hfBase?: string;
}

const now = () => Date.now();
const readJson = <T>(p: string, d: T): T => { try { return JSON.parse(readFileSync(p, 'utf8')) as T; } catch { return d; } };
const writeJson = (p: string, v: unknown) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(v, null, 2)); };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'model';

export async function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const s = createServer();
    s.unref();
    s.on('error', fail);
    s.listen(0, '127.0.0.1', () => { const a = s.address(); const p = typeof a === 'object' && a ? a.port : 0; s.close(() => done(p)); });
  });
}

/** Reads sherpa-onnx's recognition result: the last JSON object with a "text", else the last plain line. */
export function parseSherpaText(out: string): string {
  const objs = out.match(/\{[^{}]*"text"\s*:\s*"(?:[^"\\]|\\.)*"[^{}]*\}/g);
  if (objs?.length) { try { return String((JSON.parse(objs[objs.length - 1]) as { text?: string }).text ?? '').trim(); } catch { /* fall through */ } }
  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^(Elapsed|Real time|RTF|num threads|Creating|Started|Done|----|\/|[A-Z]:\\)/i.test(l) && !l.includes('.onnx') && !l.endsWith('.wav'));
  return lines[lines.length - 1] ?? '';
}

let acp: Promise<number> | null = null;
/** The Windows "ANSI" code page programs with a plain main() see their arguments in (1252 in Portugal). */
export function windowsAnsiCodePage(): Promise<number> {
  acp ??= (async () => {
    try {
      const p = Bun.spawn(['reg', 'query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage', '/v', 'ACP'], { stdout: 'pipe', stderr: 'ignore', windowsHide: true });
      const out = await new Response(p.stdout).text();
      const m = /ACP\s+REG_SZ\s+(\d+)/i.exec(out);
      return m ? Number(m[1]) : 1252;
    } catch { return 1252; }
  })();
  return acp;
}

const shortPaths = new Map<string, Promise<string>>();
/**
 * Windows: the 8.3 short form of a folder (no spaces or accents, e.g. C:\Users\Ana\DOCUME~1\LOTUSS~1\…),
 * for programs that mishandle such paths (espeak-ng inside sherpa-onnx, 0.9.1). Falls back to the
 * path itself when short names are turned off on that drive.
 */
export function windowsShortPath(path: string): Promise<string> {
  if (!needsShortPath(path)) return Promise.resolve(path);
  let hit = shortPaths.get(path);
  if (!hit) {
    hit = (async () => {
      try {
        const ps = `(New-Object -ComObject Scripting.FileSystemObject).GetFolder('${path.replace(/'/g, "''")}').ShortPath`;
        const p = Bun.spawn(['powershell', '-NoProfile', '-NonInteractive', '-Command', ps], { stdout: 'pipe', stderr: 'ignore', windowsHide: true });
        const out = (await new Response(p.stdout).text()).trim();
        return out && !needsShortPath(out) ? out : path;
      } catch { return path; }
    })();
    shortPaths.set(path, hit);
  }
  return hit;
}
export const needsShortPath = (p: string) => /[^\x21-\x7e]/.test(p);

/**
 * A plain explanation when sd-cli stopped for lack of video memory, with the numbers it reported, or
 * null when the log shows some other failure. (0.9.1 said "ran out of memory" for any log with
 * "failed to allocate" and gave no numbers, so a wrong setting looked like a too-small card.)
 */
export function sdcppMemoryError(log: string, vramGb = 0): string | null {
  if (!/cannot make enough memory available|out of memory|outofmemory|insufficient memory|failed to allocate/i.test(log)) return null;
  const gb = (mb: number) => `${(mb / 1024).toFixed(1)} GB`;
  const need = [...log.matchAll(/need ([\d.]+) MB device[^\n]*?available ([\d.]+) MB device/gi)].pop();
  const total = Number(/total ([\d.]+) MB/i.exec(log)?.[1]) || vramGb * 1024;
  if (need) {
    const want = Number(need[1]), free = Number(need[2]);
    if (free < 1) return 'The graphics card had no free memory left, so no image was made. Another program is holding it (Ollama, ComfyUI, a game or a browser tab). Close it, or wait a few minutes for Ollama to unload its model, and try again.';
    return `The image needed ${gb(want)} of video memory to work in, but only ${gb(free)}${total ? ` of the card's ${gb(total)}` : ''} was free. Close programs that use the graphics card, or try a smaller size or one image at a time.`;
  }
  if (/kIOGPU|ggml_metal|insufficient memory/i.test(log)) return 'The Mac ran out of graphics memory making this image, even with the chat model unloaded and the image decoded in tiles. Close other heavy apps, or try a smaller size, one image at a time, or a smaller model.';
  return 'The graphics card ran out of memory making this image. Try a smaller size, one image at a time, or a smaller model.';
}

/** The lines of a tool's output that say what went wrong (sherpa-onnx prints the cause before its last line). */
export function failureLines(output: string, max = 4): string {
  // Leave out sherpa-onnx's echo of its own command line (older builds, or --print-args ignored).
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).filter((l) => !/sherpa-onnx[\w-]*(\.exe)?['"]?\s+['"]?--/i.test(l) && !/parse-options\.cc:Read:/.test(l));
  const useful = lines.filter((l) => /error|fail|unable|cannot|can't|not found|does not exist|invalid|deprecated|unknown|skip/i.test(l));
  const pick = [...new Set((useful.length ? useful : lines).slice(-max))];
  // sherpa-onnx prefixes its messages with the build machine's source path; keep only the message.
  return pick.map((l) => l.replace(/^[A-Z]:\\a\\sherpa-onnx\\\S+?:\w+:\d+\s*/, '').replace(/^\/\S+\/sherpa-onnx\/csrc\/\S+?:\w+:\d+\s*/, '')).join(' ').slice(0, 500);
}

/**
 * Text for a command-line argument that a Windows program reads as bytes in code page `cp` and then
 * decodes as UTF-8: the UTF-8 bytes, read as that single-byte code page. With the UTF-8 code page
 * (65001) or text that is plain ASCII, the text is returned as it is.
 */
export function argForAnsi(text: string, cp: number): string {
  if (cp === 65001 || /^[\x00-\x7f]*$/.test(text)) return text;
  if (cp !== 1252 && cp !== 28591) return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x00-\x7f]/g, ' ');
  let out = '';
  for (const b of new TextEncoder().encode(text)) out += b >= 0x80 && b <= 0x9f && cp === 1252 ? CP1252_HIGH[b - 0x80] : String.fromCharCode(b);
  return out;
}

/** Windows-1252 bytes 0x80–0x9F as Unicode (the five unused bytes map to the C1 characters, as Windows does). */
const CP1252_HIGH = '\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178';

export class Builtins {
  private jobs = new Map<string, Job>();
  private ctrls = new Map<string, AbortController>();
  private seq = 0;
  private chat: ChatServer = { state: 'stopped' };
  private chatProc: Subprocess | null = null;
  private chatStarting: Promise<string> | null = null;
  private releaseCache = new Map<BuiltinId, { at: number; data: ReturnType<typeof parseReleases> }>();
  private imageBusy = false;

  constructor(private d: Deps) {}

  // ── Paths ────────────────────────────────────────────────────────────
  get enginesDir() { return join(this.d.studio, 'Engines'); }
  get modelsDir() { return join(this.d.studio, 'Models'); }
  private stateFile() { return join(this.enginesDir, 'builtin.json'); }
  private manifestFile() { return join(this.modelsDir, 'models.json'); }
  imagePath = (folder: ImageFolder, file: string) => join(this.modelsDir, 'image', folder, file);

  private engines(): Partial<Record<BuiltinId, EngineRecord>> { return readJson(this.stateFile(), {}); }
  private manifest(): Record<string, InstalledModel> { return readJson<{ installed?: Record<string, InstalledModel> }>(this.manifestFile(), {}).installed ?? {}; }
  private saveManifest(m: Record<string, InstalledModel>) { writeJson(this.manifestFile(), { version: 1, installed: m }); }

  machine(): Promise<Machine> { return this.d.machine ? this.d.machine() : readMachine(); }

  /** Creates the folder layout so the user can find (and drop files into) it from the start. */
  ensureFolders() {
    for (const f of IMAGE_FOLDERS) mkdirSync(join(this.modelsDir, 'image', f), { recursive: true });
    for (const f of ['chat', 'voice']) mkdirSync(join(this.modelsDir, f), { recursive: true });
    mkdirSync(this.enginesDir, { recursive: true });
  }

  // ── Status ───────────────────────────────────────────────────────────
  engineInfo(id: BuiltinId) {
    const r = this.engines()[id];
    const present = !!r && Object.values(r.exes).every((p) => existsSync(p));
    // An installed release Lotus can't use (sherpa-onnx 2.x) counts as not installed, with a note, so
    // the Models page offers Update and the first-run guide fetches the right one.
    const outdated = present && !releaseAccepted(id, r!.tag);
    return { id, name: RUNTIMES[id].name, role: RUNTIMES[id].role, licence: RUNTIMES[id].licence, installed: present && !outdated, outdated, note: outdated ? RUNTIMES[id].pinNote ?? null : null, version: r?.tag ?? null, flavour: r?.flavour ?? null, folder: join(this.enginesDir, ENGINE_DIR[id]) };
  }

  status() {
    return {
      engines: BUILTIN_ORDER.map((id) => this.engineInfo(id)),
      jobs: [...this.jobs.values()].sort((a, b) => b.started - a.started).slice(0, 20),
      chat: this.chat,
      studio: this.d.studio,
      modelsDir: this.modelsDir,
    };
  }

  private emit() { this.d.broadcast({ type: 'builtin', jobs: [...this.jobs.values()].sort((a, b) => b.started - a.started).slice(0, 20), chat: this.chat }); }

  private startJob(kind: Job['kind'], target: string, label: string, work: (job: Job, signal: AbortSignal) => Promise<void>): string {
    const running = [...this.jobs.values()].find((j) => j.target === target && j.state === 'running');
    if (running) return running.id;
    const job: Job = { id: `job${++this.seq}-${now().toString(36)}`, kind, target, label, state: 'running', done: 0, total: 0, step: 'Starting…', started: now() };
    const ctrl = new AbortController();
    this.jobs.set(job.id, job);
    this.ctrls.set(job.id, ctrl);
    this.emit();
    void (async () => {
      try { await work(job, ctrl.signal); job.state = 'done'; job.step = 'Done'; }
      catch (e) {
        if (ctrl.signal.aborted || (e as Error)?.name === 'AbortError') { job.state = 'stopped'; job.step = 'Stopped'; }
        else { job.state = 'error'; job.error = (e as Error)?.message || String(e); job.step = 'Failed'; this.d.log?.(`builtin ${target}: ${job.error}`); }
      } finally { this.ctrls.delete(job.id); this.emit(); }
    })();
    return job.id;
  }

  cancel(jobId: string) { this.ctrls.get(jobId)?.abort(); return true; }

  /** Waits for a job to finish (tests and the first-run guide's "install everything" step). */
  async wait(jobId: string, ms = 600_000): Promise<Job | undefined> {
    const t0 = now();
    for (;;) {
      const j = this.jobs.get(jobId);
      if (!j || j.state !== 'running' || now() - t0 > ms) return j;
      await Bun.sleep(50);
    }
  }

  private progress(job: Job) {
    let last = 0;
    return (p: { done: number; total: number }) => { job.done = p.done; job.total = p.total; if (now() - last > 400) { last = now(); this.emit(); } };
  }

  // ── Engines ──────────────────────────────────────────────────────────
  private async releases(id: BuiltinId, signal?: AbortSignal) {
    const hit = this.releaseCache.get(id);
    if (hit && now() - hit.at < 10 * 60_000) return hit.data;
    const api = this.d.githubApi ?? 'https://api.github.com';
    const f = this.d.fetch ?? fetch;
    let r: Response;
    try { r = await f(`${api}/repos/${RUNTIMES[id].repo}/releases?per_page=20`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'Lotus (local AI studio)' }, signal }); }
    catch (e) { if (signal?.aborted) throw e; throw new DownloadError(`Couldn't reach GitHub to find ${RUNTIMES[id].name}. Check the internet connection and try again.`); }
    if (r.status === 403 || r.status === 429) throw new DownloadError('GitHub is limiting requests from this network right now. Wait a few minutes and try again.');
    if (!r.ok) throw new DownloadError(`GitHub answered HTTP ${r.status} when Lotus asked for ${RUNTIMES[id].name}'s releases.`);
    const data = parseReleases(await r.json());
    // A pinned engine whose last usable release has dropped out of the newest 20: fetch it by name.
    const fb = RUNTIMES[id].fallbackTag;
    if (fb && !data.some((x) => releaseAccepted(id, x.tag) && x.assets.length)) {
      try {
        const t = await f(`${api}/repos/${RUNTIMES[id].repo}/releases/tags/${fb}`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'Lotus (local AI studio)' }, signal });
        if (t.ok) data.push(...parseReleases([await t.json()]));
      } catch (e) { if (signal?.aborted) throw e; }
    }
    this.releaseCache.set(id, { at: now(), data });
    return data;
  }

  installEngine(id: BuiltinId): string {
    const spec = RUNTIMES[id];
    return this.startJob('engine', `engine:${id}`, spec.name, async (job, signal) => {
      job.step = 'Checking this computer…'; this.emit();
      const m = await this.machine();
      job.step = 'Finding the latest release…'; this.emit();
      const found = pickRelease(id, await this.releases(id, signal), m);
      if (!found) throw new Error(`${spec.name} has no ready-made build for ${m.os === 'macos' ? 'this Mac' : `${m.os} on ${m.arch}`}. Use ${id === 'llama' ? 'Ollama' : id === 'sd' ? 'ComfyUI' : 'Voicebox'} instead (Settings → Engines).`);
      const { release, pick } = found;
      const root = join(this.enginesDir, ENGINE_DIR[id]);
      const target = join(root, release.tag.replace(/[^\w.-]/g, '_'));
      const dl = join(root, '_downloads');
      const assets = [pick.main, ...pick.extra];
      const total = assets.reduce((s, a) => s + a.size, 0);
      let before = 0;
      const files: string[] = [];
      for (const a of assets) {
        job.step = `Downloading ${a.name}`; this.emit();
        const base = before;
        files.push(await download(a.url, join(dl, a.name), { fetch: this.d.fetch, signal, expect: a.size || undefined, onProgress: (p) => this.progress(job)({ done: base + p.done, total: total || p.total }) }));
        before += a.size;
      }
      job.step = 'Unpacking…'; this.emit();
      removeTree(target);
      await unpack(files[0], target);
      const exes: Record<string, string> = {};
      for (const names of spec.exes) {
        const found2 = findFile(target, names.map((n) => exeName(n, m.os)));
        if (!found2) throw new Error(`The ${spec.name} download didn't contain ${names[0]}. Lotus left it in ${target} so you can look.`);
        makeExecutable(found2);
        exes[names[0]] = found2;
      }
      // CUDA runtime libraries go next to the programs so Windows finds them.
      const exeDir = dirname(Object.values(exes)[0]);
      for (const extra of files.slice(1)) await unpack(extra, exeDir);
      const state = this.engines();
      const old = state[id];
      state[id] = { tag: release.tag, flavour: pick.flavour, dir: target, exes, installedAt: now() };
      writeJson(this.stateFile(), state);
      if (old && old.dir !== target) removeTree(old.dir);
      for (const f of files) { try { rmSync(f, { force: true }); } catch { /* keep */ } }
      job.step = `${spec.name} ${release.tag} (${pick.flavour})`;
    });
  }

  removeEngine(id: BuiltinId) {
    if (id === 'llama') this.stopChat();
    const state = this.engines();
    const r = state[id];
    if (r) removeTree(join(this.enginesDir, ENGINE_DIR[id]));
    delete state[id];
    writeJson(this.stateFile(), state);
    this.emit();
    return true;
  }

  private exe(id: BuiltinId, name: string): string {
    const r = this.engines()[id];
    const p = r?.exes[name];
    if (!p || !existsSync(p)) throw new Error(`${RUNTIMES[id].name} isn't installed yet. Install it in Settings → Models (Engines), or let Lotus install it from the first-run guide.`);
    if (!releaseAccepted(id, r!.tag)) throw new Error(`${RUNTIMES[id].name} ${r!.tag} is installed, but ${RUNTIMES[id].pinNote ?? 'Lotus needs another version.'} Click Update in Settings → Models (Lotus Engines).`);
    return p;
  }

  // ── Models ───────────────────────────────────────────────────────────
  installed(): InstalledModel[] {
    const m = this.manifest();
    // Drop records whose files were deleted outside Lotus.
    return Object.values(m).filter((x) => x.files.every((f) => existsSync(join(this.modelsDir, f))));
  }

  /** Image files on disk per folder (for setups), including files the user dropped in by hand. */
  imageFiles(): Record<ImageFolder, { file: string; bytes: number }[]> {
    const out = {} as Record<ImageFolder, { file: string; bytes: number }[]>;
    for (const f of IMAGE_FOLDERS) {
      const dir = join(this.modelsDir, 'image', f);
      out[f] = listFiles(dir, /\.(safetensors|gguf|ckpt|pt|pth|bin|sft)$/i, 2).map((p) => ({ file: relative(dir, p).replace(/\\/g, '/'), bytes: (() => { try { return statSync(p).size; } catch { return 0; } })() })).sort((a, b) => a.file.localeCompare(b.file));
    }
    return out;
  }

  private record(m: InstalledModel) {
    const all = this.manifest();
    all[m.id] = m;
    this.saveManifest(all);
  }

  /** Adds the catalog image model's setup (profile) if the user has none for it yet. */
  private addProfile(e: LibEntry) {
    const p = profileForEntry(e);
    if (!p) return;
    let list: ImageProfile[] = [];
    try { list = JSON.parse(this.d.kvGet(PROFILES_KEY) || '[]'); } catch { list = []; }
    if (!Array.isArray(list)) list = [];
    if (list.some((x) => x.id === p.id)) return;
    this.d.kvSet(PROFILES_KEY, JSON.stringify([...list, p]));
  }

  /** A Hugging Face repo's files (and folders, marked `dir`) at its top level or in one folder. */
  private async hfFiles(repo: string, signal: AbortSignal, folder?: string): Promise<{ path: string; size?: number; dir?: boolean }[]> {
    const base = this.d.hfBase ?? 'https://huggingface.co';
    const f = this.d.fetch ?? fetch;
    let r: Response;
    try { r = await f(`${base}/api/models/${repo}/tree/main${folder ? `/${folder.split('/').map(encodeURIComponent).join('/')}` : ''}`, { headers: { 'user-agent': 'Lotus (local AI studio)' }, signal }); }
    catch (e) { if (signal.aborted) throw e; throw new DownloadError('Couldn\'t reach Hugging Face. Check the internet connection and try again.'); }
    if (r.status === 404 || r.status === 401) throw new DownloadError(`Hugging Face has no public model called ${repo}. Check the name (owner/model).`);
    if (!r.ok) throw new DownloadError(`Hugging Face answered HTTP ${r.status} for ${repo}.`);
    const j = (await r.json()) as { path?: string; size?: number; type?: string }[];
    return (Array.isArray(j) ? j : []).filter((x) => x.path).map((x) => (x.type === 'directory' ? { path: String(x.path), dir: true } : { path: String(x.path), size: Number(x.size) || undefined }));
  }

  private async fetchGguf(job: Job, signal: AbortSignal, repo: string, quant: string, mmproj: string | undefined, folder: string) {
    job.step = `Looking up ${repo}…`; this.emit();
    const top = await this.hfFiles(repo, signal);
    let list = top.filter((x) => !x.dir);
    let pick = pickGguf(list, quant, mmproj);
    // Big models are split into parts inside a folder named for the quantisation (Q4_K_M/…-00001-of-00003.gguf).
    const sub = pick.model ? undefined : quantFolder(top, quant);
    if (sub) { list = [...list, ...(await this.hfFiles(repo, signal, sub)).filter((x) => !x.dir)]; pick = pickGguf(list, quant, mmproj); }
    if (!pick.model) throw new DownloadError(`${repo} has no ${quant} GGUF file. Try another quantisation, e.g. ${repo}:Q4_K_M.`);
    const base = this.d.hfBase ?? 'https://huggingface.co';
    const parts = [...(pick.parts ?? [pick.model]), ...(pick.mmproj ? [pick.mmproj] : [])];
    const total = parts.reduce((s, p) => s + (p.size ?? 0), 0);
    let before = 0;
    const out: string[] = [];
    for (const p of parts) {
      const rel = `chat/${folder}/${basename(p.path)}`;
      job.step = `Downloading ${basename(p.path)}`; this.emit();
      const b = before;
      await download(`${base}/${repo}/resolve/main/${p.path}`, join(this.modelsDir, rel), { fetch: this.d.fetch, signal, expect: p.size, onProgress: (x) => this.progress(job)({ done: b + x.done, total: total || x.total }) });
      before += p.size ?? 0;
      out.push(rel);
    }
    return { gguf: out[0], mmproj: pick.mmproj ? out[out.length - 1] : undefined, files: out };
  }

  installModel(id: string): string {
    const e = entryById(id);
    if (!e?.builtin) throw new Error(`Lotus can't download ${id} itself. Pick it with its own engine (Ollama, ComfyUI or Voicebox).`);
    return this.startJob('model', `model:${id}`, e.title, async (job, signal) => {
      if (e.builtin!.gguf) {
        const g = e.builtin!.gguf;
        const r = await this.fetchGguf(job, signal, g.repo, g.quant, g.mmproj, slug(e.id));
        this.record({ id: e.id, kind: e.kind, title: e.title, files: r.files, gguf: r.gguf, mmproj: r.mmproj, entryId: e.id, source: g.repo, bytes: r.files.reduce((s, f) => s + (statSync(join(this.modelsDir, f)).size || 0), 0), at: now() });
        return;
      }
      const files = e.builtin!.files ?? [];
      const total = files.reduce((s, f) => s + f.gb * 1e9, 0);
      let before = 0;
      const kept: string[] = [];
      let dir: string | undefined;
      for (const f of files) {
        const b = before;
        const onProgress = (x: { done: number; total: number }) => this.progress(job)({ done: b + x.done, total: Math.max(total, b + x.total) });
        if (f.archive) {
          const folder = join(this.modelsDir, f.path);
          dir = f.path;
          if (existsSync(folder) && listFiles(folder, /\.onnx$/i, 3).length) { kept.push(f.path); before += f.gb * 1e9; continue; }
          const ext = /\.tar\.bz2$/i.test(f.url) ? '.tar.bz2' : /\.zip$/i.test(f.url) ? '.zip' : '.tar.gz';
          const tmp = join(this.modelsDir, '_downloads', `${basename(f.path)}${ext}`);
          job.step = `Downloading ${e.title}`; this.emit();
          await download(f.url, tmp, { fetch: this.d.fetch, signal, onProgress });
          job.step = 'Unpacking…'; this.emit();
          removeTree(folder);
          await unpack(tmp, folder);
          try { rmSync(tmp, { force: true }); } catch { /* keep */ }
          kept.push(f.path);
        } else {
          job.step = `Downloading ${basename(f.path)}`; this.emit();
          await download(f.url, join(this.modelsDir, f.path), { fetch: this.d.fetch, signal, onProgress });
          kept.push(f.path);
        }
        before += f.gb * 1e9;
      }
      const bytes = kept.reduce((s, p) => { const full = join(this.modelsDir, p); try { return s + (statSync(full).isDirectory() ? folderBytes(full) : statSync(full).size); } catch { return s; } }, 0);
      this.record({ id: e.id, kind: e.kind, title: e.title, files: kept, dir, entryId: e.id, bytes, at: now() });
      if (e.kind === 'image') this.addProfile(e);
    });
  }

  /**
   * A model that isn't in the catalog: a Hugging Face GGUF repo (chat), or a link to one file.
   * Image files go to the folder the user picked (checkpoints, vae, loras…).
   */
  installCustom(a: { source: string; kind: ModelKind; folder?: ImageFolder; title?: string }): string {
    const src = parseCustomSource(a.source);
    if (!src) throw new Error('Paste a Hugging Face model name (owner/model or owner/model:Q5_K_M) or an https link to a .gguf, .safetensors or .onnx file.');
    if (src.type === 'hf-gguf' && a.kind !== 'chat') throw new Error('A model name without a file is read as a chat model (GGUF). For image or voice files, paste the link to the file itself.');
    const label = a.title || (src.type === 'hf-gguf' ? `${src.repo} (${src.quant})` : src.fileName);
    const id = `custom-${slug(src.type === 'hf-gguf' ? `${src.repo}-${src.quant}` : src.fileName)}`;
    return this.startJob('model', `model:${id}`, label, async (job, signal) => {
      if (src.type === 'hf-gguf') {
        const r = await this.fetchGguf(job, signal, src.repo, src.quant, 'F16', slug(`${src.repo.split('/').pop()}-${src.quant}`));
        this.record({ id, kind: 'chat', title: label, files: r.files, gguf: r.gguf, mmproj: r.mmproj, custom: true, source: src.repo, bytes: r.files.reduce((s, f) => s + statSync(join(this.modelsDir, f)).size, 0), at: now() });
        return;
      }
      let rel: string;
      if (a.kind === 'image') rel = `image/${a.folder ?? 'checkpoints'}/${src.fileName}`;
      else if (a.kind === 'chat') {
        if (!/\.gguf$/i.test(src.fileName)) throw new Error('Built-in chat runs GGUF files. Pick the .gguf link (or use Ollama for other formats).');
        rel = `chat/${slug(src.fileName.replace(/\.gguf$/i, ''))}/${src.fileName}`;
      } else rel = `voice/${slug(src.fileName)}/${src.fileName}`;
      job.step = `Downloading ${src.fileName}`; this.emit();
      await download(src.url, join(this.modelsDir, rel), { fetch: this.d.fetch, signal, onProgress: this.progress(job) });
      // Image files are listed straight from their folders (setups pick them); only chat and voice need a record.
      if (a.kind !== 'image') this.record({ id, kind: a.kind, title: label, files: [rel], gguf: a.kind === 'chat' ? rel : undefined, dir: a.kind === 'chat' ? undefined : dirname(rel), custom: true, source: src.url, bytes: statSync(join(this.modelsDir, rel)).size, at: now() });
    });
  }

  removeModel(id: string) {
    const all = this.manifest();
    const m = all[id];
    if (!m) return false;
    if (this.chat.model === id) this.stopChat();
    // Shared image files (one text encoder for two models) stay while another installed model uses them.
    const others = new Set(Object.values(all).filter((x) => x.id !== id).flatMap((x) => x.files));
    for (const f of m.files) if (!others.has(f)) removeTree(join(this.modelsDir, f));
    if (m.gguf) { try { const d = dirname(join(this.modelsDir, m.gguf)); if (!readdirSync(d).length) rmSync(d, { recursive: true }); } catch { /* keep */ } }
    delete all[id];
    this.saveManifest(all);
    this.emit();
    return true;
  }

  removeImageFile(folder: ImageFolder, file: string) {
    if (!IMAGE_FOLDERS.includes(folder) || file.includes('..')) return false;
    const p = join(this.modelsDir, 'image', folder, file);
    if (!existsSync(p)) return false;
    rmSync(p, { force: true });
    return true;
  }

  // ── Chat (llama-server) ──────────────────────────────────────────────
  chatStatus() { return this.chat; }

  /**
   * Starts llama-server with this model (or reuses the running one) and returns its address.
   * `auto`: size the context to the memory free for it (Settings → Auto). `grow`: a conversation
   * needs this much context; keep it even if it is more than fits.
   */
  ensureChat(modelId: string, o: { ctx?: number; auto?: boolean; grow?: boolean } = {}): Promise<string> {
    const running = this.chat.state === 'ready' && this.chat.model === modelId && this.chatProc && this.chatProc.exitCode === null && this.chat.url ? this.chat.url : null;
    if (this.chatStarting && this.chat.model === modelId) return this.chatStarting;
    if (o.auto) {
      if (running && (this.chat.auto || this.chat.grown)) return Promise.resolve(running);
      return (async () => {
        // A server started by hand with a context too big for the GPU is restarted at the size that fits.
        if (running) { try { if ((this.chat.ctx ?? 0) <= (await this.chatFit(modelId)).ctx) return running; } catch { return running; } }
        return this.launchChat(modelId, o);
      })();
    }
    // Reuse the running server unless it was started with a smaller context than this asks for.
    const want = Math.min(MAX_CHAT_CTX, Math.max(MIN_CHAT_CTX, o.ctx ?? 0));
    if (running && (this.chat.ctx ?? 0) >= want) return Promise.resolve(running);
    return this.launchChat(modelId, o);
  }

  private launchChat(modelId: string, o: { ctx?: number; auto?: boolean; grow?: boolean }): Promise<string> {
    if (this.chatStarting && this.chat.model === modelId) return this.chatStarting;
    this.chatStarting = this.startChat(modelId, o).finally(() => { this.chatStarting = null; });
    return this.chatStarting;
  }

  /** Video memory kept for other apps (Settings → Auto-scale), in MB. */
  private reserveMb(): number {
    try { const v = Number(JSON.parse(this.d.kvGet('lotus.settings.v1') || '{}').vramReserveMb); if (Number.isFinite(v) && v >= 0) return Math.min(v, 16384); } catch { /* default */ }
    return 1024;
  }

  /** Memory the chat model may use right now, in MB; null when it can't be told (no GPU reading, no GPU). */
  private async chatBudgetMb(): Promise<number | null> {
    const reserve = this.reserveMb();
    // What our own running server holds is free for the model that replaces it.
    const own = this.chatProc && this.chatProc.exitCode === null ? this.chat.memMb ?? 0 : 0;
    const gpu = await (this.d.gpuMemory ?? gpuMemory)().catch(() => null);
    if (gpu) return gpu.totalMb - gpu.usedMb + own - reserve;
    const mc = await this.machine();
    // Apple silicon: Metal lets one app use about 70 % of the shared memory.
    if (mc.unified) return mc.ramGb * 1024 * 0.7 - reserve;
    // A GPU with no live reading (Intel, AMD on Windows): its size minus what the desktop usually takes.
    if (mc.vramGb > 0) return mc.vramGb * 1024 - 512 - reserve;
    return null;
  }

  private modelFiles(modelId: string) {
    const m = this.manifest()[modelId];
    if (!m?.gguf) throw new Error(`${modelId} isn't downloaded for the built-in engine. Get it in Settings → Models.`);
    const size = (rel?: string) => { try { return rel ? statSync(join(this.modelsDir, rel)).size / MB : 0; } catch { return 0; } };
    return { m, gguf: m.gguf, info: readGgufInfo(join(this.modelsDir, m.gguf)), weightsMb: size(m.gguf) + size(m.mmproj), hasVision: !!m.mmproj };
  }

  /** The context the built-in chat engine can give this model on this computer right now. */
  async chatFit(modelId: string): Promise<ChatFit> {
    const f = this.modelFiles(modelId);
    return fitChatCtx({ info: f.info, weightsMb: f.weightsMb, hasVision: f.hasVision, budgetMb: await this.chatBudgetMb(), min: MIN_CHAT_CTX, max: MAX_CHAT_CTX });
  }

  private async startChat(modelId: string, o: { ctx?: number; auto?: boolean; grow?: boolean }): Promise<string> {
    const prev = this.chatProc;
    this.stopChat(false);
    const { m, gguf, info, weightsMb, hasVision } = this.modelFiles(modelId);
    // Measure free memory only once the old server has let go of its share.
    if (prev && o.auto) { await Promise.race([prev.exited, Bun.sleep(5000)]); await Bun.sleep(500); }
    let fit: ChatFit | undefined;
    try { fit = await this.chatFit(modelId); } catch { fit = undefined; }
    const ctx = o.auto && fit ? fit.ctx : Math.min(MAX_CHAT_CTX, Math.max(MIN_CHAT_CTX, o.ctx ?? 0));
    const memMb = memoryMb(info, weightsMb, hasVision, ctx);
    const exe = this.exe('llama', 'llama-server');
    const port = await freePort();
    const args = ['-m', join(this.modelsDir, gguf), '--host', '127.0.0.1', '--port', String(port), '-c', String(ctx), '-np', '1', '--alias', modelId, '--no-webui', '--jinja'];
    if (m.mmproj) args.push('--mmproj', join(this.modelsDir, m.mmproj));
    // 0.14.2: llama-server separates thinking from the answer (<think>…</think> → reasoning_content) even
    // for templates it doesn't recognise; before, a model's thinking streamed into Chat's answer.
    if ((await this.sdcppHelp(exe)).includes('--reasoning-format')) args.push('--reasoning-format', 'deepseek');
    const logPath = join(this.enginesDir, ENGINE_DIR.llama, 'server.log');
    mkdirSync(dirname(logPath), { recursive: true });
    const how = { auto: !!o.auto, grown: !!o.grow, fit, memMb };
    this.chat = { state: 'starting', model: modelId, port, ctx, ...how };
    this.emit();
    this.d.log?.(`llama-server: ${gguf} on ${port}, context ${ctx}${fit?.budgetMb != null ? ` (about ${memMb} MB of ${fit.budgetMb} MB free${fit.fits ? '' : '; the model is bigger than that, so part of it runs on the CPU'})` : ''}`);
    const proc = Bun.spawn([exe, ...args], { cwd: dirname(exe), stdout: Bun.file(logPath), stderr: Bun.file(logPath), stdin: 'ignore', windowsHide: true });
    this.chatProc = proc;
    const url = `http://127.0.0.1:${port}`;
    const f = this.d.fetch ?? fetch;
    const t0 = now();
    while (now() - t0 < 300_000) {
      if (proc.exitCode !== null || this.chatProc !== proc) {
        const tail = (() => { try { return readFileSync(logPath, 'utf8').split('\n').filter((l) => /error|failed|unable|out of memory/i.test(l)).slice(-3).join(' '); } catch { return ''; } })();
        const msg = `The built-in chat engine stopped while loading ${m.title}${tail ? `: ${tail.slice(0, 300)}` : ''}. The model may be too big for this computer; try a smaller one.`;
        if (this.chatProc === proc) { this.chat = { state: 'error', model: modelId, error: msg }; this.chatProc = null; this.emit(); }
        throw new Error(msg);
      }
      try { const r = await f(`${url}/health`, { signal: AbortSignal.timeout(2000) }); if (r.ok) { this.chat = { state: 'ready', model: modelId, url, port, ctx, ...how }; this.emit(); return url; } } catch { /* loading */ }
      await Bun.sleep(400);
    }
    this.stopChat();
    throw new Error(`${m.title} took more than five minutes to load, so Lotus stopped waiting.`);
  }

  stopChat(emit = true) {
    const p = this.chatProc;
    this.chatProc = null;
    if (p && p.exitCode === null) { try { p.kill(); } catch { /* gone */ } }
    this.chat = { state: 'stopped' };
    if (emit) this.emit();
    return true;
  }

  /** Stops llama-server and waits until it has really exited and the GPU driver has freed its memory. */
  async stopChatAndWait(): Promise<void> {
    const p = this.chatProc;
    this.stopChat();
    if (!p) return;
    await Promise.race([p.exited, Bun.sleep(10_000)]);
    await Bun.sleep(1500);
  }

  // ── Images (sd-cli) ──────────────────────────────────────────────────
  profiles(): ImageProfile[] {
    try { const l = JSON.parse(this.d.kvGet(PROFILES_KEY) || '[]'); return Array.isArray(l) ? l : []; } catch { return []; }
  }

  /** Missing files for a profile, as "VAE (ae.safetensors)" phrases. */
  missingFiles(p: ImageProfile): string[] {
    const label: Record<Slot, string> = { model: 'the model file', vae: 'VAE', clip_l: 'CLIP-L', clip_g: 'CLIP-G', t5xxl: 'T5-XXL', llm: 'text encoder' };
    return missingFor(p, (folder, file) => existsSync(this.imagePath(folder, file))).map((s) => (p.files[s] ? `${label[s]} (${p.files[s]})` : label[s]));
  }

  private sdHelp = new Map<string, Promise<string>>();
  /** A program's --help text (cached per program: sd-cli, llama-server), to use only the switches the installed build knows. */
  private sdcppHelp(exe: string): Promise<string> {
    let hit = this.sdHelp.get(exe);
    if (!hit) {
      hit = (async () => {
        try {
          const proc = Bun.spawn([exe, '--help'], { cwd: dirname(exe), stdout: 'pipe', stderr: 'pipe', stdin: 'ignore', windowsHide: true });
          // A program that doesn't stop after --help mustn't hold up a chat or an image.
          const kill = setTimeout(() => { try { proc.kill(); } catch { /* gone */ } }, 8000);
          const [out, err] = await Promise.all([new Response(proc.stdout as ReadableStream).text(), new Response(proc.stderr as ReadableStream).text()]);
          await proc.exited;
          clearTimeout(kill);
          return `${out}\n${err}`;
        } catch { return ''; }
      })();
      this.sdHelp.set(exe, hit);
    }
    return hit;
  }

  async generateImage(p: ImageProfile, run: Omit<SdRun, 'output' | 'lowVram' | 'autoFit'>, o: { signal?: AbortSignal; onProgress?: (step: number, total: number) => void; loras?: LoraUse[] } = {}): Promise<string[]> {
    const exe = this.exe('sd', 'sd-cli');
    const missing = this.missingFiles(p);
    if (missing.length) throw new Error(`${p.name} is missing ${missing.join(', ')}. Open Settings → Models → Image Setups to fix it.`);
    if (this.imageBusy) throw new Error('The built-in image engine is already making an image. Wait for it to finish.');
    this.imageBusy = true;
    const m = await this.machine();
    // A chat model holding the GPU's memory makes big image models fail or crawl: unload it first on
    // GPUs under 16 GB, and on Macs up to 32 GB, where chat and images share the same memory (Metal
    // ran out with both loaded, 0.10.5). It loads again on the next message.
    if (this.chat.state !== 'stopped' && m.vramGb > 0 && (m.unified ? m.vramGb <= 32 : m.vramGb < 16)) await this.stopChatAndWait();
    const outDir = join(this.enginesDir, ENGINE_DIR.sd, 'out', `${now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(outDir, { recursive: true });
    let lowVram = m.gpu === 'none' || (!m.unified && m.vramGb > 0 && m.vramGb < 12);
    const vaeTiling = m.unified && m.vramGb <= 32;
    const help = await this.sdcppHelp(exe);
    const autoFit = help.includes('--auto-fit');
    // Out of memory with the low-memory switches too (0.14.2): once more with 3 GiB spare and the CFG
    // branches run one after the other (when this sd-cli has the switch).
    let tight = false;
    const logPath = join(this.enginesDir, ENGINE_DIR.sd, 'last-run.log');
    let log = '';
    try {
     // Ran out of memory with the normal switches: try once more with the low-memory ones.
     for (let attempt = 0; ; attempt++) {
      const args = sdcppArgs(p, { ...run, output: join(outDir, 'lotus.png'), lowVram, autoFit, vaeTiling: vaeTiling || attempt > 0, ...(tight ? { reserveGb: 3, ...(help.includes('--batched-cfg') ? { batchedCfg: false } : {}) } : {}) }, this.imagePath, o.loras ?? []);
      log = '';
      const proc = Bun.spawn([exe, ...args], { cwd: dirname(exe), stdout: 'pipe', stderr: 'pipe', stdin: 'ignore', windowsHide: true });
      const onAbort = () => { try { proc.kill(); } catch { /* gone */ } };
      o.signal?.addEventListener('abort', onAbort, { once: true });
      const read = async (s: ReadableStream<Uint8Array>) => {
        const dec = new TextDecoder();
        for await (const chunk of s) {
          const text = dec.decode(chunk, { stream: true });
          log += text;
          if (log.length > 200_000) log = log.slice(-100_000);
          for (const part of text.split(/[\r\n]+/)) { const pr = sdcppProgress(part); if (pr) o.onProgress?.(pr.step, pr.total); }
        }
      };
      await Promise.all([read(proc.stdout as ReadableStream<Uint8Array>), read(proc.stderr as ReadableStream<Uint8Array>)]);
      const code = await proc.exited;
      o.signal?.removeEventListener('abort', onAbort);
      try { writeFileSync(logPath, log); } catch { /* best effort */ }
      if (o.signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      const made = readdirSync(outDir).filter((f) => /\.png$/i.test(f)).sort().map((f) => join(outDir, f));
      if (code !== 0 || !made.length) {
        const oom = sdcppMemoryError(log, m.vramGb);
        if (oom && attempt === 0 && !lowVram) { lowVram = true; this.d.log?.('sd-cli ran out of memory; retrying with low-memory switches'); continue; }
        if (oom && lowVram && autoFit && !tight && attempt < 2) { tight = true; this.d.log?.('sd-cli ran out of memory; retrying with more video memory spare'); continue; }
        if (oom) throw new Error(`${oom} The full log is in ${logPath}.`);
        const why = log.split(/[\r\n]+/).filter((l) => /error|fail|not found|unknown/i.test(l)).slice(-3).join(' ').slice(0, 400);
        throw new Error(`The built-in image engine didn't make an image${why ? `: ${why}` : ''}. The full log is in ${logPath}.`);
      }
      return made;
     }
    } finally { this.imageBusy = false; }
  }

  /** Removes a finished run's output folder once its images are saved to Lotus Studio/Images. */
  cleanOutputs(paths: string[]) { const dirs = new Set(paths.map((p) => dirname(p))); for (const d of dirs) removeTree(d); }

  // ── Voice (sherpa-onnx) ──────────────────────────────────────────────
  private voiceDir(id: string): string {
    const m = this.manifest()[id];
    const dir = m?.dir ? join(this.modelsDir, m.dir) : null;
    if (!dir || !existsSync(dir)) throw new Error(`The voice model ${id} isn't downloaded. Get it in Settings → Models.`);
    return dir;
  }

  /**
   * Arguments for sherpa-onnx-offline-tts for a downloaded voice model:
   *   Kokoro (voices.bin) and Piper (VITS) speak with their own speakers;
   *   PocketTTS (lm_main*.onnx) and ZipVoice (lexicon.txt + a Vocos vocoder) copy the voice in a
   *   reference recording (voice cloning; ZipVoice also needs what is said in it).
   */
  ttsArgs(dir: string, text: string, out: string, speaker = 0, speed = 1, ref?: { audio: string; text?: string; steps?: number }): string[] {
    const data = (() => { const f = findFile(dir, ['phontab'], 4); return f ? dirname(f) : ''; })();
    const tokens = findFile(dir, ['tokens.txt'], 3);
    const voices = findFile(dir, ['voices.bin'], 3);
    const scale = String(Math.round((1 / Math.max(0.5, Math.min(2, speed))) * 100) / 100);
    const onnx = (re: RegExp) => { const all = listFiles(dir, re, 3); return all.find((f) => /int8/i.test(f)) ?? all[0]; };
    const tail = ['--num-threads=4', `--output-filename=${out}`, text];
    const pocketMain = onnx(/lm_main.*\.onnx$/i);
    if (pocketMain) {
      if (!ref?.audio) throw new Error('PocketTTS copies a voice from a recording. Pick one of your voices, or make one in Voice → Voices.');
      const need = { flow: onnx(/lm_flow.*\.onnx$/i), enc: onnx(/(^|[\\/])encoder.*\.onnx$/i), dec: onnx(/(^|[\\/])decoder.*\.onnx$/i), cond: onnx(/text_conditioner.*\.onnx$/i), vocab: listFiles(dir, /vocab\.json$/i, 3)[0], scores: listFiles(dir, /token_scores\.json$/i, 3)[0] };
      if (Object.values(need).some((v) => !v)) throw new Error('That PocketTTS download is incomplete. Remove it in Settings → Models and download it again.');
      return [`--pocket-lm-flow=${need.flow}`, `--pocket-lm-main=${pocketMain}`, `--pocket-encoder=${need.enc}`, `--pocket-decoder=${need.dec}`, `--pocket-text-conditioner=${need.cond}`,
        `--pocket-vocab-json=${need.vocab}`, `--pocket-token-scores-json=${need.scores}`, `--reference-audio=${ref.audio}`, `--num-steps=${Math.max(1, Math.min(8, ref.steps ?? 2))}`, ...tail];
    }
    const lexicon = listFiles(dir, /lexicon\.txt$/i, 3)[0];
    const vocoder = listFiles(dir, /vocos.*\.onnx$/i, 3)[0];
    if (lexicon && vocoder) {
      if (!ref?.audio) throw new Error('ZipVoice copies a voice from a recording. Pick one of your voices, or make one in Voice → Voices.');
      if (!ref.text?.trim()) throw new Error('ZipVoice needs the words spoken in the voice\'s recording. Add them in Voice → Voices (Lotus can transcribe them with Whisper).');
      const enc = onnx(/encoder.*\.onnx$/i), dec = onnx(/decoder.*\.onnx$/i);
      if (!enc || !dec || !tokens) throw new Error('That ZipVoice download is incomplete. Remove it in Settings → Models and download it again.');
      return [`--zipvoice-encoder=${enc}`, `--zipvoice-decoder=${dec}`, ...(data ? [`--zipvoice-data-dir=${data}`] : []), `--zipvoice-lexicon=${lexicon}`, `--zipvoice-tokens=${tokens}`,
        `--zipvoice-vocoder=${vocoder}`, `--reference-audio=${ref.audio}`, `--reference-text=${ref.text.replace(/\s+/g, ' ').trim()}`, `--num-steps=${Math.max(1, Math.min(16, ref.steps ?? 4))}`, ...tail];
    }
    if (voices) {
      const model = listFiles(dir, /^model.*\.onnx$/i, 3)[0] ?? listFiles(dir, /\.onnx$/i, 3)[0];
      if (!model || !tokens) throw new Error('That Kokoro download is incomplete. Remove it in Settings → Models and download it again.');
      return [`--kokoro-model=${model}`, `--kokoro-voices=${voices}`, `--kokoro-tokens=${tokens}`, ...(data ? [`--kokoro-data-dir=${data}`] : []), `--kokoro-length-scale=${scale}`, `--sid=${speaker}`, ...tail];
    }
    const model = listFiles(dir, /\.onnx$/i, 3).find((f) => !/encoder|decoder/i.test(f));
    if (!model || !tokens) throw new Error('That voice download is incomplete. Remove it in Settings → Models and download it again.');
    return [`--vits-model=${model}`, `--vits-tokens=${tokens}`, ...(data ? [`--vits-data-dir=${data}`] : []), `--vits-length-scale=${scale}`, `--sid=${speaker}`, ...tail];
  }

  /** Speaks text with a built-in voice; returns the WAV file's path. `ref` = a reference recording for cloning models. */
  async speak(voiceId: string, text: string, o: { speaker?: number; speed?: number; signal?: AbortSignal; ref?: { audio: string; text?: string; steps?: number } } = {}): Promise<string> {
    const exe = this.exe('sherpa', 'sherpa-onnx-offline-tts');
    const dir = this.voiceDir(voiceId);
    const out = join(this.enginesDir, ENGINE_DIR.sherpa, 'out', `${now().toString(36)}.wav`);
    mkdirSync(dirname(out), { recursive: true });
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, 4000);
    if (!clean) throw new Error('There is nothing to say.');
    const args = this.ttsArgs(dir, clean, out, o.speaker ?? 0, o.speed ?? 1, o.ref);
    // sherpa-onnx's programs read their arguments as bytes in the system code page on Windows, then
    // treat them as UTF-8, so "olá" arrived broken (seen on 0.8.0). Pass the text (and a reference
    // transcript) so that the code page conversion yields its UTF-8 bytes.
    if (process.platform === 'win32') {
      const cp = await windowsAnsiCodePage();
      args[args.length - 1] = argForAnsi(args[args.length - 1], cp);
      const i = args.findIndex((x) => x.startsWith('--reference-text='));
      if (i >= 0) args[i] = `--reference-text=${argForAnsi(args[i].slice('--reference-text='.length), cp)}`;
      // espeak-ng (Piper, Kokoro and ZipVoice pronunciations) couldn't read a data folder whose path has a
      // space or an accent on some PCs ("Failed to convert … to token IDs", 0.9.0): give it the short path.
      for (let k = 0; k < args.length; k++) {
        const m = /^(--(?:vits|kokoro|zipvoice)-data-dir=)(.+)$/.exec(args[k]);
        if (m) args[k] = m[1] + await windowsShortPath(m[2]);
      }
    }
    await this.runTool(exe, args, o.signal);
    if (!existsSync(out)) throw new Error('The built-in voice engine finished without making any audio.');
    return out;
  }

  /** Arguments for sherpa-onnx-offline with a Whisper model folder. */
  sttArgs(dir: string, wav: string, language?: string): string[] {
    const pick = (re: RegExp) => { const all = listFiles(dir, re, 3); return all.find((f) => /int8/i.test(f)) ?? all[0]; };
    const enc = pick(/encoder.*\.onnx$/i);
    const dec = pick(/decoder.*\.onnx$/i);
    const tokens = listFiles(dir, /tokens\.txt$/i, 3)[0];
    if (!enc || !dec || !tokens) throw new Error('That dictation model download is incomplete. Remove it in Settings → Models and download it again.');
    return [`--whisper-encoder=${enc}`, `--whisper-decoder=${dec}`, `--tokens=${tokens}`, ...(language ? [`--whisper-language=${language}`] : []), '--whisper-task=transcribe', '--num-threads=4', wav];
  }

  async transcribe(modelId: string, wav: string, o: { language?: string; signal?: AbortSignal; warm?: boolean } = {}): Promise<string> {
    const exe = this.exe('sherpa', 'sherpa-onnx-offline');
    const args = this.sttArgs(this.voiceDir(modelId), wav, o.language);
    // Calls (and anything that asks for it) use a server that keeps Whisper loaded (0.15.0).
    if (o.warm) {
      const text = await this.stt.transcribe(this.sttServerExe(exe), this.warmSttArgs(args), wav, o.signal).catch((e) => { if ((e as Error).name === 'AbortError') throw e; return null; });
      if (text !== null) return text;
    }
    const out = await this.runTool(exe, args, o.signal);
    return parseSherpaText(out);
  }

  /** Loads Whisper into a warm dictation server ahead of time (a call starting); false when it can't. */
  async warmDictation(modelId: string, language?: string): Promise<boolean> {
    const exe = this.exe('sherpa', 'sherpa-onnx-offline');
    return this.stt.warm(this.sttServerExe(exe), this.warmSttArgs(this.sttArgs(this.voiceDir(modelId), 'x.wav', language)));
  }

  private stt = new SttServers({ freePort, log: (s) => this.d.log?.(s) });
  private sttServerExe = (offline: string) => join(dirname(offline), basename(offline).replace('sherpa-onnx-offline', 'sherpa-onnx-offline-websocket-server'));
  /** The one-off program's arguments without the file, for the server (which takes audio over the socket). */
  private warmSttArgs = (args: string[]) => ['--model-type=whisper', ...args.slice(0, -1).filter((a) => !a.startsWith('--num-threads='))];

  private async runTool(exe: string, args: string[], signal?: AbortSignal): Promise<string> {
    // sherpa-onnx echoes its whole command line first; with long Windows paths that echo filled the
    // error message and hid the cause (0.9.1). Options must come before the text, so insert it first.
    const proc = Bun.spawn([exe, '--print-args=false', ...args], { cwd: dirname(exe), stdout: 'pipe', stderr: 'pipe', stdin: 'ignore', windowsHide: true });
    const onAbort = () => { try { proc.kill(); } catch { /* gone */ } };
    signal?.addEventListener('abort', onAbort, { once: true });
    const [out, err] = await Promise.all([new Response(proc.stdout as ReadableStream).text(), new Response(proc.stderr as ReadableStream).text()]);
    const code = await proc.exited;
    signal?.removeEventListener('abort', onAbort);
    if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
    if (code !== 0) throw new Error(`${basename(exe)} failed: ${failureLines(`${out}\n${err}`)}`);
    return `${out}\n${err}`;
  }

  /** Stops everything this manager started (the core is shutting down). */
  shutdown() { this.stopChat(false); this.stt.stopAll(); for (const c of this.ctrls.values()) c.abort(); }

  /** Size of every image setup's needed files (for the Models page). */
  sizeFor = sizeFor;
}
