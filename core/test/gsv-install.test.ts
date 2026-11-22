// 0.22: GPT-SoVITS installs with one click on Windows, and starts the way its own package does.
import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findGsvRoot, GSV_KEY, installGsv, packageDate, pickGsvPackage, roomNeeded, sevenZipPercent, sha256File, wantsNvidia50 } from '../src/engines/gsvInstall';
import { GptSovits, gsvEnv, gsvFailure } from '../src/engines/gptsovits';
import type { Machine } from '../src/engines/machine';

const LIST = [
  { path: '.gitattributes', size: 1519 },
  { path: 'GPT-SoVITS-v2-240821.7z', size: 5e9 },
  { path: 'GPT-SoVITS-v3lora-20250228.7z', size: 7e9 },
  { path: 'GPT-SoVITS-v2pro-20250604.7z', size: 6e9 },
  { path: 'GPT-SoVITS-v2pro-20250604-nvidia50.7z', size: 6.5e9 },
  { path: 'README.md', size: 10 },
];
const win = (gpuName = 'NVIDIA GeForce RTX 4060'): Machine => ({ os: 'windows', arch: 'x64', gpu: 'nvidia', gpuName, vramGb: 8, unified: false, ramGb: 32 });

describe('picking the package', () => {
  test('dates in both styles', () => {
    expect(packageDate('GPT-SoVITS-v2pro-20250604.7z')).toBe(20250604);
    expect(packageDate('GPT-SoVITS-v2-240821.7z')).toBe(20240821);
    expect(packageDate('GPT-SoVITS-v4-20250422fix.7z')).toBe(20250422);
    expect(packageDate('GPT-SoVITS-beta.7z')).toBe(0);
  });
  test('the newest for an RTX 40 card, and the nvidia50 build for an RTX 50 card', () => {
    expect(pickGsvPackage(LIST, 'NVIDIA GeForce RTX 4060')?.path).toBe('GPT-SoVITS-v2pro-20250604.7z');
    expect(pickGsvPackage(LIST, 'NVIDIA GeForce RTX 5070 Ti')?.path).toBe('GPT-SoVITS-v2pro-20250604-nvidia50.7z');
    expect(pickGsvPackage(LIST, '')?.path).toBe('GPT-SoVITS-v2pro-20250604.7z');
    expect(wantsNvidia50('NVIDIA GeForce RTX 5090')).toBe(true);
    expect(wantsNvidia50('NVIDIA GeForce RTX 4060')).toBe(false);
    // Only the other build exists: use it rather than nothing.
    expect(pickGsvPackage([{ path: 'GPT-SoVITS-v2pro-20250604-nvidia50.7z' }], 'RTX 3060')?.path).toBe('GPT-SoVITS-v2pro-20250604-nvidia50.7z');
    expect(pickGsvPackage([{ path: 'README.md' }], 'RTX 3060')).toBeNull();
  });
  test('7-Zip progress', () => {
    expect(sevenZipPercent('  3% 12 - a\b\b\b\b  41% 900 - GPT_SoVITS\\x.py')).toBe(41);
    expect(sevenZipPercent('Everything is Ok')).toBeNull();
  });
});

describe('the folder', () => {
  test('found one level down, where a .7z unpacks to', () => {
    const root = mkdtempSync(join(tmpdir(), 'gsvroot-'));
    const inner = join(root, 'GPT-SoVITS-v2pro-20250604');
    mkdirSync(join(inner, 'runtime'), { recursive: true });
    writeFileSync(join(inner, 'api_v2.py'), '');
    expect(findGsvRoot(root)).toBe(inner);
    expect(findGsvRoot(inner)).toBe(inner);
    expect(findGsvRoot(join(root, 'nope'))).toBeNull();
    rmSync(root, { recursive: true, force: true });
  });
});

describe('starting it like its own go-webui.bat', () => {
  test('UTF-8 output, its runtime first on PATH (whatever the key\'s case), no stray Python settings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gsvenv-'));
    mkdirSync(join(dir, 'runtime'));
    const env = gsvEnv(dir, { Path: 'C:\\Windows', PYTHONPATH: 'C:\\mine', PYTHONHOME: 'C:\\py', OTHER: '1' }, 'win32');
    expect(env.Path.startsWith(join(dir, 'runtime') + ';')).toBe(true);
    expect(env.PATH).toBeUndefined();
    expect(env.PYTHONPATH).toBeUndefined();
    expect(env.PYTHONHOME).toBeUndefined();
    expect(env.PYTHONIOENCODING).toBe('utf-8');
    expect(env.PYTHONUTF8).toBe('1');
    expect(env.OTHER).toBe('1');
    rmSync(dir, { recursive: true, force: true });
  });
  test('plain reasons from its log', () => {
    expect(gsvFailure('RuntimeError: CUDA out of memory. Tried to allocate')).toMatch(/graphics card ran out of memory/);
    expect(gsvFailure("ModuleNotFoundError: No module named 'fastapi'")).toMatch(/missing fastapi.*install it again/);
    expect(gsvFailure("FileNotFoundError: GPT_SoVITS/pretrained_models/s1v3.ckpt")).toMatch(/voice model files are missing/);
  });
  test('starts the package\'s Python with -X utf8, the environment and a free port when 9880 is taken by something else', async () => {
    if (process.platform === 'win32') return;
    const dir = mkdtempSync(join(tmpdir(), 'gsvstart-'));
    const pkg = join(dir, 'GPT-SoVITS-v2pro-20250604');
    mkdirSync(join(pkg, 'runtime', 'bin'), { recursive: true });
    writeFileSync(join(pkg, 'api_v2.py'), '');
    // A stand-in for the package's Python: records what it was given, then serves a GPT-SoVITS-like API.
    const server = join(dir, 'fake-api.ts');
    writeFileSync(server, `
      const args = process.argv.slice(2);
      require('node:fs').writeFileSync(${JSON.stringify(join(dir, 'seen.json'))}, JSON.stringify({ args, enc: process.env.PYTHONIOENCODING, path: process.env.PATH, cwd: process.cwd() }));
      const port = Number(args[args.indexOf('-p') + 1]);
      Bun.serve({ port, hostname: '127.0.0.1', fetch: (r) => new URL(r.url).pathname === '/openapi.json' ? new Response('{"paths":{"/tts":{}}}') : new Response('x', { status: 404 }) });
    `);
    const py = join(pkg, 'runtime', 'bin', 'python');
    writeFileSync(py, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(server)} "$@"\n`);
    chmodSync(py, 0o755);
    // Something that isn't GPT-SoVITS already has 9880 (unless the port is busy for real on this machine).
    let other: ReturnType<typeof Bun.serve> | null = null;
    try { other = Bun.serve({ port: 9880, hostname: '127.0.0.1', fetch: () => new Response('not it', { status: 404 }) }); } catch { /* taken already */ }
    const g = new GptSovits({ tempDir: join(dir, 'tmp') });
    try {
      // The folder the .7z unpacked into works: the real one is found inside it.
      await g.start(dir);
      const seen = JSON.parse(readFileSync(join(dir, 'seen.json'), 'utf8')) as { args: string[]; enc: string; path: string; cwd: string };
      expect(seen.args.slice(0, 3)).toEqual(['-s', '-X', 'utf8']);
      expect(seen.args).toContain('api_v2.py');
      expect(seen.args[seen.args.indexOf('-p') + 1]).not.toBe('9880');
      expect(seen.enc).toBe('utf-8');
      expect(seen.path.split(':')[0]).toBe(join(pkg, 'runtime'));
      expect(await g.up()).toBe(true);
      expect((await g.status(dir)).startedByLotus).toBe(true);
    } finally {
      g.stop();
      other?.stop(true);
      await Bun.sleep(100);
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('one-click install', () => {
  const zr = new TextEncoder().encode('pretend 7zr.exe');
  const sevenZr = { url: 'https://example.test/7zr.exe', sha256: new Bun.CryptoHasher('sha256').update(zr).digest('hex'), bytes: zr.length };
  const pkgBytes = new Uint8Array(4096).fill(7);
  const fake = (calls: string[]) => (async (url: string) => {
    calls.push(String(url));
    if (url.includes('/api/models/lj1995/GPT-SoVITS-windows-package/tree/main')) return Response.json([{ type: 'file', path: 'GPT-SoVITS-v2pro-20250604.7z', size: 134, lfs: { size: pkgBytes.length } }, { type: 'file', path: 'GPT-SoVITS-v2pro-20250604-nvidia50.7z', size: 134, lfs: { size: pkgBytes.length } }]);
    if (url === sevenZr.url) return new Response(zr);
    if (url.endsWith('/resolve/main/GPT-SoVITS-v2pro-20250604.7z')) return new Response(pkgBytes);
    return new Response('no', { status: 404 });
  }) as unknown as typeof fetch;
  const kvStore = () => { const m = new Map<string, string>(); return { m, kvGet: (k: string) => m.get(k) ?? null, kvSet: (k: string, v: string) => { m.set(k, v); } }; };

  test('downloads, unpacks, saves the folder and cleans up', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gsvinst-'));
    const calls: string[] = []; const kv = kvStore(); const steps: string[] = [];
    // An earlier version Lotus installed is replaced.
    const old = join(root, 'v2-240821'); mkdirSync(old, { recursive: true });
    kv.kvSet(GSV_KEY, JSON.stringify({ dir: old, managed: true, version: 'v2-240821' }));
    let stopped = 0;
    const r = await installGsv({
      root, machine: win(), fetch: fake(calls), hfBase: 'https://hf.test', signal: new AbortController().signal,
      step: (s) => steps.push(s), progress: () => undefined, kvGet: kv.kvGet, kvSet: kv.kvSet, stopServer: () => { stopped++; }, sevenZr,
      free: () => 100 * 1024 ** 3,
      unpack7z: async (exe, archive, dest, onPercent) => {
        expect(exe).toBe(join(root, '7zr.exe'));
        expect(readFileSync(archive).length).toBe(pkgBytes.length);
        const inner = join(dest, 'GPT-SoVITS-v2pro-20250604');
        mkdirSync(join(inner, 'runtime'), { recursive: true });
        writeFileSync(join(inner, 'api_v2.py'), '');
        onPercent(50); onPercent(100);
      },
    });
    expect(r).toEqual({ dir: join(root, 'v2pro-20250604'), version: 'v2pro-20250604' });
    expect(existsSync(join(r.dir, 'api_v2.py'))).toBe(true);
    expect(JSON.parse(kv.m.get(GSV_KEY)!)).toEqual({ dir: r.dir, managed: true, version: 'v2pro-20250604' });
    expect(existsSync(old)).toBe(false);
    expect(existsSync(join(root, '_downloads', 'GPT-SoVITS-v2pro-20250604.7z'))).toBe(false);
    expect(existsSync(join(root, '_unpack'))).toBe(false);
    expect(sha256File(join(root, '7zr.exe'))).toBe(sevenZr.sha256);
    expect(stopped).toBe(1);
    expect(calls.some((c) => c.includes('nvidia50'))).toBe(false); // an RTX 4060 gets the usual build
    expect(steps).toContain('Unpacking, 50%');
    rmSync(root, { recursive: true, force: true });
  });

  test('a 7zr.exe that isn\'t the expected file is refused', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gsvinst-'));
    const kv = kvStore();
    await expect(installGsv({ root, machine: win(), fetch: fake([]), hfBase: 'https://hf.test', signal: new AbortController().signal, step: () => undefined, progress: () => undefined, kvGet: kv.kvGet, kvSet: kv.kvSet, stopServer: () => undefined, sevenZr: { ...sevenZr, sha256: 'f'.repeat(64) }, free: () => 1e12 }))
      .rejects.toThrow(/wasn't the expected file/);
    expect(existsSync(join(root, '7zr.exe'))).toBe(false);
    expect(kv.m.has(GSV_KEY)).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  test('says how much space it needs before downloading anything big', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gsvinst-'));
    const calls: string[] = []; const kv = kvStore();
    await expect(installGsv({ root, machine: win(), fetch: fake(calls), hfBase: 'https://hf.test', signal: new AbortController().signal, step: () => undefined, progress: () => undefined, kvGet: kv.kvGet, kvSet: kv.kvSet, stopServer: () => undefined, sevenZr, free: () => 1000 }))
      .rejects.toThrow(/needs about .* GB of free space/);
    expect(calls.filter((c) => c.includes('resolve'))).toEqual([]);
    expect(roomNeeded(6e9)).toBeGreaterThan(6e9 * 3);
    rmSync(root, { recursive: true, force: true });
  });

  test('only on Windows', async () => {
    const kv = kvStore();
    await expect(installGsv({ root: join(tmpdir(), 'unused-gsv'), machine: { ...win(), os: 'macos' }, signal: new AbortController().signal, step: () => undefined, progress: () => undefined, kvGet: kv.kvGet, kvSet: kv.kvSet, stopServer: () => undefined }))
      .rejects.toThrow(/only offers a ready-made package for Windows/);
  });
});
