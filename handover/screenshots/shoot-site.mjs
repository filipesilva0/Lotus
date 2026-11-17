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

const data = mkdtempSync(join(tmpdir(), 'lotus-site-data-'));
const studio = mkdtempSync(join(tmpdir(), 'lotus-site-studio-'));
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




// Website tour: one real screenshot per page (dark, 2x) with realistic saved content, against a real
// core and the scripted fake engines. Fake model names are swapped for real-looking ones before each shot.
// Run: npm run build && node handover/screenshots/shoot-site.mjs  → /tmp/site/*.png (copy into the website's public/assets/tour)
const out = '/tmp/site';
mkdirSync(out, { recursive: true });
const now = Date.now();
const imgReply = 'Here is a prompt for a calm, cinematic valley.\n\n```image\n{"title":"Misty valley","prompt":"misty mountain valley at sunrise, winding river, golden light, pine forest, wide-angle landscape photography","negative":"blurry, text","model":"Juggernaut XL","aspect":"16:9","resolution":0,"count":2,"steps":32,"cfg":6,"sampler":"dpmpp_2m","why":"Wide 16:9 suits a landscape; two options to pick from."}\n```';
const planReply = 'Here is a week that puts the deadline first.\n\n| Day | Focus | Time |\n|---|---|---|\n| Monday | Draft the GEFT presentation | 2 h |\n| Tuesday | Rehearse it twice, out loud | 1 h |\n| Wednesday | Present, then rest | — |\n| Thursday | Biomechanics problem sets 1–3 | 3 h |\n| Friday | Biomechanics exam | — |\n\n- [x] Book a room for Tuesday\'s rehearsal\n- [ ] Print the formula sheet\n\nWant me to add these as tasks with reminders?';
const msg = (id, role, content) => ({ id, role, content, timestamp: '' });
const sessions = [
  { id: 'c1', title: 'Plan my study week', model: 'qwen3:8b', updatedAt: '', ts: now, messages: [msg('u1', 'user', 'Help me plan my study week: a GEFT presentation on Wednesday and biomechanics on Friday.'), msg('a1', 'assistant', planReply)] },
  { id: 'c2', title: 'Image idea', model: 'qwen3:8b', updatedAt: '', ts: now - 3600e3, messages: [msg('u2', 'user', 'Write me a prompt for a misty valley picture'), msg('a2', 'assistant', imgReply)] },
  { id: 'c3', title: 'Explain ACL rehab phases', model: 'qwen3:8b', updatedAt: '', ts: now - 86400e3, messages: [msg('u3', 'user', 'Explain ACL rehab phases'), msg('a3', 'assistant', 'Sure.')] },
  { id: 'c4', title: 'Summarize lecture notes', model: 'qwen3:8b', updatedAt: '', ts: now - 2 * 86400e3, messages: [msg('u4', 'user', 'Summarize'), msg('a4', 'assistant', 'Done.')] },
];
const calls = [{ id: 'call1', title: 'Help me plan my study week', started: now - 3600e3, ended: now - 3300e3, memory: true, turns: [
  { role: 'user', text: 'Help me plan my study week', ts: 1 }, { role: 'assistant', text: 'Sure. Which exams do you have, and on which days?', ts: 2 },
  { role: 'user', text: 'Biomechanics on Friday and a GEFT presentation on Wednesday.', ts: 3 }, { role: 'assistant', text: 'Then let us put the presentation first: draft it Monday, rehearse Tuesday, and spend Thursday on biomechanics problems.', ts: 4 },
  { role: 'user', text: 'And remind me to print the formula sheet.', ts: 5 }, { role: 'assistant', text: 'Done. It is on your to-do list for Thursday morning.', ts: 6 } ] }];
const task = (title, status, assignee, i) => ({ id: `t${i}`, title, status, description: '', priority: 'normal', assignee, steps: [], links: [], labels: [], order: i, created: now, updated: now, log: [] });
const tasks = [['Collect sources for the GEFT talk', 'todo', 'me'], ['Print the formula sheet', 'todo', 'me'], ['Book physio session', 'todo', 'me'], ['Draft presentation slides', 'doing', 'me'], ['Revise biomechanics notes', 'doing', 'me'], ['Summarize this week\'s lectures', 'review', 'lotus'], ['Weekly expenses report', 'review', 'lotus'], ['Rename photo folders', 'done', 'lotus'], ['Back up thesis notes', 'done', 'me']]
  .map(([t, s, a], i) => ({ ...task(t, s, a, i), ...(a === 'lotus' ? { run: { state: 'done', startedAt: now - 900e3, finishedAt: now - 600e3 }, result: 'Done.' } : {}) }));

const swapText = () => {
  const swap = [[/fake:latest|fake-model|llama3\.1:8b/g, 'qwen3:8b'], [/sdxl-fake\.safetensors|sdxl-fake/g, 'Juggernaut XL'], [/ \(Make me a short knee rehab plan\)/g, ''], [/Thought for 0\.0s/g, 'Thought for 2.4s'], [/^Thought$/g, 'Thought for 2.4s'], [/Researcher result: /g, '']];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) for (const [a, b] of swap) n.nodeValue = n.nodeValue.replace(a, b);
  document.querySelectorAll('[placeholder]').forEach((e) => { for (const [a, b] of swap) e.setAttribute('placeholder', e.getAttribute('placeholder').replace(a, b)); });
};
const browser = await chromium.launch();
try {
  await kvPut({ 'lotus.settings.v1': settings(true).replace('"fake:latest"', '"qwen3:8b"').replace('}', ',"voiceEngine":"builtin"}'), 'lotus.engineUrls.v1': JSON.stringify({ ollama: F.team, comfyui: F.comfy }),
    'lotus.sessions.v1': JSON.stringify(sessions), 'lotus.activeSession.v1': JSON.stringify('c1'), 'lotus.voice.calls.v1': JSON.stringify(calls), 'lotus.tasks.v1': JSON.stringify(tasks) });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  await ctx.addInitScript(`window.__LOTUS_CORE__ = ${JSON.stringify({ port, token, version: '0.2.0', pid: 0 })}; try { localStorage.setItem('lotus.core.migrated.v1', '1'); } catch {}`);
  const page = await ctx.newPage();
  const shoot = async (name) => { await page.evaluate(swapText); await page.mouse.move(700, 5); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/${name}.png` }); console.log('saved', name); };
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${U}/index.html`);
  await page.waitForSelector('textarea[aria-label="Message"]', { timeout: 15000 }).catch(async (e) => { await page.screenshot({ path: `${out}/fail.png` }); console.log('errors:', errs.join(' | ')); throw e; });
  await page.waitForTimeout(800);
  await shoot('chat');
  await page.click('text=Image idea'); await page.waitForTimeout(500); await shoot('chat-image');

  // Work: the agents run.
  await page.keyboard.press('Control+2');
  await page.waitForSelector('textarea[aria-label="Describe the work"]', { timeout: 8000 });
  await page.click('button:has-text("Think")');
  await page.fill('textarea[aria-label="Describe the work"]', 'Make me a short knee rehab plan');
  await page.keyboard.press('Enter');
  ok('work finished', await page.waitForSelector('text=Three agents worked on it at once', { timeout: 30000 }).then(() => true, () => false));
  await page.waitForTimeout(3500);
  if (!(await page.isVisible('text=quad sets, heel slides'))) await page.click('[aria-label="Agents"] button:has-text("Researcher")');
  await shoot('work');

  await page.keyboard.press('Control+3'); await page.waitForTimeout(700);
  if (await page.locator('button[aria-label="Show inspector"]').count()) await page.click('button[aria-label="Show inspector"]');
  await page.waitForTimeout(500); await shoot('images');
  if (await page.locator('button[aria-label="Hide inspector"]').count()) await page.click('button[aria-label="Hide inspector"]');

  await page.keyboard.press('Control+4'); await page.waitForTimeout(700);
  await page.click('text=Help me plan my study week').catch(() => undefined); await page.waitForTimeout(500);
  if (await page.locator('button[aria-label="Hide inspector"]').count()) await page.click('button[aria-label="Hide inspector"]');
  await shoot('voice');

  await page.keyboard.press('Control+5'); await page.waitForTimeout(700); await shoot('tasks');

  await page.keyboard.press('Control+6'); await page.waitForTimeout(600);
  const modelsTab = page.locator('[role="tab"]:has-text("Models"), button:text-is("Models")').first();
  if (await modelsTab.isVisible().catch(() => false)) await modelsTab.click();
  await page.click('nav[aria-label="Modes"] >> text=Get Models').catch(() => undefined);
  await page.waitForTimeout(1200);
  await page.evaluate(() => { for (const el of document.querySelectorAll('span')) if ((el.textContent ?? '').startsWith('No graphics card found')) el.style.display = 'none'; });
  await shoot('models');

  await ctx.close();
} finally {
  await browser.close(); core.stdin.end(); fakes.kill(); web.close();
  rmSync(data, { recursive: true, force: true }); rmSync(studio, { recursive: true, force: true });
}
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
