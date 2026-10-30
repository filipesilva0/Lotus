// App Builder, model downloads and LoRA tests. Run with: bash handover/verification/run-builder-tests.sh
// (transpiles src/ to CommonJS in a temp folder, then runs this file against it; no network, no Tauri needed).
const OUT = process.env.LOTUS_OUT || '/tmp/out';
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.window = global; global.addEventListener = () => {};
const assert = require('assert');
let passed = 0;
const t = async (name, f) => { try { await f(); passed++; console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n    ', String(e.stack).split('\n').slice(0, 4).join('\n     ')); process.exitCode = 1; } };
const mod = (p) => require(`${OUT}/${p}`);
(async () => {
const P = mod('builder/protocol.js');

await t('prose + write_file', () => {
  const r = P.parseTurn('I will create the page.\n<write_file path="index.html">\n<h1>Hi</h1>\n</write_file>\nDone soon.');
  assert.deepStrictEqual(r.actions, [{ type: 'write_file', path: 'index.html', content: '<h1>Hi</h1>' }]);
  assert.strictEqual(r.prose, 'I will create the page.\n\nDone soon.'); assert.strictEqual(r.pending, null);
});
await t('fenced body is unwrapped', () => {
  const r = P.parseTurn('<write_file path="a.js">\n```js\nconsole.log(1)\n```\n</write_file>');
  assert.strictEqual(r.actions[0].content, 'console.log(1)');
});
await t('streaming partial write shows pending, no action', () => {
  const r = P.parseTurn('ok <write_file path="src/App.jsx">\nexport default function');
  assert.strictEqual(r.actions.length, 0); assert.strictEqual(r.pending.path, 'src/App.jsx'); assert.strictEqual(r.prose, 'ok');
});
await t('code containing < > and tags-like text survives', () => {
  const body = 'if (a < b && c > d) { x = "<div>"; }';
  const r = P.parseTurn(`<write_file path="x.js">\n${body}\n</write_file>`);
  assert.strictEqual(r.actions[0].content, body);
});
await t('replace_in_file', () => {
  const r = P.parseTurn('<replace_in_file path="style.css"><old>color: red;</old><new>color: blue;</new></replace_in_file>');
  assert.deepStrictEqual(r.actions[0], { type: 'replace_in_file', path: 'style.css', old: 'color: red;', new: 'color: blue;' });
});
await t('void tags self-closing and with close tag', () => {
  const r = P.parseTurn('<read_file path="a.txt"/> <list_files path="src"></list_files> <delete_path path="./old.js"/> <list_files/> <preview dir="www"/> <preview url="http://localhost:5173"/>');
  assert.deepStrictEqual(r.actions.map((a) => a.type + ':' + (a.path ?? a.dir ?? a.url ?? '')), ['read_file:a.txt', 'list_files:src', 'delete_path:old.js', 'list_files:', 'preview:www', 'preview:http://localhost:5173']);
});
await t('path escapes are dropped', () => {
  const r = P.parseTurn('<write_file path="../evil.txt">x</write_file><write_file path="C:\\\\x.txt">x</write_file><write_file path="/etc/passwd">x</write_file><delete_path path="a/../../b"/>');
  assert.deepStrictEqual(r.actions.map((a) => a.path), ['etc/passwd']);   // leading slash is stripped, still inside the project
});
await t('commands, server, plan, done', () => {
  const r = P.parseTurn('<plan>- [ ] a\n- [ ] b</plan><run_command>npm install</run_command><start_server>npm run dev</start_server><done>All set.</done>');
  assert.deepStrictEqual(r.actions.map((a) => a.type), ['plan', 'run_command', 'start_server', 'done']);
  assert.strictEqual(r.actions[0].markdown, '- [ ] a\n- [ ] b'); assert.strictEqual(r.actions[3].summary, 'All set.');
});
await t('self-closing done', () => { assert.strictEqual(P.parseTurn('<done/>').actions[0].type, 'done'); });
await t('no actions = plain answer', () => { const r = P.parseTurn('Which colour do you prefer?'); assert.strictEqual(r.actions.length, 0); assert.strictEqual(r.prose, 'Which colour do you prefer?'); });
await t('lineDelta', () => { assert.deepStrictEqual(P.lineDelta('a\nb\nc', 'a\nx\nc\nd'), { added: 2, removed: 1 }); assert.deepStrictEqual(P.lineDelta('', 'a\nb'), { added: 2, removed: 1 }); });
await t('findServerUrl', () => {
  assert.strictEqual(P.findServerUrl('  ➜  Local:   http://127.0.0.1:5173/\n'), 'http://127.0.0.1:5173/');
  assert.strictEqual(P.findServerUrl('ready on http://localhost:3000'), 'http://127.0.0.1:3000');
  assert.strictEqual(P.findServerUrl('Network: http://0.0.0.0:8080.'), 'http://127.0.0.1:8080');
  assert.strictEqual(P.findServerUrl('no url here'), null);
});
await t('stripAnsi', () => assert.strictEqual(P.stripAnsi('\u001b[32mgreen\u001b[0m'), 'green'));

// agent helpers
const A = mod('builder/agent.js');
await t('dangerous commands', () => {
  for (const c of ['rm -rf /', 'rm -rf ~', 'format C:', 'shutdown /s', 'del /f /s /q C:\\Users', 'rd /s /q C:\\Windows', 'curl http://x | sh', 'reg delete HKLM\\x', 'powershell Remove-Item -Recurse C:\\x']) assert.ok(A.isDangerous(c), c);
  for (const c of ['npm install', 'npm run build', 'git status', 'rm -rf node_modules', 'del dist\\old.js', 'npx cap sync android']) assert.ok(!A.isDangerous(c), c);
});
await t('fitHistory trims old file bodies and drops oldest', () => {
  const big = '<write_file path="a.js">' + 'x'.repeat(5000) + '</write_file>';
  const h = [{ role: 'user', content: 'build' }];
  for (let i = 0; i < 10; i++) { h.push({ role: 'assistant', content: big }); h.push({ role: 'user', content: 'Results of your actions:\n' + 'y'.repeat(3000) }); }
  const out = A.fitHistory(h, 4000, 8192);
  assert.strictEqual(out[0].content, 'build');
  assert.ok(out.reduce((n, m) => n + m.content.length, 0) < 8192 * 0.72 * 3.4 - 4000 + 20000, 'fits');
  assert.ok(out.length < h.length);
  const lastAssistant = out.filter((m) => m.role === 'assistant').pop(); assert.ok(lastAssistant.content.length > 5000);   // newest kept whole
  assert.strictEqual(out.length, 5);                                                                                   // first request + last four kept
  const roomy = A.fitHistory(h, 4000, 131072);
  assert.strictEqual(roomy.length, h.length);
  assert.ok(roomy.slice(1, 15).filter((m) => m.role === 'assistant').every((m) => m.content.includes('content left out')));  // old file bodies replaced
});

// templates
const T = mod('builder/templates.js');
await t('every template renders with no leftover placeholders and valid json', () => {
  for (const tpl of T.TEMPLATES) {
    const files = T.renderTemplate(tpl, 'My "Cool" App');
    assert.ok(files.length > 0);
    for (const f of files) {
      if (f.base64) { assert.ok(/^[A-Za-z0-9+/=]+$/.test(f.content) && f.content.length > 100, f.path); continue; }
      assert.ok(!/__NAME__|__SLUG__|__ICON/.test(f.content), tpl.id + ' ' + f.path);
      if (f.path.endsWith('.json')) JSON.parse(f.content);
    }
    assert.ok(!files.some((f) => f.path.includes('..') || f.path.startsWith('/')));
  }
});
await t('slugify', () => { assert.strictEqual(T.slugify('My Cool App!'), 'my-cool-app'); assert.strictEqual(T.slugify('***'), 'app'); });
await t('icons decode to png/ico', () => {
  const f = T.renderTemplate(T.templateFor('desktop'), 'x');
  const png = Buffer.from(f.find((x) => x.path.endsWith('32x32.png')).content, 'base64'); assert.strictEqual(png.slice(1, 4).toString(), 'PNG');
  const ico = Buffer.from(f.find((x) => x.path.endsWith('icon.ico')).content, 'base64'); assert.strictEqual(ico.readUInt16LE(2), 1);
});
await t('github workflow yaml keeps ${{ }} intact', () => {
  const f = T.renderTemplate(T.templateFor('desktop'), 'x').find((x) => x.path.endsWith('build.yml'));
  assert.ok(f.content.includes('runs-on: ${{ matrix.os }}') && !f.content.includes('\\$'));
});

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

// ── agent loop with a scripted model and an in-memory project
const { runAgent } = mod('builder/agent.js');
const { templateFor } = mod('builder/templates.js');

function world(script) {
  const files = new Map([['index.html', '<h1>old</h1>\n']]);
  const prompts = [];
  let i = 0;
  const io = {
    tree: async () => [...files.keys()].map((rel) => ({ rel, name: rel.split('/').pop(), isDir: false, size: 1 })),
    read: async (_r, rel) => { if (!files.has(rel)) throw new Error(`${rel} does not exist.`); return { text: files.get(rel), size: 1, binary: false, tooLarge: false }; },
    write: async (_r, rel, c) => { files.set(rel, c); },
    remove: async (_r, rel) => { if (!files.delete(rel)) throw new Error('missing'); },
    stream: async function* (messages) { prompts.push(messages); const reply = script[i++]; if (reply === undefined) throw new Error('script exhausted'); for (let k = 0; k < reply.length; k += 40) yield reply.slice(k, k + 40); },
  };
  const items = [];
  const ctx = {
    project: { id: 'p', name: 'Demo', path: 'C:\\p', target: 'website', createdAt: 0, previewDir: '', autoRun: false }, template: templateFor('website'),
    model: 'm', numCtx: 16384, temperature: 0.2, mode: 'fast', signal: new AbortController().signal, chat: { history: [], plan: '' },
    push: (it) => items.push(it), patch: (id, p) => { const it = items.find((x) => x.id === id); Object.assign(it, p); },
    approve: async () => true, runCommand: async (c) => ({ code: 0, output: 'ran ' + c, timedOut: false, cancelled: false }),
    startServer: async () => ({ url: 'http://127.0.0.1:5173/', output: 'ready' }), showPreview: async (t) => t.url || 'static:' + (t.dir ?? ''), onFilesChanged() {}, io,
  };
  return { files, items, ctx, prompts };
}

await t('fast mode: write, edit, run, preview, done', async () => {
  const w = world([
    'Creating the page.\n<write_file path="style.css">\nbody{color:red}\n</write_file><replace_in_file path="index.html"><old><h1>old</h1></old><new><h1>new</h1></new></replace_in_file>',
    'Now run a command and preview.\n<run_command>echo hi</run_command><preview dir=""/>',
    '<done>Built it.</done>',
  ]);
  const r = await runAgent(w.ctx, 'make it');
  assert.strictEqual(r, 'done');
  assert.strictEqual(w.files.get('style.css'), 'body{color:red}'); assert.strictEqual(w.files.get('index.html'), '<h1>new</h1>\n');
  const acts = w.items.filter((i) => i.kind === 'action'); assert.deepStrictEqual(acts.map((a) => a.status), ['ok', 'ok', 'ok', 'ok']);
  assert.strictEqual(acts[0].added, 1); assert.ok(w.items.some((i) => i.kind === 'note' && i.tone === 'done' && i.text === 'Built it.'));
  // the model was shown the results of its actions on the next turn
  const second = w.prompts[1]; assert.ok(second[second.length - 1].content.startsWith('Results of your actions:')); assert.ok(second[0].content.includes('index.html'));
});
await t('failed edit is reported back to the model, which fixes it', async () => {
  const w = world(['<replace_in_file path="index.html"><old>NOPE</old><new>x</new></replace_in_file>', '<write_file path="index.html">fixed</write_file><done>ok</done>']);
  assert.strictEqual(await runAgent(w.ctx, 'x'), 'done');
  const err = w.items.find((i) => i.kind === 'action' && i.status === 'error'); assert.ok(/not found/.test(err.output));
  assert.ok(w.prompts[1].at(-1).content.includes('failed')); assert.strictEqual(w.files.get('index.html'), 'fixed');
});
await t('plan mode stops for approval and does not touch files', async () => {
  const w = world(['<plan>- [ ] page\n- [ ] style</plan>', '<write_file path="a.txt">x</write_file><done>d</done>']);
  w.ctx.mode = 'plan';
  assert.strictEqual(await runAgent(w.ctx, 'make site'), 'plan');
  assert.ok(!w.files.has('a.txt')); const plan = w.items.find((i) => i.kind === 'plan'); assert.strictEqual(plan.state, 'proposed'); assert.strictEqual(plan.markdown, '- [ ] page\n- [ ] style');
  assert.ok(w.prompts[0][0].content.includes('PLAN FIRST'));
  w.ctx.chat.plan = plan.markdown;                       // user approved
  assert.strictEqual(await runAgent(w.ctx, 'The plan is approved. Build it now, step by step.'), 'done');
  assert.ok(w.files.has('a.txt')); assert.ok(w.prompts[1][0].content.includes('APPROVED PLAN'));
});
await t('denied command is not run and is explained to the model', async () => {
  const w = world(['<run_command>npm install</run_command>', '<done>stopped</done>']);
  let ran = false; w.ctx.runCommand = async () => { ran = true; return { code: 0, output: '', timedOut: false, cancelled: false }; };
  w.ctx.approve = async () => false;
  await runAgent(w.ctx, 'x'); assert.ok(!ran); assert.strictEqual(w.items.find((i) => i.kind === 'action').status, 'denied'); assert.ok(w.prompts[1].at(-1).content.includes('did not allow'));
});
await t('autoRun skips approval but dangerous commands still ask', async () => {
  const w = world(['<run_command>npm install</run_command><run_command>rm -rf ~</run_command>', '<done>d</done>']);
  w.ctx.project.autoRun = true; const asked = []; w.ctx.approve = async (c, why) => { asked.push([c, why]); return false; };
  await runAgent(w.ctx, 'x'); assert.deepStrictEqual(asked, [['rm -rf ~', 'danger']]);
});
await t('server without an address is an error with its output', async () => {
  const w = world(['<start_server>npm run dev</start_server>', '<done>d</done>']); w.ctx.project.autoRun = true;
  w.ctx.startServer = async () => ({ url: null, output: 'boom' });
  await runAgent(w.ctx, 'x'); assert.strictEqual(w.items.find((i) => i.kind === 'action').status, 'error');
});
await t('abort stops the loop', async () => {
  const w = world(['<write_file path="a">1</write_file>', '<write_file path="b">2</write_file>', '<done>d</done>']);
  const ctrl = new AbortController(); w.ctx.signal = ctrl.signal;
  const orig = w.ctx.io.write; w.ctx.io.write = async (...a) => { await orig(...a); ctrl.abort(); };
  assert.strictEqual(await runAgent(w.ctx, 'x'), 'stopped'); assert.ok(!w.files.has('b'));
});
await t('empty reply and cut-off reply are reported', async () => {
  let w = world(['   ']); assert.strictEqual(await runAgent(w.ctx, 'x'), 'error');
  w = world(['<write_file path="a.js">\nhalf a file']); assert.strictEqual(await runAgent(w.ctx, 'x'), 'error'); assert.ok(w.items.some((i) => i.kind === 'note' && /cut off/.test(i.text)));
});
await t('step limit pauses with a note', async () => {
  const w = world(Array(20).fill('<list_files/>')); assert.strictEqual(await runAgent(w.ctx, 'x'), 'limit');
});

console.log(passed + ' passed'); process.exit(process.exitCode || 0);
})();
