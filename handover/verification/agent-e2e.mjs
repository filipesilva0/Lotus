// Session 15: Chat → agent in a REAL lotusd core → tools, in Chromium. Models and ComfyUI are fakes
// (core/test/fakes.ts) that behave like a tool-calling model; real models are real-tasks.mjs.
//
//   npm run build && node handover/verification/agent-e2e.mjs     (screenshots in /tmp/shots)
//
// Checks: a task added from Chat appears on the Tasks page; an image made from Chat shows in the
// reply, is a file in Lotus Studio/Images and appears on the Images page; saving a file waits for
// Allow (and Deny leaves nothing); a reply that claims an action no step did is flagged.

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = process.cwd();
const shots = '/tmp/shots';
mkdirSync(shots, { recursive: true });
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`); if (!cond) failed++; };

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const web = createServer((req, res) => {
  const p = join(root, 'dist', decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(join(root, 'dist')) || !existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' }); res.end(readFileSync(p));
}).listen(8125, '127.0.0.1');
const U = 'http://127.0.0.1:8125';

const readLine = (proc, tag) => new Promise((resolve, reject) => {
  let out = '';
  proc.stdout.on('data', (b) => { out += b; const m = new RegExp(`${tag} (\\{.*\\})`).exec(out); if (m) resolve(JSON.parse(m[1])); });
  proc.on('exit', (c) => reject(new Error(`${tag}: exited ${c}`)));
  setTimeout(() => reject(new Error(`${tag}: did not start`)), 15000);
});

const fakes = spawn('bun', [join(root, 'core/test/fakes.ts'), '--serve'], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, FAKES_TTL: '200' } });
const F = await readLine(fakes, 'FAKES');

const data = mkdtempSync(join(tmpdir(), 'lotus-agent-data-'));
const studio = mkdtempSync(join(tmpdir(), 'lotus-agent-studio-'));
const token = randomBytes(32).toString('hex');
const core = spawn('bun', [join(root, 'core/src/main.ts'), '--data', data, '--studio', studio, '--watch-stdin'],
  { env: { ...process.env, LOTUSD_TOKEN: token, LOTUSD_ORIGINS: U }, stdio: ['pipe', 'pipe', 'inherit'] });
const { port } = await readLine(core, 'LOTUSD_READY');
const api = async (path, init = {}) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
};
const kvPut = (set) => api('/v1/kv', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ set, remove: [], origin: 'test' }) });
const kv = async () => (await api('/v1/kv')).items;

const settings = (dark) => JSON.stringify({ appearance: dark ? 'dark' : 'light', selectedModel: 'fake:latest', agentApproval: 'risky', autoRename: false, autoMemory: false, autoSkills: false });
await kvPut({
  'lotus.setup.dismissed': '1', 'lotus.core.migrated.v1': '1',
  'lotus.settings.v1': settings(false),
  'lotus.engineUrls.v1': JSON.stringify({ ollama: F.ollama, comfyui: F.comfy }),
  'lotus.image.params.v1': JSON.stringify({ checkpoint: 'sdxl-fake.safetensors' }),
});

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  await ctx.addInitScript(`window.__LOTUS_CORE__ = ${JSON.stringify({ port, token, version: '0.2.0', pid: 0 })}; try { localStorage.setItem('lotus.core.migrated.v1', '1'); } catch {}`);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (process.env.DEBUG) page.on('console', (m) => console.log('console:', m.text()));
  await page.goto(`${U}/index.html`);
  await page.waitForSelector('textarea[aria-label="Message"]', { timeout: 15000 });
  const send = async (text) => { await page.fill('textarea[aria-label="Message"]', text); await page.keyboard.press('Enter'); };
  const waitText = (t, timeout = 15000) => page.waitForSelector(`text=${t}`, { timeout }).then(() => true, () => false);

  // 1. Task from Chat → Tasks page.
  await send('Add “Buy oat milk” to my tasks for Friday');
  ok('task: step shows with its real result', await waitText('Added “Buy oat milk” to To do'));
  ok('task: reply after the step', await waitText('Done. I added “Buy oat milk”'));
  const tasks = JSON.parse((await kv())['lotus.tasks.v1'] ?? '[]');
  ok('task: saved on the board in lotus.db', tasks.some((t) => t.title === 'Buy oat milk' && t.due === '2026-11-13' && t.status === 'todo'));
  await page.screenshot({ path: `${shots}/s15-chat-task-light.png` });
  await page.keyboard.press('Control+5');
  ok('task: visible on the Tasks page', await waitText('Buy oat milk', 5000));
  await page.screenshot({ path: `${shots}/s15-tasks-page-light.png` });
  await page.keyboard.press('Control+1');

  // 2. Image from Chat → reply, file, Images page.
  await send('Make an image of a fox in the snow');
  ok('image: thumbnail in the reply', await page.waitForSelector('ol[aria-label="Steps Lotus took"] img', { timeout: 15000 }).then(() => true, () => false));
  ok('image: reply after the step', await waitText('Here is your image'));
  const gallery = JSON.parse((await kv())['lotus.gallery.v2'] ?? '[]');
  const file = gallery[0]?.versions?.[0]?.file;
  ok('image: a file in Lotus Studio/Images', !!file && existsSync(join(studio, ...file.split('/'))), file);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${shots}/s15-chat-image-light.png` });
  await page.keyboard.press('Control+3');
  await page.waitForTimeout(1500);
  const onImages = await page.evaluate(() => [...document.images].some((i) => i.src.startsWith('blob:') && i.naturalWidth >= 100));
  ok('image: on the Images page', onImages);
  await page.screenshot({ path: `${shots}/s15-images-page-light.png` });
  await page.keyboard.press('Control+1');

  // 3. Saving a file waits for Allow.
  await send('Save my shopping list as a note');
  ok('file: asks first', await waitText('Needs your permission'));
  ok('file: says what it will do', await waitText('Create shopping-list.md (30 characters)'));
  await page.screenshot({ path: `${shots}/s15-approval-light.png` });
  ok('file: nothing written before Allow', !existsSync(join(studio, 'shopping-list.md')));
  await page.click('button:has-text("Allow")');
  ok('file: reply after Allow', await waitText('Saved. Created'));
  ok('file: written after Allow', existsSync(join(studio, 'shopping-list.md')) && readFileSync(join(studio, 'shopping-list.md'), 'utf8').includes('oat milk'));

  // 3b. Deny.
  rmSync(join(studio, 'shopping-list.md'));
  await send('Write the note again');
  await waitText('Needs your permission');
  await page.click('button:has-text("Deny") >> nth=-1');
  ok('file: Deny → not written, model told', await waitText("Okay, I didn't save it.") && !existsSync(join(studio, 'shopping-list.md')));

  // 4. A model that claims without acting.
  await kvPut({ 'lotus.engineUrls.v1': JSON.stringify({ ollama: F.liar, comfyui: F.comfy }) });
  await page.waitForTimeout(300);
  await send('Add renew passport to my tasks');
  ok('claim check: flagged in the reply', await waitText('This reply says Lotus did something it didn’t', 15000));
  const runs = await api('/v1/rpc/agent_runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  ok('claim check: recorded on the run', runs.result[0]?.unverified?.[0] === 'add or move a task');
  ok('claim check: no task was added', !JSON.parse((await kv())['lotus.tasks.v1']).some((t) => /passport/i.test(t.title)));
  await page.screenshot({ path: `${shots}/s15-unverified-light.png` });

  // 5. Dark.
  await kvPut({ 'lotus.settings.v1': settings(true), 'lotus.engineUrls.v1': JSON.stringify({ ollama: F.ollama, comfyui: F.comfy }) });
  await page.reload();
  await page.waitForSelector('textarea[aria-label="Message"]');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${shots}/s15-chat-dark.png` });
  await send('Save my shopping list as a note');
  await waitText('Needs your permission');
  await page.screenshot({ path: `${shots}/s15-approval-dark.png` });
  await page.click('button:has-text("Deny") >> nth=-1');

  // 6. Settings → Tools.
  await page.keyboard.press('Control+,');
  await page.waitForTimeout(400);
  const tab = page.locator('[role="tablist"] >> text=Tools');
  if (await tab.count()) await tab.click();
  ok('settings: Tools pane lists the core tools', await waitText('image.generate', 5000));
  await page.screenshot({ path: `${shots}/s15-settings-tools-dark.png` });

  ok('no page errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
  core.stdin.end();
  fakes.kill();
  await new Promise((r) => { core.on('exit', r); setTimeout(r, 3000); });
  web.close();
  rmSync(data, { recursive: true, force: true }); rmSync(studio, { recursive: true, force: true });
}
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
