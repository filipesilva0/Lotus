// Session 8 screenshots (page petal accents, title bar panels, chat bar, auto appearance) (Chromium via Playwright — closer to WebView2 than WebKitGTK).
// From the project root, after `npm run build`, in ONE command:
//   (timeout 120 python3 -m http.server 8123 --directory dist >/dev/null 2>&1 &) ; sleep 1; node handover/screenshots/shoot-s8.mjs
// Writes PNGs to /tmp/shots/s8-*.png. Seeds realistic chats, memory, a skill and a plugin.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs';
fs.mkdirSync('/tmp/shots', { recursive: true });
const U = 'http://127.0.0.1:8123';
const DAY = 86_400_000;
const now = Date.now();

function seedSessions() {
  const models = ['llama3.1:8b', 'qwen2.5-coder:7b', 'gemma3:4b', 'mistral-nemo:12b'];
  const out = [];
  let n = 0;
  for (let d = 13; d >= 0; d--) {
    const count = [2, 0, 3, 5, 1, 4, 6, 2, 0, 3, 7, 4, 5, 3][13 - d];
    for (let k = 0; k < count; k++) {
      const t = now - d * DAY - (k * 3 + 1) * 3_600_000 + 120_000;
      const model = models[(d + k) % 4];
      out.push({ id: `chat-${n++}`, title: `Chat ${n}`, model, updatedAt: '', category: 'General', ts: t, messages: [
        { id: `user-${t}`, role: 'user', content: 'Explain how to warm up before a run', timestamp: '' },
        { id: `assistant-${t + 4000}`, role: 'assistant', content: 'Start with five minutes of easy jogging, then dynamic stretches such as leg swings and walking lunges. '.repeat(1 + (k % 3)), timestamp: '', tokensPerSec: 28 + ((d * 7 + k * 5) % 30), mode: k % 3 === 0 ? { thinking: true } : k % 4 === 0 ? { web: true } : undefined, recall: k % 2 ? { memories: 1, sessions: 0, skills: [], projectFiles: 0 } : undefined },
      ] });
    }
  }
  const t = now - 600_000;
  out.unshift({ id: 'chat-live', title: 'Plan a mobility routine', autoTitle: 'Plan a mobility routine', model: 'llama3.1:8b', updatedAt: '', category: 'General', ts: t, messages: [
    { id: `user-${t}`, role: 'user', content: 'Help me plan a 4-week mobility routine for my hips.', timestamp: '10:02' },
    { id: `assistant-${t + 3000}`, role: 'assistant', timestamp: '10:02', tokensPerSec: 41, content: 'Happy to help. A few quick questions so the plan fits you:\n\n```choices\n{"title":"Your routine","questions":[{"question":"How many days a week can you train?","type":"single","options":["2 days","3 days","4 days","5 or more"]},{"question":"What do you want to improve?","type":"multi","options":["Hip flexor tightness","Deep squat depth","Lower-back comfort","Running stride"]},{"question":"Any pain or past injuries I should know about?","type":"text"}]}\n```' },
  ] });
  const t2 = now - 30 * 60_000;
  out.splice(1, 0, { id: 'chat-list', title: 'Choose a stack', model: 'qwen2.5-coder:7b', updatedAt: '', category: 'General', ts: t2, messages: [
    { id: `user-${t2}`, role: 'user', content: 'I want to build a small clinic booking site.', timestamp: '09:31' },
    { id: `assistant-${t2 + 3000}`, role: 'assistant', timestamp: '09:31', tokensPerSec: 52, content: 'Good project for a small stack. **Which approach do you prefer?**\n\nA) Static site with a booking form (simplest)\nB) React + Supabase (accounts and a dashboard)\nC) Next.js full-stack (most flexible)' },
  ] });
  return out;
}
const memory = [
  { id: 'm1', kind: 'memory', text: 'Works as a physiotherapist and runs PhysioPulse', ts: now - 9 * DAY, source: 'user' },
  { id: 'm2', kind: 'instruction', text: 'Answer in European Portuguese when I write in Portuguese', ts: now - 6 * DAY, source: 'user' },
  { id: 'm3', kind: 'memory', text: 'Prefers TypeScript and Tailwind for web work', ts: now - 2 * DAY, source: 'auto' },
];
const skills = [{ id: 'sk1', name: 'Write a rehab exercise sheet', description: 'Turns a diagnosis into a printable home-exercise sheet', whenToUse: 'When asked for a home exercise programme or rehab sheet', body: '## Steps\n1. Confirm the condition and stage.\n2. Pick 4–6 exercises with sets, reps and progression.\n3. Add red flags that mean stop and call.\n\n## Check\n- Every exercise has a clear start position.', tags: ['physio'], version: 3, uses: 7, wins: 4, enabled: true, origin: 'auto', created: now - 8 * DAY, updated: now - DAY }];
const plugins = [{ id: 'plg-1', name: 'Stand-up helper', version: '1.0.0', description: 'Turns rough notes into Yesterday / Today / Blockers', author: '', instructions: 'When the user shares work notes, keep updates short and in bullet points.', commands: [{ name: 'standup', description: 'Write my stand-up', prompt: 'Turn these notes into a stand-up update with Yesterday, Today and Blockers:\n\n{{input}}' }], skills: [], enabled: true, origin: 'created', created: now - 3 * DAY, updated: now - 3 * DAY }];

const seed = (dark) => `
  localStorage.clear();
  localStorage.setItem('lotus.setup.dismissed','1');
  localStorage.setItem('lotus.settings.v1', JSON.stringify({ appearance: '${dark ? 'dark' : 'light'}', selectedModel: 'llama3.1:8b' }));
  localStorage.setItem('lotus.sessions.v1', ${JSON.stringify(JSON.stringify(seedSessions()))});
  localStorage.setItem('lotus.activeSession.v1', JSON.stringify('chat-live'));
  localStorage.setItem('lotus.memory.v1', ${JSON.stringify(JSON.stringify(memory))});
  localStorage.setItem('lotus.skills.v1', ${JSON.stringify(JSON.stringify(skills))});
  localStorage.setItem('lotus.plugins.v1', ${JSON.stringify(JSON.stringify(plugins))});
`;
// A colourful "wallpaper" so the frosted surfaces have something to blur (the real app shows the desktop).
const WALL = `html.no-glass body{background: radial-gradient(60% 80% at 15% 20%, #ff7a59 0%, transparent 60%), radial-gradient(50% 70% at 85% 30%, #3b82f6 0%, transparent 60%), radial-gradient(60% 60% at 50% 90%, #22c55e 0%, transparent 60%), #f3efe9 !important;}
html.no-glass.dark body{background: radial-gradient(60% 80% at 15% 20%, #8a2be2 0%, transparent 60%), radial-gradient(50% 70% at 85% 30%, #0b5ed7 0%, transparent 60%), radial-gradient(60% 60% at 50% 90%, #0f766e 0%, transparent 60%), #111 !important;}`;

const browser = await chromium.launch();
async function page(dark, w = 1360, h = 860) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p.goto(U + '/index.html');
  await p.evaluate(seed(dark));
  await p.goto(U + '/index.html');
  await p.addStyleTag({ content: WALL });
  await p.waitForTimeout(700);
  return p;
}
const shot = async (p, name) => { await p.screenshot({ path: `/tmp/shots/s8-${name}.png` }); console.log('saved', name); };

const nav = async (p, label) => { await p.click(`aside[aria-label="Pages"] button[aria-label^="${label}"]`); await p.waitForTimeout(400); };

for (const dark of [false, true]) {
  const m = dark ? 'dark' : 'light';
  const p = await page(dark);
  await shot(p, `chat-${m}`);
  // Hover a composer icon to show its tip.
  await p.hover('button[aria-label^="Memory on"]'); await p.waitForTimeout(700);
  await shot(p, `chat-tip-${m}`);
  // Title bar: View menu (frosted), then hide both panels.
  await p.click('button[role="menuitem"]:has-text("View")'); await p.waitForTimeout(300);
  await shot(p, `view-menu-${m}`);
  await p.keyboard.press('Escape');
  await p.click('button[aria-label="Hide sidebar"]'); await p.click('button[aria-label="Hide inspector"]'); await p.waitForTimeout(300);
  await shot(p, `chat-panels-hidden-${m}`);
  await p.click('button[aria-label="Show sidebar"]'); await p.click('button[aria-label="Show inspector"]');
  await p.click('button[aria-pressed]:has-text("Research")'); await p.waitForTimeout(200);
  await shot(p, `chat-research-mode-${m}`);
  // (Ollama is offline in this preview, so the box is disabled; open a task from the sidebar instead.)
  await p.click('button[aria-label="New deep research task"]'); await p.waitForTimeout(500);
  await shot(p, `chat-research-task-${m}`);
  await nav(p, 'Images'); await shot(p, `images-${m}`);
  await nav(p, 'Voice'); await shot(p, `voice-${m}`);
  await nav(p, 'App Builder'); await shot(p, `builder-${m}`);
  await nav(p, 'Tasks'); await shot(p, `tasks-${m}`);
  await nav(p, 'Engines'); await p.click('[role="tab"]:has-text("Models"), button:has-text("Models")'); await p.waitForTimeout(400);
  await p.click('button:has-text("Hardware & Runtime")'); await p.waitForTimeout(400);
  await shot(p, `models-monitor-${m}`);
  await p.context().close();
}
// Auto appearance follows the OS (emulated here with prefers-color-scheme).
{
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, colorScheme: 'dark' });
  const p = await ctx.newPage();
  await p.goto(U + '/index.html');
  await p.evaluate(seed(false).replace(`appearance: 'light'`, `appearance: 'auto'`).replace(`"appearance":"light"`, `"appearance":"auto"`));
  await p.goto(U + '/index.html'); await p.addStyleTag({ content: WALL }); await p.waitForTimeout(600);
  const darkOn = await p.evaluate(() => document.documentElement.classList.contains('dark'));
  await p.emulateMedia({ colorScheme: 'light' }); await p.waitForTimeout(300);
  const lightOn = await p.evaluate(() => !document.documentElement.classList.contains('dark'));
  console.log(`auto appearance: OS dark -> app dark: ${darkOn}; OS light -> app light: ${lightOn}`);
  await p.click('aside[aria-label="Pages"] button[aria-label="Settings"]'); await p.waitForTimeout(300);
  await p.click('button:has-text("Appearance")'); await p.waitForTimeout(300);
  await shot(p, 'settings-appearance-auto');
  await ctx.close();
}
await browser.close();
