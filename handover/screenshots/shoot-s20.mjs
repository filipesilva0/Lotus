// 0.9.6 screenshots: Voice → Call (first tab), a past call, Stories whole text, Speech to Text with a
// translation, Images resolution + examples, Chat/Work examples, Settings → General and Chat.
// From the project root, after `npm run build`, in ONE command:
//   (timeout 150 python3 -m http.server 8123 --directory dist >/dev/null 2>&1 &) ; sleep 1; node handover/screenshots/shoot-s20.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs';
fs.mkdirSync('/tmp/shots', { recursive: true });
const U = 'http://127.0.0.1:8123';
const now = Date.now();
const calls = [{ id: 'call1', title: 'Help me plan my study week', started: now - 3600e3, ended: now - 3300e3, memory: true, turns: [
  { role: 'user', text: 'Help me plan my study week', ts: 1 }, { role: 'assistant', text: 'Sure. Which exams do you have, and on which days?', ts: 2 },
  { role: 'user', text: 'Biomechanics on Friday and a GEFT presentation on Wednesday.', ts: 3 }, { role: 'assistant', text: 'Then let us put the presentation first: draft it Monday, rehearse Tuesday, and spend Thursday on biomechanics problems.', ts: 4 } ] }];
const history = { clips: [], transcripts: [{ id: 't1', text: 'Bom dia a todos. Hoje vamos falar sobre a reabilitação do joelho depois de uma cirurgia ao ligamento cruzado anterior.', model: 'Whisper Turbo', source: 'aula-joelho.m4a', seconds: 64, ts: now - 600e3, language: 'Portuguese',
  translations: [{ lang: 'English', text: 'Good morning everyone. Today we will talk about knee rehabilitation after anterior cruciate ligament surgery.', ts: now }] }] };
const story = [{ id: 's1', name: 'The Lighthouse', gap: 0.4, created: now, updated: now, items: [] }];
const seed = (dark) => `localStorage.clear();localStorage.setItem('lotus.setup.dismissed','1');
  localStorage.setItem('lotus.settings.v1', JSON.stringify({ appearance: '${dark ? 'dark' : 'light'}', selectedModel: 'llama3.1:8b', voiceEngine: 'builtin', imageEngine: 'builtin', llmBackend: 'builtin' }));
  localStorage.setItem('lotus.voice.calls.v1', ${JSON.stringify(JSON.stringify(calls))});
  localStorage.setItem('lotus.voice.builtin.v1', ${JSON.stringify(JSON.stringify(history))});
  localStorage.setItem('lotus.voice.stories.v1', ${JSON.stringify(JSON.stringify(story))});`;
const browser = await chromium.launch();
const shot = async (p, n) => { await p.screenshot({ path: `/tmp/shots/s20-${n}.png` }); console.log('saved', n); };
const checks = [];
const check = (name, ok) => { checks.push([name, ok]); console.log(ok ? 'ok  ' : 'FAIL', name); };
for (const dark of [false, true]) {
  const m = dark ? 'dark' : 'light';
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p.goto(U + '/index.html'); await p.evaluate(seed(dark)); await p.goto(U + '/index.html'); await p.waitForSelector('textarea', { timeout: 30000 }); await p.waitForTimeout(800);
  await shot(p, `chat-${m}`);
  if (!dark) check('chat examples have categories', await p.isVisible('[role="tab"]:has-text("Code")'));
  if (!dark) { await p.click('[role="tab"]:has-text("Code")'); await p.click('button:has-text("Senior Code Reviewer")'); await p.waitForTimeout(150); check('chat example fills the box', (await p.inputValue('textarea')).startsWith('Act as a senior')); }
  await p.keyboard.press('Control+2'); await p.waitForTimeout(400); await shot(p, `work-${m}`);
  await p.keyboard.press('Control+3'); await p.waitForTimeout(400);
  await p.click('button:has-text("Parameters")').catch(() => undefined);
  await p.waitForTimeout(300); await shot(p, `images-${m}`);
  if (!dark) check('images: resolution choices', await p.isVisible('[role="radiogroup"][aria-label="Resolution"]'));
  if (!dark) check('images: examples', await p.isVisible('button:has-text("Portrait")'));
  await p.keyboard.press('Control+4'); await p.waitForTimeout(500);
  await shot(p, `voice-call-${m}`);
  if (!dark) check('voice: Call is the first tab', (await p.locator('nav[aria-label="Voice modes"] button').first().innerText()).includes('Call'));
  await p.click('text=Help me plan my study week'); await p.waitForTimeout(300); await shot(p, `voice-pastcall-${m}`);
  await p.click('nav[aria-label="Voice modes"] button:has-text("Stories")'); await p.waitForTimeout(300);
  await p.click('button:has-text("Use an Example")').catch(() => undefined); await p.waitForTimeout(200);
  await shot(p, `voice-stories-${m}`);
  if (!dark) check('stories: whole text → 3 paragraph lines', await p.isVisible('button:has-text("Add 3 Lines")'));
  await p.click('nav[aria-label="Voice modes"] button:has-text("Speech to Text")'); await p.waitForTimeout(300);
  await shot(p, `voice-stt-${m}`);
  if (!dark) check('stt: original + translation tabs', await p.isVisible('[role="tab"]:has-text("Original (Portuguese)")') && await p.isVisible('button:has-text("Translate")'));
  await p.keyboard.press('Control+,'); await p.waitForTimeout(300);
  await p.click('[role="tab"]:has-text("General")'); await p.waitForTimeout(200); await shot(p, `settings-general-${m}`);
  if (!dark) check('settings: no temperature in General', !(await p.isVisible('text=Temperature (Sampling')));
  await p.click('[role="tab"]:has-text("Chat")'); await p.waitForTimeout(200); await shot(p, `settings-chat-${m}`);
  await ctx.close();
}
await browser.close();
const bad = checks.filter(([, ok]) => !ok).length;
console.log(`${checks.length - bad} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);
