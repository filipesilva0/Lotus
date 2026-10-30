import React from 'react';
import { Plus, X } from 'lucide-react';
import type { LoraUse } from '../../services/comfyService';
import { Btn, IconBtn, Select } from '../common/ui';
import { SliderField } from '../common/Pane';

const MAX = 4;

/**
 * Optional LoRAs for the checkpoint: pick up to four, each with its own strength.
 * `available` comes from ComfyUI's models/loras folder; more can be downloaded in Engines → Models.
 */
export const LoraPicker: React.FC<{
  available: string[]; value: LoraUse[]; onChange: (next: LoraUse[]) => void; comfyUp: boolean | null; onGetMore: () => void;
}> = ({ available, value, onChange, comfyUp, onGetMore }) => {
  const unused = available.filter((n) => !value.some((v) => v.name === n));
  const setAt = (i: number, p: Partial<LoraUse>) => onChange(value.map((v, k) => (k === i ? { ...v, ...p } : v)));
  const missing = (n: string) => comfyUp && available.length > 0 && !available.includes(n);

  return (
    <div>
      {!value.length && (
        <p className="text-[12px] text-[var(--color-text-muted)] leading-snug mb-2">
          {comfyUp === false ? 'Start ComfyUI to list your LoRAs.'
            : available.length ? 'No LoRA is applied. Add one to steer the style or subject.'
            : 'No LoRAs found in ComfyUI\u2019s models/loras folder yet.'}
        </p>
      )}
      <ul className="space-y-3">
        {value.map((l, i) => (
          <li key={`${l.name}-${i}`} className="rounded-[8px] bg-[var(--hover)] p-2">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Select aria-label={`LoRA ${i + 1}`} value={l.name} onChange={(e) => setAt(i, { name: e.target.value })}>
                {!available.includes(l.name) && <option value={l.name}>{l.name}</option>}
                {available.map((n) => <option key={n} value={n} disabled={n !== l.name && value.some((v) => v.name === n)}>{n}</option>)}
              </Select>
              <IconBtn label={`Remove LoRA ${l.name}`} className="!w-6 !h-6 shrink-0" onClick={() => onChange(value.filter((_, k) => k !== i))}><X className="w-3.5 h-3.5" /></IconBtn>
            </div>
            <SliderField label="Strength" value={l.strength} min={0} max={2} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => setAt(i, { strength: Math.round(v * 100) / 100 })}
              hint={missing(l.name) ? 'This file is not in ComfyUI\u2019s LoRA list any more; generating will fail until you pick another.' : undefined} />
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-2">
        <Btn size="sm" icon={<Plus className="w-3 h-3" />} disabled={!unused.length || value.length >= MAX} onClick={() => onChange([...value, { name: unused[0], strength: 0.8 }])}>Add LoRA</Btn>
        <button type="button" className="text-[12px] font-medium text-[var(--color-accent-vibrant)] hover:underline" onClick={onGetMore}>Get more LoRAs…</button>
      </div>
      {value.length >= MAX && <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">Up to {MAX} LoRAs at once.</p>}
    </div>
  );
};
