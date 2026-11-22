// Session 15: agent loop, tool registry, approvals, "no step, no claim", and the core set of tools.
// Models and ComfyUI are faked (test/fakes.ts); the real-model check is real-tasks.mjs on a real PC.

import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../src/db';
import { kvApply, kvGet } from '../src/kv';
import { decide, DEFAULT_DENY, globMatch, parseRules } from '../src/agent/policy';
import { findClaims, unbackedClaims } from '../src/agent/claims';
import { parseTags, TagFilter, tagInstructions } from '../src/agent/tags';
import { checkArgs, fromWire, Registry, toWire, wireTools } from '../src/agent/registry';
import { runAgent, textCall, type AgentDeps } from '../src/agent/loop';
import { __clearCapCache, IDLE_MS, type WireMsg } from '../src/agent/llm';
import { AgentService, ALL_TOOLS } from '../src/agent/service';
import { getRun } from '../src/agent/runs';
import type { AgentEvent, Step, ToolCtx } from '../src/agent/types';
import { filesList, filesRead, filesSearch, filesWrite, resolveInFolders } from '../src/tools/files';
import { taskAdd, taskList, taskMove, TASKS_KEY } from '../src/tools/tasks';
import { imageGenerate, GALLERY_KEY } from '../src/tools/image';
import { memorySave, memorySearch } from '../src/tools/memory';
import { startServer } from '../src/server';
import { fakeComfy, fakeOllama, last } from './fakes';

const dirs: string[] = [];
const tmp = (tag: string) => { const d = mkdtempSync(join(tmpdir(), `lotus-agent-${tag}-`)); dirs.push(d); return d; };
const stops: (() => void)[] = [];
afterAll(() => { stops.forEach((s) => s()); dirs.forEach((d) => { try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows: a test database may still be open; the OS cleans temp */ } }); });

function ctxFor(db: Db, studio: string, folders: string[], extra: Partial<ToolCtx> = {}): ToolCtx {
  return {
    db, studio, folders, signal: new AbortController().signal, memoryOn: true, fetch,
    kvSet: (k, v) => { kvApply(db, { set: { [k]: v }, remove: [] }); }, kvGet: (k) => kvGet(db, k), progress: () => undefined, ...extra,
  };
}

describe('approval policy', () => {
  test('modes', () => {
    const rules = parseRules([]);
    expect(decide({ name: 'files.write', risk: 'risky' }, {}, 'risky', rules).decision).toBe('ask');
    expect(decide({ name: 'task.add', risk: 'write' }, {}, 'risky', rules).decision).toBe('allow');
    expect(decide({ name: 'files.read', risk: 'read' }, {}, 'ask', rules).decision).toBe('ask');
    expect(decide({ name: 'files.write', risk: 'risky' }, {}, 'auto', rules).decision).toBe('allow');
  });
  test('deny rules win in every mode, with patterns on the target', () => {
    const rules = parseRules(['# comment', 'web.*', 'files.read:*.env', 'files.write:C:\\Windows\\*', 'bad rule!']);
    expect(rules.length).toBe(3);
    expect(decide({ name: 'web.search', risk: 'read' }, { query: 'x' }, 'auto', rules).decision).toBe('deny');
    expect(decide({ name: 'files.read', risk: 'read' }, { path: '/home/f/project/.env' }, 'auto', rules)).toEqual({ decision: 'deny', rule: 'files.read:*.env' });
    expect(decide({ name: 'files.read', risk: 'read' }, { path: '/home/f/notes.md' }, 'auto', rules).decision).toBe('allow');
    expect(decide({ name: 'files.write', risk: 'risky' }, { path: 'c:/windows/system32/x.dll' }, 'auto', rules).decision).toBe('deny');
    expect(globMatch('files.*', 'files.write')).toBe(true);
    expect(globMatch('files.*', 'task.add')).toBe(false);
    expect(parseRules(DEFAULT_DENY).length).toBe(DEFAULT_DENY.length);
  });
});

describe('no step, no claim', () => {
  test('finds claims', () => {
    expect(findClaims("Done! I've added “Buy milk” to your task board.").map((c) => c.kind)).toEqual(['task']);
    expect(findClaims('I generated an image of a red fox for you.').map((c) => c.kind)).toEqual(['image']);
    expect(findClaims('Here is the image you asked for.').map((c) => c.kind)).toEqual(['image']);
    expect(findClaims('I saved the notes to ideas.md.').map((c) => c.kind)).toEqual(['file']);
    expect(findClaims('I listed the files in your Documents folder: a, b, c.').map((c) => c.kind)).toEqual(['folder']);
    expect(findClaims('No problem, I have created the task “Call mum”.').map((c) => c.kind)).toEqual(['task']);
    expect(findClaims('Adicionei a tarefa “Comprar pão” ao quadro.').map((c) => c.kind)).toEqual(['task']);
    expect(findClaims('Gerei uma imagem de um gato.').map((c) => c.kind)).toEqual(['image']);
  });
  test('passive forms and file sentences', () => {
    expect(findClaims('Task added for oat milk, apples and eggs.').map((c) => c.kind)).toEqual(['task']);
    expect(findClaims('The tasks have been added to your list.').map((c) => c.kind)).toEqual(['task']);
    // Real reply (qwen3 8B, task 7): about a file that lists tasks.
    expect(findClaims('I have created the file `board.md` in the Lotus Studio folder, which lists the tasks on your task board.').map((c) => c.kind)).toEqual(['file']);
  });
  test('ignores offers, refusals, questions and code', () => {
    expect(findClaims("I can't add tasks without the task tool.")).toEqual([]);
    expect(findClaims('Would you like me to add this as a task?')).toEqual([]);
    expect(findClaims("I'll create the image once ComfyUI is running.")).toEqual([]);
    expect(findClaims("I couldn't generate the image because ComfyUI isn't running.")).toEqual([]);
    expect(findClaims('```\n// I added a task\n```')).toEqual([]);
    expect(findClaims('To add a task, open the Tasks page.')).toEqual([]);
  });
  test('backed claims pass', () => {
    expect(unbackedClaims("I've added the task.", ['task.add'])).toEqual([]);
    expect(unbackedClaims("I've added the task.", ['files.list']).length).toBe(1);
  });
});

describe('tool tags (models without native tools)', () => {
  test('parse and strip', () => {
    const r = parseTags('Sure.\n<tool name="task.add">{"title": "Buy milk"}</tool>\n');
    expect(r.calls).toEqual([{ name: 'task.add', args: { title: 'Buy milk' } }]);
    expect(r.text).toBe('Sure.');
    expect(parseTags('<tool name="files.list"></tool>').calls).toEqual([{ name: 'files.list', args: {} }]);
    expect(parseTags('<tool name="x.y">not json</tool>').calls[0].args).toEqual({});
    expect(parseTags('<tool name="x.y">{"a": 1} trailing</tool>').calls[0].args).toEqual({ a: 1 });
  });
  test('stream filter never shows part of a tag', () => {
    const f = new TagFilter();
    const chunks = ['Let me ', 'add it. <to', 'ol name="task.add">{"title"', ': "x"}</to', 'ol> After', ' <b>bold</b>'];
    const out = chunks.map((c) => f.push(c)).join('') + f.end();
    expect(out).toBe('Let me add it.  After <b>bold</b>');
  });
  test('instructions list every tool', () => {
    const t = tagInstructions([taskAdd, filesList]);
    expect(t).toContain('task.add');
    expect(t).toContain('title: string');
    expect(t).toContain('path?: string');
  });
});

describe('registry', () => {
  test('wire names', () => {
    expect(toWire('task.add')).toBe('task_add');
    expect(fromWire('task_add')).toBe('task.add');
    expect(fromWire('image_generate')).toBe('image.generate');
    expect(new Registry(ALL_TOOLS).get('files_read')?.name).toBe('files.read');
  });
  test('argument checks', () => {
    expect(checkArgs(taskAdd, { title: 'x', priority: 'HIGH', extra: 1 }).args).toEqual({ title: 'x', priority: 'high' });
    expect(checkArgs(taskAdd, {}).error).toBe('task.add needs title.');
    expect(checkArgs(taskAdd, { title: 'x', status: 'whenever' }).error).toContain('must be one of');
    expect(checkArgs(filesList, { depth: '2' }).args).toEqual({ depth: 2 });
    expect(checkArgs(taskAdd, { title: 'x', steps: 'a\nb' }).args.steps).toEqual(['a', 'b']);
  });
  test('enum values as models write them', () => {
    expect(checkArgs(taskMove, { task: 'x', status: 'In Progress' }).args.status).toBe('doing');
    expect(checkArgs(taskMove, { task: 'x', status: 'to-do' }).args.status).toBe('todo');
    expect(checkArgs(taskMove, { task: 'x', status: 'completed' }).args.status).toBe('done');
    expect(checkArgs(taskMove, { task: 'x', status: 'DONE' }).args.status).toBe('done');
    expect(checkArgs(taskMove, { task: 'x', status: 'whenever' }).error).toContain('must be one of');
    // Aliases are Lotus's own; models never see them.
    expect(JSON.stringify(wireTools([taskMove]))).not.toContain('aliases');
    expect(JSON.stringify(wireTools([taskMove]))).toContain('"enum"');
  });
  test('JSON written as text', () => {
    expect(textCall('{"name": "task_add", "parameters": {"title": "x"}}')).toEqual({ name: 'task_add', args: { title: 'x' } });
    expect(textCall('```json\n{"function": {"name": "files_list", "arguments": "{}"}}\n```')).toEqual({ name: 'files_list', args: {} });
    expect(textCall('{}')).toEqual({ name: '', args: {} });
    expect(textCall('Here: {"a": 1}')).toBeNull();
    // Nemotron / Qwen templates written as text (15 Nov real tasks).
    expect(textCall('<tool_call>\n<function=files_read>\n<parameter=path>\nnotes.txt\n</parameter>\n</function>\n</tool_call>')).toEqual({ name: 'files_read', args: { path: 'notes.txt' } });
    expect(textCall('Sure.\n<tool_call><function=task_add><parameter=title>Call the dentist</parameter><parameter=priority>2</parameter></function></tool_call>')).toEqual({ name: 'task_add', args: { title: 'Call the dentist', priority: 2 } });
    expect(textCall('<tool_call>{"name": "task_list", "arguments": {}}</tool_call>')).toEqual({ name: 'task_list', args: {} });
    expect(textCall('{"answer": 391}')).toBeNull();
  });
  test('every tool has a valid schema and label', () => {
    for (const t of ALL_TOOLS) {
      expect(t.label.length).toBeGreaterThan(3);
      for (const r of t.parameters.required ?? []) expect(t.parameters.properties[r]).toBeDefined();
    }
  });
});

describe('file tools', () => {
  const root = tmp('files');
  const allowed = join(root, 'allowed');
  const outside = join(root, 'outside');
  mkdirSync(join(allowed, 'notes'), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(allowed, 'notes', 'todo.md'), '# Todo\n- buy oat milk\n');
  writeFileSync(join(allowed, 'pic.png'), Buffer.from([0x89, 0x50, 0, 0, 1, 2]));
  writeFileSync(join(outside, 'secret.txt'), 'nope');
  try { symlinkSync(outside, join(allowed, 'link'), 'dir'); } catch { /* no symlinks here */ }
  const db = openDb(tmp('filesdb'));
  const ctx = ctxFor(db, allowed, [allowed]);

  test('paths stay inside the allowed folders', () => {
    expect('path' in resolveInFolders([allowed], 'notes/todo.md')).toBe(true);
    expect('error' in resolveInFolders([allowed], '../outside/secret.txt')).toBe(true);
    expect('error' in resolveInFolders([allowed], join(outside, 'secret.txt'))).toBe(true);
    if (existsSync(join(allowed, 'link'))) expect('error' in resolveInFolders([allowed], 'link/secret.txt')).toBe(true);
    expect('error' in resolveInFolders([], 'x')).toBe(true);
  });
  test('an invented location that names an allowed folder maps to it', () => {
    mkdirSync(join(root, 'Lotus Studio', 'notes'), { recursive: true });
    // Paths come back resolved (macOS /var → /private/var, Windows 8.3 names → long names), so compare real paths.
    const studio = realpathSync.native(join(root, 'Lotus Studio'));
    const r = resolveInFolders([studio], '/path/to/Lotus Studio/notes');
    expect('path' in r && r.path).toBe(join(studio, 'notes'));
    const w = resolveInFolders([studio], 'C:\\Program Files\\Lotus Studio\\new.md', true);
    expect('path' in w && w.path).toBe(join(studio, 'new.md'));
    expect('error' in resolveInFolders([studio], '/etc/passwd')).toBe(true);
    const rel = resolveInFolders([studio], 'Lotus Studio/notes');
    expect('path' in rel && rel.path).toBe(join(studio, 'notes'));
  });
  test('list, read, search', async () => {
    const l = await filesList.run({ depth: 2 }, ctx);
    expect(l.ok).toBe(true);
    expect(l.text).toContain('todo.md');
    const r = await filesRead.run({ path: 'notes/todo.md' }, ctx);
    expect(r.text).toContain('buy oat milk');
    expect((await filesRead.run({ path: 'pic.png' }, ctx)).ok).toBe(false);
    expect((await filesRead.run({ path: '../outside/secret.txt' }, ctx)).ok).toBe(false);
    const s = await filesSearch.run({ query: 'oat milk' }, ctx);
    expect(s.text).toContain('todo.md:2');
  });
  test('write: create refuses to replace, overwrite and append work', async () => {
    expect((await filesWrite.run({ path: 'new/ideas.md', content: 'one' }, ctx)).ok).toBe(true);
    expect(readFileSync(join(allowed, 'new', 'ideas.md'), 'utf8')).toBe('one');
    expect((await filesWrite.run({ path: 'new/ideas.md', content: 'two' }, ctx)).ok).toBe(false);
    await filesWrite.run({ path: 'new/ideas.md', content: ' three', mode: 'append' }, ctx);
    expect(readFileSync(join(allowed, 'new', 'ideas.md'), 'utf8')).toBe('one three');
    await filesWrite.run({ path: 'new/ideas.md', content: 'four', mode: 'overwrite' }, ctx);
    expect(readFileSync(join(allowed, 'new', 'ideas.md'), 'utf8')).toBe('four');
    expect((await filesWrite.run({ path: join(outside, 'x.txt'), content: 'x' }, ctx)).ok).toBe(false);
    expect(existsSync(join(outside, 'x.txt'))).toBe(false);
  });
});

describe('task tools', () => {
  const db = openDb(tmp('tasks'));
  const ctx = ctxFor(db, tmp('tasks-studio'), []);
  test('add, list, move on the board the Tasks page reads', async () => {
    const a = await taskAdd.run({ title: 'Buy milk', due: '2026-11-20', priority: 'high' }, ctx);
    expect(a.ok).toBe(true);
    const saved = JSON.parse(kvGet(db, TASKS_KEY)!);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ title: 'Buy milk', status: 'todo', assignee: 'me', priority: 'high', due: '2026-11-20' });
    await taskAdd.run({ title: 'Write report', status: 'backlog' }, ctx);
    expect((await taskList.run({ status: 'todo' }, ctx)).text).toContain('Buy milk');
    expect((await taskList.run({ status: 'todo' }, ctx)).text).not.toContain('Write report');
    const m = await taskMove.run({ task: 'buy milk', status: 'done' }, ctx);
    expect(m.ok).toBe(true);
    expect(JSON.parse(kvGet(db, TASKS_KEY)!).find((t: { title: string }) => t.title === 'Buy milk').status).toBe('done');
    expect((await taskMove.run({ task: 'nothing like this', status: 'done' }, ctx)).ok).toBe(false);
  });
});

describe('memory tools', () => {
  test('save and search, and nothing when memory is off', async () => {
    const db = openDb(tmp('mem'));
    const ctx = ctxFor(db, tmp('mem-s'), []);
    expect((await memorySave.run({ text: 'Prefers metric units' }, ctx)).ok).toBe(true);
    expect((await memorySave.run({ text: 'prefers metric units' }, ctx)).summary).toContain('Already');
    expect((await memorySearch.run({ query: 'units' }, ctx)).text).toContain('metric');
    const off = ctxFor(db, tmp('mem-o'), [], { memoryOn: false });
    expect((await memorySave.run({ text: 'Lives in Lisbon' }, off)).ok).toBe(false);
  });
});

describe('image tool', () => {
  test('makes a file, adds it to the Images page, uses the saved model', async () => {
    const comfy = fakeComfy({ models: ['sdxl-fake.safetensors'] }); stops.push(comfy.stop);
    const db = openDb(tmp('img'));
    const studio = tmp('img-studio');
    kvApply(db, { set: { 'lotus.engineUrls.v1': JSON.stringify({ comfyui: comfy.url }), 'lotus.image.params.v1': JSON.stringify({ checkpoint: 'sdxl-fake.safetensors', steps: 20 }) }, remove: [] });
    const r = await imageGenerate.run({ prompt: 'a red fox in snow', aspect: '16:9' }, ctxFor(db, studio, []));
    expect(r.ok).toBe(true);
    expect(r.media).toHaveLength(1);
    expect(existsSync(join(studio, ...r.media![0].split('/')))).toBe(true);
    const g = JSON.parse(kvGet(db, GALLERY_KEY)!);
    expect(g[0].versions[0]).toMatchObject({ file: r.media![0], prompt: 'a red fox in snow', checkpoint: 'sdxl-fake.safetensors', dimensions: '1344×768' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const graph = (comfy.prompts[0] as any).prompt;
    expect(graph['6'].inputs.text).toBe('a red fox in snow');
    expect(graph['3'].inputs.steps).toBe(20);
  });
  test('says plainly when ComfyUI is not running', async () => {
    const db = openDb(tmp('img2'));
    kvApply(db, { set: { 'lotus.engineUrls.v1': JSON.stringify({ comfyui: 'http://127.0.0.1:9' }) }, remove: [] });
    const r = await imageGenerate.run({ prompt: 'x' }, ctxFor(db, tmp('img2s'), []));
    expect(r.ok).toBe(false);
    expect(r.summary).toBe('ComfyUI is not running');
  });
});

// ── the loop ─────────────────────────────────────────────────────────────────

function harness(ollamaUrl: string, o: { approval?: 'ask' | 'risky' | 'auto'; approve?: (s: Step) => boolean | Promise<boolean>; folders?: string[]; db?: Db } = {}) {
  const db = o.db ?? openDb(tmp('loop'));
  const studio = tmp('loop-studio');
  const events: AgentEvent[] = [];
  const recorded: Step[] = [];
  const ctrl = new AbortController();
  const deps: AgentDeps = {
    llm: { backend: 'ollama', url: ollamaUrl, fetch },
    registry: new Registry(ALL_TOOLS),
    ctx: { db, studio, folders: o.folders ?? [studio], memoryOn: true, fetch, kvSet: (k, v) => { kvApply(db, { set: { [k]: v }, remove: [] }); }, kvGet: (k) => kvGet(db, k) },
    signal: ctrl.signal,
    emit: (e) => events.push(e),
    record: (s) => recorded.push({ ...s }),
    approve: async (s) => (o.approve ? o.approve(s) : true),
  };
  const req = (text: string, tools = ALL_TOOLS.filter((t) => !t.name.startsWith('web.'))) => ({
    runId: 'r1', model: 'fake', messages: [{ role: 'system', content: 'You are Lotus.' }, { role: 'user', content: text }] as WireMsg[],
    tools, approval: o.approval ?? 'risky', rules: parseRules(DEFAULT_DENY),
  });
  return { db, studio, events, recorded, ctrl, deps, req };
}

describe('agent loop', () => {
  test('native tool call → real step → final answer', async () => {
    __clearCapCache();
    const ol = fakeOllama((ms) => (last(ms, 'tool') ? { content: 'Added “Buy milk” to your board.' } : { calls: [{ name: 'task_add', args: { title: 'Buy milk' } }] }));
    stops.push(ol.stop);
    const h = harness(ol.url);
    const out = await runAgent(h.req('add buy milk to my tasks'), h.deps);
    expect(out.mode).toBe('native');
    expect(out.steps.map((s) => [s.tool, s.status])).toEqual([['task.add', 'done']]);
    expect(out.content).toBe('Added “Buy milk” to your board.');
    expect(out.unverified).toEqual([]);
    expect(JSON.parse(kvGet(h.db, TASKS_KEY)!)[0].title).toBe('Buy milk');
    expect(ol.requests[0].tools!.length).toBeGreaterThan(5);
    // The second request carries the tool result back to the model.
    const toolMsg = ol.requests[1].messages.find((m) => m.role === 'tool') as { content: string; tool_name: string };
    expect(toolMsg.tool_name).toBe('task_add');
    expect(toolMsg.content).toContain('Added task');
    expect(h.events.some((e) => e.kind === 'step' && e.step.status === 'done')).toBe(true);
  });

  test('a claim with no step gets one retry, then is flagged', async () => {
    __clearCapCache();
    // Lies twice.
    const liar = fakeOllama([{ content: "I've added “Call mum” to your task board." }]); stops.push(liar.stop);
    const h = harness(liar.url);
    const out = await runAgent(h.req('add call mum to my tasks'), h.deps);
    expect(liar.requests.length).toBe(2);
    expect(String(last(liar.requests[1].messages, 'user')?.content)).toContain('(Lotus check)');
    expect(out.steps).toEqual([]);
    expect(out.unverified).toEqual(['add or move a task']);
    expect(h.events.some((e) => e.kind === 'reset')).toBe(true);

    // Lies once, then uses the tool when reminded.
    __clearCapCache();
    let n = 0;
    const fixes = fakeOllama((ms) => {
      n++;
      if (last(ms, 'tool')) return { content: 'Done: “Call mum” is on your board.' };
      if (n === 1) return { content: "Sure! I've added “Call mum” to your tasks." };
      return { calls: [{ name: 'task_add', args: { title: 'Call mum' } }] };
    });
    stops.push(fixes.stop);
    const h2 = harness(fixes.url);
    const out2 = await runAgent(h2.req('add call mum to my tasks'), h2.deps);
    expect(out2.steps.map((s) => s.tool)).toEqual(['task.add']);
    expect(out2.unverified).toEqual([]);
    expect(out2.content).toBe('Done: “Call mum” is on your board.');
  });

  test('models without tool support use tags', async () => {
    __clearCapCache();
    const ol = fakeOllama((ms) => (String(last(ms, 'user')?.content).startsWith('Tool result')
      ? { content: 'Your folder has a notes folder.' }
      : { content: 'Let me look.\n<tool name="files.list">{}</tool>' }), { capabilities: ['completion'] });
    stops.push(ol.stop);
    const h = harness(ol.url);
    mkdirSync(join(h.studio, 'notes'));
    const out = await runAgent(h.req('what is in my folder?'), h.deps);
    expect(out.mode).toBe('tags');
    expect(ol.requests[0].tools).toBeUndefined();
    expect(String(ol.requests[0].messages[0].content)).toContain('<tool name="TOOL NAME">');
    expect(out.steps.map((s) => [s.tool, s.status])).toEqual([['files.list', 'done']]);
    expect(out.content).toBe('Let me look.\n\nYour folder has a notes folder.');
    const shown = h.events.filter((e) => e.kind === 'token').map((e) => (e as { text: string }).text).join('');
    expect(shown).not.toContain('<tool');
  });

  test('thinking models are asked not to think during tool turns', async () => {
    __clearCapCache();
    let body: Record<string, unknown> = {};
    const server = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(req) {
      if (new URL(req.url).pathname === '/api/show') return Response.json({ capabilities: ['completion', 'tools', 'thinking'] });
      body = (await req.json()) as Record<string, unknown>;
      return new Response(`${JSON.stringify({ message: { role: 'assistant', content: 'Hi.' }, done: true })}\n`);
    } });
    stops.push(() => server.stop(true));
    const h = harness(`http://127.0.0.1:${server.port}`);
    await runAgent(h.req('hi'), h.deps);
    expect(body.think).toBe(false);
    expect((body.options as { num_predict: number }).num_predict).toBe(4096);
  });

  test('a stream that goes silent ends the run with a clear error', async () => {
    __clearCapCache();
    const server = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(req) {
      if (new URL(req.url).pathname === '/api/show') return Response.json({ capabilities: ['completion', 'tools'] });
      const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(`${JSON.stringify({ message: { content: 'Hel' }, done: false })}\n`)); /* then nothing */ } });
      return new Response(stream);
    } });
    stops.push(() => server.stop(true));
    const was = IDLE_MS.value;
    IDLE_MS.value = 300;
    try {
      const h = harness(`http://127.0.0.1:${server.port}`);
      await expect(runAgent(h.req('hi'), h.deps)).rejects.toThrow('sent nothing for');
    } finally { IDLE_MS.value = was; }
  });

  test('a call written as text is run; an unknown one gets one reminder', async () => {
    __clearCapCache();
    let n = 0;
    const ol = fakeOllama((ms) => {
      n++;
      if (last(ms, 'tool')) return { content: 'Added.' };
      if (n === 1) return { content: '{"name": "math_multiply", "parameters": {"x": 17, "y": 23}}' };
      if (n === 2) return { content: '{"name": "task_add", "parameters": {"title": "Buy eggs"}}' };
      return { content: 'x' };
    });
    stops.push(ol.stop);
    const h = harness(ol.url);
    const out = await runAgent(h.req('add buy eggs'), h.deps);
    expect(String(ol.requests[1].messages.at(-1)!.content)).toContain('There is no tool called math_multiply');
    expect(out.steps.map((s) => [s.tool, s.status])).toEqual([['task.add', 'done']]);
    expect(out.content).toBe('Added.');
    const shown = h.events.filter((e) => e.kind === 'reset');
    expect(shown.length).toBe(2);
  });

  test('an engine that never starts answering ends the run with a clear error', async () => {
    __clearCapCache();
    const server = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(req) {
      if (new URL(req.url).pathname === '/api/show') return Response.json({ capabilities: ['completion', 'tools'] });
      await Bun.sleep(2000);
      return new Response('');
    } });
    stops.push(() => server.stop(true));
    const was = IDLE_MS.value;
    IDLE_MS.value = 300;
    try {
      const h = harness(`http://127.0.0.1:${server.port}`);
      await expect(runAgent(h.req('hi'), h.deps)).rejects.toThrow('sent nothing for');
    } finally { IDLE_MS.value = was; }
  });

  test('falls back to tags when Ollama refuses the tool list', async () => {
    __clearCapCache();
    const ol = fakeOllama([{ content: 'Hello!' }], { capabilities: [], rejectTools: true }); stops.push(ol.stop);
    const h = harness(ol.url);
    const out = await runAgent(h.req('hi'), h.deps);
    expect(out.mode).toBe('tags');
    expect(out.content).toBe('Hello!');
  });

  test('risky steps wait for approval; Deny is respected', async () => {
    __clearCapCache();
    const ol = fakeOllama((ms) => (last(ms, 'tool') ? { content: (last(ms, 'tool') as { content: string }).content.includes('denied') ? 'Okay, I did not save it.' : 'Saved.' } : { calls: [{ name: 'files_write', args: { path: 'a.md', content: 'hi' } }] }));
    stops.push(ol.stop);
    const asked: Step[] = [];
    const h = harness(ol.url, { approve: (s) => { asked.push(s); return false; } });
    const out = await runAgent(h.req('save hi to a.md'), h.deps);
    expect(asked).toHaveLength(1);
    expect(asked[0].ask).toBe('Create a.md (2 characters)');
    expect(out.steps[0].status).toBe('denied');
    expect(existsSync(join(h.studio, 'a.md'))).toBe(false);
    expect(out.content).toBe('Okay, I did not save it.');

    const h2 = harness(ol.url, { approve: () => true });
    const out2 = await runAgent(h2.req('save hi to a.md'), h2.deps);
    expect(out2.steps[0].status).toBe('done');
    expect(readFileSync(join(h2.studio, 'a.md'), 'utf8')).toBe('hi');

    const h3 = harness(ol.url, { approval: 'auto', approve: () => { throw new Error('should not ask'); } });
    expect((await runAgent(h3.req('save hi to a.md'), h3.deps)).steps[0].status).toBe('done');
  });

  test('deny rules block without asking; unknown tools and bad arguments are explained to the model', async () => {
    __clearCapCache();
    let n = 0;
    const ol = fakeOllama(() => {
      n++;
      if (n === 1) return { calls: [{ name: 'files_read', args: { path: '.env' } }, { name: 'shell_run', args: { cmd: 'ls' } }, { name: 'task_add', args: {} }] };
      return { content: 'Some of that was blocked.' };
    });
    stops.push(ol.stop);
    const h = harness(ol.url, { approval: 'auto' });
    const out = await runAgent(h.req('do things'), h.deps);
    expect(out.steps.map((s) => [s.tool, s.status])).toEqual([['files.read', 'denied'], ['task.add', 'error']]);
    const tools = ol.requests[1].messages.filter((m) => m.role === 'tool').map((m) => (m as { content: string }).content);
    expect(tools[0]).toContain('block');
    expect(tools[1]).toContain('There is no tool called shell_run');
    expect(tools[2]).toContain('task.add needs title');
  });

  test('the same call over and over is stopped; a run has a turn limit', async () => {
    __clearCapCache();
    const ol = fakeOllama([{ calls: [{ name: 'task_list', args: {} }] }]); stops.push(ol.stop);
    const h = harness(ol.url);
    const out = await runAgent({ ...h.req('loop'), maxTurns: 5 }, h.deps);
    // 5 turns, then one more without tools to ask for an answer (0.16.5); this model still only calls tools.
    expect(ol.requests.length).toBe(6);
    expect(ol.requests[5].tools ?? []).toEqual([]);
    expect(out.steps.length).toBe(2);
    // 0.20.0: no answer means not finished, and the note says so in plain words.
    expect(out.content).toContain("couldn't finish this");
    expect(out.finished).toBe(false);
  });
});

// ── through the core's API ───────────────────────────────────────────────────

describe('agent over the core API', () => {
  test('agent_start streams events, records the run, approvals by agent_decide', async () => {
    __clearCapCache();
    const ol = fakeOllama((ms) => (last(ms, 'tool') ? { content: 'Saved your note.' } : { calls: [{ name: 'files_write', args: { path: 'note.md', content: 'remember the milk' } }] }));
    stops.push(ol.stop);
    const db = openDb(tmp('api'));
    const studio = tmp('api-studio');
    kvApply(db, { set: { 'lotus.engineUrls.v1': JSON.stringify({ ollama: ol.url }), 'lotus.settings.v1': JSON.stringify({ agentApproval: 'risky' }) }, remove: [] });
    const TOKEN = 'y'.repeat(48);
    const server = startServer({ db, studio, token: TOKEN });
    stops.push(() => { server.board.stop(); server.stop(true); });
    const base = `http://127.0.0.1:${server.port}`;
    const rpc = async (m: string, a: unknown) => ((await (await fetch(`${base}/v1/rpc/${m}`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(a) })).json()) as { result: any }).result; // eslint-disable-line @typescript-eslint/no-explicit-any

    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/v1/events?t=${TOKEN}`);
    const got: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    await new Promise((r) => { ws.onopen = r; });
    ws.onmessage = (m) => got.push(JSON.parse(String(m.data)));

    const tools = await rpc('agent_tools', {});
    expect(tools.tools.map((t: { name: string }) => t.name)).toContain('image.generate');
    expect(tools.folders).toEqual([studio]);

    const { runId } = await rpc('agent_start', { model: 'fake', prompt: 'save a note', messages: [{ role: 'system', content: 'You are Lotus.' }, { role: 'user', content: 'save a note' }] });
    const until = async (f: () => boolean) => { for (let i = 0; i < 200 && !f(); i++) await Bun.sleep(10); expect(f()).toBe(true); };
    await until(() => got.some((e) => e.type === 'agent' && e.kind === 'step' && e.step.status === 'waiting'));
    const waiting = got.find((e) => e.kind === 'step' && e.step.status === 'waiting').step;
    expect(waiting.ask).toBe('Create note.md (17 characters)');
    expect(await rpc('agent_decide', { runId, stepId: waiting.id, allow: true })).toBe(true);
    await until(() => got.some((e) => e.type === 'agent' && e.kind === 'done'));
    expect(got.find((e) => e.kind === 'done').content).toBe('Saved your note.');
    expect(readFileSync(join(studio, 'note.md'), 'utf8')).toBe('remember the milk');
    const run = await rpc('agent_run', { runId });
    expect(run.status).toBe('done');
    expect(run.steps.map((s: Step) => [s.tool, s.status])).toEqual([['files.write', 'done']]);
    expect(getRun(db, runId)!.reply).toBe('Saved your note.');
    ws.close();
  });

  test('agent_stop ends a waiting run; a restart closes runs that were going', async () => {
    __clearCapCache();
    const ol = fakeOllama([{ calls: [{ name: 'files_write', args: { path: 'x.md', content: 'x' } }] }]); stops.push(ol.stop);
    const db = openDb(tmp('stop'));
    kvApply(db, { set: { 'lotus.engineUrls.v1': JSON.stringify({ ollama: ol.url }), 'lotus.settings.v1': JSON.stringify({ llmBackend: 'ollama' }) }, remove: [] });
    const events: Record<string, unknown>[] = [];
    const svc = new AgentService({ db, studio: tmp('stop-s'), broadcast: (e) => events.push(e) });
    const { runId } = svc.start({ model: 'fake', prompt: 'x', messages: [{ role: 'user', content: 'x' }] });
    for (let i = 0; i < 200 && !events.some((e) => e.kind === 'step'); i++) await Bun.sleep(10);
    expect(svc.stop(runId)).toBe(true);
    for (let i = 0; i < 200 && !events.some((e) => e.kind === 'done'); i++) await Bun.sleep(10);
    expect(getRun(db, runId)!.status).toBe('stopped');
    db.sql.run("UPDATE agent_runs SET status = 'running'");
    new AgentService({ db, studio: tmp('stop-s2'), broadcast: () => undefined });
    expect(getRun(db, runId)!.status).toBe('stopped');
  });

  test('memory and web tools are only offered when on for the chat', () => {
    const svc = new AgentService({ db: openDb(tmp('offer')), studio: tmp('offer-s'), broadcast: () => undefined });
    const names = (a: { memoryOn?: boolean; web?: boolean }) => svc.toolsFor(a).map((t) => t.name);
    expect(names({})).not.toContain('memory.save');
    expect(names({})).not.toContain('web.search');
    expect(names({ memoryOn: true, web: true })).toEqual(expect.arrayContaining(['memory.save', 'web.search', 'web.read']));
  });
});
