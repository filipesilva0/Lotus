// The Video editor's timeline (0.22): clips in order (drag to reorder, drag an edge to trim), the
// voiceover, the captions and the music, with the playhead. Click anywhere to move the playhead.

import React, { useLayoutEffect, useRef, useState } from 'react';
import { AudioLines, Captions, Music, Pause, Play, Scissors, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import { clipSeconds, clipStarts, clock, totalSeconds, trimClip, moveClip, type Media, type Project } from '../../video/project';
import { IconBtn, cx } from '../common/ui';

const LANE = 'relative';

export const Timeline: React.FC<{
  project: Project; media: Media[]; t: number; playing: boolean; selected: string | null;
  onSeek: (t: number) => void; onPlay: () => void; onSelect: (id: string | null) => void; onChange: (p: Project) => void; onSplit: () => void; onRemove: () => void;
  onDropFile: (file: string, at: number) => void;
}> = ({ project, media, t, playing, selected, onSeek, onPlay, onSelect, onChange, onSplit, onRemove, onDropFile }) => {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<{ id: string; edge: 'from' | 'to'; x: number; from: number; to: number } | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const clipsTotal = totalSeconds(project);
  const total = Math.max(clipsTotal, project.voice?.seconds ?? 0, 10);
  const pps = ((width - 24) / total) * zoom;
  const starts = clipStarts(project);
  const x = (s: number) => 12 + s * pps;
  const seekAt = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    onSeek(Math.max(0, Math.min(clipsTotal, (e.clientX - r.left - 12) / pps)));
  };
  const step = total > 300 ? 60 : total > 120 ? 20 : total > 40 ? 10 : total > 15 ? 5 : 1;
  const ticks = Array.from({ length: Math.floor((total * zoom) / step / zoom) + 1 }, (_, i) => i * step);

  // Trimming: drag an edge; the clip's start or end in its file moves with the pointer.
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const d = (e.clientX - drag.x) / pps;
    const m = media.find((x) => x.file === project.clips.find((c) => c.id === drag.id)?.file);
    onChange(drag.edge === 'from' ? trimClip(project, drag.id, drag.from + d, drag.to, m) : trimClip(project, drag.id, drag.from, drag.to + d, m));
  };

  return (
    <div className="shrink-0 flex flex-col border-t border-[var(--sep)] bg-[var(--color-bg-panel)] select-none" aria-label="Timeline">
      <div className="flex items-center gap-1 px-2 h-9 border-b border-[var(--sep)]">
        <IconBtn label={playing ? 'Pause (Space)' : 'Play (Space)'} onClick={onPlay} disabled={!project.clips.length}>{playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}</IconBtn>
        <span className="text-[12px] tabular-nums w-[104px]">{clock(t, true)} <span className="text-[var(--color-text-muted)]">/ {clock(clipsTotal, true)}</span></span>
        <IconBtn label="Split at the playhead (S)" onClick={onSplit} disabled={!project.clips.length}><Scissors className="w-3.5 h-3.5" /></IconBtn>
        <IconBtn label="Remove the selected clip (Delete)" onClick={onRemove} disabled={!selected}><Trash2 className="w-3.5 h-3.5" /></IconBtn>
        <span className="flex-1" />
        <span className="text-[11px] text-[var(--color-text-muted)] mr-1 hidden md:inline">Drag clips to reorder · drag an edge to trim</span>
        <IconBtn label="Zoom out" onClick={() => setZoom((z) => Math.max(1, z / 1.5))} disabled={zoom <= 1}><ZoomOut className="w-3.5 h-3.5" /></IconBtn>
        <IconBtn label="Zoom in" onClick={() => setZoom((z) => Math.min(20, z * 1.5))}><ZoomIn className="w-3.5 h-3.5" /></IconBtn>
      </div>
      <div className="flex">
        <div className="w-[76px] shrink-0 border-r border-[var(--sep)] text-[11px] text-[var(--color-text-muted)]">
          <div className="h-5" />
          <div className="h-14 flex items-center gap-1 px-2">Clips</div>
          <div className="h-6 flex items-center gap-1 px-2"><AudioLines className="w-3 h-3" />Voice</div>
          <div className="h-6 flex items-center gap-1 px-2"><Captions className="w-3 h-3" />Captions</div>
          <div className="h-6 flex items-center gap-1 px-2"><Music className="w-3 h-3" />Music</div>
        </div>
        <div ref={box} className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden relative" onPointerMove={onMove} onPointerUp={() => setDrag(null)} onPointerLeave={() => setDrag(null)}>
          <div className="relative" style={{ width: Math.max(width, x(total) + 12) }}>
            <div className="h-5 relative border-b border-[var(--sep)] cursor-pointer" onMouseDown={seekAt}>
              {ticks.map((s) => <span key={s} className="absolute top-0 h-full border-l border-[var(--sep)] pl-1 text-[10px] text-[var(--color-text-muted)] tabular-nums" style={{ left: x(s) }}>{clock(s)}</span>)}
            </div>
            <div className={cx('h-14', LANE)} onMouseDown={(e) => { if (e.target === e.currentTarget) { onSelect(null); seekAt(e); } }}
              onDragOver={(e) => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); const s = (e.clientX - r.left - 12) / pps; setDragOver(starts.findIndex((st, i) => s < st + clipSeconds(project.clips[i]) / 2) === -1 ? project.clips.length : starts.findIndex((st, i) => s < st + clipSeconds(project.clips[i]) / 2)); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                const at = dragOver ?? project.clips.length;
                setDragOver(null);
                const id = e.dataTransfer.getData('application/x-lotus-clip');
                const file = e.dataTransfer.getData('application/x-lotus-media');
                if (id) { const from = project.clips.findIndex((c) => c.id === id); if (from >= 0) onChange(moveClip(project, id, (at > from ? at - 1 : at) - from)); }
                else if (file) onDropFile(file, at);
              }}>
              {!project.clips.length && <span className="absolute inset-y-2 left-3 right-3 rounded-[6px] border border-dashed border-[var(--sep)] text-[12px] text-[var(--color-text-muted)] flex items-center justify-center pointer-events-none">Drag footage here, or press + on a file</span>}
              {project.clips.map((c, i) => {
                const m = media.find((x) => x.file === c.file);
                const w = Math.max(6, clipSeconds(c) * pps - 2);
                return (
                  <div key={c.id} draggable onDragStart={(e) => { e.dataTransfer.setData('application/x-lotus-clip', c.id); e.dataTransfer.effectAllowed = 'move'; }}
                    onMouseDown={(e) => { e.stopPropagation(); onSelect(c.id); onSeek(Math.max(starts[i], Math.min(starts[i] + clipSeconds(c) - 0.01, (e.clientX - (e.currentTarget.parentElement!.getBoundingClientRect().left) + 0 - 12) / pps))); }}
                    role="button" aria-label={`${c.file}, ${clipSeconds(c).toFixed(1)} seconds`} aria-pressed={selected === c.id}
                    className={cx('absolute top-1.5 bottom-1.5 rounded-[6px] overflow-hidden cursor-grab bg-[var(--color-accent-pastel)] shadow-[0_0_0_0.5px_var(--sep)]', selected === c.id && 'shadow-[0_0_0_2px_var(--color-accent-vibrant)] z-10', !m && 'opacity-50')}
                    style={{ left: x(starts[i]) + 1, width: w, backgroundImage: m?.thumb ? `url(${m.thumb})` : undefined, backgroundSize: 'auto 100%', backgroundRepeat: 'repeat-x' }}>
                    <span className="absolute inset-x-0 bottom-0 px-1.5 py-0.5 text-[10px] text-white truncate bg-gradient-to-t from-black/70 to-transparent">{c.file} · {clipSeconds(c).toFixed(1)} s</span>
                    {selected === c.id && (['from', 'to'] as const).map((edge) => (
                      <span key={edge} aria-hidden="true" onMouseDown={(e) => e.stopPropagation()} onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); setDrag({ id: c.id, edge, x: e.clientX, from: c.from, to: c.to }); }}
                        className={cx('absolute top-0 bottom-0 w-2 cursor-ew-resize bg-[var(--color-accent-vibrant)]', edge === 'from' ? 'left-0' : 'right-0')} />
                    ))}
                  </div>
                );
              })}
              {dragOver !== null && <span className="absolute top-1 bottom-1 w-0.5 bg-[var(--color-accent-vibrant)]" style={{ left: x(dragOver < project.clips.length ? starts[dragOver] : clipsTotal) }} />}
            </div>
            <div className={cx('h-6', LANE)} onMouseDown={seekAt}>
              {project.voice && <span className="absolute top-1 bottom-1 rounded-[4px] bg-[color-mix(in_srgb,var(--c-green,#34c759)_30%,transparent)] text-[10px] px-1.5 truncate leading-4" style={{ left: x(0), width: project.voice.seconds * pps }}>{project.voice.file}</span>}
              {project.voice?.lines.map((l, i) => <span key={i} className="absolute top-1.5 bottom-1.5 rounded-[2px] bg-[color-mix(in_srgb,var(--c-green,#34c759)_55%,transparent)] pointer-events-none" style={{ left: x(l.start), width: Math.max(2, (l.end - l.start) * pps) }} />)}
            </div>
            <div className={cx('h-6', LANE)} onMouseDown={seekAt}>
              {project.cues.map((c, i) => <span key={i} title={c.text} className="absolute top-1 bottom-1 rounded-[3px] bg-[color-mix(in_srgb,var(--color-accent-vibrant)_35%,transparent)] text-[9px] px-1 truncate leading-4" style={{ left: x(c.start), width: Math.max(3, (c.end - c.start) * pps - 1) }}>{c.text}</span>)}
            </div>
            <div className={cx('h-6', LANE)} onMouseDown={seekAt}>
              {project.music && <span className="absolute top-1 bottom-1 rounded-[4px] bg-[color-mix(in_srgb,var(--c-orange,#ff9500)_30%,transparent)] text-[10px] px-1.5 truncate leading-4" style={{ left: x(0), width: Math.max(10, clipsTotal * pps) }}>{project.music}</span>}
            </div>
            <span aria-hidden="true" className="absolute top-0 bottom-0 w-px bg-[var(--c-red,#ff3b30)] pointer-events-none" style={{ left: x(t) }}><span className="absolute -top-0 -left-[4px] w-[9px] h-[9px] rounded-full bg-[var(--c-red,#ff3b30)]" /></span>
          </div>
        </div>
      </div>
    </div>
  );
};
