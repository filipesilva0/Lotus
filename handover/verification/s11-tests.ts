// Session 11 tests: engines on another computer (address tidy-up, remote detection, access keys sent
// only to their own engine, connection test), guide flow with remote engines, and the one-time
// island-off reset. Run: bash handover/verification/run-s11-tests.sh
import './s5-setup';
import './s7-setup';
import {
  normalizeEngineUrl, isLoopbackHost, isRemote, setEngineUrl, engineUrl, setEngineToken, authHeaderFor, engineForUrl, DEFAULT_URLS,
} from '../../src/services/engineConfig';
import { testEngine, startEngine } from '../../src/services/engineControl';
import { http } from '../../src/lib/http';
import { enginesToInstall, modelScreenEngines, visibleSteps } from '../../src/setup/state';
import { loadIsland, saveIsland } from '../../src/island/state';
import { parseInstall, resolveInstall, installInstructions } from '../../src/chat/install';
import { installTarget, jobIdsFor, setupJobs } from '../../src/setup/jobs';

let pass = 0, fail = 0;
const results: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); pass++; results.push(`  ✓ ${name}`); }
  catch (e) { fail++; results.push(`  ✗ ${name}\n      ${(e as Error).stack?.split('\n').slice(0, 3).join('\n      ')}`); }
}
function eq(a: unknown, b: unknown, msg = '') { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error(`${msg} expected ${B}, got ${A}`); }
function ok(v: unknown, msg = 'expected truthy') { if (!v) throw new Error(msg); }

/** Fake network: records every request with its headers; `route` decides the reply. */
const seen: { url: string; auth: string | null }[] = [];
let route: (url: string, auth: string | null) => Response | Promise<Response> = () => new Response('{}', { status: 200 });
(globalThis as any).fetch = async (url: string, init?: RequestInit) => {
  const auth = new Headers(init?.headers).get('Authorization');
  seen.push({ url: String(url), auth });
  return route(String(url), auth);
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

async function main() {
  await test('address tidy-up: scheme and default port added, junk refused', () => {
    eq(normalizeEngineUrl('ollama', '192.168.1.20'), 'http://192.168.1.20:11434');
    eq(normalizeEngineUrl('comfyui', 'gpu-box.local'), 'http://gpu-box.local:8188');
    eq(normalizeEngineUrl('voicebox', '10.0.0.5:9000/'), 'http://10.0.0.5:9000');
    eq(normalizeEngineUrl('ollama', 'https://ollama.example.com'), 'https://ollama.example.com');
    eq(normalizeEngineUrl('ollama', 'https://example.com/ollama/'), 'https://example.com/ollama');
    eq(normalizeEngineUrl('ollama', ''), DEFAULT_URLS.ollama);
    eq(normalizeEngineUrl('ollama', 'ftp://x'), null);
    eq(normalizeEngineUrl('ollama', 'http://'), null);
  });
  await test('loopback vs another computer', () => {
    ok(isLoopbackHost('127.0.0.1') && isLoopbackHost('localhost') && isLoopbackHost('[::1]') && isLoopbackHost('0.0.0.0'));
    ok(!isLoopbackHost('192.168.1.20') && !isLoopbackHost('gpu-box.local'));
    localStorage.clear();
    eq(isRemote('ollama'), false);
    setEngineUrl('ollama', '192.168.1.20');
    eq(engineUrl('ollama'), 'http://192.168.1.20:11434');
    eq(isRemote('ollama'), true);
    eq(isRemote('comfyui'), false);
  });
  await test('access keys: Bearer or Basic, and only for the engine they belong to', () => {
    localStorage.clear();
    setEngineUrl('ollama', '192.168.1.20');
    setEngineToken('ollama', 'abc123');
    eq(authHeaderFor('http://192.168.1.20:11434/api/tags'), 'Bearer abc123');
    eq(authHeaderFor('http://192.168.1.20:11434'), 'Bearer abc123');
    eq(authHeaderFor('http://192.168.1.20:114345/api/tags'), null, 'port prefix must not match');
    eq(authHeaderFor('https://api.openalex.org/works'), null, 'never sent to other hosts');
    eq(authHeaderFor('http://127.0.0.1:8188/system_stats'), null);
    setEngineToken('ollama', 'me:secret');
    eq(authHeaderFor('http://192.168.1.20:11434/api/tags'), `Basic ${btoa('me:secret')}`);
    setEngineToken('ollama', '');
    eq(authHeaderFor('http://192.168.1.20:11434/api/tags'), null);
    eq(engineForUrl('http://192.168.1.20:11434/api/chat'), 'ollama');
  });
  await test('http() adds the key to engine requests and nowhere else', async () => {
    localStorage.clear();
    setEngineUrl('comfyui', 'http://10.0.0.7:8188');
    setEngineToken('comfyui', 'tok');
    seen.length = 0;
    route = () => json({});
    await http('http://10.0.0.7:8188/object_info');
    await http('https://api.crossref.org/works?q=x');
    eq(seen.map((r) => r.auth), ['Bearer tok', null]);
  });
  await test('connection test: right engine, wrong service, needs a key, unreachable', async () => {
    localStorage.clear();
    route = (u) => (u === 'http://192.168.1.20:11434/api/version' ? json({ version: '0.12.3' }) : json({ hello: 1 }));
    const good = await testEngine('ollama', '192.168.1.20', '');
    ok(good.ok, good.message); eq(good.version, '0.12.3');
    const wrong = await testEngine('ollama', '192.168.1.20:8080', '');
    ok(!wrong.ok && /does not look like Ollama/.test(wrong.message), wrong.message);
    route = (_u, auth) => (auth === 'Bearer k' ? json({ system: { comfyui_version: '0.3.60' }, devices: [] }) : new Response('no', { status: 401 }));
    const needs = await testEngine('comfyui', 'gpu-box.local', '');
    ok(!needs.ok && /asks for an access key/.test(needs.message), needs.message);
    const keyed = await testEngine('comfyui', 'gpu-box.local', 'k');
    ok(keyed.ok && keyed.version === '0.3.60', keyed.message);
    route = () => { throw new TypeError('connection refused'); };
    const down = await testEngine('voicebox', '10.0.0.9', '');
    ok(!down.ok && /--host 0.0.0.0/.test(down.message), down.message);
    const bad = await testEngine('ollama', 'ftp://nope', '');
    ok(!bad.ok && /not a web address/.test(bad.message), bad.message);
  });
  await test('a remote engine is never started from this computer', async () => {
    localStorage.clear();
    setEngineUrl('ollama', '192.168.1.20');
    let msg = '';
    try { await startEngine('ollama'); } catch (e) { msg = (e as Error).message; }
    ok(/another computer/.test(msg), msg);
  });
  await test('guide: remote engines are not installed; remote ComfyUI gets no model screen', () => {
    const want = { ollama: true, comfyui: true, voicebox: true };
    eq(enginesToInstall(want, {}, { ollama: true, comfyui: true }), ['voicebox']);
    eq(enginesToInstall(want, { voicebox: '/v' }), ['ollama', 'comfyui'], 'old two-argument call still works');
    const models = modelScreenEngines(want, () => true, { comfyui: true });
    eq(models, ['ollama', 'voicebox']);
    eq(visibleSteps(false, models), ['welcome', 'folder', 'engines', 'chat', 'voice', 'done']);
  });
  await test('island: off on a fresh install, switched off once for older saved settings, later choice sticks', () => {
    localStorage.clear();
    eq(loadIsland().enabled, false);
    localStorage.setItem('lotus.island.v1', JSON.stringify({ enabled: true, model: 'qwen3.5:4b', agents: false }));
    const migrated = loadIsland();
    eq([migrated.enabled, migrated.model, migrated.agents], [false, 'qwen3.5:4b', false]);
    saveIsland({ enabled: true });
    eq(loadIsland().enabled, true, 'turning it on again is kept');
  });

  // ── Installs proposed in Chat ──────────────────────────────────────────
  await test('install block: parsed out of the reply, text kept, pending while streaming', () => {
    const reply = 'Sure, Gemma 4 12B is a good fit.\n\n```install\n{"engine":"ollama","model":"gemma4:12b","reason":"Better at long answers."}\n```';
    const p = parseInstall(reply);
    eq(p.text, 'Sure, Gemma 4 12B is a good fit.');
    eq([p.target?.engine, p.target?.id, p.target?.title, p.target?.diskGb, p.target?.reason], ['ollama', 'gemma4:12b', 'Gemma 4 12B', 7.7, 'Better at long answers.']);
    eq(parseInstall('Sure.\n```install\n{"engine":"oll').pending, true);
    eq(parseInstall('Sure.\n```install\n{"engine":"oll').text, 'Sure.');
    eq(parseInstall('No block here.').target, null);
    ok(installInstructions().includes('z-image') || installInstructions().includes('flux2-klein-4b'));
  });
  await test('install block: only installable things get Allow', () => {
    eq(resolveInstall({ engine: 'chat', model: 'llama3.2:3b' }).target?.id, 'llama3.2:3b');
    eq(resolveInstall({ engine: 'ollama', model: 'hf.co/bartowski/Qwen3-8B-GGUF:Q4_K_M' }).target?.id, 'hf.co/bartowski/Qwen3-8B-GGUF:Q4_K_M');
    ok(resolveInstall({ engine: 'ollama', model: 'rm -rf / ; curl x' }).problem);
    eq(resolveInstall({ engine: 'images', model: 'FLUX.2 Klein 4B' }).target?.id, 'flux2-klein-4b');
    ok(/only install the image models it knows/.test(resolveInstall({ engine: 'comfyui', model: 'some-random-checkpoint' }).problem ?? ''));
    eq(resolveInstall({ engine: 'voice', model: 'Kokoro' }).target?.id, 'kokoro');
    eq(resolveInstall({ engine: 'voicebox', model: 'luxtts' }).target?.title, 'luxtts');
    ok(resolveInstall({ engine: 'video', model: 'x' }).problem);
    ok(parseInstall('x\n```install\nnot json\n```').problem);
  });
  await test('allowed chat install pulls through Ollama (on the remote address) and reports progress', async () => {
    localStorage.clear();
    setupJobs.reset();
    setEngineUrl('ollama', '192.168.1.20');
    seen.length = 0;
    route = (u) => (u.endsWith('/api/pull')
      ? new Response(['{"status":"pulling manifest"}', '{"status":"downloading","total":100,"completed":50}', '{"status":"success"}'].join('\n') + '\n', { status: 200 })
      : json({}));
    const t = resolveInstall({ engine: 'ollama', model: 'gemma4:12b' }).target!;
    await installTarget(t);
    ok(seen.some((r) => r.url === 'http://192.168.1.20:11434/api/pull'), JSON.stringify(seen));
    const job = setupJobs.get().find((j) => jobIdsFor(t).includes(j.id));
    eq([job?.status, job?.detail], ['done', 'Ready in Chat']);
  });
  await test('image install refuses remote ComfyUI with a clear reason', async () => {
    localStorage.clear();
    setEngineUrl('comfyui', 'gpu-box.local');
    const t = resolveInstall({ engine: 'comfyui', model: 'flux2-klein-4b' }).target!;
    let msg = '';
    try { await installTarget(t); } catch (e) { msg = (e as Error).message; }
    ok(/another computer/.test(msg), msg);
    eq(jobIdsFor(t).length, (t.pick as { files: unknown[] }).files.length, 'one job per model file');
  });

  console.log(results.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  // Exit explicitly: imported modules keep timers (request timeouts) alive.
  process.exit(fail ? 1 : 0);
}
void main();
