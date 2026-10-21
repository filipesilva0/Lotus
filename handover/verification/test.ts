import { ollamaClient } from '../../src/services/ollamaService';
import { voicebox } from '../../src/services/voicebox';
import { comfy, dimensionsFor } from '../../src/services/comfyService';
import { setEngineUrl } from '../../src/services/engineConfig';
import { encodeWav } from '../../src/lib/audio';
import { EngineError } from '../../src/lib/http';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
for (const id of ['ollama', 'comfyui', 'voicebox'] as const) setEngineUrl(id, 'http://127.0.0.1:18999');

let fails = 0;
const ok = (name: string, cond: boolean, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!cond) fails++; };

// Ollama: stream split across chunks, thinking tokens hidden, exact stats from final chunk
{
  let out = ''; let thinking = ''; let stats: any;
  for await (const t of ollamaClient.streamChat([{ role: 'user', content: 'hi' }], { model: 'm', onThinking: (x) => (thinking += x) }, (s) => (stats = s))) out += t;
  ok('ollama: tokens reassembled across split chunks', out === 'Hello world', JSON.stringify(out));
  ok('ollama: thinking kept out of reply', thinking === 'hmm' && !out.includes('hmm'));
  ok('ollama: exact tokens/sec from eval_count', stats.tokensPerSec === 3 && stats.totalTokens === 3, JSON.stringify(stats));
  ok('ollama: checkHealth + listModels', (await ollamaClient.checkHealth()) && (await ollamaClient.listModels())[0].name === 'llama3.2:3b');
}
// Voicebox: queue → poll → audio blob URL
{
  const g = await voicebox.generate({ profile_id: 'p', text: 'hello', language: 'en' });
  const done = await voicebox.waitFor(g.id);
  ok('voicebox: waitFor polls until completed', done.status === 'completed');
  const url = await voicebox.audioUrl(done.id);
  ok('voicebox: audio becomes an object URL (and is cached)', url.startsWith('blob:') && url === (await voicebox.audioUrl(done.id)));
  ok('voicebox: health', (await voicebox.health()).status === 'ok');
  try { await (voicebox as any).json('/generate/bad'); ok('voicebox: server error surfaces', false); }
  catch (e) { ok('voicebox: server error text surfaced verbatim', e instanceof EngineError && /not downloaded/.test((e as Error).message), (e as Error).message); }
}
// Unreachable engine → helpful message
{
  setEngineUrl('voicebox', 'http://127.0.0.1:1');
  try { await voicebox.health(300); ok('unreachable', false); }
  catch (e) { ok('voicebox: unreachable error says what to do', e instanceof EngineError && (e as EngineError).unreachable && /Start the Voicebox engine/.test((e as Error).message)); }
  setEngineUrl('voicebox', 'http://127.0.0.1:18999');
}
// ComfyUI
{
  ok('comfy: checkpoints', (await comfy.checkpoints()).join() === 'a.safetensors,b.safetensors');
  const r = await comfy.txt2img({ prompt: 'a cat', checkpoint: 'a.safetensors', steps: 20, cfg: 7, width: 512, height: 512, seed: 42 });
  ok('comfy: result image fetched', r.url.startsWith('blob:') && r.seed === 42 && r.promptId === 'p1');
  const sent = await (await fetch('http://127.0.0.1:18999/__lastPrompt')).json();
  ok('comfy: graph wired (ckpt→sampler→decode→save)', sent.prompt['3'].inputs.seed === 42 && sent.prompt['4'].inputs.ckpt_name === 'a.safetensors' && sent.prompt['6'].inputs.text === 'a cat' && sent.prompt['9'].class_type === 'SaveImage');
  ok('comfy: dimensions SDXL vs SD1.5', dimensionsFor('16:9', 'sdxl.safetensors').width === 1344 && dimensionsFor('1:1', 'v1-5-pruned.ckpt').width === 512);
}
// WAV encoder
{
  const samples = new Float32Array([0, 1, -1, 0.5]);
  const wav = encodeWav({ numberOfChannels: 1, length: 4, sampleRate: 16000, getChannelData: () => samples } as any);
  const b = new DataView(await wav.arrayBuffer());
  const tag = (o: number) => String.fromCharCode(b.getUint8(o), b.getUint8(o + 1), b.getUint8(o + 2), b.getUint8(o + 3));
  ok('wav: RIFF/WAVE/fmt/data header', tag(0) === 'RIFF' && tag(8) === 'WAVE' && tag(12) === 'fmt ' && tag(36) === 'data');
  ok('wav: 16kHz mono 16-bit, size right', b.getUint32(24, true) === 16000 && b.getUint16(22, true) === 1 && b.getUint16(34, true) === 16 && wav.size === 44 + 8);
  ok('wav: PCM values clamp correctly', b.getInt16(46, true) === 32767 && b.getInt16(48, true) === -32768);
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
