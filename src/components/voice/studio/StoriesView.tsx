// Stories (0.8.2): write a script ("Ana: Hello!"), give each speaker a voice, make every line, then
// arrange lines on four tracks (overlaps allowed), play them together and export one WAV.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Download, ListPlus, Play, RefreshCw, Square, Trash2, Wand2 } from 'lucide-react';
import { Banner, Btn, Empty, IconBtn, Select, TextArea, cx } from '../../common/ui';
import { SliderField } from '../../common/Pane';
import { ClipAudio } from './parts';
import { deleteMedia, loadMedia, saveMedia } from '../../../lib/core';
import { uid } from '../../../lib/persist';
import { downloadBlob } from '../../../lib/audio';
import { mixStory, playTogether } from '../../../voice/render';
import { Story, StoryItem, layoutStory, parseScript, scriptSpeakers, storyLength } from '../../../voice/studio';
import { Studio, speakWith } from '../../../voice/useStudio';

const TRACKS = 4;
const SAMPLE = 'Narrator: It was a quiet night in the village.\nAna: Did you hear that?\nLeo: Just the wind. Go back to sleep.\nNarrator: But it was not the wind.';

export const newStory = (): Story => ({ id: uid('story'), name: 'Untitled Story', items: [], gap: 0.4, created: Date.now(), updated: Date.now() });

export const StoriesView: React.FC<{ studio: Studio; storyId: string | null; onStory: (id: string) => void }> = ({ studio, storyId, onStory }) => {
  const story = studio.stories.find((s) => s.id === storyId) ?? null;
  const [script, setScript] = useState('');
  const [cast, setCast] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopRef.current?.(), []);
  useEffect(() => { setScript(''); setSel(null); stopRef.current?.(); }, [storyId]);

  const ready = studio.options.filter((o) => o.ready);
  const fallback = studio.voice?.id ?? ready[0]?.id ?? '';
  const speakers = useMemo(() => scriptSpeakers(script), [script]);
  // Every new speaker gets a different voice to start with.
  useEffect(() => {
    setCast((c) => { const n = { ...c }; speakers.forEach((s, i) => { if (!n[s]) n[s] = ready[(i + 1) % Math.max(1, ready.length)]?.id ?? fallback; }); return n; });
  }, [speakers.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!story) return <Empty className="h-full" icon={<ListPlus />} title="No story open" body="Stories mix several voices into one audio file: dialogues, audiobooks, ads. Press New Story to start." action={<Btn variant="primary" onClick={() => { const s = newStory(); studio.saveStories((l) => [s, ...l]); onStory(s.id); }}>New Story</Btn>} />;

  const save = (fn: (s: Story) => Story) => studio.saveStories((l) => l.map((x) => (x.id === story.id ? { ...fn(x), updated: Date.now() } : x)));
  const patchItem = (id: string, p: Partial<StoryItem>) => save((s) => ({ ...s, items: s.items.map((it) => (it.id === id ? { ...it, ...p } : it)) }));
  const nameOf = (vid: string) => studio.options.find((o) => o.id === vid)?.name ?? 'Missing voice';
  const layout = layoutStory(story);
  const length = storyLength(story);
  const missing = story.items.filter((it) => !it.clip);

  const addLines = () => {
    const lines = parseScript(script, cast, fallback);
    if (!lines.length) return;
    save((s) => ({ ...s, items: [...s.items, ...lines.map((l): StoryItem => ({ id: uid('line'), voice: l.voice, text: l.text, track: 0, start: null, gain: 1 }))] }));
    setScript('');
  };

  const make = async (it: StoryItem) => {
    const v = studio.options.find((o) => o.id === it.voice);
    if (!v?.ready) throw new Error(`“${it.text.slice(0, 30)}…”: ${v?.why ?? 'its voice is missing. Pick another.'}`);
    const r = await speakWith(v, it.text);
    if (it.clip) void deleteMedia(it.clip).catch(() => undefined);
    patchItem(it.id, { clip: r.path, duration: r.seconds });
  };
  const makeAll = async (only?: StoryItem[]) => {
    setErr(null);
    const list = only ?? missing;
    try { for (let i = 0; i < list.length; i++) { setBusy(`Making line ${i + 1} of ${list.length}…`); await make(list[i]); } }
    catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const parts = async () => {
    const cur = studio.stories.find((s) => s.id === story.id) ?? story;
    const lay = layoutStory(cur);
    return Promise.all(cur.items.filter((it) => it.clip).map(async (it) => ({ blob: await loadMedia(it.clip!), start: lay.find((l) => l.id === it.id)!.start, gain: it.gain })));
  };
  const play = async () => {
    if (playing) { stopRef.current?.(); return; }
    setPlaying(true);
    stopRef.current = playTogether(await parts(), () => { setPlaying(false); stopRef.current = null; });
  };
  const exportWav = async () => {
    setErr(null); setBusy('Mixing…');
    try { const wav = await mixStory(await parts()); await saveMedia(wav, story.name); downloadBlob(wav, `${story.name.replace(/[^\w\- ]+/g, '').trim() || 'story'}.wav`); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const move = (i: number, d: -1 | 1) => save((s) => { const items = [...s.items]; const j = i + d; if (j < 0 || j >= items.length) return s; [items[i], items[j]] = [items[j], items[i]]; return { ...s, items }; });
  const removeLine = (it: StoryItem) => { if (it.clip) void deleteMedia(it.clip).catch(() => undefined); save((s) => ({ ...s, items: s.items.filter((x) => x.id !== it.id) })); };
  const scale = Math.max(length, 1);

  return (
    <div className="max-w-[860px] mx-auto px-6 py-6 space-y-5">
      <div className="flex items-center gap-2">
        <input value={story.name} onChange={(e) => save((s) => ({ ...s, name: e.target.value }))} aria-label="Story name" className="flex-1 min-w-0 bg-transparent text-[18px] font-semibold focus:outline-none rounded-[6px] focus-visible:shadow-[0_0_0_2px_var(--color-accent-fill)]" />
        <span className="text-[12px] tabular-nums text-[var(--color-text-muted)]">{story.items.length} lines · {length.toFixed(1)} s</span>
        {missing.length > 0 && <Btn loading={!!busy} icon={<Wand2 className="w-3.5 h-3.5" />} onClick={() => void makeAll()}>Make {missing.length === story.items.length ? 'All' : `${missing.length} Missing`}</Btn>}
        <Btn variant="primary" disabled={!story.items.some((i) => i.clip)} icon={playing ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />} onClick={() => void play()}>{playing ? 'Stop' : 'Play'}</Btn>
        <IconBtn label="Export as WAV (also saved in Lotus Studio/Audio)" disabled={!story.items.some((i) => i.clip) || !!busy} onClick={() => void exportWav()}><Download className="w-4 h-4" /></IconBtn>
      </div>
      {busy && <p role="status" className="text-[12px] text-[var(--color-text-muted)]">{busy}</p>}
      {err && <Banner tone="error">{err}</Banner>}

      {/* Timeline: one row per track, each line a block at its place. */}
      {story.items.length > 0 && (
        <div className="rounded-[12px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)] p-2" aria-label="Timeline">
          {Array.from({ length: TRACKS }, (_, t) => (
            <div key={t} className="relative h-8 my-1 rounded-[6px] bg-[var(--hover)]">
              <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[12px] text-[var(--color-text-muted)] pointer-events-none">{t + 1}</span>
              <div className="absolute inset-y-0 left-6 right-1">
              {layout.filter((l) => l.track === t).map((l) => {
                const it = story.items.find((x) => x.id === l.id)!;
                return (
                  <button key={l.id} type="button" onClick={() => setSel(l.id)} title={`${nameOf(it.voice)}: ${it.text}`}
                    style={{ left: `${(l.start / scale) * 100}%`, width: `max(6px, ${((l.end - l.start || 0.5) / scale) * 100}%)` }}
                    className={cx('absolute top-1 bottom-1 rounded-[5px] px-1.5 text-[12px] text-left truncate', it.clip ? 'bg-[var(--color-accent-fill)] text-white' : 'bg-[var(--pressed)] text-[var(--color-text-muted)]', sel === l.id && 'ring-2 ring-[var(--color-text-main)]')}>
                    {nameOf(it.voice)}
                  </button>
                );
              })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lines */}
      <ol className="space-y-2">
        {story.items.map((it, i) => (
          <li key={it.id} id={`line-${it.id}`} className={cx('rounded-[12px] p-3 shadow-[0_0_0_0.5px_var(--sep)]', sel === it.id ? 'bg-[var(--hover)]' : 'bg-[var(--color-bg-card)]')} onClick={() => setSel(it.id)}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[12px] tabular-nums text-[var(--color-text-muted)] w-5">{i + 1}</span>
              <div className="w-[200px]"><Select aria-label="Voice for this line" value={it.voice} onChange={(e) => patchItem(it.id, { voice: e.target.value, clip: undefined, duration: undefined })}>{studio.options.map((o) => <option key={o.id} value={o.id} disabled={!o.ready}>{o.name}</option>)}</Select></div>
              <div className="w-[90px]"><Select aria-label="Track" value={it.track} onChange={(e) => patchItem(it.id, { track: Number(e.target.value) })}>{Array.from({ length: TRACKS }, (_, t) => <option key={t} value={t}>Track {t + 1}</option>)}</Select></div>
              <label className="text-[12px] text-[var(--color-text-muted)] inline-flex items-center gap-1">Start
                <input type="number" min={0} step={0.1} value={it.start ?? ''} placeholder="auto" onChange={(e) => patchItem(it.id, { start: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })}
                  className="w-16 h-7 px-1.5 rounded-[6px] bg-[var(--hover)] text-[12px] text-[var(--color-text-main)] focus:outline-none" aria-label="Start time in seconds (empty: after the previous line)" />s</label>
              <span className="flex-1" />
              <IconBtn label="Move up" className="!w-7 !h-7" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="w-3.5 h-3.5" /></IconBtn>
              <IconBtn label="Move down" className="!w-7 !h-7" disabled={i === story.items.length - 1} onClick={() => move(i, 1)}><ArrowDown className="w-3.5 h-3.5" /></IconBtn>
              <IconBtn label={it.clip ? 'Make again' : 'Make this line'} className="!w-7 !h-7" disabled={!!busy} onClick={() => void makeAll([it])}><RefreshCw className="w-3.5 h-3.5" /></IconBtn>
              <IconBtn label="Delete line" className="!w-7 !h-7 hover:!text-[var(--c-red)]" onClick={() => removeLine(it)}><Trash2 className="w-3.5 h-3.5" /></IconBtn>
            </div>
            <textarea value={it.text} rows={1} onChange={(e) => patchItem(it.id, { text: e.target.value, clip: undefined, duration: undefined })} aria-label="Line text"
              className="w-full resize-none bg-transparent text-[14px] leading-relaxed focus:outline-none" />
            {it.clip && <div className="mt-1 grid grid-cols-[1fr_160px] gap-3 items-center"><ClipAudio path={it.clip} /><SliderField label="Volume" value={it.gain} min={0} max={2} step={0.05} onChange={(g) => patchItem(it.id, { gain: g })} format={(g) => `${Math.round(g * 100)}%`} /></div>}
          </li>
        ))}
      </ol>

      {/* Script → lines */}
      <section aria-label="Add lines" className="rounded-[12px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)] p-3 space-y-3">
        <div className="flex items-center justify-between"><h3 className="text-[13px] font-semibold">Add Lines</h3>{!script && <Btn size="sm" variant="ghost" onClick={() => setScript(SAMPLE)}>Use an Example</Btn>}</div>
        <TextArea rows={4} value={script} onChange={(e) => setScript(e.target.value)} aria-label="Script" placeholder={'One line per sentence. Start with a name to change who speaks:\nAna: Hello!\nLeo: Hi, Ana.'} />
        {speakers.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {speakers.map((s) => (
              <label key={s} className="flex items-center gap-2 text-[13px]"><span className="w-24 truncate font-medium">{s}</span>
                <Select aria-label={`Voice for ${s}`} value={cast[s] ?? fallback} onChange={(e) => setCast((c) => ({ ...c, [s]: e.target.value }))}>{studio.options.map((o) => <option key={o.id} value={o.id} disabled={!o.ready}>{o.name}</option>)}</Select>
              </label>
            ))}
          </div>
        )}
        <div className="flex items-center gap-3">
          <Btn variant="primary" disabled={!script.trim() || !fallback} icon={<ListPlus className="w-3.5 h-3.5" />} onClick={addLines}>Add {parseScript(script, cast, fallback).length || ''} Lines</Btn>
          <div className="w-[200px]"><SliderField label="Pause between lines" value={story.gap} min={0} max={2} step={0.1} onChange={(g) => save((s) => ({ ...s, gap: g }))} format={(g) => `${g.toFixed(1)} s`} /></div>
        </div>
      </section>
    </div>
  );
};
