// Downloading and unpacking for the built-in engines and their models: resumable downloads with
// progress, zip (fflate, in this process) and tar.gz / tar.bz2 (the system's tar: bsdtar on Windows 10+
// and macOS, GNU tar on Linux), and finding programs inside an unpacked release.

import { chmodSync, closeSync, createReadStream, existsSync, mkdirSync, openSync, readdirSync, renameSync, rmSync, statSync, writeSync } from 'node:fs';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate';

export interface Progress { done: number; total: number }
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export class DownloadError extends Error {}

const httpHint = (status: number, url: string) => {
  const host = (() => { try { return new URL(url).hostname; } catch { return url; } })();
  if (status === 401 || status === 403) return `${host} refused the download (HTTP ${status}). Some models need you to accept their licence on the website first, or an access token.`;
  if (status === 404) return `${host} has no file at that address any more (HTTP 404). The model may have been moved or renamed.`;
  if (status === 429) return `${host} is limiting downloads right now (HTTP 429). Wait a few minutes and try again.`;
  return `${host} answered HTTP ${status}.`;
};

/**
 * Downloads `url` to `dest`. A partial file (`dest.part`) from an earlier attempt is resumed when the
 * server allows it. `expect` (bytes) skips a file that is already complete.
 */
export async function download(url: string, dest: string, o: { fetch?: FetchFn; signal?: AbortSignal; expect?: number; onProgress?: (p: Progress) => void; headers?: Record<string, string> } = {}): Promise<string> {
  const f = o.fetch ?? fetch;
  if (existsSync(dest) && (!o.expect || statSync(dest).size === o.expect)) return dest;
  mkdirSync(dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  let have = existsSync(part) ? statSync(part).size : 0;
  const headers: Record<string, string> = { 'user-agent': 'Lotus (local AI studio)', ...(o.headers ?? {}) };
  if (have > 0) headers.range = `bytes=${have}-`;
  let res: Response;
  try { res = await f(url, { headers, signal: o.signal, redirect: 'follow' }); }
  catch (e) {
    if (o.signal?.aborted) throw new DOMException('Stopped', 'AbortError');
    throw new DownloadError(`Couldn't reach ${(() => { try { return new URL(url).hostname; } catch { return url; } })()}: ${(e as Error).message}. Check the internet connection and try again.`);
  }
  if (res.status === 416 && have > 0) { renameSync(part, dest); return dest; } // already complete
  if (!res.ok) throw new DownloadError(httpHint(res.status, url));
  if (res.status !== 206) have = 0; // server ignored the range: start over
  const len = Number(res.headers.get('content-length') ?? 0);
  const total = len ? len + have : (o.expect ?? 0);
  const fd = openSync(part, have > 0 ? 'a' : 'w');
  let done = have;
  let last = 0;
  try {
    const reader = res.body!.getReader();
    for (;;) {
      if (o.signal?.aborted) { void reader.cancel().catch(() => undefined); throw new DOMException('Stopped', 'AbortError'); }
      const { done: end, value } = await reader.read();
      if (end) break;
      writeSync(fd, value);
      done += value.byteLength;
      const now = Date.now();
      if (o.onProgress && now - last > 250) { last = now; o.onProgress({ done, total }); }
    }
  } finally { closeSync(fd); }
  if (total && done < total) throw new DownloadError(`The download stopped early (${Math.round(done / 1e6)} of ${Math.round(total / 1e6)} MB). Try again; Lotus continues where it stopped.`);
  renameSync(part, dest);
  o.onProgress?.({ done, total: total || done });
  return dest;
}

/** Joins an archive entry name to the destination, refusing anything that would land outside it. */
export function safeJoin(root: string, entry: string): string | null {
  const clean = entry.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean || clean.split('/').some((p) => p === '..') || /^[a-z]:/i.test(clean)) return null;
  const full = resolve(root, normalize(clean));
  const base = resolve(root);
  return full === base || full.startsWith(base + sep) ? full : null;
}

/** Unpacks a .zip with fflate, streaming each file to disk. */
export async function unzip(archive: string, dest: string): Promise<number> {
  mkdirSync(dest, { recursive: true });
  let count = 0;
  let failure: Error | null = null;
  const pending: Promise<void>[] = [];
  const un = new Unzip((file) => {
    const out = safeJoin(dest, file.name);
    if (!out) { failure = new Error(`The archive has an unsafe path (${file.name}); Lotus did not unpack it.`); return; }
    if (file.name.endsWith('/')) { mkdirSync(out, { recursive: true }); return; }
    mkdirSync(dirname(out), { recursive: true });
    const fd = openSync(out, 'w');
    count++;
    pending.push(new Promise<void>((done, fail) => {
      file.ondata = (err, chunk, final) => {
        if (err) { try { closeSync(fd); } catch { /* closed */ } fail(err); return; }
        if (chunk.length) writeSync(fd, chunk);
        if (final) { closeSync(fd); done(); }
      };
    }));
    file.start();
  });
  un.register(UnzipInflate);
  un.register(UnzipPassThrough);
  await new Promise<void>((done, fail) => {
    const s = createReadStream(archive, { highWaterMark: 1 << 20 });
    s.on('data', (c) => { try { un.push(c as Uint8Array); } catch (e) { s.destroy(); fail(e as Error); } });
    s.on('end', () => { try { un.push(new Uint8Array(0), true); done(); } catch (e) { fail(e as Error); } });
    s.on('error', fail);
  });
  await Promise.all(pending);
  if (failure) throw failure;
  return count;
}

/** Unpacks a tarball (gzip or bzip2) with the system's tar. */
export async function untar(archive: string, dest: string): Promise<void> {
  mkdirSync(dest, { recursive: true });
  const isBz = /\.(tar\.bz2|tbz2?)$/i.test(archive);
  const flags = isBz ? '-xjf' : '-xzf';
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  const p = Bun.spawn([tar, flags, archive, '-C', dest], { stdout: 'ignore', stderr: 'pipe', windowsHide: true });
  const err = await new Response(p.stderr).text();
  const code = await p.exited;
  if (code !== 0) {
    const why = err.trim().split('\n').slice(-2).join(' ');
    throw new Error(`Couldn't unpack ${archive.split(/[\\/]/).pop()}${why ? `: ${why}` : ''}.${isBz && process.platform === 'linux' ? ' On Linux this needs the bzip2 package (sudo apt install bzip2).' : ''}`);
  }
}

export async function unpack(archive: string, dest: string): Promise<void> {
  if (/\.zip$/i.test(archive)) await unzip(archive, dest);
  else await untar(archive, dest);
}

/** Finds the first file with one of these names under `root` (depth ≤ 4). */
export function findFile(root: string, names: string[], depth = 4): string | null {
  const want = new Set(names.map((n) => n.toLowerCase()));
  const walk = (dir: string, d: number): string | null => {
    let entries: import('node:fs').Dirent[];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    for (const e of entries) if (e.isFile() && want.has(e.name.toLowerCase())) return join(dir, e.name);
    if (d <= 0) return null;
    for (const e of entries) if (e.isDirectory()) { const hit = walk(join(dir, e.name), d - 1); if (hit) return hit; }
    return null;
  };
  return walk(root, depth);
}

/** All files under a folder whose name matches (depth ≤ 3). */
export function listFiles(root: string, re: RegExp, depth = 3): string[] {
  const out: string[] = [];
  const walk = (dir: string, d: number) => {
    let entries: import('node:fs').Dirent[];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isFile() && re.test(e.name)) out.push(p);
      else if (e.isDirectory() && d > 0) walk(p, d - 1);
    }
  };
  walk(root, depth);
  return out;
}

export function makeExecutable(path: string) {
  if (process.platform === 'win32') return;
  try { chmodSync(path, 0o755); } catch { /* read-only volume */ }
}

export function removeTree(path: string) { try { rmSync(path, { recursive: true, force: true }); } catch { /* in use (Windows): left for next time */ } }

/** Folder size in bytes (depth ≤ 6). */
export function folderBytes(root: string): number {
  let total = 0;
  const walk = (dir: string, d: number) => {
    let entries: import('node:fs').Dirent[];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isFile()) { try { total += statSync(p).size; } catch { /* gone */ } }
      else if (e.isDirectory() && d > 0) walk(p, d - 1);
    }
  };
  walk(root, 6);
  return total;
}
