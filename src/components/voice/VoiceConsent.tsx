import React from 'react';
import { Checkbox } from '../common/ui';
import { VOICE_CONSENT, VOICE_CONSENT_NOTE } from '../../voice/studio';

/** The tick box asked for before Lotus copies a voice from a recording (0.17.0). */
export const VoiceConsent: React.FC<{ checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }> = ({ checked, onChange, disabled }) => (
  <div className="rounded-[10px] bg-[var(--hover)] px-3 py-2.5 space-y-1">
    <Checkbox checked={checked} onChange={onChange} disabled={disabled} label={VOICE_CONSENT} />
    <p className="text-[12px] text-[var(--color-text-muted)] leading-snug pl-[22px]">{VOICE_CONSENT_NOTE}</p>
  </div>
);
