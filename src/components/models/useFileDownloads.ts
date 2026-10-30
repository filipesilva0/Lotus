import { useCallback, useRef, useState } from 'react';
import { downloadModel, DownloadHandle, ModelFolder } from '../../services/downloadService';
import { reportActivity } from '../../lib/bus';

export interface FileDl {
  id: string; label: string; kind: ModelFolder; received: number; total: number | null;
  status: 'running' | 'done' | 'error'; error?: string; path?: string;
}

/** Tracks checkpoint / LoRA downloads (one list, shown on every Models screen). */
export function useFileDownloads(onDone: () => void) {
  const [items, setItems] = useState<FileDl[]>([]);
  const handles = useRef(new Map<string, DownloadHandle>());
  const patch = (id: string, p: Partial<FileDl>) => setItems((l) => l.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const start = useCallback((o: { url: string; destDir: string; fileName: string; token?: string; kind: ModelFolder }) => {
    const handle: DownloadHandle = downloadModel({
      url: o.url, destDir: o.destDir, fileName: o.fileName, token: o.token,
      onProgress: (p) => {
        patch(handle.id, { received: p.received, total: p.total });
        reportActivity({ id: handle.id, kind: 'download', label: o.fileName, progress: p.total ? p.received / p.total : undefined });
      },
    });
    handles.current.set(handle.id, handle);
    setItems((l) => [{ id: handle.id, label: o.fileName, kind: o.kind, received: 0, total: null, status: 'running' }, ...l]);
    handle.promise
      .then((path) => { patch(handle.id, { status: 'done', path }); reportActivity({ id: handle.id, kind: 'download', label: `${o.fileName} ready`, done: true }); onDone(); })
      .catch((e: Error) => { patch(handle.id, { status: 'error', error: e.message }); reportActivity({ id: handle.id, kind: 'download', label: o.fileName, done: true }); })
      .finally(() => handles.current.delete(handle.id));
  }, [onDone]);

  const cancel = (id: string) => handles.current.get(id)?.cancel();
  const dismiss = (id: string) => setItems((l) => l.filter((x) => x.id !== id));
  return { items, start, cancel, dismiss, busy: items.some((i) => i.status === 'running') };
}

export type FileDownloads = ReturnType<typeof useFileDownloads>;
