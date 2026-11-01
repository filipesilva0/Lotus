// Session 10 tests: first-run setup data and flow logic, ComfyUI recipes for the recommended image
// models, the macOS menu helpers, and the island default. Run: bash handover/verification/run-s10-tests.sh
import './s5-setup';
import './s7-setup';
import {
  CHAT_PICKS, IMAGE_PICKS, VOICE_PICKS, DICTATION_PICK, ENGINES, fitFor, imageFilesFor, installerFor, isComfyDesktopPath,
  matchVoiceModel, recipeFor, selectionGb, suggestedTier, afterOpenHint,
} from '../../src/setup/catalog';
import { enginesToInstall, initialEngines, loadSetup, saveSetup, visibleSteps, SETUP_KEY } from '../../src/setup/state';
import { menuSignature, tidySeparators, toAccelerator, macShortcut } from '../../src/lib/nativeMenu';
import { comfy, dimensionsFor } from '../../src/services/comfyService';
import { loadIsland } from '../../src/island/state';

let pass = 0, fail = 0;
const results: string[] = [];
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); pass++; results.push(`  ✓ ${name}`); }
  catch (e) { fail++; results.push(`  ✗ ${name}\n      ${(e as Error).stack?.split('\n').slice(0, 3).join('\n      ')}`); }
}
function eq(a: unknown, b: unknown, msg = '') { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error(`${msg} expected ${B}, got ${A}`); }
function ok(v: unknown, msg = 'expected truthy') { if (!v) throw new Error(msg); }

type Node = { class_type: string; inputs: Record<string, unknown> };
const graph = (checkpoint: string) => comfy.buildTxt2ImgGraph({ prompt: 'a lotus', checkpoint, steps: 30, cfg: 7, width: 1024, height: 1024 }, 42) as unknown as Record<string, Node>;
const refsResolve = (g: Record<string, Node>) => Object.values(g).every((n) => Object.values(n.inputs).every((v) => !Array.isArray(v) || typeof v[0] !== 'string' || v[0] in g));

async function main() {
  // ── Engine installers ──────────────────────────────────────────────────
  await test('installers: Ollama per OS and arch, from its GitHub releases', () => {
    eq(installerFor('ollama', 'windows', 'x86_64')?.fileName, 'OllamaSetup.exe');
    eq(installerFor('ollama', 'macos', 'aarch64')?.url, 'https://github.com/ollama/ollama/releases/latest/download/Ollama.dmg');
    eq(installerFor('ollama', 'linux', 'x86_64')?.fileName, 'ollama-linux-amd64.tar.zst');
    eq(installerFor('ollama', 'linux', 'aarch64')?.fileName, 'ollama-linux-arm64.tar.zst');
  });
  await test('installers: ComfyUI Desktop where it exists (no Intel Mac, no ARM Linux build)', () => {
    ok(installerFor('comfyui', 'windows', 'x86_64')?.url.startsWith('https://download.comfy.org/'));
    ok(installerFor('comfyui', 'macos', 'aarch64'));
    eq(installerFor('comfyui', 'macos', 'x86_64'), null);
    ok(installerFor('comfyui', 'linux', 'x86_64')?.fileName.endsWith('.AppImage'));
    eq(installerFor('comfyui', 'linux', 'aarch64'), null);
  });
  await test('installers: Voicebox needs a version from its manifest and has no Linux build', () => {
    eq(installerFor('voicebox', 'windows', 'x86_64'), null, 'no version');
    eq(installerFor('voicebox', 'windows', 'x86_64', 'v0.5.0')?.url, 'https://github.com/jamiepine/voicebox/releases/download/v0.5.0/Voicebox_0.5.0_x64-setup.exe');
    eq(installerFor('voicebox', 'macos', 'aarch64', '0.5.0')?.fileName, 'Voicebox_0.5.0_aarch64.dmg');
    eq(installerFor('voicebox', 'macos', 'x86_64', '0.5.0')?.fileName, 'Voicebox_0.5.0_x64.dmg');
    eq(installerFor('voicebox', 'linux', 'x86_64', '0.5.0'), null);
    eq(installerFor('voicebox', 'windows', 'x86_64', 'nonsense'), null);
    ok(ENGINES.voicebox.note.linux, 'Linux users are told why');
  });
  await test('installers: every link is https on a host the Rust side allows', () => {
    const allowed = ['github.com', 'ollama.com', 'download.comfy.org', 'dl.todesktop.com', 'comfy.org'];
    for (const id of ['ollama', 'comfyui', 'voicebox'] as const) for (const os of ['windows', 'macos', 'linux'] as const) for (const a of ['x86_64', 'aarch64'] as const) {
      const f = installerFor(id, os, a, '0.5.0');
      if (!f) continue;
      const host = new URL(f.url).hostname;
      ok(f.url.startsWith('https://') && allowed.some((h) => host === h || host.endsWith(`.${h}`)), `${id}/${os}/${a}: ${f.url}`);
    }
  });
  await test('ComfyUI Desktop paths are recognised (port 8000), a manual install is not', () => {
    ok(isComfyDesktopPath('C:\\Users\\a\\AppData\\Local\\Programs\\@comfyorgcomfyui-electron\\ComfyUI.exe'));
    ok(isComfyDesktopPath('/Applications/ComfyUI.app/Contents/MacOS/ComfyUI'));
    ok(isComfyDesktopPath('/home/a/Documents/Lotus Studio/Engines/comfyui/ComfyUI-Desktop-x86_64.AppImage'));
    ok(!isComfyDesktopPath('C:\\ComfyUI_windows_portable\\run_nvidia_gpu.bat'));
  });
  await test('after-open hints name the right action per OS', () => {
    ok(/Applications/.test(afterOpenHint('ollama', 'macos')));
    ok(/installer/.test(afterOpenHint('comfyui', 'windows')));
  });

  // ── Recommended models ─────────────────────────────────────────────────
  await test('picks: three tiers per engine, every chat pick reads images', () => {
    for (const list of [CHAT_PICKS, IMAGE_PICKS, VOICE_PICKS]) eq(list.map((p) => p.tier), ['quick', 'balanced', 'best']);
    ok(CHAT_PICKS.every((p) => p.vision && /^[a-z0-9.-]+:[a-z0-9.-]+$/.test(p.tag)));
    ok(CHAT_PICKS[0].vramGb < CHAT_PICKS[1].vramGb && CHAT_PICKS[1].vramGb < CHAT_PICKS[2].vramGb, 'tiers grow');
  });
  await test('fit: 12 GB GPU fits Balanced chat, not Best; unknown GPU is unknown', () => {
    eq(fitFor(CHAT_PICKS[1], 12), 'fits');
    eq(fitFor(CHAT_PICKS[2], 12), 'too-big');
    eq(fitFor(CHAT_PICKS[2], 22), 'tight');
    eq(fitFor(CHAT_PICKS[1], undefined), 'unknown');
    eq(fitFor(VOICE_PICKS[0], undefined), 'fits', 'tiny CPU models always fit');
  });
  await test('suggested tier follows the GPU (and a quarter of Mac memory is kept for macOS)', () => {
    eq(suggestedTier(CHAT_PICKS, 6), 'quick');
    eq(suggestedTier(CHAT_PICKS, 12), 'balanced');
    eq(suggestedTier(CHAT_PICKS, 32), 'best');
    eq(suggestedTier(CHAT_PICKS, 32, true), 'balanced', '22 GB model on a 32 GB Mac leaves too little');
    eq(suggestedTier(CHAT_PICKS, 48, true), 'best');
    eq(suggestedTier(CHAT_PICKS, 16, true), 'balanced');
    eq(suggestedTier(IMAGE_PICKS, 12), 'quick');
    eq(suggestedTier(CHAT_PICKS, undefined), 'quick');
  });
  await test('image files: shared text encoder downloaded once; sizes add up once', () => {
    const files = imageFilesFor([IMAGE_PICKS[0], IMAGE_PICKS[1]]);
    eq(files.filter((f) => f.fileName === 'qwen_3_4b.safetensors').length, 1);
    eq(files.length, 5);
    ok(files.every((f) => f.url.startsWith('https://huggingface.co/') && f.url.includes('/resolve/')));
    eq(selectionGb([IMAGE_PICKS[0], IMAGE_PICKS[1]]), Math.round(files.reduce((s, f) => s + f.gb, 0) * 10) / 10);
    eq(selectionGb([CHAT_PICKS[0], DICTATION_PICK]), Math.round((CHAT_PICKS[0].diskGb + DICTATION_PICK.diskGb) * 10) / 10);
  });
  await test('voice picks are matched against whatever names Voicebox reports', () => {
    const models = [
      { model_name: 'kokoro-82m', display_name: 'Kokoro 82M' },
      { model_name: 'chatterbox_turbo', display_name: 'Chatterbox Turbo' },
      { model_name: 'qwen-tts-1.7B', display_name: 'Qwen3-TTS 1.7B' },
      { model_name: 'qwen-tts-0.6B', display_name: 'Qwen3-TTS 0.6B' },
      { model_name: 'whisper-turbo', display_name: 'Whisper Turbo' },
    ];
    eq(matchVoiceModel(VOICE_PICKS[0], models)?.model_name, 'kokoro-82m');
    eq(matchVoiceModel(VOICE_PICKS[1], models)?.model_name, 'chatterbox_turbo');
    eq(matchVoiceModel(VOICE_PICKS[2], models)?.model_name, 'qwen-tts-1.7B', 'not the 0.6B one');
    eq(matchVoiceModel(DICTATION_PICK, models)?.model_name, 'whisper-turbo');
    eq(matchVoiceModel(VOICE_PICKS[1], [{ model_name: 'chatterbox', display_name: 'Chatterbox' }]), undefined, 'plain Chatterbox is not Turbo');
  });

  // ── ComfyUI graphs for the recommended image models ────────────────────
  await test('recipes: only the recommended diffusion models have one', () => {
    eq(recipeFor('z_image_turbo_bf16.safetensors')?.clipType, 'lumina2');
    eq(recipeFor('subdir/qwen_image_fp8_e4m3fn.safetensors')?.clipType, 'qwen_image');
    eq(recipeFor('sd_xl_base_1.0.safetensors'), undefined);
  });
  await test('graph: a classic checkpoint still uses CheckpointLoaderSimple unchanged', () => {
    const g = graph('sd_xl_base_1.0.safetensors');
    eq(g['4'].class_type, 'CheckpointLoaderSimple');
    eq(g['3'].inputs.steps, 30); eq(g['3'].inputs.cfg, 7);
    eq(g['5'].class_type, 'EmptyLatentImage');
    eq(g['8'].inputs.vae, ['4', 2]);
    ok(refsResolve(g));
  });
  await test('graph: Z-Image Turbo matches ComfyUI\'s template (UNET + CLIP lumina2 + AuraFlow shift 3, 8 steps, cfg 1)', () => {
    const g = graph('z_image_turbo_bf16.safetensors');
    eq(g['4'].class_type, 'UNETLoader'); eq(g['40'].inputs.type, 'lumina2'); eq(g['41'].inputs.vae_name, 'ae.safetensors');
    eq(g['42'].class_type, 'ModelSamplingAuraFlow'); eq(g['42'].inputs.shift, 3);
    eq(g['3'].inputs.model, ['42', 0]);
    eq([g['3'].inputs.steps, g['3'].inputs.cfg, g['3'].inputs.sampler_name, g['3'].inputs.scheduler], [8, 1, 'res_multistep', 'simple']);
    eq(g['7'].class_type, 'ConditioningZeroOut');
    eq(g['5'].class_type, 'EmptySD3LatentImage');
    eq(g['8'].inputs.vae, ['41', 0]);
    ok(refsResolve(g));
  });
  await test('graph: FLUX.2 Klein uses the custom sampler chain (4 steps, cfg 1)', () => {
    const g = graph('flux-2-klein-4b.safetensors');
    eq(g['40'].inputs.type, 'flux2');
    eq(g['3'].class_type, 'SamplerCustomAdvanced');
    eq(g['32'].class_type, 'Flux2Scheduler'); eq(g['32'].inputs.steps, 4);
    eq(g['33'].inputs.cfg, 1); eq(g['30'].inputs.noise_seed, 42);
    eq(g['5'].class_type, 'EmptyFlux2LatentImage');
    ok(!('42' in g), 'no AuraFlow node');
    ok(refsResolve(g));
  });
  await test('graph: Qwen-Image keeps a real negative prompt and a 1328 px base size', () => {
    const g = graph('qwen_image_fp8_e4m3fn.safetensors');
    eq(g['7'].class_type, 'CLIPTextEncode');
    eq(g['42'].inputs.shift, 3.1);
    eq(dimensionsFor('1:1', 'qwen_image_fp8_e4m3fn.safetensors'), { width: 1344, height: 1344 });
    eq(dimensionsFor('1:1', 'sd_xl_base_1.0.safetensors'), { width: 1024, height: 1024 });
    ok(refsResolve(g));
  });

  // ── Guide flow ─────────────────────────────────────────────────────────
  await test('steps: one screen per model engine, Install only when needed', () => {
    eq(visibleSteps(false), ['welcome', 'folder', 'engines', 'done']);
    eq(visibleSteps(true, ['ollama', 'voicebox']), ['welcome', 'folder', 'engines', 'install', 'chat', 'voice', 'done']);
    eq(visibleSteps(false, ['comfyui']), ['welcome', 'folder', 'engines', 'images', 'done']);
  });
  await test('engines to install skip what is already found', () => {
    eq(enginesToInstall({ ollama: true, comfyui: true, voicebox: false }, { ollama: 'C:\\o.exe' }), ['comfyui']);
  });
  await test('initial toggles: the MSI choice wins; otherwise Ollama plus anything found', () => {
    eq(initialEngines({ ollama: false, comfyui: true, voicebox: false }, {}), { ollama: false, comfyui: true, voicebox: false });
    eq(initialEngines(null, { voicebox: '/x' }), { ollama: true, comfyui: false, voicebox: true });
  });
  await test('setup state: fresh install shows the guide; older installs with chats do not', () => {
    localStorage.clear();
    eq(loadSetup().done, false);
    // Session 12: only chats with messages count as "used before" (an empty New chat is saved on first load).
    localStorage.setItem('lotus.sessions.v1', JSON.stringify([{ id: 'c1', title: 'Hi', messages: [{ id: 'm', role: 'user', content: 'hi' }] }]));
    eq(loadSetup().done, true);
    localStorage.clear();
    saveSetup({ done: true, outcome: 'skipped' });
    eq(JSON.parse(localStorage.getItem(SETUP_KEY)!).outcome, 'skipped');
    eq(loadSetup().done, true);
  });

  // ── macOS menu bar helpers + island default ────────────────────────────
  await test('menus: accelerators use Cmd on macOS, separators are tidied, signature tracks ticks', () => {
    eq(toAccelerator('Ctrl+Alt+S'), 'CmdOrCtrl+Alt+S');
    eq(toAccelerator('Alt+Left'), 'Alt+Left');
    eq(macShortcut('Ctrl+N'), '⌘N');
    eq(tidySeparators(['separator', 'a', 'separator', 'separator', 'b', 'separator']), ['a', 'separator', 'b']);
    const m = (checked: boolean) => [{ label: 'View', items: [{ label: 'Dark', checked, onSelect: () => undefined }] }];
    ok(menuSignature(m(true)) !== menuSignature(m(false)));
  });
  await test('island starts switched off on every OS', () => {
    localStorage.clear();
    eq(loadIsland().enabled, false);
  });

  console.log(results.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
void main();
