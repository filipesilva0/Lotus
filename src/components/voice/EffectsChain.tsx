import React, { useState } from 'react';
import { ArrowUp, ArrowDown, X, Plus, Save } from 'lucide-react';
import { AvailableEffect, EffectConfig, EffectPreset } from '../../services/voicebox';
import { Select, Slider, IconBtn, Btn, TextInput, cx } from '../common/ui';

const defaultsFor = (def: AvailableEffect): EffectConfig => ({
  type: def.type,
  enabled: true,
  params: Object.fromEntries(Object.entries(def.params).map(([k, v]) => [k, v.default])),
});

export const EffectsChain: React.FC<{
  chain: EffectConfig[];
  onChange: (c: EffectConfig[]) => void;
  available: AvailableEffect[];
  presets: EffectPreset[];
  onSavePreset?: (name: string, chain: EffectConfig[]) => Promise<void>;
}> = ({ chain, onChange, available, presets, onSavePreset }) => {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const byType = Object.fromEntries(available.map((a) => [a.type, a]));

  const patch = (i: number, next: Partial<EffectConfig>) => onChange(chain.map((e, j) => (j === i ? { ...e, ...next } : e)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= chain.length) return;
    const c = [...chain];
    [c[i], c[j]] = [c[j], c[i]];
    onChange(c);
  };

  return (
    <div className="space-y-2.5">
      <div className="flex gap-2">
        <Select aria-label="Effect preset" value="" onChange={(e) => {
          const p = presets.find((x) => x.id === e.target.value);
          if (p) onChange(p.effects_chain.map((x) => ({ ...x, params: { ...x.params } })));
        }}>
          <option value="">Apply a preset…</option>
          {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        {chain.length > 0 && <Btn size="sm" variant="ghost" className="h-9" onClick={() => onChange([])}>Clear</Btn>}
      </div>

      {chain.map((fx, i) => {
        const def = byType[fx.type];
        return (
          <div key={i} className={cx('rounded-xl border border-[var(--color-border-subtle)] p-2.5', !fx.enabled && 'opacity-55')}>
            <div className="flex items-center gap-1.5">
              <input type="checkbox" checked={fx.enabled} onChange={(e) => patch(i, { enabled: e.target.checked })}
                aria-label={`Enable ${def?.label ?? fx.type}`} className="accent-[var(--color-accent-vibrant)]" />
              <span className="text-xs font-semibold flex-1 truncate text-[var(--color-text-main)]">{def?.label ?? fx.type}</span>
              <IconBtn label="Move up" className="!w-6 !h-6" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="w-3 h-3" /></IconBtn>
              <IconBtn label="Move down" className="!w-6 !h-6" onClick={() => move(i, 1)} disabled={i === chain.length - 1}><ArrowDown className="w-3 h-3" /></IconBtn>
              <IconBtn label="Remove effect" className="!w-6 !h-6" onClick={() => onChange(chain.filter((_, j) => j !== i))}><X className="w-3 h-3" /></IconBtn>
            </div>
            {def && fx.enabled && (
              <div className="mt-2 space-y-2">
                {Object.entries(def.params).map(([k, pd]) => (
                  <div key={k}>
                    <div className="flex justify-between text-xs text-[var(--color-text-muted)] mb-1">
                      <span>{pd.description ?? k}</span>
                      <span className="tabular-nums">{(fx.params[k] ?? pd.default).toFixed(pd.step && pd.step >= 1 ? 0 : 2)}</span>
                    </div>
                    <Slider min={pd.min} max={pd.max} step={pd.step ?? 0.01} value={fx.params[k] ?? pd.default} label={pd.description ?? k}
                      onChange={(v) => patch(i, { params: { ...fx.params, [k]: v } })} />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div className="flex gap-2">
        <Select aria-label="Add effect" value="" onChange={(e) => {
          const d = byType[e.target.value];
          if (d) onChange([...chain, defaultsFor(d)]);
        }}>
          <option value="">+ Add effect…</option>
          {available.map((a) => <option key={a.type} value={a.type}>{a.label}</option>)}
        </Select>
        {onSavePreset && chain.length > 0 && !naming && (
          <Btn size="sm" variant="ghost" className="h-9" icon={<Save className="w-3.5 h-3.5" />} onClick={() => setNaming(true)}>Save</Btn>
        )}
      </div>
      {naming && (
        <div className="flex gap-2">
          <TextInput autoFocus placeholder="Preset name" value={name} onChange={(e) => setName(e.target.value)} />
          <Btn variant="primary" disabled={!name.trim()} icon={<Plus className="w-3.5 h-3.5" />}
            onClick={async () => { await onSavePreset!(name.trim(), chain); setName(''); setNaming(false); }}>Add</Btn>
        </div>
      )}
      {chain.length === 0 && <p className="text-xs text-[var(--color-text-muted)]">No effects. The voice is delivered as generated.</p>}
    </div>
  );
};
