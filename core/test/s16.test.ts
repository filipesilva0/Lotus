// Session 16: Work mode (plan, artifacts, helper agents, ask.user), computer/browser tool gating and
// key mapping, live hardware parsers. Models are faked; real computer/browser control needs a desktop.

import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db';
import { kvApply } from '../src/kv';
import { __clearCapCache } from '../src/agent/llm';
import { AgentService, workFolderName } from '../src/agent/service';
import { artifactKind, listArtifacts, safeName } from '../src/tools/work';
import { sendKeysEscape, toSendKeys } from '../src/tools/computer';
import { chromeCandidates, READ_SCRIPT } from '../src/tools/browser';
import { cpuLoad, linuxCpuTemp, parseAcpiKelvin, parseNvidiaLive } from '../src/hardware';
import { fakeOllama, last } from './fakes';

const dirs: string[] = [];
const tmp = (tag: string) => { const d = mkdtempSync(join(tmpdir(), `lotus-s16-${tag}-`)); dirs.push(d); return d; };
const stops: (() => void)[] = [];
afterAll(() => { stops.forEach((s) => s()); dirs.forEach((d) => { try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows: a test database may still be open; the OS cleans temp */ } }); });
const until = async (f: () => boolean, n = 400) => { for (let i = 0; i < n && !f(); i++) await Bun.sleep(10); expect(f()).toBe(true); };

describe('artifacts', () => {
  test('safe names stay inside the work folder and keep a known type', () => {
    expect(safeName('../../etc/passwd.md')).toBe('passwd.md');
    expect(safeName('C:\\Windows\\evil.html')).toBe('evil.html');
    expect(safeName('notes')).toBe('notes.md');
    expect(safeName('', 'Trip Budget')).toBe('trip-budget.md');
    expect(safeName('run.exe')).toBeNull();
    expect(artifactKind('a.csv')).toBe('table');
    expect(artifactKind('a.html')).toBe('page');
    expect(workFolderName('work-abc/../x')).toBe('work-abcx');
  });
});

describe('work mode run', () => {
  test('plans, writes an artifact, asks the user, and a helper agent works with its own steps', async () => {
    __clearCapCache();
    const ol = fakeOllama((ms) => {
      const sys = ms[0]?.content ?? '';
      const tools = ms.filter((m) => m.role === 'tool').map((m) => (m as { tool_name: string }).tool_name);
      if (sys.startsWith('You are Helper') || sys.includes('You are a helper agent')) return tools.length ? { content: 'Paris, Rome, Lisbon.' } : { calls: [{ name: 'artifact_read', args: {} }] };
      if (!tools.length) return { calls: [{ name: 'plan_set', args: { steps: ['Pick cities', 'Write the plan'] } }] };
      if (tools.length === 1) return { calls: [{ name: 'agent_delegate', args: { goal: 'List three cities' } }] };
      if (tools.length === 2) return { calls: [{ name: 'ask_user', args: { question: 'How many days?', options: ['3', '5'] } }] };
      if (tools.length === 3) return { calls: [{ name: 'artifact_write', args: { title: 'Trip plan', filename: 'trip.md', content: `# Trip\n${last(ms, 'tool')!.content}` } }] };
      if (tools.length === 4) return { calls: [{ name: 'plan_check', args: { step: 2 } }] };
      return { content: 'I made your trip plan (trip.md).' };
    });
    stops.push(ol.stop);
    const db = openDb(tmp('work'));
    const studio = tmp('work-studio');
    kvApply(db, { set: { 'lotus.engineUrls.v1': JSON.stringify({ ollama: ol.url }), 'lotus.settings.v1': JSON.stringify({ agentApproval: 'risky' }) }, remove: [] });
    const events: Record<string, any>[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    const svc = new AgentService({ db, studio, broadcast: (e) => events.push(e) });
    expect(svc.toolsFor({ workId: 'w1' }).map((t) => t.name)).toEqual(expect.arrayContaining(['plan.set', 'artifact.write', 'agent.delegate', 'ask.user', 'web.search']));
    const { runId } = svc.start({ model: 'fake', prompt: 'plan a trip', workId: 'w1', messages: [{ role: 'system', content: 'You are Lotus.' }, { role: 'user', content: 'plan a trip' }] });
    await until(() => events.some((e) => e.kind === 'ask'));
    const ask = events.find((e) => e.kind === 'ask')!;
    expect(ask.question).toBe('How many days?');
    expect(ask.options).toEqual(['3', '5']);
    expect(svc.answer(runId, ask.askId, '5 days')).toBe(true);
    await until(() => events.some((e) => e.kind === 'done' || e.kind === 'error'));
    expect(events.find((e) => e.kind === 'error')).toBeUndefined();
    expect(events.find((e) => e.kind === 'done')!.content).toBe('I made your trip plan (trip.md).');
    const file = join(studio, 'Work', 'w1', 'trip.md');
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('# Trip\nThe user answered: 5 days');
    expect(listArtifacts(join(studio, 'Work', 'w1')).map((a) => [a.file, a.title, a.kind])).toEqual([['trip.md', 'Trip plan', 'document']]);
    const steps = events.filter((e) => e.kind === 'step' && e.step.status === 'done').map((e) => e.step);
    expect(steps.some((s) => s.data?.helper === 'Helper 1' && s.tool === 'artifact.read')).toBe(true);
    expect(steps.find((s) => s.tool === 'plan.set').data.plan).toEqual(['Pick cities', 'Write the plan']);
    expect(steps.find((s) => s.tool === 'agent.delegate').detail).toContain('Helper finished');
    expect(svc.artifactText('w1', 'trip.md')).toContain('# Trip');
    // The Work prompt reached the model.
    expect(ol.requests[0].messages[0].content).toContain('Work mode');
  });

  test('chat runs get ask.user but no work-only tools; computer and browser need their switches', () => {
    const db = openDb(tmp('gate'));
    const svc = new AgentService({ db, studio: tmp('gate-s'), broadcast: () => undefined });
    const names = () => svc.toolsFor({}).map((t) => t.name);
    expect(names()).toContain('ask.user');
    expect(names()).not.toContain('artifact.write');
    expect(names().some((n) => n.startsWith('computer.') || n.startsWith('browser.'))).toBe(false);
    kvApply(db, { set: { 'lotus.settings.v1': JSON.stringify({ computerUse: true, browserUse: true }) }, remove: [] });
    expect(names()).toEqual(expect.arrayContaining(['computer.screenshot', 'computer.click', 'browser.open', 'browser.click']));
    const risk = Object.fromEntries(svc.toolsFor({}).map((t) => [t.name, t.risk]));
    expect([risk['computer.click'], risk['computer.type'], risk['browser.click'], risk['browser.type']]).toEqual(['risky', 'risky', 'risky', 'risky']);
  });

  test('an unanswered question ends with no answer when the run is stopped', async () => {
    __clearCapCache();
    const ol = fakeOllama((ms) => (last(ms, 'tool') ? { content: 'ok' } : { calls: [{ name: 'ask_user', args: { question: 'Continue?' } }] }));
    stops.push(ol.stop);
    const db = openDb(tmp('ask'));
    kvApply(db, { set: { 'lotus.engineUrls.v1': JSON.stringify({ ollama: ol.url }), 'lotus.settings.v1': JSON.stringify({ llmBackend: 'ollama' }) }, remove: [] });
    const events: Record<string, any>[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    const svc = new AgentService({ db, studio: tmp('ask-s'), broadcast: (e) => events.push(e) });
    const { runId } = svc.start({ model: 'fake', prompt: 'x', messages: [{ role: 'user', content: 'x' }] });
    await until(() => events.some((e) => e.kind === 'ask'));
    svc.stop(runId);
    await until(() => events.some((e) => e.kind === 'answered'));
    expect(svc.answer(runId, events.find((e) => e.kind === 'ask')!.askId, 'late')).toBe(false);
  });
});

describe('avatars', () => {
  test('avatar.create saves a look every window sees, and an SVG file', async () => {
    const { avatarCreate } = await import('../src/tools/avatar');
    const db = openDb(tmp('av'));
    const studio = tmp('av-s');
    const kv = new Map<string, string>();
    const ctx = { db, studio, folders: [studio], signal: new AbortController().signal, memoryOn: false, fetch, progress: () => undefined, kvSet: (k: string, v: string) => kv.set(k, v), kvGet: (k: string) => kv.get(k) ?? null };
    const r = await avatarCreate.run({ name: 'Researcher', color: 'teal', shape: 'cloud', expression: 'thinking', shade: 'soft' }, ctx);
    expect(r.ok).toBe(true);
    expect(JSON.parse(kv.get('lotus.avatars.v1')!).researcher).toEqual({ hue: 180, shape: 'cloud', expression: 'thinking', tone: 0.35 });
    const svg = readFileSync(join(studio, 'Avatars', 'Researcher.svg'), 'utf8');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('Researcher');
    expect((await avatarCreate.run({ name: 'X', color: 'plaid' }, ctx)).ok).toBe(false);
  });
});

describe('computer and browser helpers', () => {
  test('shortcuts map to SendKeys', () => {
    expect(toSendKeys('ctrl+l')).toEqual({ keys: '^l', win: false });
    expect(toSendKeys('alt+tab')).toEqual({ keys: '%{TAB}', win: false });
    expect(toSendKeys('ctrl+shift+t')).toEqual({ keys: '^+t', win: false });
    expect(toSendKeys('enter').keys).toBe('{ENTER}');
    expect(toSendKeys('win+r')).toEqual({ keys: 'r', win: true });
    expect(sendKeysEscape('a+b (c) 100%')).toBe('a{+}b {(}c{)} 100{%}');
  });
  test('Chrome is looked for in the usual places, Edge as a fallback', () => {
    const win = chromeCandidates('win32', { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\F\\AppData\\Local' } as NodeJS.ProcessEnv);
    expect(win[0]).toContain('chrome.exe');
    expect(win.some((p) => p.includes('msedge.exe'))).toBe(true);
    expect(chromeCandidates('darwin')[0]).toContain('Google Chrome.app');
  });
  test('the page reader numbers interactive elements', () => {
    expect(READ_SCRIPT).toContain('data-lotus-id');
    expect(() => new Function(`return ${READ_SCRIPT}`)).not.toThrow();
  });
});

describe('live hardware', () => {
  test('nvidia-smi rows with N/A fields', () => {
    const g = parseNvidiaLive('NVIDIA GeForce RTX 4060, 37, 5120, 8188, 61, 72.45, 115.00, 40, 2490\nTesla T4, [N/A], 100, 15360, 40, N/A, 70.00, [N/A], 585\n');
    expect(g[0]).toEqual({ name: 'NVIDIA GeForce RTX 4060', vendor: 'nvidia', loadPct: 37, memUsedMb: 5120, memTotalMb: 8188, tempC: 61, powerW: 72.45, powerLimitW: 115, fanPct: 40, clockMhz: 2490 });
    expect(g[1].loadPct).toBeNull();
    expect(g[1].powerW).toBeNull();
    expect(g[1].fanPct).toBeNull();
  });
  test('ACPI tenths of kelvin to °C', () => {
    expect(parseAcpiKelvin('3232\r\n3082\r\n')).toBe(50.1);
    expect(parseAcpiKelvin('')).toBeNull();
  });
  test('CPU load from two samples', () => {
    const t = (user: number, idle: number) => ({ model: 'x', speed: 1, times: { user, nice: 0, sys: 0, idle, irq: 0 } });
    cpuLoad([t(0, 0), t(0, 0)]);
    const r = cpuLoad([t(50, 50), t(100, 0)]);
    expect(r.perCore).toEqual([50, 100]);
    expect(r.total).toBe(75);
  });
  test('Linux temperature from a fake sysfs', () => {
    const root = tmp('sys');
    const hw = join(root, 'hwmon', 'hwmon3');
    require('node:fs').mkdirSync(hw, { recursive: true });
    require('node:fs').writeFileSync(join(hw, 'name'), 'k10temp\n');
    require('node:fs').writeFileSync(join(hw, 'temp1_input'), '54250\n');
    expect(linuxCpuTemp(root)).toBe(54.25);
  });
});
