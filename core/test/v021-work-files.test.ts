// 0.21 Work mode polish: real Word / Excel / PowerPoint files, code moved out of answers into files,
// the Artifacts panel can be hidden, one prompt box for Chat and Work, and Think in the pill.
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { markdownToDocx, markdownToPptx, textToXlsx, colName } from '../src/tools/office';
import { artifactRead, artifactWrite, codeBlocksToMove, listArtifacts, moveCodeToFiles, officeSource } from '../src/tools/work';
import { openCommand } from '../src/agent/service';
import { cellOf, excelDay, parseBlocks, parseInline, parseSheets, splitSlides } from '../../src/lib/officeText';
import { defaultPanelsFor } from '../../src/lib/panelDefaults';
import { splitThink } from '../../src/work/think';
import { DOCUMENTS } from '../../src/plugins/builtin/documents';

const SRC = join(import.meta.dir, '../../src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
const unzip = (b: Uint8Array) => Object.fromEntries(Object.entries(unzipSync(b)).map(([k, v]) => [k, strFromU8(v)]));
const ctxFor = (workDir: string) => ({ workDir, folders: [workDir], signal: new AbortController().signal, memoryOn: false, fetch, progress: () => undefined } as never);

describe('text formats', () => {
  test('inline Markdown: bold, italic, code, links; snake_case stays plain', () => {
    expect(parseInline('a **b** *c* `d` [e](https://x.y) my_var_name')).toEqual([
      { text: 'a ' }, { text: 'b', bold: true }, { text: ' ' }, { text: 'c', italic: true }, { text: ' ' }, { text: 'd', code: true }, { text: ' ' }, { text: 'e', link: 'https://x.y' }, { text: ' my_var_name' },
    ]);
  });
  test('blocks: headings, lists with levels, tables, quotes, code', () => {
    const b = parseBlocks('# T\n\npara\nmore\n\n- a\n  - b\n1. one\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n> q\n\n```py\nprint(1)\n```');
    expect(b.map((x) => x.type)).toEqual(['heading', 'para', 'list', 'list', 'table', 'quote', 'code']);
    expect((b[2] as { items: { level: number }[] }).items.map((i) => i.level)).toEqual([0, 1]);
    expect((b[4] as { rows: unknown[] }).rows).toHaveLength(2);
  });
  test('cells: numbers, money, percent, dates, formulas, text', () => {
    expect(cellOf('1,234.5')).toEqual({ t: 'n', v: 1234.5, fmt: 'dec' });
    expect(cellOf('$1200')).toEqual({ t: 'n', v: 1200, fmt: 'money' });
    expect(cellOf('25%')).toEqual({ t: 'n', v: 0.25, fmt: 'pct' });
    expect(cellOf('2026-01-01')).toEqual({ t: 'd', v: excelDay(2026, 1, 1), iso: '2026-01-01' });
    expect(excelDay(1900, 3, 1)).toBe(61);
    expect(cellOf('=SUM(B2:B4)')).toEqual({ t: 'f', f: 'SUM(B2:B4)' });
    expect(cellOf('007')).toEqual({ t: 's', v: '007' });
    expect(cellOf('1,5')).toEqual({ t: 's', v: '1,5' });
  });
  test('sheets: CSV, "## Name" for more sheets, Markdown tables, safe unique names', () => {
    const s = parseSheets('a,b\n1,2\n## Costs: Q1/Q2\n| x | y |\n|---|---|\n| 3 | 4 |\n## Costs: Q1/Q2\nk\n1');
    expect(s.map((x) => x.name)).toEqual(['Sheet1', 'Costs  Q1 Q2'.replace(/\s+/g, ' '), 'Costs Q1 Q2 2']);
    expect(s[1].rows).toEqual([['x', 'y'], ['3', '4']]);
    expect(parseSheets('Item,"Cost, total"\nRent,"1,200"')[0].rows).toEqual([['Item', 'Cost, total'], ['Rent', '1,200']]);
  });
  test('slides: --- splits, title slide subtitle, speaker notes', () => {
    const s = splitSlides('# Pitch\nA better way\n---\n# Problem\n- slow\n- costly\nNotes: say it slowly\n---\n# End');
    expect(s.map((x) => x.title)).toEqual(['Pitch', 'Problem', 'End']);
    expect(s[0].subtitle).toBe('A better way');
    expect(s[1].notes).toBe('say it slowly');
    // Without --- each heading starts a slide.
    expect(splitSlides('# A\n- x\n## B\n- y').map((x) => x.title)).toEqual(['A', 'B']);
  });
});

describe('Office files', () => {
  test('.docx is a real Word package with the title, list numbering, table and link', async () => {
    const z = unzip(await markdownToDocx('# Study plan\n\nRead **daily**. See [notes](https://example.com).\n\n1. one\n2. two\n\n| Day | Hours |\n|---|---|\n| Mon | 2 |'));
    expect(Object.keys(z)).toEqual(expect.arrayContaining(['[Content_Types].xml', 'word/document.xml', 'word/numbering.xml', 'word/styles.xml']));
    const doc = z['word/document.xml'];
    expect(doc).toContain('w:val="Title"');
    expect(doc).toContain('Study plan');
    expect(doc).toContain('<w:tbl>');
    expect(doc).toContain('<w:numPr>');
    expect(z['word/_rels/document.xml.rels']).toContain('https://example.com');
  });
  test('.xlsx has typed cells, formulas, styles, a frozen header and one sheet per "## Name"', () => {
    const z = unzip(textToXlsx('Item,Cost,Share,Date\nRent,1200,50%,2026-01-01\nTotal,=SUM(B2:B2),,\n## Notes\nA & B,<x>\n1,2'));
    const s1 = z['xl/worksheets/sheet1.xml'];
    expect(s1).toContain('<c r="B2"><v>1200</v></c>');
    expect(s1).toContain('<c r="C2" s="2"><v>0.5</v></c>');
    expect(s1).toContain(`<c r="D2" s="3"><v>${excelDay(2026, 1, 1)}</v></c>`);
    expect(s1).toContain('<f>SUM(B2:B2)</f>');
    expect(s1).toContain('state="frozen"');
    expect(s1).toContain('<c r="A1" s="1" t="inlineStr">');
    expect(z['xl/workbook.xml']).toContain('<sheet name="Notes" sheetId="2" r:id="rId2"/>');
    expect(z['xl/workbook.xml']).toContain('fullCalcOnLoad="1"');
    expect(z['xl/workbook.xml'].match(/<definedNames>/g)).toHaveLength(1);
    expect(z['xl/worksheets/sheet2.xml']).toContain('A &amp; B');
    expect(z['xl/worksheets/sheet2.xml']).toContain('&lt;x&gt;');
    expect(z['[Content_Types].xml']).toContain('/xl/worksheets/sheet2.xml');
    expect([colName(0), colName(25), colName(26), colName(701)]).toEqual(['A', 'Z', 'AA', 'ZZ']);
  });
  test('.pptx has one slide per --- and the speaker notes', async () => {
    const z = unzip(await markdownToPptx('# Pitch\nA better way\n---\n# Problem\n- slow\nNotes: pause here\n---\n# Numbers\n| a | b |\n|---|---|\n| 1 | 2 |'));
    const slides = Object.keys(z).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k));
    expect(slides).toHaveLength(3);
    expect(z['ppt/slides/slide1.xml']).toContain('Pitch');
    expect(z['ppt/slides/slide2.xml']).toContain('slow');
    expect(z['ppt/slides/slide3.xml']).toContain('<a:tbl>');
    expect(Object.entries(z).some(([k, v]) => k.startsWith('ppt/notesSlides/') && v.includes('pause here'))).toBe(true);
  });
});

describe('artifact.write and artifact.read', () => {
  test('writes .docx / .xlsx / .pptx as real files, keeps their text for previews and revisions', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lotus-office-'));
    for (const [filename, content] of [['report.docx', '# Report\n\nHello'], ['budget.xlsx', 'Item,Cost\nRent,1200'], ['deck.pptx', '# Deck\n---\n# One\n- a']]) {
      const r = await artifactWrite.run({ title: filename, filename, content }, ctxFor(dir));
      expect(r.ok).toBe(true);
      expect(r.text).toContain("don't paste its content into your answer");
      const bytes = readFileSync(join(dir, filename));
      expect(bytes.subarray(0, 2).toString()).toBe('PK');
      expect(officeSource(dir, filename)).toBe(content);
      expect((await artifactRead.run({ filename }, ctxFor(dir))).text).toBe(content);
    }
    expect(listArtifacts(dir).map((a) => a.kind).sort()).toEqual(['slides', 'spreadsheet', 'word']);
    // The kept text is hidden from the list.
    expect(listArtifacts(dir).some((a) => a.file.startsWith('.'))).toBe(false);
  });
  test('the tool tells the model how to write each Office format', () => {
    expect(artifactWrite.description).toContain('.docx');
    expect(artifactWrite.description).toContain('.xlsx');
    expect(artifactWrite.description).toContain('.pptx');
    expect(artifactWrite.description).toContain('=SUM(B2:B9)');
  });
});

describe('code leaves the answer', () => {
  test('pages and long code move; a one-line command stays', () => {
    const c = 'Run:\n```sh\nnpm start\n```\nHere is the page:\n```html\n<!doctype html><title>Shop</title><p>hi</p>\n```\n```py\n' + 'x = 1\n'.repeat(7) + '```';
    const b = codeBlocksToMove(c);
    expect(b.map((x) => x.ext)).toEqual(['.html', '.py']);
  });
  test('moved blocks become files and a short note in the answer', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lotus-code-'));
    const page = '<!doctype html>\n<html><head><title>Coffee Shop</title></head><body>Hi</body></html>';
    const r = await moveCodeToFiles(`Done! Here is the landing page:\n\n\`\`\`html\n${page}\n\`\`\`\n\nEnjoy.`, dir);
    expect(r.saved).toHaveLength(1);
    expect(r.saved[0]).toMatchObject({ file: 'coffee-shop.html', title: 'Coffee Shop', kind: 'page' });
    expect(r.content).toBe('Done! Here is the landing page:\n\n*Saved as coffee-shop.html.*\n\nEnjoy.');
    expect(readFileSync(join(dir, 'coffee-shop.html'), 'utf8')).toBe(page);
    // A second page with the same title doesn't overwrite the first.
    const again = await moveCodeToFiles(`\`\`\`html\n${page}\n\`\`\``, dir);
    expect(again.saved[0].file).toBe('coffee-shop-2.html');
    expect(existsSync(join(dir, 'coffee-shop.html'))).toBe(true);
  });
  test('the core runs it on Work answers and tells the model not to paste files', () => {
    const svc = readFileSync(join(import.meta.dir, '../src/agent/service.ts'), 'utf8');
    expect(svc).toContain('moveCodeToFiles(out.content, workDir)');
    expect(svc).toContain('Never paste code, a whole document or a whole table into your answer');
  });
  test('files open in their own app without a shell', () => {
    expect(openCommand('C:\\a b\\r.docx', 'win32')).toEqual(['explorer.exe', 'C:\\a b\\r.docx']);
    expect(openCommand('/a/r.xlsx', 'darwin')).toEqual(['open', '/a/r.xlsx']);
    expect(openCommand('/a/r.pptx', 'linux')).toEqual(['xdg-open', '/a/r.pptx']);
  });
});

describe('Work page', () => {
  const work = read('components/workspaces/WorkWorkspace.tsx');
  test('the Artifacts panel can be hidden (and starts open on Work)', () => {
    expect(work).not.toMatch(/InspectorPane label="Artifacts" pinned/);
    expect(work).toContain('label="Hide artifacts"');
    expect(defaultPanelsFor('work')).toEqual({ left: true, right: true });
    expect(defaultPanelsFor('chat').right).toBe(false);
  });
  test('Chat and Work share the same prompt parts', () => {
    const composer = read('components/chat/Composer.tsx');
    for (const part of ['ModelMenu', 'DictateButton', 'AttachmentChips', 'useAutoGrow']) {
      expect(work).toContain(`<${part}`.replace('<use', 'use'));
      expect(composer).toContain(`<${part}`.replace('<use', 'use'));
    }
    expect(work).not.toContain('<Popover');
    expect(work).toContain("<PromptText ref={ta} value={text} onChange={(e) => setText(e.target.value)} rows={1}");
  });
  test('Think is sent like Chat sends it, and thinking in the text goes to the pill', () => {
    expect(read('work/store.ts')).toContain('think: !!item.think,');
    expect(read('work/store.ts')).not.toContain('{ think: true }');
    expect(splitThink('<think>plan it</think>The answer.')).toEqual({ answer: 'The answer.', thought: 'plan it' });
    expect(splitThink('I should list files.</think>Done.')).toEqual({ answer: 'Done.', thought: 'I should list files.' });
    expect(splitThink('Plain.')).toEqual({ answer: 'Plain.', thought: '' });
  });
  test('answers end with file cards that open the file', () => {
    expect(work).toContain('<FileCard');
    expect(read('components/workspaces/workFiles.tsx')).toContain("'Open in Word'");
  });
});

describe('Documents plugin', () => {
  test('its skills write real Office files with artifact.write', () => {
    const body = (n: string) => DOCUMENTS.skills.find((s) => s.name === n)!.body;
    expect(body('word-documents')).toContain('.docx');
    expect(body('spreadsheets')).toContain('.xlsx');
    expect(body('presentations')).toContain('.pptx');
    for (const s of DOCUMENTS.skills) expect(s.body).not.toMatch(/Lotus cannot save \.(docx|pptx)/);
  });
});
