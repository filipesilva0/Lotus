// Session 7 screenshots (Chromium via Playwright — closer to WebView2 than WebKitGTK).
// From the project root, after `npm run build`, in ONE command:
//   (timeout 120 python3 -m http.server 8123 --directory dist >/dev/null 2>&1 &) ; sleep 1; node handover/screenshots/shoot-s7.mjs
// Writes PNGs to /tmp/shots/s7-*.png. Seeds realistic chats, memory, a skill and a plugin.
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
  localStorage.setItem('lotus.settings.v1', JSON.stringify({ palette: 'blue', darkMode: ${dark}, selectedModel: 'llama3.1:8b' }));
  localStorage.setItem('lotus.sessions.v1', ${JSON.stringify(JSON.stringify(seedSessions()))});
  localStorage.setItem('lotus.activeSession.v1', JSON.stringify('chat-live'));
  localStorage.setItem('lotus.memory.v1', ${JSON.stringify(JSON.stringify(memory))});
  localStorage.setItem('lotus.skills.v1', ${JSON.stringify(JSON.stringify(skills))});
  localStorage.setItem('lotus.plugins.v1', ${JSON.stringify(JSON.stringify(plugins))});
  localStorage.setItem('lotus.chat.inspector.v1', 'false');
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
const shot = async (p, name) => { await p.screenshot({ path: `/tmp/shots/s7-${name}.png` }); console.log('saved', name); };

for (const dark of [false, true]) {
  const m = dark ? 'dark' : 'light';
  const p = await page(dark);
  await shot(p, `chat-questionnaire-${m}`);
  await p.click('[aria-label="Add files or a folder"]'); await p.waitForTimeout(200); await shot(p, `composer-plus-${m}`);
  await p.keyboard.press('Escape');
  await p.click('button[title="Model for this chat"]'); await p.waitForTimeout(200); await shot(p, `composer-models-${m}`);
  await p.keyboard.press('Escape');
  // the list-style poll
  await p.evaluate(() => { localStorage.setItem('lotus.activeSession.v1', JSON.stringify('chat-list')); });
  await p.reload(); await p.addStyleTag({ content: WALL }); await p.waitForTimeout(600);
  await shot(p, `chat-list-poll-${m}`);
  // profile / usage
  await p.click('button[aria-label^="Account"]'); await p.waitForTimeout(400); await shot(p, `profile-menu-${m}`);
  await p.click('[role="menuitem"][aria-label="Your usage"]'); await p.waitForTimeout(600); await shot(p, `profile-usage-${m}`);
  await p.mouse.move(520, 470); await p.waitForTimeout(200);
  await p.keyboard.press('Escape');
  // library
  await p.click('button[aria-label^="Account"]'); await p.waitForTimeout(300);
  await p.click('[role="menuitem"][aria-label^="Library"]'); await p.waitForTimeout(500); await shot(p, `library-skills-${m}`);
  await p.click('[role="tab"]:has-text("Memory")'); await p.waitForTimeout(300); await shot(p, `library-memory-${m}`);
  await p.click('[role="tab"]:has-text("Soul")'); await p.waitForTimeout(300); await shot(p, `library-soul-${m}`);
  await p.click('[role="tab"]:has-text("Plugins")'); await p.waitForTimeout(300); await shot(p, `library-plugins-create-${m}`);
  await p.click('nav[aria-label="Plugins"] >> text=Stand-up helper'); await p.waitForTimeout(300); await shot(p, `library-plugin-detail-${m}`);
  await p.keyboard.press('Escape');
  // settings
  await p.keyboard.press('Control+,'); await p.waitForTimeout(400); await shot(p, `settings-${m}`);
  await p.keyboard.press('Escape');
  await p.context().close();
}
// desktop layout: title bar with window controls (Tauri faked)
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript('window.__TAURI_INTERNALS__={invoke:async()=>null,transformCallback:()=>0,metadata:{currentWindow:{label:"main"},currentWebview:{label:"main",windowLabel:"main"}}};');
  const p = await ctx.newPage();
  await p.goto(U + '/index.html'); await p.evaluate(seed(false)); await p.goto(U + '/index.html');
  await p.addStyleTag({ content: WALL }); await p.waitForTimeout(800);
  await p.click('nav[role="menubar"] >> text=View'); await p.waitForTimeout(200);
  await shot(p, 'desktop-titlebar-menu-light');
  await ctx.close();
}
// island
{
  const ctx = await browser.newContext({ viewport: { width: 480, height: 520 }, colorScheme: 'dark', deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(U + '/island.html'); await p.addStyleTag({ content: 'body{background:#5b6b7f!important}' }); await p.waitForTimeout(700);
  await shot(p, 'island-strip');
  await p.hover('[aria-label="Lotus island"]'); await p.waitForTimeout(700); await shot(p, 'island-peek');
  await p.evaluate(() => new BroadcastChannel('lotus-bus').postMessage({ name: 'activity', payload: { id: 'img', kind: 'image', label: 'Rendering', progress: 0.45 } }));
  await p.waitForTimeout(500); await shot(p, 'island-working');
  await p.hover('[aria-label="Lotus island"]'); await p.waitForTimeout(600);
  await p.evaluate(() => (document.querySelector('button[aria-label="Chat"]'))?.click()); await p.waitForTimeout(700); await shot(p, 'island-chat');
  await ctx.close();
}
await browser.close();
