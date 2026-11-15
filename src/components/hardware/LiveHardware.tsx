// Engines & Models → Hardware & Runtime: live CPU, memory and GPU readings from the core's native
// sensors (core/src/hardware.ts), with two minutes of history per measure (session 16).
// One measure per chart (never two scales on one axis); each tile names its measure, so no legend.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Cpu, MemoryStick, Thermometer, Zap, Fan, Gauge as GaugeIcon } from 'lucide-react';
import { rpc } from '../../lib/core';
import { agentAvailable } from '../../lib/agent';
import { cx } from '../common/ui';
import { Tip } from '../common/Tip';

export interface GpuLive { name: string; vendor: string; loadPct: number | null; memUsedMb: number | null; memTotalMb: number | null; tempC: number | null; powerW: number | null; powerLimitW: number | null; fanPct: number | null; clockMhz: number | null }
export interface HardwareLive { t: number; cpu: { name: string; cores: number; loadPct: number; perCore: number[]; tempC: number | null; tempSource: string | null }; ram: { usedMb: number; totalMb: number }; gpus: GpuLive[]; notes: string[] }

const HISTORY = 60; // 2 s apart → two minutes

/** Polls the core every two seconds while mounted. */
export function useLiveHardware() {
  const [hist, setHist] = useState<HardwareLive[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!agentAvailable()) { setErr('Live readings come from the Lotus core, which runs with the desktop app.'); return; }
    let off = false;
    const tick = async () => {
      try { const r = await rpc<HardwareLive>('hw_live'); if (!off) { setHist((h) => [...h, r].slice(-HISTORY)); setErr(null); } }
      catch (e) { if (!off) setErr((e as Error).message); }
    };
    void tick();
    const t = setInterval(tick, 2000);
    return () => { off = true; clearInterval(t); };
  }, []);
  return { hist, last: hist[hist.length - 1] ?? null, err };
}

/** Temperature reads as a status: the number always shows, the colour only adds to it. */
function heat(c: number | null): { tone: string; word: string } {
  if (c === null) return { tone: 'var(--color-text-muted)', word: '' };
  if (c >= 85) return { tone: 'var(--c-red)', word: 'Hot' };
  if (c >= 72) return { tone: 'var(--c-orange)', word: 'Warm' };
  return { tone: 'var(--c-green)', word: 'Normal' };
}

/** A ring for one percentage, with the number in the middle. */
const Ring: React.FC<{ pct: number | null; color: string; label: string; size?: number }> = ({ pct, color, label, size = 84 }) => {
  const r = (size - 10) / 2, c = 2 * Math.PI * r;
  const v = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}: ${pct === null ? 'not available' : `${Math.round(v)}%`}`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--hover)" strokeWidth="7" />
      {pct !== null && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
        strokeDasharray={`${(v / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dasharray .6s ease' }} />}
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="fill-[var(--color-text-main)] text-[17px] font-semibold tabular-nums">{pct === null ? '—' : `${Math.round(v)}%`}</text>
    </svg>
  );
};

/** Area chart for one measure over the last two minutes, with a hover crosshair and value. */
export const History: React.FC<{ values: (number | null)[]; max: number; color: string; label: string; unit: string; height?: number }> = ({ values, max, color, label, unit, height = 64 }) => {
  const w = 320, h = height;
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const x = (i: number) => (i / (HISTORY - 1)) * w;
  const y = (v: number) => h - 2 - Math.min(1, v / Math.max(0.0001, max)) * (h - 6);
  const offset = HISTORY - values.length;
  const pts = values.map((v, i) => (v === null ? null : [x(i + offset), y(v)] as const));
  const segs: (readonly [number, number])[][] = [];
  let cur: (readonly [number, number])[] = [];
  pts.forEach((p) => { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } });
  if (cur.length) segs.push(cur);
  const move = (e: React.MouseEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const i = Math.round(((e.clientX - r.left) / r.width) * (HISTORY - 1)) - offset;
    setHover(i >= 0 && i < values.length ? i : null);
  };
  const hv = hover === null ? null : values[hover];
  return (
    <div className="relative">
      <svg ref={ref} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={`${label} over the last two minutes`} className="w-full block" style={{ height: h }}
        onMouseMove={move} onMouseLeave={() => setHover(null)}>
        {[0.5, 1].map((f) => <line key={f} x1="0" x2={w} y1={y(max * f)} y2={y(max * f)} stroke="var(--sep)" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
        {segs.map((s, k) => (
          <g key={k}>
            <path d={`M${s[0][0]},${h} ${s.map((p) => `L${p[0]},${p[1]}`).join(' ')} L${s[s.length - 1][0]},${h} Z`} fill={color} opacity="0.14" />
            <polyline points={s.map((p) => `${p[0]},${p[1]}`).join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </g>
        ))}
        {hover !== null && <line x1={x(hover + offset)} x2={x(hover + offset)} y1="0" y2={h} stroke="var(--color-text-muted)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute -top-7 px-1.5 py-0.5 rounded-[5px] material-overlay text-[12px] tabular-nums whitespace-nowrap"
          style={{ left: `clamp(0px, calc(${((hover + offset) / (HISTORY - 1)) * 100}% - 40px), calc(100% - 90px))` }}>
          {hv === null ? 'no reading' : `${hv.toFixed(hv < 10 ? 1 : 0)} ${unit}`} · {Math.round((values.length - 1 - hover) * 2)} s ago
        </div>
      )}
    </div>
  );
};

const Fact: React.FC<{ icon: React.ReactNode; label: string; value: string; tone?: string; tip?: string }> = ({ icon, label, value, tone, tip }) => (
  <div className="flex items-center gap-2 min-w-0">
    <span className="text-[var(--color-text-muted)]">{icon}</span>
    <span className="text-[12px] text-[var(--color-text-muted)]">{label}</span>
    {tip && <Tip text={tip} />}
    <span className="ml-auto text-[13px] font-medium tabular-nums" style={tone ? { color: tone } : undefined}>{value}</span>
  </div>
);

const gb = (mb: number | null) => (mb === null ? '—' : `${(mb / 1024).toFixed(1)} GB`);
const Tile: React.FC<{ title: string; sub?: string; children: React.ReactNode; className?: string }> = ({ title, sub, children, className }) => (
  <section className={cx('rounded-[12px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)] p-4 min-w-0', className)}>
    <header className="mb-3"><h2 className="text-[13px] font-semibold truncate">{title}</h2>{sub && <p className="text-[12px] text-[var(--color-text-muted)] truncate">{sub}</p>}</header>
    {children}
  </section>
);

export const LiveHardware: React.FC = () => {
  const { hist, last, err } = useLiveHardware();
  const series = useMemo(() => ({
    cpu: hist.map((h) => h.cpu.loadPct),
    cpuTemp: hist.map((h) => h.cpu.tempC),
    ram: hist.map((h) => h.ram.usedMb / 1024),
    gpu: (i: number) => ({
      load: hist.map((h) => h.gpus[i]?.loadPct ?? null),
      mem: hist.map((h) => (h.gpus[i]?.memUsedMb ?? null) === null ? null : h.gpus[i].memUsedMb! / 1024),
      temp: hist.map((h) => h.gpus[i]?.tempC ?? null),
      power: hist.map((h) => h.gpus[i]?.powerW ?? null),
    }),
  }), [hist]);

  if (err && !last) return <p className="text-[13px] text-[var(--color-text-muted)]">{err}</p>;
  if (!last) return <p className="text-[13px] text-[var(--color-text-muted)]">Reading your hardware…</p>;

  const ramPct = (last.ram.usedMb / Math.max(1, last.ram.totalMb)) * 100;
  const ct = heat(last.cpu.tempC);
  return (
    <div className="space-y-3">
      {last.gpus.map((g, i) => {
        const s = series.gpu(i);
        const memPct = g.memUsedMb !== null && g.memTotalMb ? (g.memUsedMb / g.memTotalMb) * 100 : null;
        const gt = heat(g.tempC);
        return (
          <Tile key={i} title={g.name} sub={g.vendor === 'nvidia' ? 'Graphics card · read from the NVIDIA driver' : 'Graphics card · read from Linux sysfs'}>
            <div className="grid grid-cols-[auto_auto_1fr] gap-5 items-center">
              <div className="flex flex-col items-center gap-1"><Ring pct={g.loadPct} color="var(--c-blue)" label="GPU load" /><span className="text-[12px] text-[var(--color-text-muted)]">Load</span></div>
              <div className="flex flex-col items-center gap-1"><Ring pct={memPct} color="var(--c-purple)" label="Video memory" /><span className="text-[12px] text-[var(--color-text-muted)]">Video memory</span></div>
              <div className="space-y-1.5 min-w-0">
                <Fact icon={<MemoryStick className="w-3.5 h-3.5" />} label="Video memory" value={`${gb(g.memUsedMb)} / ${gb(g.memTotalMb)}`} tip="VRAM: memory on the graphics card. A model runs fast only when it fits here; what doesn't fit spills into slower system memory." />
                <Fact icon={<Thermometer className="w-3.5 h-3.5" />} label="Temperature" value={g.tempC === null ? '—' : `${Math.round(g.tempC)} °C${gt.word ? ` · ${gt.word}` : ''}`} tone={gt.tone} />
                <Fact icon={<Zap className="w-3.5 h-3.5" />} label="Power" value={g.powerW === null ? '—' : `${Math.round(g.powerW)} W${g.powerLimitW ? ` of ${Math.round(g.powerLimitW)} W` : ''}`} />
                <Fact icon={<Fan className="w-3.5 h-3.5" />} label="Fan" value={g.fanPct === null ? '—' : `${Math.round(g.fanPct)}%`} />
                <Fact icon={<GaugeIcon className="w-3.5 h-3.5" />} label="Clock" value={g.clockMhz === null ? '—' : `${g.clockMhz} MHz`} />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3">
              <div><p className="text-[12px] text-[var(--color-text-muted)] mb-1">Load, %</p><History values={s.load} max={100} color="var(--c-blue)" label="GPU load" unit="%" /></div>
              <div><p className="text-[12px] text-[var(--color-text-muted)] mb-1">Video memory, GB</p><History values={s.mem} max={(g.memTotalMb ?? 1024) / 1024} color="var(--c-purple)" label="Video memory" unit="GB" /></div>
              <div><p className="text-[12px] text-[var(--color-text-muted)] mb-1">Temperature, °C</p><History values={s.temp} max={100} color="var(--c-orange)" label="GPU temperature" unit="°C" /></div>
              <div><p className="text-[12px] text-[var(--color-text-muted)] mb-1">Power, W</p><History values={s.power} max={g.powerLimitW ?? Math.max(50, ...s.power.map((v) => v ?? 0))} color="var(--c-green)" label="GPU power" unit="W" /></div>
            </div>
          </Tile>
        );
      })}

      <div className="grid grid-cols-2 gap-3">
        <Tile title="Processor" sub={`${last.cpu.name} · ${last.cpu.cores} threads`}>
          <div className="flex items-center gap-4">
            <Ring pct={last.cpu.loadPct} color="var(--c-blue)" label="CPU load" size={72} />
            <div className="flex-1 min-w-0 space-y-1.5">
              <Fact icon={<Thermometer className="w-3.5 h-3.5" />} label="Temperature" value={last.cpu.tempC === null ? '—' : `${Math.round(last.cpu.tempC)} °C${ct.word ? ` · ${ct.word}` : ''}`} tone={ct.tone} />
              <div className="flex items-end gap-[2px] h-7" role="img" aria-label="Load per thread">
                {last.cpu.perCore.map((v, i) => <span key={i} title={`Thread ${i + 1}: ${v}%`} className="flex-1 rounded-t-[2px] bg-[var(--c-blue)] min-h-[2px]" style={{ height: `${Math.max(4, v)}%`, opacity: 0.35 + v / 160 }} />)}
              </div>
            </div>
          </div>
          <div className="mt-3"><p className="text-[12px] text-[var(--color-text-muted)] mb-1">Load, %</p><History values={series.cpu} max={100} color="var(--c-blue)" label="CPU load" unit="%" height={52} /></div>
          {last.cpu.tempC !== null && <div className="mt-2"><p className="text-[12px] text-[var(--color-text-muted)] mb-1">Temperature, °C</p><History values={series.cpuTemp} max={100} color="var(--c-orange)" label="CPU temperature" unit="°C" height={44} /></div>}
        </Tile>
        <Tile title="System memory" sub={`${gb(last.ram.usedMb)} of ${gb(last.ram.totalMb)} in use`}>
          <div className="flex items-center gap-4"><Ring pct={ramPct} color="var(--c-green)" label="System memory" size={72} />
            <p className="text-[12px] text-[var(--color-text-muted)] leading-snug">Models that don't fit in video memory run partly from here, which is several times slower.</p></div>
          <div className="mt-3"><p className="text-[12px] text-[var(--color-text-muted)] mb-1">In use, GB</p><History values={series.ram} max={last.ram.totalMb / 1024} color="var(--c-green)" label="System memory in use" unit="GB" height={52} /></div>
        </Tile>
      </div>
      {last.notes.length > 0 && <ul className="text-[12px] text-[var(--color-text-muted)] space-y-0.5">{last.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
    </div>
  );
};
