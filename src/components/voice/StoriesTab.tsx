import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Play, Square, Download, Trash2, Copy, Scissors, Film, Sparkles } from 'lucide-react';
import { voicebox, Story, StoryDetail, StoryItem, fmtDuration } from '../../services/voicebox';
import { downloadBlob } from '../../lib/audio';
import { Btn, Card, Select, TextArea, TextInput, Label, Slider, Empty, Banner, Spinner, IconBtn, cx } from '../common/ui';
import { avatarGradient, VoiceData } from './useVoiceData';

const ROW_H = 52;
const effMs = (i: StoryItem) => Math.max(200, i.duration * 1000 - i.trim_start_ms - i.trim_end_ms);

export const StoriesTab: React.FC<{
  data: VoiceData;
  pendingGeneration: string | null;
  onPendingHandled: () => void;
}> = ({ data, pendingGeneration, onPendingHandled }) => {
  const [stories, setStories] = useState<Story[]>([]);
  const [story, setStory] = useState<StoryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pxPerSec, setPxPerSec] = useState(70);
  const [drag, setDrag] = useState<{ id: string; ms: number; track: number } | null>(null);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [lineOpen, setLineOpen] = useState(false);
  const [lineProfile, setLineProfile] = useState('');
  const [lineText, setLineText] = useState('');
  const [lineBusy, setLineBusy] = useState(false);

  const audio = useRef<{ ctx: AudioContext; sources: AudioBufferSourceNode[]; raf: number; t0: number; from: number } | null>(null);
  const buffers = useRef(new Map<string, AudioBuffer>());

  const loadList = useCallback(async () => {
    try { setStories(await voicebox.listStories()); } catch (e) { setErr((e as Error).message); } finally { setLoading(false); }
  }, []);
  const open = useCallback(async (id: string) => {
    try { setStory(await voicebox.getStory(id)); setSelected(null); setPlayheadMs(0); localStorage.setItem('tomo.voice.story', id); }
    catch (e) { setErr((e as Error).message); }
  }, []);
  const reload = useCallback(async () => { if (story) setStory(await voicebox.getStory(story.id)); void loadList(); }, [story, loadList]);

  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => {
    if (!story && stories.length) void open(stories.find((s) => s.id === localStorage.getItem('tomo.voice.story'))?.id ?? stories[0].id);
  }, [stories, story, open]);
  useEffect(() => { if (!lineProfile && data.profiles[0]) setLineProfile(data.profiles[0].id); }, [data.profiles, lineProfile]);

  // A clip sent from Speak/Library lands in the open story (creating one if needed).
  useEffect(() => {
    if (!pendingGeneration) return;
    (async () => {
      try {
        let s = story;
        if (!s) { const c = await voicebox.createStory('Untitled story'); s = await voicebox.getStory(c.id); setStory(s); }
        await voicebox.addStoryItem(s.id, pendingGeneration);
        setStory(await voicebox.getStory(s.id)); void loadList();
      } catch (e) { setErr((e as Error).message); }
      onPendingHandled();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingGeneration]);

  useEffect(() => () => stop(), []); // eslint-disable-line

  const items = story?.items ?? [];
  const tracks = Math.max(3, ...items.map((i) => i.track + 2));
  const totalMs = Math.max(8000, ...items.map((i) => i.start_time_ms + effMs(i) + 2000));
  const sel = items.find((i) => i.id === selected) ?? null;
  const msToPx = (ms: number) => (ms / 1000) * pxPerSec;

  // ── Drag to move ──────────────────────────────────────────────────────────
  const startDrag = (e: React.PointerEvent, it: StoryItem) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelected(it.id);
    const x0 = e.clientX, y0 = e.clientY;
    const move = (ev: PointerEvent) => {
      const ms = Math.max(0, Math.round(it.start_time_ms + ((ev.clientX - x0) / pxPerSec) * 1000));
      const track = Math.max(0, Math.round(it.track + (ev.clientY - y0) / ROW_H));
      setDrag({ id: it.id, ms, track });
    };
    const up = async (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const ms = Math.max(0, Math.round(it.start_time_ms + ((ev.clientX - x0) / pxPerSec) * 1000));
      const track = Math.max(0, Math.round(it.track + (ev.clientY - y0) / ROW_H));
      setDrag(null);
      if (ms !== it.start_time_ms || track !== it.track) {
        try { await voicebox.moveStoryItem(story!.id, it.id, ms, track); await reload(); } catch (er) { setErr((er as Error).message); }
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ── Playback (Web Audio mix of every clip) ──────────────────────────────────
  const stop = () => {
    const a = audio.current;
    if (!a) return;
    cancelAnimationFrame(a.raf);
    a.sources.forEach((s) => { try { s.stop(); } catch { /* already ended */ } });
    void a.ctx.close();
    audio.current = null;
    setPlaying(false);
  };

  const play = async () => {
    if (!story || !items.length) return;
    stop();
    setErr(null);
    setPlaying(true);
    try {
      const ctx = new AudioContext();
      for (const it of items) {
        if (!buffers.current.has(it.generation_id)) {
          const blob = await (await fetch(await voicebox.audioUrl(it.generation_id))).arrayBuffer();
          buffers.current.set(it.generation_id, await ctx.decodeAudioData(blob));
        }
      }
      const from = playheadMs >= totalMs - 2000 ? 0 : playheadMs;
      const t0 = ctx.currentTime + 0.05;
      const sources: AudioBufferSourceNode[] = [];
      for (const it of items) {
        const buf = buffers.current.get(it.generation_id)!;
        const startMs = it.start_time_ms, len = effMs(it);
        if (startMs + len <= from) continue;
        const skip = Math.max(0, from - startMs);
        const src = ctx.createBufferSource();
        const g = ctx.createGain();
        g.gain.value = it.volume;
        src.buffer = buf;
        src.connect(g).connect(ctx.destination);
        src.start(t0 + Math.max(0, startMs - from) / 1000, (it.trim_start_ms + skip) / 1000, (len - skip) / 1000);
        sources.push(src);
      }
      const state = { ctx, sources, raf: 0, t0, from };
      audio.current = state;
      const end = Math.max(...items.map((i) => i.start_time_ms + effMs(i)));
      const tick = () => {
        const ms = from + Math.max(0, (ctx.currentTime - t0) * 1000);
        setPlayheadMs(Math.min(ms, end));
        if (ms >= end) { stop(); return; }
        state.raf = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) { setErr((e as Error).message); stop(); }
  };

  // ── Actions ─────────────────────────────────────────────────────────────────
  const act = async (fn: () => Promise<unknown>) => { try { setErr(null); await fn(); await reload(); } catch (e) { setErr((e as Error).message); } };

  const createStory = async () => {
    const name = newName.trim();
    if (!name) return;
    const s = await voicebox.createStory(name).catch((e) => { setErr(e.message); return null; });
    setNaming(false); setNewName('');
    if (s) { await loadList(); await open(s.id); }
  };

  const addLine = async () => {
    if (!story || !lineText.trim() || !lineProfile) return;
    setLineBusy(true); setErr(null);
    try {
      const prof = data.profiles.find((p) => p.id === lineProfile)!;
      const q = await voicebox.generate({ profile_id: lineProfile, text: lineText.trim(), language: prof.language });
      const done = await voicebox.waitFor(q.id);
      await voicebox.addStoryItem(story.id, done.id);
      setLineText(''); await reload();
    } catch (e) { setErr((e as Error).message); } finally { setLineBusy(false); }
  };

  const ticks = useMemo(() => Array.from({ length: Math.ceil(totalMs / 1000) + 1 }, (_, i) => i), [totalMs]);

  if (loading) return <div className="flex justify-center py-16"><Spinner className="w-5 h-5 text-[var(--color-accent-vibrant)]" /></div>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-5 p-5 min-w-0">
      {/* Story list */}
      <div className="space-y-2">
        <Btn variant="secondary" className="w-full" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setNaming(true)}>New story</Btn>
        {naming && (
          <div className="flex gap-1.5">
            <TextInput autoFocus value={newName} placeholder="Story name" onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void createStory(); if (e.key === 'Escape') setNaming(false); }} />
          </div>
        )}
        <ul className="space-y-1">
          {stories.map((s) => (
            <li key={s.id}>
              <button onClick={() => open(s.id)} className={cx('w-full text-left px-3 py-2 rounded-lg text-xs transition-colors',
                story?.id === s.id ? 'bg-[var(--color-accent-pastel)] text-[var(--color-accent-vibrant)]' : 'hover:bg-black/5 dark:hover:bg-white/5 text-[var(--color-text-main)] dark:text-slate-200')}>
                <span className="font-semibold block truncate">{s.name}</span>
                <span className="text-xs opacity-70">{s.item_count} clip{s.item_count === 1 ? '' : 's'}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {!story ? (
        <Empty icon={<Film className="w-5 h-5" />} title="Compose a multi-voice story"
          body="Arrange clips from different voices on a timeline: dialogue, narration, podcasts. Create a story to begin." />
      ) : (
        <div className="space-y-3 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-[var(--color-text-main)] mr-2 truncate">{story.name}</h2>
            {playing
              ? <Btn variant="primary" icon={<Square className="w-3.5 h-3.5" fill="currentColor" />} onClick={stop}>Stop</Btn>
              : <Btn variant="primary" disabled={!items.length} icon={<Play className="w-3.5 h-3.5" fill="currentColor" />} onClick={play}>Play</Btn>}
            <span className="text-xs tabular-nums text-[var(--color-text-muted)] w-20">{fmtDuration(playheadMs / 1000)} / {fmtDuration(totalMs / 1000 - 2)}</span>
            <div className="flex-1" />
            <div className="w-24"><Slider min={30} max={200} step={5} value={pxPerSec} onChange={setPxPerSec} label="Zoom" /></div>
            <Btn variant="ghost" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setLineOpen(!lineOpen)}>Add line</Btn>
            <Btn variant="secondary" loading={exporting} disabled={!items.length} icon={<Download className="w-3.5 h-3.5" />}
              onClick={async () => { setExporting(true); try { downloadBlob(await voicebox.exportStoryAudio(story.id), `${story.name}.wav`); } catch (e) { setErr((e as Error).message); } finally { setExporting(false); } }}>
              Export WAV
            </Btn>
          </div>

          {err && <Banner tone="error">{err}</Banner>}

          {lineOpen && (
            <Card className="p-3 space-y-2">
              <div className="flex gap-2">
                <Select aria-label="Voice for new line" value={lineProfile} onChange={(e) => setLineProfile(e.target.value)} className="!w-48">
                  {data.profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
                <Btn variant="primary" loading={lineBusy} disabled={!lineText.trim()} icon={<Sparkles className="w-3.5 h-3.5" />} onClick={addLine}>Generate & add</Btn>
              </div>
              <TextArea rows={2} value={lineText} placeholder="What should this voice say?" onChange={(e) => setLineText(e.target.value)} />
            </Card>
          )}

          {/* Timeline */}
          <Card className="overflow-x-auto">
            <div className="relative" style={{ width: Math.max(msToPx(totalMs), 600), height: 24 + tracks * ROW_H }}
              onPointerDown={(e) => {
                if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.bg) return;
                const r = e.currentTarget.getBoundingClientRect();
                setPlayheadMs(Math.max(0, ((e.clientX - r.left) / pxPerSec) * 1000)); setSelected(null);
              }} data-bg>
              <div className="h-6 border-b border-[var(--color-border-subtle)] relative text-xs text-[var(--color-text-muted)] tabular-nums pointer-events-none">
                {ticks.filter((t) => pxPerSec >= 60 || t % 2 === 0).map((t) => <span key={t} className="absolute top-1" style={{ left: t * pxPerSec + 3 }}>{fmtDuration(t)}</span>)}
              </div>
              {Array.from({ length: tracks }).map((_, r) => (
                <div key={r} data-bg className="absolute left-0 right-0 border-b border-dashed border-[var(--color-border-subtle)]" style={{ top: 24 + r * ROW_H, height: ROW_H }} />
              ))}
              {items.map((it) => {
                const d = drag?.id === it.id ? drag : null;
                const left = msToPx(d ? d.ms : it.start_time_ms), top = 24 + (d ? d.track : it.track) * ROW_H + 4;
                return (
                  <div key={it.id} onPointerDown={(e) => startDrag(e, it)} role="button" tabIndex={0} aria-label={`${it.profile_name}: ${it.text}`}
                    className={cx('absolute rounded-lg px-2.5 py-1.5 text-white text-xs leading-tight overflow-hidden cursor-grab active:cursor-grabbing select-none touch-none',
                      selected === it.id && 'ring-2 ring-offset-1 ring-[var(--color-accent-vibrant)] dark:ring-offset-[#22242B]')}
                    style={{ left, top, height: ROW_H - 8, width: Math.max(28, msToPx(effMs(it))), background: avatarGradient(it.profile_name), opacity: it.volume === 0 ? 0.4 : 1 }}>
                    <span className="font-semibold block truncate">{it.profile_name}</span>
                    <span className="opacity-90 block truncate">{it.text}</span>
                  </div>
                );
              })}
              <div className="absolute top-0 bottom-0 w-px bg-rose-500 pointer-events-none" style={{ left: msToPx(playheadMs) }}>
                <div className="w-2.5 h-2.5 -ml-[5px] bg-rose-500 rounded-full" />
              </div>
            </div>
          </Card>

          {items.length === 0 && <p className="text-xs text-[var(--color-text-muted)]">Empty timeline. Use “Add line”, or send clips here from Speak and Library.</p>}

          {sel && (
            <Card className="p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[var(--color-text-main)]">{sel.profile_name}</p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5 line-clamp-2">{sel.text}</p>
                </div>
                <IconBtn label="Split at playhead" disabled={playheadMs <= sel.start_time_ms + 100 || playheadMs >= sel.start_time_ms + effMs(sel) - 100}
                  onClick={() => act(() => voicebox.splitStoryItem(story.id, sel.id, Math.round(playheadMs)))}><Scissors className="w-4 h-4" /></IconBtn>
                <IconBtn label="Duplicate" onClick={() => act(() => voicebox.duplicateStoryItem(story.id, sel.id))}><Copy className="w-4 h-4" /></IconBtn>
                <IconBtn label="Remove from story" onClick={() => act(async () => { await voicebox.deleteStoryItem(story.id, sel.id); setSelected(null); })}><Trash2 className="w-4 h-4" /></IconBtn>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label hint={`${Math.round(sel.volume * 100)}%`}>Volume</Label>
                  <Slider min={0} max={2} step={0.05} value={sel.volume} label="Volume"
                    onChange={(v) => setStory({ ...story, items: items.map((i) => (i.id === sel.id ? { ...i, volume: v } : i)) })}
                    onCommit={(v) => act(() => voicebox.setStoryItemVolume(story.id, sel.id, v))} />
                </div>
                <div>
                  <Label hint="ms">Trim start</Label>
                  <TextInput type="number" min={0} defaultValue={sel.trim_start_ms} key={`ts${sel.id}${sel.trim_start_ms}`}
                    onBlur={(e) => +e.target.value !== sel.trim_start_ms && act(() => voicebox.trimStoryItem(story.id, sel.id, Math.max(0, +e.target.value), sel.trim_end_ms))} />
                </div>
                <div>
                  <Label hint="ms">Trim end</Label>
                  <TextInput type="number" min={0} defaultValue={sel.trim_end_ms} key={`te${sel.id}${sel.trim_end_ms}`}
                    onBlur={(e) => +e.target.value !== sel.trim_end_ms && act(() => voicebox.trimStoryItem(story.id, sel.id, sel.trim_start_ms, Math.max(0, +e.target.value)))} />
                </div>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
};
