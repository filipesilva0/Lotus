// What this computer has, read once for the first-run guide, the Models page's "fits" labels and the
// choice of engine build: OS, processor type, GPU maker and video memory.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { arch as osArch, platform, totalmem } from 'node:os';
import { join } from 'node:path';
import type { Gpu, Platform } from './assets';

export interface Machine extends Platform {
  gpuName: string;
  /** GPU memory in GB (0 = unknown or none). On Apple Silicon: total memory (shared). */
  vramGb: number;
  unified: boolean;
  ramGb: number;
}

async function run(cmd: string[], ms = 6000): Promise<string> {
  try {
    const p = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'ignore', windowsHide: true });
    const t = setTimeout(() => { try { p.kill(); } catch { /* gone */ } }, ms);
    const out = await new Response(p.stdout).text();
    clearTimeout(t);
    return (await p.exited) === 0 ? out : '';
  } catch { return ''; }
}

/** `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits` → biggest GPU. */
export function parseNvidiaList(out: string): { name: string; vramGb: number } | null {
  const rows = out.split('\n').map((l) => l.split(',').map((s) => s.trim())).filter((r) => r.length >= 2 && r[0]);
  if (!rows.length) return null;
  const best = rows.map((r) => ({ name: r[0], vramGb: Math.round((Number(r[1]) / 1024) * 10) / 10 })).sort((a, b) => b.vramGb - a.vramGb)[0];
  return Number.isFinite(best.vramGb) ? best : null;
}

/** Windows video controllers (PowerShell, JSON) → maker and memory. AdapterRAM is capped at 4 GB by WMI, so it is a floor. */
export function parseWinControllers(json: string): { gpu: Gpu; name: string; vramGb: number } | null {
  let list: { Name?: string; AdapterRAM?: number }[] = [];
  try { const j = JSON.parse(json); list = Array.isArray(j) ? j : [j]; } catch { return null; }
  const named = list.filter((c) => c?.Name && !/basic display|remote|virtual|parsec|meta/i.test(c.Name));
  const pick = named.find((c) => /nvidia/i.test(c.Name!)) ?? named.find((c) => /amd|radeon/i.test(c.Name!)) ?? named.find((c) => /intel/i.test(c.Name!)) ?? named[0];
  if (!pick) return null;
  const n = pick.Name!;
  const gpu: Gpu = /nvidia/i.test(n) ? 'nvidia' : /amd|radeon/i.test(n) ? 'amd' : /intel/i.test(n) ? 'intel' : 'none';
  return { gpu, name: n, vramGb: pick.AdapterRAM ? Math.round((pick.AdapterRAM / 1024 ** 3) * 10) / 10 : 0 };
}

/** Linux: GPU makers from each /sys/class/drm/cardN/device/vendor file. */
export function linuxGpuVendors(root = '/sys/class/drm'): Gpu[] {
  const out: Gpu[] = [];
  let cards: string[] = [];
  try { cards = readdirSync(root).filter((c) => /^card\d+$/.test(c)); } catch { return out; }
  for (const c of cards) {
    try {
      const v = readFileSync(join(root, c, 'device', 'vendor'), 'utf8').trim().toLowerCase();
      out.push(v === '0x10de' ? 'nvidia' : v === '0x1002' ? 'amd' : v === '0x8086' ? 'intel' : 'none');
    } catch { /* no vendor file */ }
  }
  return out;
}

let cached: Promise<Machine> | null = null;

export function readMachine(force = false): Promise<Machine> {
  if (!cached || force) cached = detect();
  return cached;
}

async function detect(): Promise<Machine> {
  const os = platform() === 'win32' ? 'windows' : platform() === 'darwin' ? 'macos' : 'linux';
  const arch = osArch() === 'arm64' ? 'arm64' : 'x64';
  const ramGb = Math.round((totalmem() / 1024 ** 3) * 10) / 10;
  if (os === 'macos') {
    if (arch === 'arm64') return { os, arch, gpu: 'apple', gpuName: 'Apple silicon', vramGb: ramGb, unified: true, ramGb };
    return { os, arch, gpu: 'none', gpuName: 'Intel Mac', vramGb: 0, unified: false, ramGb };
  }
  const nv = parseNvidiaList(await run(['nvidia-smi', '--query-gpu=name,memory.total', '--format=csv,noheader,nounits']));
  if (nv) return { os, arch, gpu: 'nvidia', gpuName: nv.name, vramGb: nv.vramGb, unified: false, ramGb };
  if (os === 'windows') {
    const w = parseWinControllers(await run(['powershell', '-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress']));
    if (w) return { os, arch, gpu: w.gpu, gpuName: w.name, vramGb: w.vramGb, unified: false, ramGb };
    return { os, arch, gpu: 'none', gpuName: '', vramGb: 0, unified: false, ramGb };
  }
  const vendors = linuxGpuVendors();
  const gpu: Gpu = vendors.includes('nvidia') ? 'nvidia' : vendors.includes('amd') ? 'amd' : vendors.includes('intel') ? 'intel' : 'none';
  let vramGb = 0;
  if (gpu === 'amd') {
    try {
      for (const c of readdirSync('/sys/class/drm').filter((x) => /^card\d+$/.test(x))) {
        const f = join('/sys/class/drm', c, 'device', 'mem_info_vram_total');
        if (existsSync(f)) vramGb = Math.max(vramGb, Math.round((Number(readFileSync(f, 'utf8')) / 1024 ** 3) * 10) / 10);
      }
    } catch { /* unknown */ }
  }
  return { os, arch, gpu, gpuName: gpu === 'none' ? '' : `${gpu.toUpperCase()} GPU`, vramGb, unified: false, ramGb };
}
