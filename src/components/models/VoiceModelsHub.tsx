import React, { useCallback, useEffect, useState } from 'react';
import { EngineNotice } from '../common/EngineNotice';
import { confirmAlert } from '../common/Alerts';
import { Download, Plus, Trash2 } from 'lucide-react';
import { voicebox, ModelStatus, DownloadTask } from '../../services/voicebox';
import { reportActivity } from '../../lib/bus';
import { Banner, Btn, Card, Spinner } from '../common/ui';

/** Voicebox's speech and transcription models (the list that used to live in Engines → Models). */
export const VoiceModelsHub: React.FC<{ up: boolean | null; refreshKey: number; onOpenEngines: () => void; onAdd: () => void }> = ({ up, refreshKey, onOpenEngines, onAdd }) => {
  const [models, setModels] = useState<ModelStatus[] | null>(null);
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => voicebox.modelStatus().then(setModels).catch(() => setModels([])), []);
  useEffect(() => { if (up) void load(); }, [up, load, refreshKey]);

  const downloading = !!models?.some((m) => m.downloading);
  useEffect(() => {
    if (!downloading || !up) return;
    const t = setInterval(async () => {
      const a = await voicebox.activeTasks().catch(() => null);
      if (a) {
        setTasks(a.downloads);
        a.downloads.forEach((d) => reportActivity({ id: `dl-${d.model_name}`, kind: 'download', label: d.model_name, progress: d.progress != null ? d.progress / 100 : undefined }));
      }
      await load();
    }, 1500);
    return () => clearInterval(t);
  }, [downloading, up, load]);

  const act = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); await load(); } catch (e) { setErr((e as Error).message); } };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0"><h2 className="text-[15px] font-semibold">Voice models</h2><p className="text-[12px] text-[var(--color-text-muted)] leading-snug mt-0.5">Speech synthesis and transcription models, managed by Voicebox.</p></div>
        <Btn variant="primary" icon={<Plus className="w-3.5 h-3.5" />} onClick={onAdd}>Download by Name…</Btn>
      </div>
      {err && <Banner tone="error">{err}</Banner>}
      {up === false ? <EngineNotice id="voicebox" purpose="to list its models" />
        : models === null ? <Spinner className="w-4 h-4 text-[var(--color-accent-vibrant)]" /> : (
          <ul className="space-y-2">
            {models.map((m) => {
              const t = tasks.find((d) => d.model_name === m.model_name);
              return (
                <li key={m.model_name}><Card className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold truncate">{m.display_name}</p>
                    <p className="text-[12px] text-[var(--color-text-muted)] tabular-nums">
                      {m.size_mb ? `${(m.size_mb / 1024).toFixed(1)} GB` : 'Size unknown'}
                      {m.downloaded && !m.downloading && ' · Downloaded'}{m.loaded && ' · In memory'}
                      {m.downloading && ` · Downloading${t?.progress != null ? ` ${Math.round(t.progress)}%` : '…'}`}
                    </p>
                    {m.downloading && <div className="mt-1.5 h-1 rounded-[2px] bg-[var(--hover)] overflow-hidden"><div className="h-full bg-[var(--color-accent-fill)] transition-[width]" style={{ width: `${t?.progress ?? 8}%` }} /></div>}
                  </div>
                  {m.downloading ? <Spinner className="w-4 h-4 text-[var(--color-accent-vibrant)]" /> : !m.downloaded ? (
                    <Btn size="sm" variant="primary" icon={<Download className="w-3 h-3" />} onClick={() => act(() => voicebox.downloadModel(m.model_name))}>Download</Btn>
                  ) : (
                    <div className="flex gap-1.5">
                      {m.loaded ? <Btn size="sm" onClick={() => act(() => voicebox.unloadModel(m.model_name))}>Unload</Btn> : <Btn size="sm" onClick={() => act(() => voicebox.loadModel(m.model_name))}>Load</Btn>}
                      <Btn size="sm" variant="danger" icon={<Trash2 className="w-3 h-3" />} onClick={() => void confirmAlert({ title: `Delete “${m.display_name ?? m.model_name}”?`, message: 'This removes the voice model from this computer. You can download it again later.', confirm: 'Delete' }).then((ok) => { if (ok) void act(() => voicebox.deleteModel(m.model_name)); })}>Delete</Btn>
                    </div>
                  )}
                </Card></li>
              );
            })}
          </ul>
        )}
    </div>
  );
};
