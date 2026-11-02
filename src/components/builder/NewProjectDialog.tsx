import React, { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Banner, Btn, Label, TextInput, cx } from '../common/ui';
import { TEMPLATES, slugify } from '../../builder/templates';
import type { TargetId } from '../../builder/types';
import { isTauri } from '../../lib/http';

export const NewProjectDialog: React.FC<{
  open: boolean; onClose: () => void; busy: boolean; error: string | null; defaultParent: () => Promise<string>;
  onCreate: (o: { name: string; target: TargetId; parent?: string }) => Promise<boolean>; onOpenFolder: () => void;
}> = ({ open, onClose, busy, error, defaultParent, onCreate, onOpenFolder }) => {
  const [name, setName] = useState('');
  const [target, setTarget] = useState<TargetId>('website');
  const [parent, setParent] = useState('');
  const [defParent, setDefParent] = useState('');

  useEffect(() => { if (open) { setName(''); void defaultParent().then(setDefParent); setParent(''); } }, [open, defaultParent]);

  const browse = async () => {
    if (!isTauri) return;
    const { open: pick } = await import('@tauri-apps/plugin-dialog');
    const p = await pick({ title: 'Where should the project folder go?', directory: true, multiple: false });
    if (typeof p === 'string') setParent(p);
  };
  const where = parent || defParent;
  const sep = where.includes('\\') ? '\\' : '/';
  const ok = !!name.trim() && !!where;
  const create = async () => { if (ok && (await onCreate({ name: name.trim(), target, parent: parent || undefined }))) onClose(); };

  return (
    <Modal open={open} onClose={onClose} title="New project" wide
      footer={<><Btn variant="ghost" onClick={onOpenFolder} className="mr-auto">Open an Existing Folder…</Btn><Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" loading={busy} disabled={!ok} onClick={() => void create()}>Create Project</Btn></>}>
      {error && <Banner tone="error" className="mb-3">{error}</Banner>}
      <Label>Name</Label>
      <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void create(); }} aria-label="Project name" placeholder="My app" maxLength={60} />
      <div className="mt-4"><Label>What are you building?</Label></div>
      <div role="radiogroup" aria-label="Project type" className="grid grid-cols-2 gap-2">
        {TEMPLATES.map((t) => {
          const on = target === t.id;
          return (
            <button key={t.id} type="button" role="radio" aria-checked={on} onClick={() => setTarget(t.id)}
              className={cx('text-left p-3 rounded-[10px] border transition-colors', on ? 'border-[var(--color-accent-vibrant)] bg-[var(--color-accent-pastel)]' : 'border-[var(--sep)] hover:bg-[var(--hover)]')}>
              <span className="flex items-center gap-1.5 text-[13px] font-semibold">{t.title}{on && <Check className="w-3.5 h-3.5 text-[var(--color-accent-vibrant)]" />}</span>
              <span className="mt-0.5 block text-[12px] text-[var(--color-text-muted)]">{t.platforms.join(' · ')}</span>
              <span className="mt-1 block text-[12px] text-[var(--color-text-muted)] leading-snug">{t.blurb}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-4 text-[12px] text-[var(--color-text-muted)]">
        Saved in: <span className="font-mono text-[var(--color-text-main)] break-all">{where ? `${where.replace(/[\\/]+$/, '')}${sep}${slugify(name || 'my-app')}` : '…'}</span>
        <button type="button" className="ml-2 font-medium text-[var(--color-accent-vibrant)] hover:underline" onClick={() => void browse()}>Change…</button>
      </div>
    </Modal>
  );
};
