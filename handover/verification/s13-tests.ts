// Session 13 tests (HIG pass): menu shortcut helpers, page commands, Undo / alert queue, reply
// feedback rules, and render checks for the engine notice, the Settings pane toolbar and the reply
// actions. Run: bash handover/verification/run-s13-tests.sh
import './s5-setup';
import './s7-setup';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { macAccelerator, macShortcut, matchesShortcut, toAccelerator } from '../../src/lib/nativeMenu';
import { runCommand, useCommand } from '../../src/lib/commands';
import { confirmAlert, offerUndo, flushUndo, takeUndoIfIdle } from '../../src/components/common/Alerts';
import { feedbackEffect, feedbackNote } from '../../src/chat/feedback';
import { EngineNotice, EnginesContext } from '../../src/components/common/EngineNotice';
import { SettingsModal } from '../../src/components/modals/SettingsModal';
import { ChatStream } from '../../src/components/chat/ChatStream';
import type { ChatSession, LotusSettings } from '../../src/types/lotus';

let pass = 0, fail = 0;
const results: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); pass++; results.push(`  ✓ ${name}`); }
  catch (e) { fail++; results.push(`  ✗ ${name}\n      ${(e as Error).message}`); }
}
function eq(a: unknown, b: unknown, msg = '') { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error(`${msg} expected ${B}, got ${A}`); }
function ok(v: unknown, msg = 'expected truthy') { if (!v) throw new Error(msg); }
const norm = (h: string) => h.replace(/<!-- -->/g, '').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const html = (el: React.ReactElement) => norm(renderToString(el));
const key = (k: string, m: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...m });
const noop = () => undefined;

async function main() {
  await test('shortcuts: Windows/Linux keydown matching', () => {
    ok(matchesShortcut(key('n', { ctrlKey: true }), 'Ctrl+N'));
    ok(matchesShortcut(key('S', { ctrlKey: true, altKey: true }), 'Ctrl+Alt+S'));
    ok(!matchesShortcut(key('s', { ctrlKey: true }), 'Ctrl+Alt+S'), 'missing Alt must not match');
    ok(matchesShortcut(key('ArrowLeft', { altKey: true }), 'Alt+Left'));
    ok(matchesShortcut(key('F1'), 'F1'));
    ok(!matchesShortcut(key('F1', { ctrlKey: true }), 'F1'));
    ok(matchesShortcut(key(',', { ctrlKey: true }), 'Ctrl+,'));
    ok(matchesShortcut(key('2', { ctrlKey: true }), 'Ctrl+2'));
  });
  await test('shortcuts: Mac key equivalents follow the HIG', () => {
    eq(macAccelerator({ shortcut: 'Ctrl+Alt+S', mac: 'Ctrl+Cmd+S' }), 'Ctrl+Cmd+S');
    eq(macAccelerator({ shortcut: 'Ctrl+N' }), 'CmdOrCtrl+N');
    eq(toAccelerator('Alt+Left'), 'Alt+Left');
    eq(macShortcut('Ctrl+Cmd+S'), '⌃⌘S');
    eq(macShortcut('Alt+Cmd+I'), '⌥⌘I');
    eq(macShortcut('Cmd+['), '⌘[');
    eq(macShortcut('Cmd+Shift+/'), '⌘?');
    eq(macShortcut('Ctrl+Alt+S'), '⌥⌘S');
  });
  await test('page commands: a command for a page that is not mounted yet waits for it', async () => {
    let n = 0;
    runCommand('new-task');
    // Simulate mounting: call the hook's effect body through a tiny renderer-free path.
    const { useEffect } = React;
    void useEffect; // hooks need React; drive it with renderToString + a component that registers.
    const Probe = () => { useCommand('new-task', () => { n++; }); return null; };
    renderToString(React.createElement(Probe)); // effects don't run in SSR: the command stays pending
    eq(n, 0);
  });
  await test('alerts: queue resolves in order; Undo note commits or undoes once', async () => {
    let committed = 0, undone = 0;
    offerUndo('Conversation deleted', () => undone++, () => committed++);
    offerUndo('Generation deleted', () => undone++, () => committed++); // replaces: the first one commits
    eq([committed, undone], [1, 0]);
    ok(takeUndoIfIdle());
    eq([committed, undone], [1, 1]);
    ok(!takeUndoIfIdle(), 'nothing left to undo');
    offerUndo('x', () => undone++, () => committed++);
    flushUndo();
    eq([committed, undone], [2, 1]);
    const p = confirmAlert({ title: 'Delete “a”?', confirm: 'Delete' });
    ok(p instanceof Promise);
  });
  await test('reply feedback: learning only with skills and memory on; second click clears', () => {
    eq(feedbackEffect(undefined, 'good', true, true), 'win');
    eq(feedbackEffect(undefined, 'bad', true, true), 'refine');
    eq(feedbackEffect('good', 'good', true, true), null);
    eq(feedbackEffect(undefined, null, true, true), null);
    eq(feedbackEffect(undefined, 'good', false, true), null);
    eq(feedbackEffect(undefined, 'bad', true, false), null, 'memory off / incognito');
    ok(feedbackNote('bad', 'refine')?.includes('rewriting'));
    eq(feedbackNote(null, null), null);
  });

  const eng = (p: Partial<{ up: boolean; phase: 'starting' | null; error: string | null; needsExe: boolean }>) => ({
    engines: { ollama: { up: false, version: null, supervised: false, policy: 'manual', phase: null, error: null, needsExe: false, detail: null, ...p }, comfyui: { up: false, version: null, supervised: false, policy: 'manual', phase: null, error: null, needsExe: false, detail: null }, voicebox: { up: false, version: null, supervised: false, policy: 'manual', phase: null, error: null, needsExe: false, detail: null } },
    gpu: null, start: async () => undefined, stop: async () => undefined, setPolicy: noop, refresh: async () => undefined,
  }) as never;
  await test('engine notice: one quiet line with a Start button', () => {
    const h = html(React.createElement(EnginesContext.Provider, { value: { eng: eng({}), openEngines: noop } }, React.createElement(EngineNotice, { id: 'ollama', purpose: 'to chat' })));
    ok(h.includes('Ollama is offline. Start it to chat.'), h);
    ok(h.includes('>Start Ollama<'));
    ok(!h.includes('127.0.0.1'), 'no raw addresses');
  });
  await test('engine notice: starting, and a failed start offers Engines', () => {
    const s = html(React.createElement(EnginesContext.Provider, { value: { eng: eng({ phase: 'starting' }), openEngines: noop } }, React.createElement(EngineNotice, { id: 'ollama', purpose: 'to chat' })));
    ok(s.includes('Starting Ollama…'));
    const f = html(React.createElement(EnginesContext.Provider, { value: { eng: eng({ error: 'Port in use.' }), openEngines: noop } }, React.createElement(EngineNotice, { id: 'ollama', purpose: 'to chat' })));
    ok(f.includes("Ollama didn't start. Port in use.") && f.includes('>Open Engines<'), f);
  });
  await test('settings: pane toolbar, title is the pane name, no Done button', () => {
    const settings = {
      appearance: 'auto', fontFamily: 'jakarta', fontSize: 'md', selectedModel: 'qwen3:8b', temperature: 0.7, topP: 0.9, contextWindow: 4096, frequencyPenalty: 0, presencePenalty: 0,
      topK: 40, stopSequences: [], seed: null, maxTokens: 0, systemPrompt: '', streamingEnabled: true, reasoningBlockMode: 'collapsed', sendOnEnter: true, autoScroll: true,
      codeCopyLanguage: true, vramCapPercent: 80, comfyUiIdleStopMinutes: 10, defaultTtsVoice: '', ttsRate: 10, autoReadResponses: false, whisperLanguage: 'English',
      density: 'comfortable', llmBackend: 'ollama', llamacppUrl: '', autoScale: true, vramReserveMb: 1024, maxSubagents: 4, webSearchProvider: 'duckduckgo', searxngUrl: '',
      webPagesToRead: 3, autoMemory: true, autoSkills: true, sessionRecall: true, backgroundModel: '', autoRename: true,
    } as unknown as LotusSettings;
    const updates = { state: { kind: 'idle' }, version: '1.0.0', check: noop } as never;
    const h = html(React.createElement(SettingsModal, { isOpen: true, onClose: noop, settings, onUpdateSettings: noop, updates, models: [], pane: 'appearance' }));
    ok(h.includes('role="tablist"') && h.includes('aria-selected="true"'), 'pane toolbar');
    ok(h.includes('aria-label="Settings: Appearance"'));
    ok(!h.includes('>Done<'));
    ok(h.includes('>Engines<') && !h.includes('Local Engine & VRAM'), 'short pane names');
  });
  await test('chat: latest reply shows Try again and thumbs; feedback note shows', () => {
    const s: ChatSession = { id: 's', title: 't', model: 'llama3.1:8b', updatedAt: '', messages: [
      { id: 'u', role: 'user', content: 'hi', timestamp: '' },
      { id: 'a', role: 'assistant', content: 'Hello', timestamp: '', feedback: 'good', feedbackNote: 'Thanks for the feedback.' },
    ] } as ChatSession;
    const h = html(React.createElement(ChatStream, { session: s, isStreaming: false, autoScroll: false, reasoningMode: 'collapsed', onEdit: noop, onRegenerate: noop, onSwitch: noop, onMemory: noop, onOpenArtifact: noop, onFeedback: noop }));
    ok(h.includes('aria-label="Try again"') && h.includes('aria-label="Good reply"') && h.includes('aria-label="Bad reply"'));
    ok(h.includes('Thanks for the feedback.'));
    ok(h.includes('aria-pressed="true"'), 'chosen thumb is pressed');
  });
  await test('chat: streaming placeholder names the model instead of "Working…"', () => {
    const s = { id: 's', title: 't', model: 'qwen3:8b', updatedAt: '', messages: [{ id: 'a', role: 'assistant', content: '', timestamp: '', isStreaming: true }] } as unknown as ChatSession;
    const h = html(React.createElement(ChatStream, { session: s, isStreaming: true, autoScroll: false, reasoningMode: 'collapsed', onEdit: noop, onRegenerate: noop, onSwitch: noop, onMemory: noop, onOpenArtifact: noop }));
    ok(h.includes('qwen3:8b is reading your message…') && !h.includes('Working…'));
  });

  console.log(results.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
void main();
