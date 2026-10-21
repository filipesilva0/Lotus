import React, { useMemo, useRef, useState } from 'react';
import { Plus, Search, Upload, MoreHorizontal, Pencil, Download, Trash2, Mic2, Wand2, Sparkles } from 'lucide-react';
import { voicebox, VoiceProfile, engineLabel } from '../../services/voicebox';
import { downloadBlob } from '../../lib/audio';
import { Btn, Card, TextInput, Empty, Banner, Spinner, IconBtn, cx } from '../common/ui';
import { Modal } from '../common/Modal';
import { Avatar } from './SpeakTab';
import { VoiceData } from './useVoiceData';
import { VoiceEditor } from './VoiceEditor';

const TYPE_LABEL: Record<string, { label: string; icon: React.ReactNode }> = {
  cloned: { label: 'Cloned', icon: <Mic2 className="w-3 h-3" /> },
  preset: { label: 'Built-in', icon: <Sparkles className="w-3 h-3" /> },
  designed: { label: 'Described', icon: <Wand2 className="w-3 h-3" /> },
};

export const VoicesTab: React.FC<{
  data: VoiceData;
  selectedId: string | null;
  onUse: (id: string) => void;
  openCreate: boolean;
  onCreateHandled: () => void;
}> = ({ data, selectedId, onUse, openCreate, onCreateHandled }) => {
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<VoiceProfile | null>(null);
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<VoiceProfile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (openCreate) { setCreating(true); onCreateHandled(); }
  }, [openCreate, onCreateHandled]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? data.profiles.filter((p) => `${p.name} ${p.description ?? ''}`.toLowerCase().includes(s)) : data.profiles;
  }, [q, data.profiles]);

  const doExport = async (p: VoiceProfile) => {
    setMenu(null);
    try { downloadBlob(await voicebox.exportProfile(p.id), `${p.name}.zip`); } catch (e) { setErr((e as Error).message); }
  };
  const doImport = async (f: File) => {
    setErr(null);
    try { await voicebox.importProfile(f); await data.refreshProfiles(); } catch (e) { setErr((e as Error).message); }
  };
  const doDelete = async () => {
    if (!toDelete) return;
    setBusy(true);
    try { await voicebox.deleteProfile(toDelete.id); await data.refreshProfiles(); setToDelete(null); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
          <TextInput aria-label="Search voices" placeholder="Search voices" value={q} onChange={(e) => setQ(e.target.value)} className="!pl-9" />
        </div>
        <div className="flex-1" />
        <Btn variant="ghost" icon={<Upload className="w-3.5 h-3.5" />} onClick={() => importRef.current?.click()}>Import</Btn>
        <input ref={importRef} type="file" accept=".zip" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void doImport(f); e.target.value = ''; }} />
        <Btn variant="primary" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setCreating(true)}>New voice</Btn>
      </div>

      {err && <Banner tone="error">{err}</Banner>}

      {data.profilesLoading ? (
        <div className="flex justify-center py-16"><Spinner className="w-5 h-5 text-[var(--color-accent-vibrant)]" /></div>
      ) : data.profiles.length === 0 ? (
        <Empty icon={<Mic2 className="w-5 h-5" />} title="No voices yet"
          body="Clone a voice from a short recording, choose a built-in voice, or describe the voice you want."
          action={<Btn variant="primary" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setCreating(true)}>New voice</Btn>} />
      ) : list.length === 0 ? (
        <Empty title="No voices match" body={`Nothing found for “${q}”.`} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {list.map((p) => {
            const t = TYPE_LABEL[p.voice_type] ?? TYPE_LABEL.cloned;
            return (
              <Card key={p.id} className={cx('p-4 relative transition-colors', selectedId === p.id && 'border-[var(--color-accent-vibrant)]')}>
                <div className="flex items-start gap-3">
                  <Avatar name={p.name} size={40} />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold truncate text-[#111827] dark:text-white">{p.name}</h3>
                    <p className="text-[11px] text-[#6B7280] dark:text-slate-400 flex items-center gap-1.5 mt-0.5">
                      {t.icon}{t.label}<span aria-hidden>·</span>{p.language.toUpperCase()}
                      {p.default_engine && <><span aria-hidden>·</span>{engineLabel(p.default_engine)}</>}
                    </p>
                  </div>
                  <div className="relative">
                    <IconBtn label="More actions" onClick={() => setMenu(menu === p.id ? null : p.id)}><MoreHorizontal className="w-4 h-4" /></IconBtn>
                    {menu === p.id && (
                      <div className="absolute right-0 top-9 z-10 w-36 rounded-[12px] border border-[#EBECEF] dark:border-[#2C2F38] bg-white dark:bg-[#22242B] shadow-lg py-1" onMouseLeave={() => setMenu(null)}>
                        {[
                          { l: 'Edit', i: <Pencil className="w-3.5 h-3.5" />, f: () => { setMenu(null); setEditing(p); } },
                          { l: 'Export', i: <Download className="w-3.5 h-3.5" />, f: () => doExport(p) },
                          { l: 'Delete', i: <Trash2 className="w-3.5 h-3.5" />, f: () => { setMenu(null); setToDelete(p); }, danger: true },
                        ].map((m) => (
                          <button key={m.l} onClick={m.f} className={cx('w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/5', m.danger ? 'text-rose-600 dark:text-rose-400' : 'text-[#111827] dark:text-slate-200')}>
                            {m.i}{m.l}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {p.description && <p className="text-xs text-[#6B7280] dark:text-slate-400 mt-3 line-clamp-2">{p.description}</p>}
                <div className="flex items-center justify-between mt-4">
                  <span className="text-[11px] text-[#9CA3AF] tabular-nums">
                    {p.voice_type === 'cloned' && <>{p.sample_count} sample{p.sample_count === 1 ? '' : 's'} · </>}{p.generation_count} generated
                  </span>
                  <Btn size="sm" variant={selectedId === p.id ? 'primary' : 'secondary'} onClick={() => onUse(p.id)}>
                    {selectedId === p.id ? 'Selected' : 'Use voice'}
                  </Btn>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <VoiceEditor open={creating || !!editing} profile={editing} onClose={() => { setCreating(false); setEditing(null); }}
        onSaved={async (p) => { await data.refreshProfiles(); onUse(p.id); }} />

      <Modal open={!!toDelete} onClose={() => setToDelete(null)} title="Delete this voice?"
        footer={<>
          <Btn variant="ghost" onClick={() => setToDelete(null)}>Keep it</Btn>
          <Btn variant="primary" className="!bg-rose-600 hover:!bg-rose-700" loading={busy} onClick={doDelete}>Delete voice</Btn>
        </>}>
        <p className="text-xs text-[#6B7280] dark:text-slate-400 leading-relaxed">
          <strong className="text-[#111827] dark:text-white">{toDelete?.name}</strong> and its samples will be removed. Audio you already generated with it stays in your library.
        </p>
      </Modal>
    </div>
  );
};
