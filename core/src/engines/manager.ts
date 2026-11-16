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
import { BUILTIN_ORDER, BuiltinId, exeName, parseReleases, pickRelease, RUNTIMES } from './assets';
import { download, DownloadError, findFile, folderBytes, listFiles, makeExecutable, removeTree, unpack, type FetchFn } from './files';
import { readMachine, type Machine } from './machine';
import { entryById, parseCustomSource, pickGguf, profileForEntry, type LibEntry, type ModelKind } from '../../../src/models/library';
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

export interface ChatServer { state: 'stopped' | 'starting' | 'ready' | 'error'; model?: string; url?: string; error?: string; port?: number }

interface Deps {
  studio: string;
  broadcast: (e: Record<string, unknown>) => void;
  kvGet: (k: string) => string | null;
  kvSet: (k: string, v: string) => void;
  fetch?: FetchFn;
  log?: (m: string) => void;
  /** Tests: a fixed machine and where to look for releases. */
  machine?: () => Promise<Machine>;
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

/** The lines of a tool's output that say what went wrong (sherpa-onnx prints the cause before its last line). */
export function failureLines(output: string, max = 4): string {
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const useful = lines.filter((l) => /error|fail|unable|cannot|can't|not found|invalid|espeak|unknown|skip/i.test(l));
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
    const ok = !!r && Object.values(r.exes).every((p) => existsSync(p));
    return { id, name: RUNTIMES[id].name, role: RUNTIMES[id].role, licence: RUNTIMES[id].licence, installed: ok, version: r?.tag ?? null, flavour: r?.flavour ?? null, folder: join(this.enginesDir, ENGINE_DIR[id]) };
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

  private async hfFiles(repo: string, signal: AbortSignal): Promise<{ path: string; size?: number }[]> {
    const base = this.d.hfBase ?? 'https://huggingface.co';
    const f = this.d.fetch ?? fetch;
    let r: Response;
    try { r = await f(`${base}/api/models/${repo}/tree/main`, { headers: { 'user-agent': 'Lotus (local AI studio)' }, signal }); }
    catch (e) { if (signal.aborted) throw e; throw new DownloadError('Couldn\'t reach Hugging Face. Check the internet connection and try again.'); }
    if (r.status === 404 || r.status === 401) throw new DownloadError(`Hugging Face has no public model called ${repo}. Check the name (owner/model).`);
    if (!r.ok) throw new DownloadError(`Hugging Face answered HTTP ${r.status} for ${repo}.`);
    const j = (await r.json()) as { path?: string; size?: number; type?: string }[];
    return (Array.isArray(j) ? j : []).filter((x) => x.type !== 'directory' && x.path).map((x) => ({ path: String(x.path), size: Number(x.size) || undefined }));
  }

  private async fetchGguf(job: Job, signal: AbortSignal, repo: string, quant: string, mmproj: string | undefined, folder: string) {
    job.step = `Looking up ${repo}…`; this.emit();
    const list = await this.hfFiles(repo, signal);
    const pick = pickGguf(list, quant, mmproj);
    if (!pick.model) throw new DownloadError(`${repo} has no ${quant} GGUF file. Try another quantisation, e.g. ${repo}:Q4_K_M.`);
    const base = this.d.hfBase ?? 'https://huggingface.co';
    const parts = [pick.model, ...(pick.mmproj ? [pick.mmproj] : [])];
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
    return { gguf: out[0], mmproj: pick.mmproj ? out[1] : undefined, files: out };
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

  /** Starts llama-server with this model (or reuses the running one) and returns its address. */
  ensureChat(modelId: string, o: { ctx?: number } = {}): Promise<string> {
    if (this.chat.state === 'ready' && this.chat.model === modelId && this.chatProc && this.chatProc.exitCode === null && this.chat.url) return Promise.resolve(this.chat.url);
    if (this.chatStarting && this.chat.model === modelId) return this.chatStarting;
    this.chatStarting = this.startChat(modelId, o).finally(() => { this.chatStarting = null; });
    return this.chatStarting;
  }

  private async startChat(modelId: string, o: { ctx?: number }): Promise<string> {
    this.stopChat(false);
    const m = this.manifest()[modelId];
    if (!m?.gguf) throw new Error(`${modelId} isn't downloaded for the built-in engine. Get it in Settings → Models.`);
    const exe = this.exe('llama', 'llama-server');
    const port = await freePort();
    const ctx = o.ctx && o.ctx >= 2048 ? o.ctx : 8192;
    const args = ['-m', join(this.modelsDir, m.gguf), '--host', '127.0.0.1', '--port', String(port), '-c', String(ctx), '-np', '1', '--alias', modelId, '--no-webui', '--jinja'];
    if (m.mmproj) args.push('--mmproj', join(this.modelsDir, m.mmproj));
    const logPath = join(this.enginesDir, ENGINE_DIR.llama, 'server.log');
    mkdirSync(dirname(logPath), { recursive: true });
    this.chat = { state: 'starting', model: modelId, port };
    this.emit();
    this.d.log?.(`llama-server: ${m.gguf} on ${port}`);
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
      try { const r = await f(`${url}/health`, { signal: AbortSignal.timeout(2000) }); if (r.ok) { this.chat = { state: 'ready', model: modelId, url, port }; this.emit(); return url; } } catch { /* loading */ }
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

  async generateImage(p: ImageProfile, run: Omit<SdRun, 'output' | 'lowVram'>, o: { signal?: AbortSignal; onProgress?: (step: number, total: number) => void; loras?: LoraUse[] } = {}): Promise<string[]> {
    const exe = this.exe('sd', 'sd-cli');
    const missing = this.missingFiles(p);
    if (missing.length) throw new Error(`${p.name} is missing ${missing.join(', ')}. Open Settings → Models → Image Setups to fix it.`);
    if (this.imageBusy) throw new Error('The built-in image engine is already making an image. Wait for it to finish.');
    this.imageBusy = true;
    const m = await this.machine();
    // A chat model holding the GPU's memory makes big image models fail or crawl: unload it first on
    // GPUs under 16 GB (it loads again on the next message).
    if (this.chat.state !== 'stopped' && m.vramGb > 0 && m.vramGb < 16 && !m.unified) await this.stopChatAndWait();
    const outDir = join(this.enginesDir, ENGINE_DIR.sd, 'out', `${now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(outDir, { recursive: true });
    const lowVram = m.gpu === 'none' || (!m.unified && m.vramGb > 0 && m.vramGb < 12);
    const args = sdcppArgs(p, { ...run, output: join(outDir, 'lotus.png'), lowVram }, this.imagePath, o.loras ?? []);
    const logPath = join(this.enginesDir, ENGINE_DIR.sd, 'last-run.log');
    let log = '';
    try {
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
        if (/cannot make enough memory available|out of memory|CUDA error: out of memory|failed to allocate/i.test(log)) {
          const none = /available 0\.00 MB device|reported free 0\.00 MB/i.test(log);
          throw new Error(none
            ? 'The graphics card had no free memory left, so no image was made. Another program is holding it (Ollama, ComfyUI, a game or a browser tab). Close it, or wait a few minutes for Ollama to unload its model, and try again.'
            : 'The graphics card ran out of memory making this image. Try a smaller size, one image at a time, or a smaller model.');
        }
        const why = log.split(/[\r\n]+/).filter((l) => /error|fail|not found|unknown/i.test(l)).slice(-3).join(' ').slice(0, 400);
        throw new Error(`The built-in image engine didn't make an image${why ? `: ${why}` : ''}. The full log is in ${logPath}.`);
      }
      return made;
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

  async transcribe(modelId: string, wav: string, o: { language?: string; signal?: AbortSignal } = {}): Promise<string> {
    const exe = this.exe('sherpa', 'sherpa-onnx-offline');
    const out = await this.runTool(exe, this.sttArgs(this.voiceDir(modelId), wav, o.language), o.signal);
    return parseSherpaText(out);
  }

  private async runTool(exe: string, args: string[], signal?: AbortSignal): Promise<string> {
    const proc = Bun.spawn([exe, ...args], { cwd: dirname(exe), stdout: 'pipe', stderr: 'pipe', stdin: 'ignore', windowsHide: true });
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
  shutdown() { this.stopChat(false); for (const c of this.ctrls.values()) c.abort(); }

  /** Size of every image setup's needed files (for the Models page). */
  sizeFor = sizeFor;
}
