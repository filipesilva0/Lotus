// The short "Try Pro" card a Pro feature shows where it lives (0.18.0). Never a pop-up.
// Renders nothing while Pro features are unlocked (always, until the launch switch is on).

import React from 'react';
import { Sparkles } from 'lucide-react';
import { Btn } from '../common/ui';
import { PRO_COPY, usePro, type ProFeature } from '../../lib/pro';
import { openExternal } from '../../lib/open';

/** Opens Settings on the Lotus Pro pane (App listens for this). */
export const openProSettings = () => window.dispatchEvent(new CustomEvent('lotus:open-settings', { detail: 'pro' }));

export const TryPro: React.FC<{ feature: ProFeature; className?: string }> = ({ feature, className }) => {
  const pro = usePro();
  if (pro.unlocked) return null;
  const copy = PRO_COPY[feature];
  return (
    <div role="note" aria-label={copy.title}
      className={`rounded-[10px] border border-[var(--sep)] bg-[var(--hover)] px-4 py-3 flex items-start gap-3 ${className ?? ''}`}>
      <Sparkles className="w-4 h-4 mt-0.5 shrink-0 text-[var(--color-accent-vibrant)]" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-[var(--color-text-main)]">{copy.title}</p>
        <p className="text-[12px] text-[var(--color-text-muted)] leading-snug mt-0.5">{copy.body}</p>
        <div className="flex gap-2 mt-2">
          {pro.buyUrl && <Btn size="sm" variant="primary" onClick={() => void openExternal(pro.buyUrl)}>Get Lotus Pro</Btn>}
          <Btn size="sm" variant="ghost" onClick={openProSettings}>I have a key</Btn>
        </div>
      </div>
    </div>
  );
};

/** Shows the card instead of `children` when the feature is locked. */
export const ProGate: React.FC<{ feature: ProFeature; children: React.ReactNode; className?: string }> = ({ feature, children, className }) => {
  const pro = usePro();
  return pro.unlocked ? <>{children}</> : <TryPro feature={feature} className={className} />;
};
