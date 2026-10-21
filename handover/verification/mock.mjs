import http from 'node:http';
let polls = 0, cpolls = 0;
const srv = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const body = await new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
  const json = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  // ---- Ollama
  if (url.pathname === '/api/chat') {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    const lines = [
      { message: { thinking: 'hmm' } }, { message: { content: 'Hel' } }, { message: { content: 'lo' } },
      { message: { content: ' world' } }, { done: true, eval_count: 3, eval_duration: 1e9, total_duration: 2e9 },
    ].map((o) => JSON.stringify(o) + '\n').join('');
    // split in awkward places, including mid-JSON
    const cuts = [7, 31, 60, lines.length];
    let prev = 0; for (const c of cuts) { res.write(lines.slice(prev, c)); prev = c; await new Promise((r) => setTimeout(r, 15)); }
    return res.end();
  }
  if (url.pathname === '/api/tags') return json({ models: [{ name: 'llama3.2:3b', size: 2e9, details: { parameter_size: '3B' } }] });
  // ---- Voicebox
  if (url.pathname === '/health') return json({ status: 'ok', model_loaded: false, gpu_available: true });
  if (url.pathname === '/generate') { const b = JSON.parse(body); return json({ id: 'g1', status: 'generating', text: b.text, profile_id: b.profile_id, language: b.language }); }
  if (url.pathname === '/history/g1') { polls++; return json({ id: 'g1', status: polls < 3 ? 'generating' : 'completed', duration: 1.5 }); }
  if (url.pathname === '/audio/g1') { res.writeHead(200, { 'Content-Type': 'audio/wav' }); return res.end(Buffer.from('RIFFfake')); }
  if (url.pathname === '/generate/bad') return json({ detail: 'Model qwen-tts-1.7B is not downloaded' }, 400);
  // ---- ComfyUI
  if (url.pathname === '/prompt') { const b = JSON.parse(body); globalThis.lastPrompt = b; return json({ prompt_id: 'p1' }); }
  if (url.pathname === '/history/p1') { cpolls++; return json(cpolls < 3 ? {} : { p1: { status: { status_str: 'success' }, outputs: { 9: { images: [{ filename: 'tomo_0001.png', subfolder: '', type: 'output' }] } } } }); }
  if (url.pathname === '/view') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(Buffer.from('PNGfake')); }
  if (url.pathname === '/object_info/CheckpointLoaderSimple') return json({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [['a.safetensors', 'b.safetensors']] } } } });
  if (url.pathname === '/__lastPrompt') return json(globalThis.lastPrompt);
  json({ detail: 'nope' }, 404);
});
srv.listen(18999, () => console.log('mock up'));
