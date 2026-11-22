// 0.21: the plain-text formats Lotus writes Office files from (DOM-free: the core imports it to build
// the real .docx / .xlsx / .pptx, and the Work page uses it to preview them).
//
//   Word        Markdown: # headings, paragraphs, - and 1. lists, | tables |, > quotes, ``` code, **bold**, *italic*, [links](url)
//   Excel       CSV (or tab-separated, or a Markdown table). "## Sheet name" starts another sheet. =SUM(B2:B4) is a formula.
//   PowerPoint  Markdown: each "---" line (or, without any, each # / ## heading) starts a slide. "Notes:" begins the speaker notes.

export interface Inline { text: string; bold?: boolean; italic?: boolean; code?: boolean; link?: string }

export type Block =
  | { type: 'heading'; level: number; text: Inline[] }
  | { type: 'para'; text: Inline[] }
  | { type: 'list'; ordered: boolean; items: { level: number; text: Inline[] }[] }
  | { type: 'table'; rows: Inline[][][] }
  | { type: 'quote'; text: Inline[] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'rule' };

/** **bold**, *italic* / _italic_, `code`, [text](url). Anything else is plain text. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  const push = (r: Inline) => { if (!r.text) return; const last = out[out.length - 1]; if (last && !last.bold && !last.italic && !last.code && !last.link && !r.bold && !r.italic && !r.code && !r.link) last.text += r.text; else out.push(r); };
  const re = /(\*\*|__)(.+?)\1|(\*|_)(?=\S)(.+?)(?<=\S)\3(?![A-Za-z0-9])|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let at = 0, m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    // "snake_case_words" are not italic: an underscore inside a word is just a character.
    if (m[3] === '_' && m.index > 0 && /\w/.test(src[m.index - 1])) continue;
    push({ text: src.slice(at, m.index) });
    if (m[2] !== undefined) parseInline(m[2]).forEach((r) => push({ ...r, bold: true }));
    else if (m[4] !== undefined) parseInline(m[4]).forEach((r) => push({ ...r, italic: true }));
    else if (m[5] !== undefined) push({ text: m[5], code: true });
    else push({ text: m[6], link: m[7] });
    at = m.index + m[0].length;
  }
  push({ text: src.slice(at) });
  return out;
}

export const plain = (t: Inline[]) => t.map((r) => r.text).join('');

const cellsOf = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const isTableRule = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

/** Markdown → blocks (the subset documents and slides need). */
export function parseBlocks(md: string): Block[] {
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) { out.push({ type: 'para', text: parseInline(para.join(' ').trim()) }); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*(```|~~~)\s*([\w+-]*)/.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) body.push(lines[i]);
      out.push({ type: 'code', lang: fence[2].toLowerCase(), text: body.join('\n') });
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) { flush(); out.push({ type: 'heading', level: h[1].length, text: parseInline(h[2]) }); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push({ type: 'rule' }); continue; }
    if (line.trim().startsWith('|') && i + 1 < lines.length && isTableRule(lines[i + 1])) {
      flush();
      const rows: Inline[][][] = [cellsOf(line).map(parseInline)];
      for (i += 2; i < lines.length && lines[i].trim().startsWith('|'); i++) rows.push(cellsOf(lines[i]).map(parseInline));
      i--;
      out.push({ type: 'table', rows });
      continue;
    }
    const li = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/.exec(line);
    if (li) {
      flush();
      const ordered = /\d/.test(li[2]);
      const items: { level: number; text: Inline[] }[] = [];
      for (; i < lines.length; i++) {
        const m = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/.exec(lines[i]);
        if (!m) {
          // A wrapped line continues the item before it.
          if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) { items[items.length - 1].text.push({ text: ` ${lines[i].trim()}` }); continue; }
          break;
        }
        if (/\d/.test(m[2]) !== ordered && m[1].length === 0) break;
        items.push({ level: Math.min(4, Math.floor(m[1].replace(/\t/g, '    ').length / 2)), text: parseInline(m[3]) });
      }
      i--;
      out.push({ type: 'list', ordered, items });
      continue;
    }
    const q = /^\s*>\s?(.*)$/.exec(line);
    if (q) { flush(); out.push({ type: 'quote', text: parseInline(q[1]) }); continue; }
    para.push(line.trim());
  }
  flush();
  return out;
}

// ── Spreadsheets ────────────────────────────────────────────────────────────
export interface Sheet { name: string; rows: string[][] }

function csvRows(text: string): string[][] {
  const first = text.split('\n').find((l) => l.trim()) ?? '';
  const sep = first.includes('\t') ? '\t' : first.split(';').length > first.split(',').length ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"' && !cell.trim()) { q = true; cell = ''; }
    else if (c === sep) { row.push(cell.trim()); cell = ''; }
    else if (c === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows.filter((r) => r.some((x) => x !== ''));
}

const SHEET_BAD = /[[\]:*?/\\]/g;

/**
 * Spreadsheet text → sheets. CSV, TSV or Markdown tables; "## Name" (or "# Name", "Sheet: Name") starts a
 * new sheet. Sheet names follow Excel's rules (31 characters, no [ ] : * ? / \, unique).
 */
export function parseSheets(text: string): Sheet[] {
  const sheets: { name: string; lines: string[] }[] = [];
  let cur: { name: string; lines: string[] } | null = null;
  for (const line of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const h = /^\s*(?:#{1,3}\s+(?:sheet\s*:\s*)?|sheet\s*:\s*)(.+?)\s*$/i.exec(line);
    if (h && !line.includes(',') && !line.includes('\t')) { cur = { name: h[1], lines: [] }; sheets.push(cur); continue; }
    if (/^\s*```/.test(line)) continue;
    if (!cur) { cur = { name: 'Sheet1', lines: [] }; sheets.push(cur); }
    cur.lines.push(line);
  }
  const used = new Set<string>();
  return sheets.map((s, i) => {
    const md = s.lines.filter((l) => l.trim());
    const rows = md.length && md.every((l) => l.trim().startsWith('|'))
      ? md.filter((l) => !isTableRule(l)).map(cellsOf)
      : csvRows(s.lines.join('\n'));
    let name = s.name.replace(SHEET_BAD, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || `Sheet${i + 1}`;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${name.slice(0, 28)} ${n}`;
    used.add(name.toLowerCase());
    return { name, rows };
  }).filter((s) => s.rows.length);
}

/** What a cell holds: a formula, a number (with its format), a date, a yes/no, or text. */
export type Cell =
  | { t: 'f'; f: string } | { t: 'n'; v: number; fmt?: 'pct' | 'money' | 'int' | 'dec' }
  | { t: 'd'; v: number; iso: string } | { t: 'b'; v: boolean } | { t: 's'; v: string } | { t: 'e' };

/** Excel's day number for a calendar date (1900 system). */
export const excelDay = (y: number, m: number, d: number) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;

export function cellOf(raw: string): Cell {
  const s = String(raw ?? '').trim();
  if (!s) return { t: 'e' };
  if (/^=[A-Za-z(+-]/.test(s) && s.length > 1) return { t: 'f', f: s.slice(1) };
  const money = /^([$€£])\s?(-?[\d,]*\.?\d+)$|^(-?[\d,]*\.?\d+)\s?([$€£])$/.exec(s);
  if (money) { const v = Number((money[2] ?? money[3]).replace(/,/g, '')); if (Number.isFinite(v)) return { t: 'n', v, fmt: 'money' }; }
  const pct = /^(-?\d+(?:\.\d+)?)\s?%$/.exec(s);
  if (pct) return { t: 'n', v: Number(pct[1]) / 100, fmt: 'pct' };
  // 1,234.5 with real thousands groups; a lone "1,5" stays text (it may be a decimal comma).
  if (/^-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(s) && !/^0\d/.test(s.replace('-', ''))) {
    const v = Number(s.replace(/,/g, ''));
    if (Number.isFinite(v) && Math.abs(v) < 1e15) return { t: 'n', v, fmt: s.includes('.') ? 'dec' : undefined };
  }
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (d) { const [y, m, dd] = [Number(d[1]), Number(d[2]), Number(d[3])]; if (m >= 1 && m <= 12 && dd >= 1 && dd <= 31) return { t: 'd', v: excelDay(y, m, dd), iso: s }; }
  if (/^(true|false)$/i.test(s)) return { t: 'b', v: /^true$/i.test(s) };
  return { t: 's', v: s };
}

// ── Slides ──────────────────────────────────────────────────────────────────
export interface Slide { title: string; subtitle?: string; blocks: Block[]; notes: string }

const NOTES = /^\s*(?:[*_]{2})?(?:speaker\s+)?notes?(?:[*_]{2})?\s*:(?:[*_]{2})?\s*(.*)$/i;

/** Deck Markdown → slides. "---" lines split slides; without any, each # or ## heading starts one. */
export function splitSlides(md: string): Slide[] {
  const text = String(md ?? '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const ruled = lines.some((l) => /^\s*---+\s*$/.test(l));
  const chunks: string[][] = [[]];
  let inCode = false;
  for (const l of lines) {
    if (/^\s*```/.test(l)) inCode = !inCode;
    if (!inCode && (ruled ? /^\s*---+\s*$/.test(l) : /^#{1,2}\s/.test(l) && chunks[chunks.length - 1].some((x) => x.trim()))) {
      chunks.push(ruled ? [] : [l]);
      continue;
    }
    chunks[chunks.length - 1].push(l);
  }
  return chunks.map((c) => {
    const at = c.findIndex((l) => NOTES.test(l));
    const body = at >= 0 ? c.slice(0, at) : c;
    const notes = at >= 0 ? [NOTES.exec(c[at])![1], ...c.slice(at + 1)].join('\n').trim() : '';
    const blocks = parseBlocks(body.join('\n'));
    const hi = blocks.findIndex((b) => b.type === 'heading');
    const title = hi >= 0 ? plain((blocks[hi] as { text: Inline[] }).text) : '';
    const rest = hi >= 0 ? blocks.filter((_, i) => i !== hi) : blocks;
    // A slide with only a title and one short line is a title slide: that line is its subtitle.
    const sub = rest.length === 1 && rest[0].type === 'para' && plain(rest[0].text).length < 140 ? plain(rest[0].text) : undefined;
    return { title, ...(sub ? { subtitle: sub } : {}), blocks: sub ? [] : rest, notes };
  }).filter((s) => s.title || s.blocks.length || s.notes);
}

/** The Office kinds Lotus can write, by extension. */
export const OFFICE_KINDS: Record<string, 'word' | 'spreadsheet' | 'slides'> = { '.docx': 'word', '.xlsx': 'spreadsheet', '.pptx': 'slides' };
export const OFFICE_LABEL: Record<string, string> = { word: 'Word document', spreadsheet: 'Excel spreadsheet', slides: 'PowerPoint deck', page: 'Web page', document: 'Document', table: 'Table', image: 'Image', code: 'Code', data: 'Data', file: 'File' };
