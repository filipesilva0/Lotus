// The language the build agent speaks. Local models are unreliable at JSON tool calls, and code
// inside JSON strings needs escaping, so the agent writes plain tags instead:
//   <write_file path="src/App.jsx">…whole file…</write_file>
// parseTurn() turns a (possibly still streaming) reply into prose plus complete actions.

export type Action =
  | { type: 'write_file'; path: string; content: string }
  | { type: 'replace_in_file'; path: string; old: string; new: string }
  | { type: 'read_file'; path: string }
  | { type: 'list_files'; path: string }
  | { type: 'delete_path'; path: string }
  | { type: 'run_command'; command: string }
  | { type: 'start_server'; command: string }
  | { type: 'preview'; url?: string; dir?: string }
  | { type: 'plan'; markdown: string }
  | { type: 'done'; summary: string };

export interface ParsedTurn {
  /** What the agent said in words, with all action tags removed. */
  prose: string;
  /** Actions whose closing tag has arrived, in order. */
  actions: Action[];
  /** An action that is still being written (for a live "Writing src/App.jsx…" line). */
  pending: { type: Action['type']; path?: string; chars: number } | null;
}

const BLOCK = ['write_file', 'replace_in_file', 'run_command', 'start_server', 'plan', 'done'] as const;
const VOID = ['read_file', 'list_files', 'delete_path', 'preview'] as const;
const OPEN = new RegExp(`<(${[...BLOCK, ...VOID].join('|')})(\\s[^<>]*?)?(\\/)?>`, 'g');

function attrs(s: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-z_]+)\s*=\s*"([^"]*)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s ?? ''))) out[m[1].toLowerCase()] = m[2];
  return out;
}

/** Removes one leading/trailing newline and a markdown fence the model may have wrapped around file content. */
export function cleanBody(raw: string): string {
  let t = raw.replace(/^\r?\n/, '');
  const fence = /^```[\w+-]*\r?\n([\s\S]*?)\r?\n?```\s*$/.exec(t.trimEnd());
  if (fence) t = fence[1];
  return t.replace(/\r?\n$/, '');
}

/** Normalises a path the model wrote: forward slashes, no leading ./ or /. Returns null when it tries to leave the project. */
export function cleanPath(p: string | undefined): string | null {
  if (p === undefined) return null;
  let t = p.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  if (t === '' || t === '.') return '';
  if (/^[a-zA-Z]:/.test(t)) return null;
  if (t.split('/').some((s) => s === '..')) return null;
  t = t.replace(/\/+/g, '/').replace(/\/$/, '');
  return t;
}

export function parseTurn(text: string): ParsedTurn {
  const actions: Action[] = [];
  let pending: ParsedTurn['pending'] = null;
  let prose = '';
  let cursor = 0;
  OPEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = OPEN.exec(text))) {
    const tag = m[1] as (typeof BLOCK)[number] | (typeof VOID)[number];
    const a = attrs(m[2]);
    prose += text.slice(cursor, m.index);
    const afterOpen = m.index + m[0].length;

    if ((VOID as readonly string[]).includes(tag) || m[3]) {
      // Void tag (or any tag written self-closing). An immediate closing tag is swallowed.
      const close = new RegExp(`^\\s*</${tag}>`).exec(text.slice(afterOpen));
      cursor = afterOpen + (close ? close[0].length : 0);
      OPEN.lastIndex = cursor;
      pushVoid(actions, tag, a);
      continue;
    }

    const closeTag = `</${tag}>`;
    const end = text.indexOf(closeTag, afterOpen);
    if (end === -1) {
      pending = { type: tag as Action['type'], path: a.path, chars: text.length - afterOpen };
      cursor = text.length;
      OPEN.lastIndex = text.length;
      break;
    }
    const body = text.slice(afterOpen, end);
    cursor = end + closeTag.length;
    OPEN.lastIndex = cursor;
    switch (tag) {
      case 'write_file': { const p = cleanPath(a.path); if (p) actions.push({ type: 'write_file', path: p, content: cleanBody(body) }); break; }
      case 'replace_in_file': {
        const p = cleanPath(a.path);
        const o = /<old>([\s\S]*?)<\/old>/.exec(body);
        const n = /<new>([\s\S]*?)<\/new>/.exec(body);
        if (p && o && n) actions.push({ type: 'replace_in_file', path: p, old: cleanBody(o[1]), new: cleanBody(n[1]) });
        break;
      }
      case 'run_command': if (body.trim()) actions.push({ type: 'run_command', command: body.trim() }); break;
      case 'start_server': if (body.trim()) actions.push({ type: 'start_server', command: body.trim() }); break;
      case 'plan': actions.push({ type: 'plan', markdown: body.trim() }); break;
      case 'done': actions.push({ type: 'done', summary: body.trim() }); break;
    }
  }
  prose += text.slice(cursor);
  return { prose: prose.replace(/\n{3,}/g, '\n\n').trim(), actions, pending };
}

function pushVoid(actions: Action[], tag: string, a: Record<string, string>) {
  if (tag === 'done') { actions.push({ type: 'done', summary: '' }); return; }
  if (tag === 'preview') {
    const dir = a.dir !== undefined ? cleanPath(a.dir) : undefined;
    actions.push({ type: 'preview', url: a.url, dir: dir ?? undefined });
    return;
  }
  const p = cleanPath(a.path ?? (tag === 'list_files' ? '' : undefined));
  if (p === null || (p === '' && tag !== 'list_files')) return;
  if (tag === 'read_file') actions.push({ type: 'read_file', path: p });
  else if (tag === 'list_files') actions.push({ type: 'list_files', path: p });
  else if (tag === 'delete_path') actions.push({ type: 'delete_path', path: p });
}

/** Counts changed lines for the "+12 −3" badge. */
export function lineDelta(before: string, after: string): { added: number; removed: number } {
  const a = new Map<string, number>();
  for (const l of before.split('\n')) a.set(l, (a.get(l) ?? 0) + 1);
  let added = 0;
  for (const l of after.split('\n')) {
    const n = a.get(l) ?? 0;
    if (n > 0) a.set(l, n - 1); else added++;
  }
  let removed = 0;
  for (const v of a.values()) removed += v;
  return { added, removed };
}

/** Finds a dev-server address in command output. */
export function findServerUrl(output: string): string | null {
  const m = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})[^\s'")]*/i.exec(output);
  if (!m) return null;
  return m[0].replace('0.0.0.0', '127.0.0.1').replace('localhost', '127.0.0.1').replace(/\[::1?\]/, '127.0.0.1').replace(/[.,;:]+$/, '');
}

/** Strips ANSI colour codes that some tools print even when asked not to. */
export const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
