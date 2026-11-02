import React, { useEffect, useState } from 'react';
import { EngineNotice } from '../common/EngineNotice';
import { ExternalLink, FolderOpen, Plus } from 'lucide-react';
import { Banner, Btn, Card, Empty } from '../common/ui';
import { openExternal, revealPath } from '../../lib/open';
import { browseModelsDir, folderPath, ModelFolder } from '../../services/downloadService';
import { isTauri } from '../../lib/http';
import { engineUrl, isRemote } from '../../services/engineConfig';

const COPY: Record<ModelFolder, { title: string; blurb: string; empty: string; find: [string, string][] }> = {
  checkpoints: {
    title: 'Image checkpoints',
    blurb: 'The main image models ComfyUI draws with (Stable Diffusion, SDXL, FLUX). They live in ComfyUI\u2019s models/checkpoints folder.',
    empty: 'No checkpoints found. Download one, or put a checkpoint file in ComfyUI\u2019s models/checkpoints folder.',
    find: [['Browse text-to-image models', 'https://huggingface.co/models?pipeline_tag=text-to-image&sort=downloads'], ['Civitai', 'https://civitai.com/models']],
  },
  loras: {
    title: 'LoRAs',
    blurb: 'Small add-on models that steer style or subject. Pick them in Images, under the LoRA button. They live in ComfyUI\u2019s models/loras folder and need a compatible checkpoint (an SDXL LoRA only works with SDXL checkpoints).',
    empty: 'No LoRAs found. Download one, or put LoRA files in ComfyUI\u2019s models/loras folder.',
    find: [['Browse LoRAs on Hugging Face', 'https://huggingface.co/models?other=lora&pipeline_tag=text-to-image&sort=downloads'], ['Civitai LoRAs', 'https://civitai.com/models']],
  },
};

/** Installed image checkpoints or LoRAs, with the folder they live in and a way to add more. */
export const ImageModelsHub: React.FC<{
  folder: ModelFolder; names: string[]; comfyUp: boolean | null; modelsDir: string; onModelsDir: (p: string) => void; onAdd: () => void; onOpenEngines: () => void;
}> = ({ folder, names, comfyUp, modelsDir, onModelsDir, onAdd, onOpenEngines }) => {
  const c = COPY[folder];
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setErr(null), [folder]);
  const dir = modelsDir ? folderPath(modelsDir, folder) : '';

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0"><h2 className="text-[15px] font-semibold">{c.title}</h2><p className="text-[12px] text-[var(--color-text-muted)] leading-snug mt-0.5">{c.blurb}</p></div>
        <Btn variant="primary" icon={<Plus className="w-3.5 h-3.5" />} onClick={onAdd}>Download…</Btn>
      </div>
      {comfyUp === false && <EngineNotice id="comfyui" purpose="" note="The list below can't be read until it starts. Downloads still work once a models folder is set." />}
      {isRemote('comfyui') && <Banner tone="info">ComfyUI runs on another computer ({engineUrl('comfyui').replace(/^https?:\/\//, '')}). The list below is read from it, but downloads here are saved on this computer: point the folder below at that computer's shared ComfyUI models folder, or add files there directly.</Banner>}
      {err && <Banner tone="error">{err}</Banner>}

      <Card className="p-3 flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold text-[var(--color-text-muted)]">Saved to</p>
          <p className="text-[12px] font-mono truncate" title={dir}>{dir || 'Not set. Choose ComfyUI\u2019s models folder.'}</p>
        </div>
        <Btn size="sm" onClick={async () => { const p = await browseModelsDir(); if (p) onModelsDir(p); }} disabled={!isTauri}>{modelsDir ? 'Change…' : 'Choose…'}</Btn>
        {dir && <Btn size="sm" icon={<FolderOpen className="w-3 h-3" />} onClick={async () => { setErr(null); try { await revealPath(dir); } catch { setErr('That folder does not exist yet. It is created with the first download.'); } }}>Show</Btn>}
      </Card>

      {!names.length
        ? <Empty title={comfyUp ? 'Nothing here yet' : 'Nothing to list'} body={c.empty} className="!py-6" />
        : <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3" aria-label={c.title}>
          {names.map((n) => <li key={n}><Card className="px-3.5 py-3"><p className="text-[13px] font-medium truncate" title={n}>{n}</p><p className="text-[12px] text-[var(--color-text-muted)]">{n.split('.').pop()}</p></Card></li>)}
        </ul>}

      <div className="flex flex-wrap gap-3 text-[12px]">
        {c.find.map(([label, url]) => <button key={url} type="button" onClick={() => void openExternal(url)} className="inline-flex items-center gap-1 font-medium text-[var(--color-accent-vibrant)] hover:underline">{label}<ExternalLink className="w-3 h-3" /></button>)}
      </div>
      <p className="text-[12px] text-[var(--color-text-muted)]">To remove a model, delete its file in the folder above.</p>
    </div>
  );
};
