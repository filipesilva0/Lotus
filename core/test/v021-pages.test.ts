// 0.21: one accent across the app (no page colours), and Tasks split into Tasks and Assistant.
import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PAGES, WORKSPACES, pageShortcut, pageFromName, VIEW_TITLES } from '../../src/components/rail/pages';
import { APP_PALETTE, PALETTES, SURFACES, accentTokens } from '../../src/styles/palettes';

const SRC = join(import.meta.dir, '../../src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}
const allSource = walk(SRC).map((p) => ({ p, s: readFileSync(p, 'utf8') }));

describe('rail pages', () => {
  test('Tasks and Assistant are two pages, in rail order, with Engines & Models last', () => {
    expect(PAGES.map((p) => p.id)).toEqual(['chat', 'work', 'images', 'voice', 'video', 'tasks', 'assistant', 'engines']);
    expect(WORKSPACES.map((p) => p.id)).not.toContain('engines');
    expect(VIEW_TITLES.assistant).toBe('Assistant');
    expect(VIEW_TITLES.tasks).toBe('Tasks');
  });
  test('Ctrl+number follows the rail order and is unique', () => {
    const keys = PAGES.map((p) => pageShortcut(p.id));
    expect(keys).toEqual(PAGES.map((_, i) => `Ctrl+${i + 1}`));
    expect(pageShortcut('video')).toBe('Ctrl+5');
    expect(pageShortcut('tasks')).toBe('Ctrl+6');
    expect(pageShortcut('assistant')).toBe('Ctrl+7');
    expect(pageShortcut('engines')).toBe('Ctrl+8');
    expect(new Set(keys).size).toBe(keys.length);
  });
  test('the Go menu is built from the page list, not a hand-written copy', () => {
    const app = read('App.tsx');
    expect(app).toContain('...PAGES.map((p) => ({ label: p.label, shortcut: pageShortcut(p.id)');
    expect(app).not.toMatch(/label: 'Tasks', shortcut: 'Ctrl\+\d'/);
  });
  test('older page names still open the right page', () => {
    expect(pageFromName('tasks')).toBe('tasks');
    expect(pageFromName('assistant')).toBe('assistant');
    expect(pageFromName('memory')).toBe('assistant');
    expect(pageFromName('skills')).toBe('assistant');
    expect(pageFromName('builder')).toBe('work');
    expect(pageFromName('research')).toBe('chat');
    expect(pageFromName('nope')).toBeNull();
    expect(pageFromName(null)).toBeNull();
  });
});

describe('Tasks and Assistant pages', () => {
  test('Tasks keeps the board, routines and activity only', () => {
    const t = read('components/workspaces/TasksWorkspace.tsx');
    expect(t).toContain("const TABS: Tab[] = ['board', 'routines', 'activity'];");
    expect(t).not.toMatch(/LibraryPane|SkillsView/);
  });
  test('Assistant holds memory, soul, skills and plugins', () => {
    const a = read('components/workspaces/AssistantWorkspace.tsx');
    expect(a).toContain("const TABS: AssistantTab[] = ['memory', 'soul', 'skills', 'plugins'];");
    expect(a).toMatch(/LibraryPane/);
    expect(a).toMatch(/SkillsView/);
  });
  test('the View menu and /library open the Assistant page', () => {
    expect(read('App.tsx')).toContain("setCurrentView('assistant')");
  });
  test('no copy still points to Tasks → Skills, Memory, Soul or Plugins', () => {
    const left = allSource.filter(({ s }) => /Tasks → (Skills|Memory|Soul|Plugins)/.test(s)).map(({ p }) => p);
    expect(left).toEqual([]);
  });
});

// WCAG contrast helpers.
const lum = (hex: string) => {
  const c = hex.replace('#', '').match(/../g)!.map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

describe('one accent', () => {
  test('nothing picks an accent per page any more', () => {
    const hits = allSource.filter(({ s }) => /PAGE_PALETTE|PETAL_ORDER|hueForPage|PAGE_HUES|STEP_PALETTE/.test(s)).map(({ p }) => p);
    expect(hits).toEqual([]);
    expect(read('App.tsx')).toContain('applyThemeToDocument(APP_PALETTE,');
    expect(read('components/rail/LeftRail.tsx')).toContain("tone={on ? 'var(--color-accent-vibrant)'");
  });
  test('the Appearance pane no longer explains page colours', () => {
    expect(read('components/modals/SettingsModal.tsx')).not.toMatch(/Accent colours|petal/i);
  });
  test('the window really uses these tokens', () => {
    const t = read('styles/theme.ts');
    expect(t).toContain('const accent = accentTokens(paletteKey, darkMode);');
    expect(t).toContain("root.style.setProperty('--color-accent-fill', accent.fill);");
    expect(t).toContain("root.style.setProperty('--color-bg-panel', SURFACES.dark.panel);");
  });
  test('the accent is Lotus blue', () => {
    expect(APP_PALETTE).toBe('blue');
  });
  for (const dark of [false, true]) {
    const mode = dark ? 'dark' : 'light';
    test(`${mode}: white labels on filled buttons keep 4.5:1, and the accent stands out from the window (3:1)`, () => {
      const a = accentTokens(APP_PALETTE, dark);
      const s = dark ? SURFACES.dark : SURFACES.light;
      expect(ratio(a.fill, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
      expect(ratio(a.vibrant, s.panel)).toBeGreaterThanOrEqual(3);
      expect(ratio(a.vibrant, s.base)).toBeGreaterThanOrEqual(3);
      expect(a.vibrant).toBe(dark ? PALETTES.blue.vibrantLight : PALETTES.blue.vibrant);
    });
  }
  test('focus rings and text selection still use the accent (0.20 fixes kept)', () => {
    const css = read('index.css');
    expect(css).toContain('--ring: color-mix(in srgb, var(--color-accent-vibrant) 55%, transparent);');
    expect(css).toMatch(/::selection \{ background: color-mix\(in srgb, var\(--color-accent-vibrant\)/);
  });
});
