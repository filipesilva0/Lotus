// 0.9.5 checks: paste (Ctrl/Cmd+V) and drop of several files on Chat, Work, Images and Voice, and the
// Images folder layout (one folder per generation, Reference N / Output N). Same set-up as shoot-s17:
// stand-in engines in a temporary Lotus Studio, a real core, the built app in Chromium.
// Run: npm run build && node handover/screenshots/shoot-s19.mjs   (PNGs in /tmp/shots/s19-*)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';

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

// ── A Lotus Studio with the three engines and a few models already installed ──
const studio = mkdtempSync(join(tmpdir(), 'lotus-s19-studio-'));
const data = mkdtempSync(join(tmpdir(), 'lotus-s19-data-'));
const bun = execSync('command -v bun').toString().trim();
const fake = (rel, target, env = '') => { const p = join(studio, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, `#!/bin/sh\n${env}exec "${bun}" "${join(root, 'core/test/fake-engines', target)}" "$@"\n`); chmodSync(p, 0o755); return p; };
const file = (rel, body = 'x') => { const p = join(studio, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, body); };
const exes = {
  llama: fake('Engines/llama.cpp/b11669/llama-server', 'fake-llama.ts'),
  sd: fake('Engines/stable-diffusion.cpp/master-995/sd-cli', 'fake-sd.ts'),
  tts: fake('Engines/sherpa-onnx/v1.13.7/bin/sherpa-onnx-offline-tts', 'fake-sherpa.ts', 'FAKE_MODE=tts '),
  stt: fake('Engines/sherpa-onnx/v1.13.7/bin/sherpa-onnx-offline', 'fake-sherpa.ts', 'FAKE_MODE=stt '),
};
writeFileSync(join(studio, 'Engines/builtin.json'), JSON.stringify({
  llama: { tag: 'b11669', flavour: 'NVIDIA (CUDA 12)', dir: join(studio, 'Engines/llama.cpp/b11669'), exes: { 'llama-server': exes.llama }, installedAt: Date.now() },
  sd: { tag: 'master-995-fd21ecf', flavour: 'NVIDIA (CUDA 12)', dir: join(studio, 'Engines/stable-diffusion.cpp/master-995'), exes: { 'sd-cli': exes.sd }, installedAt: Date.now() },
  sherpa: { tag: 'v1.13.7', flavour: 'Processor', dir: join(studio, 'Engines/sherpa-onnx/v1.13.7'), exes: { 'sherpa-onnx-offline-tts': exes.tts, 'sherpa-onnx-offline': exes.stt }, installedAt: Date.now() },
}));
file('Models/chat/qwen3-8b/Qwen3-8B-Q4_K_M.gguf', 'g'.repeat(5000));
file('Models/chat/nemotron-3-nano-4b/NVIDIA-Nemotron-3-Nano-4B-Q4_K_M.gguf', 'n'.repeat(3000));
file('Models/image/checkpoints/sd_xl_base_1.0.safetensors', 'c'.repeat(7000));
file('Models/image/vae/sdxl.vae.safetensors', 'v');
file('Models/image/checkpoints/juggernautXL_v9.safetensors', 'j'.repeat(6000));
file('Models/image/diffusion_models/flux1-dev-Q4_K_S.gguf', 'f'.repeat(6000));
file('Models/image/text_encoders/clip_l.safetensors', 'l');
file('Models/image/loras/detail-tweaker.safetensors', 'd');
file('Models/voice/kokoro/kokoro-en-v0_19/model.onnx', 'm'); file('Models/voice/kokoro/kokoro-en-v0_19/voices.bin', 'v'); file('Models/voice/kokoro/kokoro-en-v0_19/tokens.txt', 't'); file('Models/voice/kokoro/kokoro-en-v0_19/espeak-ng-data/phontab', 'p');
file('Models/voice/whisper-small/sherpa-onnx-whisper-small/small-encoder.int8.onnx', 'e'); file('Models/voice/whisper-small/sherpa-onnx-whisper-small/small-decoder.int8.onnx', 'd'); file('Models/voice/whisper-small/sherpa-onnx-whisper-small/small-tokens.txt', 't');
writeFileSync(join(studio, 'Models/models.json'), JSON.stringify({ version: 1, installed: {
  'qwen3-8b': { id: 'qwen3-8b', kind: 'chat', title: 'Qwen 3 8B', files: ['chat/qwen3-8b/Qwen3-8B-Q4_K_M.gguf'], gguf: 'chat/qwen3-8b/Qwen3-8B-Q4_K_M.gguf', entryId: 'qwen3-8b', source: 'unsloth/Qwen3-8B-GGUF', bytes: 5.03e9, at: Date.now() },
  'nemotron-3-nano-4b': { id: 'nemotron-3-nano-4b', kind: 'chat', title: 'Nemotron 3 Nano 4B', files: ['chat/nemotron-3-nano-4b/NVIDIA-Nemotron-3-Nano-4B-Q4_K_M.gguf'], gguf: 'chat/nemotron-3-nano-4b/NVIDIA-Nemotron-3-Nano-4B-Q4_K_M.gguf', entryId: 'nemotron-3-nano-4b', bytes: 2.8e9, at: Date.now() },
  'sdxl-base': { id: 'sdxl-base', kind: 'image', title: 'Stable Diffusion XL', files: ['image/checkpoints/sd_xl_base_1.0.safetensors', 'image/vae/sdxl.vae.safetensors'], entryId: 'sdxl-base', bytes: 7.2e9, at: Date.now() },
  kokoro: { id: 'kokoro', kind: 'voice', title: 'Kokoro', files: ['voice/kokoro'], dir: 'voice/kokoro', entryId: 'kokoro', bytes: 3.4e8, at: Date.now() },
  'whisper-small': { id: 'whisper-small', kind: 'dictation', title: 'Whisper Small', files: ['voice/whisper-small'], dir: 'voice/whisper-small', entryId: 'whisper-small', bytes: 3.6e8, at: Date.now() },
} }));

const readLine = (proc, tag) => new Promise((resolve, reject) => {
  let out = '';
  proc.stdout.on('data', (b) => { out += b; const m = new RegExp(`${tag} (\\{.*\\})`).exec(out); if (m) resolve(JSON.parse(m[1])); });
  proc.on('exit', (c) => reject(new Error(`${tag}: exited ${c}`)));
  setTimeout(() => reject(new Error(`${tag}: did not start`)), 15000);
});
const token = randomBytes(32).toString('hex');
const core = spawn(bun, [join(root, 'core/src/main.ts'), '--data', data, '--studio', studio, '--watch-stdin'], { env: { ...process.env, LOTUSD_TOKEN: token, LOTUSD_ORIGINS: U }, stdio: ['pipe', 'pipe', 'inherit'] });
const { port } = await readLine(core, 'LOTUSD_READY');
const api = async (path, init = {}) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
};
const kvPut = (set, remove = []) => api('/v1/kv', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ set, remove, origin: 'test' }) });

const sdxl = { id: 'cat-sdxl-base', name: 'Stable Diffusion XL', family: 'sdxl', files: { model: 'sd_xl_base_1.0.safetensors', vae: 'sdxl.vae.safetensors' }, catalogId: 'sdxl-base' };
const flux = { id: 'setup-flux', name: 'FLUX.1 Dev Q4', family: 'flux1', files: { model: 'flux1-dev-Q4_K_S.gguf', clip_l: 'clip_l.safetensors' } };
const settings = (dark) => JSON.stringify({ appearance: dark ? 'dark' : 'light', llmBackend: 'builtin', imageEngine: 'builtin', voiceEngine: 'builtin', selectedModel: 'qwen3-8b', agentApproval: 'risky', autoRename: false, autoMemory: false, autoSkills: false });
await kvPut({ 'lotus.setup.dismissed': '1', 'lotus.setup.v1': JSON.stringify({ done: true }), 'lotus.core.migrated.v1': '1', 'lotus.settings.v1': settings(false), 'lotus.imageProfiles.v1': JSON.stringify([sdxl, flux]), 'lotus.image.params.v1': JSON.stringify({ profile: sdxl.id }) });

const browser = await chromium.launch();
const open = async (dark, viewport = { width: 1360, height: 860 }) => {
  const ctx = await browser.newContext({ viewport, colorScheme: dark ? 'dark' : 'light' });
  await ctx.addInitScript(`window.__LOTUS_CORE__ = ${JSON.stringify({ port, token, version: '0.2.0', pid: 0 })}; try { localStorage.setItem('lotus.core.migrated.v1', '1'); } catch {}`);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page, errors };
};

// A 4×4 PNG in a given colour, as bytes the page turns into a File.
const pngOf = (r, g, b) => {
  const { deflateSync } = createRequire(import.meta.url)('node:zlib');
  const crc = (buf) => { let c = ~0; for (const x of buf) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(4, 0); ihdr.writeUInt32BE(4, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.concat(Array.from({ length: 4 }, () => Buffer.from([0, ...Array.from({ length: 4 }, () => [r, g, b]).flat()])));
  return [...Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])];
};
const PNGS = { red: pngOf(220, 40, 40), green: pngOf(40, 180, 80), blue: pngOf(40, 90, 220) };

// Dispatches a real paste or drop with a DataTransfer holding the given files.
const send = (page, how, files, selector = 'body') => page.evaluate(({ how, files, selector }) => {
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(new File([f.text !== undefined ? f.text : new Uint8Array(f.bytes)], f.name, { type: f.type }));
  const el = document.querySelector(selector) ?? document.body;
  if (how === 'paste') { el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return; }
  for (const t of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
}, { how, files, selector });
const img = (name, color) => ({ name, type: 'image/png', bytes: PNGS[color] });
const chips = (page, label) => page.locator(`[aria-label="${label}"] > span:has(button)`).count();

try {
  const { ctx, page, errors } = await open(false);
  await page.goto(`${U}/index.html`);
  await page.waitForSelector('textarea[aria-label="Message"]', { timeout: 15000 });

  // Chat: two screenshots pasted at once, then a text file and an image dropped anywhere on the page.
  await page.focus('textarea[aria-label="Message"]');
  await send(page, 'paste', [img('image.png', 'red'), img('image.png', 'green')], 'textarea[aria-label="Message"]');
  await page.waitForTimeout(200);
  ok('chat: two pasted images are both attached', await chips(page, 'Attachments') === 2, String(await chips(page, 'Attachments')));
  const names = await page.locator('[aria-label="Attachments"] > span').allInnerTexts();
  ok('chat: pasted images get distinct names', new Set(names).size === 2 && names.every((n) => n.startsWith('Pasted image')), names.join(' | '));
  await send(page, 'drop', [{ name: 'notes.md', type: 'text/markdown', text: '# Notes\nBuy milk' }, img('photo.png', 'blue')], 'main');
  await page.waitForTimeout(200);
  ok('chat: a drop anywhere adds every file', await chips(page, 'Attachments') === 4, String(await chips(page, 'Attachments')));
  // Plain text still pastes as text.
  await page.evaluate(() => { const ta = document.querySelector('textarea[aria-label="Message"]'); const dt = new DataTransfer(); dt.setData('text/plain', 'hello'); ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
  ok('chat: a text paste adds no attachment', await chips(page, 'Attachments') === 4);
  await page.screenshot({ path: `${shots}/s19-chat-attachments.png` });

  // Work: a drop and a paste on the Work page.
  await page.keyboard.press('Control+2');
  await page.waitForTimeout(600);
  await send(page, 'drop', [img('a.png', 'red'), { name: 'plan.txt', type: 'text/plain', text: 'Plan' }], 'main');
  await send(page, 'paste', [img('image.png', 'blue')]);
  await page.waitForTimeout(200);
  ok('work: dropped and pasted files are all attached', await chips(page, 'Attachments') === 3, String(await chips(page, 'Attachments')));
  await page.screenshot({ path: `${shots}/s19-work-attachments.png` });

  // Images: three references pasted at once; SDXL starts from the first, the others can be moved first.
  await page.keyboard.press('Control+3');
  await page.waitForSelector('textarea[aria-label="Prompt"]', { timeout: 8000 });
  await send(page, 'paste', [img('image.png', 'red'), img('image.png', 'green'), img('image.png', 'blue')]);
  await page.waitForTimeout(250);
  ok('images: three pasted references', await chips(page, 'Reference images') === 3, String(await chips(page, 'Reference images')));
  ok('images: the first is the start image for SDXL', await page.locator('[aria-label="Reference images"] >> text=Start image').count() === 1);
  ok('images: the others offer Use First', await page.locator('[aria-label="Reference images"] button:has-text("Use First")').count() === 2);
  await page.screenshot({ path: `${shots}/s19-images-references.png` });
  await page.fill('textarea[aria-label="Prompt"]', 'a red fox in the snow');
  await page.keyboard.press('Enter');
  const made = await page.waitForFunction(() => [...document.querySelectorAll('img')].some((i) => i.alt === 'a red fox in the snow' && i.naturalWidth > 0), null, { timeout: 20000 }).then(() => true, () => false);
  ok('images: the image is made', made, errors.join(' | '));
  const folder = join(studio, 'Images', 'A red fox in the snow');
  const files = existsSync(folder) ? readdirSync(folder).sort() : [];
  ok('images: one folder for the generation, with Reference 1 and Output 1', files.join(',') === 'Output 1.png,Reference 1.png', files.join(','));
  ok('images: no month folder for new images', !readdirSync(join(studio, 'Images')).some((d) => /^\d{4}-\d{2}$/.test(d)), readdirSync(join(studio, 'Images')).join(','));
  // A second run in the same generation goes into the same folder.
  await page.fill('textarea[aria-label="Prompt"]', 'a red fox in the snow at night');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('img')].some((i) => i.alt === 'a red fox in the snow at night' && i.naturalWidth > 0), null, { timeout: 20000 }).catch(() => undefined);
  const files2 = readdirSync(folder).sort();
  ok('images: the next run adds Output 2 to the same folder', files2.join(',') === 'Output 1.png,Output 2.png,Reference 1.png', files2.join(','));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${shots}/s19-images-made.png` });

  // Voice: a dropped text file goes into the Speak box.
  await page.keyboard.press('Control+4');
  await page.waitForTimeout(700);
  const speak = page.locator('nav[aria-label="Voice modes"] >> button:has-text("Speak")');
  if (await speak.count()) await speak.first().click();
  await page.waitForTimeout(300);
  await send(page, 'drop', [{ name: 'script.txt', type: 'text/plain', text: 'Hello from a dropped file.' }], 'main');
  await page.waitForTimeout(300);
  ok('voice: a dropped text file fills the Speak box', await page.locator('textarea').evaluateAll((l) => l.some((t) => t.value.includes('Hello from a dropped file.'))));
  await page.screenshot({ path: `${shots}/s19-voice-text.png` });
  ok('no page errors', !errors.length, errors.join(' | '));
  await ctx.close();

  // Dark mode: the reference strip.
  await kvPut({ 'lotus.settings.v1': settings(true) });
  const d = await open(true);
  await d.page.goto(`${U}/index.html`);
  await d.page.waitForSelector('textarea[aria-label="Message"]', { timeout: 15000 });
  await d.page.keyboard.press('Control+3');
  await d.page.waitForSelector('textarea[aria-label="Prompt"]', { timeout: 8000 });
  await send(d.page, 'paste', [img('image.png', 'green'), img('image.png', 'blue')]);
  await d.page.waitForTimeout(300);
  await d.page.screenshot({ path: `${shots}/s19-images-references-dark.png` });
  await d.ctx.close();
} finally {
  await browser.close(); core.stdin.end(); web.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
