// Live hardware readings for Engines & Models → Hardware & Runtime (session 16).
//
// Read natively by the core, with no engine running:
//   CPU   load per core (os.cpus() deltas), model name, temperature where the OS exposes it
//         (Linux hwmon/thermal zones; Windows ACPI thermal zone through CIM, which many PCs only
//         allow for administrators; macOS has no unprivileged reader, so it reports none)
//   RAM   used / total (os)
//   GPU   NVIDIA via nvidia-smi: load, memory, temperature, power and limit, fan, clocks
//         AMD on Linux via sysfs: load, memory, temperature, power
//
// A reading that isn't available is null and the page says so; nothing is guessed.

import { cpus, freemem, totalmem, platform } from 'node:os';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface GpuLive {
  name: string;
  vendor: 'nvidia' | 'amd';
  loadPct: number | null;
  memUsedMb: number | null;
  memTotalMb: number | null;
  tempC: number | null;
  powerW: number | null;
  powerLimitW: number | null;
  fanPct: number | null;
  clockMhz: number | null;
}

export interface HardwareLive {
  t: number;
  cpu: { name: string; cores: number; loadPct: number; perCore: number[]; tempC: number | null; tempSource: string | null };
  ram: { usedMb: number; totalMb: number };
  gpus: GpuLive[];
  /** Why a reading is missing, in plain words (shown under the tile). */
  notes: string[];
}

type Run = (cmd: string[], timeoutMs?: number) => Promise<string | null>;

const run: Run = async (cmd, timeoutMs = 2500) => {
  try {
    const p = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'ignore', windowsHide: true } as Parameters<typeof Bun.spawn>[1]);
    const timer = setTimeout(() => { try { p.kill(); } catch { /* gone */ } }, timeoutMs);
    const out = await new Response(p.stdout as ReadableStream).text();
    const code = await p.exited;
    clearTimeout(timer);
    return code === 0 ? out : null;
  } catch { return null; }
};

const num = (v: string | undefined): number | null => {
  if (v === undefined) return null;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : null;
};

/** Parses `nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit,fan.speed,clocks.sm --format=csv,noheader,nounits`. */
export function parseNvidiaLive(out: string): GpuLive[] {
  return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const c = l.split(',').map((x) => x.trim());
    const n = (i: number) => (c[i] === undefined || /N\/A|\[/.test(c[i]) ? null : num(c[i]));
    return { name: c[0] || 'NVIDIA GPU', vendor: 'nvidia' as const, loadPct: n(1), memUsedMb: n(2), memTotalMb: n(3), tempC: n(4), powerW: n(5), powerLimitW: n(6), fanPct: n(7), clockMhz: n(8) };
  }).filter((g) => g.name);
}

const NV_QUERY = 'name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit,fan.speed,clocks.sm';
let nvidiaMissing = false;
async function nvidia(): Promise<GpuLive[]> {
  if (nvidiaMissing) return [];
  const out = await run(['nvidia-smi', `--query-gpu=${NV_QUERY}`, '--format=csv,noheader,nounits']);
  if (out === null) { nvidiaMissing = true; return []; }
  return parseNvidiaLive(out);
}

const readNum = (p: string): number | null => { try { return num(readFileSync(p, 'utf8')); } catch { return null; } };

function amdSysfs(): GpuLive[] {
  if (platform() !== 'linux') return [];
  const base = '/sys/class/drm';
  let cards: string[] = [];
  try { cards = readdirSync(base).filter((d) => /^card\d+$/.test(d)); } catch { return []; }
  const out: GpuLive[] = [];
  for (const c of cards) {
    const dev = join(base, c, 'device');
    if (readFileSync(join(dev, 'vendor'), { encoding: 'utf8', flag: 'r' }).trim() !== '0x1002') continue;
    const total = readNum(join(dev, 'mem_info_vram_total'));
    const used = readNum(join(dev, 'mem_info_vram_used'));
    let temp: number | null = null, power: number | null = null;
    try {
      const hw = readdirSync(join(dev, 'hwmon'))[0];
      if (hw) {
        const t = readNum(join(dev, 'hwmon', hw, 'temp1_input'));
        const pw = readNum(join(dev, 'hwmon', hw, 'power1_average')) ?? readNum(join(dev, 'hwmon', hw, 'power1_input'));
        temp = t === null ? null : t / 1000;
        power = pw === null ? null : pw / 1e6;
      }
    } catch { /* no hwmon */ }
    out.push({ name: 'AMD GPU', vendor: 'amd', loadPct: readNum(join(dev, 'gpu_busy_percent')), memUsedMb: used === null ? null : used / 1048576, memTotalMb: total === null ? null : total / 1048576, tempC: temp, powerW: power, powerLimitW: null, fanPct: null, clockMhz: null });
  }
  return out;
}

// CPU load: the difference between two os.cpus() samples.
let prev: { idle: number; total: number }[] | null = null;
export function cpuLoad(sample = cpus()): { total: number; perCore: number[] } {
  const now = sample.map((c) => { const t = c.times; const total = t.user + t.nice + t.sys + t.idle + t.irq; return { idle: t.idle, total }; });
  const before = prev;
  prev = now;
  if (!before || before.length !== now.length) return { total: 0, perCore: now.map(() => 0) };
  const perCore = now.map((c, i) => {
    const dt = c.total - before[i].total;
    return dt > 0 ? Math.max(0, Math.min(100, 100 * (1 - (c.idle - before[i].idle) / dt))) : 0;
  });
  return { total: perCore.reduce((a, b) => a + b, 0) / Math.max(1, perCore.length), perCore };
}

/** Linux: the package sensor from hwmon (coretemp / k10temp / zenpower), else the warmest thermal zone. */
export function linuxCpuTemp(root = '/sys/class'): number | null {
  try {
    const hw = join(root, 'hwmon');
    for (const d of readdirSync(hw)) {
      const name = (() => { try { return readFileSync(join(hw, d, 'name'), 'utf8').trim(); } catch { return ''; } })();
      if (!/coretemp|k10temp|zenpower|cpu_thermal|acpitz/.test(name)) continue;
      const t = readNum(join(hw, d, 'temp1_input'));
      if (t !== null && t > 0) return t / 1000;
    }
  } catch { /* none */ }
  try {
    const tz = join(root, 'thermal');
    let best: number | null = null;
    for (const d of readdirSync(tz).filter((x) => x.startsWith('thermal_zone'))) {
      const t = readNum(join(tz, d, 'temp'));
      if (t !== null && t > 0 && (best === null || t / 1000 > best)) best = t / 1000;
    }
    return best;
  } catch { return null; }
}

/** Windows ACPI thermal zone, in tenths of a kelvin. Often needs administrator rights; then it stays off. */
export function parseAcpiKelvin(out: string): number | null {
  const vals = out.split(/\r?\n/).map((l) => num(l)).filter((v): v is number => v !== null && v > 2000);
  if (!vals.length) return null;
  return Math.round((Math.max(...vals) / 10 - 273.15) * 10) / 10;
}

let winTemp: { at: number; value: number | null; denied: boolean } = { at: 0, value: null, denied: false };
async function windowsCpuTemp(): Promise<number | null> {
  if (winTemp.denied) return null;
  if (Date.now() - winTemp.at < 10_000) return winTemp.value;
  winTemp.at = Date.now();
  const out = await run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
    '(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop).CurrentTemperature'], 4000);
  const v = out === null ? null : parseAcpiKelvin(out);
  if (v === null) winTemp.denied = true;
  winTemp.value = v;
  return v;
}

async function cpuTemp(): Promise<{ value: number | null; source: string | null }> {
  const os = platform();
  if (os === 'linux') { const v = linuxCpuTemp(); return { value: v, source: v === null ? null : 'Linux sensors' }; }
  if (os === 'win32') { const v = await windowsCpuTemp(); return { value: v, source: v === null ? null : 'Windows thermal zone' }; }
  return { value: null, source: null };
}

export async function readHardware(): Promise<HardwareLive> {
  const list = cpus();
  const load = cpuLoad(list);
  const [gpusNv, temp] = await Promise.all([nvidia(), cpuTemp()]);
  let gpus = gpusNv;
  if (!gpus.length) { try { gpus = amdSysfs(); } catch { gpus = []; } }
  const notes: string[] = [];
  if (temp.value === null) {
    notes.push(platform() === 'win32'
      ? 'Windows only shares the CPU temperature with administrator rights on most PCs, so it isn\'t shown.'
      : platform() === 'darwin' ? 'macOS doesn\'t share the CPU temperature with apps that aren\'t signed for it.'
        : 'No CPU temperature sensor was found.');
  }
  if (!gpus.length) notes.push(existsSync('/System') && platform() === 'darwin' ? 'Apple silicon shares memory between the CPU and GPU; see System memory.' : 'No GPU reader answered (NVIDIA needs its driver\'s nvidia-smi; AMD is read on Linux).');
  return {
    t: Date.now(),
    cpu: { name: (list[0]?.model ?? 'CPU').replace(/\s+/g, ' ').trim(), cores: list.length, loadPct: Math.round(load.total * 10) / 10, perCore: load.perCore.map((v) => Math.round(v)), tempC: temp.value, tempSource: temp.source },
    ram: { usedMb: Math.round((totalmem() - freemem()) / 1048576), totalMb: Math.round(totalmem() / 1048576) },
    gpus,
    notes,
  };
}
