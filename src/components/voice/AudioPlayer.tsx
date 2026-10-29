import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, Download } from 'lucide-react';
import { waveformPeaks } from '../../lib/audio';
import { fmtDuration } from '../../services/voicebox';
import { IconBtn, cx } from '../common/ui';

// Only one clip plays at a time across the whole window.
let current: HTMLAudioElement | null = null;

export const AudioPlayer: React.FC<{
  src: string | null;
  autoPlay?: boolean;
  onDownload?: () => void;
  onEnded?: () => void;
  className?: string;
}> = ({ src, autoPlay, onDownload, onEnded, className }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [duration, setDuration] = useState(0);
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);

  useEffect(() => {
    setPeaks([]); setPos(0); setPlaying(false);
    if (!src) return;
    const a = new Audio(src);
    audioRef.current = a;
    a.playbackRate = rate; a.preservesPitch = true;
    let raf = 0;
    const tick = () => { setPos(a.currentTime); raf = requestAnimationFrame(tick); };
    a.onloadedmetadata = () => setDuration(isFinite(a.duration) ? a.duration : 0);
    a.onplay = () => { setPlaying(true); raf = requestAnimationFrame(tick); };
    a.onpause = () => { setPlaying(false); cancelAnimationFrame(raf); };
    a.onended = () => { setPlaying(false); setPos(0); cancelAnimationFrame(raf); onEnded?.(); };
    waveformPeaks(src, 96).then((r) => { setPeaks(r.peaks); setDuration((d) => d || r.duration); }).catch(() => undefined);
    if (autoPlay) { current?.pause(); current = a; void a.play().catch(() => undefined); }
    return () => { a.pause(); cancelAnimationFrame(raf); if (current === a) current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { current?.pause(); current = a; void a.play(); } else a.pause();
  };
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    a.currentTime = ((e.clientX - r.left) / r.width) * duration;
    setPos(a.currentTime);
  };

  const progress = duration ? pos / duration : 0;
  return (
    <div className={cx('flex items-center gap-3', className)}>
      <button onClick={toggle} disabled={!src} aria-label={playing ? 'Pause' : 'Play'}
        className="w-9 h-9 shrink-0 rounded-full bg-[var(--color-accent-vibrant)] text-white flex items-center justify-center hover:bg-[var(--color-accent-hover)] disabled:opacity-40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-accent-vibrant)]">
        {playing ? <Pause className="w-4 h-4" fill="currentColor" /> : <Play className="w-4 h-4 ml-0.5" fill="currentColor" />}
      </button>
      <div onClick={seek} className="flex-1 h-9 flex items-center gap-[2px] cursor-pointer" role="slider" aria-label="Seek" aria-valuenow={Math.round(progress * 100)}>
        {(peaks.length ? peaks : Array.from({ length: 96 }, () => 0.12)).map((p, i, arr) => (
          <div key={i} className={cx('flex-1 rounded-[6px] transition-colors', i / arr.length <= progress ? 'bg-[var(--color-accent-vibrant)]' : 'bg-black/15 dark:bg-white/20')}
            style={{ height: `${Math.max(8, p * 100)}%` }} />
        ))}
      </div>
      <span className="text-xs tabular-nums text-[var(--color-text-muted)] w-[74px] text-right">
        {fmtDuration(pos)} / {fmtDuration(duration)}
      </span>
      <button type="button" onClick={() => { const r = [1, 1.25, 1.5, 2, 0.75][([1, 1.25, 1.5, 2, 0.75].indexOf(rate) + 1) % 5]; setRate(r); if (audioRef.current) audioRef.current.playbackRate = r; }}
        aria-label={`Playback speed ${rate}×. Click to change`} className="h-6 px-1.5 rounded-[6px] text-[11px] font-medium tabular-nums bg-black/5 dark:bg-white/10 hover:bg-black/10">{rate}×</button>
      {onDownload && <IconBtn label="Save as WAV" onClick={onDownload}><Download className="w-4 h-4" /></IconBtn>}
    </div>
  );
};
