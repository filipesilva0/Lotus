import { useCallback, useEffect, useState } from 'react';
import { BuilderProject } from './types';
import { previewServe } from './projectFs';

export interface PreviewState { url: string | null; kind: 'static' | 'server' | 'none'; nonce: number; error: string | null }

/** What the preview pane shows: a folder served by Lotus, or a dev server the project started. */
export function usePreview(project: BuilderProject | null, defaultDir: string | null) {
  const [state, setState] = useState<PreviewState>({ url: null, kind: 'none', nonce: 0, error: null });

  const serveStatic = useCallback(async (dir: string): Promise<string> => {
    if (!project) throw new Error('No project is open.');
    const info = await previewServe(project.path, dir);
    setState((s) => ({ url: info.url, kind: 'static', nonce: s.nonce + 1, error: null }));
    return info.url;
  }, [project]);

  const showServer = useCallback((url: string) => setState((s) => ({ url, kind: 'server', nonce: s.nonce + 1, error: null })), []);
  const reload = useCallback(() => setState((s) => ({ ...s, nonce: s.nonce + 1 })), []);

  // Static projects start previewing as soon as they are opened.
  useEffect(() => {
    setState({ url: null, kind: 'none', nonce: 0, error: null });
    if (!project || defaultDir === null) return;
    let alive = true;
    previewServe(project.path, project.previewDir ?? defaultDir)
      .then((i) => { if (alive) setState({ url: i.url, kind: 'static', nonce: 1, error: null }); })
      .catch((e: Error) => { if (alive) setState((s) => ({ ...s, error: e.message })); });
    return () => { alive = false; };
  }, [project?.id, project?.path, project?.previewDir, defaultDir]); // eslint-disable-line react-hooks/exhaustive-deps

  return { ...state, serveStatic, showServer, reload };
}
