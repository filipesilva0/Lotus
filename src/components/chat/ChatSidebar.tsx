import React, { useState } from 'react';
import { Plus, Search, Pin, PinOff, Pencil, Trash2, Folder, FolderPlus, FolderInput, EyeOff, Check, X, ChevronDown, ChevronRight } from 'lucide-react';
import { ChatFolder, ChatSession } from '../../types/lotus';
import { Btn, IconBtn, TextInput, cx } from '../common/ui';
import { MenuItem, Popover, SidebarPane, groupByDate } from '../common/Pane';
import { uid } from '../../lib/persist';

interface Props {
  sessions: ChatSession[]; activeId: string; folders: ChatFolder[];
  onFolders: (f: ChatFolder[]) => void;
  onSelect: (id: string) => void; onNew: () => void; onDelete: (id: string) => void;
  onPatch: (id: string, fn: (s: ChatSession) => ChatSession) => void;
}

export const ChatSidebar: React.FC<Props> = ({ sessions, activeId, folders, onFolders, onSelect, onNew, onDelete, onPatch }) => {
  const [q, setQ] = useState('');
  const [folder, setFolder] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [addingFolder, setAddingFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [foldersOpen, setFoldersOpen] = useState(true);

  const needle = q.trim().toLowerCase();
  const visible = sessions.filter((s) =>
    (!folder || s.folderId === folder) &&
    (!needle || s.title.toLowerCase().includes(needle) || s.messages.some((m) => m.content.toLowerCase().includes(needle))));
  const pinned = visible.filter((s) => s.pinned);
  const groups = groupByDate<ChatSession>(visible.filter((s) => !s.pinned));

  const commitRename = (id: string) => { if (draft.trim()) onPatch(id, (s) => ({ ...s, title: draft.trim() })); setRenaming(null); };
  const addFolder = () => {
    if (folderName.trim()) onFolders([...folders, { id: uid('fld'), name: folderName.trim() }]);
    setFolderName(''); setAddingFolder(false);
  };

  const row = (s: ChatSession) => {
    const on = s.id === activeId;
    return (
      <div key={s.id} onClick={() => onSelect(s.id)} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' && renaming !== s.id) onSelect(s.id); }}
        className={cx('group relative flex items-center gap-2 px-2.5 h-9 rounded-[8px] cursor-default',
          on ? 'bg-[var(--pressed)] font-medium' : 'text-[var(--color-text-muted)] hover:bg-[var(--hover)] hover:text-[var(--color-text-main)]')}>
        {s.incognito && <EyeOff className="w-3.5 h-3.5 shrink-0" aria-label="Incognito" />}
        {renaming === s.id ? (
          <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commitRename(s.id); if (e.key === 'Escape') setRenaming(null); }}
            onBlur={() => commitRename(s.id)} aria-label="Conversation title"
            className="flex-1 min-w-0 h-6 px-1.5 rounded-[5px] bg-[var(--color-bg-card)] text-[13px] text-[var(--color-text-main)] shadow-[0_0_0_0.5px_var(--sep)] focus:outline-none" />
        ) : (
          <span className="flex-1 min-w-0 truncate text-[13px]">{s.title}</span>
        )}
        {renaming !== s.id && (
          <span className="hidden group-hover:flex group-focus-within:flex items-center shrink-0" onClick={(e) => e.stopPropagation()}>
            <IconBtn label={s.pinned ? 'Unpin' : 'Pin'} className="!w-6 !h-6" onClick={() => onPatch(s.id, (x) => ({ ...x, pinned: !x.pinned }))}>{s.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}</IconBtn>
            <IconBtn label="Rename" className="!w-6 !h-6" onClick={() => { setDraft(s.title); setRenaming(s.id); }}><Pencil className="w-3.5 h-3.5" /></IconBtn>
            <Popover align="right" trigger={(_o, t) => <IconBtn label="Move to project" className="!w-6 !h-6" onClick={t}><FolderInput className="w-3.5 h-3.5" /></IconBtn>}>
              {(close) => (<>
                <MenuItem active={!s.folderId} onClick={() => { onPatch(s.id, (x) => ({ ...x, folderId: undefined })); close(); }}>No project</MenuItem>
                {folders.map((f) => <MenuItem key={f.id} active={s.folderId === f.id} onClick={() => { onPatch(s.id, (x) => ({ ...x, folderId: f.id })); close(); }}>{f.name}</MenuItem>)}
                {!folders.length && <p className="px-2.5 py-1.5 text-[12px] text-[var(--color-text-muted)]">Create a project first.</p>}
              </>)}
            </Popover>
            <IconBtn label="Delete conversation" className="!w-6 !h-6 hover:!text-[var(--c-red)]" onClick={() => onDelete(s.id)}><Trash2 className="w-3.5 h-3.5" /></IconBtn>
          </span>
        )}
        {s.pinned && renaming !== s.id && <Pin className="w-3 h-3 shrink-0 group-hover:hidden opacity-60" aria-hidden="true" />}
      </div>
    );
  };

  return (
    <SidebarPane label="Conversations">
      <div className="p-3 space-y-2">
        <Btn variant="primary" className="w-full" icon={<Plus className="w-3.5 h-3.5" />} onClick={onNew}>New chat</Btn>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-muted)]" aria-hidden="true" />
          <input type="search" aria-label="Search conversations" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)}
            className="w-full h-7 pl-8 pr-2 rounded-[6px] bg-[var(--hover)] text-[13px] placeholder:text-[var(--color-text-muted)] focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)]" />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3 space-y-3">
        <div>
          <div className="flex items-center justify-between px-1.5 mb-1">
            <button type="button" onClick={() => setFoldersOpen((o) => !o)} className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--color-text-muted)]" aria-expanded={foldersOpen}>
              {foldersOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}Projects
            </button>
            <IconBtn label="New project" className="!w-6 !h-6" onClick={() => { setFoldersOpen(true); setAddingFolder(true); }}><FolderPlus className="w-3.5 h-3.5" /></IconBtn>
          </div>
          {foldersOpen && (
            <div className="space-y-0.5">
              {addingFolder && (
                <div className="flex items-center gap-1 px-1">
                  <TextInput autoFocus value={folderName} onChange={(e) => setFolderName(e.target.value)} placeholder="Project name" aria-label="Project name"
                    onKeyDown={(e) => { if (e.key === 'Enter') addFolder(); if (e.key === 'Escape') setAddingFolder(false); }} className="!h-7" />
                  <IconBtn label="Create" onClick={addFolder}><Check className="w-3.5 h-3.5" /></IconBtn>
                  <IconBtn label="Cancel" onClick={() => setAddingFolder(false)}><X className="w-3.5 h-3.5" /></IconBtn>
                </div>
              )}
              {folders.map((f) => (
                <div key={f.id} className={cx('group flex items-center gap-2 px-2.5 h-8 rounded-[8px] text-[13px] cursor-default', folder === f.id ? 'bg-[var(--pressed)] font-medium' : 'text-[var(--color-text-muted)] hover:bg-[var(--hover)]')}
                  onClick={() => setFolder(folder === f.id ? null : f.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setFolder(folder === f.id ? null : f.id); }} aria-pressed={folder === f.id}>
                  <Folder className="w-3.5 h-3.5 shrink-0" />
                  <span className="flex-1 truncate">{f.name}</span>
                  <span className="text-[11px] tabular-nums">{sessions.filter((s) => s.folderId === f.id).length}</span>
                  <IconBtn label={`Delete project ${f.name}`} className="!w-5 !h-5 hidden group-hover:inline-flex" onClick={(e) => {
                    e.stopPropagation(); onFolders(folders.filter((x) => x.id !== f.id));
                    sessions.filter((s) => s.folderId === f.id).forEach((s) => onPatch(s.id, (x) => ({ ...x, folderId: undefined })));
                    if (folder === f.id) setFolder(null);
                  }}><X className="w-3 h-3" /></IconBtn>
                </div>
              ))}
              {!folders.length && !addingFolder && <p className="px-2.5 text-[12px] text-[var(--color-text-muted)]">Group related chats into projects.</p>}
            </div>
          )}
        </div>

        {pinned.length > 0 && (
          <div><h3 className="px-1.5 mb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--color-text-muted)]">Pinned</h3><div className="space-y-0.5">{pinned.map(row)}</div></div>
        )}
        {groups.map((g) => (
          <div key={g.label}><h3 className="px-1.5 mb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--color-text-muted)]">{g.label}</h3><div className="space-y-0.5">{g.items.map(row)}</div></div>
        ))}
        {!visible.length && <p className="px-2.5 py-3 text-[13px] text-[var(--color-text-muted)]">{needle ? `No conversations match “${q.trim()}”.` : 'No conversations here yet.'}</p>}
      </div>
    </SidebarPane>
  );
};
