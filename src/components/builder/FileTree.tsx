import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, File as FileIcon, FilePlus, Folder, FolderPlus, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { Btn, IconBtn, TextInput, cx } from '../common/ui';
import { Modal } from '../common/Modal';
import type { FsEntry } from '../../builder/types';

interface Node { name: string; rel: string; isDir: boolean; children: Node[] }

function build(entries: FsEntry[]): Node[] {
  const root: Node = { name: '', rel: '', isDir: true, children: [] };
  const dirs = new Map<string, Node>([['', root]]);
  for (const e of entries) {
    const parentRel = e.rel.includes('/') ? e.rel.slice(0, e.rel.lastIndexOf('/')) : '';
    const parent = dirs.get(parentRel) ?? root;
    const n: Node = { name: e.name, rel: e.rel, isDir: e.isDir, children: [] };
    parent.children.push(n);
    if (e.isDir) dirs.set(e.rel, n);
  }
  const sort = (n: Node) => { n.children.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1)); n.children.forEach(sort); };
  sort(root);
  return root.children;
}

type Ask = { kind: 'file' | 'folder' | 'rename' | 'delete'; target?: string };

export const FileTree: React.FC<{
  entries: FsEntry[]; truncated: boolean; activePath: string | null; dirty: (p: string) => boolean;
  onOpen: (p: string) => void; onRefresh: () => void;
  onCreateFile: (p: string) => void; onCreateFolder: (p: string) => void; onRename: (from: string, to: string) => void; onDelete: (p: string) => void;
}> = ({ entries, truncated, activePath, dirty, onOpen, onRefresh, onCreateFile, onCreateFolder, onRename, onDelete }) => {
  const nodes = useMemo(() => build(entries), [entries]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !entries.length) return;
    seeded.current = true;
    setOpen(new Set(entries.filter((e) => e.isDir && !e.rel.includes('/')).map((e) => e.rel)));
  }, [entries]);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [text, setText] = useState('');

  const toggle = (rel: string) => setOpen((s) => { const n = new Set(s); if (n.has(rel)) n.delete(rel); else n.add(rel); return n; });
  const parentOf = (p?: string) => (p && p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
  const begin = (a: Ask) => { setAsk(a); setText(a.kind === 'rename' ? a.target ?? '' : a.kind === 'delete' ? '' : parentOf(a.target)); };
  const clean = (v: string) => v.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  const valid = ask?.kind === 'delete' || (!!clean(text) && !clean(text).split('/').some((s) => s === '..' || s === '.' || !s) && !clean(text).includes(':'));

  const confirm = () => {
    if (!ask || !valid) return;
    const v = clean(text);
    if (ask.kind === 'file') onCreateFile(v);
    else if (ask.kind === 'folder') onCreateFolder(v);
    else if (ask.kind === 'rename' && ask.target) onRename(ask.target, v);
    else if (ask.kind === 'delete' && ask.target) onDelete(ask.target);
    setAsk(null);
  };

  const row = (n: Node, depth: number): React.ReactNode => {
    const isOpen = open.has(n.rel);
    const on = activePath === n.rel;
    return (
      <li key={n.rel} role="treeitem" aria-expanded={n.isDir ? isOpen : undefined} aria-selected={on}>
        <div className={cx('group flex items-center h-7 rounded-[6px] pr-1', on ? 'bg-[var(--pressed)]' : 'hover:bg-[var(--hover)]')} style={{ paddingLeft: 6 + depth * 14 }}>
          <button type="button" className="flex-1 min-w-0 h-full flex items-center gap-1.5 text-left text-[13px]" onClick={() => (n.isDir ? toggle(n.rel) : onOpen(n.rel))}>
            {n.isDir ? <ChevronRight className={cx('w-3.5 h-3.5 shrink-0 transition-transform text-[var(--color-text-muted)]', isOpen && 'rotate-90')} /> : <span className="w-3.5 shrink-0" />}
            {n.isDir ? <Folder className="w-3.5 h-3.5 shrink-0 text-[var(--color-accent-vibrant)]" /> : <FileIcon className="w-3.5 h-3.5 shrink-0 text-[var(--color-text-muted)]" />}
            <span className="truncate">{n.name}</span>
            {!n.isDir && dirty(n.rel) && <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent-vibrant)] shrink-0" aria-label="Unsaved changes" />}
          </button>
          <span className="hidden group-hover:flex group-focus-within:flex items-center shrink-0">
            <IconBtn label={`Rename ${n.name}`} className="!w-5 !h-5" onClick={() => begin({ kind: 'rename', target: n.rel })}><Pencil className="w-3 h-3" /></IconBtn>
            <IconBtn label={`Delete ${n.name}`} className="!w-5 !h-5" onClick={() => begin({ kind: 'delete', target: n.rel })}><Trash2 className="w-3 h-3" /></IconBtn>
          </span>
        </div>
        {n.isDir && isOpen && <ul role="group">{n.children.map((c) => row(c, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="h-9 shrink-0 flex items-center gap-0.5 px-2">
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--color-text-muted)] px-1">Files</span>
        <IconBtn label="New file" className="!w-6 !h-6" onClick={() => begin({ kind: 'file', target: activePath ?? undefined })}><FilePlus className="w-3.5 h-3.5" /></IconBtn>
        <IconBtn label="New folder" className="!w-6 !h-6" onClick={() => begin({ kind: 'folder' })}><FolderPlus className="w-3.5 h-3.5" /></IconBtn>
        <IconBtn label="Refresh files" className="!w-6 !h-6" onClick={onRefresh}><RefreshCw className="w-3.5 h-3.5" /></IconBtn>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-1.5 pb-2">
        {nodes.length ? <ul role="tree" aria-label="Project files">{nodes.map((n) => row(n, 0))}</ul> : <p className="px-2 py-3 text-[12px] text-[var(--color-text-muted)]">This folder is empty. Ask the agent to build something, or add a file.</p>}
        {truncated && <p className="px-2 py-2 text-[11px] text-[var(--color-text-muted)]">Only the first files are listed.</p>}
      </div>

      <Modal open={!!ask} onClose={() => setAsk(null)} title={ask?.kind === 'file' ? 'New file' : ask?.kind === 'folder' ? 'New folder' : ask?.kind === 'rename' ? 'Rename' : 'Delete'}
        footer={<><Btn variant="ghost" onClick={() => setAsk(null)}>Cancel</Btn><Btn variant={ask?.kind === 'delete' ? 'danger' : 'primary'} disabled={!valid} onClick={confirm}>{ask?.kind === 'delete' ? 'Delete' : ask?.kind === 'rename' ? 'Rename' : 'Create'}</Btn></>}>
        {ask?.kind === 'delete'
          ? <p className="text-[13px]">Delete <span className="font-mono">{ask.target}</span> from the project folder? This cannot be undone.</p>
          : <>
            <TextInput autoFocus aria-label="Path relative to the project" value={text} className="font-mono" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') confirm(); }} placeholder="src/components/Button.jsx" />
            <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">Relative to the project folder. Folders in the path are created as needed.</p>
          </>}
      </Modal>
    </div>
  );
};
