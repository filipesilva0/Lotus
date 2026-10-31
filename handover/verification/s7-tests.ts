// Session 7 tests: interactive choices, plugins + plugin creator, chat auto-rename, background
// tasks model, usage analytics, folder attach filters and Library documents.
// Run: bash handover/verification/run-s7-tests.sh
import { ollama } from './s5-setup';
import { answerText, complete, parseChoices, pollFromJson, pollFromList, CHOICES_INSTRUCTIONS } from '../../src/chat/choices';
import { commandSlug, expandCommand, pluginCommands, pluginSystemBlock, plugins, validatePlugin, LotusPlugin, RESERVED_COMMANDS, fromFileText, toFile } from '../../src/plugins/store';
import { creatorTurns } from '../../src/plugins/creator';
import { cleanTitle, shouldRename, titleTurns } from '../../src/chat/rename';
import { modelForJob, BACKGROUND_KINDS } from '../../src/agents/pool';
import { compact, computeUsage, messageTime, topModels } from '../../src/analytics/usage';
import { folderSummary, folderToContext, readPickedFiles, wantedPath } from '../../src/chat/folder';
import { memoryFile, skillFile, soulFile, systemSkillFile } from '../../src/library/docs';
import { SYSTEM_SKILLS, PLUGIN_CREATOR_SKILL } from '../../src/skills/system';
import { SLASH } from '../../src/components/chat/Composer';
import { artifactsFrom } from '../../src/chat/helpers';
import type { ChatSession } from '../../src/types/lotus';

let pass = 0, fail = 0;
const results: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); pass++; results.push(`  ✓ ${name}`); }
  catch (e) { fail++; results.push(`  ✗ ${name}\n      ${(e as Error).stack?.split('\n').slice(0, 3).join('\n      ')}`); }
}
function eq(a: unknown, b: unknown, msg = '') { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error(`${msg} expected ${B}, got ${A}`); }
function ok(v: unknown, msg = 'expected truthy') { if (!v) throw new Error(msg); }

const plugin = (p: Partial<LotusPlugin>): LotusPlugin => ({ id: 'p', name: 'P', version: '1.0.0', description: 'd', author: '', instructions: '', commands: [], skills: [], enabled: true, origin: 'created', created: 0, updated: 0, ...p });

async function main() {
  // ── Interactive choices ─────────────────────────────────────────────────
  await test('choices: single-question block is removed from the text and parsed', () => {
    const r = parseChoices('Which colour?\n\n```choices\n{"question":"Pick a colour","options":["Red","Blue","Red"]}\n```');
    eq(r.text, 'Which colour?'); eq(r.pending, false);
    eq(r.poll?.questions[0], { id: 'q1', question: 'Pick a colour', type: 'single', options: ['Red', 'Blue'], allowOther: true });
    eq(r.poll?.source, 'block');
  });
  await test('choices: questionnaire with multi and text questions, title kept', () => {
    const p = pollFromJson({ title: 'Setup', questions: [{ question: 'Lang', type: 'multi', options: ['TS', 'Rust'] }, { question: 'Name?', type: 'text' }, { question: 'Only one', options: ['x'] }] })!;
    eq(p.title, 'Setup'); eq(p.questions.map((q) => q.type), ['multi', 'text', 'text']);
    eq(p.questions[2].options, [], 'a question with one option becomes free text');
  });
  await test('choices: unclosed block while streaming is hidden and flagged pending', () => {
    const r = parseChoices('Pick:\n```choices\n{"question":"A or B","opt');
    eq(r, { text: 'Pick:', poll: null, pending: true });
  });
  await test('choices: broken JSON hides the block without a poll', () => {
    const r = parseChoices('Hi\n```choices\nnot json\n```\nBye');
    eq(r.text, 'Hi\n\nBye'); eq(r.poll, null); eq(r.pending, false);
  });
  await test('choices: question followed by lettered options becomes a poll', () => {
    const p = pollFromList('Which framework do you prefer?\n\nA) React\nB) **Vue**\nC) Svelte')!;
    eq(p.questions[0].options, ['React', 'Vue', 'Svelte']); eq(p.source, 'list');
  });
  await test('choices: numbered options then a "which" question becomes a poll', () => {
    eq(pollFromList('1. Fast mode\n2. Careful mode\n\nWhich should I use?')?.questions[0].options, ['Fast mode', 'Careful mode']);
  });
  await test('choices: ordinary lists never turn into buttons', () => {
    eq(pollFromList('Steps:\n1. Install\n2. Run\n\nDoes that help?'), null, 'closing question without a choice word');
    eq(pollFromList('Here are things:\n- one\n- two\n\nThat is it.'), null);
    eq(pollFromList('Which one?\n```\nA) code\nB) more code\n```'), null, 'inside code');
    eq(pollFromList('Which one?\n\n- ' + 'x'.repeat(130) + '\n- short'), null, 'items too long');
    eq(pollFromList('Which one?\n\nA) a\n2) b'), null, 'mixed markers');
  });
  await test('choices: answer text and completeness', () => {
    const p = pollFromJson({ questions: [{ question: 'Days', options: ['2', '3'] }, { question: 'Goals', type: 'multi', options: ['a', 'b'] }] })!;
    ok(!complete(p, { q1: ['2'] }));
    ok(complete(p, { q1: ['2'], q2: ['a', 'b'] }));
    eq(answerText(p, { q1: ['2'], q2: ['a', 'b'] }), '**Days**\n2\n\n**Goals**\na, b');
    const one = pollFromJson({ question: 'X', options: ['a', 'b'] })!;
    eq(answerText(one, { q1: ['b'] }), 'b');
  });
  await test('choices: the system instructions name the block and the artifacts list skips it', () => {
    ok(CHOICES_INSTRUCTIONS.includes('"choices"'));
    eq(artifactsFrom([{ id: 'a', role: 'assistant', content: '```choices\n{"question":"q",\n"options":["a",\n"b"]}\n```', timestamp: '' }]).length, 0);
  });

  // ── Plugins ─────────────────────────────────────────────────────────────
  await test('plugins: validation cleans names and blocks built-in commands and duplicates', () => {
    const v = validatePlugin({ name: 'Notes', description: 'd', commands: [{ name: '/Meeting Notes!', prompt: 'Sum up {{input}}' }, { name: 'new', prompt: 'x' }] });
    eq(v.plugin, null); ok(v.errors.some((e) => e.includes('/new is a built-in')));
    const ok1 = validatePlugin({ name: 'Notes', description: 'd', version: 'banana', commands: [{ name: '/Meeting Notes!', prompt: 'Sum up {{input}}' }] });
    eq(ok1.plugin?.commands[0].name, 'meeting-notes'); eq(ok1.plugin?.version, '1.0.0');
    const dup = validatePlugin({ name: 'Other', description: 'd', commands: [{ name: 'meeting-notes', prompt: 'y' }] }, [{ name: 'Notes', commands: ok1.plugin!.commands }]);
    ok(dup.errors.some((e) => e.includes('already used')));
    ok(validatePlugin({ name: 'Empty', description: 'd' }).errors.some((e) => e.includes('needs instructions')));
    ok(validatePlugin('nope').errors[0].includes('JSON object'));
  });
  await test('plugins: every built-in slash command is reserved', () => {
    for (const c of SLASH) ok(RESERVED_COMMANDS.includes(c.name), `/${c.name} must be reserved`);
    eq(commandSlug(' /Stand Up '), 'stand-up');
  });
  await test('plugins: command templates expand with or without {{input}}', () => {
    eq(expandCommand('Review:\n{{input}}\nBe brief', 'my diff'), 'Review:\nmy diff\nBe brief');
    eq(expandCommand('Write a haiku', 'about rain'), 'Write a haiku\n\nabout rain');
    eq(expandCommand('Write a haiku', ''), 'Write a haiku');
  });
  await test('plugins: system block has enabled instructions and only matching skills', () => {
    const list = [
      plugin({ id: 'a', name: 'Physio', instructions: 'Always add safety notes.', skills: [{ name: 'Knee rehab', description: 'ACL rehab phases', whenToUse: 'knee ACL rehab exercises', body: 'PHASES BODY' }] }),
      plugin({ id: 'b', name: 'Off', enabled: false, instructions: 'SHOULD NOT APPEAR' }),
    ];
    const s1 = pluginSystemBlock('what exercises for ACL knee rehab?', list);
    ok(s1.includes('Always add safety notes.') && s1.includes('PHASES BODY') && !s1.includes('SHOULD NOT APPEAR'));
    const s2 = pluginSystemBlock('write a poem about the sea', list);
    ok(s2.includes('Always add safety notes.') && !s2.includes('PHASES BODY'));
    eq(pluginSystemBlock('x', [plugin({ enabled: false, instructions: 'z' })]), '');
  });
  await test('plugins: store installs, updates, toggles, removes; commands follow enabled state', () => {
    localStorage.removeItem('lotus.plugins.v1'); plugins.reload();
    const r = plugins.install({ name: 'Standup', description: 'd', commands: [{ name: 'standup', prompt: 'Turn into standup: {{input}}' }] }, 'created');
    ok(r.id); eq(pluginCommands().map((c) => c.name), ['standup']); eq(pluginCommands()[0].args, '<text>');
    ok(plugins.install({ name: 'standup', description: 'd', instructions: 'x' }, 'imported').errors.some((e) => e.includes('already installed')));
    plugins.setEnabled(r.id!, false); eq(pluginCommands().length, 0);
    const u = plugins.update(r.id!, { name: 'Standup', description: 'new', commands: [{ name: 'standup', prompt: 'p' }] });
    ok(u.plugin); eq(plugins.get()[0].description, 'new');
    ok(JSON.parse(localStorage.getItem('lotus.plugins.v1')!).length === 1, 'persisted');
    const file = toFile(plugins.get()[0]); eq(file.lotusPlugin, 1);
    eq((fromFileText(JSON.stringify({ plugin: { name: 'x' } })) as { name: string }).name, 'x');
    plugins.remove(r.id!); eq(plugins.get().length, 0);
  });
  await test('plugin creator: uses the plugin-creator skill and revises with the previous draft', () => {
    const t = creatorTurns('a standup helper');
    eq(t[0].content, PLUGIN_CREATOR_SKILL); eq(t.length, 2);
    const r = creatorTurns('idea', { name: 'A' }, 'add /weekly');
    eq(r.map((x) => x.role), ['system', 'user', 'assistant', 'user']); ok(r[3].content.includes('add /weekly'));
  });
  await test('plugin creator: drafts against a fake Ollama and validates the reply', async () => {
    const { setLiveSettings } = await import('../../src/lib/liveSettings');
    setLiveSettings({ selectedModel: 'chat-model', backgroundModel: 'tiny', llmBackend: 'ollama', llamacppUrl: '', autoScale: false, vramReserveMb: 1024, maxSubagents: 2, contextWindow: 4096 } as any);
    localStorage.removeItem('lotus.plugins.v1'); plugins.reload();
    ollama.requests = [];
    ollama.reply = () => ({ content: 'Here you go:\n```json\n{"name":"Standup","description":"Daily updates","commands":[{"name":"standup","description":"Write it","prompt":"Notes: {{input}}"}],"skills":[]}\n```' });
    const { draftPlugin } = await import('../../src/plugins/creator');
    const d = await draftPlugin('standup helper');
    eq(d.errors, []); eq(d.plugin?.commands[0].name, 'standup');
    const req = ollama.requests.find((r) => r.url.endsWith('/api/chat'))!.body;
    eq(req.model, 'chat-model', 'user-started creation uses the chat model'); eq(req.messages[0].content, PLUGIN_CREATOR_SKILL);
  });

  // ── Background tasks model + auto-rename ───────────────────────────────
  await test('background model: housekeeping jobs use it, user work does not', () => {
    const s = { backgroundModel: 'tiny:1b', selectedModel: 'big:8b' };
    for (const k of BACKGROUND_KINDS) eq(modelForJob(k, s, 'agent'), 'tiny:1b');
    eq(modelForJob('task', s, 'agent'), 'agent'); eq(modelForJob('routine', s, ''), 'big:8b');
    eq(modelForJob('memory', { backgroundModel: '', selectedModel: 'big:8b' }, ''), 'big:8b', 'empty = chat model');
  });
  await test('rename: titles are cleaned; only Lotus-chosen titles after the first reply', () => {
    eq(cleanTitle('Title: "Fix Vite Build Error."'), 'Fix Vite Build Error');
    eq(cleanTitle('<think>hmm</think>\n**Weekend Trip To Porto**\nextra'), 'Weekend Trip To Porto');
    eq(cleanTitle('  '), '');
    const msgs = [{ id: 'u', role: 'user' as const, content: 'hi', timestamp: '' }, { id: 'a', role: 'assistant' as const, content: 'hello', timestamp: '' }];
    ok(shouldRename({ title: 'hi', autoTitle: 'hi', messages: msgs }));
    ok(!shouldRename({ title: 'My name', autoTitle: 'hi', messages: msgs }), 'user renamed');
    ok(!shouldRename({ title: 'hi', autoTitle: 'hi', messages: [...msgs, ...msgs] }), 'not the first reply');
    ok(titleTurns({ messages: msgs })[1].content.includes('User: hi'));
  });
  await test('rename: suggestTitle runs on the background model through the pool', async () => {
    ollama.requests = [];
    ollama.reply = () => ({ content: 'Greeting Exchange' });
    const { suggestTitle } = await import('../../src/chat/rename');
    eq(await suggestTitle({ messages: [{ id: 'u', role: 'user', content: 'hi there', timestamp: '' }, { id: 'a', role: 'assistant', content: 'hello', timestamp: '' }] }), 'Greeting Exchange');
    eq(ollama.requests.find((r) => r.url.endsWith('/api/chat'))!.body.model, 'tiny');
  });

  // ── Usage analytics ─────────────────────────────────────────────────────
  await test('usage: message times come from ids, with a fallback', () => {
    eq(messageTime('user-1790000000000', 5), 1790000000000);
    eq(messageTime('imp-1790000000000-3', 5), 1790000000000);
    eq(messageTime('m1', 5), 5);
  });
  await test('usage: days, streak, hours, models and features are counted from chats', () => {
    const now = new Date(2026, 9, 31, 15, 0).getTime();
    const at = (daysAgo: number, h: number) => new Date(2026, 9, 31 - daysAgo, h, 10).getTime();
    const s = (id: string, model: string, t: number, extra: object = {}): ChatSession => ({ id, title: id, model, updatedAt: '', category: '', ts: t, messages: [
      { id: `user-${t}`, role: 'user', content: 'q', timestamp: '' },
      { id: `assistant-${t + 1000}`, role: 'assistant', content: 'one two three', timestamp: '', tokensPerSec: 30, mode: { thinking: true }, ...extra },
    ] });
    const sessions = [s('a', 'llama', at(0, 9)), s('b', 'llama', at(1, 9)), s('c', 'qwen', at(2, 21), { pollAnswer: 'B' }), s('d', 'qwen', at(5, 9)), { ...s('e', 'x', at(0, 9)), incognito: true }];
    const u = computeUsage(sessions, { now, days: 7 });
    eq([u.chats, u.sent, u.replies, u.words], [4, 4, 4, 12]);
    eq(u.streak, 3); eq(u.activeDays30, 4); eq(u.avgTps, 30);
    eq(u.days.map((d) => d.sent), [0, 1, 0, 0, 1, 1, 1]);
    eq(u.hours[9], 3); eq(u.hours[21], 1);
    eq(u.models.map((m) => [m.model, m.replies]), [['llama', 2], ['qwen', 2]]);
    eq(u.features.find((f) => f.id === 'thinking')!.count, 4); eq(u.features.find((f) => f.id === 'choices')!.count, 1);
  });
  await test('usage: extra models fold into Other; compact numbers', () => {
    const rows = ['a', 'b', 'c', 'd', 'e'].map((m, i) => ({ model: m, replies: 10 - i, words: 1, avgTps: i % 2 ? null : 20 }));
    const t = topModels(rows, 3);
    eq(t.map((r) => r.model), ['a', 'b', 'Other (3)']); eq(t[2].replies, 8 + 7 + 6); eq(t[2].avgTps, 20);
    eq([compact(999), compact(1234), compact(12_345), compact(2_500_000)], ['999', '1.2k', '12k', '2.5M']);
  });

  // ── Folder attach ───────────────────────────────────────────────────────
  await test('folder: same filters as the Rust walker', () => {
    ok(wantedPath('src/app.tsx') && wantedPath('README') && wantedPath('docs/guide.mdx') && wantedPath('.gitignore'));
    ok(!wantedPath('node_modules/x/index.js') && !wantedPath('a/.git/config') && !wantedPath('logo.png') && !wantedPath('dist/app.js'));
  });
  await test('folder: picked files are filtered, read, capped and summarised', async () => {
    const f = (rel: string, body: string | Uint8Array, type = 'text/plain') => Object.assign(new File([body as BlobPart], rel.split('/').pop()!, { type }), { webkitRelativePath: rel });
    const r = await readPickedFiles([f('proj/src/b.ts', 'export const b = 1;'), f('proj/README.md', '# Proj'), f('proj/node_modules/x/i.js', 'x'), f('proj/logo.png', new Uint8Array([1, 2]), 'image/png'), f('proj/data.json', '{\u0000}')]);
    eq(r.name, 'proj'); eq(r.files.map((x) => x.rel), ['README.md', 'src/b.ts']); eq(r.skipped, 2);
    const items = folderToContext(r, 1500);
    eq(items.map((i) => i.name), ['proj/README.md', 'proj/src/b.ts']);
    eq(folderSummary(r), 'Attached 2 files from proj. 2 skipped (not text, or too large).');
    eq(folderSummary({ name: 'e', files: [], skipped: 0, limited: false }), 'No text or code files found in e.');
  });

  // ── Library documents ───────────────────────────────────────────────────
  await test('library: SKILL.md text matches the Rust mirror format', () => {
    const t = skillFile({ name: 'Rehab "sheet"', description: 'd\nx', whenToUse: 'w', version: 2, tags: ['a', 'b'], origin: 'auto', body: '  ## Steps\n1. x  ' });
    eq(t, '---\nname: "Rehab \'sheet\'"\ndescription: "d x"\nwhen_to_use: "w"\nversion: 2\ntags: ["a", "b"]\norigin: auto\n---\n\n## Steps\n1. x\n');
  });
  await test('library: memory.md lists instructions then facts; soul shows the system prompt', () => {
    const m = memoryFile([{ id: '1', kind: 'memory', text: 'Likes tea', ts: 0, source: 'auto' }, { id: '2', kind: 'instruction', text: 'Be brief', ts: 0 }]);
    ok(m.indexOf('Be brief') < m.indexOf('Likes tea')); ok(m.includes('Likes tea _(learned)_'));
    ok(memoryFile([]).includes('None yet'));
    ok(soulFile('You are Lotus.').includes('You are Lotus.')); ok(soulFile('').includes('Empty'));
  });
  await test('library: system skills are the real feature texts', () => {
    eq(SYSTEM_SKILLS.map((s) => s.name), ['plugin-creator', 'interactive-choices', 'chat-titler']);
    ok(SYSTEM_SKILLS[1].body.includes(CHOICES_INSTRUCTIONS.trim()));
    ok(systemSkillFile(SYSTEM_SKILLS[0]).includes('read_only: true'));
  });

  console.log(results.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
void main();
