// GPT-SoVITS one-click install (0.22, Windows). Until now Lotus asked people to download GPT-SoVITS's
// several-GB Windows package themselves, unpack a .7z (which Windows can't open on its own) and pick
// the right folder inside it. Now Lotus does all of it:
//
//   1. finds the newest Windows package in GPT-SoVITS's own Hugging Face repo
//      (lj1995/GPT-SoVITS-windows-package, by the GPT-SoVITS author; the README links it),
//      choosing the "nvidia50" build for RTX 50 cards, whose drivers need the newer CUDA in it;
//   2. downloads 7zr.exe, the official stand-alone 7-Zip unpacker (LGPL, from 7-Zip's own GitHub
//      releases, checked against a known SHA-256), because the package is a .7z;
//   3. downloads the package (resumable, with progress), unpacks it into
//      Lotus Studio/Engines/GPT-SoVITS/<version>, deletes the archive, and saves the folder in
//      `lotus.voice.gptsovits.v1` with `managed: true`, so Voice → Voices offers it straight away.
//
// Nothing is bundled with Lotus: the package comes from GPT-SoVITS's own download, as the README tells
// Windows users to do, and stays under its own licences (GPT-SoVITS: MIT).

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import { download, DownloadError, removeTree, type FetchFn } from './files';
import type { Machine } from './machine';

export const GSV_KEY = 'lotus.voice.gptsovits.v1';
export const GSV_PACKAGE_REPO = 'lj1995/GPT-SoVITS-windows-package';
/** The package GPT-SoVITS's README links, used if Hugging Face's file list can't be read. */
export const GSV_FALLBACK_PACKAGE = 'GPT-SoVITS-v3lora-20250228.7z';
/** 7-Zip's stand-alone .7z unpacker (7-Zip 25.01, LGPL-2.1). */
export const SEVEN_ZR = {
  url: 'https://github.com/ip7z/7zip/releases/download/25.01/7zr.exe',
  sha256: '27cbe3d5804ad09e90bbcaa916da0d5c3b0be9462d0e0fb6cb54be5ed9030875',
  bytes: 601088,
};

export interface GsvSaved { dir?: string; managed?: boolean; version?: string }
export interface GsvPackage { path: string; size?: number; date: number; nvidia50: boolean }

/** The date in a package name: GPT-SoVITS-v2pro-20250604.7z → 20250604, GPT-SoVITS-v2-240821.7z → 20240821. */
export function packageDate(name: string): number {
  const long = /(?:^|[-_])(20\d{6})(?!\d)/.exec(name);
  if (long) return Number(long[1]);
  const short = /(?:^|[-_])(\d{6})(?!\d)/.exec(name);
  return short ? 20000000 + Number(short[1]) : 0;
}

/** RTX 50 cards (Blackwell) need the package built with CUDA 12.8 ("nvidia50"). */
export const wantsNvidia50 = (gpuName: string) => /RTX\s*50\d\d|Blackwell/i.test(gpuName);

/**
 * The package to install: the newest dated .7z at the top of the repo, in the build that suits this
 * graphics card (the "nvidia50" one only for RTX 50 cards). Null when there's no .7z at all.
 */
export function pickGsvPackage(files: { path: string; size?: number }[], gpuName: string): GsvPackage | null {
  const all = files
    .filter((f) => /^GPT-SoVITS[^/]*\.7z$/i.test(f.path))
    .map((f) => ({ path: f.path, size: f.size, date: packageDate(f.path), nvidia50: /nvidia ?50/i.test(f.path) }))
    .filter((f) => f.date > 0);
  if (!all.length) return null;
  const want50 = wantsNvidia50(gpuName);
  const fits = all.filter((f) => f.nvidia50 === want50);
  const pool = fits.length ? fits : all;
  return pool.sort((a, b) => b.date - a.date || a.path.length - b.path.length)[0];
}

/** The folder with api_v2.py: `dir` itself, or one folder down (a .7z unpacks into a folder of its own). */
export function findGsvRoot(dir: string, depth = 2): string | null {
  if (!dir) return null;
  if (existsSync(join(dir, 'api_v2.py'))) return dir;
  if (depth <= 0) return null;
  let entries: import('node:fs').Dirent[];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'runtime') continue;
    const hit = findGsvRoot(join(dir, e.name), depth - 1);
    if (hit) return hit;
  }
  return null;
}

/** The last percentage 7-Zip printed (its -bsp1 progress: "  42% 1234 - GPT_SoVITS\..."). */
export function sevenZipPercent(out: string): number | null {
  const all = [...out.matchAll(/(\d{1,3})%/g)];
  if (!all.length) return null;
  const n = Number(all[all.length - 1][1]);
  return n >= 0 && n <= 100 ? n : null;
}

/** Free space on the drive holding `dir`, in bytes (null when it can't be read). */
export function freeBytes(dir: string): number | null {
  try { const s = statfsSync(dir); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
}

/** Room needed: the archive plus what it unpacks to (about 2.5× the archive), plus a margin. */
export const roomNeeded = (archiveBytes: number) => Math.round(archiveBytes * 3.5) + 2 * 1024 ** 3;

export const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1)} GB`;

export function sha256File(path: string): string {
  const h = new Bun.CryptoHasher('sha256');
  h.update(readFileSync(path));
  return h.digest('hex');
}

/** Hugging Face's list of files at the top of the package repo. */
export async function listGsvPackages(o: { fetch?: FetchFn; hfBase?: string; signal?: AbortSignal }): Promise<{ path: string; size?: number }[]> {
  const f = o.fetch ?? fetch;
  const base = o.hfBase ?? 'https://huggingface.co';
  let r: Response;
  try { r = await f(`${base}/api/models/${GSV_PACKAGE_REPO}/tree/main`, { headers: { 'user-agent': 'Lotus (local AI studio)' }, signal: o.signal }); }
  catch (e) { if (o.signal?.aborted) throw e; throw new DownloadError('Couldn\'t reach Hugging Face, where GPT-SoVITS is downloaded from. Check the internet connection and try again.'); }
  if (!r.ok) throw new DownloadError(`Hugging Face answered HTTP ${r.status} when Lotus looked for GPT-SoVITS.`);
  const j = (await r.json()) as { path?: string; size?: number; type?: string; lfs?: { size?: number } }[];
  return (Array.isArray(j) ? j : []).filter((x) => x.path && x.type !== 'directory').map((x) => ({ path: String(x.path), size: Number(x.lfs?.size ?? x.size) || undefined }));
}

/** The package Lotus would install on this computer (for the "about N GB" on the install button). */
export async function gsvOffer(o: { fetch?: FetchFn; hfBase?: string; machine: Machine }): Promise<{ name: string; bytes: number | null; needs: number | null; free: number | null; supported: boolean; why?: string }> {
  if (o.machine.os !== 'windows') return { name: '', bytes: null, needs: null, free: null, supported: false, why: 'GPT-SoVITS only offers a ready-made package for Windows. On a Mac or Linux, set it up from its GitHub page and pick its folder.' };
  let pick: GsvPackage | null = null;
  try { pick = pickGsvPackage(await listGsvPackages(o), o.machine.gpuName); } catch { /* offline: say "several GB" */ }
  const bytes = pick?.size ?? null;
  return { name: pick?.path ?? GSV_FALLBACK_PACKAGE, bytes, needs: bytes ? roomNeeded(bytes) : null, free: null, supported: true };
}

export interface GsvInstallDeps {
  /** Lotus Studio/Engines/GPT-SoVITS */
  root: string;
  machine: Machine;
  fetch?: FetchFn;
  hfBase?: string;
  signal: AbortSignal;
  step: (s: string) => void;
  progress: (p: { done: number; total: number }) => void;
  kvGet: (k: string) => string | null;
  kvSet: (k: string, v: string) => void;
  /** Stops a GPT-SoVITS that Lotus started (before its folder is replaced). */
  stopServer: () => void;
  /** Tests: unpacks instead of running 7zr.exe. */
  unpack7z?: (sevenZr: string, archive: string, dest: string, onPercent: (n: number) => void, signal: AbortSignal) => Promise<void>;
  /** Tests: free space in bytes. */
  free?: (dir: string) => number | null;
  /** Tests: another unpacker download. */
  sevenZr?: typeof SEVEN_ZR;
}

/** Runs 7zr.exe to unpack a .7z, reporting its percentage. */
async function run7z(sevenZr: string, archive: string, dest: string, onPercent: (n: number) => void, signal: AbortSignal): Promise<void> {
  mkdirSync(dest, { recursive: true });
  const p = Bun.spawn([sevenZr, 'x', archive, `-o${dest}`, '-y', '-bso0', '-bsp1', '-bse1'], { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore', windowsHide: true });
  const kill = () => { try { p.kill(); } catch { /* gone */ } };
  signal.addEventListener('abort', kill);
  let tail = '';
  const read = async (s: ReadableStream | null) => {
    if (!s) return;
    const r = s.getReader(); const dec = new TextDecoder();
    for (;;) { const { done, value } = await r.read(); if (done) break; tail = (tail + dec.decode(value)).slice(-4000); const n = sevenZipPercent(tail.slice(-200)); if (n !== null) onPercent(n); }
  };
  await Promise.all([read(p.stdout as ReadableStream), read(p.stderr as ReadableStream)]);
  const code = await p.exited;
  signal.removeEventListener('abort', kill);
  if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
  if (code !== 0) {
    const why = tail.replace(/[\b\r]/g, '\n').split('\n').map((l) => l.trim()).filter((l) => /error|cannot|can't|not enough|disk|crc|data/i.test(l)).slice(-2).join(' ');
    if (/not enough space|disk full|no space/i.test(tail)) throw new Error('The drive ran out of space while unpacking GPT-SoVITS. Free some space and click Install again.');
    throw new Error(`Couldn't unpack GPT-SoVITS${why ? `: ${why}` : ` (7-Zip stopped with code ${code})`}. Click Install again; Lotus keeps what it already downloaded.`);
  }
}

/** The whole install. Throws a plain-words error when something is missing or fails. */
export async function installGsv(d: GsvInstallDeps): Promise<{ dir: string; version: string }> {
  if (d.machine.os !== 'windows') throw new Error('GPT-SoVITS only offers a ready-made package for Windows. On a Mac or Linux, set it up from its GitHub page and pick its folder in Voice → Voices.');
  mkdirSync(d.root, { recursive: true });

  d.step('Finding the newest GPT-SoVITS package');
  const pick = pickGsvPackage(await listGsvPackages({ fetch: d.fetch, hfBase: d.hfBase, signal: d.signal }), d.machine.gpuName);
  const name = pick?.path ?? GSV_FALLBACK_PACKAGE;
  const size = pick?.size;

  const free = (d.free ?? freeBytes)(d.root);
  const dlDir = join(d.root, '_downloads');
  const archive = join(dlDir, name);
  const have = (() => { try { return existsSync(`${archive}.part`) ? Bun.file(`${archive}.part`).size : existsSync(archive) ? Bun.file(archive).size : 0; } catch { return 0; } })();
  if (size && free !== null && free + have < roomNeeded(size)) {
    throw new Error(`GPT-SoVITS needs about ${gb(roomNeeded(size))} of free space to download and unpack (the download is ${gb(size)}), but the drive with Lotus Studio has ${gb(free)} free. Free some space and try again.`);
  }

  d.step('Downloading the 7-Zip unpacker');
  const sevenZr = join(d.root, '7zr.exe');
  const z = d.sevenZr ?? SEVEN_ZR;
  if (!existsSync(sevenZr) || sha256File(sevenZr) !== z.sha256) {
    rmSync(sevenZr, { force: true });
    await download(z.url, sevenZr, { fetch: d.fetch, signal: d.signal, expect: z.bytes });
    if (sha256File(sevenZr) !== z.sha256) { rmSync(sevenZr, { force: true }); throw new Error('The 7-Zip unpacker Lotus downloaded wasn\'t the expected file, so Lotus deleted it. Try again later.'); }
  }

  d.step(`Downloading ${name}`);
  const base = d.hfBase ?? 'https://huggingface.co';
  await download(`${base}/${GSV_PACKAGE_REPO}/resolve/main/${encodeURIComponent(name)}`, archive, { fetch: d.fetch, signal: d.signal, expect: size, onProgress: d.progress });

  d.step('Unpacking (this takes a few minutes)');
  const tmp = join(d.root, '_unpack');
  removeTree(tmp);
  await (d.unpack7z ?? run7z)(sevenZr, archive, tmp, (n) => { d.step(`Unpacking, ${n}%`); d.progress({ done: n, total: 100 }); }, d.signal);
  const found = findGsvRoot(tmp);
  if (!found) throw new Error(`The GPT-SoVITS package didn't contain api_v2.py, so Lotus can't start it. Lotus left the files in ${tmp} so you can look.`);

  d.step('Finishing');
  const version = name.replace(/\.7z$/i, '').replace(/^GPT-SoVITS-/i, '').replace(/[^\w.-]+/g, '-') || 'current';
  const target = join(d.root, version);
  const before = ((): GsvSaved => { try { return JSON.parse(d.kvGet(GSV_KEY) || '{}') as GsvSaved; } catch { return {}; } })();
  d.stopServer();
  removeTree(target);
  renameSync(found, target);
  removeTree(tmp);
  // An older version Lotus installed, now replaced (a folder the user picked is never deleted).
  if (before.managed && before.dir && before.dir !== target && before.dir.startsWith(d.root)) removeTree(before.dir);
  try { rmSync(archive, { force: true }); } catch { /* in use: removed next time */ }
  d.kvSet(GSV_KEY, JSON.stringify({ dir: target, managed: true, version } satisfies GsvSaved));
  return { dir: target, version };
}
