// 0.21: the logo design skill (Design plugin) and the SVG → PNG tool it uses.
//   1. The skill is in the Design plugin, short, original, covers every step, and /logo runs it.
//   2. It is picked for logo, icon and brand requests only.
//   3. artifact.png turns an SVG artifact into PNGs at exact sizes and a favicon.ico (Work mode only).
//   4. Work mode now gets plugin skills and plugin slash commands, like chat.

import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILTIN_PLUGINS, builtinPlugins } from '../../src/plugins/builtin';
import { DESIGN } from '../../src/plugins/builtin/design';
import { anchorHit, buildPluginBlock, matchPluginSkills } from '../../src/plugins/block';
import { openDb } from '../src/db';
import { AgentService } from '../src/agent/service';
import { chromeCandidates } from '../src/tools/browser';
import { artifactPng, buildIco, cleanSizes, exportPngs, loadableSvg, parseRasterOutput, rasterPage, svgAspect } from '../src/tools/svgpng';
import { artifactWrite } from '../src/tools/work';
import type { ToolCtx } from '../src/agent/types';

const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k), key: (i: number) => [...mem.keys()][i] ?? null, get length() { return mem.size; },
};
type Plugin = import('../../src/plugins/block').SkillHit['plugin'];
interface StoreApi {
  validatePlugin(raw: unknown, others: Plugin[]): { plugin: { skills: Record<string, unknown>[] } | null; errors: string[] };
  expandPluginSlash(text: string, from?: Plugin[]): string;
  pluginCommands(from?: Plugin[]): { name: string; prompt: string }[];
}
const STORE = '../../src/plugins/store';
const { expandPluginSlash, pluginCommands, validatePlugin } = (await import(STORE)) as StoreApi;

const dirs: string[] = [];
const tmp = (tag: string) => { const d = mkdtempSync(join(tmpdir(), `lotus-logo-${tag}-`)); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) try { rmSync(d, { recursive: true, force: true }); } catch { /* busy */ } });

const logo = DESIGN.skills.find((k) => k.name === 'logo-design')!;

describe('the logo design skill', () => {
  test('is in the Design plugin, short enough for small models, and only in one plugin', () => {
    expect(logo).toBeDefined();
    expect(logo.body.length).toBeLessThanOrEqual(2000);
    expect(BUILTIN_PLUGINS.flatMap((p) => p.skills).filter((k) => k.name === 'logo-design').length).toBe(1);
  });

  test('covers every step: brief, three directions, SVG drafts, checks, one refinement, exports', () => {
    const b = logo.body;
    for (const want of ['Brief', 'symbol', 'wordmark', 'combination', 'artifact.write', '4-unit grid', '2–3 hex colours', 'one-colour',
      '16 px', 'Mono and reverse', 'known brand', 'circle or rounded square', 'one refinement', 'logo.svg', 'logo-mono.svg',
      'favicon true', '[16, 32, 64, 128, 256, 512, 1024]', '[44, 50, 150, 300]', 'Microsoft Store']) expect(b).toContain(want);
    // Image generation is for mood only; the logo itself is vector.
    expect(b).toMatch(/image\.generate is only for mood/);
    expect(b).toContain('A logo is vector');
  });

  test('/logo is a Design command that fills in the user’s text', () => {
    const cmd = DESIGN.commands.find((c) => c.name === 'logo')!;
    expect(cmd.prompt).toContain('{{input}}');
    expect(cmd.prompt).toContain('logo-design');
    expect(pluginCommands(builtinPlugins()).some((c) => c.name === 'logo')).toBe(true);
    expect(pluginCommands(builtinPlugins({ 'builtin-design': false })).some((c) => c.name === 'logo')).toBe(false);
  });
});

describe('picked only for logo, icon and brand requests', () => {
  const all = builtinPlugins();
  const names = (q: string) => matchPluginSkills(q, all, 2).map((h) => h.skill.name);

  const yes = ['design a logo for my bakery', 'make me a logo', 'I need a new logo', 'logo for Lotus', 'can you redesign our logos?',
    'I need an app icon for my game', 'make a favicon for my website', 'a wordmark for my physio clinic', 'a monogram with my initials',
    'brand identity for my physio clinic', 'design an icon for my brand', 'make the Microsoft Store tile images', '/logo a coffee shop'];
  for (const q of yes) test(`“${q}” → logo-design first`, () => expect(names(q)[0]).toBe('logo-design'));

  test('the /logo prompt itself brings in the skill', () => {
    expect(names(expandPluginSlash('/logo a coffee shop called Bean', all))[0]).toBe('logo-design');
    expect(buildPluginBlock('design a logo for my bakery', all)).toContain('### Skill: logo-design (from Design)');
  });

  const no = ['make an image of a cat', 'draw me a picture of a sunset', 'write a business plan', 'brand voice for my newsletter',
    'review this design', 'the icon in the toolbar is too small', 'design an iPhone app screen following Apple guidelines',
    'make a landing page html', 'make a bar chart of monthly sales', 'hello', 'mark this task as done', 'what is a symbol in chemistry'];
  test('everything else leaves it out', () => {
    for (const q of no) expect({ q, logo: names(q).includes('logo-design') }).toEqual({ q, logo: false });
  });

  test('the other design skills still win their own requests', () => {
    expect(names('design an iPhone app screen following Apple guidelines')[0]).toBe('apple-platform-design');
    expect(names('can you critique this mockup of my landing page?')[0]).toBe('design-critique');
  });

  test('anchors need every word of a phrase, and user plugins cannot set them', () => {
    expect(anchorHit('app icon please', logo)).toBe(true);
    expect(anchorHit('an icon', logo)).toBe(false);
    expect(anchorHit('the app', logo)).toBe(false);
    expect(anchorHit('logos', logo)).toBe(true);
    const v = validatePlugin({ name: 'Mine', description: 'Mine', skills: [{ name: 'x', body: '# X', whenToUse: 'x', anchors: ['hello'] }] }, []);
    expect(v.errors).toEqual([]);
    expect(v.plugin!.skills[0].anchors).toBeUndefined();
  });
});

const png = (b: Uint8Array) => {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { sig: [...b.slice(1, 4)].map((c) => String.fromCharCode(c)).join(''), w: v.getUint32(16), h: v.getUint32(20) };
};

describe('SVG to PNG', () => {
  test('sizes from a model are cleaned up', () => {
    expect(cleanSizes([300, '44', 50.4, 150, 44, 4, 99999, 'x'])).toEqual([44, 50, 150, 300]);
    expect(cleanSizes('16, 32;48')).toEqual([16, 32, 48]);
    expect(cleanSizes(undefined)).toEqual([]);
  });

  test('aspect ratio and namespace come from the SVG', () => {
    expect(svgAspect('<svg viewBox="0 0 192 64">')).toBe(3);
    expect(svgAspect('<svg width="50" height="100">')).toBe(0.5);
    expect(svgAspect('<svg>')).toBe(1);
    expect(loadableSvg('<svg viewBox="0 0 1 1"/>')).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(loadableSvg('<svg xmlns="http://www.w3.org/2000/svg"/>').match(/xmlns/g)!.length).toBe(1);
  });

  test('the drawing page never contains the output marker itself, and bad colours are dropped', () => {
    const page = rasterPage('<svg viewBox="0 0 64 64"/>', [16], { background: 'red;}</script>', padding: 90 });
    expect(page).not.toContain('LOTUS_PNG_OUT:');
    expect(page).toContain('bg = ""');
    expect(page).toContain('pad = 0.4');
    expect(() => parseRasterOutput('<html></html>')).toThrow(/did not draw/);
    expect(() => parseRasterOutput('<pre>LOTUS_PNG_OUT:{"error":"bad svg"}</pre>')).toThrow('bad svg');
  });

  test('favicon.ico holds the PNGs with a valid directory', () => {
    const a = new Uint8Array([1, 2, 3]), b = new Uint8Array([4, 5]);
    const ico = buildIco([{ size: 16, png: a }, { size: 256, png: b }]);
    const v = new DataView(ico.buffer);
    expect([v.getUint16(0, true), v.getUint16(2, true), v.getUint16(4, true)]).toEqual([0, 1, 2]);
    expect([ico[6], ico[22]]).toEqual([16, 0]); // 256 is written as 0
    expect(v.getUint32(6 + 12, true)).toBe(38);
    expect([...ico.slice(38)]).toEqual([1, 2, 3, 4, 5]);
  });

  test('artifact.png is a Work tool only', () => {
    const svc = new AgentService({ db: openDb(tmp('gate')), studio: tmp('gate-s'), broadcast: () => undefined });
    expect(svc.toolsFor({ workId: 'w1' }).map((t) => t.name)).toContain('artifact.png');
    expect(svc.toolsFor({}).map((t) => t.name)).not.toContain('artifact.png');
  });

  const chrome = chromeCandidates().find((p) => existsSync(p));
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="8" y="8" width="48" height="48" rx="12" fill="#2563eb"/><circle cx="32" cy="32" r="12" fill="#fff"/></svg>';

  test.skipIf(!chrome)('draws real PNGs at exact sizes, with a favicon', async () => {
    const dir = tmp('png');
    const r = await exportPngs(SVG, 'icon', [44, 50, 150, 300], dir, { favicon: true, padding: 10 });
    expect(r.files).toEqual(['icon-44.png', 'icon-50.png', 'icon-150.png', 'icon-300.png']);
    for (const s of [44, 50, 150, 300]) expect(png(readFileSync(join(dir, `icon-${s}.png`)))).toEqual({ sig: 'PNG', w: s, h: s });
    const ico = readFileSync(join(dir, 'favicon.ico'));
    expect(ico.readUInt16LE(4)).toBe(3);
    expect([ico[6], ico[22], ico[38]]).toEqual([16, 32, 48]);
    expect(png(ico.subarray(ico.readUInt32LE(6 + 12)))).toEqual({ sig: 'PNG', w: 16, h: 16 });
  }, 60_000);

  test.skipIf(!chrome)('the tool works on a saved SVG artifact and says what it made', async () => {
    const workDir = tmp('work');
    const ctx = { workDir } as unknown as ToolCtx;
    expect((await artifactWrite.run({ title: 'Logo', filename: 'logo.svg', content: SVG }, ctx)).ok).toBe(true);
    writeFileSync(join(workDir, 'notes.md'), '# notes');
    const r = await artifactPng.run({ filename: 'logo.svg', sizes: [16, 32], favicon: true }, ctx);
    expect(r.ok).toBe(true);
    expect(r.text).toContain('logo-16.png, logo-32.png, favicon.ico');
    expect(png(readFileSync(join(workDir, 'logo-32.png'))).w).toBe(32);
    expect((await artifactPng.run({ filename: 'notes.md', sizes: [16] }, ctx)).ok).toBe(false);
    expect((await artifactPng.run({ filename: 'missing.svg', sizes: [16] }, ctx)).text).toContain('artifact.write');
    expect((await artifactPng.run({ filename: 'logo.svg', sizes: [1] }, ctx)).text).toContain('Give sizes');
    expect((await artifactPng.run({ filename: 'logo.svg', sizes: [16] }, {} as ToolCtx)).ok).toBe(false);
  }, 60_000);
});

describe('Work mode gets plugin skills and commands', () => {
  test('a slash command is filled in; other text is left alone', () => {
    const all = builtinPlugins();
    expect(expandPluginSlash('/logo a bakery called Crumb', all)).toContain('It is for:\n\na bakery called Crumb');
    expect(expandPluginSlash('/LOGO x', all)).toContain('logo-design');
    expect(expandPluginSlash('/notacommand hi', all)).toBe('/notacommand hi');
    expect(expandPluginSlash('please make a logo', all)).toBe('please make a logo');
  });

  test('the Work request adds the plugin block to its system prompt', () => {
    const src = readFileSync(join(import.meta.dir, '..', '..', 'src', 'work', 'store.ts'), 'utf8');
    expect(src).toContain('expandPluginSlash(text.trim())');
    expect(src).toContain("(s.systemPrompt ?? '') + pluginSystemBlock(t)");
  });
});
