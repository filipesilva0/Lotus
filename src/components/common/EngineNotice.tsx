import React, { createContext, useContext } from 'react';
import type { EngineId } from '../../services/engineConfig';
import { isRemote } from '../../services/engineConfig';
import { savedExe } from '../../services/engineControl';
import type { useEngines } from '../../hooks/useEngines';
import { Btn, Spinner, cx } from './ui';

/*
 * Engine status where it matters (session 13, HIG Feedback: "integrate status near the items it
 * describes"). One quiet line instead of a coloured banner: a grey dot, what's offline and what that
 * stops, and one button that starts the engine (or opens Engines when Lotus can't start it here).
 */

type Engines = ReturnType<typeof useEngines>;
interface Ctx { eng: Engines; openEngines: () => void }
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
