// Session 14: the web app against a REAL lotusd core (no mocks for storage).
//
//   npm run build && node handover/verification/core-e2e.mjs
//   LOTUSD_BIN=src-tauri/binaries/lotusd-x86_64-unknown-linux-gnu node handover/verification/core-e2e.mjs   # the compiled sidecar
//
// What it checks, in a real Chromium:
//   1. An "older Lotus" profile (localStorage + IndexedDB with a gallery image blob and an App
//      Builder chat) is imported into lotus.db the first time the app meets the core.
//   2. Memory items move into the memories table; the gallery image becomes a file in Images/.
//   3. Clearing the browser's storage loses nothing: the app reads from the core.
//   4. A write from another window arrives as a `storage` event (cross-window sync).
//   5. Writes made in the UI land in lotus.db.
// Needs: bun, playwright (preinstalled in the dev sandbox), `npm run build` done.

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = process.cwd();
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`); if (!cond) failed++; };

// ── static server for dist/ ──
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const web = createServer((req, res) => {
  const p = join(root, 'dist', decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(join(root, 'dist')) || !existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' }); res.end(readFileSync(p));
}).listen(8124, '127.0.0.1');
const U = 'http://127.0.0.1:8124';

// ── the core ──
const data = mkdtempSync(join(tmpdir(), 'lotus-e2e-data-'));
const studio = mkdtempSync(join(tmpdir(), 'lotus-e2e-studio-'));
const token = randomBytes(32).toString('hex');
const bin = process.env.LOTUSD_BIN;
const core = spawn(bin ?? 'bun', bin ? ['--data', data, '--studio', studio, '--watch-stdin'] : [join(root, 'core/src/main.ts'), '--data', data, '--studio', studio, '--watch-stdin'],
  { env: { ...process.env, LOTUSD_TOKEN: token, LOTUSD_ORIGINS: U }, stdio: ['pipe', 'pipe', 'ignore'] });
const port = await new Promise((resolve, reject) => {
  let out = '';
  core.stdout.on('data', (b) => { out += b; const m = /LOTUSD_READY (\{.*\})/.exec(out); if (m) resolve(JSON.parse(m[1]).port); });
  core.on('exit', (c) => reject(new Error(`lotusd exited ${c}`)));
  setTimeout(() => reject(new Error('lotusd did not start')), 15000);
});
console.log(`lotusd ${bin ? '(compiled) ' : ''}on ${port}`);
const api = async (path, init = {}) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.headers.get('content-type')?.includes('json') ? r.json() : r;
};
const rpc = async (m, a = {}) => (await api(`/v1/rpc/${m}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) })).result;

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (process.env.DEBUG) { page.on('console', (m) => console.log('console:', m.text(), JSON.stringify(m.location()))); page.on('requestfailed', (r) => console.log('reqfail', r.url())); }

  // 1. An older Lotus: everything in browser storage, no core.
  const now = Date.now();
  const sessions = [{ id: 'c1', title: 'Knee rehab after ACL', model: 'qwen3.5:9b', updatedAt: '', ts: now - 60000, messages: [
    { id: 'u1', role: 'user', content: 'What should week two of ACL rehab look like?', timestamp: '' },
    { id: 'a1', role: 'assistant', content: 'Week two focuses on quad activation and full extension.', timestamp: '' }] }];
  await page.goto(`${U}/index.html`);
  await page.evaluate(async ({ sessions }) => {
    localStorage.clear();
    localStorage.setItem('lotus.setup.dismissed', '1');
    localStorage.setItem('lotus.settings.v1', JSON.stringify({ appearance: 'light', selectedModel: 'qwen3.5:9b' }));
    localStorage.setItem('lotus.sessions.v1', JSON.stringify(sessions));
    localStorage.setItem('lotus.activeSession.v1', JSON.stringify('c1'));
    localStorage.setItem('lotus.tasks.v1', JSON.stringify([{ id: 't1', title: 'Write the GEFT report', status: 'todo', created: 1 }]));
    localStorage.setItem('lotus.memory.v1', JSON.stringify([{ id: 'm1', kind: 'memory', text: 'Studies physiotherapy at ESTeSL', ts: 1 }]));
    localStorage.setItem('unrelated.key', 'x');
    // IndexedDB: a gallery with one image blob, and an App Builder chat.
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const blob = new Blob([png], { type: 'image/png' });
    await new Promise((res, rej) => {
      const r = indexedDB.open('lotus', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => {
        const tx = r.result.transaction('kv', 'readwrite');
        tx.objectStore('kv').put([{ id: 'g1', title: 'Red bicycle', ts: 1, index: 0, versions: [{ id: 'img-1', url: '', blob, prompt: 'a red bicycle', seed: 1, steps: 20, cfg: 7, dimensions: '1×1', checkpoint: 'x', timestamp: '', generationTimeSec: 1 }] }], 'gallery.v1');
        tx.objectStore('kv').put({ items: [{ kind: 'user', text: 'make a todo app' }], history: [], plan: null }, 'lotus.builder.chat.p1');
        tx.oncomplete = res; tx.onerror = rej;
      };
      r.onerror = rej;
    });
  }, { sessions });

  // 2. Same profile, now with a core (what the desktop app hands over through core_info).
  await ctx.addInitScript(`window.__LOTUS_CORE__ = ${JSON.stringify({ port, token, version: '0.1.0', pid: 0 })};`);
  await page.goto(`${U}/index.html`);
  await page.waitForSelector('text=Knee rehab after ACL', { timeout: 10000 }).catch(async (e) => { await page.screenshot({ path: '/tmp/shots/s14-e2e-fail.png' }); if (process.env.DEBUG) console.log((await page.content()).slice(0, 1500)); throw e; });
  await page.waitForTimeout(1200);

  let all = (await api('/v1/kv')).items;
  ok('import: chats moved into lotus.db', JSON.parse(all['lotus.sessions.v1'] ?? '[]')[0]?.title === 'Knee rehab after ACL');
  ok('import: tasks and settings moved', !!all['lotus.tasks.v1'] && JSON.parse(all['lotus.settings.v1'] ?? '{}').selectedModel === 'qwen3.5:9b');
  ok('import: only lotus.* keys', !('unrelated.key' in all));
  ok('import: App Builder chat from IndexedDB', JSON.parse(all['lotus.idb.lotus.builder.chat.p1'] ?? '{}').items?.[0]?.text === 'make a todo app');
  const mems = await rpc('memories_list');
  ok('import: memory item moved into the memories table', mems.some((m) => m.text === 'Studies physiotherapy at ESTeSL') && !('lotus.memory.v1' in all));
  ok('import: memory search works on it', (await rpc('memories_search', { query: 'where does he study physiotherapy' })).includes('m1'));

  // Gallery: visiting Images loads the old blobs and saves them as files.
  await page.keyboard.press('Control+2');
  await page.waitForTimeout(2500);
  all = (await api('/v1/kv')).items;
  const gallery = JSON.parse(all['lotus.gallery.v2'] ?? '[]');
  const file = gallery[0]?.versions?.[0]?.file;
  ok('gallery: image saved as a file in Lotus Studio/Images', !!file && existsSync(join(studio, ...file.split('/'))), file);
  ok('gallery: no blob or object URL in saved data', !!file && !JSON.stringify(gallery).includes('blob:'));
  const media = (await api('/v1/media-list?kind=image')).items;
  ok('gallery: indexed in the media table', media.some((m) => m.path === file));

  // 3. Wipe the browser's storage: nothing is lost.
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(() => new Promise((r) => { const d = indexedDB.deleteDatabase('lotus'); d.onsuccess = d.onerror = d.onblocked = r; }));
  await page.goto(`${U}/index.html`);
  const stillThere = await page.waitForSelector('text=Knee rehab after ACL', { timeout: 10000 }).then(() => true, () => false);
  ok('browser storage cleared: chats still load (from the core)', stillThere);
  await page.keyboard.press('Control+2');
  await page.waitForTimeout(2000);
  const imgShown = await page.evaluate(() => [...document.images].some((i) => i.src.startsWith('blob:') && i.naturalWidth > 0));
  ok('browser storage cleared: the image loads back from its file', imgShown);
  ok('browser storage cleared: import is not repeated', (await api('/v1/kv')).items['lotus.sessions.v1'] === all['lotus.sessions.v1']);

  // 4. Another window writes: this one gets a storage event.
  await page.keyboard.press('Control+1');
  await page.evaluate(() => { window.__got = []; window.addEventListener('storage', (e) => window.__got.push([e.key, e.newValue])); });
  await api('/v1/kv', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ set: { 'lotus.island.v1': '{"enabled":true}' }, remove: [], origin: 'island' }) });
  await page.waitForTimeout(400);
  const got = await page.evaluate(() => window.__got);
  ok('cross-window: storage event for a write from another window', got.some(([k, v]) => k === 'lotus.island.v1' && v === '{"enabled":true}'));

  // 5. A change made in the UI lands in lotus.db (delete a chat, let the Undo window pass).
  await page.hover('text=Knee rehab after ACL');
  await page.click('button[aria-label="Delete conversation"] >> visible=true');
  await page.waitForTimeout(9000);
  const after = JSON.parse((await api('/v1/kv')).items['lotus.sessions.v1'] ?? '[]');
  ok('UI write: deleting a chat is saved in lotus.db', !after.some((s) => s.title === 'Knee rehab after ACL'), `${after.length} left`);

  ok('no page errors', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: '/tmp/shots/s14-core-e2e.png' }).catch(() => undefined);
} finally {
  await browser.close();
  core.stdin.end();
  await new Promise((r) => { core.on('exit', r); setTimeout(r, 3000); });
  web.close();
  const left = readdirSync(data);
  ok('core stopped when its stdin closed; lotus.db on disk', core.exitCode === 0 && left.includes('lotus.db'), `exit ${core.exitCode}`);
  rmSync(data, { recursive: true, force: true }); rmSync(studio, { recursive: true, force: true });
}
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
