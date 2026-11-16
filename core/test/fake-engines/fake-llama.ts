// A stand-in for llama-server in tests: /health, and /v1/chat/completions streaming one tool call
// when tools are offered and the last message is the user's, else a plain reply. Writes each request
// body to $FAKE_LOG (one JSON per line) so tests can check what Lotus sent.
import { appendFileSync } from 'node:fs';
const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const port = Number(arg('--port'));
const log = process.env.FAKE_LOG;
let loaded = false;
setTimeout(() => { loaded = true; }, 300);
Bun.serve({
  hostname: '127.0.0.1', port,
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === '/health') return loaded ? Response.json({ status: 'ok' }) : Response.json({ error: { code: 503, message: 'Loading model' } }, { status: 503 });
    if (u.pathname !== '/v1/chat/completions') return new Response('nf', { status: 404 });
    const body = await req.json() as { messages: { role: string; content: unknown }[]; tools?: unknown[] };
    if (log) appendFileSync(log, `${JSON.stringify({ argv: process.argv.slice(2), body })}\n`);
    const last = body.messages[body.messages.length - 1];
    const enc = new TextEncoder();
    const chunks: unknown[] = [];
    if (body.tools?.length && last.role === 'user') {
      chunks.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'x', function: { name: 'task_add', arguments: '{"title":"Buy ' } }] } }] });
      chunks.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'milk"}' } }] } }] });
    } else chunks.push({ choices: [{ delta: { content: last.role === 'tool' ? 'I added the task “Buy milk”.' : 'Hello from the built-in engine.' } }] });
    const stream = new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify(ch)}\n\n`)); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close(); } });
    return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
  },
});
