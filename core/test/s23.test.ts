// 0.11.0: text from the documents people attach (PDF, Word, PowerPoint, Excel, OpenDocument, EPUB,
// RTF, HTML). The fixtures in fixtures/docs were made with python-docx, openpyxl, python-pptx,
// reportlab and LibreOffice, so these are real files, not hand-written XML.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DocReadError, docKind, htmlText, rtfText, sheetXmlText, textFromDocument, wordXmlText } from '../../src/lib/docParse';

const dir = join(import.meta.dir, 'fixtures', 'docs');
const file = (name: string) => {
  const buf = readFileSync(join(dir, name));
  return { text: async () => buf.toString('utf8'), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer };
};
const read = (name: string, type = '') => textFromDocument(name, type, file(name));

describe('which files Lotus reads', () => {
  test('kinds by name and type', () => {
    expect(docKind('Report.PDF')).toBe('pdf');
    expect(docKind('x', 'application/pdf')).toBe('pdf');
    expect(docKind('a.docx')).toBe('docx');
    expect(docKind('a.pptx')).toBe('pptx');
    expect(docKind('a.xlsx')).toBe('xlsx');
    expect(docKind('a.odt')).toBe('odf');
    expect(docKind('a.epub')).toBe('epub');
    expect(docKind('a.rtf')).toBe('rtf');
    expect(docKind('a.html')).toBe('html');
    expect(docKind('a.py')).toBe('text');
    expect(docKind('notes', 'text/plain')).toBe('text');
    expect(docKind('a.zip')).toBeNull();
    expect(docKind('a.exe', 'application/octet-stream')).toBeNull();
  });
});

describe('real documents', () => {
  test('PDF: every page, in order', async () => {
    const t = (await read('sample.pdf'))!;
    expect(t).toContain('## Page 1');
    expect(t).toContain('Hello from page one');
    expect(t.indexOf('Second page text')).toBeGreaterThan(t.indexOf('## Page 2'));
  });
  test('PDF without text says it looks scanned', async () => {
    await expect(read('scanned.pdf')).rejects.toThrow(DocReadError);
    await expect(read('scanned.pdf')).rejects.toThrow(/scanned/);
  });
  test('damaged file: a plain error', async () => {
    const bad = { text: async () => 'x', arrayBuffer: async () => new TextEncoder().encode('not a zip').buffer as ArrayBuffer };
    await expect(textFromDocument('broken.docx', '', bad)).rejects.toThrow(/couldn't be opened/);
  });
  test('Word: paragraphs, table cells, entities', async () => {
    const t = (await read('sample.docx'))!;
    expect(t).toContain('Knee rehab plan');
    expect(t).toContain('Quadriceps sets: 3 × 10 & hold 5 s.');
    expect(t).toMatch(/Week 1\tRange of motion/);
  });
  test('Excel: each sheet by name, cells in their columns', async () => {
    const t = (await read('sample.xlsx'))!;
    expect(t).toContain('## Patients');
    expect(t).toContain('Name\tSessions');
    expect(t).toContain('Ana\t12');
    expect(t).toContain('\t\t\tlate cell');
    expect(t).toContain('## Notes\nSecond sheet');
  });
  test('PowerPoint: slides with speaker notes', async () => {
    const t = (await read('sample.pptx'))!;
    expect(t).toContain('## Slide 1');
    expect(t).toContain('Lotus deck');
    expect(t).toContain('First point');
    expect(t).toContain('Notes: Speaker note here');
  });
  test('OpenDocument text and spreadsheet', async () => {
    expect(await read('sample.odt')).toContain('Quadriceps sets');
    const ods = (await read('sample.ods'))!;
    expect(ods).toContain('Ana\t12');
  });
  test('EPUB: chapters in spine order', async () => {
    const t = (await read('sample.epub'))!;
    expect(t.indexOf('Chapter One')).toBeLessThan(t.indexOf('Chapter Two text'));
  });
  test('RTF: control words removed, accents kept', async () => {
    expect(await read('sample.rtf')).toBe('Café notes\nLine two');
  });
});

describe('pure parsers', () => {
  test('HTML drops scripts and keeps blocks', () => {
    expect(htmlText('<html><head><title>x</title></head><body><script>bad()</script><p>One &amp; two</p><ul><li>a</li><li>b</li></ul></body></html>')).toBe('One & two\n- a\n- b');
  });
  test('Word XML tabs and breaks', () => {
    expect(wordXmlText('<w:p><w:r><w:t>a</w:t></w:r><w:r><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t></w:r></w:p>')).toBe('a\tb\nc');
  });
  test('sheet inline strings', () => {
    expect(sheetXmlText('<row r="1"><c r="B1" t="inlineStr"><is><t>hi</t></is></c></row>', [])).toBe('\thi');
  });
  test('RTF unicode escapes', () => {
    expect(rtfText('{\\rtf1 \\u8364? ok\\par}')).toBe('€ ok');
  });
});

// ── Work: agents deployed by the main agent (0.11.0) ────────────────────────
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { openDb } from '../src/db';
import { kvApply } from '../src/kv';
import { AgentService, pool } from '../src/agent/service';
import { parseJob } from '../src/tools/work';
import { fakeOllama, last } from './fakes';

const until = async (f: () => boolean, ms = 8000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 20)); } };

describe('agents.deploy', () => {
  test('job lines: "Name: goal" or just a goal', () => {
    expect(parseJob('Researcher: find three keyboards')).toEqual({ name: 'Researcher', goal: 'find three keyboards' });
    expect(parseJob('Data Analyst: total the sales: by month')).toEqual({ name: 'Data Analyst', goal: 'total the sales: by month' });
    expect(parseJob('find out why the build fails: check the log')).toEqual({ goal: 'find out why the build fails: check the log' });
  });

  test('pool keeps order and the limit', async () => {
    let live = 0, peak = 0;
    const job = (v: number, ms: number) => async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, ms)); live--; return v; };
    expect(await pool([job(1, 30), job(2, 5), job(3, 10), job(4, 1)], 2)).toEqual([1, 2, 3, 4]);
    expect(peak).toBe(2);
  });

  test('the main agent deploys agents on its own; each reports queued → running → done with its steps; results come back', async () => {
    const ol = fakeOllama((ms) => {
      const sys = String(ms[0]?.content ?? '');
      const tools = ms.filter((m) => m.role === 'tool');
      const who = /You are (\w+)\./.exec(sys)?.[1];
      if (who === 'Writer' || who === 'Checker') return tools.length ? { content: `${who} result.` } : { calls: [{ name: 'artifact_read', args: {} }] };
      if (!tools.length) return { calls: [{ name: 'agents_deploy', args: { tasks: ['Writer: draft the intro', 'Checker: check the facts'], context: 'About knees' } }] };
      return { content: `Combined: ${last(ms, 'tool')!.content.replace(/\n/g, ' | ')}` };
    });
    try {
      const dir = mkdtempSync(join(tmpdir(), 's23-'));
      const db = openDb(join(dir, 'lotus.db'));
      kvApply(db, { set: { 'lotus.engineUrls.v1': JSON.stringify({ ollama: ol.url }), 'lotus.settings.v1': JSON.stringify({ agentApproval: 'risky' }) }, remove: [] });
      const events: Record<string, any>[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
      const svc = new AgentService({ db, studio: join(dir, 'studio'), broadcast: (e) => events.push(e) });
      expect(svc.toolsFor({ workId: 'w' }).map((t) => t.name)).toContain('agents.deploy');
      expect(svc.toolsFor({}).map((t) => t.name)).not.toContain('agents.deploy');
      svc.start({ model: 'fake', prompt: 'write about knees', workId: 'w', messages: [{ role: 'system', content: 'You are Lotus.' }, { role: 'user', content: 'write about knees' }] });
      await until(() => events.some((e) => e.kind === 'done' || e.kind === 'error'));
      expect(events.find((e) => e.kind === 'error')).toBeUndefined();
      const helpers = events.filter((e) => e.kind === 'helper').map((e) => e.helper);
      const byName = (n: string) => helpers.filter((h) => h.name === n);
      for (const n of ['Writer', 'Checker']) {
        const list = byName(n);
        expect(list[0].status).toBe('queued');
        expect(list.some((h) => h.status === 'running' && h.current)).toBe(true);
        const end = list[list.length - 1];
        expect(end.status).toBe('done');
        expect(end.steps).toBe(1);
        expect(end.result).toBe(`${n} result.`);
        expect(end.batch).toBe(list[0].batch);
      }
      // Helpers' steps carry their id so the windows can put them under the right card.
      const st = events.filter((e) => e.kind === 'step' && e.step.data?.helper === 'Writer');
      expect(st.length).toBeGreaterThan(0);
      expect(st[0].step.data.helperId).toBe(byName('Writer')[0].id);
      const done = events.find((e) => e.kind === 'done')!;
      expect(done.content).toContain('### Writer');
      expect(done.content).toContain('Checker result.');
      const deploy = events.filter((e) => e.kind === 'step' && e.step.tool === 'agents.deploy' && e.step.status === 'done')[0].step;
      expect(deploy.detail).toContain('2 of 2 agents finished');
      // The Work prompt tells the model to deploy agents by itself.
      expect(ol.requests[0].messages[0].content).toContain('agents.deploy');
    } finally { ol.stop(); }
  });
});

// ── Cards from loose model output (0.11.0) ──────────────────────────────────
import { parseChoices } from '../../src/chat/choices';
import { parseImageProposal } from '../../src/chat/imageProposal';
import { parseLoose } from '../../src/chat/looseBlock';

describe('choices card when the model bends the format', () => {
  const q = '{"question":"Which plan?","type":"single","options":["Strength","Mobility"]}';
  test('```choices still works, and streaming is hidden', () => {
    const p = parseChoices(`Pick one.\n\n\`\`\`choices\n${q}\n\`\`\``);
    expect(p.poll?.questions[0].options).toEqual(['Strength', 'Mobility']);
    expect(p.text).toBe('Pick one.');
    expect(parseChoices('Pick one.\n\n```choices\n{"question":"Wh').pending).toBe(true);
  });
  test('tagged json, untagged, or no fence at all', () => {
    for (const body of [`\`\`\`json\n${q}\n\`\`\``, `\`\`\`\n${q}\n\`\`\``, q, `\`\`\`json\n${q}\`\`\``]) {
      const p = parseChoices(`Pick one.\n\n${body}`);
      expect(p.poll?.questions[0].question).toBe('Which plan?');
      expect(p.text).toBe('Pick one.');
    }
  });
  test('a questionnaire with trailing commas, single quotes and smart quotes', () => {
    const p = parseChoices("Two questions:\n```json\n{'title': 'Plan', questions: [{“question”: “Days?”, “options”: [“2”, “3”,],}, {'question': 'Goal?', 'type': 'text'},],}\n```");
    expect(p.poll?.title).toBe('Plan');
    expect(p.poll?.questions.map((x) => x.type)).toEqual(['single', 'text']);
  });
  test('other JSON in a reply is left alone', () => {
    const code = 'Here is the config:\n```json\n{"port": 8080, "options": ["a", "b"]}\n```';
    expect(parseChoices(code).poll).toBeNull();
    expect(parseChoices(code).text).toBe(code);
  });
});

describe('image card when the model bends the format', () => {
  const j = '{"title":"Fox","prompt":"a red fox in snow","negative":"blurry","aspect":"16:9","steps":30}';
  test('```json, no fence, and }``` on one line', () => {
    for (const body of [`\`\`\`json\n${j}\n\`\`\``, j, `\`\`\`image\n${j}\`\`\``, `\`\`\`\n${j}\n\`\`\``]) {
      const p = parseImageProposal(`Here is your prompt.\n\n${body}`);
      expect(p.proposal?.prompt).toBe('a red fox in snow');
      expect(p.proposal?.aspect).toBe('16:9');
      expect(p.text).toBe('Here is your prompt.');
    }
  });
  test('width and height instead of an aspect; Python-style literals', () => {
    const p = parseImageProposal('```json\n{"prompt": "a lighthouse", "width": 1216, "height": 832, "seed": None}\n```');
    expect(p.proposal?.aspect).toBe('1216x832');
  });
  test('a JSON block that is not an image proposal is left alone', () => {
    const t = 'Data:\n```json\n{"prompt": "hello"}\n```';
    expect(parseImageProposal(t).proposal).toBeNull();
    expect(parseImageProposal(t).text).toBe(t);
  });
  test('a ```json block still streaming that looks like a proposal is hidden', () => {
    expect(parseImageProposal('Prompt:\n```json\n{"prompt": "a fox", "aspect": "1:1"').pending).toBe(true);
  });
  test('parseLoose: unquoted keys, comments, text after', () => {
    expect(parseLoose('{a: 1, // one\n b: [1,2,],} thanks!')).toEqual({ a: 1, b: [1, 2] });
  });
});

describe('image card: prompt in the text, settings in the JSON', () => {
  test('a "Prompt:" line and a settings-only block', () => {
    const p = parseImageProposal('**Prompt:** a cozy cabin in a snowy forest at dusk, warm window light\n\n```json\n{"model": "SDXL", "aspect": "3:2", "steps": 28, "cfg": 6}\n```');
    expect(p.proposal?.prompt).toBe('a cozy cabin in a snowy forest at dusk, warm window light');
    expect(p.proposal?.aspect).toBe('3:2');
  });
  test('settings JSON without any prompt anywhere stays text', () => {
    const t = 'Settings:\n```json\n{"model": "SDXL", "aspect": "3:2", "steps": 28}\n```';
    expect(parseImageProposal(t).proposal).toBeNull();
  });
});
