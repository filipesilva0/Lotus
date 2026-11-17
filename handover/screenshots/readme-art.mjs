// Draws the README's petal cards and engine diagram (light + dark) into docs/assets.
// Run: node handover/screenshots/readme-art.mjs   (needs playwright; see CLAUDE.md)
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = process.cwd();
const out = join(root, 'docs/assets');
const font = readFileSync(join(root, 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')).toString('base64');
const mark = readFileSync(join(root, 'src/assets/lotus-petals.png')).toString('base64');

// Page order and petal colours as in the app (styles/theme.ts PETAL_ORDER / PAGE_PALETTE).
const PAGES = [
  ['Chat', '#0A84FF', 'Talk to your models. Think, search the web or run a cited deep-research pass.'],
  ['Work', '#EE5267', 'Describe a job. Agents work on it side by side and hand back real files.'],
  ['Images', '#FF9F0A', 'Text to image on your own GPU, with model setups, LoRAs and saved styles.'],
  ['Voice', '#F5CF3A', 'Voice calls, cloned voices, multi-voice stories and long transcripts.'],
  ['Tasks', '#30D158', 'A board you share with Lotus, plus routines, skills and memory.'],
];

const theme = (dark) => dark
  ? { bg: '#0d1017', card: 'rgba(255,255,255,0.035)', line: 'rgba(255,255,255,0.10)', text: '#f5f5f7', sub: '#a1a1a6', mute: '#6e6e73', chip: 'rgba(255,255,255,0.05)', glow: '33' }
  : { bg: '#ffffff', card: '#ffffff', line: 'rgba(0,0,0,0.09)', text: '#1d1d1f', sub: '#6e6e73', mute: '#86868b', chip: '#f5f5f7', glow: '26' };

const base = (t) => `<style>@font-face{font-family:I;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:100 900}
*{box-sizing:border-box;margin:0}body{background:${t.bg};font-family:I,sans-serif;color:${t.text};-webkit-font-smoothing:antialiased}
.petal{width:21px;height:36px;border-radius:50%;transform:rotate(14deg)}</style>`;

const petals = (dark) => {
  const t = theme(dark);
  return `${base(t)}<div style="display:flex;gap:20px;padding:34px 30px;width:1280px;height:330px">
  ${PAGES.map(([name, c, d], i) => `<div style="flex:1;border:1px solid ${t.line};border-radius:24px;padding:30px 26px;position:relative;overflow:hidden;background:${t.card}">
    <div style="position:absolute;inset:0;background:radial-gradient(120% 90% at 80% 0%, ${c}${dark ? '40' : '2e'} 0%, transparent 60%)"></div>
    <div style="position:relative"><div class="petal" style="background:${c};box-shadow:0 6px 18px ${c}66"></div>
    <div style="margin-top:34px;font-size:11px;letter-spacing:.18em;color:${t.sub};font-weight:600">0${i + 1}</div>
    <div style="margin-top:4px;font-size:27px;font-weight:700;letter-spacing:-.02em">${name}</div>
    <div style="margin-top:10px;font-size:14.5px;line-height:1.5;color:${t.sub}">${d}</div></div></div>`).join('')}</div>`;
};

const ENG = [
  { name: 'llama.cpp', kind: 'Chat models', uses: 'Chat · Work · Tasks', c: '#0A84FF' },
  { name: 'stable-diffusion.cpp', kind: 'Image models', uses: 'Images', c: '#FF9F0A' },
  { name: 'sherpa-onnx', kind: 'Voice models', uses: 'Calls · Speech · Transcripts', c: '#F5CF3A' },
];
const OUT = [
  { name: 'Ollama', port: '11434', c: '#0A84FF' },
  { name: 'ComfyUI', port: '8188', c: '#FF9F0A' },
  { name: 'Voicebox', port: '17493', c: '#F5CF3A' },
];

const engines = (dark) => {
  const t = theme(dark);
  const row = (e) => `<div style="display:flex;align-items:center;gap:16px;border:1px solid ${t.line};border-radius:16px;padding:16px 20px;background:${t.card}">
    <span style="width:11px;height:11px;border-radius:50%;background:${e.c};box-shadow:0 0 0 6px ${e.c}${t.glow}"></span>
    <div style="flex:1"><span style="font-size:19px;font-weight:650">${e.name}</span> <span style="font-size:13.5px;color:${t.sub};margin-left:6px">${e.kind}</span>
    <div style="font-size:14px;color:${t.sub};margin-top:3px">${e.uses}</div></div></div>`;
  const chip = (e) => `<div style="display:flex;align-items:center;gap:10px;border:1px solid ${t.line};border-radius:12px;padding:11px 14px;background:${t.chip};flex:1">
    <span style="width:8px;height:8px;border-radius:50%;background:${e.c}"></span><span style="font-size:15px;font-weight:600">${e.name}</span>
    <code style="margin-left:auto;font-family:ui-monospace,monospace;font-size:12px;color:${t.sub}">:${e.port}</code></div>`;
  return `${base(t)}<div style="width:1280px;height:540px;padding:22px 20px">
  <div style="position:relative;height:100%;border:1.5px dashed ${t.line};border-radius:26px;padding:40px 44px;display:flex;gap:56px;align-items:center">
    <div style="position:absolute;top:-10px;left:34px;background:${t.bg};padding:0 12px;font-size:12px;letter-spacing:.2em;font-weight:600;color:${t.sub}">YOUR COMPUTER</div>
    <div style="width:270px;border:1px solid ${t.line};border-radius:22px;padding:34px 24px;text-align:center;background:${t.card}">
      <img src="data:image/png;base64,${mark}" style="width:76px"><div style="font-size:30px;font-weight:700;margin-top:10px;letter-spacing:-.02em">Lotus</div>
      <div style="font-size:14px;color:${t.sub};margin-top:6px">and lotusd, its background core</div>
      <div style="font-size:12.5px;color:${t.mute};margin-top:16px;line-height:1.5">Chats, memory, tasks and agents<br>in Lotus Studio/Data</div></div>
    <div style="flex:1;display:flex;flex-direction:column;gap:12px">
      <div style="font-size:13px;font-weight:600;color:${t.sub};margin-bottom:2px">Lotus's own engines, downloaded once into Lotus Studio</div>
      ${ENG.map(row).join('')}
      <div style="font-size:13px;font-weight:600;color:${t.sub};margin:14px 0 2px">Or the engines you already use</div>
      <div style="display:flex;gap:12px">${OUT.map(chip).join('')}</div>
    </div></div></div>`;
};

const browser = await chromium.launch();
try {
  for (const dark of [false, true]) {
    const tag = dark ? 'dark' : 'light';
    for (const [name, html, w, h] of [['petals', petals(dark), 1280, 330], ['engines', engines(dark), 1280, 540]]) {
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
      await page.setContent(html);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: join(out, `${name}-${tag}.png`) });
      await page.close();
    }
  }
} finally { await browser.close(); }
console.log('done');
