// Ready-made prompts on an empty page (0.9.6): a row of categories and the prompts' titles (0.10.5:
// titles only). A click puts the whole prompt in the message box; nothing is sent.

import React, { useState } from 'react';
import { cx } from './ui';
import { kv } from '../../lib/store';
import type { StarterGroup } from '../../data/starters';

export const Starters: React.FC<{ groups: StarterGroup[]; onPick: (text: string, group: StarterGroup) => void; id: string; className?: string }> = ({ groups, onPick, id, className }) => {
  const key = `lotus.starters.${id}`;
  const [tab, setTabRaw] = useState(() => { const t = kv.getItem(key); return groups.some((g) => g.id === t) ? t! : groups[0]?.id; });
  const setTab = (t: string) => { setTabRaw(t); try { kv.setItem(key, t); } catch { /* memory only */ } };
  const group = groups.find((g) => g.id === tab) ?? groups[0];
  if (!group) return null;
  return (
    <div className={cx('w-full text-left', className)}>
      <div role="tablist" aria-label="Example prompts" className="flex flex-wrap justify-center gap-1 mb-3">
        {groups.map((g) => (
          <button key={g.id} type="button" role="tab" aria-selected={g.id === group.id} onClick={() => setTab(g.id)}
            className={cx('h-7 px-3 rounded-[8px] text-[12px] font-medium', g.id === group.id ? 'bg-[var(--pressed)] text-[var(--color-text-main)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--hover)] hover:text-[var(--color-text-main)]')}>{g.label}</button>
        ))}
      </div>
      <div role="tabpanel" className="flex flex-wrap justify-center gap-2">
        {group.items.map((s) => (
          <button key={s.title} type="button" onClick={() => onPick(s.text, group)} title={s.text}
            className="h-8 px-3 rounded-[8px] text-[13px] font-medium bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)] hover:shadow-[0_0_0_1px_var(--color-accent-fill)] focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)]">
            {s.title}
          </button>
        ))}
      </div>
    </div>
  );
};
