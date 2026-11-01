// Session 10 screenshots: the first-run Welcome guide (every step) and the per-OS title bar.
// From the project root, after `npm run build`, in ONE command:
//   (timeout 280 python3 -m http.server 8123 --directory dist >/dev/null 2>&1 &) ; sleep 1; node handover/screenshots/shoot-s10.mjs
// Writes PNGs to /tmp/shots/s10-*.png. Fakes the Tauri bridge with a Windows/macOS machine that has
// Ollama installed, a 12 GB GPU, and the MSI's engine boxes all ticked. Chromium, not WebView2/WKWebView.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs';
fs.mkdirSync('/tmp/shots', { recursive: true });
const U = 'http://127.0.0.1:8123';

const UA = {
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  macos: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
};
const fake = (os) => `
  (() => {
    const info = {
      studioDir: ${JSON.stringify(os === 'windows' ? 'C:\\Users\\Filipe\\Documents\\Lotus Studio' : '/Users/filipe/Documents/Lotus Studio')},
      defaultStudioDir: ${JSON.stringify(os === 'windows' ? 'C:\\Users\\Filipe\\Documents\\Lotus Studio' : '/Users/filipe/Documents/Lotus Studio')},
      os: '${os}', arch: '${os === 'macos' ? 'aarch64' : 'x86_64'}',
      installer: ${os === 'windows' ? '{ ollama: true, comfyui: true, voicebox: true }' : 'null'},
      found: ${os === 'windows' ? "{ ollama: 'C:\\\\Users\\\\Filipe\\\\AppData\\\\Local\\\\Programs\\\\Ollama\\\\ollama.exe', comfyui: null, voicebox: null }" : "{ ollama: '/Applications/Ollama.app/Contents/Resources/ollama', comfyui: '/Applications/ComfyUI.app/Contents/MacOS/ComfyUI', voicebox: '/Applications/Voicebox.app/Contents/MacOS/voicebox' }"},
    };
    const answers = {
      setup_info: info,
      hw_snapshot: ${os === 'windows' ? "{ source: 'nvidia-smi', gpus: [{ name: 'NVIDIA GeForce RTX 4070', totalMb: 12282, usedMb: 900, freeMb: 11382 }], ramTotalMb: 32768, ramFreeMb: 20000, note: '' }" : "{ source: 'none', gpus: [], ramTotalMb: 32768, ramFreeMb: 18000, note: '' }"},
      setup_prepare: info.studioDir,
      installer_download: '${os === 'windows' ? 'C:\\\\Users\\\\Filipe\\\\Documents\\\\Lotus Studio\\\\Engines\\\\Installers\\\\ComfyUI-Desktop-Setup.exe' : '/Users/filipe/Documents/Lotus Studio/Engines/Installers/ComfyUI-Desktop.dmg'}',
      installer_open: { kind: 'opened', path: null },
      comfy_models_guess: ${os === 'macos' ? "'/Users/filipe/Documents/ComfyUI/models'" : 'null'}, engine_detect: null,
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd) => { if (cmd === 'plugin:http|fetch') throw new Error('offline in screenshots'); return cmd in answers ? answers[cmd] : null; },
      transformCallback: () => 0,
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
    };
  })();`;
// Stand-in for the desktop wallpaper behind the window material.
const WALL = `html body{background: radial-gradient(60% 80% at 15% 20%, #f6a27a 0%, transparent 60%), radial-gradient(50% 70% at 85% 30%, #7aa7f6 0%, transparent 60%), radial-gradient(60% 60% at 50% 90%, #8fd6a4 0%, transparent 60%), #efeae3 !important;}
html.dark body{background: radial-gradient(60% 80% at 15% 20%, #4b2a6e 0%, transparent 60%), radial-gradient(50% 70% at 85% 30%, #123a73 0%, transparent 60%), radial-gradient(60% 60% at 50% 90%, #0f4a44 0%, transparent 60%), #121214 !important;}`;

const browser = await chromium.launch();
const shot = async (p, name) => { await p.waitForTimeout(700); await p.screenshot({ path: `/tmp/shots/s10-${name}.png` }); console.log('saved', name); };

async function run(os, dark) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1, userAgent: UA[os], colorScheme: dark ? 'dark' : 'light' });
  await ctx.addInitScript(fake(os));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p.goto(U + '/index.html');
  await p.evaluate(`localStorage.clear(); localStorage.setItem('lotus.settings.v1', JSON.stringify({ appearance: '${dark ? 'dark' : 'light'}' }));`);
  await p.goto(U + '/index.html');
  await p.addStyleTag({ content: WALL });
  const tag = `${os}-${dark ? 'dark' : 'light'}`;
  for (let n = 1; n < 12; n++) {
    const step = await p.evaluate(() => document.querySelector('[data-step]')?.getAttribute('data-step'));
    if (!step) { await shot(p, `${tag}-${n}-app`); break; }
    await shot(p, `${tag}-${n}-${step}`);
    await p.click('footer button:last-child');
    await p.waitForTimeout(600);
  }
  await ctx.close();
}

await run('windows', false);
await run('windows', true);
await run('macos', false);
await run('macos', true);
await browser.close();
