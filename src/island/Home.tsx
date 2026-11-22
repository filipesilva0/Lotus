// The island's home (0.23): what opens when you push the mouse to the top of the screen, or hover the
// pill. Top to bottom, only what has something to show:
//   header      Petal, what's happening (or "All quiet"), Open Lotus, Hide
//   activity    everything still running, each with its ring
//   widgets     now playing · focus timer · next up · the shelf
//   quick row   the buttons you pinned (Edit to change them)
//   note box    ask Lotus, or keep a note in memory or on the task board
import React, { useState } from 'react';
import {
  AppWindow, ArrowUp, Brain, CalendarClock, CircleCheck, Clapperboard, Image as ImageIcon, ListPlus, MessageSquare, Mic, Music2,
  Pause, Phone, Play, Repeat, ScrollText, SkipBack, SkipForward, Sparkles, SquareKanban, Timer, Briefcase, Volume2, X, Inbox,
} from 'lucide-react';
import { Mascot } from './Mascot';
import { AgentFace } from '../components/common/AgentFace';
import { Card, IconBtn, Label, Link, Pill, Ring, Tile, focusRing } from './parts';
import { ACTIONS, MAX_PINS, actionById } from './actions';
import type { Activity, Mood } from './state';
import type { NowPlaying, ShelfItem } from './sources';
import type { NextRow } from './nextUp';
import { Focus, focusLabel, focusLeft } from './focus';

export const ACTION_ICON: Record<string, React.FC<{ className?: string }>> = {
  ask: MessageSquare, dictate: Mic, call: Phone, image: ImageIcon, 'clip-summary': ScrollText, 'read-clip': Volume2, focus: Timer,
  work: Briefcase, video: Clapperboard, tasks: SquareKanban,
};

export interface PinOption { id: string; label: string; hint: string }

export interface HomeProps {
  mood: Mood;
  hue: number;
  kicker: string;
  title: string;
  head?: Activity;
  running: Activity[];
  media: NowPlaying | null;
  onMedia: (a: 'toggle' | 'next' | 'prev') => void;
  focus: Focus | null;
  now: number;
  onFocus: (a: 'pause' | 'resume' | 'stop') => void;
  next: NextRow[];
  onJoin: (url: string) => void;
  onFocusTask: (id: string, title: string) => void;
  shelf: ShelfItem[];
  onOpenShelf: () => void;
  pins: PinOption[];
  allPins: PinOption[];
  onPins: (ids: string[]) => void;
  onAction: (id: string) => void;
  onAsk: (text: string) => void;
  onRemember: (text: string) => Promise<string>;
  onAddTask: (text: string) => Promise<string>;
  onDictate: () => void;
  onOpen: () => void;
  onHide: () => void;
  onTyping: (busy: boolean) => void;
  /** A short note from the island (a routine started, nothing copied). */
  notice?: string | null;
}

const pinIcon = (id: string) => ACTION_ICON[id] ?? (id.startsWith('routine:') ? Repeat : Sparkles);

export const Home: React.FC<HomeProps> = (p) => {
  const [text, setText] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const left = p.focus ? focusLeft(p.focus, p.now) : 0;
  const say = (m: string) => { setSaved(m); setTimeout(() => setSaved(null), 2600); };
  const keep = async (fn: (t: string) => Promise<string>) => { const t = text.trim(); if (!t) return; say(await fn(t)); setText(''); p.onTyping(false); };

  if (editing) return <PinEditor all={p.allPins} chosen={p.pins.map((x) => x.id)} onDone={(ids) => { p.onPins(ids); setEditing(false); }} />;

  return (
    <div className="px-3 pt-2.5 pb-3 flex flex-col gap-2.5">
      {/* Header */}
      <div className="flex items-center gap-2.5 pl-1">
        {p.head?.agent ? <AgentFace name={p.head.agent} size={32} animate={!p.head.done} mood={p.head.done ? undefined : 'thinking'} /> : <Mascot hue={p.hue} mood={p.mood} size={32} />}
        <div className="flex-1 min-w-0">
          <p className="text-[11px] leading-tight text-[var(--is-muted)]">{p.kicker}</p>
          <p className="truncate text-[14px] font-semibold leading-snug text-[var(--is-text)]">{p.title}</p>
        </div>
        {p.head && <span className="flex items-center gap-1.5 text-[12px] font-semibold tabular-nums text-[var(--color-accent-vibrant)]">
          {p.head.progress != null && !p.head.done && `${Math.round(p.head.progress * 100)}%`}<Ring progress={p.head.progress ?? null} done={p.head.done} size={20} /></span>}
        <IconBtn label="Open Lotus" onClick={p.onOpen}><AppWindow className="w-4 h-4" /></IconBtn>
        <IconBtn label="Hide until something new happens" onClick={p.onHide}><X className="w-4 h-4" /></IconBtn>
      </div>

      {p.running.length > 1 && (
        <ul className="-mt-1 pl-[50px] pr-1 space-y-0.5" aria-label="Also running">
          {p.running.slice(1, 5).map((a) => (
            <li key={a.id} className="h-6 flex items-center gap-2 text-[12px] text-[var(--is-muted)]">
              {a.agent && <AgentFace name={a.agent} size={16} mood="thinking" />}
              <span className="flex-1 truncate">{a.label}</span><Ring progress={a.progress ?? null} />
            </li>
          ))}
        </ul>
      )}

      {/* Widgets */}
      {p.media && (
        <Card label="Now playing">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 shrink-0 rounded-[10px] bg-[var(--is-raised)] inline-flex items-center justify-center text-[var(--color-accent-vibrant)]"><Music2 className="w-4 h-4" /></span>
            <div className="flex-1 min-w-0">
              <p className="truncate text-[13px] font-semibold text-[var(--is-text)]">{p.media.title}</p>
              <p className="truncate text-[11px] text-[var(--is-muted)]">{[p.media.artist, p.media.app].filter(Boolean).join(' · ')}</p>
            </div>
            <IconBtn label="Previous" onClick={() => p.onMedia('prev')}><SkipBack className="w-4 h-4" /></IconBtn>
            <IconBtn label={p.media.playing ? 'Pause' : 'Play'} tone="raised" big onClick={() => p.onMedia('toggle')}>{p.media.playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}</IconBtn>
            <IconBtn label="Next" onClick={() => p.onMedia('next')}><SkipForward className="w-4 h-4" /></IconBtn>
          </div>
        </Card>
      )}

      {p.focus && (
        <Card label="Focus timer">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 shrink-0 inline-flex items-center justify-center"><Ring progress={1 - left / p.focus.total} size={30} /></span>
            <div className="flex-1 min-w-0">
              <p className="text-[18px] font-semibold tabular-nums leading-none text-[var(--is-text)]">{focusLabel(left)}</p>
              <p className="truncate text-[11px] mt-1 text-[var(--is-muted)]">{p.focus.task ? `Focusing on ${p.focus.task.title}` : 'Focus time'}{p.focus.since === null ? ' · paused' : ''}</p>
            </div>
            {p.focus.since === null
              ? <IconBtn label="Resume" tone="raised" big onClick={() => p.onFocus('resume')}><Play className="w-4 h-4" /></IconBtn>
              : <IconBtn label="Pause" tone="raised" big onClick={() => p.onFocus('pause')}><Pause className="w-4 h-4" /></IconBtn>}
            <IconBtn label="Stop the timer" onClick={() => p.onFocus('stop')}><X className="w-4 h-4" /></IconBtn>
          </div>
        </Card>
      )}

      {p.next.length > 0 && (
        <Card label="Next up">
          <Label>Next up</Label>
          <ul className="mt-1 space-y-1">
            {p.next.map((r) => {
              const Icon = r.kind === 'meeting' ? CalendarClock : r.kind === 'task' ? CircleCheck : Repeat;
              return (
                <li key={r.id} className="min-h-7 flex items-center gap-2 px-1">
                  <Icon className="w-4 h-4 shrink-0 text-[var(--is-muted)]" />
                  <span className="flex-1 min-w-0 truncate text-[12px] text-[var(--is-text)]">{r.title}</span>
                  <span className={`shrink-0 text-[11px] tabular-nums ${r.meta === 'overdue' ? 'text-[var(--is-warn)]' : 'text-[var(--is-muted)]'}`}>{r.meta}</span>
                  {r.kind === 'meeting' && r.join && <Pill primary onClick={() => p.onJoin(r.join!)}>Join</Pill>}
                  {r.kind === 'task' && !p.focus && <IconBtn label={`Focus on ${r.title}`} onClick={() => p.onFocusTask(r.id, r.title)}><Timer className="w-3.5 h-3.5" /></IconBtn>}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {p.shelf.length > 0 && (
        <button type="button" onClick={p.onOpenShelf} className={`rounded-[16px] bg-[var(--is-card)] hover:bg-[var(--is-raised)] px-3 py-2 flex items-center gap-2 text-left ${focusRing}`}>
          <Inbox className="w-4 h-4 shrink-0 text-[var(--is-muted)]" />
          <span className="text-[12px] font-semibold text-[var(--is-text)]">Shelf</span>
          <span className="flex-1 min-w-0 truncate text-[12px] text-[var(--is-muted)]">{p.shelf.slice(0, 3).map((s) => s.name).join(', ')}{p.shelf.length > 3 ? ` and ${p.shelf.length - 3} more` : ''}</span>
          <span className="shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-[var(--is-raised)] text-[11px] font-semibold tabular-nums inline-flex items-center justify-center text-[var(--is-text)]">{p.shelf.length}</span>
        </button>
      )}

      {/* Quick buttons */}
      <div>
        <Label action={<Link onClick={() => setEditing(true)} title="Choose the buttons">Edit</Link>}>Quick buttons</Label>
        <div className="mt-1 flex gap-1">
          {p.pins.map((x) => { const I = pinIcon(x.id); return <Tile key={x.id} label={x.label} hint={x.hint} active={x.id === 'focus' && !!p.focus} onClick={() => p.onAction(x.id)}><I className="w-[18px] h-[18px]" /></Tile>; })}
        </div>
      </div>

      {/* Ask, or keep a note */}
      <form onSubmit={(e) => { e.preventDefault(); const t = text.trim(); if (t) { p.onAsk(t); setText(''); p.onTyping(false); } }}
        className="flex items-center gap-1 rounded-full bg-[var(--is-raised)] pl-3.5 pr-1 h-10 ring-1 ring-transparent focus-within:ring-[var(--is-hair)]">
        <input value={text} aria-label="Ask Lotus, or write a note" placeholder="Ask Lotus, or write a note…"
          onChange={(e) => { setText(e.target.value); p.onTyping(!!e.target.value); }}
          onKeyDown={(e) => { if (e.key === 'Escape') { setText(''); p.onTyping(false); } }}
          className="flex-1 min-w-0 bg-transparent outline-none text-[13px] text-[var(--is-text)] placeholder:text-[var(--is-muted)]" />
        {text.trim() ? <>
          <IconBtn label="Keep in memory" onClick={() => void keep(p.onRemember)}><Brain className="w-4 h-4" /></IconBtn>
          <IconBtn label="Add to my tasks" onClick={() => void keep(p.onAddTask)}><ListPlus className="w-4 h-4" /></IconBtn>
          <button type="submit" aria-label="Ask Lotus" title="Ask Lotus (Enter)" className={`w-8 h-8 shrink-0 rounded-full bg-[var(--color-accent-fill)] hover:bg-[var(--color-accent-fill-hover)] text-white inline-flex items-center justify-center ${focusRing}`}><ArrowUp className="w-4 h-4" /></button>
        </> : <IconBtn label="Dictate" onClick={p.onDictate}><Mic className="w-4 h-4" /></IconBtn>}
      </form>
      {(saved ?? p.notice) && <p role="status" className="-mt-1 px-3 text-[11px] text-[var(--is-muted)]">{saved ?? p.notice}</p>}
    </div>
  );
};

/** Choose the quick buttons: up to six, in the order you tick them. */
const PinEditor: React.FC<{ all: PinOption[]; chosen: string[]; onDone: (ids: string[]) => void }> = ({ all, chosen, onDone }) => {
  const [ids, setIds] = useState(chosen);
  const toggle = (id: string) => setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX_PINS ? cur : [...cur, id]));
  return (
    <div className="px-3 pt-3 pb-3 flex flex-col gap-2" role="dialog" aria-label="Choose quick buttons">
      <div className="flex items-center justify-between px-1">
        <div>
          <p className="text-[14px] font-semibold text-[var(--is-text)]">Quick buttons</p>
          <p className="text-[11px] text-[var(--is-muted)]">Pick up to {MAX_PINS}. {ids.length} chosen.</p>
        </div>
        <Pill primary onClick={() => onDone(ids)}>Done</Pill>
      </div>
      <ul className="max-h-[300px] overflow-y-auto grid grid-cols-2 gap-1">
        {all.map((o) => {
          const on = ids.includes(o.id);
          const I = pinIcon(o.id);
          return (
            <li key={o.id}>
              <button type="button" aria-pressed={on} title={o.hint} onClick={() => toggle(o.id)} disabled={!on && ids.length >= MAX_PINS}
                className={`w-full h-9 px-2.5 rounded-[10px] flex items-center gap-2 text-left text-[12px] disabled:opacity-40 ${focusRing} ${on ? 'bg-[var(--is-raised-hover)] text-[var(--is-text)] font-semibold' : 'text-[var(--is-muted)] hover:bg-[var(--is-raised)]'}`}>
                <I className="w-4 h-4 shrink-0" /><span className="flex-1 truncate">{o.label}</span>
                {on && <span className="text-[11px] tabular-nums text-[var(--color-accent-vibrant)]">{ids.indexOf(o.id) + 1}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

/** All the buttons you can pin: Lotus's own, then your skills and routines. */
export function pinOptions(skills: { id: string; name: string }[], routines: { id: string; name: string }[]): PinOption[] {
  return [
    ...ACTIONS.map((a) => ({ id: a.id, label: a.label, hint: a.hint })),
    ...skills.map((s) => ({ id: `skill:${s.id}`, label: s.name, hint: `Ask Lotus using your skill “${s.name}”` })),
    ...routines.map((r) => ({ id: `routine:${r.id}`, label: r.name, hint: `Run your routine “${r.name}” now` })),
  ];
}

export const pinsFrom = (ids: string[], all: PinOption[]): PinOption[] => ids.map((id) => all.find((o) => o.id === id) ?? (actionById(id) ? { id, label: actionById(id)!.label, hint: actionById(id)!.hint } : null)).filter((x): x is PinOption => !!x);

