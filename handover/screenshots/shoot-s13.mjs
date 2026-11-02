// Session 13 screenshots (HIG pass): menus (File, Edit, View, Go, Help), compose buttons, engine
// notice, reply actions, Undo note after deleting a chat, Settings pane toolbar, Tasks board.
// From the project root, after `npm run build`, in ONE command:
//   (timeout 150 python3 -m http.server 8123 --directory dist >/dev/null 2>&1 &) ; sleep 1; node handover/screenshots/shoot-s13.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs';
fs.mkdirSync('/tmp/shots', { recursive: true });
const U = 'http://127.0.0.1:8123';
const now = Date.now();
const sessions = [
  { id: 'c1', title: 'Warm-up before a run', model: 'llama3.1:8b', updatedAt: '', ts: now - 60000, messages: [
    { id: 'u1', role: 'user', content: 'How should I warm up before a 5k?', timestamp: '' },
    { id: 'a1', role: 'assistant', content: 'Start with five minutes of easy jogging, then leg swings and walking lunges, then two short strides.', timestamp: '', tokensPerSec: 38 } ] },
  { id: 'c2', title: 'Hip mobility plan', model: 'llama3.1:8b', updatedAt: '', ts: now - 3600000, messages: [{ id: 'u2', role: 'user', content: 'Plan', timestamp: '' }, { id: 'a2', role: 'assistant', content: 'Here is a plan.', timestamp: '' }] },
];
const seed = (dark) => `localStorage.clear();localStorage.setItem('lotus.setup.dismissed','1');
  localStorage.setItem('lotus.settings.v1', JSON.stringify({ appearance: '${dark ? 'dark' : 'light'}', selectedModel: 'llama3.1:8b' }));
  localStorage.setItem('lotus.sessions.v1', ${JSON.stringify(JSON.stringify(sessions))});
  localStorage.setItem('lotus.activeSession.v1', JSON.stringify('c1'));`;
const browser = await chromium.launch();
const shot = async (p, n) => { await p.screenshot({ path: `/tmp/shots/s13-${n}.png` }); console.log('saved', n); };
for (const dark of [false, true]) {
  const m = dark ? 'dark' : 'light';
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p.goto(U + '/index.html'); await p.evaluate(seed(dark)); await p.goto(U + '/index.html'); await p.waitForTimeout(800);
  await shot(p, `chat-${m}`);
  for (const menu of ['File', 'Edit', 'View', 'Go', 'Help']) {
    await p.click(`button[role="menuitem"]:has-text("${menu}")`); await p.waitForTimeout(250);
    if (!dark) await shot(p, `menu-${menu.toLowerCase()}`);
    await p.keyboard.press('Escape');
  }
  // Edit › Find puts the cursor in the sidebar search.
  await p.keyboard.press('Control+f'); await p.waitForTimeout(150);
  console.log('find focuses search:', await p.evaluate(() => document.activeElement?.getAttribute('type') === 'search'));
  // Delete a conversation: it disappears and an Undo note shows.
  await p.hover('text=Hip mobility plan'); await p.click('button[aria-label="Delete conversation"] >> visible=true'); await p.waitForTimeout(250);
  await shot(p, `undo-${m}`);
  await p.click('button:has-text("Undo")'); await p.waitForTimeout(200);
  console.log('undo restores:', await p.isVisible('text=Hip mobility plan'));
  await p.keyboard.press('Control+,'); await p.waitForTimeout(300);
  await shot(p, `settings-${m}`);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  console.log('escape closes settings:', !(await p.isVisible('[role="tablist"][aria-label="Settings panes"]')));
  await p.keyboard.press('Control+5'); await p.waitForTimeout(400);
  await shot(p, `tasks-${m}`);
  await p.keyboard.press('Control+3'); await p.waitForTimeout(400);
  await shot(p, `voice-${m}`);
  await p.keyboard.press('Control+6'); await p.waitForTimeout(400);
  await shot(p, `engines-${m}`);
  await ctx.close();
}
await browser.close();
