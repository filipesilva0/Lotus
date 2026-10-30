import { useCallback, useState } from 'react';
import { usePersisted, uid } from '../lib/persist';
import { appPaths } from '../services/engineControl';
import { isTauri } from '../lib/http';
import { BuilderProject, TargetId } from './types';
import { projCreate, projWrite, projMkdir, projTree } from './projectFs';
import { renderTemplate, slugify, templateFor } from './templates';

/** The list of App Builder projects (kept in localStorage; the files live in their folders on disk). */
export function useProjects() {
  const [projects, setProjects] = usePersisted<BuilderProject[]>('lotus.builder.projects.v1', []);
  const [activeId, setActiveId] = usePersisted<string | null>('lotus.builder.active.v1', null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = projects.find((p) => p.id === activeId) ?? null;

  /** Default parent folder: <Lotus data folder>\projects */
  const defaultParent = useCallback(async () => {
    const p = await appPaths();
    return p ? `${p.dataDir}${p.dataDir.includes('\\') ? '\\' : '/'}projects` : '';
  }, []);

  const create = useCallback(async (o: { name: string; target: TargetId; parent?: string }): Promise<BuilderProject | null> => {
    setBusy(true); setError(null);
    try {
      if (!isTauri) throw new Error('Creating projects needs the Lotus desktop app.');
      const t = templateFor(o.target);
      const parent = o.parent || (await defaultParent());
      if (!parent) throw new Error('Choose a folder for the project.');
      const sep = parent.includes('\\') ? '\\' : '/';
      const path = await projCreate(`${parent.replace(/[\\/]+$/, '')}${sep}${slugify(o.name)}`);
      if ((await projTree(path)).entries.length > 0) throw new Error(`The folder ${path} already has files in it. Pick another name or location so nothing gets overwritten.`);
      for (const f of renderTemplate(t, o.name)) await projWrite(path, f.path, f.content, f.base64);
      const proj: BuilderProject = { id: uid('proj'), name: o.name, path, target: o.target, createdAt: Date.now(), previewDir: t.previewDir ?? '', autoRun: false };
      setProjects((l) => [proj, ...l]);
      setActiveId(proj.id);
      return proj;
    } catch (e) { setError((e as Error).message); return null; } finally { setBusy(false); }
  }, [defaultParent, setProjects, setActiveId]);

  /** Adds a folder that already exists (nothing is written to it). */
  const addExisting = useCallback(async (path: string, name: string, target: TargetId = 'blank') => {
    const existing = projects.find((p) => p.path === path);
    if (existing) { setActiveId(existing.id); return existing; }
    const t = templateFor(target);
    const proj: BuilderProject = { id: uid('proj'), name, path, target, createdAt: Date.now(), previewDir: t.previewDir ?? '', autoRun: false };
    setProjects((l) => [proj, ...l]);
    setActiveId(proj.id);
    return proj;
  }, [projects, setProjects, setActiveId]);

  const update = useCallback((id: string, p: Partial<BuilderProject>) => setProjects((l) => l.map((x) => (x.id === id ? { ...x, ...p } : x))), [setProjects]);
  /** Removes the project from the list. Its files stay on disk. */
  const forget = useCallback((id: string) => { setProjects((l) => l.filter((x) => x.id !== id)); setActiveId((a) => (a === id ? null : a)); }, [setProjects, setActiveId]);

  return { projects, active, setActiveId, defaultParent, create, addExisting, update, forget, busy, error, clearError: () => setError(null), mkdir: projMkdir };
}
