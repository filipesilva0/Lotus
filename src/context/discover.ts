// Project context files: when Lotus loads a folder (a chat workspace folder or an App Builder
// project) it looks for SOUL.md, memory.md, AGENTS.md, CLAUDE.md, .hermes.md, .cursorrules,
// .cursor/rules/*.mdc, .github/copilot-instructions.md, .lotus/*.md … (full list in
// src-tauri/src/context_files.rs) and applies them to the model's instructions:
//   soul   → who the assistant is and how it speaks (goes first)
//   rules  → project instructions to follow
//   memory → facts about the project and the user (skipped while memory is switched off)

import { useCallback, useEffect, useState } from 'react';
import { invokeNative } from '../lib/bus';
import { isTauri } from '../lib/http';

export interface ContextFile { rel: string; kind: 'soul' | 'rules' | 'memory'; content: string; truncated: boolean; bytes: number; modified: number }

export async function discoverContext(root: string): Promise<ContextFile[]> {
  if (!root || !isTauri) return [];
  return (await invokeNative<ContextFile[]>('ctx_discover', { root })) ?? [];
}

/** Front matter of .mdc rule files (`---\ndescription: …\nglobs: …\n---`) is metadata, not instructions. */
export function stripFrontMatter(s: string): string {
  return s.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
}

/** System-prompt block for the enabled files. `budgetChars` caps the total; souls are kept whole first. */
export function contextBlock(files: ContextFile[], o: { off?: string[]; includeMemory: boolean; budgetChars: number }): { text: string; used: ContextFile[] } {
  const on = files.filter((f) => !o.off?.includes(f.rel) && (o.includeMemory || f.kind !== 'memory'));
  const order: ContextFile['kind'][] = ['soul', 'rules', 'memory'];
  const head: Record<ContextFile['kind'], string> = {
    soul: 'Persona (from the project’s soul file). Take on this identity and voice',
    rules: 'Project instructions. Follow them',
    memory: 'Project memory. Facts about this project and its owner',
  };
  let left = o.budgetChars;
  const used: ContextFile[] = [];
  const parts: string[] = [];
  for (const kind of order) {
    const group = on.filter((f) => f.kind === kind);
    if (!group.length) continue;
    const blocks: string[] = [];
    for (const f of group) {
      if (left <= 200) break;
      const body = stripFrontMatter(f.content);
      const take = body.length > left ? `${body.slice(0, left)}\n…(cut to fit the context window)` : body;
      left -= take.length;
      used.push(f);
      blocks.push(`--- ${f.rel} ---\n${take}`);
    }
    if (blocks.length) parts.push(`## ${head[kind]}:\n${blocks.join('\n\n')}`);
  }
  return { text: parts.length ? `\n\n# Project context files\n${parts.join('\n\n')}` : '', used };
}

/** Discovers context files for `root` on load, when the window regains focus, and on demand. */
export function useProjectContext(root: string | undefined | null) {
  const [files, setFiles] = useState<ContextFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!root) { setFiles([]); setError(null); return; }
    setLoading(true);
    try { setFiles(await discoverContext(root)); setError(null); }
    catch (e) { setError(String((e as Error)?.message ?? e)); setFiles([]); }
    finally { setLoading(false); }
  }, [root]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!root) return;
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [root, refresh]);

  return { files, loading, error, refresh };
}
