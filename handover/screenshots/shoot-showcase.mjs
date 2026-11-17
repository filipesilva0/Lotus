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




// README / website showcase: the Work page after it deployed three agents by itself (real UI, real core,
// scripted fake model). Placeholder strings from the fake model are swapped for realistic ones before the
// shot. Run: npm run build && node handover/screenshots/shoot-showcase.mjs  → docs/assets/showcase-*.png
const out = join(root, 'docs/assets');
const browser = await chromium.launch();
try {
  for (const dark of (process.env.THEME ? [process.env.THEME === 'dark'] : [false, true])) {
    const tag = dark ? 'dark' : 'light';
    await kvPut({ 'lotus.settings.v1': settings(dark), 'lotus.engineUrls.v1': JSON.stringify({ ollama: F.team, comfyui: F.comfy }) });
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2, colorScheme: dark ? 'dark' : 'light' });
    await ctx.addInitScript(`window.__LOTUS_CORE__ = ${JSON.stringify({ port, token, version: '0.2.0', pid: 0 })}; try { localStorage.setItem('lotus.core.migrated.v1', '1'); } catch {}`);
    const page = await ctx.newPage();
    await page.goto(`${U}/index.html`);
    await page.waitForSelector('textarea[aria-label="Message"]', { timeout: 15000 });
    await page.keyboard.press('Control+2');
    await page.waitForSelector('textarea[aria-label="Describe the work"]', { timeout: 8000 });
    await page.click('button:has-text("Think")');
    await page.fill('textarea[aria-label="Describe the work"]', 'Make me a short knee rehab plan');
    await page.keyboard.press('Enter');
    ok(`${tag}: finished`, await page.waitForSelector('text=Three agents worked on it at once', { timeout: 30000 }).then(() => true, () => false));
    await page.waitForTimeout(500);
    if (!(await page.isVisible('text=quad sets, heel slides'))) await page.click('[aria-label="Agents"] button:has-text("Researcher")');
    await page.waitForSelector('text=quad sets, heel slides', { timeout: 3000 });
    await page.evaluate(() => {
      const swap = [[/fake:latest/g, 'qwen3:8b'], [/ \(Make me a short knee rehab plan\)/g, ''], [/Thought for 0\.0s/g, 'Thought for 2.4s'], [/Researcher result: /g, '']];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) for (const [a, b] of swap) n.nodeValue = n.nodeValue.replace(a, b);
      document.querySelectorAll('[placeholder]').forEach((e) => e.setAttribute('placeholder', e.getAttribute('placeholder').replace(/fake:latest/g, 'qwen3:8b')));
    });
    await page.waitForTimeout(3000);
    await page.mouse.move(5, 500);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/showcase-${tag}.png` });
    await ctx.close();
  }
} finally {
  await browser.close(); core.stdin.end(); fakes.kill(); web.close();
  rmSync(data, { recursive: true, force: true }); rmSync(studio, { recursive: true, force: true });
}
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
