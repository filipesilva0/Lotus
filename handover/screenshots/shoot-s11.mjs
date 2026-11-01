// Session 11 screenshots: engines on another computer (guide's Engines step and the Engines card editor).
// From the project root, after `npm run build`, in ONE command:
//   (timeout 200 python3 -m http.server 8123 --directory dist >/dev/null 2>&1 &) ; sleep 1; node handover/screenshots/shoot-s11.mjs
// Runs in plain-browser mode (no Tauri bridge) so http() uses fetch, which Playwright answers as a fake
// Ollama on 192.168.1.20 and a fake ComfyUI on gpu-box.local that wants an access key. Chromium, not WebView2/WKWebView.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs';
fs.mkdirSync('/tmp/shots', { recursive: true });
const U = 'http://127.0.0.1:8123';
const browser = await chromium.launch();
const shot = async (p, name) => { await p.waitForTimeout(500); await p.screenshot({ path: `/tmp/shots/s11-${name}.png` }); console.log('saved', name); };

async function run(dark) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1, colorScheme: dark ? 'dark' : 'light' });
  await ctx.route(/192\.168\.1\.20:11434\/api\/version/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"version":"0.12.3"}', headers: { 'access-control-allow-origin': '*' } }));
  await ctx.route(/192\.168\.1\.20:11434\/api\/(tags|ps)/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"models":[]}', headers: { 'access-control-allow-origin': '*' } }));
  await ctx.route(/gpu-box\.local/, (r) => r.fulfill({ status: 401, body: 'unauthorized', headers: { 'access-control-allow-origin': '*' } }));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p.goto(U + '/index.html');
  await p.evaluate(`localStorage.clear(); localStorage.setItem('lotus.settings.v1', JSON.stringify({ appearance: '${dark ? 'dark' : 'light'}' }));`);
  await p.goto(U + '/index.html');
  const tag = dark ? 'dark' : 'light';
  // Welcome → Folder → Engines
  for (let i = 0; i < 2; i++) { await p.click('footer button:last-child'); await p.waitForTimeout(400); }
  await p.getByRole('button', { name: 'Use one on another computer' }).first().click();
  await p.getByLabel('Ollama address on the other computer').fill('192.168.1.20');
  await shot(p, `${tag}-guide-form`);
  await p.getByRole('button', { name: 'Connect' }).click();
  await p.waitForTimeout(800);
  await shot(p, `${tag}-guide-connected`);
  // ComfyUI: wants a key
  await p.getByRole('switch', { name: 'Use ComfyUI' }).click().catch(() => undefined);
  await p.getByRole('button', { name: 'Use one on another computer' }).first().click();
  await p.getByLabel('ComfyUI address on the other computer').fill('gpu-box.local');
  await p.getByRole('button', { name: 'Connect' }).click();
  await p.waitForTimeout(800);
  await shot(p, `${tag}-guide-needs-key`);
  // Skip to the app, then Engines
  await p.getByRole('button', { name: 'Skip setup' }).click();
  await p.waitForTimeout(500);
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /Engines/.test(x.getAttribute('aria-label') || x.getAttribute('data-tip') || '')); b?.click(); });
  await p.waitForTimeout(1500);
  await shot(p, `${tag}-engines`);
  const change = p.getByRole('button', { name: 'Change', exact: true });
  await change.nth(1).click().catch((e) => console.log('no change button', e.message));
  await shot(p, `${tag}-engines-editor`);
  await ctx.close();
}
await run(false);
await run(true);
await browser.close();
