// Video (0.21): make narrated videos with AI, on this computer. A short form (your video, your
// pictures, or just an idea; what it should say; the voice; the shape) becomes a Work job that runs
// the video tools: watch the video, write the script, pick the voice, record it and put it together.
// The job's progress and the finished video are in Work; the videos made so far are listed here.
//
// Footage: pictures move with slow pans, zooms and crossfades (quick), or, when the graphics card can,
// new footage is filmed by AI with the open Wan models (slow: minutes per second of video on an 8 GB
// card). The size of Wan is picked from the card's memory (src/models/videoModels.ts); without a
// card that can, the choice isn't offered and Lotus uses pictures.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Clapperboard, Download, Film, Image as ImageIcon, Lightbulb, Plus, Sparkles, X } from 'lucide-react';
import type { Work } from '../../work/store';
import type { LotusSettings } from '../../types/lotus';
import { useFileIntake } from '../../lib/fileDrop';
import { attachWithDialog } from '../../lib/pickFiles';
import { agentAvailable, uploadToWork, workArtifacts, type ArtifactInfo } from '../../lib/agent';
import { installEngine, installModel, jobFor, useBuiltins } from '../../lib/builtins';
import { LIBRARY, entryById } from '../../models/library';
import { aboutTime, pickVideoModel, planVideo, VIDEO_FAMILIES, videoFamilyFor, videoFit } from '../../models/videoModels';
import { useStudio } from '../../voice/useStudio';
import { videoRequest, type VideoMode, type VideoShape } from '../../work/videoBrief';
import { Banner, Btn, Label, Segmented, Select, TextArea, cx } from '../common/ui';
import { MediaArtifact } from './WorkWorkspace';

const MODES: { id: VideoMode; label: string; icon: React.ReactNode; hint: string; placeholder: string }[] = [
  { id: 'narrate', label: 'Narrate my video', icon: <Film className="w-4 h-4" />, hint: 'Lotus watches your video, writes a voiceover that fits what happens, and adds it.', placeholder: 'What should the voiceover say? e.g. "Explain each exercise for my patients, calm and friendly"' },
  { id: 'pictures', label: 'From my pictures', icon: <ImageIcon className="w-4 h-4" />, hint: 'Your pictures become moving scenes with a voiceover that tells the story.', placeholder: 'What is the video about? e.g. "Our new clinic, for the opening day post"' },
  { id: 'idea', label: 'From an idea', icon: <Lightbulb className="w-4 h-4" />, hint: 'Lotus writes the script, makes a picture for each line, records the voice and puts it together.', placeholder: 'What is it about? e.g. "Three stretches for back pain after work"' },
];
const VIDEO_RE = /\.(mp4|mov|mkv|webm|avi|m4v)$/i;
const PICTURE_RE = /\.(png|jpe?g|webp|bmp)$/i;

/** One readiness line: done, or what to do about it. */
const Need: React.FC<{ ok: boolean; title: string; detail: string; optional?: boolean; action?: React.ReactNode }> = ({ ok, title, detail, optional, action }) => (
  <li className="flex items-center gap-3 py-2">
    <span className={cx('w-5 h-5 rounded-full inline-flex items-center justify-center shrink-0', ok ? 'bg-[var(--color-accent-vibrant)] text-white' : 'shadow-[inset_0_0_0_1.5px_var(--sep)]')} aria-hidden="true">{ok && <Check className="w-3 h-3" />}</span>
    <span className="flex-1 min-w-0"><span className="text-[13px] font-medium">{title}{optional && !ok ? <span className="font-normal text-[var(--color-text-muted)]"> · optional</span> : null}</span>
      <span className="block text-[12px] text-[var(--color-text-muted)] leading-snug">{detail}</span></span>
    {!ok && action}
  </li>
);

export const VideoWorkspace: React.FC<{ work: Work; settings: LotusSettings; onOpenWork: () => void; onOpenModels: () => void }> = ({ work, settings, onOpenWork, onOpenModels }) => {
  const b = useBuiltins();
  const studio = useStudio();
  const [mode, setMode] = useState<VideoMode>('narrate');
  const [files, setFiles] = useState<File[]>([]);
  const [brief, setBrief] = useState('');
  const [voice, setVoice] = useState('auto');
  const [shape, setShape] = useState<VideoShape>('16:9');
  const [seconds, setSeconds] = useState(30);
  const [original, setOriginal] = useState<'lower' | 'mute' | 'keep'>('lower');
  const [footagePick, setFootage] = useState<'stills' | 'ai'>('stills');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const ffmpeg = b.engines.find((e) => e.id === 'ffmpeg');
  const ffmpegOk = !!ffmpeg && (ffmpeg.installed || !!ffmpeg.note);
  const ffmpegJob = jobFor(b, 'engine:ffmpeg');
  const sherpaOk = b.engines.some((e) => e.id === 'sherpa' && e.installed);
  const voices = studio.options.filter((o) => o.ready);
  const hears = sherpaOk && b.models.some((m) => m.kind === 'dictation');
  const chat = b.models.find((m) => m.id === settings.selectedModel);
  const sees = settings.llmBackend === 'builtin' ? !!chat?.mmproj : null;
  const sdOk = b.engines.some((e) => e.id === 'sd' && e.installed);
  const imageOk = sdOk || settings.imageEngine === 'comfyui';
  // AI footage: the Wan size for this card, the one installed that fits, and whether it can start from a picture.
  const best = b.machine ? videoFamilyFor(b.machine) : null;
  const videoModels = b.models.flatMap((m) => { const v = m.entryId ? entryById(m.entryId)?.video : undefined; return v ? [{ id: m.id, title: m.title, family: v.family }] : []; });
  const usable = b.machine ? pickVideoModel(videoModels, b.machine) : null;
  const suggested = best ? LIBRARY.find((e) => e.video?.family === best) : undefined;
  const videoJob = suggested ? jobFor(b, `model:${suggested.id}`) : undefined;
  const aiFromPictures = !!(usable ? VIDEO_FAMILIES[usable.family].fromPicture : best && VIDEO_FAMILIES[best].fromPicture);
  const aiPossible = !!best && (mode === 'idea' || (mode === 'pictures' && aiFromPictures));
  const footage = aiPossible ? footagePick : 'stills';
  const aiReady = footage === 'ai' && !!usable && sdOk;
  const plan = usable && b.machine ? planVideo(usable.family, b.machine, { seconds, aspect: shape }) : best && b.machine ? planVideo(best, b.machine, { seconds, aspect: shape }) : null;
  const getVideoModel = async () => {
    if (!suggested) return;
    try { if (!sdOk && !jobFor(b, 'engine:sd')) await installEngine('sd'); await installModel(suggested.id); } catch (e) { setError((e as Error).message); }
  };

  const accept = (list: File[]) => {
    const want = mode === 'narrate' ? VIDEO_RE : mode === 'pictures' ? PICTURE_RE : null;
    if (!want) { setError('An idea needs no files: Lotus makes the pictures. Pick "Narrate my video" or "From my pictures" to use your own.'); return; }
    const ok = list.filter((f) => want.test(f.name));
    if (ok.length < list.length) setError(mode === 'narrate' ? 'Only video files (MP4, MOV, MKV, WebM) can be narrated.' : 'Only pictures (PNG, JPG, WebP) can be scenes.');
    else setError(null);
    setFiles((cur) => (mode === 'narrate' ? ok.slice(0, 1) : [...cur, ...ok].slice(0, 30)));
  };
  const dragging = useFileIntake(accept, { enabled: mode !== 'idea', paste: false });
  useEffect(() => { setFiles([]); setError(null); }, [mode]);

  const needFiles = mode !== 'idea' && !files.length;
  const blocked = !agentAvailable() || !ffmpegOk || !voices.length || (mode === 'idea' && footage === 'stills' && !imageOk) || (footage === 'ai' && !aiReady);
  const make = async () => {
    if (busy || blocked || needFiles) return;
    setBusy(true); setError(null);
    try {
      const id = work.newWork();
      const names: string[] = [];
      for (const f of files) names.push(await uploadToWork(id, f));
      const v = voice === 'auto' ? null : voices.find((o) => o.id === voice) ?? null;
      const text = videoRequest({ mode, files: names, brief, voice: v ? { id: v.id, name: v.name } : null, shape, seconds, original, footage });
      void work.send(text, id).catch((e) => setError((e as Error).message));
      onOpenWork();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const cur = MODES.find((m) => m.id === mode)!;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[var(--color-bg-panel)]">
      <div className="max-w-[760px] mx-auto px-6 py-8 space-y-6">
        <header>
          <h1 className="text-[22px] font-semibold flex items-center gap-2"><Clapperboard className="w-5 h-5 text-[var(--color-accent-vibrant)]" aria-hidden="true" />Video</h1>
          <p className="text-[13px] text-[var(--color-text-muted)] mt-1 leading-snug">Turn your video, your pictures or an idea into a narrated video. Lotus writes the script, picks the voice, records it and puts it all together, on this computer.</p>
        </header>

        <section className="rounded-[12px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)] p-4" aria-label="What Lotus needs">
          <h2 className="text-[13px] font-semibold mb-1">What Lotus needs</h2>
          <ul className="divide-y divide-[var(--sep)]">
            <Need ok={ffmpegOk} title="FFmpeg" detail={ffmpegOk ? (ffmpeg?.installed ? `${ffmpeg.version} · cuts and joins the video` : 'Using the FFmpeg already on this computer') : ffmpegJob?.state === 'running' ? `${ffmpegJob.step}…` : ffmpegJob?.state === 'error' ? ffmpegJob.error ?? 'The download failed.' : 'Cuts, joins and encodes the video. A one-time download of about 165 MB.'}
              action={ffmpegJob?.state === 'running' ? null : <Btn size="sm" variant="primary" icon={<Download className="w-3 h-3" />} onClick={() => void installEngine('ffmpeg')}>Install</Btn>} />
            <Need ok={voices.length > 0} title="A voice" detail={voices.length ? `${voices.length} voice${voices.length === 1 ? '' : 's'} ready${voices.some((v) => v.mine) ? ', including your own from Voice' : ''}` : 'Lotus needs its voice engine and at least one voice, such as Kokoro.'}
              action={<Btn size="sm" onClick={onOpenModels}>Get one</Btn>} />
            <Need ok={hears} optional title="Hearing" detail={hears ? 'Whisper writes down what is said in your videos' : 'A dictation model (Whisper) lets Lotus understand what is said in your videos.'} action={<Btn size="sm" onClick={onOpenModels}>Get Whisper</Btn>} />
            <Need ok={sees !== false} optional title="Seeing" detail={sees ? 'Your chat model can look at the video' : sees === null ? 'Lotus looks at your video when the chat model reads images (for example Gemma 3 or Qwen 2.5 VL).' : 'Your chat model can’t see pictures, so Lotus works from what is said. Gemma 3 4B or Qwen 2.5 VL 7B read images and fit 8 GB.'}
              action={<Btn size="sm" onClick={onOpenModels}>Models</Btn>} />
            {footage === 'ai' && <Need ok={aiReady} title="AI footage" detail={aiReady && usable ? `${usable.title} films new footage on this card` : videoJob?.state === 'running' ? `${videoJob.step}…` : videoJob?.state === 'error' ? videoJob.error ?? 'The download failed.' : suggested ? `${suggested.title}, picked for this graphics card. A one-time download of about ${suggested.diskGb} GB.` : 'This computer can’t film AI footage.'}
              action={videoJob?.state === 'running' || !suggested ? null : <Btn size="sm" variant="primary" icon={<Download className="w-3 h-3" />} onClick={() => void getVideoModel()}>Download</Btn>} />}
            {mode === 'idea' && footage === 'stills' && <Need ok={imageOk} title="Pictures" detail={imageOk ? 'Lotus makes a picture for each line of the script' : 'Making a video from an idea needs an image model.'} action={<Btn size="sm" onClick={onOpenModels}>Get one</Btn>} />}
          </ul>
        </section>

        <section className="space-y-4" aria-label="New video">
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Start from">
            {MODES.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} onClick={() => setMode(m.id)}
                className={cx('p-3 rounded-[10px] text-left shadow-[0_0_0_0.5px_var(--sep)] bg-[var(--color-bg-card)]', mode === m.id ? 'shadow-[0_0_0_2px_var(--color-accent-vibrant)]' : 'hover:bg-[var(--hover)]')}>
                <span className="flex items-center gap-2 text-[13px] font-semibold"><span className="text-[var(--color-accent-vibrant)]">{m.icon}</span>{m.label}</span>
              </button>
            ))}
          </div>
          <p className="text-[12px] text-[var(--color-text-muted)] -mt-2">{footage === 'ai' ? (mode === 'idea' ? 'Lotus writes the script, films a short AI clip for each line, records the voice and puts it together.' : 'Lotus brings each picture to life with AI, records the voiceover and puts it together.') : cur.hint}</p>

          {mode !== 'idea' && (
            <div className={cx('rounded-[12px] border border-dashed p-4 text-center', dragging ? 'border-[var(--color-accent-vibrant)] bg-[var(--color-accent-pastel)]' : 'border-[var(--sep)]')}>
              {files.length ? (
                <ul className="flex flex-wrap gap-1.5 justify-center mb-2">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="inline-flex items-center gap-1.5 h-7 pl-2 pr-1 rounded-[8px] bg-[var(--hover)] text-[12px] max-w-[260px]">
                      {mode === 'narrate' ? <Film className="w-3.5 h-3.5 shrink-0" /> : <ImageIcon className="w-3.5 h-3.5 shrink-0" />}
                      <span className="truncate">{f.name}</span><span className="text-[var(--color-text-muted)]">{(f.size / 1e6).toFixed(1)} MB</span>
                      <button type="button" aria-label={`Remove ${f.name}`} className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-[var(--pressed)]" onClick={() => setFiles((l) => l.filter((_, k) => k !== i))}><X className="w-3 h-3" /></button>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-[13px] text-[var(--color-text-muted)] mb-2">{mode === 'narrate' ? 'Drop your video here (any size)' : 'Drop your pictures here, in the order you want them'}</p>}
              <Btn size="sm" icon={<Plus className="w-3 h-3" />} onClick={() => void attachWithDialog(accept, () => input.current?.click(), setError, { imagesOnly: mode === 'pictures' })}>{mode === 'narrate' ? (files.length ? 'Choose another video' : 'Choose a video') : 'Add pictures'}</Btn>
              <input ref={input} type="file" hidden multiple={mode === 'pictures'} accept={mode === 'narrate' ? 'video/*' : 'image/*'} onChange={(e) => { accept(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
            </div>
          )}

          <div>
            <Label>{mode === 'narrate' ? 'What should the voiceover say?' : 'What is it about?'}</Label>
            <TextArea rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={cur.placeholder} aria-label="What the video is about" />
          </div>

          <div className="grid grid-cols-2 gap-3">
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
                  <option value="lower">Lower it under the voice</option>
                  <option value="mute">Mute it</option>
                  <option value="keep">Keep it as it is</option>
                </Select>
              </div>
            ) : (
              <div>
                <Label>Length</Label>
                <Select value={String(seconds)} onChange={(e) => setSeconds(Number(e.target.value))} aria-label="Length">
                  {[15, 30, 45, 60].map((s) => <option key={s} value={s}>About {s} seconds</option>)}
                </Select>
              </div>
            )}
          </div>
          {mode !== 'narrate' && (
            <div className="space-y-1.5">
              {aiPossible && (
                <div className="flex items-center gap-3">
                  <span className="text-[13px] font-medium">Footage</span>
                  <Segmented<'stills' | 'ai'> label="Footage" value={footage} onChange={setFootage} options={[{ id: 'stills', label: mode === 'pictures' ? 'My pictures, moving gently' : 'Pictures, moving gently' }, { id: 'ai', label: mode === 'pictures' ? 'Bring them to life with AI' : 'Filmed by AI' }]} />
                </div>
              )}
              <p className="text-[12px] text-[var(--color-text-muted)] leading-snug">{footage === 'ai' && plan
                ? `New moving footage, made on this computer. It is slow but safe: about ${aboutTime(plan.minutes).replace('about ', '')} for ${seconds} seconds on this card, and you can stop it any time in Work. If the card runs short of memory, Lotus makes smaller clips instead of crashing.`
                : !best && b.machine ? `${(videoFit('wan21-1.3b', b.machine) as { why?: string }).why ?? ''} Pictures move with slow pans, zooms and crossfades instead.`
                : mode === 'pictures' && !aiFromPictures ? 'Bringing pictures to life needs a 12 GB graphics card. This one can film from words: pick “From an idea”.'
                : aiPossible ? `Quick: pictures move with slow pans, zooms and crossfades. “${mode === 'pictures' ? 'Bring them to life with AI' : 'Filmed by AI'}” makes real moving footage, but takes minutes per second of video.` : 'Pictures move with slow pans, zooms and crossfades.'}</p>
            </div>
          )}
          {mode !== 'narrate' && (
            <div className="flex items-center gap-3">
              <span className="text-[13px] font-medium">Shape</span>
              <Segmented<VideoShape> label="Shape" value={shape} onChange={setShape} options={[{ id: '16:9', label: 'Wide 16:9' }, { id: '9:16', label: 'Phone 9:16' }, { id: '1:1', label: 'Square 1:1' }]} />
            </div>
          )}

          {error && <Banner tone="warn">{error}</Banner>}
          <div className="flex items-center gap-3">
            <Btn variant="primary" icon={<Sparkles className="w-3.5 h-3.5" />} loading={busy} disabled={blocked || needFiles} onClick={() => void make()}>Make video</Btn>
            <span className="text-[12px] text-[var(--color-text-muted)] leading-snug">{blocked ? 'Get what Lotus needs above first.' : needFiles ? (mode === 'narrate' ? 'Choose a video first.' : 'Add your pictures first.') : 'Opens in Work, where you can watch each step and ask for changes.'}</span>
          </div>
        </section>

        <MadeVideos work={work} onOpenWork={onOpenWork} />
      </div>
    </div>
  );
};

/** Videos the Work jobs made, newest first. */
const MadeVideos: React.FC<{ work: Work; onOpenWork: () => void }> = ({ work, onOpenWork }) => {
  const [found, setFound] = useState<{ workId: string; workTitle: string; a: ArtifactInfo }[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const ids = useMemo(() => work.items.filter((w) => w.messages.length).slice(0, 40).map((w) => `${w.id}\u0000${w.title}`).join('\u0001'), [work.items]);
  useEffect(() => {
    if (!agentAvailable()) return;
    let live = true;
    void Promise.all(ids.split('\u0001').filter(Boolean).map(async (x) => {
      const [workId, workTitle] = x.split('\u0000');
      const list = await workArtifacts(workId).catch(() => [] as ArtifactInfo[]);
      return list.filter((a) => a.kind === 'video').map((a) => ({ workId, workTitle, a }));
    })).then((r) => { if (live) setFound(r.flat().sort((p, q) => q.a.updated - p.a.updated)); });
    return () => { live = false; };
  }, [ids, work.runningIds.length]);
  if (!found.length) return null;
  return (
    <section aria-label="Your videos">
      <h2 className="text-[13px] font-semibold mb-2">Your videos</h2>
      <ul className="space-y-2">
        {found.map(({ workId, workTitle, a }) => {
          const key = `${workId}/${a.file}`;
          return (
            <li key={key} className="rounded-[12px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)] overflow-hidden">
              <div className="flex items-center gap-2.5 p-2.5">
                <span className="w-8 h-8 rounded-[7px] bg-[var(--color-accent-pastel)] text-[var(--color-accent-vibrant)] inline-flex items-center justify-center shrink-0"><Clapperboard className="w-4 h-4" /></span>
                <span className="flex-1 min-w-0"><span className="block text-[13px] font-medium truncate">{a.title}</span>
                  <span className="block text-[12px] text-[var(--color-text-muted)] truncate">{workTitle} · {new Date(a.updated).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span></span>
                <Btn size="sm" variant="ghost" onClick={() => setOpen(open === key ? null : key)}>{open === key ? 'Hide' : 'Play'}</Btn>
                <Btn size="sm" onClick={() => { work.setActiveId(workId); onOpenWork(); }}>Open in Work</Btn>
              </div>
              {open === key && <div className="h-[360px] flex flex-col border-t border-[var(--sep)]"><MediaArtifact workId={workId} a={a} nonce={0} /></div>}
            </li>
          );
        })}
      </ul>
    </section>
  );
};
