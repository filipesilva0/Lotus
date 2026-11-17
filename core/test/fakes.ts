// Fake engines for tests: an Ollama that answers /api/chat from a script (streamed as NDJSON, with
// tool calls like a real tool-capable model) and a ComfyUI that "renders" a tiny PNG.
// Also used by Claude/handover/verification/agent-e2e.mjs (through `bun test/fakes.ts --serve`).

import type { WireMsg } from '../src/agent/llm';

export interface FakeTurn { content?: string; calls?: { name: string; args: Record<string, unknown> }[]; thinking?: string; error?: string; status?: number; /** Wait this long before answering (to watch agents work). */ delay?: number }
export type Responder = (messages: WireMsg[], body: { tools?: unknown[]; model: string }) => FakeTurn;

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
/** Lets the web app in a plain browser (agent-e2e.mjs) call the fakes directly. */
function withCors(f: (req: Request) => Response | Promise<Response>) {
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const r = await f(req);
    const h = new Headers(r.headers);
    for (const [k, v] of Object.entries(CORS)) h.set(k, v);
    return new Response(r.body, { status: r.status, headers: h });
  };
}

export interface FakeOllama { url: string; requests: { messages: WireMsg[]; tools?: unknown[]; model: string }[]; stop: () => void }

export function fakeOllama(respond: Responder | FakeTurn[], o: { capabilities?: string[]; rejectTools?: boolean } = {}): FakeOllama {
  const requests: FakeOllama['requests'] = [];
  let i = 0;
  const next: Responder = Array.isArray(respond) ? () => respond[Math.min(i, respond.length - 1)] : respond;
  const server = Bun.serve({
    port: 0, hostname: '127.0.0.1',
    fetch: withCors(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/api/version') return Response.json({ version: '0.12.0' });
      if (url.pathname === '/api/ps') return Response.json({ models: [] });
      if (url.pathname === '/api/show') return Response.json({ capabilities: o.capabilities ?? ['completion', 'tools'] });
      if (url.pathname === '/api/tags') return Response.json({ models: [{ name: 'fake:latest', model: 'fake:latest', size: 5e9, details: { parameter_size: '8B', family: 'qwen3', quantization_level: 'Q4_K_M' } }] });
      if (url.pathname !== '/api/chat') return new Response('not found', { status: 404 });
      const body = (await req.json()) as { messages: WireMsg[]; tools?: unknown[]; model: string };
      if (o.rejectTools && body.tools?.length) return Response.json({ error: `registry.ollama.ai/library/${body.model} does not support tools` }, { status: 400 });
      requests.push({ messages: body.messages, tools: body.tools, model: body.model });
      const turn = next(body.messages, body);
      i++;
      if (turn.delay) await Bun.sleep(turn.delay);
      if (turn.status) return Response.json({ error: turn.error ?? 'boom' }, { status: turn.status });
      const lines: string[] = [];
      if (turn.thinking) lines.push(JSON.stringify({ message: { role: 'assistant', content: '', thinking: turn.thinking }, done: false }));
      // Split the content in a few chunks, like a real stream (and across tag boundaries).
      const text = turn.content ?? '';
      for (let k = 0; k < text.length; k += 7) lines.push(JSON.stringify({ message: { role: 'assistant', content: text.slice(k, k + 7) }, done: false }));
      if (turn.calls?.length) lines.push(JSON.stringify({ message: { role: 'assistant', content: '', tool_calls: turn.calls.map((c) => ({ function: { name: c.name, arguments: c.args } })) }, done: false }));
      lines.push(JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, prompt_eval_count: 50, eval_count: 20, eval_duration: 1e9 }));
      return new Response(lines.join('\n') + '\n', { headers: { 'content-type': 'application/x-ndjson' } });
    }),
  });
  return { url: `http://127.0.0.1:${server.port}`, requests, stop: () => server.stop(true) };
}

/** The last message of a role. */
export const last = (ms: WireMsg[], role: WireMsg['role']) => [...ms].reverse().find((m) => m.role === role);

import { deflateSync } from 'node:zlib';

/** A small picture (snowy gradient with an orange disc) so screenshots show something. */
export function makePng(w = 320, h = 240): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length); const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length); out.set(new TextEncoder().encode(type), 4); out.set(data, 8);
    dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length))); return out;
  };
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = y * (w * 3 + 1) + 1 + x * 3;
      const d = Math.hypot(x - w * 0.55, y - h * 0.55);
      const sky = [200 + (y / h) * 40, 215 + (y / h) * 30, 235];
      const fox = d < h * 0.22 ? [214, 110, 40] : sky;
      raw[i] = fox[0]; raw[i + 1] = fox[1]; raw[i + 2] = fox[2];
    }
  }
  const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 2;
  const parts = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())];
  const all = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
  return all;
}

// 1×1 PNG
export const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

export function fakeComfy(o: { models?: string[]; fail?: string; big?: boolean } = {}): { url: string; prompts: unknown[]; stop: () => void } {
  const prompts: unknown[] = [];
  let polls = 0;
  const server = Bun.serve({
    port: 0, hostname: '127.0.0.1',
    fetch: withCors(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === '/system_stats') return Response.json({ system: { comfyui_version: 'fake' }, devices: [] });
      if (url.pathname === '/object_info/CheckpointLoaderSimple') return Response.json({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [o.models ?? ['sdxl-fake.safetensors']] } } } });
      if (url.pathname === '/object_info/UNETLoader') return Response.json({ UNETLoader: { input: { required: { unet_name: [[]] } } } });
      if (url.pathname === '/prompt') { prompts.push(await req.json()); polls = 0; return Response.json({ prompt_id: 'p1' }); }
      if (url.pathname === '/history/p1') {
        if (polls++ < 1) return Response.json({});
        if (o.fail) return Response.json({ p1: { status: { status_str: 'error', messages: [['execution_error', { exception_message: o.fail }]] }, outputs: {} } });
        return Response.json({ p1: { status: { status_str: 'success' }, outputs: { 9: { images: [{ filename: 'lotus_0001.png', subfolder: '', type: 'output' }] } } } });
      }
      if (url.pathname === '/view') return new Response(o.big ? makePng() : PNG, { headers: { 'content-type': 'image/png' } });
      if (url.pathname === '/interrupt') return Response.json({});
      return new Response('not found', { status: 404 });
    }),
  });
  return { url: `http://127.0.0.1:${server.port}`, prompts, stop: () => server.stop(true) };
}

// ── `bun test/fakes.ts --serve`: a rule-following fake model for the UI end-to-end run ──────────

const quoted = (t: string) => /[“"']([^”"']{2,80})[”"']/.exec(t)?.[1];

/** Behaves like a decent tool-calling model for a few phrasings (agent-e2e.mjs). */
export const helpful: Responder = (ms) => {
  const tool = last(ms, 'tool') as { content: string; tool_name: string } | undefined;
  const user = String(last(ms, 'user')?.content ?? '');
  const lastIsTool = ms[ms.length - 1]?.role === 'tool';
  if (lastIsTool && tool) {
    if (/denied/i.test(tool.content)) return { content: "Okay, I didn't save it." };
    if (tool.tool_name === 'task_add') return { content: `Done. ${tool.content.replace(/^Added task \S+ /, 'I added ')}` };
    if (tool.tool_name === 'image_generate') return { content: /^Error/.test(tool.content) ? `I couldn't make the image: ${tool.content.slice(7)}` : 'Here is your image. It is also on the Images page.' };
    if (tool.tool_name === 'files_write') return { content: `Saved. ${tool.content}` };
    if (tool.tool_name === 'files_list') return { content: `Here is what is in the folder:\n\n\`\`\`\n${tool.content.slice(0, 400)}\n\`\`\`` };
    return { content: tool.content.slice(0, 300) };
  }
  if (/\b(task|to-?do|remind)/i.test(user)) return { calls: [{ name: 'task_add', args: { title: quoted(user) ?? 'Buy oat milk', due: /friday/i.test(user) ? '2026-11-13' : undefined } }] };
  if (/\b(image|picture|draw|photo)/i.test(user)) return { calls: [{ name: 'image_generate', args: { prompt: 'a red fox sitting in fresh snow, soft morning light, detailed fur', aspect: '4:3' } }] };
  if (/\b(save|note|write)/i.test(user)) return { calls: [{ name: 'files_write', args: { path: 'shopping-list.md', content: '# Shopping\n- oat milk\n- bread\n' } }] };
  if (/\b(folder|files)\b/i.test(user)) return { calls: [{ name: 'files_list', args: {} }] };
  return { content: 'Hello! How can I help?' };
};

/** Session 16: a Work-mode job (shoot-s16.mjs): plan, a face, a helper, a question, artifacts, ticks. */
export const worker: Responder = (ms) => {
  const sys = String(ms[0]?.content ?? '');
  const done = ms.filter((m) => m.role === 'tool').map((m) => (m as { tool_name: string }).tool_name);
  if (sys.includes('You are Researcher')) return done.length ? { content: 'Keychron V1 (€79, hot-swap), Akko 5075B (€89, wireless), Royal Kludge RK84 (€59, wireless).' } : { calls: [{ name: 'web_search', args: { query: 'best budget mechanical keyboard 2026' } }] };
  const answer = [...ms].reverse().find((m) => m.role === 'tool' && (m as { tool_name: string }).tool_name === 'ask_user')?.content ?? '';
  const script: [string, Record<string, unknown>][] = [
    ['plan_set', { steps: ['Research current budget keyboards', 'Ask what matters most', 'Build the comparison table', 'Write a short buying guide page'] }],
    ['avatar_create', { name: 'Researcher', color: 'teal', shape: 'cloud', expression: 'thinking', about: 'Finds and checks product facts' }],
    ['agent_delegate', { name: 'Researcher', goal: 'Find three good mechanical keyboards under €100 with price and one standout feature each' }],
    ['plan_check', { step: 1 }],
    ['ask_user', { question: 'The three finalists differ mostly in wireless and hot-swap. What matters most to you?', options: ['Wireless', 'Hot-swap switches', 'Lowest price'] }],
    ['plan_check', { step: 2 }],
    ['artifact_write', { title: 'Keyboard comparison', filename: 'keyboards.csv', content: 'Keyboard,Price,Wireless,Hot-swap,Best for\nKeychron V1,€79,No,Yes,Tinkering\nAkko 5075B,€89,Yes,Yes,All-rounder\nRoyal Kludge RK84,€59,Yes,Yes,Lowest price\n' }],
    ['plan_check', { step: 3 }],
    ['artifact_write', { title: 'Buying guide', filename: 'guide.html', content: '<!doctype html><html><body style="font-family:system-ui;margin:32px;max-width:640px"><h1>Budget keyboards, November 2026</h1><p>Our pick: <b>Akko 5075B</b>. Wireless, hot-swap and under €90.</p><ol><li>Akko 5075B · €89</li><li>Royal Kludge RK84 · €59</li><li>Keychron V1 · €79</li></ol></body></html>' }],
    ['plan_check', { step: 4 }],
  ];
  if (done.length < script.length) { const [name, args] = script[done.length]; return { calls: [{ name, args }] }; }
  return { content: `Done. You said **${answer.replace('The user answered: ', '')}** matters most, so the guide recommends the Akko 5075B. I made a comparison table (keyboards.csv) and a one-page buying guide (guide.html); both are in the Artifacts panel.` };
};

/** 0.11.0: Work deploys three agents by itself (shoot-s23.mjs); each takes a moment so they can be watched. */
export const team: Responder = (ms) => {
  const sys = String(ms[0]?.content ?? '');
  const tools = ms.filter((m) => m.role === 'tool');
  const helper = /You are (\w+)\. You are a helper agent/.exec(sys)?.[1];
  if (helper) {
    const wait = { Researcher: 2600, Writer: 1200, Checker: 1800 }[helper] ?? 1000;
    return tools.length ? { delay: wait, content: `${helper} result: ${helper === 'Researcher' ? 'quad sets, heel slides, straight-leg raises' : helper === 'Writer' ? 'Knee rehab starts gently.' : 'Stop if pain rises above 5/10.'}` } : { delay: wait, calls: [{ name: 'artifact_read', args: {} }] };
  }
  const user = String(last(ms, 'user')?.content ?? '');
  if (!tools.length) return { thinking: 'Three independent parts: exercises, an intro, safety notes. I will deploy three agents so they work at the same time.', calls: [{ name: 'agents_deploy', args: { tasks: ['Researcher: list three gentle knee exercises', 'Writer: draft a two-line intro about knee rehab', 'Checker: write one safety note'], context: user } }] };
  if (tools.length === 1) return { calls: [{ name: 'artifact_write', args: { title: 'Knee plan', filename: 'knee-plan.md', content: `# Knee plan\n\n${tools[0].content}` } }] };
  return { content: `Done. Three agents worked on it at once; I combined their parts into **knee-plan.md**. (${user.slice(0, 40)})` };
};

/** 0.11.0: Chat replies whose cards come in the formats models actually use (shoot-s23.mjs). */
export const cards: Responder = (ms) => {
  const all = JSON.stringify(ms);
  const user = String(last(ms, 'user')?.content ?? '');
  if (all.includes('Hello from page one') && /pdf/i.test(user)) return { content: 'PDF READ OK: it says Hello from page one, and page two says Second page text.' };
  if (/image/i.test(user)) return { content: 'Here is a prompt for your picture.\n\n```json\n{"title": "Fox in snow", "prompt": "a red fox sitting in fresh snow, soft morning light", "negative": "blurry", "aspect": "4:3", "steps": 25,}\n```' };
  if (/plan/i.test(user)) return { content: 'A couple of questions first.\n\n{"title": "Your plan", "questions": [{"question": "Days per week?", "options": ["2", "3", "4"]}, {"question": "Main goal?", "options": ["Strength", "Mobility"]}]}' };
  return { content: 'Hello!' };
};

/** Always claims, never acts. */
export const liar: Responder = () => ({ content: "I've added “Renew passport” to your task board." });

if (import.meta.main && process.argv.includes('--serve')) {
  const a = fakeOllama(helpful);
  const b = fakeOllama(liar);
  const c = fakeComfy({ models: ['sdxl-fake.safetensors'], big: true });
  const w = fakeOllama(worker);
  const t = fakeOllama(team);
  const k = fakeOllama(cards);
  console.log(`FAKES ${JSON.stringify({ ollama: a.url, liar: b.url, comfy: c.url, work: w.url, team: t.url, cards: k.url })}`);
  setTimeout(() => process.exit(0), Number(process.env.FAKES_TTL ?? 240) * 1000);
}
