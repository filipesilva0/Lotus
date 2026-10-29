import React, { useState } from 'react';
import { Plus, Search, Pin, PinOff, Pencil, Trash2, Folder, FolderPlus, FolderInput, X, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { GenSession } from '../../hooks/useGallery';
import { ChatFolder } from '../../types/lotus';
import { Btn, IconBtn, TextInput, cx } from '../common/ui';
import { MenuItem, Popover, SidebarPane, groupByDate } from '../common/Pane';
import { uid } from '../../lib/persist';

interface Props {
  sessions: GenSession[]; activeId: string; folders: ChatFolder[]; onFolders: (f: ChatFolder[]) => void;
  onSelect: (id: string) => void; onNew: () => void; onDelete: (id: string) => void; onPatch: (id: string, fn: (s: GenSession) => GenSession) => void;
}

export const ImageSidebar: React.FC<Props> = ({ sessions, activeId, folders, onFolders, onSelect, onNew, onDelete, onPatch }) => {
  const [q, setQ] = useState('');
  const [folder, setFolder] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [open, setOpen] = useState(true);
  const needle = q.trim().toLowerCase();
  const list = sessions.filter((s) => s.versions.length > 0 || s.id === activeId)
    .filter((s) => (!folder || s.folderId === folder) && (!needle || s.title.toLowerCase().includes(needle) || s.versions.some((v) => v.prompt.toLowerCase().includes(needle) || String(v.seed) === needle)));
  const pinned = list.filter((s) => s.pinned);
  const groups = groupByDate<GenSession>(list.filter((s) => !s.pinned));

  const commit = (id: string) => { if (draft.trim()) onPatch(id, (s) => ({ ...s, title: draft.trim() })); setRenaming(null); };

  const row = (s: GenSession) => {
    const on = s.id === activeId;
    const thumb = s.versions[s.index]?.url;
    return (
      <div key={s.id} role="button" tabIndex={0} onClick={() => onSelect(s.id)} onKeyDown={(e) => { if (e.key === 'Enter' && renaming !== s.id) onSelect(s.id); }}
        className={cx('group flex items-center gap-2 p-1.5 rounded-[8px] cursor-default', on ? 'bg-[var(--pressed)]' : 'hover:bg-[var(--hover)]')}>
        <span className="w-9 h-9 rounded-[6px] overflow-hidden bg-[var(--hover)] shrink-0 shadow-[0_0_0_0.5px_var(--sep)]">
          {thumb && <img src={thumb} alt="" className="w-full h-full object-cover" />}
        </span>
        <span className="flex-1 min-w-0">
          {renaming === s.id ? (
            <input autoFocus value={draft} aria-label="Generation title" onChange={(e) => setDraft(e.target.value)} onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commit(s.id); if (e.key === 'Escape') setRenaming(null); }} onBlur={() => commit(s.id)}
              className="w-full h-6 px-1.5 rounded-[5px] bg-[var(--color-bg-card)] text-[13px] shadow-[0_0_0_0.5px_var(--sep)] focus:outline-none" />
          ) : (<>
            <span className={cx('block truncate text-[13px]', on ? 'font-medium' : 'text-[var(--color-text-muted)]')}>{s.title}</span>
            <span className="block text-[11px] text-[var(--color-text-muted)]">{s.versions.length} image{s.versions.length === 1 ? '' : 's'}</span>
          </>)}
        </span>
        {renaming !== s.id && (
          <span className="hidden group-hover:flex group-focus-within:flex items-center" onClick={(e) => e.stopPropagation()}>
            <IconBtn label={s.pinned ? 'Unpin' : 'Pin'} className="!w-6 !h-6" onClick={() => onPatch(s.id, (x) => ({ ...x, pinned: !x.pinned }))}>{s.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}</IconBtn>
            <IconBtn label="Rename" className="!w-6 !h-6" onClick={() => { setDraft(s.title); setRenaming(s.id); }}><Pencil className="w-3.5 h-3.5" /></IconBtn>
            <Popover align="right" trigger={(_o, t) => <IconBtn label="Move to project" className="!w-6 !h-6" onClick={t}><FolderInput className="w-3.5 h-3.5" /></IconBtn>}>
              {(close) => (<>
                <MenuItem active={!s.folderId} onClick={() => { onPatch(s.id, (x) => ({ ...x, folderId: undefined })); close(); }}>No project</MenuItem>
                {folders.map((f) => <MenuItem key={f.id} active={s.folderId === f.id} onClick={() => { onPatch(s.id, (x) => ({ ...x, folderId: f.id })); close(); }}>{f.name}</MenuItem>)}
              </>)}
            </Popover>
            <IconBtn label="Delete generation" className="!w-6 !h-6 hover:!text-[var(--c-red)]" onClick={() => onDelete(s.id)}><Trash2 className="w-3.5 h-3.5" /></IconBtn>
          </span>
        )}
      </div>
    );
  };

  return (
    <SidebarPane label="Gallery">
      <div className="p-3 space-y-2">
        <Btn variant="primary" className="w-full" icon={<Plus className="w-3.5 h-3.5" />} onClick={onNew}>New generation</Btn>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-muted)]" aria-hidden="true" />
          <input type="search" aria-label="Search prompts, seeds and titles" placeholder="Search prompts" value={q} onChange={(e) => setQ(e.target.value)}
            className="w-full h-7 pl-8 pr-2 rounded-[6px] bg-[var(--hover)] text-[13px] placeholder:text-[var(--color-text-muted)] focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)]" />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3 space-y-3">
        <div>
          <div className="flex items-center justify-between px-1.5 mb-1">
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--color-text-muted)]">{open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}Projects</button>
            <IconBtn label="New project" className="!w-6 !h-6" onClick={() => { setOpen(true); setAdding(true); }}><FolderPlus className="w-3.5 h-3.5" /></IconBtn>
          </div>
          {open && (
            <div className="space-y-0.5">
              {adding && (
                <div className="flex items-center gap-1 px-1">
                  <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" aria-label="Project name" className="!h-7"
                    onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { onFolders([...folders, { id: uid('fld'), name: name.trim() }]); setName(''); setAdding(false); } if (e.key === 'Escape') setAdding(false); }} />
                  <IconBtn label="Cancel" onClick={() => setAdding(false)}><X className="w-3.5 h-3.5" /></IconBtn>
                </div>
              )}
              {folders.map((f) => (
                <div key={f.id} role="button" tabIndex={0} aria-pressed={folder === f.id} onClick={() => setFolder(folder === f.id ? null : f.id)} onKeyDown={(e) => { if (e.key === 'Enter') setFolder(folder === f.id ? null : f.id); }}
                  className={cx('group flex items-center gap-2 px-2.5 h-8 rounded-[8px] text-[13px] cursor-default', folder === f.id ? 'bg-[var(--pressed)] font-medium' : 'text-[var(--color-text-muted)] hover:bg-[var(--hover)]')}>
                  <Folder className="w-3.5 h-3.5" /><span className="flex-1 truncate">{f.name}</span>
                  <IconBtn label={`Delete project ${f.name}`} className="!w-5 !h-5 hidden group-hover:inline-flex" onClick={(e) => { e.stopPropagation(); onFolders(folders.filter((x) => x.id !== f.id)); if (folder === f.id) setFolder(null); }}><X className="w-3 h-3" /></IconBtn>
                </div>
              ))}
            </div>
          )}
        </div>
        {pinned.length > 0 && <div><h3 className="px-1.5 mb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--color-text-muted)]">Pinned</h3><div className="space-y-0.5">{pinned.map(row)}</div></div>}
        {groups.map((g) => <div key={g.label}><h3 className="px-1.5 mb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--color-text-muted)]">{g.label}</h3><div className="space-y-0.5">{g.items.map(row)}</div></div>)}
        {!list.length && <p className="px-2.5 py-3 text-[13px] text-[var(--color-text-muted)]">{needle ? 'Nothing matches that search.' : 'Your generations will appear here.'}</p>}
      </div>
    </SidebarPane>
  );
};
