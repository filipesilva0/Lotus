// 0.18.0 Advanced mode: MCP tool servers and the local API.

import { afterAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { McpHub, mcpToolName, pickAnswer, resultText, toLotusSchema } from '../src/mcp';

const FAKE = join(import.meta.dir, 'fake-engines', 'fake-mcp.ts');
const kvOf = (v: unknown) => (k: string) => (k === 'lotus.mcp.v1' ? JSON.stringify(v) : null);

describe('MCP pieces', () => {
  test('tool names fit the registry', () => {
    expect(mcpToolName('GitHub Server', 'create-issue')).toBe('mcp.github_server_create_issue');
    expect(mcpToolName('fs', 'read_file2')).toBe('mcp.fs_read_file');
    expect(/^[a-z]+\.[a-z_]+$/.test(mcpToolName('Ünï 9', 'x'))).toBe(true);
  });
  test('objects travel as JSON text', () => {
    const { schema, jsonArgs } = toLotusSchema({ type: 'object', properties: { q: { type: 'string', description: 'Query' }, n: { type: ['integer', 'null'] }, f: { type: 'object' } }, required: ['q', 'z'] });
    expect(schema.properties.q.type).toBe('string');
    expect(schema.properties.n.type).toBe('integer');
    expect(schema.properties.f.description).toContain('JSON');
    expect([...jsonArgs]).toEqual(['f']);
    expect(schema.required).toEqual(['q']);
  });
  test('answers from JSON or an event stream', () => {
    expect(pickAnswer('application/json', '{"jsonrpc":"2.0","id":3,"result":{"x":1}}', 3)?.result).toEqual({ x: 1 });
    const sse = 'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\nevent: message\ndata: {"jsonrpc":"2.0","id":4,"result":{"ok":true}}\n\n';
    expect(pickAnswer('text/event-stream', sse, 4)?.result).toEqual({ ok: true });
  });
  test('results become text', () => {
    expect(resultText({ content: [{ type: 'text', text: 'hi' }, { type: 'image', mimeType: 'image/png' }] })).toEqual({ ok: true, text: 'hi\n[image image/png]' });
    expect(resultText({ content: [], isError: true, structuredContent: { a: 1 } })).toEqual({ ok: false, text: '{"a":1}' });
  });
});

describe('a stdio server', () => {
  const hub = new McpHub({ kvGet: kvOf([{ id: 's1', name: 'Fake Math', command: process.execPath, args: [FAKE] }, { id: 's2', name: 'Off', command: 'nothing', enabled: false }]) });
  afterAll(() => hub.stop());
  test('starts, lists its tools and runs one', async () => {
    await hub.ready();
    const st = hub.status();
    expect(st[0]).toMatchObject({ name: 'Fake Math', state: 'ready', tools: ['add_numbers', 'fail'] });
    expect(st[1]).toMatchObject({ state: 'off', enabled: false });
    const tools = hub.tools();
    expect(tools.map((t) => t.name)).toEqual(['mcp.fake_math_add_numbers', 'mcp.fake_math_fail']);
    expect(tools[0].risk).toBe('risky');
    const r = await tools[0].run({ a: 2, b: 3, opts: '{"x":1}' }, {} as never);
    expect(r).toMatchObject({ ok: true, text: 'sum=5 opts={"x":1}' });
    expect((await tools[1].run({}, {} as never)).ok).toBe(false);
  });
  test('a program that does not exist says so', async () => {
    const bad = new McpHub({ kvGet: kvOf([{ id: 'x', name: 'Broken', command: '/no/such/program' }]) });
    await bad.ready();
    expect(bad.status()[0].state).toBe('error');
    expect(bad.tools()).toEqual([]);
    bad.stop();
  });
});

describe('an HTTP server', () => {
  test('keeps the session id and reads event streams', async () => {
    const seen: { session: string | null; method: string }[] = [];
    const fetch = (async (_url: string, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      const m = JSON.parse(String(init?.body ?? '{}'));
      seen.push({ session: h.get('mcp-session-id'), method: m.method });
      if (m.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: {} }), { headers: { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' } });
      if (m.method === 'tools/list') return new Response(`data: ${JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'search', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } }] } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
      if (m.method === 'tools/call') return new Response(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `found ${m.params.arguments.q}` }] } }), { headers: { 'content-type': 'application/json' } });
      return new Response(null, { status: 202 });
    }) as unknown as typeof globalThis.fetch;
    const hub = new McpHub({ kvGet: kvOf([{ id: 'h', name: 'Docs', url: 'https://example.test/mcp', headers: { authorization: 'Bearer k' } }]), fetch });
    await hub.ready();
    const [t] = hub.tools();
    expect(t.name).toBe('mcp.docs_search');
    expect((await t.run({ q: 'lotus' }, {} as never)).text).toBe('found lotus');
    expect(seen.map((s) => s.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
    expect(seen.slice(1).every((s) => s.session === 'sess-1')).toBe(true);
    hub.stop();
  });
});

describe('local API', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { openDb } = await import('../src/db');
  const { kvApply } = await import('../src/kv');
  const { LocalApi, chatUpstream } = await import('../src/localApi');
  const db = openDb(mkdtempSync(join(tmpdir(), 'lotus-api-')));
  const KEY = 'lotus-test-key-0123456789';
  kvApply(db, { set: {
    'lotus.localApi.v1': JSON.stringify({ enabled: true, port: 11999, key: KEY }),
    'lotus.settings.v1': JSON.stringify({ llmBackend: 'llamacpp', llamacppUrl: 'https://api.example.test/', selectedModel: 'gpt-small' }),
    'lotus.engineAuth.v1': JSON.stringify({ llamacpp: 'sk-cloud' }),
  }, remove: [] });
  const calls: { url: string; auth: string | null; body: string }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, auth: new Headers(init?.headers).get('authorization'), body: String(init?.body ?? '') });
    return new Response('{"choices":[{"message":{"content":"hi"}}]}', { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof globalThis.fetch;
  const api = new LocalApi({ db, fetch });
  const req = (path: string, o: { key?: string; body?: unknown; origin?: string } = {}) => new Request(`http://127.0.0.1:11999${path}`, {
    method: o.body ? 'POST' : 'GET',
    headers: { ...(o.key !== undefined ? { authorization: `Bearer ${o.key}` } : {}), ...(o.origin ? { origin: o.origin } : {}), 'content-type': 'application/json' },
    body: o.body ? JSON.stringify(o.body) : undefined,
  });

  test('a cloud service set up with its key is the upstream', () => {
    expect(chatUpstream(db)).toEqual({ url: 'https://api.example.test', auth: 'Bearer sk-cloud', builtin: false });
  });
  test('needs the key, and refuses web pages', async () => {
    expect((await api.handle(req('/v1/models'))).status).toBe(401);
    expect((await api.handle(req('/v1/models', { key: 'wrong' }))).status).toBe(401);
    expect((await api.handle(req('/v1/models', { key: KEY, origin: 'https://evil.test' }))).status).toBe(403);
  });
  test('passes chat on with the engine key and the selected model', async () => {
    const r = await api.handle(req('/v1/chat/completions', { key: KEY, body: { messages: [{ role: 'user', content: 'hi' }] } }));
    expect(r.status).toBe(200);
    const last = calls.at(-1)!;
    expect(last.url).toBe('https://api.example.test/v1/chat/completions');
    expect(last.auth).toBe('Bearer sk-cloud');
    expect(JSON.parse(last.body).model).toBe('gpt-small');
  });
  test('really listens on 127.0.0.1 when turned on, and stops when off', async () => {
    const live = new LocalApi({ db, fetch });
    expect(live.apply()).toMatchObject({ running: true, url: 'http://127.0.0.1:11999/v1' });
    const r = await globalThis.fetch('http://127.0.0.1:11999/v1/nothing', { headers: { authorization: `Bearer ${KEY}` } });
    expect(r.status).toBe(404);
    kvApply(db, { set: { 'lotus.localApi.v1': JSON.stringify({ enabled: false, port: 11999, key: KEY }) }, remove: [] });
    expect(live.apply().running).toBe(false);
    kvApply(db, { set: { 'lotus.localApi.v1': JSON.stringify({ enabled: true, port: 11999, key: 'short' }) }, remove: [] });
    expect(live.apply()).toMatchObject({ running: false, error: 'Make an access key first.' });
  });
});
