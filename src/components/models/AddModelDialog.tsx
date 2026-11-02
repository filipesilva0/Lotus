import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Banner, Btn, Label, Segmented, TextInput } from '../common/ui';
import { browseModelsDir, findModelsDir, folderPath, normaliseLink, validFileName, ModelFolder } from '../../services/downloadService';
import type { FileDownloads } from './useFileDownloads';
import { isTauri } from '../../lib/http';

export type ModelKind = 'language' | 'image' | 'lora' | 'voice';
const FOLDER: Partial<Record<ModelKind, ModelFolder>> = { image: 'checkpoints', lora: 'loras' };
const RISKY = ['ckpt', 'pt', 'pth', 'bin'];

interface Props {
  open: boolean; onClose: () => void; initialKind: ModelKind;
  startPull: (name: string) => void; pulling: boolean;
  files: FileDownloads; modelsDir: string; onModelsDir: (p: string) => void;
  onVoiceDownload: (name: string) => Promise<void>;
  onStarted: (kind: ModelKind) => void;
}

/** One dialog for adding any kind of model by name or link. */
export const AddModelDialog: React.FC<Props> = ({ open, onClose, initialKind, startPull, pulling, files, modelsDir, onModelsDir, onVoiceDownload, onStarted }) => {
  const [kind, setKind] = useState<ModelKind>(initialKind);
  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  const [fileName, setFileName] = useState('');
  const [touched, setTouched] = useState(false);
  const [token, setToken] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setKind(initialKind); setErr(null); setName(''); setLink(''); setFileName(''); setTouched(false); setToken(''); } }, [open, initialKind]);

  const norm = link.trim() ? normaliseLink(link) : null;
  const host = norm && 'host' in norm ? norm.host : null;
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const folder = FOLDER[kind];

  const onLink = (v: string) => {
    setLink(v); setErr(null);
    const n = v.trim() ? normaliseLink(v) : null;
    if (!touched && n && 'fileName' in n) setFileName(n.fileName);
  };

  const submit = async () => {
    setErr(null);
    if (kind === 'language') {
      if (!name.trim()) return;
      startPull(name.trim()); onStarted('language'); onClose(); return;
    }
    if (kind === 'voice') {
      if (!name.trim()) return;
      setBusy(true);
      try { await onVoiceDownload(name.trim()); onStarted('voice'); onClose(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
      return;
    }
    const n = normaliseLink(link);
    if ('error' in n) { setErr(n.error); return; }
    const finalName = (fileName.trim() || n.fileName).trim();
    if (!validFileName(finalName)) { setErr('Give the file a name that ends in .safetensors (or .ckpt, .pt, .pth, .bin, .gguf, .sft, .onnx), with no folders in it.'); return; }
    setBusy(true);
    try {
      const dir = modelsDir || (await findModelsDir()) || (await browseModelsDir()) || '';
      if (!dir) { setErr('Choose ComfyUI\u2019s models folder first (the folder that contains checkpoints and loras).'); return; }
      onModelsDir(dir);
      files.start({ url: n.url, destDir: folderPath(dir, folder!), fileName: finalName, token: token.trim() || undefined, kind: folder! });
      onStarted(kind); onClose();
    } finally { setBusy(false); }
  };

  const ready = kind === 'language' || kind === 'voice' ? !!name.trim() : !!link.trim();

  return (
    <Modal open={open} onClose={onClose} title="Add a model" wide
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" loading={busy} disabled={!ready || (kind === 'language' && pulling) || (folder != null && !isTauri)} onClick={() => void submit()}>Download</Btn></>}>
      <Segmented<ModelKind> label="Kind of model" value={kind} onChange={(k) => { setKind(k); setErr(null); }} className="mb-4"
        options={[{ id: 'language', label: 'Language' }, { id: 'image', label: 'Image' }, { id: 'lora', label: 'LoRA' }, { id: 'voice', label: 'Voice' }]} />
      {err && <Banner tone="error" className="mb-3">{err}</Banner>}

      {kind === 'language' && (<>
        <Label>Model name or Hugging Face path</Label>
        <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} aria-label="Model name or Hugging Face path" className="font-mono"
          placeholder="qwen2.5-coder:7b  or  hf.co/bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M" />
        <p className="mt-2 text-[12px] text-[var(--color-text-muted)] leading-snug">Any name from the Ollama library works, including ones not in the suggestions. For a GGUF on Hugging Face use <span className="font-mono">hf.co/user/repo:QUANT</span>. Ollama downloads it and checks it against the published checksum.</p>
      </>)}

      {kind === 'voice' && (<>
        <Label>Voicebox model name</Label>
        <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} aria-label="Voicebox model name" className="font-mono" placeholder="the model name exactly as Voicebox lists it" />
        <p className="mt-2 text-[12px] text-[var(--color-text-muted)] leading-snug">Voicebox downloads the model itself. The name must be one it knows; if it does not, Voicebox says so here. Models it already lists can be downloaded from the Voice list.</p>
      </>)}

      {folder && (<>
        <Label>Link to the file</Label>
        <TextInput autoFocus value={link} onChange={(e) => onLink(e.target.value)} aria-label="Link to the model file" className="font-mono" placeholder="https://huggingface.co/user/repo/blob/main/model.safetensors" />
        <p className="mt-1.5 text-[12px] text-[var(--color-text-muted)] leading-snug">Paste a Hugging Face file link or a Civitai model link. {kind === 'lora' ? 'The file goes to ComfyUI\u2019s loras folder.' : 'The file goes to ComfyUI\u2019s checkpoints folder.'}</p>
        {norm && 'error' in norm && <p className="mt-1.5 text-[12px] text-[var(--c-red)]">{norm.error}</p>}
        {host && <p className="mt-1.5 text-[12px] text-[var(--color-text-muted)]">Lotus will download this directly from <span className="font-medium text-[var(--color-text-main)]">{host}</span>. Nothing else is sent.</p>}

        <div className="mt-3"><Label>Save as</Label>
          <TextInput value={fileName} onChange={(e) => { setFileName(e.target.value); setTouched(true); }} aria-label="File name" className="font-mono" placeholder="model.safetensors" /></div>
        {RISKY.includes(ext) && (
          <p className="mt-2 flex gap-1.5 text-[12px] text-[var(--c-orange)] leading-snug"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />.{ext} files can contain code that runs when ComfyUI loads them. Prefer a .safetensors version, and only use files from sources you trust.</p>
        )}

        <div className="mt-3"><Label hint="optional">Access token</Label>
          <TextInput type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} aria-label="Access token (optional)" placeholder="Only for gated or login-only files" />
          <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">Used for this download only and never saved.</p></div>

        <div className="mt-3 text-[12px] text-[var(--color-text-muted)]">
          Saved to: <span className="font-mono text-[var(--color-text-main)]">{modelsDir ? folderPath(modelsDir, folder) : 'ComfyUI\u2019s models folder (asked on download)'}</span>
          {modelsDir && <button type="button" className="ml-2 font-medium text-[var(--color-accent-vibrant)] hover:underline" onClick={async () => { const p = await browseModelsDir(); if (p) onModelsDir(p); }}>Change…</button>}
        </div>
        {!isTauri && <p className="mt-2 text-[12px] text-[var(--c-orange)]">Downloading files needs the Lotus desktop app.</p>}
      </>)}
    </Modal>
  );
};
