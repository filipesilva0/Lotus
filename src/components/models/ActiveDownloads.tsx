import React from 'react';
import { Check, Square, X } from 'lucide-react';
import { Banner, Btn, Card, IconBtn, Progress } from '../common/ui';
import type { FileDownloads } from './useFileDownloads';

const mb = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : `${Math.round(b / 1024 ** 2)} MB`);

interface Pull { name: string | null; status: string; frac: number | null; error: string | null; cancel: () => void; clearError: () => void }

/** Everything that is downloading right now (Ollama pulls and model files), above whichever list is open. */
export const ActiveDownloads: React.FC<{ pull: Pull; files: FileDownloads }> = ({ pull, files }) => (
  <div className="space-y-2">
    {pull.error && <Banner tone="error" action={<Btn size="sm" variant="ghost" onClick={pull.clearError}>Dismiss</Btn>}>{pull.error}</Banner>}
    {pull.name && (
      <Card className="p-3.5">
        <div className="flex items-center justify-between text-[13px] mb-2"><span className="font-medium">Downloading {pull.name}</span><Btn size="sm" icon={<Square className="w-3 h-3" fill="currentColor" />} onClick={pull.cancel}>Cancel</Btn></div>
        <Progress value={pull.frac} label={`Download ${pull.name}`} />
        <p className="mt-1.5 text-[12px] text-[var(--color-text-muted)] tabular-nums">{pull.status}{pull.frac !== null ? ` · ${Math.round(pull.frac * 100)}%` : ''}{/verif/i.test(pull.status) ? ' (Ollama checks the file against its published checksum)' : ''}</p>
      </Card>
    )}
    {files.items.map((d) => d.status === 'error' ? (
      <Banner key={d.id} tone="error" action={<Btn size="sm" variant="ghost" onClick={() => files.dismiss(d.id)}>Dismiss</Btn>}>{d.label}: {d.error}</Banner>
    ) : d.status === 'done' ? (
      <Card key={d.id} className="p-3 flex items-center gap-2 text-[13px]">
        <Check className="w-4 h-4 text-[var(--c-green)] shrink-0" /><span className="flex-1 min-w-0 truncate"><span className="font-medium">{d.label}</span> is in your {d.kind === 'loras' ? 'LoRA' : 'checkpoint'} folder. ComfyUI lists it after a refresh; restart ComfyUI if it does not.</span>
        <IconBtn label="Dismiss" onClick={() => files.dismiss(d.id)}><X className="w-3.5 h-3.5" /></IconBtn>
      </Card>
    ) : (
      <Card key={d.id} className="p-3.5">
        <div className="flex items-center justify-between text-[13px] mb-2"><span className="font-medium truncate">Downloading {d.label}</span><Btn size="sm" icon={<Square className="w-3 h-3" fill="currentColor" />} onClick={() => files.cancel(d.id)}>Cancel</Btn></div>
        <Progress value={d.total ? d.received / d.total : null} label={`Download ${d.label}`} />
        <p className="mt-1.5 text-[12px] text-[var(--color-text-muted)] tabular-nums">{mb(d.received)}{d.total ? ` of ${mb(d.total)} · ${Math.round((d.received / d.total) * 100)}%` : ''}</p>
      </Card>
    ))}
  </div>
);
