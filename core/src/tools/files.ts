// files.list / files.read / files.search / files.write, confined to the folders the user allowed
// (Settings → Tools, the chat's attached folder, and the Lotus Studio folder). Paths are resolved
// through symlinks before the check, so a link can't lead outside.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Tool, ToolCtx } from '../agent/types';

export const SKIP_DIRS = new Set(['.git', '.hg', '.svn', 'node_modules', 'target', 'dist', 'build', 'out', '.next', '__pycache__', '.venv', 'venv', '.cache', 'coverage', '.idea', '.vs', '.vscode', 'bin', 'obj', '$recycle.bin', 'system volume information', 'appdata']);
const MAX_READ = 60_000;
const MAX_WRITE = 2 * 1024 * 1024;

const winLike = process.platform === 'win32' || process.platform === 'darwin';
const same = (a: string, b: string) => (winLike ? a.toLowerCase() === b.toLowerCase() : a === b);

function real(p: string): string {
  try { return realpathSync.native(p); } catch { return resolve(p); }
}

/** Is `p` (absolute, real) inside `root` (absolute, real)? */
export function inside(root: string, p: string): boolean {
  const r = relative(root, p);
  if (r === '') return true;
  if (isAbsolute(r)) return false;
  const first = r.split(sep)[0];
  return first !== '..' && !same(first, '..');
}

/** Does the path name one of the allowed folders ("Lotus Studio/notes.md")? */
const mentionsFolder = (p: string, folders: string[]) => {
  const parts = p.replace(/\\/g, '/').split('/').map((x) => x.toLowerCase());
  return folders.some((f) => parts.includes(basename(f).toLowerCase()));
};

/**
 * Resolves what the model wrote ("notes/todo.md", "C:\\Users\\…", "~/Documents/x") to a real path
 * inside one of the allowed folders, or explains why not. Relative paths start in the first folder.
 */
export function resolveInFolders(folders: string[], raw: unknown, forWrite = false): { path: string; root: string } | { error: string } {
  if (!folders.length) return { error: 'No folders are open to Lotus. Add one in Settings → Tools.' };
  let p = String(raw ?? '').trim().replace(/^["']|["']$/g, '');
  if (!p || p === '.' || p === './') p = folders[0];
  if (p.includes('\0')) return { error: 'That path is not valid.' };
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = join(homedir(), p.slice(1));
  const abs = isAbsolute(p) ? resolve(p) : resolve(folders[0], p);
  // For a new file, check the nearest folder that exists (so a link in the parent can't escape).
  let probe = abs;
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
  const realProbe = real(probe);
  const target = forWrite && probe !== abs ? join(realProbe, relative(probe, abs)) : real(abs);
  // "C:\\…" off Windows is a made-up absolute path, not a file name.
  const foreignAbs = process.platform !== 'win32' && /^[a-z]:[\\/]/i.test(p);
  let direct: { path: string; root: string } | null = null;
  if (!foreignAbs) for (const f of folders) {
    const root = real(f);
    if (inside(root, realProbe) && inside(root, target)) { direct = { path: target, root }; break; }
  }
  if (direct && (existsSync(abs) || !mentionsFolder(p, folders))) return direct;
  // Small models invent where a folder is ("/path/to/Lotus Studio/notes.md", "C:\\Program Files\\Lotus Studio").
  // If a path that doesn't exist names an allowed folder, use that folder.
  if (foreignAbs || !existsSync(abs)) {
    const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
    for (const f of folders) {
      const name = basename(f).toLowerCase();
      const i = parts.findIndex((x) => x.toLowerCase() === name);
      if (i < 0) continue;
      const again = resolveInFolders([f], parts.slice(i + 1).join('/') || '.', forWrite);
      if ('path' in again) return again;
    }
  }
  if (direct) return direct;
  return { error: `${p} is outside the folders Lotus may use (${folders.join(', ')}). Ask the user to add it in Settings → Tools.` };
}

const isText = (buf: Buffer) => !buf.subarray(0, 8000).includes(0);
const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`);

function walk(dir: string, depth: number, max: number, onEntry: (full: string, isDir: boolean, size: number, level: number) => boolean | void, level = 0): number {
  let n = 0;
  let entries: import('node:fs').Dirent[];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  for (const e of entries) {
    if (n >= max) break;
    if (e.isSymbolicLink()) continue;
    const full = join(dir, e.name);
    const isDir = e.isDirectory();
    let size = 0;
    if (!isDir) { try { size = statSync(full).size; } catch { continue; } }
    n++;
    if (onEntry(full, isDir, size, level) === false) return n;
    if (isDir && level + 1 < depth && !SKIP_DIRS.has(e.name.toLowerCase()) && !e.name.startsWith('.')) n += walk(full, depth, max - n, onEntry, level + 1);
  }
  return n;
}

const folderNote = (ctx: ToolCtx) => `Folders you can use: ${ctx.folders.join(', ')}`;

export const filesList: Tool = {
  name: 'files.list', label: 'Listing a folder', risk: 'read',
  description: 'List the files and folders in a folder the user allowed. Use before reading or when asked what is in a folder.',
  parameters: { type: 'object', properties: {
    path: { type: 'string', description: 'Folder path relative to the main folder (e.g. "projects"), or absolute. Leave empty for the main folder.' },
    depth: { type: 'integer', description: 'How many levels down (1 to 3, default 1).' },
  } },
  describe: (a) => `List ${String(a.path || 'the main folder')}`,
  async run(a, ctx) {
    const r = resolveInFolders(ctx.folders, a.path);
    if ('error' in r) return { ok: false, text: `${r.error}`, summary: r.error };
    let st; try { st = statSync(r.path); } catch { return { ok: false, text: `${r.path} does not exist. ${folderNote(ctx)}`, summary: 'Folder not found' }; }
    if (!st.isDirectory()) return { ok: false, text: `${r.path} is a file, not a folder. Use files.read.`, summary: 'Not a folder' };
    const depth = Math.max(1, Math.min(3, Number(a.depth) || 1));
    const lines: string[] = [];
    let files = 0, dirs = 0;
    const n = walk(r.path, depth, 300, (full, isDir, size, level) => {
      isDir ? dirs++ : files++;
      lines.push(`${'  '.repeat(level)}${basename(full)}${isDir ? '/' : `  (${fmtSize(size)})`}`);
    });
    const text = lines.length ? `${r.path}\n${lines.join('\n')}${n >= 300 ? '\n… (stopped at 300 entries)' : ''}` : `${r.path} is empty.`;
    return { ok: true, text, summary: `${files} file${files === 1 ? '' : 's'}, ${dirs} folder${dirs === 1 ? '' : 's'} in ${basename(r.path) || r.path}`, data: { path: r.path, files, dirs } };
  },
};

export const filesRead: Tool = {
  name: 'files.read', label: 'Reading a file', risk: 'read',
  description: 'Read a text file (notes, code, Markdown, CSV, JSON…) in a folder the user allowed.',
  parameters: { type: 'object', properties: {
    path: { type: 'string', description: 'File path (absolute, or relative to the first allowed folder).' },
    offset: { type: 'integer', description: 'Character to start from, for long files (default 0).' },
  }, required: ['path'] },
  describe: (a) => `Read ${String(a.path)}`,
  async run(a, ctx) {
    const r = resolveInFolders(ctx.folders, a.path);
    if ('error' in r) return { ok: false, text: r.error, summary: r.error };
    let st; try { st = statSync(r.path); } catch { return { ok: false, text: `${r.path} does not exist. Use files.list or files.search to find the right name.`, summary: 'File not found' }; }
    if (st.isDirectory()) return { ok: false, text: `${r.path} is a folder. Use files.list.`, summary: 'That is a folder' };
    if (st.size > 20 * 1024 * 1024) return { ok: false, text: `${basename(r.path)} is ${fmtSize(st.size)}, too large to read.`, summary: 'File too large' };
    const buf = readFileSync(r.path);
    if (!isText(buf)) return { ok: false, text: `${basename(r.path)} is not a text file (Lotus reads text and code files; PDFs and Office files not yet).`, summary: 'Not a text file' };
    const all = buf.toString('utf8');
    const off = Math.max(0, Number(a.offset) || 0);
    const part = all.slice(off, off + MAX_READ);
    const more = off + MAX_READ < all.length;
    return {
      ok: true,
      text: `${r.path} (${all.length.toLocaleString('en')} characters${off ? `, from ${off}` : ''}):\n${part}${more ? `\n… (more: call files.read with offset ${off + MAX_READ})` : ''}`,
      summary: `${basename(r.path)} · ${fmtSize(st.size)}`, data: { path: r.path },
    };
  },
};

export const filesSearch: Tool = {
  name: 'files.search', label: 'Searching files', risk: 'read',
  description: 'Find files by name or by text inside them, in the folders the user allowed.',
  parameters: { type: 'object', properties: {
    query: { type: 'string', description: 'Words to look for in file names and contents.' },
    path: { type: 'string', description: 'Folder to search in (default: every allowed folder).' },
  }, required: ['query'] },
  describe: (a) => `Search for “${String(a.query)}”`,
  async run(a, ctx) {
    const q = String(a.query).toLowerCase().trim();
    if (!q) return { ok: false, text: 'Give some words to search for.', summary: 'Nothing to search for' };
    let roots = ctx.folders;
    if (a.path) { const r = resolveInFolders(ctx.folders, a.path); if ('error' in r) return { ok: false, text: r.error, summary: r.error }; roots = [r.path]; }
    const hits: string[] = [];
    let scanned = 0;
    const started = Date.now();
    for (const root of roots) {
      walk(root, 6, 4000, (full, isDir, size) => {
        if (hits.length >= 30 || Date.now() - started > 8000 || ctx.signal.aborted) return false;
        if (isDir) { if (basename(full).toLowerCase().includes(q)) hits.push(`${full}${sep}  (folder name)`); return; }
        scanned++;
        if (basename(full).toLowerCase().includes(q)) { hits.push(`${full}  (file name)`); return; }
        if (size > 1024 * 1024) return;
        try {
          const buf = readFileSync(full);
          if (!isText(buf)) return;
          const text = buf.toString('utf8');
          const i = text.toLowerCase().indexOf(q);
          if (i >= 0) {
            const line = text.slice(0, i).split('\n').length;
            const snippet = text.slice(Math.max(0, i - 60), i + q.length + 60).replace(/\s+/g, ' ').trim();
            hits.push(`${full}:${line}  …${snippet}…`);
          }
        } catch { /* unreadable */ }
      });
    }
    return {
      ok: true,
      text: hits.length ? `${hits.length} match${hits.length === 1 ? '' : 'es'} for “${a.query}” (${scanned} files looked at):\n${hits.join('\n')}` : `No files match “${a.query}” (${scanned} files looked at in ${roots.join(', ')}).`,
      summary: `${hits.length} match${hits.length === 1 ? '' : 'es'} for “${String(a.query).slice(0, 40)}”`,
    };
  },
};

export const filesWrite: Tool = {
  name: 'files.write', label: 'Saving a file', risk: 'risky',
  description: 'Create or change a text file in a folder the user allowed. mode "create" (default) refuses to replace an existing file; "overwrite" replaces it; "append" adds to the end.',
  parameters: { type: 'object', properties: {
    path: { type: 'string', description: 'File path (absolute, or relative to the first allowed folder), including the extension, e.g. notes/ideas.md.' },
    content: { type: 'string', description: 'The full text to write.' },
    mode: { type: 'string', description: 'create, overwrite or append.', enum: ['create', 'overwrite', 'append'] },
  }, required: ['path', 'content'] },
  describe: (a) => `${a.mode === 'overwrite' ? 'Replace' : a.mode === 'append' ? 'Add to' : 'Create'} ${String(a.path)} (${String(a.content ?? '').length.toLocaleString('en')} characters)`,
  async run(a, ctx) {
    const r = resolveInFolders(ctx.folders, a.path, true);
    if ('error' in r) return { ok: false, text: r.error, summary: r.error };
    const content = String(a.content ?? '');
    if (content.length > MAX_WRITE) return { ok: false, text: 'That is more than 2 MB of text; write it in parts with mode "append".', summary: 'Too large' };
    const mode = (a.mode as string) || 'create';
    const exists = existsSync(r.path);
    if (exists && statSync(r.path).isDirectory()) return { ok: false, text: `${r.path} is a folder. Give a file name.`, summary: 'That is a folder' };
    if (exists && mode === 'create') return { ok: false, text: `${r.path} already exists. Use mode "overwrite" to replace it or "append" to add to it, or pick another name.`, summary: 'File already exists' };
    mkdirSync(dirname(r.path), { recursive: true });
    if (mode === 'append') appendFileSync(r.path, content); else writeFileSync(r.path, content);
    const size = statSync(r.path).size;
    const verb = mode === 'append' ? 'Added to' : exists ? 'Replaced' : 'Created';
    return { ok: true, text: `${verb} ${r.path} (${fmtSize(size)}).`, summary: `${verb} ${basename(r.path)}`, data: { path: r.path } };
  },
};

/**
 * Changes part of a file: replaces an exact passage (0.9.1). Safer than rewriting a whole file with
 * files.write, which small models get wrong on long files (dropped sections).
 */
export const filesEdit: Tool = {
  name: 'files.edit', label: 'Editing a file', risk: 'risky',
  description: 'Change part of an existing text file: replace an exact passage with new text. Read the file first and copy the passage exactly (spaces and line breaks included). The passage must appear once, unless all is true.',
  parameters: { type: 'object', properties: {
    path: { type: 'string', description: 'File path (absolute, or relative to the first allowed folder).' },
    find: { type: 'string', description: 'The exact text to replace, copied from the file.' },
    replace: { type: 'string', description: 'The new text (empty to delete the passage).' },
    all: { type: 'boolean', description: 'Replace every place it appears (default false).' },
  }, required: ['path', 'find', 'replace'] },
  describe: (a) => `Change ${String(a.path)}: replace “${String(a.find ?? '').replace(/\s+/g, ' ').slice(0, 60)}${String(a.find ?? '').length > 60 ? '…' : ''}”`,
  async run(a, ctx) {
    const r = resolveInFolders(ctx.folders, a.path, true);
    if ('error' in r) return { ok: false, text: r.error, summary: r.error };
    if (!existsSync(r.path) || statSync(r.path).isDirectory()) return { ok: false, text: `${r.path} isn't a file. Use files.list to find it, or files.write to create it.`, summary: 'No such file' };
    const find = String(a.find ?? ''), repl = String(a.replace ?? '');
    if (!find) return { ok: false, text: 'Give the exact text to replace in "find" (read the file first).', summary: 'Nothing to find' };
    const before = readFileSync(r.path, 'utf8');
    // Files saved on Windows use CRLF; let a passage written with \n match it.
    const crlf = !before.includes(find) && before.includes('\r\n') && before.includes(find.replace(/\r?\n/g, '\r\n'));
    const f = crlf ? find.replace(/\r?\n/g, '\r\n') : find, rp = crlf ? repl.replace(/\r?\n/g, '\r\n') : repl;
    const count = before.split(f).length - 1;
    if (!count) return { ok: false, text: `That passage isn't in ${basename(r.path)}. Read the file again with files.read and copy the passage exactly.`, summary: 'Passage not found' };
    if (count > 1 && a.all !== true) return { ok: false, text: `That passage appears ${count} times in ${basename(r.path)}. Include more of the surrounding text so it is unique, or set all to true.`, summary: `Passage appears ${count} times` };
    const after = a.all === true ? before.split(f).join(rp) : before.replace(f, () => rp);
    writeFileSync(r.path, after);
    const n = a.all === true ? count : 1;
    return { ok: true, text: `Changed ${n} place${n > 1 ? 's' : ''} in ${r.path} (${fmtSize(statSync(r.path).size)}).`, summary: `Edited ${basename(r.path)}`, data: { path: r.path } };
  },
};

export const FILE_TOOLS = [filesList, filesRead, filesSearch, filesWrite, filesEdit];
