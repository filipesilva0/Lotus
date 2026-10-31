// Session 7 render smoke test: options cards in replies, Library (skills, memory, soul, plugins and
// the plugin creator), the usage dashboard, the profile sheet and the background-tasks setting.
import './s5-setup';
import './s7-setup';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { ChatStream } from '../../src/components/chat/ChatStream';
import { ChoiceCard } from '../../src/components/chat/ChoiceCard';
import { LibrarySheet } from '../../src/components/library/LibrarySheet';
import { UsageDashboard } from '../../src/components/account/UsageDashboard';
import { AccountModal } from '../../src/components/account/AccountModal';
import { SettingsModal } from '../../src/components/modals/SettingsModal';
import { pollFromJson } from '../../src/chat/choices';
import { plugins } from '../../src/plugins/store';
import type { ChatSession, LotusSettings } from '../../src/types/lotus';

let pass = 0, fail = 0;
const norm = (h: string) => h.replace(/<!-- -->/g, '').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
function check(name: string, el: React.ReactElement, ...expect: string[]) {
  try {
    const html = norm(renderToString(el));
    const miss = expect.filter((e) => !html.includes(e));
    if (miss.length) throw new Error(`missing: ${miss.join(' | ')}`);
    pass++; console.log(`  ✓ ${name}`);
  } catch (e) { fail++; console.log(`  ✗ ${name}: ${(e as Error).message}`); }
}
function absent(name: string, el: React.ReactElement, ...never: string[]) {
  try {
    const html = norm(renderToString(el));
    const hit = never.filter((e) => html.includes(e));
    if (hit.length) throw new Error(`should not contain: ${hit.join(' | ')}`);
    pass++; console.log(`  ✓ ${name}`);
  } catch (e) { fail++; console.log(`  ✗ ${name}: ${(e as Error).message}`); }
}
const noop = () => undefined;
const settings = { selectedModel: 'llama3.1:8b', backgroundModel: '', autoRename: true, systemPrompt: 'You are Lotus, a helpful assistant.', temperature: 0.7, topP: 0.9, contextWindow: 4096, autoScale: false, topK: 40, frequencyPenalty: 0, presencePenalty: 0, maxTokens: 0, stopSequences: [], seed: null, darkMode: false, palette: 'blue', fontFamily: 'jakarta', fontSize: 'md' } as unknown as LotusSettings;
const t = 1_790_000_000_000;
const session: ChatSession = { id: 's', title: 'x', model: 'llama3.1:8b', updatedAt: '', category: '', ts: t, messages: [
  { id: `user-${t}`, role: 'user', content: 'Help me plan', timestamp: '' },
  { id: `assistant-${t + 1}`, role: 'assistant', content: 'A few questions:\n\n```choices\n{"title":"Your plan","questions":[{"question":"Days per week?","options":["2","3"]},{"question":"Goals","type":"multi","options":["Mobility","Strength"]}]}\n```', timestamp: '', tokensPerSec: 30 },
] };

check('Chat stream: choices block becomes a questionnaire card, JSON hidden', <ChatStream session={session} isStreaming={false} autoScroll={false} reasoningMode="collapsed" onEdit={noop} onRegenerate={noop} onSwitch={noop} onMemory={noop} onOpenArtifact={noop} onAnswer={noop} />,
  'A few questions:', 'Your plan', 'Days per week?', 'role="radio"', 'role="checkbox"', 'Send answers', 'Something else');
absent('Chat stream: raw choices JSON is never shown', <ChatStream session={session} isStreaming={false} autoScroll={false} reasoningMode="collapsed" onEdit={noop} onRegenerate={noop} onSwitch={noop} onMemory={noop} onOpenArtifact={noop} onAnswer={noop} />, '"questions"', '```');
check('Choice card: answered state is read-only and marks the pick', <ChoiceCard poll={pollFromJson({ question: 'Pick', options: ['Red', 'Blue'] })!} answered="Blue" enabled={false} onAnswer={noop} />, 'Answered', 'aria-checked="true"', 'disabled');
check('Usage dashboard: tiles and charts from saved chats', <UsageDashboard sessions={[session]} />, 'Your usage', 'Chats', 'Messages sent', 'Average speed', 'Activity', 'Models', 'When you chat', 'Features', 'llama3.1:8b', '30 tok/s');
check('Profile sheet: usage for signed-out users', <AccountModal open view="profile" onView={noop} onClose={noop} sessions={[session]} />, 'Your profile', 'Not signed in', 'Your usage');
check('Library: skills tab lists system skills', <LibrarySheet open tab="skills" onTab={noop} onClose={noop} settings={settings} onSettings={noop} />, 'Library', 'System skills', 'plugin-creator', 'interactive-choices', 'chat-titler', 'Built into Lotus');
check('Library: memory tab shows memory.md', <LibrarySheet open tab="memory" onTab={noop} onClose={noop} settings={settings} onSettings={noop} />, 'memory.md', 'Long-term memory', 'Standing instructions');
check('Library: soul tab shows the system prompt', <LibrarySheet open tab="soul" onTab={noop} onClose={noop} settings={settings} onSettings={noop} />, 'System prompt', 'You are Lotus, a helpful assistant.', 'Edit');
plugins.install({ name: 'Standup', description: 'Daily updates', commands: [{ name: 'standup', description: 'Write it', prompt: 'Notes: {{input}}' }] }, 'created');
check('Library: plugins tab with the creator and installed plugins', <LibrarySheet open tab="plugins" onTab={noop} onClose={noop} settings={settings} onSettings={noop} />, 'Create a plugin', 'Draft with Lotus', 'plugin-creator', 'Installed', 'Standup', 'Import plugin file');
check('Settings: background tasks model replaces the old checkpoint list', <SettingsModal isOpen onClose={noop} settings={settings} onUpdateSettings={noop} models={[{ id: 'gemma3:1b', name: 'gemma3:1b', tag: '1B' }]} updates={{ state: { kind: 'idle' }, version: '0.1.0', check: async () => undefined, install: async () => undefined } as never} />,
  'Background tasks model', 'Same as the chat model (llama3.1:8b)', 'gemma3:1b', 'Auto-rename chats');
absent('Settings: no hard-coded model names', <SettingsModal isOpen onClose={noop} settings={settings} onUpdateSettings={noop} models={[]} updates={{ state: { kind: 'idle' }, version: '0.1.0', check: async () => undefined, install: async () => undefined } as never} />, 'Active Model Checkpoint', 'Mistral NeMo 12B', 'DeepSeek R1 Distill');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
