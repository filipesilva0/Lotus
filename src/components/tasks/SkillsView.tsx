import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, Plus, Sparkles, Trash2, User } from 'lucide-react';
import { memoryStore, Skill, useMemoryStore } from '../../memory/store';
import { uid } from '../../lib/persist';
import { MarkdownLite } from '../../lib/markdownLite';
import { LotusSettings } from '../../types/lotus';
import { InspectorPane, PaneBar, Section, SidebarPane } from '../common/Pane';
import { Toggle } from '../common/Toggle';
import { Banner, Btn, Empty, IconBtn, Label, Segmented, TextArea, TextInput, cx } from '../common/ui';

const TEMPLATE = `## Steps
1.

## Pitfalls
-

## Check that it worked
- `;

const Editor: React.FC<{ s: Skill }> = ({ s }) => {
  const [d, setD] = useState(s);
  const [view, setView] = useState<'read' | 'edit'>('read');
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => { setD(s); }, [s.id, s.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = d.name !== s.name || d.description !== s.description || d.whenToUse !== s.whenToUse || d.body !== s.body || d.tags.join() !== s.tags.join();
  const save = async () => {
    const now = Date.now();
    const p = await memoryStore.putSkill({ ...d, name: d.name.trim() || 'Untitled skill', origin: 'user', version: s.version + 1, updated: now, history: [...(s.history ?? []), { at: now, note: 'Edited by you' }] });
    if (p) setPath(p);
    setView('read');
  };
  return (
    <InspectorPane label="Skill" className="!w-auto flex-1 !border-l-0">
      <PaneBar>
        <BookOpen className="w-4 h-4 text-[var(--color-accent-vibrant)]" aria-hidden="true" />
        <span className="text-[13px] font-semibold flex-1 truncate">{s.name}</span>
        <span className="text-[12px] text-[var(--color-text-muted)]">{s.enabled ? 'In use' : 'Off'}</span>
        <Toggle size="sm" checked={s.enabled} onChange={(v) => void memoryStore.putSkill({ ...s, enabled: v })} ariaLabel={s.enabled ? 'Skill on' : 'Skill off'} />
        <Segmented<'read' | 'edit'> label="Mode" value={view} onChange={setView} options={[{ id: 'read', label: 'Read' }, { id: 'edit', label: 'Edit' }]} />
        <IconBtn label="Delete skill" onClick={() => void memoryStore.deleteSkill(s.id)}><Trash2 className="w-4 h-4" /></IconBtn>
      </PaneBar>
      <div className="flex-1 overflow-y-auto">
        {view === 'read' ? (
          <div className="px-5 py-4 max-w-[760px]">
            <p className="text-[14px]">{s.description}</p>
            <p className="mt-1 text-[13px] text-[var(--color-text-muted)]"><span className="font-medium">Use when:</span> {s.whenToUse}</p>
            <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">Version {s.version} · used {s.uses}× · worked {s.wins}× · {s.origin === 'auto' ? 'written by Lotus' : 'edited by you'}{s.tags.length ? ` · ${s.tags.join(', ')}` : ''}</p>
            <div className="mt-4 text-[14px] leading-relaxed"><MarkdownLite text={s.body} onDark={false} /></div>
            {path && <p className="mt-4 text-[12px] text-[var(--color-text-muted)]">Saved to {path}</p>}
          </div>
        ) : (
          <div className="px-5 py-4 max-w-[760px] space-y-2.5">
            <div><Label>Name</Label><TextInput value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} aria-label="Skill name" /></div>
            <div><Label>What it does</Label><TextInput value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} aria-label="Description" /></div>
            <div><Label>Use when</Label><TextInput value={d.whenToUse} onChange={(e) => setD({ ...d, whenToUse: e.target.value })} aria-label="When to use" placeholder="The kind of request that should bring this skill in" /></div>
            <div><Label>Tags</Label><TextInput value={d.tags.join(', ')} onChange={(e) => setD({ ...d, tags: e.target.value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 6) })} aria-label="Tags" /></div>
            <div><Label hint="Markdown">Procedure</Label><TextArea rows={16} value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} aria-label="Procedure" className="font-mono !text-[12px]" /></div>
            <div className="flex justify-end gap-2"><Btn onClick={() => { setD(s); setView('read'); }}>Cancel</Btn><Btn variant="primary" disabled={!dirty || d.body.trim().length < 20} onClick={() => void save()}>Save</Btn></div>
          </div>
        )}
        {!!s.history?.length && (
          <Section title="Changes">
            <ol className="space-y-0.5">{[...s.history].reverse().map((h) => <li key={h.at} className="text-[12px]"><span className="tabular-nums text-[var(--color-text-muted)]">{new Date(h.at).toLocaleDateString()}</span> · {h.note}</li>)}</ol>
          </Section>
        )}
      </div>
    </InspectorPane>
  );
};

export const SkillsView: React.FC<{ settings: LotusSettings; onSettings: (p: Partial<LotusSettings>) => void }> = ({ settings, onSettings }) => {
  const { skills, status, error } = useMemoryStore();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const list = useMemo(() => {
    const l = q ? skills.filter((s) => `${s.name} ${s.description} ${s.whenToUse} ${s.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase())) : skills;
    return [...l].sort((a, b) => b.updated - a.updated);
  }, [skills, q]);
  const cur = skills.find((s) => s.id === sel) ?? list[0];
  const create = () => {
    const now = Date.now();
    const s: Skill = { id: uid('skill'), name: 'New skill', description: '', whenToUse: '', body: TEMPLATE, tags: [], version: 1, uses: 0, wins: 0, enabled: true, origin: 'user', created: now, updated: now, history: [{ at: now, note: 'Written by you' }] };
    void memoryStore.putSkill(s); setSel(s.id);
  };
  return (
    <div className="flex-1 min-h-0 flex">
      <SidebarPane label="Skills" className="!w-[280px]">
        <PaneBar><span className="text-[13px] font-semibold flex-1">Skills</span><IconBtn label="New skill" onClick={create}><Plus className="w-4 h-4" /></IconBtn></PaneBar>
        <div className="px-3 pt-2.5 pb-2 border-b border-[var(--sep)]">
          <label className="flex items-center justify-between gap-2 text-[12px]"><span>Write and improve skills automatically</span><Toggle size="sm" checked={settings.autoSkills} onChange={(v) => onSettings({ autoSkills: v })} ariaLabel="Write skills automatically" /></label>
          <p className="mt-1 text-[11px] text-[var(--color-text-muted)] leading-snug">After a complex chat or a finished task, Lotus writes the procedure down; when a skill helps or gets corrected, it updates it. Skills stay on this PC.</p>
          {skills.length > 5 && <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter skills" aria-label="Filter skills" className="mt-2" />}
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {list.map((s) => (
            <button key={s.id} type="button" onClick={() => setSel(s.id)} aria-current={cur?.id === s.id ? 'true' : undefined}
              className={cx('w-full text-left px-2.5 py-2 rounded-[8px]', cur?.id === s.id ? 'bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep),var(--shadow-1)]' : 'hover:bg-[var(--hover)]', !s.enabled && 'opacity-60')}>
              <span className="flex items-center gap-1.5">
                {s.origin === 'auto' ? <Sparkles className="w-3.5 h-3.5 shrink-0 text-[var(--color-accent-vibrant)]" aria-label="Written by Lotus" /> : <User className="w-3.5 h-3.5 shrink-0 text-[var(--color-text-muted)]" aria-label="Edited by you" />}
                <span className="text-[13px] font-medium truncate flex-1">{s.name}</span>
                <span className="text-[11px] tabular-nums text-[var(--color-text-muted)]">v{s.version}</span>
              </span>
              <span className="block pl-5 text-[11px] text-[var(--color-text-muted)] truncate">{s.whenToUse || s.description || 'No description'}</span>
            </button>
          ))}
        </div>
        {status && <p className="px-3 py-2 border-t border-[var(--sep)] text-[11px] text-[var(--color-text-muted)]">{status.native ? `${status.skills} skills · ${status.fts5 ? 'full-text search' : 'simple search'}` : 'Browser preview: stored in this browser'}</p>}
      </SidebarPane>
      <div className="flex-1 min-w-0 flex flex-col">
        {error && <div className="p-3"><Banner tone="error" action={<Btn size="sm" onClick={memoryStore.clearError}>Dismiss</Btn>}>{error}</Banner></div>}
        {cur ? <Editor key={cur.id} s={cur} /> : (
          <div className="flex-1 flex">
            <Empty icon={<BookOpen className="w-5 h-5" />} className="flex-1" title="No skills yet"
              body="Skills are procedures Lotus writes for itself after it finishes something complex, so it does it better next time. They appear here; you can read, edit, switch off or delete any of them."
              action={<Btn icon={<Plus className="w-3.5 h-3.5" />} onClick={create}>Write one yourself</Btn>} />
          </div>
        )}
      </div>
    </div>
  );
};
