import { useCallback, useEffect, useRef, useState } from 'react';
import { BuilderProject, FsEntry } from './types';
import { projDelete, projMkdir, projRead, projRename, projTree, projWrite } from './projectFs';

export interface Buffer { text: string; saved: string; note?: string }

/** File tree, open tabs and unsaved edits for the open project. */
export function useFiles(project: BuilderProject | null) {
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [tabs, setTabs] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [buffers, setBuffers] = useState<Record<string, Buffer>>({});
  const [error, setError] = useState<string | null>(null);
  const root = project?.path ?? null;
  const timer = useRef<number | null>(null);
  const bufRef = useRef(buffers);
  bufRef.current = buffers;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const loadOne = useCallback(async (path: string): Promise<Buffer> => {
    if (!root) return { text: '', saved: '' };
    const r = await projRead(root, path);
    if (r.tooLarge) return { text: '', saved: '', note: `This file is ${Math.round(r.size / 1024)} KB, too large to open here.` };
    if (r.binary || r.text === null) return { text: '', saved: '', note: 'This is a binary file (an image, font or similar), so there is no text to show.' };
    return { text: r.text, saved: r.text };
  }, [root]);

  const refresh = useCallback(async () => {
    if (!root) return;
    try {
      const t = await projTree(root);
      setEntries(t.entries); setTruncated(t.truncated); setError(null);
      // Pick up changes the agent made to files that have no unsaved edits.
      const open = tabsRef.current;
      for (const p of open) {
        const b = bufRef.current[p];
        if (!b || b.text !== b.saved || b.note) continue;
        if (!t.entries.some((e) => e.rel === p)) continue;
        const fresh = await loadOne(p).catch(() => null);
        if (fresh && fresh.text !== b.saved) setBuffers((l) => (l[p] && l[p].text === l[p].saved ? { ...l, [p]: fresh } : l));
      }
    } catch (e) { setError((e as Error).message); }
  }, [root, loadOne]);

  /** Refresh soon; many agent writes in a row cause only one tree read. */
  const refreshSoon = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void refresh(); }, 250);
  }, [refresh]);

  useEffect(() => {
    setEntries([]); setTabs([]); setActivePath(null); setBuffers({}); setError(null); setTruncated(false);
    if (root) void refresh();
  }, [root]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = useCallback(async (path: string) => {
    setActivePath(path);
    setTabs((l) => (l.includes(path) ? l : [...l, path]));
    if (bufRef.current[path]) return;
    try { const b = await loadOne(path); setBuffers((l) => ({ ...l, [path]: b })); } catch (e) { setError((e as Error).message); }
  }, [loadOne]);

  const edit = useCallback((path: string, text: string) => setBuffers((l) => (l[path] ? { ...l, [path]: { ...l[path], text } } : l)), []);

  const save = useCallback(async (path: string) => {
    const b = bufRef.current[path];
    if (!root || !b || b.note) return;
    try { await projWrite(root, path, b.text); setBuffers((l) => ({ ...l, [path]: { ...l[path], saved: b.text } })); setError(null); } catch (e) { setError((e as Error).message); }
  }, [root]);

  const close = useCallback((path: string) => {
    setTabs((l) => {
      const next = l.filter((p) => p !== path);
      setActivePath((a) => (a === path ? next[next.length - 1] ?? null : a));
      return next;
    });
    setBuffers((l) => { const { [path]: _gone, ...rest } = l; return rest; });
  }, []);

  const createFile = useCallback(async (path: string) => {
    if (!root) return;
    try { await projWrite(root, path, ''); await refresh(); await open(path); } catch (e) { setError((e as Error).message); }
  }, [root, refresh, open]);

  const createFolder = useCallback(async (path: string) => {
    if (!root) return;
    try { await projMkdir(root, path); await refresh(); } catch (e) { setError((e as Error).message); }
  }, [root, refresh]);

  const remove = useCallback(async (path: string) => {
    if (!root) return;
    try {
      await projDelete(root, path);
      tabsRef.current.filter((p) => p === path || p.startsWith(`${path}/`)).forEach(close);
      await refresh();
    } catch (e) { setError((e as Error).message); }
  }, [root, refresh, close]);

  const rename = useCallback(async (from: string, to: string) => {
    if (!root) return;
    try {
      await projRename(root, from, to);
      tabsRef.current.filter((p) => p === from || p.startsWith(`${from}/`)).forEach(close);
      await refresh();
    } catch (e) { setError((e as Error).message); }
  }, [root, refresh, close]);

  const dirty = (p: string) => !!buffers[p] && buffers[p].text !== buffers[p].saved;
  return { entries, truncated, tabs, activePath, setActivePath, buffers, error, clearError: () => setError(null), refresh, refreshSoon, open, edit, save, close, createFile, createFolder, remove, rename, dirty };
}

export type Files = ReturnType<typeof useFiles>;
