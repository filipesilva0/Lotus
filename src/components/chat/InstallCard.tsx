import React from 'react';
import { Download, Check, X, AlertCircle } from 'lucide-react';
import { InstallTarget, engineLabel } from '../../chat/install';
import { isRemote, engineUrl } from '../../services/engineConfig';
import { jobIdsFor, useSetupJobs } from '../../setup/jobs';
import { Btn, Progress, cx } from '../common/ui';

/**
 * A model install the chat model proposed (session 11). Nothing happens until the user presses Allow;
 * then the download runs through the same jobs as the setup guide and its progress shows here.
 */
export const InstallCard: React.FC<{
  target: InstallTarget | null;
  /** The proposal could not be used; explained instead of offering Allow. */
  problem: string | null;
  decision?: { status: 'allowed' | 'denied' | 'failed'; error?: string };
  /** False while a reply is streaming or for older replies that were never answered. */
  enabled: boolean;
  onDecide: (allow: boolean) => void;
}> = ({ target, problem, decision, enabled, onDecide }) => {
  const jobs = useSetupJobs();
  const mine = target ? jobs.filter((j) => jobIdsFor(target).includes(j.id)) : [];
  const where = target && isRemote(target.engine) ? ` on ${engineUrl(target.engine).replace(/^https?:\/\//, '')}` : '';
  const running = mine.filter((j) => j.status === 'running');
  const failed = mine.find((j) => j.status === 'error');
  const done = mine.length > 0 && mine.every((j) => j.status === 'done');
  const progress = running.length ? running.reduce((a, j) => a + (j.progress ?? 0), 0) / running.length : null;

  let state: React.ReactNode = null;
  if (!target) state = <p className="text-[12px] leading-snug text-[var(--color-text-muted)]">{problem}</p>;
  else if (decision?.status === 'denied') state = <p className="text-[12px] text-[var(--color-text-muted)] inline-flex items-center gap-1.5"><X className="w-3.5 h-3.5" aria-hidden="true" />Denied. Nothing was downloaded.</p>;
  else if (decision?.status === 'failed') state = <p className="text-[12px] leading-snug text-[var(--c-red)] inline-flex items-start gap-1.5"><AlertCircle className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />{decision.error}</p>;
  else if (decision?.status === 'allowed') {
    state = failed ? <p className="text-[12px] leading-snug text-[var(--c-red)]">{failed.detail}</p>
      : done ? <p className="text-[12px] text-[var(--c-green)] inline-flex items-center gap-1.5"><Check className="w-3.5 h-3.5" aria-hidden="true" />{mine[0].detail === 'Already downloaded' ? 'Already installed' : 'Installed'}{target.engine === 'ollama' ? '. Pick it in the model menu next to Send.' : target.engine === 'comfyui' ? '. Pick it in Images.' : '. Use it in Voice.'}</p>
      : (
        <div className="space-y-2">
          <p className="text-[12px] text-[var(--color-text-muted)] truncate">{running[0]?.detail ?? 'Starting…'}</p>
          <Progress value={progress} label={`Installing ${target.title}`} />
        </div>
      );
  }

  return (
    <div role="group" aria-label="Install a model" className="mt-2 w-[min(560px,100%)] rounded-[12px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep),var(--shadow-1)] px-3.5 py-3 space-y-2.5">
      <div className="flex items-start gap-2.5">
        <span className="w-7 h-7 rounded-[8px] shrink-0 inline-flex items-center justify-center bg-[var(--color-accent-pastel)] text-[var(--color-accent-vibrant)]" aria-hidden="true">
          <Download className="w-3.5 h-3.5" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-[var(--color-text-main)]">{target ? `Install ${target.title}?` : 'Lotus cannot install this'}</p>
          {target && (
            <p className="text-[12px] text-[var(--color-text-muted)]">
              {engineLabel(target.engine)}{where}{target.diskGb ? ` · about ${target.diskGb} GB` : ''}
            </p>
          )}
          {target?.reason && <p className="mt-1 text-[12px] leading-snug text-[var(--color-text-main)]">{target.reason}</p>}
        </div>
      </div>
      {state}
      {target && !decision && (
        <div className={cx('flex items-center gap-2', !enabled && 'opacity-60')}>
          <Btn size="sm" variant="primary" disabled={!enabled} onClick={() => onDecide(true)} icon={<Check className="w-3 h-3" />}>Allow</Btn>
          <Btn size="sm" variant="secondary" disabled={!enabled} onClick={() => onDecide(false)} icon={<X className="w-3 h-3" />}>Deny</Btn>
          {!enabled && <span className="text-[12px] text-[var(--color-text-muted)]">Not answered</span>}
        </div>
      )}
    </div>
  );
};
