// The Video page (0.22): a video editor. Footage on the left, the preview and the timeline in the
// middle, and the tools on the right: presets (one-click recipes and the Video plugin's AI makers),
// trimming, captions, Shorts, auto edit, voiceover and music, and export.
//
// Everything mechanical (reading footage, captions from speech, finding Short moments, the first cut,
// the export) is done by the core itself (core/src/video/editService.ts) with FFmpeg and Whisper, so
// it works the same on every computer and doesn't depend on a chat model. The AI makers hand a job to
// Work, like the 0.21 page did. Each project keeps its files in Lotus Studio/Work/<project id>.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines, Captions, Clapperboard, Download, Film, Image as ImageIcon, Loader2, Mic, Plus, Scissors, Sparkles, Square, Upload, Wand2, X,
} from 'lucide-react';
import type { Work } from '../../work/store';
import type { LotusSettings } from '../../types/lotus';
import { agentAvailable, workArtifacts, type ArtifactInfo } from '../../lib/agent';
import { installEngine, jobFor, useBuiltins } from '../../lib/builtins';
import { useFileIntake } from '../../lib/fileDrop';
import { usePersisted, uid } from '../../lib/persist';
import { useStudio } from '../../voice/useStudio';
import { offerUndo } from '../common/Alerts';
import { addFile, copyFiles, getProject, listMedia, putProject, runJob, type JobEvent } from '../../video/editorApi';
import {
  PROJECTS_KEY, addClip, addExports, clock, fromEdit, loadProject, newProject, removeClip, splitAt, totalSeconds, upsertRef, type Cue, type Media, type Project, type ProjectRef,
} from '../../video/project';
import { applyLook, type Preset } from '../../video/presets';
import { Banner, Btn, Empty, IconBtn, Select, cx } from '../common/ui';
import { Preview } from './Preview';
import { Timeline } from './Timeline';
import { AiMaker } from './AiMaker';
import { AutoPanel, CaptionsPanel, EditPanel, ExportPanel, PresetsPanel, ShortsPanel, VoicePanel, type Ed } from './Panels';

type Tab = 'presets' | 'edit' | 'captions' | 'shorts' | 'auto' | 'voice' | 'export';
const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'presets', label: 'Presets', icon: <Sparkles className="w-3.5 h-3.5" /> },
  { id: 'edit', label: 'Edit', icon: <Scissors className="w-3.5 h-3.5" /> },
  { id: 'captions', label: 'Captions', icon: <Captions className="w-3.5 h-3.5" /> },
  { id: 'shorts', label: 'Shorts', icon: <Film className="w-3.5 h-3.5" /> },
  { id: 'auto', label: 'Auto edit', icon: <Wand2 className="w-3.5 h-3.5" /> },
  { id: 'voice', label: 'Voice', icon: <Mic className="w-3.5 h-3.5" /> },
  { id: 'export', label: 'Export', icon: <Download className="w-3.5 h-3.5" /> },
];
const ACCEPT = 'video/*,image/*,audio/*,.mkv,.mov,.m4a,.flac,.opus';
const MEDIA_RE = /\.(mp4|mov|mkv|webm|avi|m4v|gif|png|jpe?g|webp|bmp|wav|mp3|m4a|ogg|flac|opus|aac)$/i;

const isMedia = (m: Media | { file: string; error: string }): m is Media => !('error' in m);

interface Busy { label: string; detail?: string; fraction?: number; ctrl: AbortController }

export const VideoEditor: React.FC<{ work: Work; settings: LotusSettings; onOpenWork: () => void; onOpenModels: () => void }> = ({ work, settings, onOpenWork, onOpenModels }) => {
  const b = useBuiltins();
  const studio = useStudio();
  const [refs, setRefs] = usePersisted<ProjectRef[]>(PROJECTS_KEY, []);
  const [currentId, setCurrentId] = usePersisted<string | null>('lotus.video.current.v1', null);
  const [project, setProjectRaw] = useState<Project | null>(null);
  const [media, setMedia] = useState<Media[]>([]);
  const [adding, setAdding] = useState<string[]>([]);
  const [preparing, setPreparing] = useState<string | null>(null);
  const [proxyNonce, setProxyNonce] = useState(0);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = usePersisted<Tab>('lotus.video.tab.v1', 'presets');
  const [ai, setAi] = useState<Preset | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const live = agentAvailable();
  const projectId = project?.id ?? null;

  const ffmpeg = b.engines.find((e) => e.id === 'ffmpeg');
  const ffmpegOk = !!ffmpeg && (ffmpeg.installed || !!ffmpeg.note);
  const ffmpegJob = jobFor(b, 'engine:ffmpeg');
  const hears = b.engines.some((e) => e.id === 'sherpa' && e.installed) && b.models.some((m) => m.kind === 'dictation');
  const voices = useMemo(() => studio.options.filter((o) => o.ready).map((o) => ({ id: o.id, name: o.name, mine: o.mine })), [studio.options]);

  // ── The project: open, create, save ──────────────────────────────────────
  const open = useCallback(async (id: string) => {
    setPlaying(false); setT(0); setSelected(null); setAi(null); setError(null);
    const raw = await getProject(id).catch(() => null);
    const ref = refs.find((r) => r.id === id);
    const p = loadProject(raw, id);
    if (!raw && ref) p.title = ref.title;
    setProjectRaw(p);
    setCurrentId(id);
    const list = await listMedia(id).catch((e) => { setError((e as Error).message); return []; });
    setMedia(list.filter(isMedia) as Media[]);
  }, [refs, setCurrentId]);

  const create = useCallback(async (title = `Video ${new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })}`) => {
    const id = uid('video');
    const p = newProject(id, title);
    setRefs((l) => upsertRef(l, { id, title, updated: Date.now() }));
    await putProject(id, p).catch(() => undefined);
    setProjectRaw(p); setMedia([]); setCurrentId(id); setT(0); setSelected(null); setAi(null);
    return id;
  }, [setRefs, setCurrentId]);

  useEffect(() => {
    if (!live || project) return;
    if (currentId) void open(currentId); else if (refs.length) void open(refs[0].id); else void create();
  }, [live]); // eslint-disable-line react-hooks/exhaustive-deps

  // Saved a moment after the last change.
  useEffect(() => {
    if (!project) return;
    const h = setTimeout(() => {
      void putProject(project.id, project).catch((e) => setError((e as Error).message));
      setRefs((l) => upsertRef(l, { id: project.id, title: project.title, updated: Date.now() }));
    }, 600);
    return () => clearTimeout(h);
  }, [project]); // eslint-disable-line react-hooks/exhaustive-deps

  const setProject = useCallback((fn: (p: Project) => Project, undo?: string) => {
    setProjectRaw((cur) => {
      if (!cur) return cur;
      const next = { ...fn(cur), updated: Date.now() };
      if (undo) offerUndo(undo, () => setProjectRaw(cur), () => undefined);
      return next;
    });
  }, []);

  // ── Footage ──────────────────────────────────────────────────────────────
  const prepare = useCallback(async (pid: string, list: Media[]) => {
    const vids = list.filter((m) => m.kind === 'video' && !m.proxy).map((m) => m.file);
    if (!vids.length) return;
    try {
      await runJob(pid, 'proxy', { files: vids }, (e: JobEvent) => setPreparing(e.state === 'running' ? (e.detail ?? 'Making preview copies') : null));
      setMedia((l) => l.map((m) => (vids.includes(m.file) ? { ...m, proxy: true } : m)));
      setProxyNonce((n) => n + 1);
    } catch { /* the preview falls back to the original file */ } finally { setPreparing(null); }
  }, []);
  useEffect(() => { if (projectId && media.some((m) => m.kind === 'video' && !m.proxy) && !preparing) void prepare(projectId, media); }, [projectId, media.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const addFiles = useCallback(async (list: File[]) => {
    if (!projectId) return;
    const ok = list.filter((f) => MEDIA_RE.test(f.name));
    if (ok.length < list.length) setError('Only videos, pictures and sound files can be added.');
    else setError(null);
    const names: string[] = [];
    for (const f of ok) {
      setAdding((a) => [...a, f.name]);
      try { names.push(await addFile(projectId, f)); } catch (e) { setError((e as Error).message); } finally { setAdding((a) => a.filter((x) => x !== f.name)); }
    }
    if (!names.length) return;
    const got = (await listMedia(projectId, names).catch(() => [])).filter(isMedia) as Media[];
    setMedia((cur) => [...cur.filter((m) => !names.includes(m.file)), ...got]);
    // A first file goes straight onto an empty timeline, so the preview shows something at once.
    setProject((p) => (p.clips.length ? p : got.filter((m) => m.kind !== 'audio').reduce((q, m) => addClip(q, m), p)));
  }, [projectId, setProject]);
  const dragging = useFileIntake((f) => void addFiles(f), { enabled: live && !!projectId, paste: false });

  const bringIn = async (fromId: string, file: string) => {
    if (!projectId) return;
    try {
      const [name] = await copyFiles(fromId, projectId, [file]);
      if (!name) return;
      const got = (await listMedia(projectId, [name])).filter(isMedia) as Media[];
      setMedia((cur) => [...cur.filter((m) => m.file !== name), ...got]);
    } catch (e) { setError((e as Error).message); }
  };

  // ── Jobs ─────────────────────────────────────────────────────────────────
  const run = useCallback(async <T,>(op: string, args: Record<string, unknown>, label: string): Promise<T | null> => {
    if (!projectId) return null;
    const ctrl = new AbortController();
    setBusy({ label, ctrl }); setError(null);
    try {
      return await runJob<T>(projectId, op, args, (e) => setBusy((cur) => (cur ? { ...cur, detail: e.detail, fraction: e.fraction } : cur)), ctrl.signal);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
      return null;
    } finally { setBusy(null); }
  }, [projectId]);

  const writeCaptions = useCallback(async () => {
    if (!project) return;
    const withSound = media.filter((m) => m.hasAudio && m.kind === 'video').map((m) => m.file);
    const r = await run<{ cues: Cue[] }>('captions', { clips: project.clips, withSound: hears ? withSound : [], voiceover: project.voice?.file }, 'Writing captions');
    if (r) { setProject((p) => ({ ...p, cues: r.cues }), 'Captions written'); if (!r.cues.length) setError('No speech was heard in these clips.'); }
  }, [project, media, hears, run, setProject]);

  const recipe = async (preset: Preset) => {
    if (!project) return;
    setProject((p) => applyLook(p, preset), `${preset.title} look applied`);
    for (const step of preset.steps ?? []) {
      if (step === 'shorts') { setTab('shorts'); return; }
      if (step === 'tighten' || step === 'highlights') {
        const footage = (project.clips.length ? [...new Set(project.clips.map((c) => c.file))] : media.filter((m) => m.kind !== 'audio').map((m) => m.file));
        if (!footage.length) { setError('Add some footage first, then pick the preset again.'); return; }
        const r = await run<{ clips: { file: string; from: number; to: number }[] }>('autoedit', { files: footage, mode: step, seconds: preset.seconds ?? 0 }, step === 'tighten' ? 'Cutting out the pauses' : 'Picking the best bits');
        if (!r) return;
        if (r.clips.length) setProject((p) => fromEdit(p, r.clips));
      }
      if (step === 'captions') {
        if (!hears) { setTab('captions'); return; }
        // Captions are written from the timeline as it is after the steps above.
        await new Promise((res) => setTimeout(res, 50));
        setTab('captions');
        await writeCaptionsRef.current?.();
      }
    }
  };
  const writeCaptionsRef = useRef(writeCaptions);
  writeCaptionsRef.current = writeCaptions;

  // ── Playback and keys ────────────────────────────────────────────────────
  const total = project ? totalSeconds(project) : 0;
  const togglePlay = useCallback(() => { if (!project?.clips.length) return; setPlaying((p) => { if (!p && t >= total - 0.05) setT(0); return !p; }); }, [project, t, total]);
  const split = useCallback(() => setProject((p) => splitAt(p, t), 'Clip split'), [t, setProject]);
  const remove = useCallback(() => { if (selected) { setProject((p) => removeClip(p, selected), 'Clip removed'); setSelected(null); } }, [selected, setProject]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"]') || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      else if (e.key === 's' || e.key === 'S') split();
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) remove();
      else if (e.key === 'ArrowLeft') setT((x) => Math.max(0, x - (e.shiftKey ? 1 : 1 / 30)));
      else if (e.key === 'ArrowRight') setT((x) => Math.min(total, x + (e.shiftKey ? 1 : 1 / 30)));
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [togglePlay, split, remove, selected, total]);
  useEffect(() => { if (t > total) setT(total); }, [total]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!live) return <div className="flex-1 flex items-center justify-center bg-[var(--color-bg-panel)]"><Empty icon={<Clapperboard className="w-6 h-6" />} title="Video editing runs in the Lotus app" body="Open Lotus on your computer to edit videos: it uses FFmpeg and your graphics card." /></div>;
  if (!project) return <div className="flex-1 flex items-center justify-center bg-[var(--color-bg-panel)] text-[13px] text-[var(--color-text-muted)]"><Loader2 className="w-4 h-4 animate-spin mr-2" />Opening your project…</div>;

  const ed: Ed = {
    projectId: project.id, project, media, t, selected, settings, set: setProject, run, busy: busy?.label ?? null, hears, voices,
    seek: (x) => { setPlaying(false); setT(x); }, select: setSelected, openModels: onOpenModels,
  };
  const made = (files: string[]) => { setProject((p) => addExports(p, files)); setTab('export'); };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[var(--color-bg-panel)]">
      <header className="flex items-center gap-2 px-4 h-12 border-b border-[var(--sep)] shrink-0">
        <Clapperboard className="w-4.5 h-4.5 text-[var(--color-accent-vibrant)]" aria-hidden="true" />
        <h1 className="text-[15px] font-semibold">Video</h1>
        <span className="text-[var(--color-text-muted)]">/</span>
        <input value={project.title} onChange={(e) => setProject((p) => ({ ...p, title: e.target.value.slice(0, 80) }))} aria-label="Project name"
          className="text-[13px] font-medium bg-transparent rounded-[6px] px-1.5 h-7 min-w-0 w-[220px] hover:bg-[var(--hover)] focus:bg-[var(--color-bg-card)] outline-none focus-visible:outline-[2px] focus-visible:outline-[var(--ring)]" />
        {refs.length > 1 && (
          <span className="w-[170px] shrink-0">
            <Select value="" onChange={(e) => { if (e.target.value) void open(e.target.value); }} aria-label="Open another project">
              <option value="">Other projects…</option>
              {refs.filter((r) => r.id !== project.id).map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </Select>
          </span>
        )}
        <Btn size="sm" icon={<Plus className="w-3 h-3" />} onClick={() => void create()}>New project</Btn>
        <span className="flex-1" />
        {busy ? (
          <div className="flex items-center gap-2 min-w-0 max-w-[420px]" role="status" aria-live="polite">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--color-accent-vibrant)] shrink-0" />
            <span className="text-[12px] truncate"><span className="font-medium">{busy.label}</span>{busy.detail && busy.detail !== 'Starting' ? <span className="text-[var(--color-text-muted)]"> · {busy.detail}</span> : null}</span>
            {typeof busy.fraction === 'number' && <span className="w-20 h-1.5 rounded-full bg-[var(--hover)] overflow-hidden shrink-0"><span className="block h-full bg-[var(--color-accent-fill)]" style={{ width: `${Math.round(busy.fraction * 100)}%` }} /></span>}
            <Btn size="sm" icon={<Square className="w-3 h-3" />} onClick={() => busy.ctrl.abort()}>Stop</Btn>
          </div>
        ) : preparing ? <span className="text-[12px] text-[var(--color-text-muted)] flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" />{preparing}</span> : null}
        <Btn size="sm" variant="primary" icon={<Download className="w-3 h-3" />} disabled={!!busy} onClick={() => setTab('export')}>Export</Btn>
      </header>
      {!ffmpegOk && (
        <Banner tone="warn" className="mx-4 mt-3" action={ffmpegJob?.state === 'running' ? <span className="text-[12px]">{ffmpegJob.step}…</span> : <Btn size="sm" variant="primary" icon={<Download className="w-3 h-3" />} onClick={() => void installEngine('ffmpeg')}>Install FFmpeg</Btn>}>
          The video editor needs FFmpeg, a free video tool (a one-time download of about 165 MB).
        </Banner>
      )}
      {error && <Banner tone="warn" className="mx-4 mt-3" action={<IconBtn label="Dismiss" onClick={() => setError(null)}><X className="w-3.5 h-3.5" /></IconBtn>}>{error}</Banner>}

      <div className="flex-1 min-h-0 flex">
        {/* Footage */}
        <aside className={cx('w-[236px] shrink-0 border-r border-[var(--sep)] flex flex-col min-h-0', dragging && 'bg-[var(--color-accent-pastel)]')} aria-label="Footage">
          <div className="flex items-center gap-1 px-3 h-10 shrink-0">
            <h2 className="text-[13px] font-semibold flex-1">Footage</h2>
            <Btn size="sm" icon={<Upload className="w-3 h-3" />} onClick={() => input.current?.click()} disabled={!ffmpegOk}>Add</Btn>
            <input ref={input} type="file" hidden multiple accept={ACCEPT} onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-1">
            {!media.length && !adding.length && (
              <button type="button" onClick={() => input.current?.click()} className="w-full rounded-[10px] border border-dashed border-[var(--sep)] p-4 text-center text-[12px] text-[var(--color-text-muted)] hover:bg-[var(--hover)]">
                <Upload className="w-4 h-4 mx-auto mb-1.5" />Drop videos, pictures and music here, or click to choose. Any size.
              </button>
            )}
            {adding.map((n) => <div key={n} className="flex items-center gap-2 p-1.5 text-[12px] text-[var(--color-text-muted)]"><Loader2 className="w-3.5 h-3.5 animate-spin" /><span className="truncate">Adding {n}…</span></div>)}
            {media.filter((m) => !project.exports.includes(m.file)).map((m) => (
              <div key={m.file} draggable={m.kind !== 'audio'} onDragStart={(e) => { e.dataTransfer.setData('application/x-lotus-media', m.file); e.dataTransfer.effectAllowed = 'copy'; }}
                className="group flex items-center gap-2 p-1 rounded-[8px] hover:bg-[var(--hover)]" title={m.kind === 'audio' ? 'Use it as music in Voice' : 'Drag onto the timeline, or press +'}>
                <span className="w-14 h-9 rounded-[5px] overflow-hidden bg-[var(--hover)] shrink-0 inline-flex items-center justify-center text-[var(--color-text-muted)]">
                  {m.thumb ? <img src={m.thumb} alt="" className="w-full h-full object-cover" /> : m.kind === 'audio' ? <AudioLines className="w-4 h-4" /> : <ImageIcon className="w-4 h-4" />}
                </span>
                <span className="flex-1 min-w-0"><span className="block text-[12px] truncate">{m.file}</span>
                  <span className="block text-[11px] text-[var(--color-text-muted)]">{m.kind === 'picture' ? 'Picture' : `${m.kind === 'audio' ? 'Sound · ' : ''}${clock(m.duration)}`}{m.kind === 'video' && !m.hasAudio ? ' · no sound' : ''}</span></span>
                {m.kind === 'audio'
                  ? <IconBtn label={`Use ${m.file} as music`} onClick={() => setProject((p) => ({ ...p, music: m.file }), 'Music added')} active={project.music === m.file}><AudioLines className="w-3.5 h-3.5" /></IconBtn>
                  : <IconBtn label={`Add ${m.file} to the timeline`} onClick={() => setProject((p) => addClip(p, m))}><Plus className="w-3.5 h-3.5" /></IconBtn>}
              </div>
            ))}
            <FromWork work={work} onBring={bringIn} onOpenWork={onOpenWork} />
          </div>
        </aside>

        {/* Preview and timeline */}
        <main className="flex-1 min-w-0 flex flex-col">
          <Preview project={project} media={media} projectId={project.id} t={t} playing={playing} proxyNonce={proxyNonce} onTime={setT} onStop={() => setPlaying(false)} />
          <Timeline project={project} media={media} t={t} playing={playing} selected={selected}
            onSeek={(x) => { setPlaying(false); setT(x); }} onPlay={togglePlay} onSelect={(id) => { setSelected(id); if (id && tab !== 'edit' && tab !== 'captions') setTab('edit'); }}
            onChange={(p) => setProject(() => p)} onSplit={split} onRemove={remove}
            onDropFile={(file, at) => { const m = media.find((x) => x.file === file); if (m) setProject((p) => addClip(p, m, at)); }} />
        </main>

        {/* Tools */}
        <aside className="w-[340px] shrink-0 border-l border-[var(--sep)] flex flex-col min-h-0" aria-label="Tools">
          <div role="tablist" aria-label="Tools" className="grid grid-cols-4 gap-1 p-2 border-b border-[var(--sep)] shrink-0">
            {TABS.map((x) => (
              <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} onClick={() => { setTab(x.id); if (x.id !== 'presets') setAi(null); }}
                className={cx('h-[44px] rounded-[7px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium', tab === x.id ? 'bg-[var(--color-accent-pastel)] text-[var(--color-accent-vibrant)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--hover)] hover:text-[var(--color-text-main)]')}>
                {x.icon}{x.label}
              </button>
            ))}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-3">
            {tab === 'presets' && (ai
              ? <AiMaker key={ai.id} preset={ai} projectId={project.id} media={media} work={work} settings={settings} shape={project.aspect === '4:5' ? '1:1' : project.aspect} onBack={() => setAi(null)} onOpenWork={onOpenWork} onOpenModels={onOpenModels} />
              : <PresetsPanel ed={ed} onRecipe={(p) => void recipe(p)} onAi={setAi} />)}
            {tab === 'edit' && <EditPanel ed={ed} />}
            {tab === 'captions' && <CaptionsPanel ed={ed} onWrite={() => void writeCaptions()} />}
            {tab === 'shorts' && <ShortsPanel ed={ed} onMade={made} />}
            {tab === 'auto' && <AutoPanel ed={ed} />}
            {tab === 'voice' && <VoicePanel ed={ed} />}
            {tab === 'export' && <ExportPanel ed={ed} onMade={(f) => setProject((p) => addExports(p, f))} />}
          </div>
        </aside>
      </div>
    </div>
  );
};

/** Videos the Work jobs made (the AI presets), to bring into this project. */
const FromWork: React.FC<{ work: Work; onBring: (workId: string, file: string) => Promise<void>; onOpenWork: () => void }> = ({ work, onBring, onOpenWork }) => {
  const [found, setFound] = useState<{ workId: string; a: ArtifactInfo }[]>([]);
  const [done, setDone] = useState<string[]>([]);
  const ids = useMemo(() => work.items.filter((w) => w.messages.length).slice(0, 30).map((w) => w.id).join(','), [work.items]);
  useEffect(() => {
    let live = true;
    void Promise.all(ids.split(',').filter(Boolean).map(async (workId) => (await workArtifacts(workId).catch(() => [] as ArtifactInfo[])).filter((a) => a.kind === 'video').map((a) => ({ workId, a }))))
      .then((r) => { if (live) setFound(r.flat().sort((p, q) => q.a.updated - p.a.updated).slice(0, 12)); });
    return () => { live = false; };
  }, [ids, work.runningIds.length]);
  if (!found.length) return null;
  return (
    <div className="pt-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)] px-1 mb-1">Made in Work</h3>
      {found.map(({ workId, a }) => {
        const key = `${workId}/${a.file}`;
        return (
          <div key={key} className="flex items-center gap-2 p-1 rounded-[8px] hover:bg-[var(--hover)]">
            <Clapperboard className="w-3.5 h-3.5 text-[var(--color-accent-vibrant)] shrink-0 ml-1" />
            <button type="button" className="flex-1 min-w-0 text-left text-[12px] truncate hover:underline" onClick={() => { work.setActiveId(workId); onOpenWork(); }}>{a.title}</button>
            <Btn size="sm" variant="ghost" disabled={done.includes(key)} onClick={() => void onBring(workId, a.file).then(() => setDone((d) => [...d, key]))}>{done.includes(key) ? 'Added' : 'Bring in'}</Btn>
          </div>
        );
      })}
    </div>
  );
};
