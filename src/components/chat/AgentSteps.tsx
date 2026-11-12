// What the agent did for a reply, step by step, with each step's real result (session 15).
// Always visible: a reply can't say it did something without a step here ("no step, no claim").
// A step that needs permission shows what it is about to do with Deny / Allow.

import React, { useEffect, useState } from 'react';
import { AlertCircle, Ban, Check, Loader2, ShieldQuestion } from 'lucide-react';
import type { ChatToolCall } from '../../types/lotus';
import { loadMedia } from '../../lib/core';
import { Btn, cx } from '../common/ui';

const MediaThumb: React.FC<{ path: string; label: string }> = ({ path, label }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let u: string | null = null;
    let live = true;
    loadMedia(path).then((b) => { if (!live) return; u = URL.createObjectURL(b); setUrl(u); }).catch(() => live && setFailed(true));
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [path]);
  if (failed) return <span className="text-[12px] text-[var(--color-text-muted)]">{path.split('/').pop()} is no longer in the Lotus Studio folder.</span>;
  if (!url) return <span className="block w-[200px] h-[200px] rounded-[8px] bg-[var(--hover)] animate-pulse" aria-label={`Loading ${label}`} />;
  return /\.(wav|mp3|ogg|webm|flac)$/i.test(path)
    ? <audio controls src={url} className="w-[260px]" aria-label={label} />
    : <img src={url} alt={label} className="max-w-[280px] max-h-[280px] rounded-[8px] shadow-[0_0_0_0.5px_var(--sep)]" />;
};

const Icon: React.FC<{ s: ChatToolCall['status'] }> = ({ s }) => {
  if (s === 'running') return <Loader2 className="w-3.5 h-3.5 mt-px animate-spin shrink-0 text-[var(--color-text-muted)]" aria-label="Running" />;
  if (s === 'waiting') return <ShieldQuestion className="w-3.5 h-3.5 mt-px shrink-0 text-[var(--c-orange)]" aria-label="Waiting for you" />;
  if (s === 'error') return <AlertCircle className="w-3.5 h-3.5 mt-px shrink-0 text-[var(--c-red)]" aria-label="Failed" />;
  if (s === 'denied') return <Ban className="w-3.5 h-3.5 mt-px shrink-0 text-[var(--color-text-muted)]" aria-label="Not done" />;
  return <Check className="w-3.5 h-3.5 mt-px shrink-0 text-[var(--c-green)]" aria-label="Done" />;
};

export const AgentSteps: React.FC<{
  steps: ChatToolCall[];
  /** Allow / Deny for a waiting step (absent when the reply is no longer live). */
  onDecide?: (step: ChatToolCall, allow: boolean) => void;
}> = ({ steps, onDecide }) => {
  if (!steps.length) return null;
  return (
    <ol className="mb-2 space-y-1.5" aria-label="Steps Lotus took">
      {steps.map((t) => (
        <li key={t.id} className="text-[12px]">
          <div className="flex items-start gap-2">
            <Icon s={t.status} />
            <span className={cx('min-w-0', t.status === 'denied' && 'text-[var(--color-text-muted)]')}>
              <span className="font-medium">{t.status === 'waiting' ? 'Needs your permission' : t.label}</span>
              {t.status !== 'waiting' && t.detail && <span className="text-[var(--color-text-muted)]"> · {t.detail}</span>}
            </span>
          </div>
          {t.status === 'waiting' && (
            <div className="ml-5.5 mt-1.5 rounded-[8px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)] px-3 py-2 max-w-[460px]" role="group" aria-label="Permission request">
              <p className="text-[13px] text-[var(--color-text-main)] break-words">{t.ask ?? t.label}</p>
              <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">{t.tool}. You can change what needs asking in Settings → Tools.</p>
              {onDecide ? (
                <div className="flex justify-end gap-2 mt-2">
                  <Btn size="sm" variant="secondary" onClick={() => onDecide(t, false)}>Deny</Btn>
                  <Btn size="sm" variant="primary" onClick={() => onDecide(t, true)}>Allow</Btn>
                </div>
              ) : <p className="text-[12px] text-[var(--color-text-muted)] mt-1.5">This request ended without an answer, so nothing was done.</p>}
            </div>
          )}
          {!!t.media?.length && (
            <div className="ml-5.5 mt-1.5 flex flex-wrap gap-2">
              {t.media.map((p) => <MediaThumb key={p} path={p} label={t.detail ?? t.label} />)}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
};

/** Shown under a reply that says Lotus did something no step did. */
export const UnverifiedNote: React.FC<{ items: string[] }> = ({ items }) => (
  <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-[var(--c-orange)]" role="status">
    <AlertCircle className="w-3.5 h-3.5 mt-px shrink-0" />
    <span>This reply says Lotus did something it didn’t: no step tried to {items.join(' or ')}. Nothing was changed. Ask again, or try a model that supports tools.</span>
  </p>
);
