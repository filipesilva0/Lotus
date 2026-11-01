// Session 11 screenshots: a chat reply that proposes installing a model (Allow / Deny card, then progress).
// From the project root, after `npm run build`, in ONE command:
//   (timeout 200 python3 -m http.server 8123 --directory dist >/dev/null 2>&1 &) ; sleep 1; node handover/screenshots/shoot-s11-install.mjs
// The fake pull answers after 3 s, so the "running" shot shows the progress state, then "done".
// Browser mode with a fake Ollama answered by Playwright. Chromium, not WebView2/WKWebView.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs';
fs.mkdirSync('/tmp/shots', { recursive: true });
const U = 'http://127.0.0.1:8123';
const REPLY = 'Gemma 4 12B is a good step up from your current model: better at long answers and it still reads images. It needs about 10 GB of GPU memory.\n\n```install\n{"engine":"ollama","model":"gemma4:12b","reason":"A stronger everyday model that still fits a 12 GB GPU."}\n```';
const browser = await chromium.launch();
const shot = async (p, name) => { await p.waitForTimeout(600); await p.screenshot({ path: `/tmp/shots/s11-${name}.png` }); console.log('saved', name); };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };

async function run(dark) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1, colorScheme: dark ? 'dark' : 'light' });
  await ctx.route(/:11434\//, async (r) => {
    const u = r.request().url();
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    if (u.endsWith('/api/version')) return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '{"version":"0.12.3"}' });
    if (u.endsWith('/api/tags')) return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '{"models":[{"name":"qwen3.5:4b","details":{"parameter_size":"4B"}}]}' });
    if (u.endsWith('/api/show')) return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '{"capabilities":["completion","vision"],"model_info":{}}' });
    if (u.endsWith('/api/chat')) {
      const lines = [JSON.stringify({ message: { role: 'assistant', content: REPLY }, done: false }), JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, eval_count: 40, eval_duration: 1e9 })];
      return r.fulfill({ status: 200, headers: cors, body: lines.join('\n') + '\n' });
    }
    if (u.endsWith('/api/pull')) { await new Promise((ok) => setTimeout(ok, 3000)); return r.fulfill({ status: 200, headers: cors, body: '{"status":"pulling manifest"}\n{"status":"success"}\n' }).catch(() => undefined); }
    return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '{}' });
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p.goto(U + '/index.html');
  await p.evaluate(`localStorage.clear(); localStorage.setItem('lotus.setup.v1', '{"done":true}'); localStorage.setItem('lotus.settings.v1', JSON.stringify({ appearance: '${dark ? 'dark' : 'light'}', selectedModel: 'qwen3.5:4b', autoRename: false, autoMemory: false, autoSkills: false }));`);
  await p.goto(U + '/index.html');
  await p.waitForTimeout(1200);
  const box = p.locator('textarea').first();
  await box.fill('Can you install a better chat model for me?');
  await box.press('Enter');
  await p.waitForTimeout(2500);
  const tag = dark ? 'dark' : 'light';
  await shot(p, `${tag}-install-ask`);
  await p.getByRole('button', { name: 'Allow' }).click();

  await p.waitForTimeout(1200);
  await shot(p, `${tag}-install-running`);
  await p.waitForTimeout(3000);
  await shot(p, `${tag}-install-done`);
  await ctx.close();
}
await run(false);
await run(true);
await browser.close();
