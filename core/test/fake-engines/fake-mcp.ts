export {};
// A tiny stdio MCP server for tests: one tool, "add_numbers", plus "fail".
const dec = new TextDecoder();
let buf = '';
const send = (m: unknown) => process.stdout.write(`${JSON.stringify(m)}\n`);
console.log('a log line that is not JSON');
for await (const chunk of Bun.stdin.stream()) {
  buf += dec.decode(chunk);
  let nl: number;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } } });
    else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: [
      { name: 'add_numbers', description: 'Adds two numbers.', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' }, opts: { type: 'object', description: 'Options' } }, required: ['a', 'b'] } },
      { name: 'fail', description: 'Always fails.', inputSchema: { type: 'object', properties: {} } },
    ] } });
    else if (m.method === 'tools/call') {
      if (m.params.name === 'fail') send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'nope' }], isError: true } });
      else send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `sum=${m.params.arguments.a + m.params.arguments.b} opts=${JSON.stringify(m.params.arguments.opts ?? null)}` }] } });
    } else if (m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'no' } });
  }
}
