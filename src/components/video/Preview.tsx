// The Video editor's preview (0.22): plays the timeline clip by clip from the light 360p copies, with
// the voiceover and music in step and the captions drawn the way the export will draw them (close
// enough to judge; the export itself is made by FFmpeg).

import React, { useEffect, useRef, useState } from 'react';
import { Film, Image as ImageIcon } from 'lucide-react';
import { previewUrl } from '../../video/editorApi';
import { clipAt, clipSeconds, clipStarts, cueAt, totalSeconds, type Media, type Project } from '../../video/project';
import { cx } from '../common/ui';

/** A playable URL for a project file (null while it loads or when it can't). */
export function usePreview(projectId: string, file: string | undefined, nonce = 0): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) { setUrl(null); return; }
    let live = true;
    previewUrl(projectId, file, nonce > 0).then((u) => { if (live) setUrl(u); }).catch(() => { if (live) setUrl(null); });
    return () => { live = false; };
  }, [projectId, file, nonce]);
  return url;
}

export const Preview: React.FC<{
  project: Project; media: Media[]; projectId: string; t: number; playing: boolean; proxyNonce: number;
  onTime: (t: number) => void; onStop: () => void;
}> = ({ project, media, projectId, t, playing, proxyNonce, onTime, onStop }) => {
  const video = useRef<HTMLVideoElement>(null);
  const voice = useRef<HTMLAudioElement>(null);
  const music = useRef<HTMLAudioElement>(null);
  const tRef = useRef(t);
  tRef.current = t;
  const total = totalSeconds(project);
  const hit = clipAt(project, Math.min(t, Math.max(0, total - 0.001)));
  const clip = hit ? project.clips[hit.index] : null;
  const m = clip ? media.find((x) => x.file === clip.file) : undefined;
  const start = hit ? clipStarts(project)[hit.index] : 0;
  const url = usePreview(projectId, clip?.file, proxyNonce);
  const voiceUrl = usePreview(projectId, project.voice?.file);
  const musicUrl = usePreview(projectId, project.music);

  // Keep the video where the timeline says (seeking, or a new clip).
  useEffect(() => {
    const v = video.current;
    if (!v || !clip || m?.kind !== 'video' || !hit) return;
    const want = clip.from + hit.offset;
    if (!playing || Math.abs(v.currentTime - want) > 0.35) { try { v.currentTime = want; } catch { /* not loaded yet */ } }
    v.volume = Math.min(1, clip.volume * (project.voice ? 0.35 : 1));
    if (playing && v.paused) void v.play().catch(() => undefined);
    if (!playing && !v.paused) v.pause();
  }, [clip?.id, url, playing, hit?.offset, m?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // Voiceover and music follow the timeline.
  useEffect(() => {
    for (const [el, vol, loop] of [[voice.current, project.voiceVolume, false], [music.current, project.musicVolume, true]] as const) {
      if (!el || !el.src) continue;
      el.volume = Math.min(1, vol);
      const want = loop && el.duration ? t % el.duration : t;
      if (!loop && el.duration && t >= el.duration) { if (!el.paused) el.pause(); continue; }
      if (!playing || Math.abs(el.currentTime - want) > 0.3) { try { el.currentTime = want; } catch { /* loading */ } }
      if (playing && el.paused) void el.play().catch(() => undefined);
      if (!playing && !el.paused) el.pause();
    }
  }, [playing, t, voiceUrl, musicUrl, project.voiceVolume, project.musicVolume]);

  // The clock while playing: from the video when it's a video clip, else from the wall clock.
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      const p = project;
      const h = clipAt(p, tRef.current);
      if (!h) { onStop(); return; }
      const c = p.clips[h.index];
      const s = clipStarts(p)[h.index];
      const v = video.current;
      const kind = media.find((x) => x.file === c.file)?.kind;
      let nt = kind === 'video' && v && !v.paused && v.readyState >= 2 && Math.abs(v.currentTime - (c.from + h.offset)) < 1 ? s + (v.currentTime - c.from) : tRef.current + dt;
      if (nt >= s + clipSeconds(c) - 0.02) {
        nt = s + clipSeconds(c);
        if (h.index === p.clips.length - 1) { onTime(totalSeconds(p)); onStop(); return; }
        nt += 0.001;
      }
      onTime(nt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, project, media]); // eslint-disable-line react-hooks/exhaustive-deps

  // The frame's size: as big as fits, in the project's shape.
  const area = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const [a, b] = project.aspect.split(':').map(Number);
    const fitIn = () => { const W = el.clientWidth - 24, Hh = el.clientHeight - 24; const w = Math.max(0, Math.min(W, (Hh * a) / b)); setSize({ w, h: (w * b) / a }); };
    const ro = new ResizeObserver(fitIn);
    ro.observe(el); fitIn();
    return () => ro.disconnect();
  }, [project.aspect]);
  const cue = cueAt(project.cues, t);
  const tall = project.aspect === '9:16' || project.aspect === '4:5';
  const fit = project.fit === 'fill' ? 'object-cover' : 'object-contain';
  return (
    <div ref={area} className="flex-1 min-h-0 min-w-0 flex items-center justify-center bg-[var(--color-bg-main)]">
      <div className="relative rounded-[8px] overflow-hidden bg-black shadow-[0_0_0_0.5px_var(--sep)]" style={{ width: size.w, height: size.h, containerType: 'size' }} aria-label="Preview">
        {project.fit === 'blur' && m?.thumb && <img src={m.thumb} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl opacity-80" />}
        {!clip ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/60 text-[12px] text-center px-6"><Film className="w-6 h-6" />Add footage to the timeline to see it here</div>
        ) : m?.kind === 'picture' ? (
          url ? <img src={url} alt={clip.file} className={cx('absolute inset-0 w-full h-full', fit)} /> : <ImageIcon className="absolute inset-0 m-auto w-6 h-6 text-white/50" />
        ) : (
          <video key={clip.file} ref={video} src={url ?? undefined} muted={false} playsInline preload="auto" className={cx('absolute inset-0 w-full h-full', fit)} aria-label={clip.file} />
        )}
        {cue && <Caption text={cue.text} look={project.captionStyle} tall={tall} />}
        {voiceUrl && <audio ref={voice} src={voiceUrl} preload="auto" />}
        {musicUrl && <audio ref={music} src={musicUrl} preload="auto" loop />}
        {clip && !m?.proxy && m?.kind === 'video' && <span className="absolute top-2 left-2 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white/80">Making the preview copy…</span>}
      </div>
    </div>
  );
};

/** The caption as the export draws it (a close match of the libass looks in core/src/video/edit.ts). */
const Caption: React.FC<{ text: string; look: Project['captionStyle']; tall: boolean }> = ({ text, look, tall }) => {
  const words = text.split(/\s+/).filter(Boolean);
  const per = look === 'bold' ? 4 : look === 'big' ? 2 : 99;
  const shown = words.slice(0, per).join(' ');
  const stroke = '0 0 2px #000, 0 0 2px #000, 1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000';
  return (
    <div className={cx('absolute inset-x-0 flex justify-center px-[6%] pointer-events-none', look === 'big' ? 'top-1/2 -translate-y-1/2' : look === 'bold' ? (tall ? 'bottom-[24%]' : 'bottom-[10%]') : 'bottom-[6%]')}>
      <span className={cx('text-center leading-tight font-[Arial,sans-serif]',
        look === 'clean' && 'text-white font-medium',
        look === 'bold' && 'text-[#FFE500] font-extrabold',
        look === 'boxed' && 'text-white bg-black/55 px-2 py-0.5 rounded-[3px]',
        look === 'big' && 'text-white font-extrabold uppercase')}
        style={{ fontSize: `${look === 'big' ? 9 : look === 'bold' ? 5 : 4.3}cqh`, textShadow: look === 'boxed' ? undefined : stroke }}>{shown}</span>
    </div>
  );
};
