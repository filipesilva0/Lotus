// The island while Lotus is doing something (0.23.1). The user: "when he's doing something else, the
// island should be dedicated to that, with a button to go back to the menu". So opening the island
// while work runs shows only that work: what it is, what it is doing now, how far along, how long it
// has taken, and the rest of what is running. Menu goes to the home (quick buttons, widgets, note box).
import React from 'react';
import { LayoutGrid, Mic, Square, X } from 'lucide-react';
import { Mascot } from './Mascot';
import { AgentFace } from '../components/common/AgentFace';
import { LotusMark } from '../components/common/LotusMark';
import { IconBtn, Pill, Ring } from './parts';
import type { Activity, Mood } from './state';

export const KIND_WORD: Record<Activity['kind'], string> = { image: 'Images', voice: 'Voice', chat: 'Chat', download: 'Download', research: 'Research', build: 'Work' };
/** The page an activity belongs to, for "Open in Lotus". */
export function pageOf(a: Activity): string {
  if (a.kicker === 'Task' || a.kicker === 'Routine') return 'tasks';
  return { image: 'images', voice: 'voice', chat: 'chat', download: 'engines', research: 'assistant', build: 'work' }[a.kind];
}
export const wordOf = (a: Activity) => a.kicker ?? KIND_WORD[a.kind];

/** "12 s", "3 min", "1 h 05 min". */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

export interface WorkViewProps {
  head: Activity;
  others: Activity[];
  mood: Mood;
  hue: number;
  /** When the head started (first seen by the island). */
  since: number;
  now: number;
  voice: 'idle' | 'speaking' | 'listening' | 'transcribing';
  voiceLine: string;
  onMenu: () => void;
  onOpen: (page: string) => void;
  /** Only for Lotus's own agent runs: stop it. */
  onStop?: () => void;
  onHide: () => void;
}

export const WorkView: React.FC<WorkViewProps> = (p) => {
  const pct = p.head.progress != null && !p.head.done ? Math.round(p.head.progress * 100) : null;
  const talking = p.voice !== 'idle';
  return (
    <div className="px-3 pt-2.5 pb-3 flex flex-col gap-2.5" aria-label="What Lotus is doing">
      <div className="flex items-center gap-2 pl-1 h-7">
        <LotusMark size={18} />
        <p className="flex-1 min-w-0 truncate text-[11px] font-semibold text-[var(--is-muted)]">
          {talking ? 'Voice' : wordOf(p.head)}{!p.head.done && !talking ? ` · ${elapsed(p.now - p.since)}` : ''}
        </p>
        <IconBtn label="Hide until something new happens" onClick={p.onHide}><X className="w-4 h-4" /></IconBtn>
      </div>

      <div className="flex items-center gap-3 px-1">
        {p.head.agent && !talking
          ? <AgentFace name={p.head.agent} size={44} animate={!p.head.done} mood={p.head.done ? undefined : 'thinking'} />
          : <Mascot hue={p.hue} mood={p.mood} size={44} />}
        <div className="flex-1 min-w-0">
          <p className="text-[16px] font-semibold leading-snug text-[var(--is-text)] line-clamp-2">{talking ? p.voiceLine : p.head.label}</p>
          {pct !== null && (
            <div className="mt-2 h-1.5 rounded-full bg-[var(--is-track)] overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress">
              <div className="h-full rounded-full bg-[var(--color-accent-vibrant)]" style={{ width: `${pct}%`, transition: 'width .3s' }} />
            </div>
          )}
        </div>
        <span className="shrink-0 flex items-center gap-1.5 text-[13px] font-semibold tabular-nums text-[var(--color-accent-vibrant)]">
          {talking && p.voice === 'listening' ? <Mic className="w-5 h-5 animate-pulse" /> : <>{pct !== null && `${pct}%`}<Ring progress={p.head.progress ?? null} done={p.head.done} size={24} /></>}
        </span>
      </div>

      {p.others.length > 0 && (
        <ul className="rounded-[16px] bg-[var(--is-card)] px-3 py-1.5 space-y-0.5" aria-label="Also running">
          {p.others.slice(0, 4).map((a) => (
            <li key={a.id} className="h-7 flex items-center gap-2 text-[12px]">
              {a.agent ? <AgentFace name={a.agent} size={16} mood="thinking" /> : <span className="w-[52px] shrink-0 text-[11px] font-semibold text-[var(--is-muted)] truncate">{wordOf(a)}</span>}
              <span className="flex-1 min-w-0 truncate text-[var(--is-text)]">{a.label}</span>
              <Ring progress={a.progress ?? null} done={a.done} />
            </li>
          ))}
          {p.others.length > 4 && <li className="h-6 text-[11px] text-[var(--is-muted)]">and {p.others.length - 4} more</li>}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <Pill onClick={p.onMenu} title="Quick buttons, now playing, next up and the note box"><LayoutGrid className="w-3.5 h-3.5" />Menu</Pill>
        <span className="flex-1" />
        {p.onStop && !p.head.done && <Pill onClick={p.onStop} title="Stop this run"><Square className="w-3 h-3" fill="currentColor" />Stop</Pill>}
        <Pill primary onClick={() => p.onOpen(talking ? 'voice' : pageOf(p.head))}>Open in Lotus</Pill>
      </div>
    </div>
  );
};
