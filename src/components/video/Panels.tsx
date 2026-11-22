// The Video editor's side panels (0.22): presets, the selected clip and the look, captions, Shorts,
// auto edit, voiceover and music, and export. Each one calls the editor's own jobs in the core
// (core/src/video/editService.ts) through `ed.run`.

import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowRight, AudioLines, Check, Clapperboard, Download, FolderOpen, Mic, Play, Plus, Scissors, Sparkles, Trash2, Wand2, X,
} from 'lucide-react';
import type { LotusSettings } from '../../types/lotus';
import { runAgent, workArtifacts, workDir, type ArtifactInfo } from '../../lib/agent';
import { revealPath } from '../../lib/open';
import {
  ASPECTS, CAPTION_LOOKS, addExports, clipSeconds, clipStarts, clock, editCue, exportPlan, fromEdit, notReady, setVolume, splitAt, totalSeconds, trimClip,
  removeClip, moveClip, type Cue, type Media, type Project,
} from '../../video/project';
import { PRESETS, type Preset } from '../../video/presets';
import { Banner, Btn, Checkbox, Label, Select, Slider, TextArea, TextInput, cx } from '../common/ui';
import { MediaArtifact } from '../workspaces/WorkWorkspace';

export interface Ed {
  projectId: string;
  project: Project;
  media: Media[];
  t: number;
  selected: string | null;
  settings: LotusSettings;
  /** Changes the project; `undo` names the change for the Undo bar. */
  set: (fn: (p: Project) => Project, undo?: string) => void;
  /** Runs one of the editor's jobs with progress at the top; null when it failed or was stopped (the editor says why). */
  run: <T>(op: string, args: Record<string, unknown>, label: string) => Promise<T | null>;
  busy: string | null;
  /** Whisper is downloaded (captions from what is said). */
  hears: boolean;
  voices: { id: string; name: string; mine?: boolean }[];
  seek: (t: number) => void;
  select: (id: string | null) => void;
  openModels: () => void;
}

const H = ({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) => (
  <div className="mb-2"><h3 className="text-[14px] font-semibold">{children}</h3>{hint && <p className="text-[12px] text-[var(--color-text-muted)] leading-snug mt-0.5">{hint}</p>}</div>
);
const Section = ({ children, className }: { children: React.ReactNode; className?: string }) => <section className={cx('space-y-2.5', className)}>{children}</section>;
const files = (ed: Ed, kinds: Media['kind'][]) => ed.media.filter((m) => kinds.includes(m.kind));

// ── Presets ────────────────────────────────────────────────────────────────

export const PresetsPanel: React.FC<{ ed: Ed; onRecipe: (p: Preset) => void; onAi: (p: Preset) => void }> = ({ ed, onRecipe, onAi }) => {
  const card = (p: Preset, on: () => void) => (
    <li key={p.id}>
      <button type="button" onClick={on} disabled={!!ed.busy} className="w-full text-left p-2.5 rounded-[9px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)] hover:bg-[var(--hover)] disabled:opacity-50">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold">{p.kind === 'ai' ? <Sparkles className="w-3.5 h-3.5 text-[var(--color-accent-vibrant)]" /> : <Wand2 className="w-3.5 h-3.5 text-[var(--color-accent-vibrant)]" />}{p.title}
          {p.command && <span className="ml-auto text-[10px] font-normal text-[var(--color-text-muted)] font-mono">{p.command}</span>}</span>
        <span className="block text-[12px] text-[var(--color-text-muted)] leading-snug mt-0.5">{p.detail}{p.hears && !ed.hears ? ' Captions need Whisper.' : ''}</span>
      </button>
    </li>
  );
  return (
    <div className="space-y-4">
      <Section>
        <H hint="One click: sets the shape and look, then does the work on your footage. You can change anything after.">Quick presets</H>
        <ul className="space-y-1.5">{PRESETS.filter((p) => p.kind === 'recipe').map((p) => card(p, () => onRecipe(p)))}</ul>
      </Section>
      <Section>
        <H hint="From the Video plugin. The assistant writes the script, picks the voice and makes it in Work.">Made by AI</H>
        <ul className="space-y-1.5">{PRESETS.filter((p) => p.kind === 'ai').map((p) => card(p, () => onAi(p)))}</ul>
      </Section>
    </div>
  );
};

// ── The selected clip and the look ─────────────────────────────────────────

const num = (v: string) => { const n = Number(v.replace(',', '.')); return Number.isFinite(n) ? n : 0; };

export const EditPanel: React.FC<{ ed: Ed }> = ({ ed }) => {
  const { project: p } = ed;
  const i = p.clips.findIndex((c) => c.id === ed.selected);
  const c = i >= 0 ? p.clips[i] : null;
  const m = c ? ed.media.find((x) => x.file === c.file) : undefined;
  return (
    <div className="space-y-5">
      {c ? (
        <Section>
          <H hint={`Clip ${i + 1} of ${p.clips.length} · starts at ${clock(clipStarts(p)[i], true)} on the timeline`}>{c.file}</H>
          {m?.kind === 'picture' ? (
            <div><Label hint={`${clipSeconds(c).toFixed(1)} s`}>How long it shows</Label>
              <Slider value={clipSeconds(c)} min={0.5} max={15} step={0.5} onChange={(v) => ed.set((q) => trimClip(q, c.id, 0, v, m))} label="How long it shows" /></div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Starts at (s)</Label><TextInput type="number" step="0.1" min={0} value={c.from} onChange={(e) => ed.set((q) => trimClip(q, c.id, num(e.target.value), c.to, m))} aria-label="Starts at" /></div>
              <div><Label>Ends at (s)</Label><TextInput type="number" step="0.1" min={0} value={c.to} onChange={(e) => ed.set((q) => trimClip(q, c.id, c.from, num(e.target.value), m))} aria-label="Ends at" /></div>
              <p className="col-span-2 text-[11px] text-[var(--color-text-muted)]">{clipSeconds(c).toFixed(1)} s of {m ? clock(m.duration, true) : '?'}. You can also drag the clip’s edges on the timeline.</p>
            </div>
          )}
          {m?.hasAudio && <div><Label hint={`${Math.round(c.volume * 100)}%`}>Its sound</Label><Slider value={c.volume} min={0} max={2} step={0.05} onChange={(v) => ed.set((q) => setVolume(q, c.id, v))} label="Clip volume" /></div>}
          <div className="flex flex-wrap gap-1.5">
            <Btn size="sm" icon={<ArrowLeft className="w-3 h-3" />} disabled={i === 0} onClick={() => ed.set((q) => moveClip(q, c.id, -1))}>Earlier</Btn>
            <Btn size="sm" icon={<ArrowRight className="w-3 h-3" />} disabled={i === p.clips.length - 1} onClick={() => ed.set((q) => moveClip(q, c.id, 1))}>Later</Btn>
            <Btn size="sm" icon={<Scissors className="w-3 h-3" />} onClick={() => ed.set((q) => splitAt(q, ed.t), 'Clip split')}>Split here</Btn>
            <Btn size="sm" variant="danger" icon={<Trash2 className="w-3 h-3" />} onClick={() => { ed.set((q) => removeClip(q, c.id), 'Clip removed'); ed.select(null); }}>Remove</Btn>
          </div>
        </Section>
      ) : <p className="text-[12px] text-[var(--color-text-muted)]">Click a clip on the timeline to trim it, change its sound or move it.</p>}
      <Look ed={ed} />
    </div>
  );
};

/** Shape, how footage fills it, and crossfades: shared by Edit and Export. */
const Look: React.FC<{ ed: Ed }> = ({ ed }) => {
  const p = ed.project;
  return (
    <Section>
      <H>The whole video</H>
      <div><Label>Shape</Label>
        <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Shape">
          {ASPECTS.map((a) => (
            <button key={a.id} type="button" role="radio" aria-checked={p.aspect === a.id} onClick={() => ed.set((q) => ({ ...q, aspect: a.id }))}
              className={cx('p-2 rounded-[8px] text-left bg-[var(--color-bg-card)]', p.aspect === a.id ? 'shadow-[0_0_0_2px_var(--color-accent-vibrant)]' : 'shadow-[0_0_0_0.5px_var(--sep)] hover:bg-[var(--hover)]')}>
              <span className="block text-[12px] font-semibold">{a.label}</span><span className="block text-[11px] text-[var(--color-text-muted)]">{a.hint}</span>
            </button>
          ))}
        </div>
      </div>
      <div><Label>When footage is another shape</Label>
        <Select value={p.fit} onChange={(e) => ed.set((q) => ({ ...q, fit: e.target.value as Project['fit'] }))} aria-label="When footage is another shape">
          <option value="fit">Show all of it (black bars)</option><option value="blur">Show all of it, blurred copy behind</option><option value="fill">Fill the frame (crops the edges)</option>
        </Select></div>
      <div><Label>Between clips</Label>
        <Select value={String(p.fade)} onChange={(e) => ed.set((q) => ({ ...q, fade: Number(e.target.value) }))} aria-label="Between clips">
          <option value="0">Straight cuts</option><option value="0.3">Quick crossfade</option><option value="0.6">Soft crossfade</option><option value="1">Slow crossfade</option>
        </Select></div>
    </Section>
  );
};

// ── Captions ───────────────────────────────────────────────────────────────

export const CaptionsPanel: React.FC<{ ed: Ed; onWrite: () => void }> = ({ ed, onWrite }) => {
  const p = ed.project;
  const now = p.cues.findIndex((c) => ed.t >= c.start && ed.t < c.end);
  const sound = p.clips.some((c) => ed.media.find((m) => m.file === c.file)?.hasAudio);
  return (
    <div className="space-y-4">
      <Section>
        <H hint="Lotus listens to the clips (and your voiceover) and writes what is said, with the right times.">Captions</H>
        {!ed.hears && sound && <Banner tone="info" action={<Btn size="sm" onClick={ed.openModels}>Get Whisper</Btn>}>Writing captions from speech needs a dictation model (Whisper, about 150 MB).</Banner>}
        <Btn variant="primary" className="w-full" icon={<Sparkles className="w-3.5 h-3.5" />} disabled={!!ed.busy || !p.clips.length || (!ed.hears && !p.voice)} onClick={onWrite}>{p.cues.length ? 'Write them again' : 'Write captions from what is said'}</Btn>
        {!p.clips.length && <p className="text-[11px] text-[var(--color-text-muted)]">Add clips to the timeline first.</p>}
      </Section>
      <Section>
        <Label>Look</Label>
        <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Caption look">
          {CAPTION_LOOKS.map((l) => (
            <button key={l.id} type="button" role="radio" aria-checked={p.captionStyle === l.id} title={l.hint} onClick={() => ed.set((q) => ({ ...q, captionStyle: l.id }))}
              className={cx('h-12 rounded-[8px] bg-[#1d1d22] flex items-center justify-center', p.captionStyle === l.id ? 'shadow-[0_0_0_2px_var(--color-accent-vibrant)]' : 'shadow-[0_0_0_0.5px_var(--sep)]')}>
              <span className={cx('text-[13px] font-[Arial,sans-serif]', l.id === 'clean' && 'text-white', l.id === 'bold' && 'text-[#FFE500] font-extrabold', l.id === 'boxed' && 'text-white bg-black/70 px-1.5 rounded-[2px]', l.id === 'big' && 'text-white font-extrabold uppercase text-[15px]')}
                style={{ textShadow: l.id === 'boxed' ? undefined : '0 0 2px #000, 1px 1px 0 #000' }}>{l.label}</span>
            </button>
          ))}
        </div>
        <Checkbox checked={p.burn} onChange={(v) => ed.set((q) => ({ ...q, burn: v }))} label="Draw them onto the video (best for social media)" />
      </Section>
      <Section>
        <div className="flex items-center justify-between"><Label className="mb-0">{p.cues.length} caption{p.cues.length === 1 ? '' : 's'}</Label>
          <Btn size="sm" variant="ghost" icon={<Plus className="w-3 h-3" />} onClick={() => ed.set((q) => ({ ...q, cues: editCue([...q.cues, { start: ed.t, end: ed.t + 2, text: 'New caption' }], -1, {}) }))}>Add at playhead</Btn></div>
        <ul className="space-y-1.5 max-h-[340px] overflow-y-auto pr-1" aria-label="Captions">
          {p.cues.map((c, i) => (
            <li key={`${i}-${c.start}`} className={cx('rounded-[8px] p-1.5 shadow-[0_0_0_0.5px_var(--sep)]', i === now ? 'bg-[var(--color-accent-pastel)]' : 'bg-[var(--color-bg-card)]')}>
              <div className="flex items-center gap-1 text-[11px] text-[var(--color-text-muted)] tabular-nums">
                <button type="button" className="hover:underline" onClick={() => ed.seek(c.start)}>{clock(c.start, true)} – {clock(c.end, true)}</button>
                <span className="flex-1" />
                <button type="button" aria-label="Remove caption" className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-[var(--hover)]" onClick={() => ed.set((q) => ({ ...q, cues: q.cues.filter((_, k) => k !== i) }), 'Caption removed')}><X className="w-3 h-3" /></button>
              </div>
              <input value={c.text} onChange={(e) => ed.set((q) => ({ ...q, cues: q.cues.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)) }))} aria-label={`Caption ${i + 1}`}
                className="w-full bg-transparent text-[12px] outline-none focus-visible:outline-[2px] focus-visible:outline-[var(--ring)] rounded px-0.5" />
            </li>
          ))}
        </ul>
        {p.cues.length > 0 && <Btn size="sm" variant="danger" icon={<Trash2 className="w-3 h-3" />} onClick={() => ed.set((q) => ({ ...q, cues: [] }), 'Captions cleared')}>Clear all</Btn>}
      </Section>
    </div>
  );
};

// ── Shorts ─────────────────────────────────────────────────────────────────

interface Moment { start: number; end: number; score: number; text: string }

export const ShortsPanel: React.FC<{ ed: Ed; onMade: (files: string[]) => void }> = ({ ed, onMade }) => {
  const videos = files(ed, ['video']);
  const longest = useMemo(() => [...videos].sort((a, b) => b.duration - a.duration)[0]?.file ?? '', [videos]);
  const [file, setFile] = useState(longest);
  const [count, setCount] = useState(3);
  const [secs, setSecs] = useState(30);
  const [found, setFound] = useState<Moment[] | null>(null);
  const [pick, setPick] = useState<number[]>([]);
  useEffect(() => { if (!file || !videos.some((v) => v.file === file)) setFile(longest); }, [longest]); // eslint-disable-line react-hooks/exhaustive-deps
  const find = async () => {
    const r = await ed.run<{ moments: Moment[] }>('shorts.find', { file, count, seconds: secs }, 'Finding the best moments');
    if (r) { setFound(r.moments); setPick(r.moments.map((_, i) => i)); }
  };
  const make = async () => {
    if (!found) return;
    const moments = pick.map((i) => found[i]).map((m, k) => ({ ...m, title: `short-${k + 1}-${file.replace(/\.[^.]+$/, '')}` }));
    const r = await ed.run<{ files: { file: string }[] }>('shorts.make', { file, moments, style: ed.project.captionStyle === 'clean' ? 'bold' : ed.project.captionStyle, fit: ed.project.fit === 'fit' ? 'blur' : ed.project.fit }, `Making ${moments.length} Short${moments.length === 1 ? '' : 's'}`);
    if (r) onMade(r.files.map((f) => f.file));
  };
  return (
    <div className="space-y-4">
      <Section>
        <H hint="Lotus finds the best moments of a long video (where people talk, where things happen) and makes each one a tall 9:16 Short with captions.">Shorts from a long video</H>
        {!videos.length ? <p className="text-[12px] text-[var(--color-text-muted)]">Add a video to Footage first.</p> : (
          <>
            <div><Label>Video</Label><Select value={file} onChange={(e) => { setFile(e.target.value); setFound(null); }} aria-label="Video for Shorts">{videos.map((v) => <option key={v.file} value={v.file}>{v.file} · {clock(v.duration)}</option>)}</Select></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>How many</Label><Select value={String(count)} onChange={(e) => setCount(Number(e.target.value))} aria-label="How many Shorts">{[1, 2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}</Select></div>
              <div><Label>Length</Label><Select value={String(secs)} onChange={(e) => setSecs(Number(e.target.value))} aria-label="Length of each Short">{[15, 30, 45, 60].map((n) => <option key={n} value={n}>About {n} s</option>)}</Select></div>
            </div>
            {!ed.hears && <p className="text-[11px] text-[var(--color-text-muted)]">Without Whisper, Lotus picks moments from the sound and scenes, and the Shorts have no captions.</p>}
            <Btn className="w-full" icon={<Sparkles className="w-3.5 h-3.5" />} disabled={!!ed.busy || !file} onClick={() => void find()}>Find the best moments</Btn>
          </>
        )}
      </Section>
      {found && (
        <Section>
          <Label>{found.length} moment{found.length === 1 ? '' : 's'}: tick the ones to make</Label>
          <ul className="space-y-1.5">
            {found.map((m, i) => {
              const on = pick.includes(i);
              return (
                <li key={i} className={cx('rounded-[8px] p-2 shadow-[0_0_0_0.5px_var(--sep)]', on ? 'bg-[var(--color-accent-pastel)]' : 'bg-[var(--color-bg-card)]')}>
                  <div className="flex items-center gap-2">
                    <button type="button" role="checkbox" aria-checked={on} aria-label={`Moment ${i + 1}`} onClick={() => setPick((l) => (on ? l.filter((x) => x !== i) : [...l, i].sort()))}
                      className={cx('w-4 h-4 rounded-[4px] inline-flex items-center justify-center shrink-0', on ? 'bg-[var(--color-accent-fill)] text-white' : 'shadow-[inset_0_0_0_1.5px_var(--sep)]')}>{on && <Check className="w-3 h-3" />}</button>
                    <span className="text-[12px] font-medium tabular-nums">{clock(m.start)} – {clock(m.end)}</span>
                    <span className="text-[11px] text-[var(--color-text-muted)]">{Math.round(m.end - m.start)} s</span>
                    <span className="flex-1" />
                    <Btn size="sm" variant="ghost" icon={<Plus className="w-3 h-3" />} onClick={() => ed.set((q) => ({ ...q, clips: [...q.clips, { id: `c${Date.now().toString(36)}${i}`, file, from: m.start, to: m.end, volume: 1 }] }), 'Moment added')}>Timeline</Btn>
                  </div>
                  {m.text && <p className="text-[11px] text-[var(--color-text-muted)] mt-1 line-clamp-2">“{m.text}”</p>}
                </li>
              );
            })}
          </ul>
          <Btn variant="primary" className="w-full" icon={<Scissors className="w-3.5 h-3.5" />} disabled={!!ed.busy || !pick.length} onClick={() => void make()}>Make {pick.length} Short{pick.length === 1 ? '' : 's'}</Btn>
          <p className="text-[11px] text-[var(--color-text-muted)]">They appear under Export when they’re ready. Captions use the look from Captions (bold if it’s set to clean).</p>
        </Section>
      )}
    </div>
  );
};

// ── Auto edit ──────────────────────────────────────────────────────────────

export const AutoPanel: React.FC<{ ed: Ed }> = ({ ed }) => {
  const footage = files(ed, ['video', 'picture']);
  const [mode, setMode] = useState<'highlights' | 'tighten'>('highlights');
  const [secs, setSecs] = useState(30);
  const [use, setUse] = useState<string[] | null>(null);
  const chosen = use ?? footage.map((m) => m.file);
  const [note, setNote] = useState<string | null>(null);
  const go = async () => {
    setNote(null);
    const r = await ed.run<{ clips: { file: string; from: number; to: number }[]; saved: number; talking: boolean }>('autoedit', { files: chosen, mode, seconds: mode === 'highlights' ? secs : 0 }, mode === 'tighten' ? 'Cutting out the pauses' : 'Picking the best bits');
    if (!r) return;
    if (!r.clips.length) { setNote('There was nothing to keep in that footage.'); return; }
    ed.set((q) => fromEdit(q, r.clips), 'Timeline replaced by the auto edit');
    ed.select(null); ed.seek(0);
    const len = r.clips.reduce((s, c) => s + c.to - c.from, 0);
    setNote(mode === 'tighten' ? (r.saved > 0.5 ? `Done: ${clock(len)} long, ${clock(r.saved)} of pauses taken out.` : 'Done. There were hardly any pauses to take out.') : `Done: ${r.clips.length} pieces, ${clock(len)} long.`);
  };
  return (
    <div className="space-y-4">
      <Section>
        <H hint="Lotus makes a first cut from your footage on the timeline. Then trim, reorder or add anything you like.">Auto edit</H>
        <div className="grid grid-cols-1 gap-1.5" role="radiogroup" aria-label="Kind of edit">
          {([['highlights', 'Highlight reel', 'The best few seconds of each shot (where someone talks or the sound is lively), in order.'], ['tighten', 'Cut out the pauses', 'Keeps everything that is said and takes out the silences. For talking videos.']] as const).map(([id, label, hint]) => (
            <button key={id} type="button" role="radio" aria-checked={mode === id} onClick={() => setMode(id)} className={cx('p-2.5 rounded-[9px] text-left bg-[var(--color-bg-card)]', mode === id ? 'shadow-[0_0_0_2px_var(--color-accent-vibrant)]' : 'shadow-[0_0_0_0.5px_var(--sep)] hover:bg-[var(--hover)]')}>
              <span className="block text-[13px] font-semibold">{label}</span><span className="block text-[12px] text-[var(--color-text-muted)] leading-snug">{hint}</span>
            </button>
          ))}
        </div>
        {mode === 'highlights' && <div><Label>About how long</Label><Select value={String(secs)} onChange={(e) => setSecs(Number(e.target.value))} aria-label="Reel length">{[15, 30, 45, 60, 90].map((n) => <option key={n} value={n}>{n} seconds</option>)}</Select></div>}
      </Section>
      <Section>
        <Label>Footage to use ({chosen.length} of {footage.length})</Label>
        {!footage.length ? <p className="text-[12px] text-[var(--color-text-muted)]">Add videos or pictures to Footage first.</p> : (
          <ul className="space-y-1 max-h-[220px] overflow-y-auto">
            {footage.map((m) => {
              const on = chosen.includes(m.file);
              return (
                <li key={m.file}>
                  <button type="button" aria-pressed={on} onClick={() => setUse(on ? chosen.filter((x) => x !== m.file) : footage.map((f) => f.file).filter((f) => f === m.file || chosen.includes(f)))}
                    className={cx('w-full flex items-center gap-2 p-1 rounded-[7px] text-left text-[12px]', on ? 'bg-[var(--color-accent-pastel)]' : 'hover:bg-[var(--hover)] opacity-60')}>
                    {m.thumb ? <img src={m.thumb} alt="" className="w-10 h-6 object-cover rounded-[4px]" /> : <span className="w-10 h-6 rounded-[4px] bg-[var(--hover)]" />}
                    <span className="flex-1 truncate">{m.file}</span><span className="text-[11px] text-[var(--color-text-muted)]">{m.kind === 'picture' ? 'picture' : clock(m.duration)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <Btn variant="primary" className="w-full" icon={<Wand2 className="w-3.5 h-3.5" />} disabled={!!ed.busy || !chosen.length} onClick={() => void go()}>Make the first cut</Btn>
        <p className="text-[11px] text-[var(--color-text-muted)]">This replaces what is on the timeline. Press Undo right after if you want it back.</p>
        {note && <Banner tone="info">{note}</Banner>}
      </Section>
    </div>
  );
};

// ── Voiceover and music ────────────────────────────────────────────────────

export const VoicePanel: React.FC<{ ed: Ed }> = ({ ed }) => {
  const p = ed.project;
  const [voice, setVoice] = useState(ed.voices.find((v) => v.id === p.voice?.voice)?.id ?? '');
  const [timed, setTimed] = useState(false);
  const [writing, setWriting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const lines = p.script.split('\n').map((l) => l.trim()).filter(Boolean);
  const total = totalSeconds(p);
  const words = lines.join(' ').split(/\s+/).filter(Boolean).length;
  const record = async () => {
    const starts = timed ? clipStarts(p).slice(0, lines.length).map((s) => s + 0.3) : undefined;
    const r = await ed.run<{ file: string; seconds: number; voice: string; lines: Cue[] }>('voiceover', { voice: voice || undefined, lines, starts }, 'Recording the voiceover');
    if (!r) return;
    ed.set((q) => ({ ...q, voice: { file: r.file, seconds: r.seconds, voice: r.voice, lines: r.lines }, cues: q.cues.length ? q.cues : r.lines.map((l) => ({ start: l.start, end: l.end, text: l.text })) }), 'Voiceover added');
  };
  const write = async () => {
    if (!ed.settings.selectedModel) { setErr('Pick a chat model first (in Chat), then try again.'); return; }
    setWriting(true); setErr(null);
    try {
      const clips = p.clips.map((c, i) => `${i + 1}. ${c.file} (${clipSeconds(c).toFixed(0)} s)`).join('\n');
      const prompt = `Write a voiceover script for a ${Math.max(10, Math.round(total || 30))}-second video${p.script.trim() ? ` about: ${p.script.trim()}` : ''}.\n${clips ? `The clips, in order:\n${clips}\n` : ''}About 2.5 words per second, one short sentence per line, a hook first and a clear last line. Reply with only the lines, one per line, no numbers, no stage directions.`;
      const done = await runAgent({ model: ed.settings.selectedModel, messages: [{ role: 'user', content: prompt }], prompt }, () => undefined);
      const text = done.content.split('\n').map((l) => l.replace(/^\s*(\d+[.)]|[-*•])\s*/, '').replace(/^["“]|["”]$/g, '').trim()).filter((l) => l && !/^(here|sure|okay)\b/i.test(l)).join('\n');
      if (text) ed.set((q) => ({ ...q, script: text }), 'Script written');
    } catch (e) { setErr((e as Error).message); } finally { setWriting(false); }
  };
  const sounds = files(ed, ['audio']).filter((m) => m.file !== p.voice?.file && !/^voiceover(-\d+)?\.wav$/.test(m.file));
  return (
    <div className="space-y-4">
      <Section>
        <H hint="Type what should be said, one sentence per line. Lotus speaks it with one of your voices.">Voiceover</H>
        {!ed.voices.length && <Banner tone="info" action={<Btn size="sm" onClick={ed.openModels}>Get a voice</Btn>}>No voice is ready yet. Get Kokoro, or add your own voice in Voice.</Banner>}
        <TextArea rows={6} value={p.script} onChange={(e) => ed.set((q) => ({ ...q, script: e.target.value }))} placeholder={'Mornings at the clinic start quietly.\nThen the first patient walks in.\nWe help you move again.'} aria-label="Voiceover script" />
        <div className="flex items-center justify-between text-[11px] text-[var(--color-text-muted)]">
          <span>{lines.length} line{lines.length === 1 ? '' : 's'} · about {Math.round(words / 2.5)} s{total ? ` of ${Math.round(total)} s` : ''}</span>
          <Btn size="sm" variant="ghost" icon={<Sparkles className="w-3 h-3" />} loading={writing} onClick={() => void write()}>{p.script.trim() ? 'Rewrite with AI' : 'Write it for me'}</Btn>
        </div>
        <div><Label>Voice</Label>
          <Select value={voice} onChange={(e) => setVoice(e.target.value)} aria-label="Voiceover voice">
            <option value="">Your usual voice</option>
            {ed.voices.map((v) => <option key={v.id} value={v.id}>{v.name}{v.mine ? ' (yours)' : ''}</option>)}
          </Select></div>
        <Checkbox checked={timed} onChange={setTimed} label="Start each line with its clip" />
        <Btn variant="primary" className="w-full" icon={<Mic className="w-3.5 h-3.5" />} disabled={!!ed.busy || !lines.length || !ed.voices.length} onClick={() => void record()}>{p.voice ? 'Record it again' : 'Record the voiceover'}</Btn>
        {err && <Banner tone="warn">{err}</Banner>}
        {p.voice && (
          <div className="rounded-[8px] p-2 bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)] space-y-1.5">
            <div className="flex items-center gap-1.5 text-[12px]"><AudioLines className="w-3.5 h-3.5 text-[var(--color-accent-vibrant)]" /><span className="flex-1 truncate">{p.voice.file} · {p.voice.seconds.toFixed(1)} s</span>
              <button type="button" aria-label="Remove the voiceover" className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-[var(--hover)]" onClick={() => ed.set((q) => ({ ...q, voice: undefined }), 'Voiceover removed')}><X className="w-3 h-3" /></button></div>
            <Label hint={`${Math.round(p.voiceVolume * 100)}%`}>Voice volume</Label>
            <Slider value={p.voiceVolume} min={0} max={2} step={0.05} onChange={(v) => ed.set((q) => ({ ...q, voiceVolume: v }))} label="Voice volume" />
            <p className="text-[11px] text-[var(--color-text-muted)]">The clips’ own sound goes quieter under the voice.</p>
          </div>
        )}
      </Section>
      <Section>
        <H hint="Add a song or sound file to Footage, then pick it here. It loops and fades out at the end.">Music</H>
        <Select value={p.music ?? ''} onChange={(e) => ed.set((q) => ({ ...q, music: e.target.value || undefined }))} aria-label="Music">
          <option value="">No music</option>
          {sounds.map((m) => <option key={m.file} value={m.file}>{m.file}</option>)}
        </Select>
        {p.music && <><Label hint={`${Math.round(p.musicVolume * 100)}%`}>Music volume</Label><Slider value={p.musicVolume} min={0} max={1} step={0.01} onChange={(v) => ed.set((q) => ({ ...q, musicVolume: v }))} label="Music volume" /></>}
      </Section>
    </div>
  );
};

// ── Export ─────────────────────────────────────────────────────────────────

export const ExportPanel: React.FC<{ ed: Ed; onMade: (files: string[]) => void }> = ({ ed, onMade }) => {
  const p = ed.project;
  const [name, setName] = useState(p.title);
  const [open, setOpen] = useState<string | null>(p.exports[0] ?? null);
  const [infos, setInfos] = useState<ArtifactInfo[]>([]);
  useEffect(() => setName(p.title), [p.title]);
  useEffect(() => { void workArtifacts(ed.projectId).then(setInfos).catch(() => undefined); }, [ed.projectId, p.exports.join('|')]);
  const why = notReady(p, ed.media);
  const go = async () => {
    const r = await ed.run<{ file: string; seconds: number; captions: string }>('export', { plan: exportPlan(p, name || p.title), media: ed.media }, 'Exporting');
    if (r) { onMade([r.file]); setOpen(r.file); }
  };
  const reveal = async (f: string) => { const d = await workDir(ed.projectId).catch(() => null); if (d) void revealPath(`${d}/${f}`); };
  return (
    <div className="space-y-4">
      <Section>
        <H hint="Makes the finished MP4 on this computer, using your graphics card when it can.">Export</H>
        <div><Label>File name</Label><TextInput value={name} onChange={(e) => setName(e.target.value)} aria-label="File name" /></div>
        <ul className="text-[12px] text-[var(--color-text-muted)] space-y-0.5">
          <li>{p.clips.length} clip{p.clips.length === 1 ? '' : 's'} · {clock(totalSeconds(p))} · {ASPECTS.find((a) => a.id === p.aspect)?.label}</li>
          <li>{p.cues.length ? `${p.cues.length} captions, ${p.burn ? 'drawn on' : 'attached'} (${CAPTION_LOOKS.find((l) => l.id === p.captionStyle)?.label})` : 'No captions'}</li>
          <li>{p.voice ? `Voiceover ${p.voice.file}` : 'No voiceover'}{p.music ? ` · music ${p.music}` : ''}</li>
        </ul>
        {why && <Banner tone="info">{why}</Banner>}
        <Btn variant="primary" className="w-full" icon={<Download className="w-3.5 h-3.5" />} disabled={!!ed.busy || !!why} onClick={() => void go()}>Export video</Btn>
      </Section>
      <Look ed={ed} />
      <Section>
        <H>Made in this project</H>
        {!p.exports.length ? <p className="text-[12px] text-[var(--color-text-muted)]">Exports and Shorts show here.</p> : (
          <ul className="space-y-1.5">
            {p.exports.map((f) => (
              <li key={f} className="rounded-[8px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)] overflow-hidden">
                <div className="flex items-center gap-1.5 p-1.5">
                  <Clapperboard className="w-3.5 h-3.5 text-[var(--color-accent-vibrant)] shrink-0" />
                  <span className="flex-1 truncate text-[12px]">{f}</span>
                  <button type="button" aria-label={`Play ${f}`} className="w-6 h-6 inline-flex items-center justify-center rounded hover:bg-[var(--hover)]" onClick={() => setOpen(open === f ? null : f)}><Play className="w-3 h-3" /></button>
                  <button type="button" aria-label={`Show ${f} in its folder`} className="w-6 h-6 inline-flex items-center justify-center rounded hover:bg-[var(--hover)]" onClick={() => void reveal(f)}><FolderOpen className="w-3 h-3" /></button>
                </div>
                {open === f && <div className="h-[260px] flex flex-col border-t border-[var(--sep)]"><MediaArtifact workId={ed.projectId} a={infos.find((x) => x.file === f) ?? { file: f, title: f, kind: 'video', bytes: 0, updated: 0 }} nonce={0} /></div>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
};

export { addExports };
