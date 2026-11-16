import React from 'react';
import { Check, ImageIcon, X } from 'lucide-react';
import { Btn } from '../common/ui';
import type { ImageProposal } from '../../chat/imageProposal';

/**
 * An image the chat model proposed (0.10.1): the prompt and the settings it chose, and Yes / No.
 * Yes opens Images with those settings and starts generating; nothing is made before the click.
 */
export const ImageProposalCard: React.FC<{
  proposal: ImageProposal | null;
  problem: string | null;
  decision?: { status: 'yes' | 'no' };
  /** False while a reply streams or after the user answered. */
  enabled: boolean;
  onDecide: (yes: boolean) => void;
}> = ({ proposal: p, problem, decision, enabled, onDecide }) => {
  const chips = p ? [
    p.model, p.aspect, p.resolution ? `${p.resolution} px` : 'Model size', `${p.count} image${p.count > 1 ? 's' : ''}`,
    p.steps ? `${p.steps} steps` : null, p.cfg ? `guidance ${p.cfg}` : null, p.sampler,
  ].filter(Boolean) as string[] : [];
  return (
    <div role="group" aria-label="Create an image" className="mt-2 w-[min(560px,100%)] rounded-[12px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep),var(--shadow-1)] px-3.5 py-3 space-y-2.5">
      <div className="flex items-start gap-2.5">
        <span className="w-7 h-7 rounded-[8px] shrink-0 inline-flex items-center justify-center bg-[var(--color-accent-pastel)] text-[var(--color-accent-vibrant)]" aria-hidden="true">
          <ImageIcon className="w-3.5 h-3.5" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-[var(--color-text-main)]">{p ? `Create ${p.title ? `“${p.title}”` : 'this image'} in Images now?` : 'Lotus can’t create this image'}</p>
          {p && <p className="mt-0.5 text-[12px] leading-snug text-[var(--color-text-muted)] line-clamp-3" title={p.prompt}>{p.prompt}</p>}
          {!p && <p className="mt-0.5 text-[12px] leading-snug text-[var(--color-text-muted)]">{problem}</p>}
        </div>
      </div>
      {p && (
        <div className="flex flex-wrap gap-1">
          {chips.map((c) => <span key={c} className="h-6 px-2 inline-flex items-center rounded-[6px] bg-[var(--hover)] text-[12px] max-w-[220px] truncate">{c}</span>)}
        </div>
      )}
      {p?.why && <p className="text-[12px] leading-snug text-[var(--color-text-main)]">{p.why}</p>}
      {p && (decision
        ? <p className="text-[12px] text-[var(--color-text-muted)] inline-flex items-center gap-1.5">{decision.status === 'yes' ? <><Check className="w-3.5 h-3.5" aria-hidden="true" />Started in Images with these settings.</> : <><X className="w-3.5 h-3.5" aria-hidden="true" />Not created.</>}</p>
        : (
          <div className="flex gap-2">
            <Btn size="sm" variant="primary" disabled={!enabled} icon={<Check className="w-3 h-3" />} onClick={() => onDecide(true)}>Yes, Create It</Btn>
            <Btn size="sm" disabled={!enabled} onClick={() => onDecide(false)}>No</Btn>
          </div>
        ))}
    </div>
  );
};
