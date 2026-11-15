// Session 16: the island (Dynamic Island style) in a browser: compact, hovered, done. Events come in over
// the BroadcastChannel fallback of lib/bus.ts. Run: npm run build && node handover/screenshots/shoot-s16-island.mjs
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = process.cwd(); const shots = '/tmp/shots'; mkdirSync(shots, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
const web = createServer((req, res) => { const p = join(root, 'dist', decodeURIComponent(new URL(req.url, 'http://x').pathname)); if (!existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' }); res.end(readFileSync(p)); }).listen(8127, '127.0.0.1');
const U = 'http://127.0.0.1:8127';
const b = await chromium.launch();
try {
  const ctx = await b.newContext({ viewport: { width: 520, height: 220 } });
  await ctx.addInitScript(() => { localStorage.setItem('lotus.island.v1', JSON.stringify({ enabled: true, schema: 2, agents: false })); localStorage.setItem('lotus.petal.hue', '356');  });
  const island = await ctx.newPage();
  await island.goto(`${U}/island.html`);
  const sender = await ctx.newPage();
  await sender.goto(`${U}/island.html#sender`);
  const post = (name, payload) => sender.evaluate(([n, p]) => new BroadcastChannel('lotus-bus').postMessage({ name: n, payload: p }), [name, payload]);
  await island.waitForTimeout(800);
  await post('activity', { id: 'img', kind: 'image', label: 'Generating “red fox in snow”', progress: 0.42 });
  await post('activity', { id: 'work', kind: 'build', label: 'Writing the buying guide' });
  await island.waitForTimeout(700);
  await island.screenshot({ path: `${shots}/s16-island-peek.png` });
  await island.waitForTimeout(3000);
  await island.screenshot({ path: `${shots}/s16-island-compact.png` });
  await island.hover('[role=region]');
  await island.waitForTimeout(900);
  await island.screenshot({ path: `${shots}/s16-island-expanded.png` });
  await island.mouse.move(5, 200);
  await post('activity', { id: 'img', kind: 'image', label: 'Image ready', done: true });
  await post('activity', { id: 'work', kind: 'build', label: 'Work done', done: true });
  await island.waitForTimeout(900);
  await island.screenshot({ path: `${shots}/s16-island-done.png` });
  console.log('ok');
} finally { await b.close(); web.close(); }
