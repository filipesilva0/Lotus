// GitHub Flavored Markdown parser (no dependencies, no HTML output).
// Produces a small tree that `markdownLite.tsx` renders as React elements, so model output can
// never inject markup. Covers what chat needs from GFM:
//   blocks : ATX + setext headings, paragraphs, fenced code (``` and ~~~, unclosed while streaming),
//            block quotes (nested), bullet/ordered lists (nested, tight/loose, start number),
//            task-list items, tables with column alignment, thematic breaks, footnote definitions
//   inline : code spans, **strong**, *emphasis*, ***both***, ~~strikethrough~~, [links](url "t"),
//            ![images](url), <autolinks>, bare URL / www. autolinks, backslash escapes,
//            hard/soft line breaks, <br> in table cells, footnote refs [^1], citation refs [1]
// Not supported on purpose: raw HTML (shown as text), indented code blocks (they clash with how
// models indent list continuations), reference-style link definitions.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong' | 'em' | 'del'; c: Inline[] }
  | { t: 'link'; href: string; title?: string; c: Inline[] }
  | { t: 'image'; src: string; alt: string }
  | { t: 'br' }
  | { t: 'cite'; n: number }
  | { t: 'fnref'; id: string };

export type Align = 'left' | 'center' | 'right' | null;

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'h'; level: number; c: Inline[] }
  | { t: 'code'; lang: string; v: string; open: boolean }
  | { t: 'quote'; c: Block[] }
  | { t: 'list'; ordered: boolean; start: number; loose: boolean; items: { task: boolean | null; c: Block[] }[] }
  | { t: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { t: 'hr' }
  | { t: 'footnotes'; items: { id: string; c: Block[] }[] };

// ── block level ─────────────────────────────────────────────────────────────

const RE = {
  fence: /^( {0,3})(`{3,}|~{3,})[ \t]*([^`\s]*)[^`]*$/,
  heading: /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/,
  hr: /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/,
  quote: /^ {0,3}>[ \t]?/,
  list: /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)(.*)$/,
  footdef: /^ {0,3}\[\^([^\]\s]+)\]:[ \t]*(.*)$/,
  setext1: /^ {0,3}=+[ \t]*$/,
  setext2: /^ {0,3}-+[ \t]*$/,
  delim: /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/,
};

const blank = (l: string) => /^[ \t]*$/.test(l);
const indentOf = (l: string) => { let n = 0; for (const ch of l) { if (ch === ' ') n++; else if (ch === '\t') n += 4 - (n % 4); else break; } return n; };
/** Removes up to `n` columns of leading indentation. */
function dedent(l: string, n: number): string {
  let col = 0, i = 0;
  while (i < l.length && col < n) {
    if (l[i] === ' ') col++; else if (l[i] === '\t') col += 4 - (col % 4); else break;
    i++;
  }
  return l.slice(i);
}

/** Splits a table row on unescaped pipes that are not inside code spans. */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '', tick = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (ch === '`') { let n = 0; while (s[i + n] === '`') n++; tick = tick === 0 ? n : tick === n ? 0 : tick; cur += s.slice(i, i + n); i += n - 1; continue; }
    if (ch === '|' && tick === 0) { cells.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

const isTableStart = (lines: string[], i: number) =>
  i + 1 < lines.length && lines[i].includes('|') && RE.delim.test(lines[i + 1]) && lines[i + 1].includes('-') &&
  splitRow(lines[i]).length === splitRow(lines[i + 1]).length;

/** Lines that end a paragraph (a list only interrupts a paragraph if it is a bullet or starts at 1). */
function interrupts(lines: string[], i: number): boolean {
  const l = lines[i];
  if (RE.fence.test(l) || RE.heading.test(l) || RE.hr.test(l) || RE.quote.test(l) || isTableStart(lines, i)) return true;
  const m = RE.list.exec(l);
  if (m && m[4].trim() !== '') return !/^\d/.test(m[2]) || /^1[.)]$/.test(m[2]);
  return false;
}

interface Ctx { foot: { id: string; c: Block[] }[] }

function parseLines(lines: string[], ctx: Ctx): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) { i++; continue; }

    // Fenced code
    const f = RE.fence.exec(line);
    if (f && !(f[2][0] === '`' && line.slice(f[1].length + f[2].length).includes('`'))) {
      const ind = f[1].length, fence = f[2], body: string[] = [];
      let j = i + 1, closed = false;
      for (; j < lines.length; j++) {
        const close = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`);
        if (close.test(lines[j])) { closed = true; break; }
        body.push(dedent(lines[j], ind));
      }
      out.push({ t: 'code', lang: f[3] ?? '', v: body.join('\n'), open: !closed });
      i = closed ? j + 1 : j;
      continue;
    }

    const h = RE.heading.exec(line);
    if (h) { out.push({ t: 'h', level: h[1].length, c: parseInline(h[2] ?? '') }); i++; continue; }

    if (RE.hr.test(line)) { out.push({ t: 'hr' }); i++; continue; }

    if (RE.quote.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && !blank(lines[i])) {
        if (RE.quote.test(lines[i])) inner.push(lines[i].replace(RE.quote, ''));
        else if (inner.length && !interrupts(lines, i)) inner.push(lines[i]); // lazy continuation
        else break;
        i++;
      }
      out.push({ t: 'quote', c: parseLines(inner, ctx) });
      continue;
    }

    if (isTableStart(lines, i)) {
      const head = splitRow(lines[i]);
      const align: Align[] = splitRow(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : null));
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && !blank(lines[i]) && lines[i].includes('|') && !RE.fence.test(lines[i])) {
        const cells = splitRow(lines[i]);
        rows.push(head.map((_, k) => parseInline(cells[k] ?? '')));
        i++;
      }
      out.push({ t: 'table', align, head: head.map((c) => parseInline(c)), rows });
      continue;
    }

    const fd = RE.footdef.exec(line);
    if (fd) {
      const body = [fd[2]];
      i++;
      while (i < lines.length && (blank(lines[i]) ? i + 1 < lines.length && indentOf(lines[i + 1]) >= 2 : indentOf(lines[i]) >= 2)) { body.push(dedent(lines[i], 4)); i++; }
      ctx.foot.push({ id: fd[1], c: parseLines(body, ctx) });
      continue;
    }

    const lm = RE.list.exec(line);
    if (lm) { i = parseList(lines, i, out, ctx); continue; }

    // Paragraph (+ setext heading)
    const para: string[] = [line.replace(/^[ \t]+/, '')];
    i++;
    let setext = 0;
    while (i < lines.length && !blank(lines[i])) {
      if (RE.setext1.test(lines[i])) { setext = 1; i++; break; }
      if (RE.setext2.test(lines[i])) { setext = 2; i++; break; }
      if (interrupts(lines, i)) break;
      para.push(lines[i].replace(/^[ \t]+/, ''));
      i++;
    }
    const text = para.join('\n');
    out.push(setext ? { t: 'h', level: setext, c: parseInline(text) } : { t: 'p', c: parseInline(text) });
  }
  return out;
}

function parseList(lines: string[], i: number, out: Block[], ctx: Ctx): number {
  const first = RE.list.exec(lines[i])!;
  const ordered = /^\d/.test(first[2]);
  const bullet = ordered ? first[2].slice(-1) : first[2];
  const start = ordered ? parseInt(first[2], 10) : 1;
  const items: { task: boolean | null; c: Block[] }[] = [];
  let loose = false;

  while (i < lines.length) {
    const m = RE.list.exec(lines[i]);
    if (!m) break;
    const sameKind = ordered ? /^\d/.test(m[2]) && m[2].slice(-1) === bullet : m[2] === bullet;
    if (!sameKind) break;
    const pad = m[3].length;
    const content = m[1].length + m[2].length + (pad === 0 ? 1 : pad > 4 ? 1 : pad);
    const body: string[] = [pad > 4 ? ' '.repeat(pad - 1) + m[4] : m[4]];
    i++;
    let sawBlank = false, innerBlank = false;
    while (i < lines.length) {
      const l = lines[i];
      if (blank(l)) { sawBlank = true; body.push(''); i++; continue; }
      const ind = indentOf(l);
      if (ind >= content) { if (sawBlank) innerBlank = true; sawBlank = false; body.push(dedent(l, content)); i++; continue; }
      // A sibling item or anything else at a lower indent ends this item.
      if (RE.list.test(l) || sawBlank || interrupts(lines, i)) break;
      body.push(l.trim()); // lazy paragraph continuation
      i++;
    }
    while (body.length && blank(body[body.length - 1])) body.pop();
    let task: boolean | null = null;
    const tm = /^\[([ xX])\][ \t]+/.exec(body[0] ?? '');
    if (tm) { task = tm[1] !== ' '; body[0] = body[0].slice(tm[0].length); }
    const blocks = parseLines(body, ctx);
    if (innerBlank && blocks.length > 1) loose = true;
    items.push({ task, c: blocks });
    if (sawBlank) {
      const nm = lines[i] !== undefined ? RE.list.exec(lines[i]) : null;
      const sibling = !!nm && (ordered ? /^\d/.test(nm[2]) && nm[2].slice(-1) === bullet : nm[2] === bullet);
      if (sibling) loose = true; else break;
    }
  }
  out.push({ t: 'list', ordered, start, loose, items });
  return i;
}

export function parseMarkdown(src: string): Block[] {
  const ctx: Ctx = { foot: [] };
  const blocks = parseLines(src.replace(/\r\n?/g, '\n').split('\n'), ctx);
  if (ctx.foot.length) blocks.push({ t: 'footnotes', items: ctx.foot });
  return blocks;
}

// ── inline level ────────────────────────────────────────────────────────────

const PUNCT = /[!-/:-@[-`{-~]/;
const isWs = (c: string | undefined) => c === undefined || /\s/.test(c);
const isAlnum = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

export const safeHref = (u: string): string | null => {
  const s = u.trim();
  if (/^(https?:|mailto:)/i.test(s)) return s;
  if (/^www\./i.test(s)) return `https://${s}`;
  return null;
};

/** Index of the `]` that closes the `[` at `open`, honouring nesting, escapes and code spans. */
function closeBracket(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { i++; continue; }
    if (c === '`') { const n = runLen(s, i, '`'); const e = s.indexOf('`'.repeat(n), i + n); if (e > 0) { i = e + n - 1; continue; } }
    if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return i;
  }
  return -1;
}

function runLen(s: string, i: number, ch: string) { let n = 0; while (s[i + n] === ch) n++; return n; }

/** Parses `(dest "title")` right after a `]`; returns null if it is not a valid destination. */
function linkDest(s: string, at: number): { href: string; title?: string; end: number } | null {
  if (s[at] !== '(') return null;
  let i = at + 1, depth = 1;
  while (s[i] === ' ') i++;
  let dest = '';
  if (s[i] === '<') { const e = s.indexOf('>', i); if (e < 0) return null; dest = s.slice(i + 1, e); i = e + 1; }
  else {
    const st = i;
    for (; i < s.length; i++) {
      const c = s[i];
      if (c === '\\') { i++; continue; }
      if (c === '(') depth++;
      else if (c === ')') { if (--depth === 0) break; }
      else if (c === ' ' && depth === 1) break;
    }
    dest = s.slice(st, i);
  }
  while (s[i] === ' ') i++;
  let title: string | undefined;
  const q = s[i];
  if (q === '"' || q === "'") { const e = s.indexOf(q, i + 1); if (e < 0) return null; title = s.slice(i + 1, e); i = e + 1; while (s[i] === ' ') i++; }
  if (s[i] !== ')') return null;
  return { href: dest, title, end: i + 1 };
}

/** Finds the closing delimiter run for an emphasis opener; skips code spans. */
function findCloser(s: string, from: number, ch: string, n: number): number {
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { i++; continue; }
    if (c === '`') { const k = runLen(s, i, '`'); const e = s.indexOf('`'.repeat(k), i + k); if (e > 0) { i = e + k - 1; continue; } i += k - 1; continue; }
    if (c !== ch) continue;
    const k = runLen(s, i, ch);
    const ok = k === n || (n >= 3 && k >= 3);
    const rightFlank = !isWs(s[i - 1]);
    const notIntraword = ch !== '_' || !isAlnum(s[i + k]);
    if (ok && rightFlank && notIntraword && i > from) return i;
    i += k - 1;
  }
  return -1;
}

function trimUrl(u: string): string {
  let s = u.replace(/[.,:;!?"'*_~]+$/, '');
  // Drop an unbalanced trailing ")" (the URL was inside parentheses).
  while (s.endsWith(')') && (s.match(/\(/g)?.length ?? 0) < (s.match(/\)/g)?.length ?? 0)) s = s.slice(0, -1);
  return s;
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
  const s = src;
  let i = 0;
  while (i < s.length) {
    const c = s[i];

    if (c === '\\') {
      if (s[i + 1] === '\n') { flush(); out.push({ t: 'br' }); i += 2; continue; }
      if (s[i + 1] !== undefined && PUNCT.test(s[i + 1])) { buf += s[i + 1]; i += 2; continue; }
    }

    if (c === '\n') {
      buf = buf.replace(/ +$/, '');
      flush(); out.push({ t: 'br' }); i++;
      while (s[i] === ' ') i++;
      continue;
    }

    if (c === '`') {
      const n = runLen(s, i, '`');
      const e = s.indexOf('`'.repeat(n), i + n);
      if (e > 0 && s[e + n] !== '`') {
        let v = s.slice(i + n, e).replace(/\n/g, ' ');
        if (v.length > 2 && v.startsWith(' ') && v.endsWith(' ') && v.trim()) v = v.slice(1, -1);
        flush(); out.push({ t: 'code', v }); i = e + n; continue;
      }
      buf += '`'.repeat(n); i += n; continue;
    }

    if (c === '<') {
      const m = /^<(https?:\/\/[^\s<>]+|mailto:[^\s<>]+)>/i.exec(s.slice(i));
      if (m) { flush(); out.push({ t: 'link', href: m[1], c: [{ t: 'text', v: m[1].replace(/^mailto:/i, '') }] }); i += m[0].length; continue; }
      const br = /^<br\s*\/?>/i.exec(s.slice(i));
      if (br) { flush(); out.push({ t: 'br' }); i += br[0].length; continue; }
    }

    if (c === '!' && s[i + 1] === '[') {
      const e = closeBracket(s, i + 1);
      const d = e > 0 ? linkDest(s, e + 1) : null;
      if (d) { flush(); out.push({ t: 'image', src: d.href, alt: s.slice(i + 2, e) }); i = d.end; continue; }
    }

    if (c === '[') {
      const fn = /^\[\^([^\]\s]+)\]/.exec(s.slice(i));
      if (fn) { flush(); out.push({ t: 'fnref', id: fn[1] }); i += fn[0].length; continue; }
      const cite = /^\[(\d{1,2})\](?!\()/.exec(s.slice(i));
      if (cite) { flush(); out.push({ t: 'cite', n: parseInt(cite[1], 10) }); i += cite[0].length; continue; }
      const e = closeBracket(s, i);
      const d = e > 0 ? linkDest(s, e + 1) : null;
      if (d) {
        const href = safeHref(d.href);
        flush();
        const inner = parseInline(s.slice(i + 1, e));
        out.push(href ? { t: 'link', href, title: d.title, c: inner } : { t: 'text', v: s.slice(i + 1, e) });
        i = d.end; continue;
      }
    }

    // Bare URLs (GFM autolink literal): at the start or after a non-word character.
    if ((c === 'h' || c === 'w' || c === 'H' || c === 'W') && !isAlnum(s[i - 1])) {
      const m = /^(https?:\/\/|www\.)[^\s<]+/i.exec(s.slice(i));
      if (m && (m[1].toLowerCase() !== 'www.' || /^www\.[\w-]+\.[\w]/i.test(m[0]))) {
        const url = trimUrl(m[0]);
        flush(); out.push({ t: 'link', href: safeHref(url) ?? url, c: [{ t: 'text', v: url }] }); i += url.length; continue;
      }
    }

    if (c === '*' || c === '_' || c === '~') {
      const n = runLen(s, i, c);
      const leftFlank = !isWs(s[i + n]);
      const intraOk = c !== '_' || !isAlnum(s[i - 1]);
      if (leftFlank && intraOk && (c !== '~' || n <= 2)) {
        const want = c === '~' ? n : Math.min(n, 3);
        const close = findCloser(s, i + n, c, want);
        if (close > 0) {
          const inner = parseInline(s.slice(i + want, close));
          const lead = c === '~' ? '' : c.repeat(n - want);
          if (lead) buf += lead;
          flush();
          if (c === '~') out.push({ t: 'del', c: inner });
          else if (want === 3) out.push({ t: 'strong', c: [{ t: 'em', c: inner }] });
          else out.push({ t: want === 2 ? 'strong' : 'em', c: inner });
          i = close + (c === '~' ? n : want);
          continue;
        }
      }
      buf += c.repeat(n); i += n; continue;
    }

    buf += c; i++;
  }
  flush();
  return out;
}

/** Plain text of an inline list (used for alt text, titles, tests). */
export function inlineText(c: Inline[]): string {
  return c.map((x) => (x.t === 'text' || x.t === 'code' ? x.v : x.t === 'br' ? '\n' : x.t === 'image' ? x.alt : x.t === 'cite' ? `[${x.n}]` : x.t === 'fnref' ? `[^${x.id}]` : inlineText(x.c))).join('');
}
