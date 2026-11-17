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
}).listen(8126, '127.0.0.1');
const U = 'http://127.0.0.1:8126';

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

const settings = (dark) => JSON.stringify({ appearance: dark ? 'dark' : 'light', selectedModel: 'fake:latest', agentApproval: 'risky', autoRename: false, autoMemory: false, autoSkills: false, browserUse: true });
await kvPut({
  'lotus.setup.dismissed': '1', 'lotus.core.migrated.v1': '1',
  'lotus.settings.v1': settings(false),
  'lotus.engineUrls.v1': JSON.stringify({ ollama: F.work, comfyui: F.comfy }),
  'lotus.image.params.v1': JSON.stringify({ checkpoint: 'sdxl-fake.safetensors' }),
});


// Session 16 screenshots and checks: Work mode end to end (plan, a designed face, a named helper,
// a question answered in the page, two artifacts), the Tasks board without sideways scrolling, and
// Hardware & Runtime with live readings from the core. Run: npm run build && node handover/screenshots/shoot-s16.mjs
const browser = await chromium.launch();
try {
  for (const dark of [false, true]) {
    await kvPut({ 'lotus.settings.v1': settings(dark) });
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, colorScheme: dark ? 'dark' : 'light' });
    await ctx.addInitScript(`window.__LOTUS_CORE__ = ${JSON.stringify({ port, token, version: '0.2.0', pid: 0 })}; try { localStorage.setItem('lotus.core.migrated.v1', '1'); } catch {}`);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const tag = dark ? 'dark' : 'light';
    await page.goto(`${U}/index.html`);
    await page.waitForSelector('textarea[aria-label="Message"]', { timeout: 15000 });
    await page.keyboard.press('Control+2');
    if (dark) await page.click('button:has-text("New Work")');
    await page.waitForSelector('text=What should Lotus work on?', { timeout: 8000 }).catch(async (e) => { await page.screenshot({ path: `${shots}/s16-fail.png` }); console.log('errors:', errors); throw e; });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${shots}/s16-work-empty-${tag}.png` });
    if (!dark) {
      await page.fill('textarea[aria-label="Describe the work"]', 'Research the best budget mechanical keyboards and make a comparison table');
      await page.keyboard.press('Enter');
      ok('work: question card appears', await page.waitForSelector('text=What matters most to you?', { timeout: 20000 }).then(() => true, () => false));
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${shots}/s16-work-ask-${tag}.png` });
      await page.click('button:has-text("Wireless")');
      ok('work: finished reply', await page.waitForSelector('text=matters most, so the guide', { timeout: 20000 }).then(() => true, () => false));
      await page.waitForTimeout(800);
      ok('work: plan all ticked', await page.waitForSelector('text=Plan · 4 of 4 done', { timeout: 5000 }).then(() => true, () => false));
      ok('work: helper shown by name', await page.isVisible('text=Researcher'));
      ok('work: artifacts listed', (await page.locator('aside[aria-label="Artifacts"] >> text=Keyboard comparison').count()) > 0);
      ok('work: files on disk', existsSync(join(studio, 'Work')) );
      ok('work: face designed', JSON.parse((await kv())['lotus.avatars.v1'] ?? '{}').researcher?.shape === 'cloud');
      await page.screenshot({ path: `${shots}/s16-work-done-${tag}.png` });
      await page.click('aside[aria-label="Artifacts"] >> text=Keyboard comparison');
      await page.waitForSelector('aside[aria-label="Artifacts"] table', { timeout: 5000 });
      await page.screenshot({ path: `${shots}/s16-work-table-${tag}.png` });
      await page.click('button[aria-label="All artifacts"]');
      await page.click('aside[aria-label="Artifacts"] >> text=Buying guide');
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${shots}/s16-work-page-${tag}.png` });
    }
    // Tasks: a few cards, narrow and wide.
    await kvPut({ 'lotus.tasks.v1': JSON.stringify(['Buy oat milk', 'Write report intro', 'Book physio session', 'Fix island design', 'Review PR'].map((title, i) => ({ id: `t${i}`, title, status: ['todo', 'doing', 'todo', 'review', 'done'][i], description: '', priority: 'normal', assignee: i % 2 ? 'lotus' : 'me', steps: [], links: [], labels: [], order: i, created: Date.now(), updated: Date.now() }))) });
    await page.keyboard.press('Control+5');
    await page.waitForTimeout(700);
    const scrollX = await page.evaluate(() => [...document.querySelectorAll('div')].some((d) => d.scrollWidth > d.clientWidth + 2 && getComputedStyle(d).overflowX !== 'hidden' && getComputedStyle(d).overflowX !== 'visible'));
    ok(`tasks ${tag}: no sideways scrolling`, !scrollX);
    await page.screenshot({ path: `${shots}/s16-tasks-${tag}.png` });
    await page.setViewportSize({ width: 900, height: 860 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${shots}/s16-tasks-narrow-${tag}.png` });
    await page.setViewportSize({ width: 1360, height: 860 });
    // Hardware & Runtime (0.11.0: on the profile page, opened by the profile button).
    await page.click('button[aria-label^="Your profile"]');
    await page.waitForTimeout(400);
    await page.click('[role=tab]:has-text("Hardware & Runtime")');
    await page.waitForTimeout(5000);
    await page.screenshot({ path: `${shots}/s16-hardware-${tag}.png` });
    ok(`hardware ${tag}: processor tile`, await page.isVisible('text=Processor'));
    ok(`${tag}: no page errors`, !errors.length, errors.join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close(); core.stdin.end(); fakes.kill(); web.close();
  rmSync(data, { recursive: true, force: true }); rmSync(studio, { recursive: true, force: true });
}
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
