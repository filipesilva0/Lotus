import React, { useMemo, useState } from 'react';
import { Archive, ArrowUpToLine, Brain, Clock, FileText, MessageSquare, Plus, Search, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { useMemoryStore, memoryStore, queryWords, matchScore } from '../../memory/store';
import { lastSeen, SHORT_TTL_DAYS, TIER_LABEL, tierOf } from '../../memory/layers';
import { MEMORY_CHARS } from '../../memory/recall';
import { tidyMemory, useMemoryTidy } from '../../memory/tidy';
import { useProjectContext } from '../../context/discover';
import { kv } from '../../lib/store';
import { uid } from '../../lib/persist';
import { count } from '../../lib/plural';
import type { MemoryItem, MemoryTier } from '../../types/lotus';
import { Banner, Btn, IconBtn, TextInput, cx } from '../common/ui';
import { offerUndo } from '../common/Alerts';

const ICON: Record<MemoryTier, React.ReactNode> = {
  long: <Archive className="w-4 h-4" />, short: <Clock className="w-4 h-4" />, chat: <MessageSquare className="w-4 h-4" />,
};
const ABOUT: Record<MemoryTier, string> = {
  long: 'Lasting facts about you and your standing rules. Kept until you remove them.',
  short: `What is going on lately. Fades after ${SHORT_TTL_DAYS} days unless it keeps coming up; then it moves to long-term.`,
  chat: 'Notes that belong to one chat. Only that chat sees them, and they go when the chat is deleted.',
};
const LABEL: Record<MemoryTier, string> = { ...TIER_LABEL, chat: 'Chat notes' };

/** Chat titles by id, read from the saved chat list (chat notes are shown under their chat's name). */
function chatTitles(): Map<string, string> {
  try {
    const list = JSON.parse(kv.getItem('lotus.sessions.v1') || '[]') as { id: string; title?: string }[];
    return new Map(list.map((s) => [s.id, s.title || 'Untitled chat']));
  } catch { return new Map(); }
}

const ago = (t: number) => {
  const d = Math.floor((Date.now() - t) / 86_400_000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  return d < 30 ? `${d} days ago` : new Date(t).toLocaleDateString();
};

/**
 * Assistant → Memory (0.22): the three layers (long-term, short-term, chat notes), what each holds, a search
 * across all of them, and the tidy-up. Before 0.22 this was one read-only memory.md view.
 */
export const MemoryPane: React.FC<{ folder?: string }> = ({ folder }) => {
  const mem = useMemoryStore();
  const tidy = useMemoryTidy();
  const project = useProjectContext(folder);
  const [tier, setTier] = useState<MemoryTier>('long');
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState('');
  const titles = useMemo(chatTitles, [mem.memories]);

  const by = useMemo(() => {
    const out: Record<MemoryTier, MemoryItem[]> = { long: [], short: [], chat: [] };
    mem.memories.forEach((m) => out[tierOf(m)].push(m));
    (Object.keys(out) as MemoryTier[]).forEach((t) => out[t].sort((a, b) => lastSeen(b) - lastSeen(a)));
    return out;
  }, [mem.memories]);

  const words = queryWords(q);
  const searching = words.length > 0;
  const shown = searching
    ? mem.memories.map((m) => ({ m, s: matchScore(words, m.text) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.m)
    : by[tier];

  const forget = (m: MemoryItem) => {
    const before = mem.memories;
    void memoryStore.deleteMemory(m.id);
    offerUndo('Memory forgotten', () => void memoryStore.putMemories([before.find((x) => x.id === m.id)!]), () => undefined);
  };
  const add = () => {
    const text = draft.trim();
    if (!text || tier === 'chat') return;
    const now = Date.now();
    void memoryStore.putMemories([{ id: uid('mem'), text, kind: /^(always|never|from now on)\b/i.test(text) ? 'instruction' : 'memory', ts: now, updated: now, source: 'user', uses: 0, tier }]);
    setDraft('');
  };
  const projFiles = project.files.filter((f) => f.kind === 'memory' || f.kind === 'rules');
  const r = tidy.report;

  const row = (m: MemoryItem) => {
    const t = tierOf(m);
    return (
      <li key={m.id} className="group flex items-start gap-3 px-3 py-2.5 rounded-[10px] hover:bg-[var(--hover)]">
        <span className="mt-0.5 text-[var(--color-text-muted)] shrink-0">{m.kind === 'instruction' ? <Wand2 className="w-4 h-4" aria-label="Rule" /> : ICON[t]}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] leading-snug selectable">{m.text}</p>
          <p className="mt-0.5 text-[12px] text-[var(--color-text-muted)] flex flex-wrap gap-x-2">
            {searching && <span className="font-medium">{LABEL[t]}</span>}
            {m.kind === 'instruction' && <span>Rule</span>}
            {m.source === 'auto' ? <span className="inline-flex items-center gap-0.5"><Sparkles className="w-3 h-3" />learned</span> : <span>saved by you</span>}
            {t === 'chat' && searching && <span className="truncate max-w-[260px]">in “{titles.get(m.chatId ?? '') ?? 'a deleted chat'}”</span>}
            <span>{m.uses ? `used ${count(m.uses, 'time')}, last ${ago(lastSeen(m))}` : `added ${ago(m.ts)}`}</span>
          </p>
        </div>
        <div className="flex gap-1 opacity-60 group-hover:opacity-100 group-focus-within:opacity-100">
          {t !== 'long' && <IconBtn label="Keep for good (move to long-term)" className="!w-7 !h-7" onClick={() => void memoryStore.moveTo([m.id], 'long')}><ArrowUpToLine className="w-3.5 h-3.5" /></IconBtn>}
          {t === 'long' && m.kind !== 'instruction' && <IconBtn label="Only for now (move to short-term)" className="!w-7 !h-7" onClick={() => void memoryStore.moveTo([m.id], 'short')}><Clock className="w-3.5 h-3.5" /></IconBtn>}
          <IconBtn label="Forget" className="!w-7 !h-7" onClick={() => forget(m)}><Trash2 className="w-3.5 h-3.5" /></IconBtn>
        </div>
      </li>
    );
  };

  const chatGroups = useMemo(() => {
    const g = new Map<string, MemoryItem[]>();
    by.chat.forEach((m) => { const k = m.chatId ?? ''; g.set(k, [...(g.get(k) ?? []), m]); });
    return [...g.entries()];
  }, [by.chat]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-[860px] mx-auto px-6 py-5">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-[20px] font-semibold flex items-center gap-2"><Brain className="w-5 h-5 text-[var(--color-accent-vibrant)]" />Memory</h2>
            <p className="text-[13px] text-[var(--color-text-muted)] mt-1 leading-relaxed max-w-[620px]">
              Like yours, it has three layers. Before each reply only the memories that fit your message go along (at most about {Math.round(MEMORY_CHARS / 4).toLocaleString()} tokens), and the model can search the rest when it needs to.
            </p>
          </div>
          <Btn size="sm" icon={<Sparkles className="w-3.5 h-3.5" />} loading={tidy.running} onClick={() => void tidyMemory({ liveChats: [...chatTitles().keys()] })}>Tidy now</Btn>
        </div>

        <div role="tablist" aria-label="Memory layers" className="grid grid-cols-3 gap-2.5 mt-4">
          {(['long', 'short', 'chat'] as MemoryTier[]).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={!searching && tier === t} onClick={() => { setTier(t); setQ(''); }}
              className={cx('text-left rounded-[12px] px-3.5 py-3 shadow-[inset_0_0_0_0.5px_var(--sep)] transition-colors focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)]',
                !searching && tier === t ? 'bg-[color-mix(in_srgb,var(--color-accent-fill)_12%,var(--color-bg-card))] shadow-[inset_0_0_0_1.5px_var(--color-accent-fill)]' : 'bg-[var(--color-bg-card)] hover:bg-[var(--hover)]')}>
              <span className="flex items-center gap-2 text-[13px] font-semibold"><span className="text-[var(--color-accent-vibrant)]">{ICON[t]}</span>{LABEL[t]}<span className="ml-auto text-[18px] font-semibold tabular-nums">{by[t].length}</span></span>
              <span className="block mt-1 text-[12px] leading-snug text-[var(--color-text-muted)]">{ABOUT[t]}</span>
            </button>
          ))}
        </div>

        <div className="flex gap-2 mt-4">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" aria-hidden="true" />
            <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search all memory" aria-label="Search all memory" className="!pl-8" />
          </div>
          {tier !== 'chat' && !searching && (
            <form className="flex gap-2 flex-1" onSubmit={(e) => { e.preventDefault(); add(); }}>
              <TextInput value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={tier === 'long' ? 'Add a lasting fact or rule' : 'Add something going on now'} aria-label={`Add to ${LABEL[tier].toLowerCase()} memory`} />
              <Btn size="sm" type="submit" icon={<Plus className="w-3.5 h-3.5" />} disabled={!draft.trim()}>Add</Btn>
            </form>
          )}
        </div>

        {mem.error && <Banner tone="error" className="mt-3">{mem.error}</Banner>}

        <section className="mt-3" aria-label={searching ? 'Search results' : `${LABEL[tier]} memory`}>
          {searching && <p className="px-3 pb-1 text-[12px] text-[var(--color-text-muted)]">{count(shown.length, 'match', 'matches')} across all three layers</p>}
          {!searching && tier === 'chat'
            ? chatGroups.map(([id, list]) => (
              <div key={id} className="mb-2">
                <p className="px-3 pt-2 pb-1 text-[12px] font-semibold text-[var(--color-text-muted)] truncate">{titles.get(id) ?? 'A deleted chat (cleared at the next tidy-up)'}</p>
                <ul>{list.map(row)}</ul>
              </div>
            ))
            : <ul>{shown.map(row)}</ul>}
          {!shown.length && (
            <p className="px-3 py-6 text-[13px] text-[var(--color-text-muted)] text-center">
              {searching ? 'Nothing remembered about that.'
                : tier === 'long' ? 'Nothing yet. Say “remember …” or “from now on …” in a chat, or add one above.'
                  : tier === 'short' ? 'Nothing going on right now. Lotus notes current plans and projects here as you talk.'
                    : 'No chat notes yet. Lotus keeps notes for a chat while you talk in it.'}
            </p>
          )}
        </section>

        <div className="mt-4 pt-3 border-t border-[var(--sep)] text-[12px] text-[var(--color-text-muted)] space-y-1">
          <p>
            {tidy.running ? 'Tidying up…'
              : r ? `Last tidy-up ${ago(r.at)}: ${r.merged || r.promoted || r.faded ? [r.merged && `merged ${count(r.merged, 'duplicate')}`, r.promoted && `kept ${r.promoted} for good`, r.faded && `let ${r.faded} fade`].filter(Boolean).join(', ') : 'nothing needed changing'}.`
                : 'Lotus tidies memory once a day: it merges duplicates, lets old short-term notes fade and keeps what comes up again and again.'}
          </p>
          {mem.status && <p className="break-all" title={mem.status.path}>{count(mem.status.messages, 'past message')} searchable · stored only on this computer{mem.status.native ? ` (${mem.status.path})` : ' (browser preview)'}</p>}
        </div>

        {projFiles.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-[13px] font-medium">From this chat's workspace folder ({projFiles.length})</summary>
            {projFiles.map((f) => (
              <div key={f.rel} className="mt-2">
                <p className="text-[12px] font-semibold flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" />{f.rel}</p>
                <pre className="mt-1 whitespace-pre-wrap break-words text-[12px] font-mono bg-[var(--hover)] rounded-[8px] p-2 max-h-60 overflow-y-auto">{f.content}</pre>
              </div>
            ))}
          </details>
        )}
      </div>
    </div>
  );
};
