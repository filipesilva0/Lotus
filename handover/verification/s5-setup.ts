// Session 5 test setup: browser globals that the app modules expect, installed before they load.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
};
(globalThis as any).window = globalThis;
(globalThis as any).document = { hidden: false, getElementById: () => null };
if (!(globalThis as any).performance) (globalThis as any).performance = { now: () => Date.now() };

/** Fake Ollama: answers /api/chat (streamed or not) with `reply(messages, body)`; records requests. */
export const ollama = {
  requests: [] as any[],
  reply: (_msgs: { role: string; content: string }[], _body: any): { content: string; thinking?: string } => ({ content: 'ok' }),
};
(globalThis as any).fetch = async (url: string, init?: RequestInit) => {
  const u = String(url);
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  ollama.requests.push({ url: u, body });
  if (u.endsWith('/api/chat')) {
    const r = ollama.reply(body.messages, body);
    if (body.stream) {
      const words = r.content.split(/(?<=\s)/);
      const lines = [
        ...(r.thinking ? [JSON.stringify({ message: { role: 'assistant', content: '', thinking: r.thinking }, done: false })] : []),
        ...words.map((w) => JSON.stringify({ message: { role: 'assistant', content: w }, done: false })),
        JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, eval_count: words.length, eval_duration: 1e9, prompt_eval_count: 10 }),
      ].join('\n') + '\n';
      return new Response(lines, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
    }
    return new Response(JSON.stringify({ message: { role: 'assistant', content: r.content, thinking: r.thinking }, done: true, prompt_eval_count: 10, eval_count: 5 }), { status: 200 });
  }
  if (u.endsWith('/api/show')) return new Response(JSON.stringify({ capabilities: ['completion'], model_info: {} }), { status: 200 });
  if (u.endsWith('/api/tags')) return new Response(JSON.stringify({ models: [] }), { status: 200 });
  if (u.endsWith('/api/ps')) return new Response(JSON.stringify({ models: [] }), { status: 200 });
  return new Response('not found', { status: 404 });
};
// Session 8: the render smoke now mounts the rail (profile button → account service), which listens for storage events.
if (typeof (globalThis as any).addEventListener !== 'function') { (globalThis as any).addEventListener = () => undefined; (globalThis as any).removeEventListener = () => undefined; }
