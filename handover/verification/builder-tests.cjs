// Model download links and the ComfyUI LoRA graph. Run with: bash handover/verification/run-builder-tests.sh
// (the App Builder tests that used to live here were removed with the App Builder in session 16).
const OUT = process.env.LOTUS_OUT || '/tmp/out';
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.window = global; global.addEventListener = () => {};
const assert = require('assert');
let passed = 0;
const t = async (name, f) => { try { await f(); passed++; console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n    ', String(e.stack).split('\n').slice(0, 4).join('\n     ')); process.exitCode = 1; } };
const mod = (p) => require(`${OUT}/${p}`);
(async () => {
// download links
const D = mod('services/downloadService.js');
await t('normaliseLink', () => {
  assert.deepStrictEqual(D.normaliseLink('https://huggingface.co/user/repo/blob/main/sub/model.safetensors'), { url: 'https://huggingface.co/user/repo/resolve/main/sub/model.safetensors', fileName: 'model.safetensors', host: 'huggingface.co' });
  assert.strictEqual(D.normaliseLink('hf.co/u/r/resolve/main/x.safetensors').url, 'https://huggingface.co/u/r/resolve/main/x.safetensors');
  assert.ok(D.normaliseLink('https://huggingface.co/user/repo').error);
  assert.strictEqual(D.normaliseLink('https://civitai.com/models/123/foo?modelVersionId=456').url, 'https://civitai.com/api/download/models/456');
  assert.strictEqual(D.normaliseLink('https://civitai.com/api/download/models/77?type=Model').url, 'https://civitai.com/api/download/models/77');
  assert.ok(D.normaliseLink('https://civitai.com/models/123').error);
  assert.ok(D.normaliseLink('http://example.com/a.safetensors').error);
  assert.ok(D.normaliseLink('not a link').error);
  assert.strictEqual(D.normaliseLink('https://example.com/dl/My%20Lora.safetensors').fileName, 'My Lora.safetensors');
  assert.strictEqual(D.normaliseLink('https://example.com/file').fileName, '');
});
await t('validFileName', () => { assert.ok(D.validFileName('a.safetensors')); assert.ok(!D.validFileName('a.exe')); assert.ok(!D.validFileName('../a.safetensors')); assert.ok(!D.validFileName('x/a.pt')); assert.ok(!D.validFileName('a:b.pt')); });
await t('folderPath', () => { assert.strictEqual(D.folderPath('C:\\ComfyUI\\models\\', 'loras'), 'C:\\ComfyUI\\models\\loras'); assert.strictEqual(D.folderPath('/a/models', 'checkpoints'), '/a/models/checkpoints'); });

// ── ComfyUI graph with LoRAs
const { comfy } = mod('services/comfyService.js');
const base = { prompt: 'a cat', negativePrompt: 'blurry', checkpoint: 'sd.safetensors', width: 512, height: 512, steps: 20, cfg: 7 };
await t('graph without LoRA is unchanged', () => {
  const g = comfy.buildTxt2ImgGraph(base, 1);
  assert.deepStrictEqual(g['6'].inputs.clip, ['4', 1]); assert.deepStrictEqual(g['3'].inputs.model, ['4', 0]); assert.ok(!g['20']);
});
await t('one LoRA is wired between checkpoint and sampler/encoders', () => {
  const g = comfy.buildTxt2ImgGraph({ ...base, loras: [{ name: 'style.safetensors', strength: 0.8 }] }, 1);
  assert.strictEqual(g['20'].class_type, 'LoraLoader');
  assert.deepStrictEqual(g['20'].inputs, { model: ['4', 0], clip: ['4', 1], lora_name: 'style.safetensors', strength_model: 0.8, strength_clip: 0.8 });
  assert.deepStrictEqual(g['3'].inputs.model, ['20', 0]); assert.deepStrictEqual(g['6'].inputs.clip, ['20', 1]); assert.deepStrictEqual(g['7'].inputs.clip, ['20', 1]);
  assert.deepStrictEqual(g['8'].inputs.vae, ['4', 2]);
});
await t('two LoRAs chain; more than four are capped', () => {
  const g = comfy.buildTxt2ImgGraph({ ...base, loras: [1, 2, 3, 4, 5, 6].map((i) => ({ name: `l${i}.safetensors`, strength: 1 })) }, 1);
  assert.deepStrictEqual(g['21'].inputs.model, ['20', 0]); assert.deepStrictEqual(g['23'].inputs.clip, ['22', 1]); assert.ok(!g['24']);
  assert.deepStrictEqual(g['3'].inputs.model, ['23', 0]);
});


console.log(passed + ' passed'); process.exit(process.exitCode || 0);
})();
