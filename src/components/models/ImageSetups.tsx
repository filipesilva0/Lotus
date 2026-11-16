import React, { useMemo, useState } from 'react';
import { AlertCircle, Check, Copy, Trash2, Wand2 } from 'lucide-react';
import { Banner, Btn, Card, TextInput, cx } from '../common/ui';
import { confirmAlert } from '../common/Alerts';
import { Tip } from '../common/Tip';
import { fmtSize, hasImageFile, removeImageFile, useBuiltins, useProfiles } from '../../lib/builtins';
import { FAMILIES, FAMILY_ORDER, guessFamily, missingFor, slotFolder, suggestFile, type ImageFamily, type ImageFolder, type ImageProfile, type Slot } from '../../models/imageProfiles';
import { uid } from '../../lib/persist';

/*
 * Models → Image Setups (session 17). An image model is often several files: the model itself, the
 * VAE that turns its output into pixels, and one or more text encoders. A setup ties a model to its
 * own files and settings, so a FLUX model always runs with the FLUX VAE and its two encoders, and an
 * SDXL checkpoint can use a better VAE than the one baked into it. Catalog downloads make their setup
 * automatically; files added by hand (or by link) get one here.
 */

const SLOT_TIP: Record<Slot, string> = {
  model: 'The main file: a checkpoint (everything in one file) or a diffusion model (needs the files below).',
  vae: 'VAE: turns the model\'s output into the final picture. The wrong one gives washed-out or broken colours.',
  clip_l: 'CLIP-L: one of the text encoders that read your prompt.',
  clip_g: 'CLIP-G: the second CLIP text encoder SD 3.5 uses.',
  t5xxl: 'T5-XXL: the large text encoder FLUX.1 and SD 3.5 use to follow long prompts.',
  llm: 'Text encoder: a small language model that reads your prompt for newer image models.',
};

const sel = 'h-8 px-2 rounded-[6px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)] text-[13px] text-[var(--color-text-main)] min-w-0';

export const ImageSetups: React.FC<{ q: string }> = ({ q }) => {
  const b = useBuiltins();
  const [profiles, setProfiles] = useProfiles();
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const have = hasImageFile(b.imageFiles);
  const files = (f: ImageFolder) => (b.imageFiles[f] ?? []).map((x) => x.file);
  const needle = q.trim().toLowerCase();
  const shown = profiles.filter((p) => !needle || p.name.toLowerCase().includes(needle));
  // Main model files that no setup uses yet: offer to set them up.
  const used = new Set(profiles.map((p) => p.files.model));
  const loose = [...files('checkpoints').map((f) => ({ f, folder: 'checkpoints' as const })), ...files('diffusion_models').map((f) => ({ f, folder: 'diffusion_models' as const }))].filter((x) => !used.has(x.f));

  const save = (p: ImageProfile) => setProfiles(profiles.some((x) => x.id === p.id) ? profiles.map((x) => (x.id === p.id ? p : x)) : [...profiles, p]);
  const create = (file: string, folder: ImageFolder) => {
    const family = guessFamily(file, folder);
    const fam = FAMILIES[family];
    const p: ImageProfile = { id: uid('setup'), name: file.replace(/\.(safetensors|gguf|ckpt|sft)$/i, '').replace(/[_-]+/g, ' '), family, files: { model: file } };
    for (const s of fam.slots) { const hit = suggestFile(family, s.slot, files(s.folder)); if (hit) p.files[s.slot] = hit; }
    save(p);
    setOpenId(p.id);
  };

  return (
    <div className="space-y-6">
      <p className="text-[13px] text-[var(--color-text-muted)] max-w-[680px]">Each image model is tied to the exact files it needs. Lotus uses the setup's VAE and text encoders every time you pick the model, on Lotus's engine and on ComfyUI.</p>
      {error && <Banner tone="error">{error}</Banner>}

      {loose.length > 0 && (
        <section>
          <h2 className="text-[13px] font-semibold mb-2">Models Without a Setup</h2>
          <ul className="divide-y divide-[var(--sep)]">
            {loose.map(({ f, folder }) => (
              <li key={`${folder}/${f}`} className="flex items-center gap-3 py-2">
                <span className="flex-1 min-w-0 text-[13px] truncate">{f}</span>
                <span className="text-[12px] text-[var(--color-text-muted)]">Looks like {FAMILIES[guessFamily(f, folder)].label}</span>
                <Btn size="sm" variant="primary" icon={<Wand2 className="w-3 h-3" />} onClick={() => create(f, folder)}>Set Up</Btn>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-[13px] font-semibold mb-2">Setups ({shown.length})</h2>
        {!shown.length && <p className="text-[13px] text-[var(--color-text-muted)]">No image setups yet. Get an image model in Get Models (its setup is made for you), or add a model file by link and set it up here.</p>}
        <div className="space-y-2">
          {shown.map((p) => {
            const missing = missingFor(p, have);
            const open = openId === p.id;
            return (
              <Card key={p.id} className={cx('p-0 overflow-hidden', open && 'shadow-[0_0_0_2px_var(--color-accent-fill)]')}>
                <button type="button" className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-[var(--hover)]" aria-expanded={open} onClick={() => setOpenId(open ? null : p.id)}>
                  <span className="flex-1 min-w-0"><span className="block text-[14px] font-semibold truncate">{p.name}</span>
                    <span className="block text-[12px] text-[var(--color-text-muted)] truncate">{FAMILIES[p.family].label} · {[p.files.model, p.files.vae, p.files.llm, p.files.clip_l, p.files.t5xxl].filter(Boolean).length} files</span></span>
                  {missing.length
                    ? <span className="inline-flex items-center gap-1 text-[12px] text-[var(--c-orange)] font-medium"><AlertCircle className="w-3.5 h-3.5" />Needs {missing.map((s) => (s === 'model' ? 'the model file' : FAMILIES[p.family].slots.find((x) => x.slot === s)?.label ?? s)).join(', ')}</span>
                    : <span className="inline-flex items-center gap-1 text-[12px] text-[var(--c-green)] font-medium"><Check className="w-3.5 h-3.5" />Ready</span>}
                </button>
                {open && <Editor p={p} files={files} have={have} onChange={save}
                  onCopy={() => { const c = { ...p, id: uid('setup'), name: `${p.name} copy`, catalogId: undefined }; save(c); setOpenId(c.id); }}
                  onDelete={() => void confirmAlert({ title: `Delete the setup “${p.name}”?`, message: 'The model files stay in Lotus Studio/Models; only this setup is removed.', confirm: 'Delete' }).then((ok) => { if (ok) setProfiles(profiles.filter((x) => x.id !== p.id)); })} />}
              </Card>
            );
          })}
        </div>
      </section>

      <FilesOnDisk onError={setError} usedBy={(folder, f) => profiles.filter((p) => (Object.keys(p.files) as Slot[]).some((s) => p.files[s] === f && slotFolder(p.family, s) === folder)).map((p) => p.name)} />
    </div>
  );
};

const Editor: React.FC<{ p: ImageProfile; files: (f: ImageFolder) => string[]; have: (folder: ImageFolder, f: string) => boolean; onChange: (p: ImageProfile) => void; onCopy: () => void; onDelete: () => void }> = ({ p, files, have, onChange, onCopy, onDelete }) => {
  const fam = FAMILIES[p.family];
  const set = (patch: Partial<ImageProfile>) => onChange({ ...p, ...patch });
  const setFile = (slot: Slot, file: string) => onChange({ ...p, files: { ...p.files, [slot]: file || undefined } });
  const slots: { slot: Slot; label: string; folder: ImageFolder; required: boolean }[] = [{ slot: 'model', label: fam.mainFolder === 'checkpoints' ? 'Checkpoint' : 'Diffusion model', folder: fam.mainFolder, required: true }, ...fam.slots];
  const loras = files('loras');
  const fill = () => { const next = { ...p.files }; for (const s of fam.slots) if (!next[s.slot] || !have(s.folder, next[s.slot]!)) { const hit = suggestFile(p.family, s.slot, files(s.folder)); if (hit) next[s.slot] = hit; } onChange({ ...p, files: next }); };
  return (
    <div className="px-3.5 pb-3.5 pt-1 space-y-3 border-t border-[var(--sep)]">
      <div className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-2 items-center mt-2">
        <label htmlFor={`n-${p.id}`} className="text-[12px] text-[var(--color-text-muted)]">Name</label>
        <TextInput id={`n-${p.id}`} value={p.name} onChange={(e) => set({ name: e.target.value })} />
        <label htmlFor={`f-${p.id}`} className="text-[12px] text-[var(--color-text-muted)] flex items-center gap-1">Model type<Tip label="Model type" text="Decides which files the model needs and how Lotus runs it." /></label>
        <select id={`f-${p.id}`} className={sel} value={p.family} onChange={(e) => onChange({ ...p, family: e.target.value as ImageFamily, files: { model: p.files.model } })}>
          {FAMILY_ORDER.map((f) => <option key={f} value={f}>{FAMILIES[f].label}</option>)}
        </select>
        {slots.map((s) => {
          const list = files(s.folder);
          const cur = p.files[s.slot] ?? '';
          const gone = !!cur && !have(s.folder, cur);
          return (
            <React.Fragment key={s.slot}>
              <label htmlFor={`${s.slot}-${p.id}`} className="text-[12px] text-[var(--color-text-muted)] flex items-center gap-1">{s.label}{!s.required && ' (optional)'}<Tip label={s.label} text={SLOT_TIP[s.slot]} /></label>
              <div className="flex items-center gap-2 min-w-0">
                <select id={`${s.slot}-${p.id}`} className={cx(sel, 'flex-1', gone && 'shadow-[0_0_0_1px_var(--c-orange)]')} value={cur} onChange={(e) => setFile(s.slot, e.target.value)}>
                  <option value="">{s.required ? 'Choose a file…' : s.slot === 'vae' ? 'The one inside the checkpoint' : 'None'}</option>
                  {gone && <option value={cur}>{cur} (not in Lotus Studio/Models/image/{s.folder})</option>}
                  {list.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            </React.Fragment>
          );
        })}
      </div>
      {fam.locked
        ? <p className="text-[12px] text-[var(--color-text-muted)]">{fam.label} is a distilled model: Lotus always runs it with {fam.steps} steps and guidance {fam.cfg}, the values it was trained for.</p>
        : (
          <div className="grid grid-cols-3 gap-3 max-w-[460px]">
            <label className="text-[12px] text-[var(--color-text-muted)] flex flex-col gap-1">Steps<input type="number" min={1} max={150} className={sel} value={p.steps ?? fam.steps} onChange={(e) => set({ steps: Math.max(1, Math.min(150, Number(e.target.value) || fam.steps)) })} /></label>
            <label className="text-[12px] text-[var(--color-text-muted)] flex flex-col gap-1">Guidance<input type="number" min={0} max={30} step={0.5} className={sel} value={p.cfg ?? fam.cfg} onChange={(e) => set({ cfg: Math.max(0, Math.min(30, Number(e.target.value))) })} /></label>
            <label className="text-[12px] text-[var(--color-text-muted)] flex flex-col gap-1">Sampler<select className={sel} value={p.sampler ?? fam.sampler} onChange={(e) => set({ sampler: e.target.value })}>
              {['euler', 'euler_ancestral', 'dpmpp_2m', 'heun', 'lcm', 'res_multistep'].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
          </div>
        )}
      {loras.length > 0 && (
        <div>
          <p className="text-[12px] text-[var(--color-text-muted)] mb-1 flex items-center gap-1">LoRAs always used with this model<Tip label="LoRA" /></p>
          <div className="flex flex-wrap gap-2">
            {loras.map((l) => {
              const on = (p.loras ?? []).find((x) => x.name === l);
              return (
                <span key={l} className={cx('inline-flex items-center gap-1.5 h-7 px-2 rounded-[6px] text-[12px]', on ? 'bg-[var(--color-accent-fill)]/15' : 'bg-[var(--hover)]')}>
                  <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={!!on} onChange={(e) => set({ loras: e.target.checked ? [...(p.loras ?? []), { name: l, strength: 0.8 }] : (p.loras ?? []).filter((x) => x.name !== l) })} />{l}</label>
                  {on && <input type="number" aria-label={`${l} strength`} min={-2} max={2} step={0.05} value={on.strength} onChange={(e) => set({ loras: (p.loras ?? []).map((x) => (x.name === l ? { ...x, strength: Number(e.target.value) } : x)) })} className="w-14 h-5 px-1 rounded bg-[var(--color-bg-card)] text-[12px]" />}
                </span>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <Btn size="sm" icon={<Wand2 className="w-3 h-3" />} onClick={fill}>Find Matching Files</Btn>
        <Btn size="sm" variant="ghost" icon={<Copy className="w-3 h-3" />} onClick={onCopy}>Duplicate</Btn>
        <div className="flex-1" />
        <Btn size="sm" variant="ghost" icon={<Trash2 className="w-3 h-3" />} onClick={onDelete}>Delete Setup</Btn>
      </div>
    </div>
  );
};

const FOLDERS: { id: ImageFolder; label: string }[] = [
  { id: 'checkpoints', label: 'Checkpoints' }, { id: 'diffusion_models', label: 'Diffusion models' }, { id: 'text_encoders', label: 'Text encoders' }, { id: 'vae', label: 'VAEs' }, { id: 'loras', label: 'LoRAs' },
];

const FilesOnDisk: React.FC<{ onError: (m: string) => void; usedBy: (folder: ImageFolder, f: string) => string[] }> = ({ onError, usedBy }) => {
  const b = useBuiltins();
  const total = useMemo(() => FOLDERS.reduce((s, f) => s + (b.imageFiles[f.id] ?? []).length, 0), [b.imageFiles]);
  if (!total) return null;
  return (
    <section>
      <h2 className="text-[13px] font-semibold mb-1">Image Files in Lotus Studio</h2>
      <p className="text-[12px] text-[var(--color-text-muted)] mb-2">Lotus Studio/Models/image. Files you copy into these folders appear here.</p>
      {FOLDERS.map((f) => (b.imageFiles[f.id] ?? []).length > 0 && (
        <div key={f.id} className="mb-3">
          <h3 className="text-[12px] font-semibold text-[var(--color-text-muted)] mb-1">{f.label}</h3>
          <ul className="divide-y divide-[var(--sep)]">
            {b.imageFiles[f.id].map((x) => {
              const users = usedBy(f.id, x.file);
              return (
                <li key={x.file} className="flex items-center gap-3 py-1.5">
                  <span className="flex-1 min-w-0 text-[13px] truncate">{x.file}</span>
                  <span className="text-[12px] text-[var(--color-text-muted)] truncate max-w-[220px]">{users.length ? `Used by ${users.join(', ')}` : 'Not used by a setup'}</span>
                  <span className="text-[12px] tabular-nums text-[var(--color-text-muted)] w-16 text-right">{fmtSize(x.bytes)}</span>
                  <button type="button" className="tip w-6 h-6 inline-flex items-center justify-center rounded hover:bg-[var(--hover)]" data-tip="Delete file" aria-label={`Delete ${x.file}`}
                    onClick={() => void confirmAlert({ title: `Delete ${x.file}?`, message: users.length ? `${users.join(', ')} ${users.length === 1 ? 'uses' : 'use'} this file and will stop working until it is back.` : 'This frees the disk space it takes.', confirm: 'Delete' }).then((ok) => { if (ok) void removeImageFile(f.id, x.file).catch((e) => onError((e as Error).message)); })}><Trash2 className="w-3.5 h-3.5" /></button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
};
