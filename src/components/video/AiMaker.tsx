// The Video plugin's makers as presets in the editor (0.22; was the whole Video page in 0.21). A short
// form (which footage, what it should say, the voice, the length) becomes a Work job that runs the video
// tools: watch the video, write the script, pick the voice, record it and put it together. The footage
// comes from this project, and the finished video can be brought back into it from the footage list.
//
// "Film it with AI" makes new footage with the open Wan models (slow: minutes per second of video on
// an 8 GB card). The size of Wan is picked from the graphics card's memory (src/models/videoModels.ts);
// without a card that can, it isn't offered and Lotus uses pictures that move.

import React, { useMemo, useState } from 'react';
import { ArrowLeft, Check, Download, Sparkles } from 'lucide-react';
import type { Work } from '../../work/store';
import type { LotusSettings } from '../../types/lotus';
import { agentAvailable } from '../../lib/agent';
import { installEngine, installModel, jobFor, useBuiltins } from '../../lib/builtins';
import { LIBRARY, entryById } from '../../models/library';
import { aboutTime, pickVideoModel, planVideo, VIDEO_FAMILIES, videoFamilyFor } from '../../models/videoModels';
import { useStudio } from '../../voice/useStudio';
import { videoRequest, type VideoShape } from '../../work/videoBrief';
import { copyFiles } from '../../video/editorApi';
import type { Media } from '../../video/project';
import type { Preset } from '../../video/presets';
import { Banner, Btn, Label, Select, TextArea, cx } from '../common/ui';

/** One readiness line: done, or what to do about it. */
export const Need: React.FC<{ ok: boolean; title: string; detail: string; optional?: boolean; action?: React.ReactNode }> = ({ ok, title, detail, optional, action }) => (
  <li className="flex items-center gap-2.5 py-1.5">
    <span className={cx('w-4 h-4 rounded-full inline-flex items-center justify-center shrink-0', ok ? 'bg-[var(--color-accent-vibrant)] text-white' : 'shadow-[inset_0_0_0_1.5px_var(--sep)]')} aria-hidden="true">{ok && <Check className="w-2.5 h-2.5" />}</span>
    <span className="flex-1 min-w-0"><span className="text-[12px] font-medium">{title}{optional && !ok ? <span className="font-normal text-[var(--color-text-muted)]"> · optional</span> : null}</span>
      <span className="block text-[11px] text-[var(--color-text-muted)] leading-snug">{detail}</span></span>
    {!ok && action}
  </li>
);

const PLACEHOLDER: Record<string, string> = {
  narrate: 'What should the voiceover say? e.g. "Explain each exercise for my patients, calm and friendly"',
  pictures: 'What is the video about? e.g. "Our new clinic, for the opening day post"',
  idea: 'What is it about? e.g. "Three stretches for back pain after work"',
  film: 'What should it show? e.g. "A calm morning stretch routine by a window"',
};

export const AiMaker: React.FC<{
  preset: Preset; projectId: string; media: Media[]; work: Work; settings: LotusSettings; shape: VideoShape;
  onBack: () => void; onOpenWork: () => void; onOpenModels: () => void;
}> = ({ preset, projectId, media, work, settings, shape: shape0, onBack, onOpenWork, onOpenModels }) => {
  const b = useBuiltins();
  const studio = useStudio();
  const ai = preset.ai!;
  const mode = ai === 'film' ? 'idea' : ai;
  const fits = useMemo(() => media.filter((m) => (mode === 'narrate' ? m.kind === 'video' : mode === 'pictures' ? m.kind === 'picture' : false)), [media, mode]);
  const [picked, setPicked] = useState<string[]>(() => (mode === 'narrate' ? fits.slice(0, 1) : fits).map((m) => m.file));
  const [brief, setBrief] = useState('');
  const [voice, setVoice] = useState('auto');
  const [seconds, setSeconds] = useState(30);
  const [original, setOriginal] = useState<'lower' | 'mute' | 'keep'>('lower');
  const [shape, setShape] = useState<VideoShape>(shape0 === '9:16' || shape0 === '1:1' ? shape0 : '16:9');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ffmpegOk = b.engines.some((e) => e.id === 'ffmpeg' && (e.installed || !!e.note));
  const voices = studio.options.filter((o) => o.ready);
  const sdOk = b.engines.some((e) => e.id === 'sd' && e.installed);
  const imageOk = sdOk || settings.imageEngine === 'comfyui';
  const best = b.machine ? videoFamilyFor(b.machine) : null;
  const videoModels = b.models.flatMap((m) => { const v = m.entryId ? entryById(m.entryId)?.video : undefined; return v ? [{ id: m.id, title: m.title, family: v.family }] : []; });
  const usable = b.machine ? pickVideoModel(videoModels, b.machine) : null;
  const suggested = best ? LIBRARY.find((e) => e.video?.family === best) : undefined;
  const videoJob = suggested ? jobFor(b, `model:${suggested.id}`) : undefined;
  const footage = ai === 'film' ? 'ai' : 'stills';
  const aiReady = !!usable && sdOk;
  const plan = b.machine && (usable || best) ? planVideo((usable?.family ?? best)!, b.machine, { seconds, aspect: shape }) : null;
  const getVideoModel = async () => {
    if (!suggested) return;
    try { if (!sdOk && !jobFor(b, 'engine:sd')) await installEngine('sd'); await installModel(suggested.id); } catch (e) { setError((e as Error).message); }
  };

  const needFiles = mode !== 'idea' && !picked.length;
  const blocked = !agentAvailable() || !ffmpegOk || !voices.length || (ai === 'idea' && !imageOk) || (ai === 'film' && !aiReady);
  const make = async () => {
    if (busy || blocked || needFiles) return;
    setBusy(true); setError(null);
    try {
      const id = work.newWork();
      const names = picked.length ? await copyFiles(projectId, id, picked) : [];
      const v = voice === 'auto' ? null : voices.find((o) => o.id === voice) ?? null;
      const text = videoRequest({ mode, files: names, brief, voice: v ? { id: v.id, name: v.name } : null, shape, seconds, original, footage });
      void work.send(text, id).catch((e) => setError((e as Error).message));
      onOpenWork();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text-main)]"><ArrowLeft className="w-3.5 h-3.5" />All presets</button>
      <div>
        <h3 className="text-[14px] font-semibold">{preset.title}</h3>
        <p className="text-[12px] text-[var(--color-text-muted)] leading-snug mt-0.5">{preset.detail} It runs in Work, where you can watch each step and ask for changes.</p>
      </div>
      <ul className="divide-y divide-[var(--sep)]" aria-label="What Lotus needs">
        <Need ok={ffmpegOk} title="FFmpeg" detail={ffmpegOk ? 'Cuts and joins the video' : 'A one-time download of about 165 MB.'} action={<Btn size="sm" variant="primary" icon={<Download className="w-3 h-3" />} onClick={() => void installEngine('ffmpeg')}>Install</Btn>} />
        <Need ok={voices.length > 0} title="A voice" detail={voices.length ? `${voices.length} voice${voices.length === 1 ? '' : 's'} ready` : 'Get Kokoro or add your own voice.'} action={<Btn size="sm" onClick={onOpenModels}>Get one</Btn>} />
        {ai === 'idea' && <Need ok={imageOk} title="Pictures" detail={imageOk ? 'Lotus makes a picture for each line' : 'Needs an image model.'} action={<Btn size="sm" onClick={onOpenModels}>Get one</Btn>} />}
        {ai === 'film' && <Need ok={aiReady} title="AI footage" detail={aiReady && usable ? `${usable.title} films on this card` : videoJob?.state === 'running' ? `${videoJob.step}…` : suggested ? `${suggested.title}, picked for this graphics card (${suggested.diskGb} GB).` : 'This computer’s graphics card can’t film AI footage. Try “Video from an idea”.'}
          action={videoJob?.state === 'running' || !suggested ? null : <Btn size="sm" variant="primary" icon={<Download className="w-3 h-3" />} onClick={() => void getVideoModel()}>Get</Btn>} />}
      </ul>

      {mode !== 'idea' && (
        <div>
          <Label>{mode === 'narrate' ? 'Which video' : 'Which pictures, in order'}</Label>
          {fits.length ? (
            <ul className="space-y-1 max-h-[160px] overflow-y-auto">
              {fits.map((m) => {
                const on = picked.includes(m.file);
                return (
                  <li key={m.file}>
                    <button type="button" aria-pressed={on} onClick={() => setPicked((l) => (mode === 'narrate' ? [m.file] : on ? l.filter((x) => x !== m.file) : [...l, m.file]))}
                      className={cx('w-full flex items-center gap-2 p-1 rounded-[7px] text-left text-[12px]', on ? 'bg-[var(--color-accent-pastel)]' : 'hover:bg-[var(--hover)]')}>
                      {m.thumb ? <img src={m.thumb} alt="" className="w-10 h-6 object-cover rounded-[4px]" /> : <span className="w-10 h-6 rounded-[4px] bg-[var(--hover)]" />}
                      <span className="flex-1 truncate">{m.file}</span>{on && <Check className="w-3.5 h-3.5 text-[var(--color-accent-vibrant)]" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : <p className="text-[12px] text-[var(--color-text-muted)]">Add {mode === 'narrate' ? 'a video' : 'pictures'} to Footage on the left first.</p>}
        </div>
      )}

      <div>
        <Label>{mode === 'narrate' ? 'What should the voiceover say?' : 'What is it about?'}</Label>
        <TextArea rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={PLACEHOLDER[ai]} aria-label="What the video is about" />
      </div>
      <div>
        <Label>Voice</Label>
        <Select value={voice} onChange={(e) => setVoice(e.target.value)} aria-label="Voice">
          <option value="auto">Let Lotus choose the best voice</option>
          {voices.map((o) => <option key={o.id} value={o.id}>{o.name}{o.mine ? ' (yours)' : ''}</option>)}
        </Select>
      </div>
      {mode === 'narrate' ? (
        <div>
          <Label>The video’s own sound</Label>
          <Select value={original} onChange={(e) => setOriginal(e.target.value as typeof original)} aria-label="The video’s own sound">
            <option value="lower">Lower it under the voice</option><option value="mute">Mute it</option><option value="keep">Keep it as it is</option>
          </Select>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <div><Label>Length</Label>
            <Select value={String(seconds)} onChange={(e) => setSeconds(Number(e.target.value))} aria-label="Length">{[15, 30, 45, 60].map((s) => <option key={s} value={s}>About {s} s</option>)}</Select></div>
          <div><Label>Shape</Label>
            <Select value={shape} onChange={(e) => setShape(e.target.value as VideoShape)} aria-label="Shape"><option value="16:9">Wide 16:9</option><option value="9:16">Tall 9:16</option><option value="1:1">Square 1:1</option></Select></div>
        </div>
      )}
      {ai === 'film' && plan && <p className="text-[11px] text-[var(--color-text-muted)] leading-snug">Slow but safe: {aboutTime(plan.minutes)} for {seconds} seconds on this card ({VIDEO_FAMILIES[(usable?.family ?? best)!].label}). You can stop it any time in Work.</p>}
      {error && <Banner tone="warn">{error}</Banner>}
      <Btn variant="primary" className="w-full" icon={<Sparkles className="w-3.5 h-3.5" />} loading={busy} disabled={blocked || needFiles} onClick={() => void make()}>Make it in Work</Btn>
      <p className="text-[11px] text-[var(--color-text-muted)] leading-snug">{blocked ? 'Get what Lotus needs above first.' : needFiles ? 'Pick the footage first.' : 'When it’s done, bring the video back here from “Made in Work” under Footage to keep editing.'}</p>
    </div>
  );
};
