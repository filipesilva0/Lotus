// Attach a folder to a chat (session 7). Its text and code files become mounted context items,
// one per file (named `folder/path`), so they can be switched on/off and @mentioned like any other.
// Desktop: Rust walks the folder (`ctx_read_folder`, skips node_modules/.git/build output, binaries
// and big files). Browser preview: a directory picker, filtered with the same rules here.

import { ContextItem } from '../types/lotus';
import { invokeNative } from '../lib/bus';
import { isTauri } from '../lib/http';
import { contextItemFromText, TEXT_EXT } from './helpers';

export interface FolderFile { rel: string; content: string; truncated: boolean }
export interface FolderRead { name: string; files: FolderFile[]; skipped: number; limited: boolean }

export const SKIP_DIRS = ['.git', '.hg', '.svn', 'node_modules', 'target', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', '__pycache__', '.venv', 'venv', 'env', '.tox', '.mypy_cache', '.pytest_cache', 'vendor', '.idea', '.vs', '.vscode', 'bin', 'obj', '.gradle', '.dart_tool', 'Pods', '.cache', 'coverage', '.turbo', '.parcel-cache'];
const EXTRA_EXT = /\.(mdx|mdc|rst|jsonc|cfg|conf|sass|less|mjs|cjs|vue|svelte|kt|kts|swift|cc|bash|zsh|cmd|lua|dart|r|scala|gradle|proto|graphql|gql|tf|nix|zig|ex|exs|erl|hs|ml|clj|el|vim|gitignore|editorconfig)$/i;
const BARE_NAMES = /^(readme|license|licence|makefile|dockerfile|procfile|gemfile|rakefile|changelog|authors|notice)$/i;
export const LIMITS = { files: 200, fileChars: 200 * 1024, totalChars: 1_500_000 };

/** Same rules as the Rust walker: is this path (relative, forward slashes) worth reading? */
export function wantedPath(rel: string): boolean {
  const parts = rel.split('/');
  if (parts.slice(0, -1).some((p) => SKIP_DIRS.some((d) => d.toLowerCase() === p.toLowerCase()))) return false;
  const name = parts[parts.length - 1];
  return TEXT_EXT.test(name) || EXTRA_EXT.test(name) || BARE_NAMES.test(name);
}

/** Turns what was read into context items. Chunk size follows the VRAM plan. */
export function folderToContext(r: FolderRead, chunkChars: number): ContextItem[] {
  return r.files.map((f) => contextItemFromText(`${r.name}/${f.rel}`, f.truncated ? `${f.content}\n…(file cut: it is larger than Lotus reads)` : f.content, chunkChars));
}

/** One-line summary for the composer. */
export function folderSummary(r: FolderRead): string {
  const n = r.files.length;
  const base = n ? `Attached ${n} file${n === 1 ? '' : 's'} from ${r.name}.` : `No text or code files found in ${r.name}.`;
  const extra = [r.skipped ? `${r.skipped} skipped (not text, or too large)` : '', r.limited ? `stopped at ${LIMITS.files} files / ${(LIMITS.totalChars / 1e6).toFixed(1)} M characters` : ''].filter(Boolean).join('; ');
  return extra ? `${base} ${extra[0].toUpperCase()}${extra.slice(1)}.` : base;
}

/** Desktop: asks for a folder with the system dialog and reads it in Rust. Returns null if cancelled. */
export async function pickAndReadFolder(): Promise<FolderRead | null> {
  if (!isTauri) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const p = await open({ title: 'Attach a folder to this chat', directory: true, multiple: false });
  if (typeof p !== 'string') return null;
  return (await invokeNative<FolderRead>('ctx_read_folder', { root: p, maxFiles: LIMITS.files, maxChars: LIMITS.totalChars })) ?? null;
}

/** Browser preview: reads the files of an <input webkitdirectory> selection with the same filters. */
export async function readPickedFiles(list: FileList | File[]): Promise<FolderRead> {
  const all = Array.from(list);
  const first = (all[0] as File & { webkitRelativePath?: string })?.webkitRelativePath ?? '';
  const name = first.split('/')[0] || 'folder';
  const out: FolderRead = { name, files: [], skipped: 0, limited: false };
  let total = 0;
  const sorted = all.map((f) => ({ f, rel: ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name }))
    .sort((a, b) => a.rel.localeCompare(b.rel));
  for (const { f, rel } of sorted) {
    if (!wantedPath(rel)) { if (!rel.split('/').some((p) => SKIP_DIRS.includes(p))) out.skipped++; continue; }
    if (out.files.length >= LIMITS.files || total >= LIMITS.totalChars) { out.limited = true; out.skipped++; continue; }
    if (f.size > LIMITS.fileChars * 4) { out.skipped++; continue; }
    const text = await f.text();
    if (text.slice(0, 4096).includes('\u0000')) { out.skipped++; continue; }
    const cap = Math.min(LIMITS.fileChars, LIMITS.totalChars - total);
    const content = text.length > cap ? text.slice(0, text.lastIndexOf('\n', cap) > 0 ? text.lastIndexOf('\n', cap) : cap) : text;
    if (!content.trim()) continue;
    total += content.length;
    out.files.push({ rel, content, truncated: text.length > cap });
  }
  return out;
}
