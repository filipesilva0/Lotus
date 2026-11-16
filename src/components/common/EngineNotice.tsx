import React, { createContext, useContext } from 'react';
import type { EngineId } from '../../services/engineConfig';
import { isRemote } from '../../services/engineConfig';
import { savedExe } from '../../services/engineControl';
import type { useEngines } from '../../hooks/useEngines';
import { Btn, Spinner, cx } from './ui';
import { useBuiltins, type BuiltinId } from '../../lib/builtins';

/*
 * Engine status where it matters (session 13, HIG Feedback: "integrate status near the items it
 * describes"). One quiet line instead of a coloured banner: a grey dot, what's offline and what that
 * stops, and one button that starts the engine (or opens Engines when Lotus can't start it here).
 */

type Engines = ReturnType<typeof useEngines>;
interface Ctx { eng: Engines; openEngines: () => void; openModels?: () => void }
export const EnginesContext = createContext<Ctx | null>(null);

export const ENGINE_NAMES: Record<EngineId, string> = { ollama: 'Ollama', comfyui: 'ComfyUI', voicebox: 'Voicebox' };

/** Lotus can start this engine itself: it runs on this computer and Lotus knows where it is. */
export const canStart = (id: EngineId) => !isRemote(id) && (id !== 'comfyui' || !!savedExe(id));

export const EngineNotice: React.FC<{
  id: EngineId;
  /** What the engine is needed for, as the end of a sentence: "to chat". */
  purpose: string;
  /** Shown instead of `purpose` when it explains more, e.g. what still works. */
  note?: string;
  className?: string;
}> = ({ id, purpose, note, className }) => {
  const ctx = useContext(EnginesContext);
  const name = ENGINE_NAMES[id];
  const st = ctx?.eng.engines[id];
  const starting = st?.phase === 'starting';
  const startable = !!ctx && canStart(id) && !st?.needsExe;
  const problem = st?.needsExe ? `Lotus doesn't know where ${name} is installed yet.` : st?.error ?? null;

  return (
    <div role="status" className={cx('flex items-center gap-2 min-h-7 text-[12px] text-[var(--color-text-muted)]', className)}>
      {starting
        ? <Spinner className="w-3 h-3 shrink-0" />
        : <span aria-hidden="true" className="w-2 h-2 rounded-full shrink-0 bg-[var(--color-text-muted)] opacity-60" />}
      <span className="min-w-0">
        {starting ? `Starting ${name}…` : problem ? `${name} didn't start. ${problem}` : `${name} is offline. ${note ?? `Start it ${purpose}.`}`}
      </span>
      {ctx && !starting && (startable && !problem
        ? <Btn size="sm" onClick={() => void ctx.eng.start(id)}>Start {name}</Btn>
        : <Btn size="sm" onClick={ctx.openEngines}>Open Engines</Btn>)}
    </div>
  );
};

/**
 * The same line for Lotus's own engines (session 17): nothing to start, but the engine or a model
 * may still need downloading. Shows the download's progress while it runs.
 */
export const BuiltinNotice: React.FC<{ kind: 'chat' | 'image' | 'voice'; purpose: string; className?: string }> = ({ kind, purpose, className }) => {
  const ctx = useContext(EnginesContext);
  const b = useBuiltins();
  const engine: BuiltinId = kind === 'chat' ? 'llama' : kind === 'image' ? 'sd' : 'sherpa';
  const word = kind === 'chat' ? 'chat' : kind === 'image' ? 'image' : 'voice';
  const info = b.engines.find((e) => e.id === engine);
  const installed = info?.installed;
  const job = b.jobs.find((j) => j.state === 'running' && (j.target === `engine:${engine}` || (j.kind === 'model' && b.loaded)));
  const pct = job && job.total ? ` ${Math.round((job.done / job.total) * 100)}%` : '';
  const text = job ? `Downloading ${job.label}…${pct}`
    : !b.available ? `Lotus's own ${word} engine needs the Lotus core, which isn't running.`
    : info?.outdated ? `Lotus's ${word} engine needs an update. Update it in Models.`
    : !installed ? `Lotus's ${word} engine isn't installed yet. Get it and a model ${purpose}.`
    : kind === 'image' ? 'No image model is ready. Get one, or finish its setup, in Models.'
    : `No ${word} model yet. Get one ${purpose}.`;
  return (
    <div role="status" className={cx('flex items-center gap-2 min-h-7 text-[12px] text-[var(--color-text-muted)]', className)}>
      {job ? <Spinner className="w-3 h-3 shrink-0" /> : <span aria-hidden="true" className="w-2 h-2 rounded-full shrink-0 bg-[var(--color-text-muted)] opacity-60" />}
      <span className="min-w-0">{text}</span>
      {ctx?.openModels && !job && b.available && <Btn size="sm" onClick={ctx.openModels}>Get Models</Btn>}
    </div>
  );
};
