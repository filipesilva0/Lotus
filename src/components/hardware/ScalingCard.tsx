import React from 'react';
import { Cpu, RefreshCw } from 'lucide-react';
import { hardware, useHardware } from '../../hardware/monitor';
import { useAgentPool } from '../../agents/pool';
import { Card, Gauge, IconBtn, cx } from '../common/ui';
import { KV } from '../common/Pane';

const SOURCE: Record<string, string> = {
  'nvidia-smi': 'NVIDIA driver (nvidia-smi)',
  'amdgpu-sysfs': 'AMD driver (sysfs)',
  'windows-counters': 'Windows GPU counters',
  comfyui: 'ComfyUI',
  none: 'not measured',
};

const gb = (mb: number) => `${(mb / 1024).toFixed(1)} GB`;

/** Live view of the VRAM auto-scaler: memory, the limits it chose and why. */
export const ScalingCard: React.FC<{ className?: string; compact?: boolean }> = ({ className, compact }) => {
  const h = useHardware();
  const pool = useAgentPool();
  const g = h.hw?.gpu;
  const p = h.plan;
  const running = pool.jobs.filter((j) => j.status === 'running').length;
  const queued = pool.jobs.length - running;
  return (
    <Card className={cx('p-3.5', className)}>
      <div className="flex items-center gap-2 mb-2">
        <Cpu className="w-4 h-4 text-[var(--color-accent-vibrant)]" aria-hidden="true" />
        <span className="text-[13px] font-semibold flex-1">Auto-scaling to video memory</span>
        <span className={cx('text-[11px] font-medium', p.pressure === 'critical' ? 'text-[var(--c-red)]' : p.pressure === 'tight' ? 'text-[var(--c-orange)]' : 'text-[var(--color-text-muted)]')}>
          {p.pressure === 'critical' ? 'Almost full' : p.pressure === 'tight' ? 'Tight' : p.pressure === 'ok' ? 'Plenty free' : ''}
        </span>
        <IconBtn label="Measure again" className="!w-6 !h-6" onClick={() => void hardware.refresh()}><RefreshCw className="w-3.5 h-3.5" /></IconBtn>
      </div>
      {g ? (
        <>
          <Gauge value={g.usedMb / Math.max(1, g.totalMb)} label="Video memory in use" />
          <p className="mt-1 text-[11px] text-[var(--color-text-muted)] tabular-nums">{gb(g.freeMb)} free of {gb(g.totalMb)} · {g.name} · {SOURCE[h.hw!.source]}</p>
        </>
      ) : <p className="text-[12px] text-[var(--color-text-muted)]">Video memory could not be read (no NVIDIA/AMD driver reader answered and ComfyUI isn't running).</p>}
      <div className="mt-2.5 grid grid-cols-3 gap-2">
        <Stat label="Context window" value={`${p.numCtx.toLocaleString()}`} unit="tokens" />
        <Stat label="Background agents" value={`${running}/${p.maxSubagents}`} unit={queued ? `${queued} waiting` : 'running / allowed'} />
        <Stat label="Model size that fits" value={p.recommendedParamsB ? `≤ ${p.recommendedParamsB}B` : '—'} unit="4-bit, 8K context" />
      </div>
      {!compact && (
        <>
          <div className="mt-2.5">
            {h.agentModel && <KV k="Agents use" v={h.agentModel} mono />}
            <KV k="File chunk size" v={`${p.chunkChars.toLocaleString()} characters`} />
            {p.perAgentMb > 0 && <KV k="Cost of one more agent" v={gb(p.perAgentMb)} />}
            {h.model && <KV k="Selected model" v={`${h.model.name} · ${gb(h.model.weightsMb)}${h.model.loadedVramMb ? ' · loaded' : ''}`} mono />}
            {p.llamacppFlags && <KV k="Suggested llama-server flags" v={p.llamacppFlags} mono />}
          </div>
          <ul className="mt-2 space-y-0.5 text-[11px] text-[var(--color-text-muted)] leading-snug list-disc pl-4">
            {p.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </>
      )}
    </Card>
  );
};

const Stat: React.FC<{ label: string; value: string; unit: string }> = ({ label, value, unit }) => (
  <div className="rounded-[8px] bg-[var(--hover)] px-2.5 py-2 min-w-0">
    <p className="text-[11px] text-[var(--color-text-muted)] truncate">{label}</p>
    <p className="text-[15px] font-semibold tabular-nums truncate">{value}</p>
    <p className="text-[11px] text-[var(--color-text-muted)] truncate">{unit}</p>
  </div>
);
