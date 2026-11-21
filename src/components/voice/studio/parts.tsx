// Shared parts of the Voice page with Lotus's own engine (0.8.2): the voice picker, the effects
// panel (presets first, every knob under "Fine-Tune"), and clip audio read from Lotus Studio.

import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Play, Square, Sparkles, Boxes, Plus , Check } from 'lucide-react';
import { AudioPlayer } from '../AudioPlayer';
import { MenuItem, Popover, SliderField } from '../../common/Pane';
import { PickerButton, ModeButton } from '../../common/PromptBox';
import { Btn, Checkbox, Segmented, cx } from '../../common/ui';
import { loadMedia } from '../../../lib/core';
import { EFFECT_PRESETS, Effects, NO_EFFECTS, VoiceOption, effectsNeutral, presetOf, withEffects } from '../../../voice/studio';
import { previewEffects } from '../../../voice/render';

/** A clip's audio, read from Lotus Studio when it is first shown. */
export const ClipAudio: React.FC<{ path: string; autoPlay?: boolean }> = ({ path, autoPlay }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    let u = '';
    setUrl(null); setGone(false);
    loadMedia(path).then((b) => { u = URL.createObjectURL(b); setUrl(u); }).catch(() => setGone(true));
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [path]);
  if (gone) return <p className="text-[12px] text-[var(--color-text-muted)]">The audio file is no longer in Lotus Studio.</p>;
  return <AudioPlayer src={url} autoPlay={autoPlay} onDownload={url ? () => { const a = document.createElement('a'); a.href = url; a.download = path.split('/').pop() || 'clip.wav'; a.click(); } : undefined} />;
};

/** Voice picker for the chat bar: your voices, then the built-in speakers. */
export const VoicePicker: React.FC<{ options: VoiceOption[]; value: VoiceOption | null; onPick: (id: string) => void; onNewVoice?: () => void; onGetVoices: () => void; title?: string }> = ({ options, value, onPick, onNewVoice, onGetVoices, title = 'Voice' }) => {
  const mine = options.filter((o) => o.mine), presets = options.filter((o) => !o.mine);
  return (
    <Popover up align="right" className="w-[320px] !max-h-[420px]" trigger={(o, t) => <PickerButton open={o} onClick={t} title={title} text={value?.name ?? 'No voice'} chevron={<ChevronDown className={cx('w-3.5 h-3.5 shrink-0 opacity-70', o && 'rotate-180')} />} />}>
      {(close) => (<>
        {mine.length > 0 && <p className="px-2.5 pt-1.5 pb-1 text-[12px] font-semibold text-[var(--color-text-muted)]">Your Voices</p>}
        {mine.map((v) => (
          <MenuItem key={v.id} active={v.id === value?.id} disabled={!v.ready} title={v.why} onClick={() => { onPick(v.id); close(); }}>
            <span className="flex-1 min-w-0 truncate">{v.name}</span><span className="text-[12px] opacity-70 truncate max-w-[45%]">{v.ready ? v.detail : v.why}</span>
          </MenuItem>
        ))}
        {presets.length > 0 && <p className="px-2.5 pt-2 pb-1 text-[12px] font-semibold text-[var(--color-text-muted)]">Built-in Voices</p>}
        {presets.map((v) => (
          <MenuItem key={v.id} active={v.id === value?.id} onClick={() => { onPick(v.id); close(); }}>
            <span className="flex-1 min-w-0 truncate">{v.name}</span><span className="text-[12px] opacity-70 truncate max-w-[45%]">{v.detail}</span>
          </MenuItem>
        ))}
        {!options.length && <p className="p-2.5 text-[12px] text-[var(--color-text-muted)]">No voice downloaded yet.</p>}
        <div className="my-1 border-t border-[var(--sep)]" />
        {onNewVoice && <MenuItem onClick={() => { close(); onNewVoice(); }}><Plus className="w-3.5 h-3.5" />Make a Voice…</MenuItem>}
        <MenuItem onClick={() => { close(); onGetVoices(); }}><Boxes className="w-3.5 h-3.5" />Get More Voices…</MenuItem>
      </>)}
    </Popover>
  );
};

/** Effect presets as a chat-bar button (quick choice); the full panel lives in the inspector. */
export const EffectsButton: React.FC<{ value: Partial<Effects>; onChange: (fx: Effects) => void; onMore: () => void }> = ({ value, onChange, onMore }) => {
  const p = presetOf(value);
  const label = effectsNeutral(value) ? 'Effects' : p ? EFFECT_PRESETS.find((x) => x.id === p)!.label : 'Custom Effects';
  return (
    <Popover up className="w-[220px]" trigger={(o, t) => <ModeButton on={!effectsNeutral(value) || o} onClick={t} icon={<Sparkles className="w-4 h-4" />} label={label} title="Effects applied after speaking: presets here, every setting in the inspector" />}>
      {(close) => (<>
        {EFFECT_PRESETS.map((x) => <MenuItem key={x.id} active={p === x.id} onClick={() => { onChange(withEffects(x.fx)); close(); }}>{x.label}</MenuItem>)}
        <div className="my-1 border-t border-[var(--sep)]" />
        <MenuItem onClick={() => { close(); onMore(); }}>Fine-Tune…</MenuItem>
      </>)}
    </Popover>
  );
};

/** Every effect: presets on top, then each setting. `sample` lets you hear changes on a real clip. */
export const EffectsPanel: React.FC<{ value: Partial<Effects>; onChange: (fx: Effects) => void; sample?: string | null }> = ({ value, onChange, sample }) => {
  const fx = withEffects(value);
  const set = (p: Partial<Effects>) => onChange({ ...fx, ...p });
  const p = presetOf(fx);
  const [playing, setPlaying] = useState(false);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);
  const hear = async () => {
    if (playing) { stop.current?.(); return; }
    if (!sample) return;
    setPlaying(true);
    stop.current = previewEffects(await loadMedia(sample), fx, () => { setPlaying(false); stop.current = null; });
  };
  const db = (v: number) => `${v > 0 ? '+' : ''}${v} dB`;
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-3" role="group" aria-label="Effect presets">
        {EFFECT_PRESETS.map((x) => (
          <button key={x.id} type="button" aria-pressed={p === x.id} onClick={() => onChange(withEffects(x.fx))}
            className={cx('h-7 px-2.5 rounded-full text-[12px] inline-flex items-center gap-1', p === x.id ? 'is-selected font-medium' : 'bg-[var(--hover)] hover:bg-[var(--pressed)]')}>{p === x.id && <Check className="w-3 h-3" aria-hidden="true" />}{x.label}</button>
        ))}
      </div>
      <details className="group">
        <summary className="cursor-default text-[12px] font-semibold text-[var(--color-text-muted)] mb-2 list-none flex items-center gap-1"><ChevronDown className="w-3 h-3 -rotate-90 group-open:rotate-0 transition-transform" />Fine-Tune</summary>
        <SliderField label="Volume" value={fx.volume} min={-12} max={12} step={1} onChange={(v) => set({ volume: v })} format={db} />
        <SliderField label="Warmth (bass)" value={fx.bass} min={-12} max={12} step={1} onChange={(v) => set({ bass: v })} format={db} />
        <SliderField label="Clarity (treble)" value={fx.treble} min={-12} max={12} step={1} onChange={(v) => set({ treble: v })} format={db} />
        <SliderField label="Pitch" value={fx.pitch} min={-6} max={6} step={1} onChange={(v) => set({ pitch: v })} format={(v) => `${v > 0 ? '+' : ''}${v} st`} hint="Like a tape: higher is also a little faster." />
        <SliderField label="Room" value={fx.room} min={0} max={1} step={0.05} onChange={(v) => set({ room: v })} format={(v) => `${Math.round(v * 100)}%`} />
        <SliderField label="Echo" value={fx.echo} min={0} max={1} step={0.05} onChange={(v) => set({ echo: v })} format={(v) => `${Math.round(v * 100)}%`} />
        <SliderField label="Robot" value={fx.robot} min={0} max={1} step={0.05} onChange={(v) => set({ robot: v })} format={(v) => `${Math.round(v * 100)}%`} />
        <SliderField label="Fade in" value={fx.fadeIn} min={0} max={3} step={0.1} onChange={(v) => set({ fadeIn: v })} format={(v) => `${v.toFixed(1)} s`} />
        <SliderField label="Fade out" value={fx.fadeOut} min={0} max={3} step={0.1} onChange={(v) => set({ fadeOut: v })} format={(v) => `${v.toFixed(1)} s`} />
        <div className="mb-3"><p className="text-[12px] mb-1">Sound like</p>
          <Segmented label="Sound like" value={fx.band} onChange={(v) => set({ band: v })} options={[{ id: 'off', label: 'Normal' }, { id: 'phone', label: 'Phone' }, { id: 'radio', label: 'Radio' }]} /></div>
        <Checkbox checked={fx.normalize} onChange={(v) => set({ normalize: v })} label="Even out loudness" />
      </details>
      <div className="mt-3 flex gap-2">
        {sample && <Btn size="sm" icon={playing ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />} onClick={() => void hear()}>{playing ? 'Stop' : 'Hear on Last Clip'}</Btn>}
        {!effectsNeutral(fx) && <Btn size="sm" variant="ghost" onClick={() => onChange({ ...NO_EFFECTS })}>Reset</Btn>}
      </div>
    </div>
  );
};
