// 0.21: real Word, Excel and PowerPoint files from the plain text a model writes (src/lib/officeText.ts).
//   .docx  docx 9.16.0 (MIT)        Markdown → headings, lists, tables, quotes, code, links
//   .pptx  pptxgenjs 4.0.1 (MIT)    Markdown deck → title slide, bullet slides, tables, speaker notes
//   .xlsx  written here on fflate (MIT, already in the core): CSV / Markdown tables → sheets with
//          numbers, dates, percentages, formulas, a bold frozen header row and fitted column widths.
// All three run inside the compiled lotusd (no Office needed on the computer).

import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, HeadingLevel, LevelFormat, Packer, Paragraph, ShadingType,
  Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';
import PptxGenJS from 'pptxgenjs';
import { strToU8, zipSync } from 'fflate';
import { cellOf, parseBlocks, parseSheets, plain, splitSlides, type Block, type Inline } from '../../../src/lib/officeText';

const ACCENT = '2563EB';
const INK = '1F2937';
const MUTED = '6B7280';

// ── Word ────────────────────────────────────────────────────────────────────
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];

function runs(t: Inline[], base: { bold?: boolean; size?: number; color?: string } = {}): (TextRun | ExternalHyperlink)[] {
  return t.map((r) => {
    const opts = { text: r.text, bold: r.bold || base.bold, italics: r.italic, size: base.size, color: base.color, ...(r.code ? { font: 'Consolas', shading: { type: ShadingType.CLEAR, fill: 'F3F4F6', color: 'auto' } } : {}) };
    return r.link && /^(https?:|mailto:)/i.test(r.link)
      ? new ExternalHyperlink({ link: r.link, children: [new TextRun({ ...opts, style: 'Hyperlink' })] })
      : new TextRun(opts);
  });
}

function wordTable(rows: Inline[][][]): Table {
  const cols = Math.max(...rows.map((r) => r.length));
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: rows.map((r, ri) => new TableRow({
      tableHeader: ri === 0,
      children: Array.from({ length: cols }, (_, ci) => new TableCell({
        width: { size: Math.floor(100 / cols), type: WidthType.PERCENTAGE },
        shading: ri === 0 ? { type: ShadingType.CLEAR, fill: 'EEF2FF', color: 'auto' } : undefined,
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({ children: runs(r[ci] ?? [], { bold: ri === 0 }) })],
      })),
    })),
  });
}

/** Markdown → a .docx file. The first # heading becomes the document title. */
export async function markdownToDocx(md: string, title = ''): Promise<Uint8Array> {
  const blocks = parseBlocks(md);
  const children: (Paragraph | Table)[] = [];
  let lists = 0;
  blocks.forEach((b, i) => {
    switch (b.type) {
      case 'heading':
        children.push(new Paragraph({ heading: i === 0 && b.level === 1 ? HeadingLevel.TITLE : HEADINGS[b.level - 1], children: runs(b.text) }));
        break;
      case 'para': children.push(new Paragraph({ children: runs(b.text), spacing: { after: 120 } })); break;
      case 'quote': children.push(new Paragraph({ children: runs(b.text, { color: MUTED }), indent: { left: 480 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 8 } } })); break;
      case 'rule': children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D1D5DB', space: 4 } } })); break;
      case 'code':
        b.text.split('\n').forEach((line) => children.push(new Paragraph({ shading: { type: ShadingType.CLEAR, fill: 'F3F4F6', color: 'auto' }, spacing: { after: 0 }, children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 19 })] })));
        children.push(new Paragraph({}));
        break;
      case 'table': children.push(wordTable(b.rows), new Paragraph({})); break;
      case 'list': {
        const instance = ++lists;
        b.items.forEach((it) => children.push(new Paragraph({
          children: runs(it.text),
          ...(b.ordered ? { numbering: { reference: 'lotus-numbers', level: it.level, instance } } : { bullet: { level: it.level } }),
        })));
        break;
      }
    }
  });
  if (!children.length) children.push(new Paragraph({ children: [new TextRun(title || ' ')] }));
  const doc = new Document({
    creator: 'Lotus', title: title || plain((blocks.find((b) => b.type === 'heading') as { text: Inline[] } | undefined)?.text ?? []) || 'Document',
    styles: { default: { document: { run: { font: 'Calibri', size: 22, color: INK } } } },
    numbering: { config: [{ reference: 'lotus-numbers', levels: [0, 1, 2, 3, 4].map((level) => ({
      level, format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN, LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER][level],
      text: `%${level + 1}.`, alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
    })) }] },
    sections: [{ children }],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

// ── Excel ───────────────────────────────────────────────────────────────────
const esc = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const colName = (i: number) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
// Styles: 0 normal · 1 header · 2 percent · 3 date · 4 money · 5 decimal
const STYLE = { pct: 2, money: 4, dec: 5, int: 0 } as const;

function sheetXml(rows: string[][]): string {
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const widths = Array.from({ length: cols }, (_, c) => Math.min(60, Math.max(8, ...rows.map((r) => (r[c] ?? '').length + 2))));
  const body = rows.map((r, ri) => {
    const cells = r.map((raw, ci) => {
      const ref = `${colName(ci)}${ri + 1}`;
      const v = ri === 0 ? { t: 's' as const, v: String(raw ?? '').trim() } : cellOf(raw);
      const head = ri === 0 ? ' s="1"' : '';
      switch (v.t) {
        case 'e': return '';
        case 'f': return `<c r="${ref}"${head}><f>${esc(v.f)}</f></c>`;
        case 'n': return `<c r="${ref}"${head || (v.fmt ? ` s="${STYLE[v.fmt]}"` : '')}><v>${v.v}</v></c>`;
        case 'd': return `<c r="${ref}"${head || ' s="3"'}><v>${v.v}</v></c>`;
        case 'b': return `<c r="${ref}"${head} t="b"><v>${v.v ? 1 : 0}</v></c>`;
        default: return v.v ? `<c r="${ref}"${head} t="inlineStr"><is><t xml:space="preserve">${esc(v.v)}</t></is></c>` : '';
      }
    }).join('');
    return `<row r="${ri + 1}">${cells}</row>`;
  }).join('');
  const last = `${colName(cols - 1)}${Math.max(1, rows.length)}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + `<dimension ref="A1:${last}"/>`
    + (rows.length > 1 ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>')
    + `<sheetFormatPr defaultRowHeight="15"/><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    + `<sheetData>${body}</sheetData>`
    + (rows.length > 1 ? `<autoFilter ref="A1:${last}"/>` : '')
    + '</worksheet>';
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="#,##0.00"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF1F2937"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEF2FF"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFC7D2FE"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** The hidden ranges Excel keeps for each sheet's filter buttons. */
function definedNames(sheets: { name: string; rows: string[][] }[]): string {
  const names = sheets.map((s, i) => (s.rows.length > 1
    ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(s.name.replace(/'/g, "''"))}'!$A$1:$${colName(Math.max(1, ...s.rows.map((r) => r.length)) - 1)}$${s.rows.length}</definedName>`
    : '')).join('');
  return names ? `<definedNames>${names}</definedNames>` : '';
}

/** Spreadsheet text (CSV, TSV or Markdown tables; "## Name" per sheet) → a .xlsx file. */
export function textToXlsx(text: string, title = ''): Uint8Array {
  const sheets = parseSheets(text);
  if (!sheets.length) sheets.push({ name: 'Sheet1', rows: [[title || '']] });
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`),
    'docProps/core.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>Lotus</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${definedNames(sheets)}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(STYLES_XML),
  };
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s.rows)); });
  return zipSync(files, { level: 6 });
}

// ── PowerPoint ──────────────────────────────────────────────────────────────
type PText = { text: string; options?: Record<string, unknown> };
const pRuns = (t: Inline[]): PText[] => t.map((r) => ({ text: r.text, options: { ...(r.bold ? { bold: true } : {}), ...(r.italic ? { italic: true } : {}), ...(r.code ? { fontFace: 'Consolas' } : {}), ...(r.link && /^https?:/i.test(r.link) ? { hyperlink: { url: r.link } } : {}) } }));

function slideBody(blocks: Block[]): PText[] {
  const out: PText[] = [];
  const line = (parts: PText[], o: Record<string, unknown>) => {
    if (!parts.length) parts = [{ text: ' ' }];
    parts.forEach((p, k) => out.push({ text: p.text, options: { ...p.options, ...(k === parts.length - 1 ? { breakLine: true } : {}), ...(k === 0 ? o : {}) } }));
  };
  for (const b of blocks) {
    if (b.type === 'list') b.items.forEach((it) => line(pRuns(it.text), { bullet: b.ordered ? { type: 'number' } : true, indentLevel: it.level, paraSpaceAfter: 6 }));
    else if (b.type === 'para') line(pRuns(b.text), { paraSpaceAfter: 8 });
    else if (b.type === 'quote') line(pRuns(b.text), { italic: true, color: MUTED });
    else if (b.type === 'heading') line(pRuns(b.text), { bold: true, color: ACCENT, paraSpaceBefore: 6 });
    else if (b.type === 'code') b.text.split('\n').forEach((l) => line([{ text: l || ' ' }], { fontFace: 'Consolas', fontSize: 14 }));
  }
  return out;
}

/** Deck Markdown → a .pptx file (16:9). */
export async function markdownToPptx(md: string, title = ''): Promise<Uint8Array> {
  const slides = splitSlides(md);
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE'; // 13.33 × 7.5 in
  pres.author = 'Lotus';
  pres.title = title || slides[0]?.title || 'Presentation';
  if (!slides.length) slides.push({ title: title || 'Presentation', blocks: [], notes: '' });
  slides.forEach((s, i) => {
    const sl = pres.addSlide();
    sl.background = { color: 'FFFFFF' };
    const titleOnly = !s.blocks.length;
    if (titleOnly && (i === 0 || s.subtitle)) {
      sl.addShape('rect', { x: 0, y: 0, w: 0.25, h: 7.5, fill: { color: ACCENT }, line: { color: ACCENT } });
      sl.addText(s.title || pres.title, { x: 0.9, y: 2.3, w: 11.5, h: 1.5, fontSize: 40, bold: true, color: INK, fontFace: 'Calibri', fit: 'shrink', valign: 'bottom' });
      if (s.subtitle) sl.addText(s.subtitle, { x: 0.9, y: 3.9, w: 11.5, h: 1, fontSize: 20, color: MUTED, fontFace: 'Calibri', valign: 'top' });
    } else {
      sl.addShape('rect', { x: 0.6, y: 1.35, w: 1.2, h: 0.06, fill: { color: ACCENT }, line: { color: ACCENT } });
      if (s.title) sl.addText(s.title, { x: 0.6, y: 0.4, w: 12.1, h: 0.9, fontSize: 30, bold: true, color: INK, fontFace: 'Calibri', fit: 'shrink', valign: 'bottom' });
      const table = s.blocks.find((b) => b.type === 'table') as Extract<Block, { type: 'table' }> | undefined;
      const text = slideBody(s.blocks.filter((b) => b.type !== 'table'));
      const top = 1.7;
      if (text.length) sl.addText(text as never, { x: 0.6, y: top, w: 12.1, h: table ? 2.2 : 5.3, fontSize: 20, color: INK, fontFace: 'Calibri', valign: 'top', fit: 'shrink' });
      if (table) {
        const rows = table.rows.map((r, ri) => r.map((c) => ({ text: plain(c), options: ri === 0 ? { bold: true, fill: { color: 'EEF2FF' } } : {} })));
        sl.addTable(rows as never, { x: 0.6, y: text.length ? top + 2.4 : top, w: 12.1, fontSize: 14, color: INK, border: { type: 'solid', pt: 0.5, color: 'D1D5DB' }, autoPage: false });
      }
    }
    if (s.notes) sl.addNotes(s.notes);
  });
  const out = await pres.write({ outputType: 'nodebuffer' });
  return new Uint8Array(out as ArrayBuffer);
}

/** Builds the Office file for a name ending .docx, .xlsx or .pptx; null for any other name. */
export async function officeFile(file: string, text: string, title: string): Promise<Uint8Array | null> {
  const ext = file.toLowerCase().slice(file.lastIndexOf('.'));
  if (ext === '.docx') return markdownToDocx(text, title);
  if (ext === '.xlsx') return textToXlsx(text, title);
  if (ext === '.pptx') return markdownToPptx(text, title);
  return null;
}
