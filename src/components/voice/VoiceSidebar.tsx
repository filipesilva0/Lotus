import React, { useEffect, useState } from 'react';
import { AudioLines, Film, Library, Mic, Mic2, Plus, Search } from 'lucide-react';
import { voicebox, Capture, Generation, Story, VoiceProfile } from '../../services/voicebox';
import { VoiceData } from './useVoiceData';
import { Btn, cx } from '../common/ui';
import { SidebarPane, groupByDate } from '../common/Pane';

export type VoiceMode = 'voices' | 'speak' | 'dictate' | 'stories' | 'library';

export const MODES: { id: VoiceMode; label: string; icon: React.ReactNode; newLabel: string }[] = [
  { id: 'voices', label: 'Voice profiles', icon: <Mic2 className="w-4 h-4" />, newLabel: 'Clone voice' },
  { id: 'speak', label: 'Speech generator', icon: <AudioLines className="w-4 h-4" />, newLabel: 'New speech script' },
  { id: 'dictate', label: 'Captures', icon: <Mic className="w-4 h-4" />, newLabel: 'New dictation' },
  { id: 'stories', label: 'Multi-track stories', icon: <Film className="w-4 h-4" />, newLabel: 'New story' },
  { id: 'library', label: 'History', icon: <Library className="w-4 h-4" />, newLabel: 'New speech script' },
];

interface Props {
  mode: VoiceMode; onMode: (m: VoiceMode) => void; data: VoiceData; online: boolean;
  profile: VoiceProfile | null; onSelectProfile: (id: string) => void;
  onNew: () => void; onReuse: (g: Generation) => void;
}

export const VoiceSidebar: React.FC<Props> = ({ mode, onMode, data, online, profile, onSelectProfile, onNew, onReuse }) => {
  const [q, setQ] = useState('');
  const [gens, setGens] = useState<Generation[]>([]);
  const [caps, setCaps] = useState<Capture[]>([]);
  const [stories, setStories] = useState<Story[]>([]);

  useEffect(() => {
    if (!online) return;
    let off = false;
    const load = async () => {
      try {
        if (mode === 'speak' || mode === 'library') { const r = await voicebox.history({ limit: 40, search: q.trim() || undefined }); if (!off) setGens(r.items ?? []); }
        if (mode === 'dictate') { const r = await voicebox.listCaptures(40); if (!off) setCaps(r.items ?? []); }
        if (mode === 'stories') { const r = await voicebox.listStories(); if (!off) setStories(r); }
      } catch { /* the canvas shows connection problems */ }
    };
    void load(); const t = setInterval(load, 8000);
    return () => { off = true; clearInterval(t); };
  }, [mode, online, q]);

  const needle = q.trim().toLowerCase();
  const cur = MODES.find((m) => m.id === mode)!;
  const ts = (iso: string) => new Date(iso).getTime() || 0;

  const item = (key: string, title: string, sub: string, active: boolean, onClick?: () => void) => (
    <button key={key} type="button" onClick={onClick} disabled={!onClick} className={cx('w-full text-left px-2.5 py-1.5 rounded-[8px]', active ? 'bg-[var(--pressed)]' : 'hover:bg-[var(--hover)] disabled:hover:bg-transparent')}>
      <span className={cx('block text-[13px] truncate', active && 'font-medium')}>{title}</span><span className="block text-[11px] text-[var(--color-text-muted)] truncate">{sub}</span>
    </button>
  );

  const grouped = <T extends { created_at: string }>(list: T[], render: (x: T) => React.ReactNode) =>
    groupByDate<T & { ts: number }>(list.map((x) => ({ ...x, ts: ts(x.created_at) }))).map((g) => (
      <div key={g.label} className="mb-3"><h3 className="px-1.5 mb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--color-text-muted)]">{g.label}</h3>{g.items.map(render)}</div>
    ));

  return (
    <SidebarPane label="Voice studio">
      <div className="p-3 space-y-2">
        <Btn variant="primary" className="w-full" icon={<Plus className="w-3.5 h-3.5" />} onClick={onNew} disabled={!online}>{cur.newLabel}</Btn>
        <div className="relative"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-muted)]" aria-hidden="true" />
          <input type="search" aria-label="Filter the list" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} className="w-full h-7 pl-8 pr-2 rounded-[6px] bg-[var(--hover)] text-[13px] placeholder:text-[var(--color-text-muted)] focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)]" /></div>
      </div>
      <nav className="px-2 space-y-0.5" aria-label="Studio modes">
        {MODES.map((m) => <button key={m.id} type="button" aria-current={mode === m.id ? 'page' : undefined} onClick={() => onMode(m.id)}
          className={cx('w-full h-9 px-2.5 flex items-center gap-2.5 rounded-[8px] text-[13px] text-left', mode === m.id ? 'bg-[var(--pressed)] font-medium' : 'text-[var(--color-text-muted)] hover:bg-[var(--hover)] hover:text-[var(--color-text-main)]')}>{m.icon}{m.label}</button>)}
      </nav>
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-3 border-t border-[var(--sep)] mt-2">
        {!online && <p className="px-2.5 text-[12px] text-[var(--color-text-muted)]">Start Voicebox to see your library.</p>}
        {online && mode === 'voices' && (<>
          {data.profiles.filter((p) => !needle || p.name.toLowerCase().includes(needle)).map((p) => item(p.id, p.name, `${p.voice_type === 'cloned' ? 'Clone' : p.voice_type === 'preset' ? 'Built-in' : 'Described'} · ${p.language}`, profile?.id === p.id, () => onSelectProfile(p.id)))}
          {!data.profiles.length && <p className="px-2.5 text-[12px] text-[var(--color-text-muted)]">No voices yet.</p>}
        </>)}
        {online && (mode === 'speak' || mode === 'library') && grouped(gens, (g) => item(g.id, g.text.slice(0, 60), `${data.profiles.find((p) => p.id === g.profile_id)?.name ?? 'Voice'} · ${g.status}`, false, () => onReuse(g)))}
        {online && mode === 'dictate' && grouped(caps.filter((c) => !needle || (c.transcript_refined || c.transcript_raw || '').toLowerCase().includes(needle)), (c) => item(c.id, (c.transcript_refined || c.transcript_raw || 'Empty capture').slice(0, 60), new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), false))}
        {online && mode === 'stories' && stories.filter((s) => !needle || s.name.toLowerCase().includes(needle)).map((s) => item(s.id, s.name, `${s.item_count ?? 0} clips`, false))}
      </div>
    </SidebarPane>
  );
};
