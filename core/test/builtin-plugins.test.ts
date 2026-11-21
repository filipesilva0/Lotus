// 0.21: Claude's skills and plugins brought into Lotus as built-in plugins (src/plugins/builtin).
//   1. Every built-in plugin is well formed, credited, and only mentions tools Lotus really has.
//   2. Skills stay short enough for small local models.
//   3. A skill is only picked when the message is about it (and never for small talk).
//   4. Built-in plugins can be switched off but not edited or removed, and their slash commands
//      can't be taken by a new plugin.

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILTIN_PLUGINS, NOT_BROUGHT_OVER, builtinPlugins } from '../../src/plugins/builtin';
import { buildPluginBlock, matchPluginSkills } from '../../src/plugins/block';
import { PLUGIN_CREATOR_SKILL } from '../../src/skills/system';

// The plugin store keeps its data in localStorage outside the desktop app; give it one.
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k), key: (i: number) => [...mem.keys()][i] ?? null, get length() { return mem.size; },
};
// Imported by a path string: the store uses browser types (window, IndexedDB) that the core's
// typecheck does not include. Only what the tests use is typed here.
type Plugin = import('../../src/plugins/block').SkillHit['plugin'];
interface StoreApi {
  LIMITS: { skills: number }; RESERVED_COMMANDS: string[];
  validatePlugin(raw: unknown, others: Plugin[]): { plugin: unknown; errors: string[]; warnings: string[] };
  pluginCommands(from?: Plugin[]): { name: string; prompt: string }[];
  plugins: {
    get(): Plugin[]; reload(): void; setEnabled(id: string, on: boolean): void; remove(id: string): void;
    update(id: string, raw: unknown): { errors: string[] };
    install(raw: unknown, origin: 'created' | 'imported'): { id?: string; errors: string[] };
  };
}
const STORE = '../../src/plugins/store';
const { LIMITS, RESERVED_COMMANDS, pluginCommands, plugins, validatePlugin } = (await import(STORE)) as StoreApi;

const toolsDir = join(import.meta.dir, '..', 'src', 'tools');
const LOTUS_TOOLS = new Set(readdirSync(toolsDir).flatMap((f) => [...readFileSync(join(toolsDir, f), 'utf8').matchAll(/name: '([a-z]+\.[a-z]+)'/g)].map((m) => m[1])));
const FILE_EXT = new Set(['md', 'csv', 'html', 'htm', 'svg', 'txt', 'json', 'xml', 'pdf', 'docx', 'xlsx', 'pptx']);

describe('built-in plugins are well formed', () => {
  test('ids, names and skill names are unique', () => {
    const ids = BUILTIN_PLUGINS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith('builtin-'))).toBe(true);
    expect(new Set(BUILTIN_PLUGINS.map((p) => p.name.toLowerCase())).size).toBe(BUILTIN_PLUGINS.length);
    const skills = BUILTIN_PLUGINS.flatMap((p) => p.skills.map((k) => k.name));
    expect(new Set(skills).size).toBe(skills.length);
    expect(skills.length).toBeGreaterThanOrEqual(30);
  });

  test('each one passes the same checks as a user plugin', () => {
    for (const p of BUILTIN_PLUGINS) {
      const v = validatePlugin(p, []);
      expect(v.errors).toEqual([]);
      expect(v.warnings).toEqual([]);
      expect(p.skills.length).toBeLessThanOrEqual(LIMITS.skills);
      expect(p.instructions.length).toBeLessThanOrEqual(1500);
    }
  });

  test('slash commands are unique and do not take a built-in Lotus command', () => {
    const names = BUILTIN_PLUGINS.flatMap((p) => p.commands.map((c) => c.name));
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(RESERVED_COMMANDS).not.toContain(n);
    for (const c of BUILTIN_PLUGINS.flatMap((p) => p.commands)) expect(c.prompt).toContain('{{input}}');
  });

  test('every plugin says where it comes from; MIT ones link the original and name its author', () => {
    for (const p of BUILTIN_PLUGINS) {
      expect(p.credit.note.length).toBeGreaterThan(10);
      if (p.credit.license === 'MIT') {
        expect(p.credit.url).toMatch(/^https:\/\/github\.com\//);
        expect(p.credit.note).toContain('MIT');
      }
    }
    const notices = readFileSync(join(import.meta.dir, '..', '..', 'THIRD_PARTY_LICENSES.md'), 'utf8');
    for (const p of BUILTIN_PLUGINS.filter((x) => x.credit.license === 'MIT')) expect(notices).toContain(p.credit.url!);
    expect(notices).toContain('Copyright (c) 2025 Jesse Vincent');
    expect(notices).toContain('Copyright (c) 2026 Ali Akram');
  });

  test('skills only mention tools Lotus has', () => {
    expect(LOTUS_TOOLS.has('files.read')).toBe(true);
    for (const p of BUILTIN_PLUGINS) {
      for (const text of [p.instructions, ...p.skills.map((k) => k.body)]) {
        for (const m of text.matchAll(/\b(files|web|browser|plan|artifact|agents?|memory|ask|task|todo|routine|image|soul|computer|avatar)\.([a-z]+)\b/g)) {
          if (FILE_EXT.has(m[2])) continue; // "plan.md" is a file name
          expect(LOTUS_TOOLS.has(`${m[1]}.${m[2]}`)).toBe(true);
        }
      }
    }
  });

  test('skills are short, with a clear trigger, for small local models', () => {
    for (const k of BUILTIN_PLUGINS.flatMap((p) => p.skills)) {
      expect(k.body.length).toBeLessThanOrEqual(2000);
      expect(k.whenToUse.length).toBeGreaterThan(30);
      expect(k.description.length).toBeGreaterThan(10);
      expect(k.body.startsWith('# ')).toBe(true);
    }
  });

  test('what was not brought over is listed with a reason', () => {
    expect(NOT_BROUGHT_OVER.length).toBeGreaterThan(5);
    for (const x of NOT_BROUGHT_OVER) expect(x.why.length).toBeGreaterThan(10);
  });

  test('the plugin creator knows the built-in command names', () => {
    for (const n of ['brainstorm', 'review', 'humanize', 'site-audit']) expect(PLUGIN_CREATOR_SKILL).toContain(n);
  });
});

describe('a skill is only picked when relevant', () => {
  const all = builtinPlugins({ 'builtin-caveman': true });
  const top = (q: string) => matchPluginSkills(q, all, 2)[0]?.skill.name ?? null;

  const cases: [string, string][] = [
    ['I want to build an app for my physio clinic, can we brainstorm it?', 'brainstorming'],
    ['my code throws TypeError undefined is not a function, help me debug it', 'systematic-debugging'],
    ['the app crashes when I click save', 'systematic-debugging'],
    ['write unit tests first for this function', 'test-driven-development'],
    ['can you critique this mockup of my landing page?', 'design-critique'],
    ['is my website accessible? check contrast and screen reader', 'accessibility-review'],
    ['what should this button say? write the error message', 'ux-copy'],
    ['turn these interview notes into themes and insights', 'research-synthesis'],
    ['make a bar chart of monthly sales', 'charts-and-graphs'],
    ['write a letter in Word for my landlord', 'word-documents'],
    ['clean up this spreadsheet of expenses', 'spreadsheets'],
    ['make a pitch deck presentation for investors', 'presentations'],
    ['summarise this PDF', 'pdf-files'],
    ['this sounds like ChatGPT wrote it, make it sound human', 'humanizer'],
    ['review this pull request for bugs', 'code-review'],
    ['simplify this code', 'simplify-code'],
    ['check this login code for security vulnerabilities', 'security-review'],
    ['do deep research comparing electric cars for a report', 'deep-research'],
    ['import my memory from ChatGPT', 'import-memory'],
    ['audit my website SEO', 'site-audit'],
    ['draw a flowchart of the signup process', 'diagrams'],
    ['design an iPhone app screen following Apple guidelines', 'apple-platform-design'],
    ['make a landing page html', 'web-page-design'],
  ];
  for (const [q, want] of cases) test(`“${q}” → ${want}`, () => expect(top(q)).toBe(want));

  const none = ['hello', 'what is the weather today', 'write a poem about cats', 'tell me a joke', 'translate this to Portuguese',
    'recommend a good book', 'how do I cook rice', 'plan my trip to Porto', 'what is a good name for my dog',
    'explain quantum computing simply', 'debug', 'is it done yet?', 'give me feedback on my essay', 'make an image of a cat',
    'review my essay', 'write code for a calculator', 'make a chart'];
  test('small talk and everyday questions bring in no skill', () => {
    for (const q of none) expect({ q, skill: top(q) as string | null }).toEqual({ q, skill: null });
  });

  test('at most two skills, and none from a plugin that is off', () => {
    expect(matchPluginSkills('design an iPhone app screen following Apple guidelines', all, 5).length).toBeGreaterThan(2);
    const block = buildPluginBlock('design an iPhone app screen following Apple guidelines', all);
    expect((block.match(/### Skill:/g) ?? []).length).toBe(2);
    const designOff = builtinPlugins({ 'builtin-design': false });
    expect(matchPluginSkills('design an iPhone app screen following Apple guidelines', designOff)).toEqual([]);
  });

  test('caveman only changes replies when switched on (it starts off)', () => {
    expect(buildPluginBlock('hello', builtinPlugins())).toBe('');
    expect(buildPluginBlock('hello', builtinPlugins({ 'builtin-caveman': true }))).toContain('Caveman mode is on');
  });
});

describe('built-in plugins in the store', () => {
  test('they are installed, on by default except Caveman, and listed after the user’s own', () => {
    const list = plugins.get();
    for (const d of BUILTIN_PLUGINS) {
      const p = list.find((x) => x.id === d.id);
      expect(p?.origin).toBe('builtin');
      expect(p?.enabled).toBe(d.id !== 'builtin-caveman');
    }
    expect(pluginCommands().some((c) => c.name === 'brainstorm')).toBe(true);
    expect(pluginCommands().some((c) => c.name === 'caveman')).toBe(false);
  });

  test('switching one off is remembered; it cannot be edited or removed', () => {
    plugins.setEnabled('builtin-design', false);
    plugins.reload();
    expect(plugins.get().find((p) => p.id === 'builtin-design')?.enabled).toBe(false);
    expect(pluginCommands().some((c) => c.name === 'critique')).toBe(false);
    plugins.remove('builtin-design');
    expect(plugins.get().some((p) => p.id === 'builtin-design')).toBe(true);
    expect(plugins.update('builtin-design', { name: 'X', description: 'y', instructions: 'z' }).errors[0]).toMatch(/can’t be edited/);
    plugins.setEnabled('builtin-design', true);
  });

  test('a new plugin cannot take a built-in plugin’s name or slash command', () => {
    const r1 = plugins.install({ name: 'Mine', description: 'Mine', commands: [{ name: 'review', prompt: 'Look {{input}}' }] }, 'created');
    expect(r1.id).toBeUndefined();
    expect(r1.errors.join(' ')).toContain('/review is already used');
    const r2 = plugins.install({ name: 'Superpowers', description: 'Mine', instructions: 'Be nice.' }, 'imported');
    expect(r2.errors.join(' ')).toContain('already installed');
  });

  test('an older plugin that already uses a built-in command name keeps it', () => {
    const r = plugins.install({ name: 'Old reviewer', description: 'Mine', commands: [{ name: 'my-review', prompt: 'Mine {{input}}' }] }, 'created');
    expect(r.id).toBeDefined();
    // Simulate a plugin saved before 0.21 with /review: user plugins come first and win.
    const cmds = pluginCommands([{ ...plugins.get().find((p) => p.id === r.id)!, commands: [{ name: 'review', description: 'mine', prompt: 'MINE {{input}}' }] }, ...plugins.get().filter((p) => p.origin === 'builtin')]);
    expect(cmds.filter((c) => c.name === 'review')).toHaveLength(1);
    expect(cmds.find((c) => c.name === 'review')?.prompt).toBe('MINE {{input}}');
    plugins.remove(r.id!);
  });
});
