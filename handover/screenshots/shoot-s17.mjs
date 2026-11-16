// Session 17 screenshots and checks: Lotus's own engines (llama.cpp, stable-diffusion.cpp, sherpa-onnx)
// installed in a temporary Lotus Studio with stand-in programs (core/test/fake-engines), a real core,
// and the built app in Chromium: a chat answered by the built-in engine, an image made with an image
// setup (checkpoint + its own VAE), the one Models page, the Image Setups editor, the Voice page, and
// the first-run guide's new screens.
// Run: npm run build && node handover/screenshots/shoot-s17.mjs   (PNGs in /tmp/shots/s17-*)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
}).listen(8127, '127.0.0.1');
const U = 'http://127.0.0.1:8127';

// ── A Lotus Studio with the three engines and a few models already installed ──
const studio = mkdtempSync(join(tmpdir(), 'lotus-s17-studio-'));
const data = mkdtempSync(join(tmpdir(), 'lotus-s17-data-'));
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
try {
  for (const dark of [false, true]) {
    const tag = dark ? 'dark' : 'light';
    await kvPut({ 'lotus.settings.v1': settings(dark) });
    const { ctx, page, errors } = await open(dark);
    await page.goto(`${U}/index.html`);
    await page.waitForSelector('textarea[aria-label="Message"]', { timeout: 15000 });

    if (!dark) {
      // Chat answered by the built-in engine (llama-server started by the core with the chosen model).
      await page.fill('textarea[aria-label="Message"]', 'Say hello');
      await page.keyboard.press('Enter');
      // The stand-in model uses a tool when tools are offered (Chat runs the agent): it adds a task.
      ok('chat: reply from the built-in engine, with a real tool step', await page.waitForSelector('text=I added the task “Buy milk”.', { timeout: 20000 }).then(() => true, () => false));
      ok('chat: the task is on the board', JSON.parse((await api('/v1/kv')).items['lotus.tasks.v1'] ?? '[]').some((t) => t.title === 'Buy milk'));
      const st = (await api('/v1/rpc/builtin_status', { method: 'POST', body: '{}' })).result;
      ok('chat: llama-server running with the model', st.chat.state === 'ready' && st.chat.model === 'qwen3-8b', st.chat.state);
      await page.screenshot({ path: `${shots}/s17-chat-${tag}.png` });

      // Images: the setup's checkpoint and VAE reach sd-cli; the image lands in the gallery.
      await page.keyboard.press('Control+3');
      await page.waitForSelector('textarea[aria-label="Prompt"]', { timeout: 8000 });
      ok('images: setup in the model picker', await page.locator('button[title="Image model"]').innerText().then((t) => t.includes('Stable Diffusion XL'), () => false));
      await page.fill('textarea[aria-label="Prompt"]', 'a lotus flower on still water');
      await page.keyboard.press('Enter');
      const made = await page.waitForFunction(() => [...document.querySelectorAll('img')].some((i) => i.src.startsWith('blob:') && i.naturalWidth > 0), null, { timeout: 20000 }).then(() => true, () => false);
      ok('images: an image made by the built-in engine shows', made, errors.join(' | '));
      const imgs = (await api('/v1/media-list?kind=image')).items;
      ok('images: saved in Lotus Studio/Images', imgs.length >= 1, String(imgs.length));
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${shots}/s17-images-${tag}.png` });
    }

    // Models page: one list for chat, image and voice.
    await page.keyboard.press('Control+6');
    await page.waitForTimeout(500);
    const modelsTab = page.locator('[role="tab"]:has-text("Models"), button:text-is("Models")').first();
    if (await modelsTab.isVisible().catch(() => false)) await modelsTab.click();
    await page.waitForSelector('text=Get Models', { timeout: 8000 }).catch(async (e) => { await page.screenshot({ path: `${shots}/s17-fail-${tag}.png` }); throw e; });
    await page.click('nav[aria-label="Modes"] >> text=Get Models');
    await page.waitForSelector('text=Lotus Engines', { timeout: 8000 });
    await page.waitForTimeout(500);
    ok(`models (${tag}): installed list has chat, image, voice and dictation`, await page.locator('text=In Lotus Studio (4)').isVisible());
    ok(`models (${tag}): engines listed`, await page.locator('text=stable-diffusion.cpp').first().isVisible());
    await page.screenshot({ path: `${shots}/s17-models-${tag}.png`, fullPage: false });
    await page.locator('main, body').first().evaluate(() => { const el = [...document.querySelectorAll('div')].find((d) => d.scrollHeight > d.clientHeight + 200 && getComputedStyle(d).overflowY === 'auto'); if (el) el.scrollTop = 900; });
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${shots}/s17-models-catalog-${tag}.png` });

    // Image Setups: the FLUX setup says what it still needs; open the editor.
    await page.click('nav[aria-label="Modes"] >> text=Image Setups');
    await page.waitForSelector('text=/Setups \\(\\d\\)/', { timeout: 8000 });
    ok(`setups (${tag}): incomplete FLUX setup flagged`, await page.locator('text=Needs T5-XXL, VAE').isVisible());
    await page.click('button:has-text("FLUX.1 Dev Q4")');
    await page.waitForSelector('select[id^="t5xxl-"]', { timeout: 4000 });
    await page.screenshot({ path: `${shots}/s17-setups-${tag}.png` });
    if (!dark) {
      await page.click('button:has-text("Stable Diffusion XL")');
      const vae = await page.locator('select[id^="vae-cat-sdxl-base"]').inputValue();
      ok('setups: SDXL is tied to its own VAE', vae === 'sdxl.vae.safetensors', vae);
      ok('setups: loose model offered for setup', await page.locator('text=juggernautXL_v9.safetensors').first().isVisible());
      await page.locator('li:has-text("juggernautXL_v9.safetensors") >> button:has-text("Set Up")').click();
      await page.waitForTimeout(300);
      const saved = JSON.parse((await api('/v1/kv')).items['lotus.imageProfiles.v1']);
      const jug = saved.find((p) => p.files.model === 'juggernautXL_v9.safetensors');
      ok('setups: new setup guessed SDXL and picked the SDXL VAE', jug?.family === 'sdxl' && jug?.files.vae === 'sdxl.vae.safetensors', JSON.stringify(jug?.files));
    }

    // Voice page with the built-in engine.
    await page.keyboard.press('Control+4');
    await page.waitForSelector('text=Dictate', { timeout: 8000 });
    if (!dark) {
      await page.fill('textarea[aria-label="Text to speak"]', 'Hello from Lotus');
      await page.click('button:has-text("Speak")');
      ok('voice: a clip spoken by the built-in engine', await page.waitForSelector('audio', { timeout: 10000 }).then(() => true, () => false));
    }
    await page.screenshot({ path: `${shots}/s17-voice-${tag}.png` });
    ok(`no page errors (${tag})`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // First-run guide: the new engine choice and a model screen from the one catalog.
  await kvPut({ 'lotus.settings.v1': JSON.stringify({ appearance: 'light' }) }, ['lotus.setup.v1', 'lotus.setup.dismissed', 'lotus.sessions.v1']);
  const { ctx, page } = await open(false, { width: 1100, height: 760 });
  await page.goto(`${U}/index.html`);
  await page.waitForSelector('text=Welcome to Lotus', { timeout: 15000 });
  await page.click('button:has-text("Get started")');
  await page.waitForSelector('text=Where should Lotus keep its files?');
  await page.click('button:has-text("Continue")');
  await page.waitForSelector('text=How should Lotus run your models?', { timeout: 8000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${shots}/s17-guide-engines.png` });
  await page.click('button:has-text("Continue")');
  await page.waitForSelector('text=Pick a chat model', { timeout: 8000 });
  await page.waitForTimeout(700);
  ok('guide: a chat model is preselected', await page.locator('[role="radio"][aria-checked="true"]').count() === 1);
  await page.screenshot({ path: `${shots}/s17-guide-chat.png` });
  await page.click('button:has-text("Continue")');
  await page.waitForSelector('text=Pick an image model');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${shots}/s17-guide-images.png` });
  await ctx.close();
} finally {
  await browser.close(); core.stdin.end(); web.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
