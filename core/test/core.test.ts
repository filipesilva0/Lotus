import { afterAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getMeta, openDb, SCHEMA_VERSION, schemaVersion } from '../src/db';
import { kvAll, kvApply, kvMigrate, MIGRATED_KEY } from '../src/kv';
import * as mem from '../src/memory';
import { resolveMedia, safeName, saveMedia } from '../src/media';
import { startServer } from '../src/server';

const dirs: string[] = [];
const tmp = (tag: string) => { const d = mkdtempSync(join(tmpdir(), `lotusd-${tag}-`)); dirs.push(d); return d; };
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const TOKEN = 'x'.repeat(48);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const body = async (r: Response | Promise<Response>): Promise<any> => (await r).json();

describe('memory (port of the Rust tests)', () => {
  test('query is sanitised', () => {
    expect(mem.ftsQuery('How do I deploy the "app" to Vercel?')).toBe('"deploy"* OR "app"* OR "vercel"*');
    expect(mem.ftsQuery('the and of')).toBeNull();
    expect(mem.ftsQuery('NEAR(a b) OR x:y')).toBe('"near"*');
  });
  test('slugs are folder safe', () => {
    expect(mem.slug('Deploy a Vite app → GitHub Pages!')).toBe('deploy-a-vite-app-github-pages');
    expect(mem.slug('../../etc')).toBe('etc');
    expect(mem.slug('…')).toBe('skill');
  });
  test('index and search round trip', () => {
    const db = openDb(tmp('rt'));
    const msgs = [
      { id: 'm1', sessionId: 's1', title: 'Router', role: 'user', content: 'My TP-Link router keeps dropping wifi at night', ts: 1 },
      { id: 'm2', sessionId: 's2', title: 'Cake', role: 'user', content: 'A lemon drizzle cake recipe', ts: 2 },
    ];
    mem.indexMessages(db, msgs);
    const hits = mem.searchMessages(db, 'why does my wifi drop?', '', 5);
    expect(hits.length).toBe(1);
    expect(hits[0].sessionId).toBe('s1');
    expect(mem.searchMessages(db, 'wifi', 's1', 5)).toEqual([]);
    mem.indexMessages(db, msgs);
    expect(mem.searchMessages(db, 'lemon', '', 5).length).toBe(1);
    expect(mem.status(db).messages).toBe(2);
    db.sql.close();
  });
  test('skill markdown has front matter', () => {
    const md = mem.skillMarkdown({ id: 'k', name: 'Fix "npm" EPERM', description: 'd', whenToUse: 'w', body: '1. step', tags: ['npm'], version: 2, uses: 0, wins: 0, enabled: true, origin: 'auto', created: 0, updated: 0 });
    expect(md.startsWith('---\nname: "Fix \'npm\' EPERM"')).toBe(true);
    expect(md).toContain('version: 2');
    expect(md.trimEnd().endsWith('1. step')).toBe(true);
  });
  test('skills: save, mirror to SKILL.md, rename moves the folder, search, delete', () => {
    const dir = tmp('sk');
    const db = openDb(dir);
    const s = { id: 'k1', name: 'Deploy to Pages', description: 'Publish a Vite site', whenToUse: 'user wants to deploy a site', body: '1. build', tags: [], version: 1, uses: 0, wins: 0, enabled: true, origin: 'auto', created: 1, updated: 1 };
    const file = mem.putSkill(db, s);
    expect(readFileSync(file, 'utf8')).toContain('name: "Deploy to Pages"');
    mem.putSkill(db, { ...s, name: 'Deploy to GitHub Pages', updated: 2 });
    expect(existsSync(join(dir, 'skills', 'deploy-to-pages'))).toBe(false);
    expect(existsSync(join(dir, 'skills', 'deploy-to-github-pages', 'SKILL.md'))).toBe(true);
    expect(mem.searchSkills(db, 'how do I deploy my site')).toEqual(['k1']);
    expect(mem.listSkills(db)[0].whenToUse).toBe('user wants to deploy a site');
    mem.deleteSkill(db, 'k1');
    expect(mem.listSkills(db)).toEqual([]);
    expect(existsSync(join(dir, 'skills', 'deploy-to-github-pages'))).toBe(false);
    db.sql.close();
  });
});

describe('database', () => {
  test('opens a lotus.db written by the Rust memory module and keeps its data', () => {
    const dir = tmp('legacy');
    const old = new Database(join(dir, 'lotus.db'));
    old.run('CREATE TABLE memories(id TEXT PRIMARY KEY, kind TEXT, text TEXT, source TEXT, uses INTEGER, ts INTEGER, updated INTEGER)');
    old.run('CREATE TABLE skills(id TEXT PRIMARY KEY, json TEXT NOT NULL, updated INTEGER)');
    old.run("CREATE VIRTUAL TABLE memories_fts USING fts5(id UNINDEXED, text, tokenize='unicode61 remove_diacritics 2')");
    old.run("INSERT INTO memories VALUES ('a', 'memory', 'Filipe studies physiotherapy in Lisbon', 'user', 0, 5, 5)");
    old.run("INSERT INTO memories_fts VALUES ('a', 'Filipe studies physiotherapy in Lisbon')");
    // Rust serialised skills with serde camelCase; an older row may carry when_to_use.
    old.run(`INSERT INTO skills VALUES ('k', '${JSON.stringify({ id: 'k', name: 'Old', description: '', when_to_use: 'legacy', body: '', tags: [], version: 1, uses: 0, wins: 0, enabled: true, origin: 'auto', created: 0, updated: 0 })}', 0)`);
    old.close();
    const db = openDb(dir);
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(mem.listMemories(db).map((m) => m.text)).toEqual(['Filipe studies physiotherapy in Lisbon']);
    expect(mem.searchMemories(db, 'where does he study physiotherapy')).toEqual(['a']);
    expect(mem.listSkills(db)[0].whenToUse).toBe('legacy');
    db.sql.close();
    // Opening again is a no-op.
    const again = openDb(dir);
    expect(schemaVersion(again)).toBe(SCHEMA_VERSION);
    again.sql.close();
  });

  test('kv: atomic batches, invalid input rejected without partial writes', () => {
    const db = openDb(tmp('kv'));
    kvApply(db, { set: { 'lotus.a.v1': '1', 'lotus.b.v1': '"x"' }, remove: [] });
    expect(kvAll(db)).toEqual({ 'lotus.a.v1': '1', 'lotus.b.v1': '"x"' });
    expect(() => kvApply(db, { set: { 'lotus.c.v1': '3', '': 'bad' }, remove: [] })).toThrow();
    expect(kvAll(db)['lotus.c.v1']).toBeUndefined();
    expect(() => kvApply(db, { set: { 'lotus.d': 5 as unknown as string }, remove: [] })).toThrow();
    kvApply(db, { set: {}, remove: ['lotus.a.v1'] });
    expect(Object.keys(kvAll(db))).toEqual(['lotus.b.v1']);
    db.sql.close();
  });

  test('kv: browser-storage import runs once and never overwrites newer values', () => {
    const db = openDb(tmp('mig'));
    kvApply(db, { set: { 'lotus.settings.v1': '{"new":true}' }, remove: [] });
    const r = kvMigrate(db, { 'lotus.settings.v1': '{"old":true}', 'lotus.sessions.v1': '[]', 'bad': 7 as unknown as string });
    expect(r).toEqual({ added: 1 });
    expect(kvAll(db)['lotus.settings.v1']).toBe('{"new":true}');
    expect(getMeta(db, MIGRATED_KEY)).not.toBeNull();
    expect(kvMigrate(db, { 'lotus.other.v1': '1' })).toBeNull();
    expect(kvAll(db)['lotus.other.v1']).toBeUndefined();
    db.sql.close();
  });
});

describe('media', () => {
  test('paths cannot leave the Images/Audio folders', () => {
    const studio = tmp('studio');
    expect(resolveMedia(studio, 'Images/2026-11/a.png')).toBe(join(studio, 'Images', '2026-11', 'a.png'));
    for (const bad of ['../x.png', 'Images/../../x', 'Projects/a.png', '/etc/passwd', 'Images//a.png', 'Images\\..\\..\\x', '', 'Images/a\0.png']) {
      expect(resolveMedia(studio, bad)).toBeNull();
    }
    expect(safeName('../../My image: v2.png')).toBe('My-image-v2');
  });
  test('saves into Images/<month>/ and never overwrites', async () => {
    const studio = tmp('studio2');
    const db = openDb(tmp('mdb'));
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const a = await saveMedia(db, studio, png, 'image/png', 'red bicycle', new Date(2026, 10, 12));
    const b = await saveMedia(db, studio, png, 'image/png', 'red bicycle', new Date(2026, 10, 12));
    expect(a.path).toBe('Images/2026-11/red-bicycle.png');
    expect(b.path).toBe('Images/2026-11/red-bicycle-2.png');
    expect(existsSync(join(studio, 'Images', '2026-11', 'red-bicycle.png'))).toBe(true);
    await expect(saveMedia(db, studio, png, 'application/x-msdownload', 'x')).rejects.toThrow();
    db.sql.close();
  });
});

describe('HTTP API', () => {
  const studio = tmp('api-studio');
  const db = openDb(tmp('api'));
  const server = startServer({ db, studio, token: TOKEN, origins: ['http://127.0.0.1:8123'] });
  const base = `http://127.0.0.1:${server.port}`;
  const auth = { authorization: `Bearer ${TOKEN}` };
  afterAll(() => { server.stop(true); db.sql.close(); });

  test('health is open, everything else needs the token', async () => {
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await fetch(`${base}/v1/kv`)).status).toBe(401);
    expect((await fetch(`${base}/v1/kv`, { headers: { authorization: `Bearer ${'y'.repeat(48)}` } })).status).toBe(401);
    expect((await fetch(`${base}/v1/kv`, { headers: auth })).status).toBe(200);
  });
  test('a foreign Host header is refused (DNS rebinding)', async () => {
    const r = await fetch(`${base}/v1/kv`, { headers: { ...auth, host: 'evil.example:80' } });
    expect(r.status).toBe(403);
  });
  test('CORS only for known origins', async () => {
    const ok = await fetch(`${base}/v1/kv`, { method: 'OPTIONS', headers: { origin: 'http://127.0.0.1:8123' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:8123');
    const no = await fetch(`${base}/v1/kv`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
    expect(no.headers.get('access-control-allow-origin')).toBeNull();
  });
  test('kv writes are broadcast to other windows over the event socket', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/v1/events?t=${TOKEN}`);
    const got: unknown[] = [];
    await new Promise<void>((res) => { ws.onmessage = (e) => { got.push(JSON.parse(String(e.data))); if (got.length === 1) res(); }; });
    const next = new Promise<void>((res) => { ws.onmessage = (e) => { got.push(JSON.parse(String(e.data))); res(); }; });
    const r = await fetch(`${base}/v1/kv`, { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ set: { 'lotus.island.v1': '{"enabled":true}' }, remove: [], origin: 'main-1' }) });
    expect(r.status).toBe(200);
    await next;
    expect(got[1]).toEqual({ type: 'kv', set: { 'lotus.island.v1': '{"enabled":true}' }, remove: [], origin: 'main-1' });
    ws.close();
    const all = await body(fetch(`${base}/v1/kv`, { headers: auth }));
    expect(all.items['lotus.island.v1']).toBe('{"enabled":true}');
  });
  test('the event socket needs the token too', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/v1/events?t=wrong`);
    const outcome = await new Promise<string>((res) => { ws.onopen = () => res('open'); ws.onerror = () => res('error'); ws.onclose = () => res('closed'); });
    expect(outcome).not.toBe('open');
  });
  test('media upload, fetch, list, delete', async () => {
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const up = await body(fetch(`${base}/v1/media?name=cat`, { method: 'POST', headers: { ...auth, 'content-type': 'image/png' }, body: png }));
    expect(up.path).toMatch(/^Images\/\d{4}-\d{2}\/cat\.png$/);
    const got = await fetch(`${base}/v1/media/${up.path}?t=${TOKEN}`);
    expect(got.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(png);
    const list = await body(fetch(`${base}/v1/media-list?kind=image`, { headers: auth }));
    expect(list.items.map((x: { path: string }) => x.path)).toContain(up.path);
    expect((await fetch(`${base}/v1/media/..%2F..%2Fsecret`, { headers: auth })).status).toBe(400);
    expect((await fetch(`${base}/v1/media/${up.path}`, { method: 'DELETE', headers: auth })).status).toBe(200);
    expect((await fetch(`${base}/v1/media/${up.path}`, { headers: auth })).status).toBe(404);
  });
  test('rpc: memory methods by their old command names; unknown and prototype names refused', async () => {
    const call = async (m: string, args: unknown = {}) => fetch(`${base}/v1/rpc/${m}`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(args) });
    expect((await call('memories_put', { items: [{ id: 'x', kind: 'memory', text: 'Likes Warframe', source: 'user', uses: 0, ts: 1, updated: 1 }] })).status).toBe(200);
    expect((await body(call('memories_search', { query: 'warframe builds' }))).result).toEqual(['x']);
    expect((await body(call('mem_status'))).result.memories).toBe(1);
    expect((await call('nope')).status).toBe(404);
    expect((await call('constructor')).status).toBe(404);
    expect((await call('__proto__')).status).toBe(404);
    const bad = await fetch(`${base}/v1/rpc/mem_status`, { method: 'POST', headers: auth, body: '{not json' });
    expect(bad.status).toBe(400);
  });
});

describe('process', () => {
  test('prints READY, serves, and exits when the app closes its stdin', async () => {
    const data = tmp('proc');
    const p = Bun.spawn(['bun', join(import.meta.dir, '..', 'src', 'main.ts'), '--data', data, '--studio', tmp('proc-studio'), '--watch-stdin'], {
      env: { ...process.env, LOTUSD_TOKEN: TOKEN }, stdin: 'pipe', stdout: 'pipe', stderr: 'ignore',
    });
    const reader = p.stdout.getReader();
    let out = '';
    while (!out.includes('\n')) { const { value, done } = await reader.read(); if (done) break; out += new TextDecoder().decode(value); }
    const m = /LOTUSD_READY (\{.*\})/.exec(out);
    expect(m).not.toBeNull();
    const { port } = JSON.parse(m![1]);
    expect((await fetch(`http://127.0.0.1:${port}/v1/info`, { headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(200);
    p.stdin.end();
    const code = await Promise.race([p.exited, Bun.sleep(5000).then(() => 'timeout')]);
    expect(code).toBe(0);
    expect(existsSync(join(data, 'lotus.db'))).toBe(true);
    expect(readFileSync(join(data, 'logs', 'lotusd.log'), 'utf8')).toContain('the Lotus app closed');
  }, 15000);
  test('refuses to start without a token', async () => {
    const p = Bun.spawn(['bun', join(import.meta.dir, '..', 'src', 'main.ts'), '--data', tmp('nt'), '--studio', tmp('nt2')], { env: { ...process.env, LOTUSD_TOKEN: '' }, stdout: 'ignore', stderr: 'ignore' });
    expect(await p.exited).toBe(2);
  });
});
