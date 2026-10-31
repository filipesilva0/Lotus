// Session 5 tests: VRAM auto-scaler, GFM parser, cron, Kanban rules, memory/skill learning parsers,
// recall selection, web-search parsing, context files, agent pool, and the Thinking / learning /
// task-agent flows against a fake Ollama. Run: bash handover/verification/run-s5-tests.sh
import { ollama } from './s5-setup';
import { CTX_STEPS, estimateKvBytes, kvFromModelInfo, kvMb, parseParams, pickAgentModel, planScale, recommendParams, ScaleInput } from '../../src/hardware/scaler';
import { inlineText, parseInline, parseMarkdown, splitRow } from '../../src/lib/gfm';
import { describeCron, nextRun, parseCron, validateCron, cronFromPreset } from '../../src/tasks/cron';
import { addLink, blockersOf, moveTask, newTask, nextRunnable, parseSteps, removeTask, Task, wouldCycle } from '../../src/tasks/kanban';
import { correction, isComplexExchange, looksSensitive, parseMemoryOps, parseSkillDraft, positiveFeedback, shouldReflect, similarity } from '../../src/memory/learn';
import { groupHits, pickMemories } from '../../src/memory/recall';
import { matchScore, queryWords } from '../../src/memory/store';
import { ddgTarget, decodeEntities, parseDuckDuckGo, queryFromMessage, readableText, webContextBlock } from '../../src/chat/webSearch';
import { contextBlock, stripFrontMatter, ContextFile } from '../../src/context/discover';
import { contextPayload, chunkText } from '../../src/chat/helpers';
import { extractJson } from '../../src/services/llm';
import { parsePlan } from '../../src/tasks/runner';
import { toSpeakable } from '../../src/lib/markdownLite';

let pass = 0, fail = 0;
const results: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); pass++; results.push(`  ✓ ${name}`); }
  catch (e) { fail++; results.push(`  ✗ ${name}\n      ${(e as Error).stack?.split('\n').slice(0, 3).join('\n      ')}`); }
}
function eq(a: unknown, b: unknown, msg = '') { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error(`${msg} expected ${B}, got ${A}`); }
function ok(v: unknown, msg = 'expected truthy') { if (!v) throw new Error(msg); }

const GB = 1024;
const hw = (totalGb: number, freeGb: number) => ({ source: 'nvidia-smi' as const, gpu: { name: 'GPU', totalMb: totalGb * GB, freeMb: freeGb * GB, usedMb: (totalGb - freeGb) * GB }, ramTotalMb: 32 * GB, ramFreeMb: 16 * GB, at: 0 });
const llama8b = { name: 'llama3.1:8b', weightsMb: 4.9 * GB, loadedVramMb: 0, contextMax: 131072, kvBytesPerToken: 131072, kvMeasured: true, paramsB: 8 };
const base = (p: Partial<ScaleInput>): ScaleInput => ({ hw: hw(12, 11), model: llama8b, reserveMb: 1024, maxSubagents: 4, manualCtx: 4096, autoScale: true, backend: 'ollama', ...p });

async function main() {
  // ── VRAM auto-scaler ──────────────────────────────────────────────────────
  await test('scaler: KV bytes/token from Llama 3.1 8B metadata = 128 KiB', () => {
    const r = kvFromModelInfo({ 'general.architecture': 'llama', 'llama.block_count': 32, 'llama.attention.head_count': 32, 'llama.attention.head_count_kv': 8, 'llama.embedding_length': 4096, 'llama.context_length': 131072 });
    eq(r, { bytes: 131072, contextMax: 131072 });
  });
  await test('scaler: explicit key/value lengths (Gemma-style) are used', () => {
    const r = kvFromModelInfo({ 'general.architecture': 'gemma3', 'gemma3.block_count': 10, 'gemma3.attention.head_count': 8, 'gemma3.attention.head_count_kv': 4, 'gemma3.embedding_length': 2560, 'gemma3.attention.key_length': 256, 'gemma3.attention.value_length': 256, 'gemma3.context_length': 32768 });
    eq(r?.bytes, 10 * 4 * 512 * 2);
  });
  await test('scaler: parameter strings', () => { eq(parseParams('7.6B'), 7.6); eq(parseParams('500M'), 0.5); eq(parseParams(undefined), 0); });
  await test('scaler: 12 GB GPU, 8B model → large context, several agents, all fitting', () => {
    const p = planScale(base({}));
    eq(p.fit, 'fits'); ok(p.measured);
    const used = llama8b.weightsMb + 400 + kvMb(131072, p.numCtx) * 1.1 + (p.maxSubagents - 1) * p.perAgentMb;
    ok(used <= 11 * GB - 1024 + 1, `would use ${used} MB of ${11 * GB - 1024}`);
    ok(p.numCtx >= 16384, `ctx ${p.numCtx}`);
    ok(p.maxSubagents >= 1 && p.maxSubagents <= 4);
  });
  await test('scaler: context never exceeds the model maximum', () => {
    const p = planScale(base({ hw: hw(80, 79), model: { ...llama8b, contextMax: 8192 } }));
    eq(p.numCtx, 8192);
  });
  await test('scaler: almost-full GPU → one agent, critical pressure', () => {
    const p = planScale(base({ hw: hw(12, 0.5), model: { ...llama8b, loadedVramMb: 7 * GB } }));
    eq(p.pressure, 'critical'); eq(p.maxSubagents, 1);
  });
  await test('scaler: model larger than the GPU → too-large, 4K context, 1 agent, smaller size suggested', () => {
    const p = planScale(base({ hw: hw(8, 7.5), model: { ...llama8b, name: 'big', weightsMb: 40 * GB, paramsB: 70 } }));
    eq(p.fit, 'too-large'); eq(p.numCtx, 4096); eq(p.maxSubagents, 1); ok(p.recommendedParamsB > 0 && p.recommendedParamsB <= 8, `rec ${p.recommendedParamsB}`);
  });
  await test('scaler: unmeasured VRAM → manual context, 1 agent, says so', () => {
    const p = planScale(base({ hw: null }));
    eq(p.numCtx, 4096); eq(p.maxSubagents, 1); ok(!p.measured); ok(p.notes[0].includes('could not be measured'));
  });
  await test('scaler: auto-scale off → manual settings', () => { const p = planScale(base({ autoScale: false, manualCtx: 6000 })); eq(p.numCtx, 6000); eq(p.maxSubagents, 1); });
  await test('scaler: user cap limits agents', () => { const p = planScale(base({ hw: hw(48, 47), maxSubagents: 2 })); eq(p.maxSubagents, 2); });
  await test('scaler: more free memory never gives fewer agents or less context', () => {
    let prev = { c: 0, a: 0 };
    for (const free of [6, 8, 10, 14, 20, 30]) { const p = planScale(base({ hw: hw(32, free), maxSubagents: 8 })); ok(p.numCtx >= prev.c && p.maxSubagents >= prev.a, `free ${free}`); prev = { c: p.numCtx, a: p.maxSubagents }; }
  });
  await test('scaler: context steps are ascending and chunk size grows with context', () => {
    ok(CTX_STEPS.every((v, i) => i === 0 || v > CTX_STEPS[i - 1]));
    ok(planScale(base({ hw: hw(24, 23) })).chunkChars >= planScale(base({ hw: hw(8, 6.5) })).chunkChars);
  });
  await test('scaler: llama.cpp reads slots, suggests flags', () => {
    const p = planScale(base({ backend: 'llamacpp', llamacpp: { nCtx: 16384, slots: 2 } }));
    eq(p.numCtx, 8192); eq(p.maxSubagents, 2); ok(/^-c \d+ -np \d/.test(p.llamacppFlags ?? ''), p.llamacppFlags);
  });
  await test('scaler: recommendations and estimates are sane', () => {
    ok(recommendParams(8 * GB) >= 7 && recommendParams(8 * GB) <= 8, `8GB→${recommendParams(8 * GB)}`);
    ok(recommendParams(24 * GB) >= 22, `24GB→${recommendParams(24 * GB)}`);
    eq(recommendParams(0), 0);
    ok(estimateKvBytes(8) === 131072);
  });
  await test('scaler: agent model is the chat model when it fits, else the largest that fits', () => {
    const fits = planScale(base({}));
    eq(pickAgentModel(fits, 'llama3.1:8b', [{ name: 'tiny', sizeMb: 1000 }], hw(12, 11), 1024), 'llama3.1:8b');
    const big = planScale(base({ hw: hw(8, 7.5), model: { ...llama8b, weightsMb: 40 * GB } }));
    eq(pickAgentModel(big, 'big', [{ name: 'qwen2.5:3b', sizeMb: 1900 }, { name: 'qwen2.5:7b', sizeMb: 4700 }, { name: 'huge', sizeMb: 40000 }, { name: 'nomic-embed', sizeMb: 300 }], hw(8, 7.5), 1024), 'qwen2.5:7b');
  });

  // ── GFM ───────────────────────────────────────────────────────────────────
  await test('gfm: table with alignment, escaped pipe and code with pipe', () => {
    const b = parseMarkdown('| A | B | C |\n|:--|:-:|--:|\n| 1 | `x|y` | a\\|b |');
    eq(b[0].t, 'table');
    const t = b[0] as Extract<typeof b[0], { t: 'table' }>;
    eq(t.align, ['left', 'center', 'right']); eq(inlineText(t.rows[0][1]), 'x|y'); eq(inlineText(t.rows[0][2]), 'a|b');
  });
  await test('gfm: task list, nesting, ordered start, tight/loose', () => {
    const b = parseMarkdown('- [x] done\n- [ ] todo\n  1. sub\n  2. sub2\n\n3. three\n4. four');
    const l = b[0] as any; eq(l.t, 'list'); eq(l.items[0].task, true); eq(l.items[1].task, false); eq(l.loose, false);
    eq(l.items[1].c[1].t, 'list'); eq(l.items[1].c[1].ordered, true);
    eq((b[1] as any).start, 3);
  });
  await test('gfm: inline emphasis, strike, code, links, autolinks', () => {
    const t = inlineText(parseInline('**b** *i* ~~s~~ `c*d` [x](https://a.b) www.example.com done'));
    eq(t, 'b i s c*d x www.example.com done');
    const links = parseInline('see https://x.org/a_(b). and <https://y.org>').filter((x) => x.t === 'link').map((x: any) => x.href);
    eq(links, ['https://x.org/a_(b)', 'https://y.org']);
  });
  await test('gfm: unsafe link schemes are not links', () => {
    eq(parseInline('[c](javascript:alert(1))').some((x) => x.t === 'link'), false);
    eq(parseInline('[c](data:text/html,x)').some((x) => x.t === 'link'), false);
  });
  await test('gfm: intraword underscores and spaced asterisks stay literal', () => {
    eq(inlineText(parseInline('snake_case_name and 2 * 3 * 4')), 'snake_case_name and 2 * 3 * 4');
    eq(parseInline('snake_case_name').length, 1);
  });
  await test('gfm: unclosed fence while streaming is an open code block', () => {
    const b = parseMarkdown('Here:\n```python\nprint(1)') as any[]; eq(b[1].t, 'code'); eq(b[1].open, true); eq(b[1].lang, 'python');
  });
  await test('gfm: headings (ATX + setext), hr, quote, footnotes, citations', () => {
    const b = parseMarkdown('# H1\nPara\n===\n\n---\n\n> q **b**\n\nText[^n] and [2].\n\n[^n]: note') as any[];
    eq(b.map((x) => x.t), ['h', 'h', 'hr', 'quote', 'p', 'footnotes']);
    eq(b[1].level, 1);
    ok(b[4].c.some((x: any) => x.t === 'fnref') && b[4].c.some((x: any) => x.t === 'cite' && x.n === 2));
  });
  await test('gfm: <br> in table cells and hard breaks', () => {
    const b = parseMarkdown('| a |\n|---|\n| x<br>y |') as any[];
    ok(b[0].rows[0][0].some((x: any) => x.t === 'br'));
    ok(parseInline('a  \nb').some((x) => x.t === 'br'));
  });
  await test('gfm: row splitting', () => { eq(splitRow('| a | b |'), ['a', 'b']); eq(splitRow('a|b'), ['a', 'b']); });
  await test('gfm: speakable text drops code and markup', () => { eq(toSpeakable('# Hi\n**bold** text\n```js\nx\n```'), 'Hi bold text code omitted.'); });

  // ── cron ──────────────────────────────────────────────────────────────────
  const at = (s: string) => new Date(s);
  await test('cron: weekdays at 08:30', () => {
    eq(nextRun('30 8 * * 1-5', at('2026-10-31T09:00:00'))!.toString(), at('2026-11-02T08:30:00').toString()); // Sat → Mon
  });
  await test('cron: every 15 minutes', () => { eq(nextRun('*/15 * * * *', at('2026-10-31T09:07:30'))!.getMinutes(), 15); });
  await test('cron: names, 7=Sunday, ranges with steps', () => {
    eq(nextRun('0 12 * * sun', at('2026-10-31T13:00:00'))!.getDay(), 0);
    eq(nextRun('0 12 * * 7', at('2026-10-31T13:00:00'))!.getDay(), 0);
    eq([...parseCron('0-30/10 * * * *').minute], [0, 10, 20, 30]);
    eq(nextRun('0 0 1 jan *', at('2026-10-31T00:00:00'))!.getFullYear(), 2027);
  });
  await test('cron: day-of-month OR day-of-week when both set', () => {
    const n = nextRun('0 9 13 * 5', at('2026-11-01T00:00:00'))!; // Fri 6 Nov comes before the 13th
    eq(n.getDate(), 6);
  });
  await test('cron: Feb 30 never fires (null), macros work', () => { eq(nextRun('0 0 30 2 *', at('2026-01-01T00:00:00')), null); eq(nextRun('@daily', at('2026-10-31T10:00:00'))!.getDate(), 1); });
  await test('cron: validation messages', () => { ok(validateCron('* * *')); ok(validateCron('61 * * * *')); eq(validateCron('0 9 * * 1-5'), null); });
  await test('cron: descriptions and presets', () => {
    eq(describeCron('30 8 * * 1-5'), 'Weekdays at 08:30'); eq(describeCron('*/15 * * * *'), 'Every 15 minutes'); eq(describeCron('0 9 * * *'), 'Every day at 09:00');
    eq(cronFromPreset('weekly', '18:05', 3), '5 18 * * 3'); eq(describeCron('0 * * * *'), 'Every hour');
  });

  // ── Kanban ────────────────────────────────────────────────────────────────
  const mk = (all: Task[], id: string, p: Partial<Task> = {}) => [...all, newTask(id, { title: id, ...p }, all)];
  await test('kanban: blocking links, cycle refusal, unblocking when done', () => {
    let all: Task[] = []; all = mk(all, 'a'); all = mk(all, 'b'); all = mk(all, 'c');
    all = addLink(all, 'a', 'blocks', 'b').tasks; all = addLink(all, 'b', 'blocks', 'c').tasks;
    ok(wouldCycle('c', 'a', all)); ok(addLink(all, 'c', 'blocks', 'a').error?.includes('loop'));
    eq(blockersOf('b', all).map((t) => t.id), ['a']);
    ok(moveTask(all, 'b', 'doing').error?.includes('waiting for'));
    all = moveTask(all, 'a', 'done').tasks;
    eq(blockersOf('b', all).length, 0); ok(!moveTask(all, 'b', 'doing').error);
  });
  await test('kanban: ordering within a column and removal cleans links', () => {
    let all: Task[] = []; all = mk(all, 'a'); all = mk(all, 'b'); all = mk(all, 'c');
    all = moveTask(all, 'c', 'todo', 'a').tasks;
    eq(all.filter((t) => t.status === 'todo').sort((x, y) => x.order - y.order).map((t) => t.id), ['c', 'a', 'b']);
    all = addLink(all, 'a', 'relates', 'b').tasks; all = removeTask(all, 'b');
    eq(all.find((t) => t.id === 'a')!.links, []);
  });
  await test('kanban: next runnable = Lotus task in To do, unblocked, urgent first', () => {
    let all: Task[] = []; all = mk(all, 'mine'); all = mk(all, 'low', { assignee: 'lotus', priority: 'low' }); all = mk(all, 'urgent', { assignee: 'lotus', priority: 'urgent' }); all = mk(all, 'blocker');
    all = addLink(all, 'blocker', 'blocks', 'urgent').tasks;
    eq(nextRunnable(all)?.id, 'low');
    all = moveTask(all, 'blocker', 'done').tasks;
    eq(nextRunnable(all)?.id, 'urgent');
  });
  await test('kanban: steps from Markdown, plans from JSON', () => {
    eq(parseSteps('Plan:\n1. One\n- [ ] Two\n* **Three**\nnot a step'), ['One', 'Two', 'Three']);
    eq(parsePlan('Sure! {"steps":["a step","b step"]}'), ['a step', 'b step']);
    eq(parsePlan('1. first\n2. second'), ['first', 'second']);
  });

  // ── Memory & skills ───────────────────────────────────────────────────────
  const mem = [
    { id: 'u1', text: 'Uses Windows 11 with an RTX 4070', kind: 'memory' as const, ts: 1, source: 'user' as const },
    { id: 'a1', text: 'Prefers TypeScript over JavaScript', kind: 'memory' as const, ts: 2, source: 'auto' as const },
  ];
  await test('memory ops: only learned items can change; duplicates and secrets dropped', () => {
    const ops = parseMemoryOps({
      add: [{ kind: 'memory', text: 'Uses Windows 11 with an RTX 4070 GPU' }, { kind: 'memory', text: 'Works as a physiotherapist' }, { text: 'My password is hunter2' }, { kind: 'instruction', text: 'Answer in Portuguese when asked in Portuguese' }],
      update: [{ id: 'u1', text: 'changed user item' }, { id: 'a1', text: 'Prefers TypeScript with strict mode' }],
      remove: ['u1', 'a1', 'nope'],
    }, mem);
    eq(ops.add.map((a) => a.text), ['Works as a physiotherapist', 'Answer in Portuguese when asked in Portuguese']);
    eq(ops.add[1].kind, 'instruction');
    eq(ops.update, [{ id: 'a1', text: 'Prefers TypeScript with strict mode' }]);
    eq(ops.remove, ['a1']);
    eq(parseMemoryOps('junk', mem), { add: [], update: [], remove: [] });
  });
  await test('memory: sensitivity, similarity, reflection cadence, feedback cues', () => {
    ok(looksSensitive('api key sk-abcdefghijklmnop1234')); ok(looksSensitive('card 4111 1111 1111 1111')); ok(!looksSensitive('Likes hiking in Sintra'));
    ok(similarity('Uses Windows 11', 'uses windows 11!') === 1); ok(similarity('cats', 'dogs') === 0);
    ok(shouldReflect(1, "I'm a physiotherapist in Lisbon")); ok(!shouldReflect(1, 'what is 2+2')); ok(shouldReflect(3, 'what is 2+2'));
    ok(positiveFeedback('thanks, that worked')); ok(!positiveFeedback("it doesn't work")); ok(correction("that didn't work, error 5"));
  });
  await test('skills: complex exchanges are detected; drafts validated', () => {
    const long = `## Steps\n${Array.from({ length: 6 }, (_, i) => `${i + 1}. Do thing ${i} with enough words to matter`).join('\n')}\n${'x'.repeat(1200)}`;
    ok(isComplexExchange([{ role: 'user', content: 'how do I deploy' }, { role: 'assistant', content: long }], {}));
    ok(!isComplexExchange([{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Hello!' }], {}));
    ok(isComplexExchange([], { taskSteps: 3 }));
    eq(parseSkillDraft({ create: false }), null);
    eq(parseSkillDraft({ create: true, name: 'X', when_to_use: 'w', body: 'too short' }), null);
    const d = parseSkillDraft({ create: true, name: 'Deploy a Vite app', when_to_use: 'deploying vite', description: 'd', tags: ['Vite', 3], body: '## Steps\n1. Build with npm run build and check the dist folder exists.\n2. Upload.' });
    eq(d?.tags, ['vite']); eq(d?.name, 'Deploy a Vite app');
  });
  await test('recall: memories fit → all; overflow → instructions, user items, matches, recent', () => {
    eq(pickMemories(mem, [], 1000).length, 2);
    const many = Array.from({ length: 50 }, (_, i) => ({ id: `m${i}`, text: `learned fact number ${i} about something`, kind: 'memory' as const, ts: i, source: 'auto' as const }));
    const all = [...mem, { id: 'i1', text: 'Always answer briefly', kind: 'instruction' as const, ts: 0, source: 'user' as const }, ...many];
    const pick = pickMemories(all, ['m3'], 300);
    ok(pick.some((m) => m.id === 'i1') && pick.some((m) => m.id === 'u1') && pick.some((m) => m.id === 'm3'), JSON.stringify(pick.map((m) => m.id)));
    ok(pick.reduce((n, m) => n + m.text.length + 4, 0) <= 300);
  });
  await test('recall: hits grouped per conversation', () => {
    const g = groupHits([1, 2, 3, 4, 5].map((i) => ({ id: `${i}`, sessionId: i < 4 ? 's1' : `s${i}`, title: 't', role: 'user', snippet: `snip ${i}`, ts: 0, score: 1 })), 2);
    eq(g.length, 2); eq(g[0].snippets.length, 2);
  });
  await test('search words match the Rust query builder', () => {
    eq(queryWords('How do I deploy the "app" to Vercel?'), ['deploy', 'app', 'vercel']);
    eq(matchScore(['deploy', 'vercel'], 'Deployment on Vercel works'), 2);
  });

  // ── Web search parsing ────────────────────────────────────────────────────
  const ddg = `<div class="result results_links results_links_deep web-result "><div class="links_main links_deep result__body"><h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Follama.com%2Fblog%2Fnew&amp;rut=abc">Ollama <b>0.12</b> released</a></h2><a class="result__snippet" href="x">New &amp; improved <b>engine</b>.</a></div></div>
  <div class="result result--ad"><a class="result__a" href="https://duckduckgo.com/y.js?ad_domain=x">Ad</a></div>
  <div class="result results_links"><h2><a class="result__a" href="https://example.org/page">Example</a></h2><div class="result__snippet">Plain snippet</div></div>`;
  await test('web: DuckDuckGo HTML results parsed, ads skipped, redirects decoded', () => {
    const r = parseDuckDuckGo(ddg);
    eq(r.map((x) => x.url), ['https://ollama.com/blog/new', 'https://example.org/page']);
    eq(r[0].title, 'Ollama 0.12 released'); eq(r[0].snippet, 'New & improved engine.');
    eq(ddgTarget('https://duckduckgo.com/y.js?ad_domain=a'), null);
  });
  await test('web: readable text strips scripts/nav and prefers <article>', () => {
    const html = `<html><head><title>T &amp; X</title><script>evil()</script></head><body><nav>menu</nav><article><h1>Head</h1><p>${'Real content. '.repeat(40)}</p><ul><li>one</li></ul></article><footer>foot</footer></body></html>`;
    const r = readableText(html);
    eq(r.title, 'T & X'); ok(r.text.startsWith('Head')); ok(!r.text.includes('evil') && !r.text.includes('menu') && !r.text.includes('foot')); ok(r.text.includes('- one'));
  });
  await test('web: entities, query cleanup, numbered context block', () => {
    eq(decodeEntities('&lt;a&gt; &#39;x&#39; &#x41;'), "<a> 'x' A");
    eq(queryFromMessage('Hey, can you tell me the latest Ollama version?'), 'the latest Ollama version?');
    const block = webContextBlock([{ title: 'A', url: 'https://a', snippet: 's' }], [{ url: 'https://a', title: 'A', text: 'page text' }], 1000);
    ok(block.startsWith('[1] A\nhttps://a\npage text'));
  });

  // ── Context files ─────────────────────────────────────────────────────────
  const files: ContextFile[] = [
    { rel: 'AGENTS.md', kind: 'rules', content: 'Use pnpm.', truncated: false, bytes: 9, modified: 0 },
    { rel: 'SOUL.md', kind: 'soul', content: 'You are calm and precise.', truncated: false, bytes: 20, modified: 0 },
    { rel: 'memory.md', kind: 'memory', content: '- Deploys to Fly.io', truncated: false, bytes: 20, modified: 0 },
    { rel: '.cursor/rules/style.mdc', kind: 'rules', content: '---\ndescription: style\nglobs: *.ts\n---\nNo semicolons.', truncated: false, bytes: 40, modified: 0 },
  ];
  await test('context files: soul first, rules, memory; front matter stripped; memory skipped when off', () => {
    const on = contextBlock(files, { includeMemory: true, budgetChars: 10_000 });
    ok(on.text.indexOf('SOUL.md') < on.text.indexOf('AGENTS.md') && on.text.indexOf('AGENTS.md') < on.text.indexOf('memory.md'));
    ok(on.text.includes('No semicolons.') && !on.text.includes('globs:'));
    const off = contextBlock(files, { includeMemory: false, budgetChars: 10_000, off: ['AGENTS.md'] });
    ok(!off.text.includes('Fly.io') && !off.text.includes('pnpm') && off.used.length === 2);
    eq(stripFrontMatter('---\na: b\n---\nbody'), 'body');
  });
  await test('mounted files: chunk size and context budget respected', () => {
    const ck = chunkText('x'.repeat(5000), 1000);
    ok(ck.every((c) => c.text.length <= 2000) && ck.map((c) => c.text).join('') === 'x'.repeat(5000));
    const items = [{ id: '1', name: 'a.txt', kind: 'file' as const, chunks: chunkText('line\n'.repeat(2000), 1000) }];
    const p = contextPayload(items, [], 2500);
    ok(p.length < 3200 && p.includes('left out to fit'), `len ${p.length}`);
  });
  await test('json extraction tolerates prose and fences', () => { eq(extractJson('Here:\n```json\n{"a":1}\n```'), { a: 1 }); eq(extractJson('none'), null); });

  // ── Agent pool + flows against a fake Ollama ──────────────────────────────
  const { setLiveSettings } = await import('../../src/lib/liveSettings');
  setLiveSettings({ selectedModel: 'm', llmBackend: 'ollama', llamacppUrl: '', autoScale: true, vramReserveMb: 1024, maxSubagents: 4, contextWindow: 4096, webSearchProvider: 'duckduckgo', searxngUrl: '', webPagesToRead: 0, autoMemory: true, autoSkills: true, sessionRecall: true, systemPrompt: '' } as any);
  const { agentPool } = await import('../../src/agents/pool');

  await test('pool: never runs more jobs than the VRAM limit; priorities; housekeeping waits for chat', async () => {
    let live = 0, peak = 0; const order: string[] = [];
    const job = (name: string) => async () => { live++; peak = Math.max(peak, live); order.push(name); await new Promise((r) => setTimeout(r, 15)); live--; return name; };
    agentPool.setForegroundBusy(true);
    const ps = [agentPool.run('learn', 'memory', job('learn'), { priority: 2 }), agentPool.run('a', 'task', job('a'), { priority: 1 }), agentPool.run('b', 'task', job('b'), { priority: 0 })];
    await new Promise((r) => setTimeout(r, 60));
    ok(!order.includes('learn'), 'housekeeping ran while chat was busy');
    agentPool.setForegroundBusy(false);
    await Promise.all(ps);
    eq(peak, 1, 'limit (no GPU measured → 1)'); eq(order[order.length - 1], 'learn');
  });
  await test('pool: cancelling a queued job rejects it', async () => {
    const slow = agentPool.run('slow', 'task', () => new Promise((r) => setTimeout(() => r(1), 30)));
    const queued = agentPool.run('q', 'task', async () => 2, { id: 'qid' });
    agentPool.cancel('qid');
    let rejected = false; await queued.catch(() => { rejected = true; });
    await slow; ok(rejected);
  });

  const { thinkingStream } = await import('../../src/chat/thinking');
  await test('thinking mode: analyse → draft → check → final, streamed; passes go to the drawer', async () => {
    ollama.requests = [];
    ollama.reply = (msgs) => {
      const last = msgs[msgs.length - 1].content;
      if (last.startsWith('Before answering')) return { content: 'ANALYSIS: needs X' };
      if (last.includes('<analysis>')) return { content: 'DRAFT answer with an error' };
      if (last.includes('strict expert reviewer')) return { content: 'Fix the error in line 1.' };
      if (last.startsWith('Write the final answer')) return { content: 'FINAL corrected answer' };
      return { content: '?' };
    };
    const stages: string[] = []; let drawer = ''; let out = '';
    for await (const t of thinkingStream([{ role: 'system', content: 's' }, { role: 'user', content: 'q' }], { model: 'm', numCtx: 4096, nativeThinking: false }, { onStage: (id, st) => stages.push(`${id}:${st}`), onThinking: (t) => { drawer = t; } })) out += t;
    eq(out, 'FINAL corrected answer');
    eq(stages, ['analyse:running', 'analyse:done', 'draft:running', 'draft:done', 'check:running', 'check:done', 'final:running', 'final:done']);
    ok(drawer.includes('ANALYSIS') && drawer.includes('Fix the error'));
    const finalReq = ollama.requests.filter((r) => r.url.endsWith('/api/chat')).pop()!.body;
    ok(finalReq.stream && finalReq.messages[finalReq.messages.length - 1].content.includes('Fix the error'));
    eq(ollama.requests.filter((r) => r.url.endsWith('/api/chat')).length, 4);
  });
  await test('thinking mode: native thinking passes think=true to capable models', async () => {
    ollama.requests = [];
    ollama.reply = () => ({ content: 'NO ISSUES', thinking: 'hmm' });
    for await (const _ of thinkingStream([{ role: 'user', content: 'q' }], { model: 'qwen3', numCtx: 4096, nativeThinking: true }, { onStage: () => undefined, onThinking: () => undefined })) { /* drain */ }
    const chats = ollama.requests.filter((r) => r.url.endsWith('/api/chat'));
    ok(chats.slice(0, 3).every((r) => r.body.think === true)); ok(chats[3].body.think === undefined);
  });

  const { memoryStore } = await import('../../src/memory/store');
  const { reflect, considerSkill } = await import('../../src/memory/learn');
  await test('learning: reflect adds a learned memory via the pool (deduplicated)', async () => {
    await memoryStore.putMemories([{ id: 'u1', text: 'Uses Windows 11', kind: 'memory', ts: 1, source: 'user' }]);
    ollama.reply = () => ({ content: '{"add":[{"kind":"memory","text":"Is a physiotherapist building the PhysioPulse app"},{"kind":"memory","text":"Uses Windows 11"}],"update":[],"remove":[]}' });
    const n = await reflect([{ role: 'user', content: "I'm a physio building PhysioPulse" }, { role: 'assistant', content: 'Nice!' }]);
    eq(n, 1);
    const m = memoryStore.get().memories;
    ok(m.some((x) => x.source === 'auto' && x.text.includes('PhysioPulse'))); eq(m.length, 2);
  });
  await test('skills: a complex task becomes a saved skill; a near-duplicate improves the existing one', async () => {
    ollama.reply = () => ({ content: JSON.stringify({ create: true, name: 'Set up a Vite React project on Windows', description: 'Create and run a Vite + React app', when_to_use: 'user wants a new React web app', tags: ['vite', 'react'], body: '## Steps\n1. Run npm create vite@latest app -- --template react-ts\n2. npm install, npm run dev\n## Pitfalls\n- Node 18+ required' }) });
    const s1 = await considerSkill([{ role: 'user', content: 'Set up a new Vite React project on Windows' }, { role: 'assistant', content: 'steps…' }]);
    ok(s1 && s1.version === 1 && memoryStore.get().skills.length === 1, 'created');
    ollama.reply = () => ({ content: JSON.stringify({ changed: true, description: 'Create, run and build', when_to_use: 'new React web app', body: '## Steps\n1. Run npm create vite@latest app -- --template react-ts\n2. npm install, npm run dev\n3. npm run build for production\n## Pitfalls\n- Node 18+ required', note: 'Added the build step' }) });
    const s2 = await considerSkill([{ role: 'user', content: 'Set up a Vite React project for Windows again' }, { role: 'assistant', content: 'steps + build' }]);
    eq(memoryStore.get().skills.length, 1); eq(s2?.version, 2); ok(s2?.body.includes('npm run build')); eq(s2?.history?.[1]?.note, 'Added the build step');
  });

  const { tasks: board } = await import('../../src/tasks/store');
  await test('task agent: plans steps, works through them, writes a result, moves to Review', async () => {
    ollama.reply = (msgs) => {
      const last = msgs[msgs.length - 1].content;
      if (last.startsWith('Break this task')) return { content: '{"steps":["Outline the email","Write the email"]}' };
      if (last.startsWith('All steps are done')) return { content: '**Final email** ready.' };
      return { content: `Result for: ${last.split('\n').find((l) => l.startsWith('Now do step')) ?? ''}` };
    };
    const t = board.add({ title: 'Draft an email to the clinic', status: 'backlog' });
    board.run(t.id);
    for (let i = 0; i < 100 && board.get().tasks.find((x) => x.id === t.id)?.status !== 'review'; i++) await new Promise((r) => setTimeout(r, 10));
    const done = board.get().tasks.find((x) => x.id === t.id)!;
    eq(done.status, 'review'); eq(done.steps.map((s) => s.done), [true, true]); eq(done.result, '**Final email** ready.');
    ok(done.steps[1].result?.includes('step 2 of 2'));
  });
  await test('task agent: Lotus tasks in To do auto-start only once unblocked', async () => {
    const a = board.add({ title: 'First', status: 'todo' });
    const b = board.add({ title: 'Second', status: 'todo', assignee: 'lotus' });
    // b starts immediately (nothing blocks it yet), so make a third that is blocked from the start
    const c = board.add({ title: 'Third', status: 'backlog', assignee: 'lotus' });
    board.link(a.id, 'blocks', c.id);
    board.move(c.id, 'todo');
    await new Promise((r) => setTimeout(r, 20));
    ok(!board.get().tasks.find((x) => x.id === c.id)!.run, 'blocked task must not start');
    board.move(a.id, 'done');
    for (let i = 0; i < 100 && board.get().tasks.find((x) => x.id === c.id)?.status !== 'review'; i++) await new Promise((r) => setTimeout(r, 10));
    eq(board.get().tasks.find((x) => x.id === c.id)!.status, 'review');
    ok(board.get().tasks.find((x) => x.id === b.id)!.run);
  });

  console.log(results.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
void main();
