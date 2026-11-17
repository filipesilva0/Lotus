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
}).listen(8129, '127.0.0.1');
const U = 'http://127.0.0.1:8129';

const readLine = (proc, tag) => new Promise((resolve, reject) => {
  let out = '';
  proc.stdout.on('data', (b) => { out += b; const m = new RegExp(`${tag} (\\{.*\\})`).exec(out); if (m) resolve(JSON.parse(m[1])); });
  proc.on('exit', (c) => reject(new Error(`${tag}: exited ${c}`)));
  setTimeout(() => reject(new Error(`${tag}: did not start`)), 15000);
});

const fakes = spawn('bun', [join(root, 'core/test/fakes.ts'), '--serve'], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, FAKES_TTL: '200' } });
const F = await readLine(fakes, 'FAKES');

const data = mkdtempSync(join(tmpdir(), 'lotus-s23-data-'));
const studio = mkdtempSync(join(tmpdir(), 'lotus-s23-studio-'));
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

const settings = (dark) => JSON.stringify({ appearance: dark ? 'dark' : 'light', selectedModel: 'fake:latest', agentApproval: 'auto', autoRename: false, autoMemory: false, autoSkills: false, autoScale: false, contextWindow: 8192, maxTokens: 2048 });
await kvPut({
  'lotus.setup.dismissed': '1', 'lotus.core.migrated.v1': '1',
  'lotus.settings.v1': settings(false),
  'lotus.engineUrls.v1': JSON.stringify({ ollama: F.cards, comfyui: F.comfy }),
  'lotus.image.params.v1': JSON.stringify({ checkpoint: 'sdxl-fake.safetensors' }),
});



// 0.11.0 checks: library tabs on Tasks, profile button → usage + Hardware & Runtime, the trimmed chat
// Model panel and its steppers, cards from loose JSON (image + questionnaire), a PDF read in Chat, and
// Work deploying agents by itself (faces, progress, thinking, Copy / Try Again / Edit).
// Run: npm run build && node handover/screenshots/shoot-s23.mjs
const pdf = join(root, 'core/test/fixtures/docs/sample.pdf');
const browser = await chromium.launch();
try {
  for (const dark of [false, true]) {
    const tag = dark ? 'dark' : 'light';
    await kvPut({ 'lotus.settings.v1': settings(dark), 'lotus.engineUrls.v1': JSON.stringify({ ollama: F.cards, comfyui: F.comfy }) });
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, colorScheme: dark ? 'dark' : 'light' });
    await ctx.addInitScript(`window.__LOTUS_CORE__ = ${JSON.stringify({ port, token, version: '0.2.0', pid: 0 })}; try { localStorage.setItem('lotus.core.migrated.v1', '1'); } catch {}`);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${U}/index.html`);
    await page.waitForSelector('textarea[aria-label="Message"]', { timeout: 15000 });
    const send = async (t) => { await page.fill('textarea[aria-label="Message"]', t); await page.keyboard.press('Enter'); };

    if (!dark) {
      // Cards from JSON the model didn't fence as asked.
      await send('make an image of a fox');
      ok('chat: image card from a ```json block with a trailing comma', await page.waitForSelector('text=Create “Fox in snow” in Images now?', { timeout: 15000 }).then(() => true, () => false));
      ok('chat: the JSON itself is not shown', !(await page.isVisible('text="aspect"')));
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${shots}/s23-chat-image-card-${tag}.png` });
      await send('help me plan my week');
      ok('chat: questionnaire from a bare JSON object', await page.waitForSelector('text=Days per week?', { timeout: 15000 }).then(() => true, () => false));
      ok('chat: options are buttons', (await page.locator('[role=radio]').count()) >= 5);
      ok('chat: no raw "questions" JSON', !(await page.locator('text=/"questions"/').count()));
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${shots}/s23-chat-choices-${tag}.png` });
      // A PDF attached in Chat is read.
      await page.setInputFiles('textarea[aria-label="Message"] ~ div input[type=file]:not([webkitdirectory])', pdf).catch(async () => {
        await page.locator('input[type=file]').first().setInputFiles(pdf);
      });
      await page.waitForTimeout(300);
      await send('what does this pdf say?');
      ok('chat: PDF text reached the model', await page.waitForSelector('text=PDF READ OK', { timeout: 20000 }).then(() => true, () => false));
      await page.screenshot({ path: `${shots}/s23-chat-pdf-${tag}.png` });
    }

    // Chat's Model panel: no Advanced section, stop sequences kept, steppers.
    await page.keyboard.press('Control+Alt+i');
    await page.waitForTimeout(300);
    await page.click('[role=tab][title="Model"]');
    await page.waitForTimeout(300);
    ok(`model panel ${tag}: stop sequences shown`, await page.isVisible('text=Stop sequences'));
    ok(`model panel ${tag}: no Advanced, no raw request, no system prompt`, !(await page.locator('text=/Advanced:|Developer inspector|^System prompt$/').count()));
    const stepper = page.locator('[role=group][aria-label="Context window"]');
    const box = await stepper.boundingBox();
    const input = await stepper.locator('input').evaluate((el) => ({ fits: el.scrollWidth <= el.clientWidth + 1, h: el.getBoundingClientRect().height }));
    const arrows = await stepper.locator('button').evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect().height));
    ok(`stepper ${tag}: value fits, arrows full height`, input.fits && arrows.length === 2 && arrows.every((h) => h >= 12) && Math.abs(arrows[0] + arrows[1] - input.h) <= 2, JSON.stringify({ input, arrows }));
    await page.screenshot({ path: `${shots}/s23-chat-model-panel-${tag}.png` });
    if (box) await page.screenshot({ path: `${shots}/s23-stepper-${tag}.png`, clip: { x: box.x - 140, y: box.y - 8, width: box.width + 160, height: box.height + 16 } });
    await page.keyboard.press('Control+Alt+i');

    // Tasks: Skills, Memory, Soul and Plugins are tabs.
    await page.keyboard.press('Control+5');
    await page.waitForTimeout(400);
    for (const t of ['Skills', 'Memory', 'Soul', 'Plugins']) ok(`tasks ${tag}: ${t} tab`, (await page.locator(`[role=tab]:has-text("${t}")`).count()) > 0);
    await page.click('[role=tab]:has-text("Soul")');
    ok(`tasks ${tag}: soul shows the system prompt`, await page.waitForSelector('text=Sent first in every chat', { timeout: 4000 }).then(() => true, () => false));
    await page.screenshot({ path: `${shots}/s23-tasks-soul-${tag}.png` });
    await page.click('[role=tab]:has-text("Plugins")');
    ok(`tasks ${tag}: plugins with the creator`, await page.waitForSelector('text=Create a plugin', { timeout: 4000 }).then(() => true, () => false));
    await page.screenshot({ path: `${shots}/s23-tasks-plugins-${tag}.png` });
    await page.click('[role=tab]:has-text("Memory")');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${shots}/s23-tasks-memory-${tag}.png` });
    await page.click('[role=tab]:has-text("Skills")');
    await page.click('[role=tab]:has-text("All")');
    ok(`tasks ${tag}: all skills incl. system ones`, await page.waitForSelector('text=System skills', { timeout: 4000 }).then(() => true, () => false));
    await page.click('[role=tab]:has-text("Yours")');

    // Profile button: straight to the profile, with Hardware & Runtime.
    await page.click('button[aria-label^="Your profile"]');
    ok(`profile ${tag}: opens at once (no menu)`, await page.waitForSelector('text=Your usage', { timeout: 4000 }).then(() => true, () => false) && !(await page.locator('[role=menu]').count()));
    await page.screenshot({ path: `${shots}/s23-profile-usage-${tag}.png` });
    await page.click('[role=tab]:has-text("Hardware & Runtime")');
    ok(`profile ${tag}: hardware readings`, await page.waitForSelector('text=Processor', { timeout: 8000 }).then(() => true, () => false));
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${shots}/s23-profile-hardware-${tag}.png` });
    await page.click('[role=tab]:has-text("Usage")');
    await page.keyboard.press('Escape');

    if (!dark) {
      // Work deploys agents on its own.
      await kvPut({ 'lotus.engineUrls.v1': JSON.stringify({ ollama: F.team, comfyui: F.comfy }) });
      await page.waitForTimeout(600);
      await page.keyboard.press('Control+2');
      await page.waitForSelector('textarea[aria-label="Describe the work"]', { timeout: 8000 });
      await page.click('button:has-text("Think")');
      await page.fill('textarea[aria-label="Describe the work"]', 'Make me a short knee rehab plan');
      await page.keyboard.press('Enter');
      ok('work: agents panel appears', await page.waitForSelector('[aria-label="Agents"]', { timeout: 15000 }).then(() => true, () => false));
      await page.waitForTimeout(1500);
      const mid = await page.locator('[aria-label="Agents"]').innerText();
      ok('work: three named agents with their tasks', ['Researcher', 'Writer', 'Checker', 'list three gentle knee exercises'].every((w) => mid.includes(w)), mid.replace(/\n/g, ' | ').slice(0, 200));
      ok('work: some still working while others finish', /Done|Working|Reading|Waiting/.test(mid));
      await page.screenshot({ path: `${shots}/s23-work-agents-running-${tag}.png` });
      ok('work: finished', await page.waitForSelector('text=Three agents worked on it at once', { timeout: 30000 }).then(() => true, () => false));
      await page.waitForTimeout(500);
      ok('work: 3 of 3 done', await page.isVisible('text=3 agents · 3 of 3 done'));
      ok('work: thinking shown', await page.isVisible('text=/Thought/'));
      await page.click('[aria-label="Agents"] button:has-text("Researcher")');
      ok('work: an agent opens with what it returned', await page.waitForSelector('text=quad sets, heel slides', { timeout: 3000 }).then(() => true, () => false));
      await page.screenshot({ path: `${shots}/s23-work-agents-done-${tag}.png` });
      ok('work: reply has Copy and Try Again', (await page.locator('button[aria-label="Try again"]').count()) === 1 && (await page.locator('button[aria-label="Copy"]').count()) >= 1);
      await page.click('button[aria-label="Try again"]');
      ok('work: Try Again runs it again', await page.waitForSelector('[aria-label="Agents"]', { timeout: 15000 }).then(() => true, () => false));
      await page.waitForSelector('text=Three agents worked on it at once', { timeout: 30000 });
      ok('work: still one request and one reply after Try Again', (await page.locator('button[aria-label="Try again"]').count()) === 1);
      await page.hover('text=Make me a short knee rehab plan');
      await page.click('button[aria-label="Edit request"]');
      await page.fill('textarea[aria-label="Edit your request"]', 'Make me a short ankle rehab plan');
      await page.click('button:has-text("Send")');
      ok('work: edited request replaces the old one', await page.waitForSelector('text=(Make me a short ankle rehab plan)', { timeout: 30000 }).then(() => true, () => false) && !(await page.isVisible('text=Make me a short knee rehab plan')));
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${shots}/s23-work-edited-${tag}.png` });
    }
    ok(`${tag}: no page errors`, !errors.length, errors.join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close(); core.stdin.end(); fakes.kill(); web.close();
  rmSync(data, { recursive: true, force: true }); rmSync(studio, { recursive: true, force: true });
}
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
