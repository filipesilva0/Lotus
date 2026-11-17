// Text out of the common document files people attach (0.11.0): PDF, Word, PowerPoint, Excel,
// OpenDocument, EPUB, RTF and HTML, besides plain text and code. Everything is read on this computer:
// PDF with pdf.js (bundled, loaded only when a PDF is attached), the zip formats with fflate.
// The pure parts (XML → text, RTF → text, kind detection) live here without DOM globals so the
// core's tests can run them; DOMParser is not needed. The window-side entry is lib/docText.ts.
import { TEXT_EXT } from '../chat/helpers';

export type DocKind = 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'odf' | 'epub' | 'rtf' | 'html' | 'text';

/** What Lotus can turn into text, by name (and type when the name has no extension). */
export function docKind(name: string, type = ''): DocKind | null {
  const n = name.toLowerCase();
  if (/\.pdf$/.test(n) || type === 'application/pdf') return 'pdf';
  if (/\.(docx|docm|dotx)$/.test(n)) return 'docx';
  if (/\.(pptx|pptm|ppsx)$/.test(n)) return 'pptx';
  if (/\.(xlsx|xlsm)$/.test(n)) return 'xlsx';
  if (/\.(odt|ods|odp)$/.test(n)) return 'odf';
  if (/\.epub$/.test(n)) return 'epub';
  if (/\.rtf$/.test(n) || type === 'application/rtf' || type === 'text/rtf') return 'rtf';
  if (/\.(html?|xhtml)$/.test(n) || type === 'text/html') return 'html';
  if (type.startsWith('text/') || TEXT_EXT.test(n) || type === 'application/json' || /\.(jsonl|ndjson|srt|vtt|env|cfg|conf|kt|swift|lua|r|m|dart|vue|svelte)$/.test(n)) return 'text';
  return null;
}

/** File types the attach buttons offer (images are added by each page). */
export const DOC_ACCEPT = '.pdf,.docx,.pptx,.xlsx,.odt,.ods,.odp,.epub,.rtf,.html,.htm,.txt,.md,.csv,.tsv,.json,.xml,.yaml,.yml,.log,text/*';

/** A short line naming what can be read, for errors. */
export const READABLE = 'images, PDFs, Word, PowerPoint, Excel, OpenDocument, EPUB, RTF, HTML and text or code files';

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') { const c = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(c) ? String.fromCodePoint(c) : m; }
    return ENT[e.toLowerCase()] ?? m;
  });
}

const tidy = (s: string) => s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/** Word (word/document.xml) and OpenDocument text: paragraphs, line breaks and tabs kept. */
export function wordXmlText(xml: string): string {
  const s = xml
    // A table cell's last paragraph ends with the cell: cells sit side by side, rows on their own lines.
    .replace(/<\/w:p>(\s*<\/w:tc>)/g, '$1').replace(/<\/text:p>(\s*<\/table:table-cell>)/g, '$1')
    .replace(/<\/w:tr>|<\/table:table-row>/g, '\n')
    .replace(/<w:tab\/>|<text:tab\/>/g, '\t')
    .replace(/<w:br[^>]*\/>|<text:line-break\/>/g, '\n')
    .replace(/<\/w:p>|<\/text:p>|<\/text:h>/g, '\n')
    .replace(/<\/w:tc>|<\/table:table-cell>/g, '\t')
    .replace(/<text:s(?: text:c="(\d+)")?\/>/g, (_m, n) => ' '.repeat(Number(n) || 1))
    .replace(/<[^>]+>/g, '');
  return tidy(decodeEntities(s));
}

/** One PowerPoint slide (ppt/slides/slideN.xml): the text runs, one paragraph per line. */
export function slideXmlText(xml: string): string {
  return tidy(decodeEntities(xml.replace(/<a:br\/>/g, '\n').replace(/<\/a:p>/g, '\n').replace(/<[^>]+>/g, '')));
}

/** Excel shared strings (xl/sharedStrings.xml) in order. */
export function sharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decodeEntities([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
}

const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

/** One sheet (xl/worksheets/sheetN.xml) as tab-separated rows. */
export function sheetXmlText(xml: string, strings: string[]): string {
  const rows: string[] = [];
  for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], body = c[2] ?? '';
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const t = /t="(\w+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let val = '';
      if (t === 's' && v != null) val = strings[Number(v)] ?? '';
      else if (t === 'inlineStr') val = decodeEntities([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
      else if (v != null) val = decodeEntities(v);
      const i = ref ? colIndex(ref) : cells.length;
      while (cells.length < i) cells.push('');
      cells[i] = val.replace(/[\t\n]+/g, ' ');
    }
    if (cells.some((x) => x !== '')) rows.push(cells.join('\t'));
  }
  return rows.join('\n');
}

/** HTML / XHTML (also EPUB chapters) as plain text: scripts and styles dropped, blocks on their own lines. */
export function htmlText(html: string): string {
  const s = html
    .replace(/<(script|style|head|svg)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|blockquote|pre|table|ul|ol)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '');
  return tidy(decodeEntities(s));
}

/** RTF as plain text: control words and groups like fonts and colours removed. */
export function rtfText(rtf: string): string {
  let s = rtf.replace(/\{\\\*[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, '')
    .replace(/\{\\(fonttbl|colortbl|stylesheet|info|pict)[\s\S]*?\}\s*\}/g, '');
  s = s.replace(/\\par[d]?\b ?/g, '\n').replace(/\\line\b ?/g, '\n').replace(/\\tab\b ?/g, '\t')
    .replace(/\\'([0-9a-f]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u(-?\d+)\??/g, (_m, n: string) => String.fromCharCode((Number(n) + 65536) % 65536))
    .replace(/\\[a-z]+-?\d* ?/gi, '').replace(/\\([{}\\])/g, '$1').replace(/[{}]/g, '');
  return tidy(s);
}

const num = (p: string) => Number(/(\d+)\.xml$/.exec(p)?.[1] ?? 0);

/** Reads a zip-based document (Word, PowerPoint, Excel, OpenDocument, EPUB). */
export async function zipText(kind: 'docx' | 'pptx' | 'xlsx' | 'odf' | 'epub', bytes: Uint8Array): Promise<string> {
  const { unzipSync, strFromU8 } = await import('fflate');
  const want = (p: string) =>
    kind === 'docx' ? /^word\/(document|footnotes|endnotes)\.xml$/.test(p)
      : kind === 'pptx' ? /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/.test(p)
        : kind === 'xlsx' ? /^xl\/(sharedStrings|workbook|worksheets\/sheet\d+)\.xml$/.test(p)
          : kind === 'odf' ? p === 'content.xml'
            : /\.(x?html?|opf)$/i.test(p);
  const files = unzipSync(bytes, { filter: (f) => want(f.name) });
  const text = (p: string) => (files[p] ? strFromU8(files[p]) : '');
  if (kind === 'docx') return [text('word/document.xml'), text('word/footnotes.xml'), text('word/endnotes.xml')].map(wordXmlText).filter(Boolean).join('\n\n');
  if (kind === 'odf') {
    const xml = text('content.xml');
    if (/<office:spreadsheet/.test(xml)) {
      return [...xml.matchAll(/<table:table-row[^>]*>([\s\S]*?)<\/table:table-row>/g)]
        .map((r) => [...r[1].matchAll(/<table:table-cell[^>]*?(?:\/>|>([\s\S]*?)<\/table:table-cell>)/g)].map((c) => wordXmlText(c[1] ?? '').replace(/\s+/g, ' ')).join('\t').replace(/\t+$/, ''))
        .filter(Boolean).join('\n');
    }
    return wordXmlText(xml.replace(/<\/draw:page>/g, '\n\n'));
  }
  if (kind === 'pptx') {
    const slides = Object.keys(files).filter((p) => p.startsWith('ppt/slides/')).sort((a, b) => num(a) - num(b));
    return slides.map((p) => {
      const notes = slideXmlText(text(`ppt/notesSlides/notesSlide${num(p)}.xml`)).replace(/^\d+$/m, '').trim();
      return `## Slide ${num(p)}\n${slideXmlText(text(p))}${notes ? `\n\nNotes: ${notes}` : ''}`;
    }).join('\n\n');
  }
  if (kind === 'xlsx') {
    const strings = sharedStrings(text('xl/sharedStrings.xml'));
    const names = [...text('xl/workbook.xml').matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => decodeEntities(m[1]));
    const sheets = Object.keys(files).filter((p) => p.startsWith('xl/worksheets/')).sort((a, b) => num(a) - num(b));
    return sheets.map((p, i) => `## ${names[i] ?? `Sheet ${i + 1}`}\n${sheetXmlText(text(p), strings)}`).join('\n\n');
  }
  // EPUB: chapters in reading order from the package's spine.
  const opfPath = Object.keys(files).find((p) => p.endsWith('.opf'));
  let order = Object.keys(files).filter((p) => /\.x?html?$/i.test(p)).sort();
  if (opfPath) {
    const opf = text(opfPath), base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const items = new Map([...opf.matchAll(/<item [^>]*?id="([^"]+)"[^>]*?href="([^"]+)"/g)].map((m) => [m[1], base + decodeURIComponent(m[2])]));
    const spine = [...opf.matchAll(/<itemref [^>]*?idref="([^"]+)"/g)].map((m) => items.get(m[1])).filter((p): p is string => !!p && !!files[p]);
    if (spine.length) order = spine;
  }
  return order.map((p) => htmlText(text(p))).filter(Boolean).join('\n\n');
}

/** PDF text with pdf.js, page by page (scanned pages without a text layer come back empty). */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes, useSystemFonts: true });
  const doc = await task.promise;
  const pages: string[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let line = '', out = '';
      for (const it of content.items as { str?: string; hasEOL?: boolean }[]) {
        if (typeof it.str !== 'string') continue;
        line += it.str;
        if (it.hasEOL) { out += line + '\n'; line = ''; }
      }
      out += line;
      pages.push(`## Page ${i}\n${tidy(out)}`);
      page.cleanup();
    }
  } finally { void task.destroy(); }
  return pages.join('\n\n');
}

export class DocReadError extends Error {}

/**
 * The text of a document, or null when Lotus can't read that kind. Throws DocReadError with a plain
 * message when it is a kind Lotus reads but this file has no text (a scanned PDF) or is damaged.
 */
export async function textFromDocument(name: string, type: string, read: { text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }): Promise<string | null> {
  const kind = docKind(name, type);
  if (!kind) return null;
  if (kind === 'text') return read.text();
  if (kind === 'html') return htmlText(await read.text());
  if (kind === 'rtf') return rtfText(await read.text());
  const bytes = new Uint8Array(await read.arrayBuffer());
  let text: string;
  try { text = kind === 'pdf' ? await pdfText(bytes) : await zipText(kind, bytes); }
  catch (e) { throw new DocReadError(`${name}: couldn't be opened (${e instanceof Error ? e.message : String(e)}). It may be damaged or password-protected.`); }
  if (!text.replace(/## (Page|Slide|Sheet) \d+/g, '').trim()) {
    throw new DocReadError(kind === 'pdf'
      ? `${name}: this PDF has no text layer (it looks scanned). Attach the pages as images instead so a vision model can read them.`
      : `${name}: no text found in it.`);
  }
  return text;
}
