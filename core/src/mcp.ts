// MCP tool servers (Advanced mode, 0.18.0). A server is either a program Lotus starts (stdio: one JSON-RPC
// message per line) or a web address (Streamable HTTP: JSON-RPC over POST, answered as JSON or as an
// event stream). Its tools join the agent's as `mcp.<server>_<tool>`, and every call asks first by default
// (risk "risky"): these are programs Lotus didn't write.
//
// The list lives in kv `lotus.mcp.v1`: [{ id, name, command, args, env, url, headers, enabled }].
// Servers start on first use and stay up while the core runs; editing the list restarts them.

import type { Subprocess } from 'bun';
import type { JsonSchema, Tool, ToolResult } from './agent/types';

export const MCP_KEY = 'lotus.mcp.v1';
const PROTOCOL = '2025-06-18';
const CALL_TIMEOUT = 120_000;
const START_TIMEOUT = 30_000;

export interface McpServerConfig {
  id: string;
  name: string;
  /** stdio: the program and its arguments. */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** Streamable HTTP: the server's address, and headers such as Authorization. */
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export interface McpToolInfo { name: string; description?: string; inputSchema?: { type?: string; properties?: Record<string, Record<string, unknown>>; required?: string[] } }

export interface McpServerStatus { id: string; name: string; enabled: boolean; state: 'off' | 'starting' | 'ready' | 'error'; tools: string[]; error?: string }

type Rpc = { jsonrpc: '2.0'; id?: number; method?: string; params?: unknown; result?: unknown; error?: { code: number; message: string } };

/** One connection: send a request, get its answer. */
interface Transport {
  request(method: string, params: unknown, timeoutMs: number): Promise<unknown>;
  notify(method: string, params?: unknown): Promise<void>;
  close(): void;
}

// ── stdio ──────────────────────────────────────────────────────────────────

class StdioTransport implements Transport {
  private proc: Subprocess<'pipe', 'pipe', 'pipe'>;
  private nextId = 1;
  private pending = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void }>();
  private stderr = '';
  private closed = false;

  constructor(cfg: McpServerConfig, private log: (m: string) => void) {
    const cmd = [cfg.command!, ...(cfg.args ?? [])];
    // Windows: npx, uvx and friends are .cmd files, which only the shell runs.
    const argv = process.platform === 'win32' && !/\.exe$/i.test(cfg.command!) ? ['cmd.exe', '/d', '/s', '/c', ...cmd] : cmd;
    this.proc = Bun.spawn(argv, { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...(cfg.env ?? {}) }, windowsHide: true } as Parameters<typeof Bun.spawn>[1]) as Subprocess<'pipe', 'pipe', 'pipe'>;
    void this.readOut();
    void this.readErr();
    void this.proc.exited.then((code) => {
      this.closed = true;
      const why = new Error(`The tool server stopped (exit code ${code}).${this.stderr.trim() ? ` It said: ${this.stderr.trim().slice(-300)}` : ''}`);
      for (const p of this.pending.values()) p.fail(why);
      this.pending.clear();
    });
  }

  private async readOut() {
    const dec = new TextDecoder();
    let buf = '';
    for await (const chunk of this.proc.stdout) {
      buf += dec.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg: Rpc;
        try { msg = JSON.parse(line) as Rpc; } catch { continue; } // servers that print logs to stdout
        this.onMessage(msg);
      }
    }
  }

  private async readErr() {
    const dec = new TextDecoder();
    for await (const chunk of this.proc.stderr) this.stderr = (this.stderr + dec.decode(chunk)).slice(-4000);
  }

  private onMessage(msg: Rpc) {
    if (typeof msg.id === 'number' && !msg.method) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.fail(new Error(msg.error.message || 'The tool server returned an error.'));
      else p.ok(msg.result);
    } else if (typeof msg.id === 'number' && msg.method) {
      // A request from the server (sampling, roots…): Lotus offers none of these.
      this.write({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Not supported by Lotus.' } });
    }
  }

  private write(msg: Rpc) {
    if (this.closed) throw new Error('The tool server is not running.');
    this.proc.stdin.write(`${JSON.stringify(msg)}\n`);
    void this.proc.stdin.flush();
  }

  request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((ok, fail) => {
      const t = setTimeout(() => { this.pending.delete(id); fail(new Error(`The tool server didn't answer ${method} in ${Math.round(timeoutMs / 1000)} s.`)); }, timeoutMs);
      this.pending.set(id, { ok: (v) => { clearTimeout(t); ok(v); }, fail: (e) => { clearTimeout(t); fail(e); } });
      try { this.write({ jsonrpc: '2.0', id, method, params }); } catch (e) { clearTimeout(t); this.pending.delete(id); fail(e as Error); }
    });
  }

  async notify(method: string, params?: unknown) { try { this.write({ jsonrpc: '2.0', method, params }); } catch { /* closed */ } }

  close() {
    this.closed = true;
    try { this.proc.kill(); } catch { /* gone */ }
    this.log('mcp: stopped a stdio server');
  }
}

// ── Streamable HTTP ────────────────────────────────────────────────────────

/** The JSON-RPC answer with this id, from a JSON body or an event stream. */
export function pickAnswer(contentType: string, body: string, id: number): Rpc | null {
  const msgs: Rpc[] = [];
  if (contentType.includes('text/event-stream')) {
    for (const ev of body.split(/\r?\n\r?\n/)) {
      const data = ev.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (!data) continue;
      try { const j = JSON.parse(data); (Array.isArray(j) ? j : [j]).forEach((m) => msgs.push(m as Rpc)); } catch { /* skip */ }
    }
  } else if (body.trim()) {
    try { const j = JSON.parse(body); (Array.isArray(j) ? j : [j]).forEach((m) => msgs.push(m as Rpc)); } catch { /* skip */ }
  }
  return msgs.find((m) => m.id === id && !m.method) ?? null;
}

class HttpTransport implements Transport {
  private nextId = 1;
  private session: string | null = null;
  constructor(private cfg: McpServerConfig, private fetchFn: typeof fetch) {}

  private headers(): Record<string, string> {
    return { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': PROTOCOL, ...(this.session ? { 'mcp-session-id': this.session } : {}), ...(this.cfg.headers ?? {}) };
  }

  async request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const id = this.nextId++;
    let res: Response;
    try {
      res = await this.fetchFn(this.cfg.url!, { method: 'POST', headers: this.headers(), body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) { throw new Error(`Couldn't reach the tool server at ${this.cfg.url}: ${(e as Error).message}`); }
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.session = sid;
    const text = await res.text();
    if (res.status === 401 || res.status === 403) throw new Error('The tool server refused the request. Check its access key or headers.');
    if (!res.ok) throw new Error(`The tool server answered ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}.`);
    const msg = pickAnswer(res.headers.get('content-type') ?? '', text, id);
    if (!msg) throw new Error('The tool server gave an answer Lotus did not understand.');
    if (msg.error) throw new Error(msg.error.message || 'The tool server returned an error.');
    return msg.result;
  }

  async notify(method: string, params?: unknown) {
    try { await this.fetchFn(this.cfg.url!, { method: 'POST', headers: this.headers(), body: JSON.stringify({ jsonrpc: '2.0', method, params }), signal: AbortSignal.timeout(10_000) }); } catch { /* best effort */ }
  }

  close() {
    if (this.session) void this.fetchFn(this.cfg.url!, { method: 'DELETE', headers: this.headers() }).catch(() => undefined);
    this.session = null;
  }
}

// ── tools ──────────────────────────────────────────────────────────────────

/** "GitHub Server" + "create_issue" → "mcp.github_server_create_issue" (the registry allows a-z and _). */
export function mcpToolName(server: string, tool: string): string {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_+|_+$/g, '') || 'x';
  return `mcp.${`${clean(server)}_${clean(tool)}`.slice(0, 60).replace(/_+$/, '')}`;
}

const SIMPLE = new Set(['string', 'number', 'integer', 'boolean', 'array']);

/** MCP's JSON Schema → Lotus's simpler one. Objects and unions travel as JSON text and are parsed back. */
export function toLotusSchema(s: McpToolInfo['inputSchema']): { schema: JsonSchema; jsonArgs: Set<string> } {
  const props: JsonSchema['properties'] = {};
  const jsonArgs = new Set<string>();
  for (const [k, p] of Object.entries(s?.properties ?? {})) {
    const t = Array.isArray(p.type) ? (p.type as string[]).find((x) => x !== 'null') : (p.type as string | undefined);
    const desc = typeof p.description === 'string' ? p.description : '';
    if (t && SIMPLE.has(t)) {
      props[k] = { type: t as 'string', description: desc, ...(Array.isArray(p.enum) ? { enum: (p.enum as unknown[]).map(String) } : {}), ...(t === 'array' ? { items: { type: String((p.items as { type?: string } | undefined)?.type ?? 'string') } } : {}) };
    } else {
      jsonArgs.add(k);
      props[k] = { type: 'string', description: `${desc}${desc ? ' ' : ''}(JSON)`.trim() };
    }
  }
  return { schema: { type: 'object', properties: props, required: (s?.required ?? []).filter((r) => r in props) }, jsonArgs };
}

/** An MCP tools/call result → what the model reads. */
export function resultText(r: unknown): { ok: boolean; text: string } {
  const res = (r ?? {}) as { content?: { type: string; text?: string; mimeType?: string; resource?: { text?: string; uri?: string } }[]; isError?: boolean; structuredContent?: unknown };
  const parts = (res.content ?? []).map((c) => c.type === 'text' ? c.text ?? '' : c.type === 'resource' ? c.resource?.text ?? c.resource?.uri ?? '' : `[${c.type}${c.mimeType ? ` ${c.mimeType}` : ''}]`).filter(Boolean);
  let text = parts.join('\n');
  if (!text && res.structuredContent !== undefined) text = JSON.stringify(res.structuredContent);
  return { ok: !res.isError, text: text.slice(0, 20_000) || '(no output)' };
}

// ── the hub ────────────────────────────────────────────────────────────────

interface Live { cfg: McpServerConfig; key: string; transport: Transport | null; state: McpServerStatus['state']; tools: McpToolInfo[]; error?: string; starting?: Promise<void> }

export class McpHub {
  private live = new Map<string, Live>();
  constructor(private o: { kvGet: (k: string) => string | null; fetch?: typeof fetch; log?: (m: string) => void; onChange?: () => void }) {}

  private log = (m: string) => this.o.log?.(m);

  configs(): McpServerConfig[] {
    try {
      const raw = JSON.parse(this.o.kvGet(MCP_KEY) || '[]') as McpServerConfig[];
      return Array.isArray(raw) ? raw.filter((c) => c && typeof c.id === 'string' && (c.command || c.url)) : [];
    } catch { return []; }
  }

  /** Brings the running servers in line with the saved list (removed or edited ones stop). */
  private sync(): Live[] {
    const cfgs = this.configs();
    const want = new Map(cfgs.map((c) => [c.id, c]));
    for (const [id, l] of this.live) {
      const c = want.get(id);
      if (!c || JSON.stringify(c) !== l.key || c.enabled === false) { l.transport?.close(); this.live.delete(id); }
    }
    for (const c of cfgs) if (c.enabled !== false && !this.live.has(c.id)) this.live.set(c.id, { cfg: c, key: JSON.stringify(c), transport: null, state: 'off', tools: [] });
    return [...this.live.values()];
  }

  private async start(l: Live): Promise<void> {
    if (l.state === 'ready') return;
    if (l.starting) return l.starting;
    l.state = 'starting';
    l.starting = (async () => {
      try {
        l.transport = l.cfg.url ? new HttpTransport(l.cfg, this.o.fetch ?? fetch) : new StdioTransport(l.cfg, this.log);
        await l.transport.request('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'Lotus', version: '0.18' } }, START_TIMEOUT);
        await l.transport.notify('notifications/initialized');
        const tools: McpToolInfo[] = [];
        let cursor: string | undefined;
        for (let i = 0; i < 20; i++) {
          const r = (await l.transport.request('tools/list', cursor ? { cursor } : {}, START_TIMEOUT)) as { tools?: McpToolInfo[]; nextCursor?: string };
          tools.push(...(r.tools ?? []));
          if (!r.nextCursor) break;
          cursor = r.nextCursor;
        }
        l.tools = tools;
        l.state = 'ready';
        l.error = undefined;
        this.log(`mcp: ${l.cfg.name} ready with ${tools.length} tools`);
      } catch (e) {
        l.transport?.close();
        l.transport = null;
        l.state = 'error';
        const m = (e as Error).message;
        l.error = /ENOENT|not found|cannot find|posix_spawn/i.test(m) && !l.cfg.url ? `Lotus couldn't start "${l.cfg.command}". Check the command, and that the program (for example Node.js for npx, or uv for uvx) is installed.` : m;
        this.log(`mcp: ${l.cfg.name}: ${l.error}`);
      } finally {
        l.starting = undefined;
        this.o.onChange?.();
      }
    })();
    return l.starting;
  }

  /** Starts every enabled server (in parallel) and waits until each is ready or failed. */
  async ready(): Promise<void> {
    await Promise.all(this.sync().map((l) => this.start(l)));
  }

  status(): McpServerStatus[] {
    const live = new Map([...this.live.values()].map((l) => [l.cfg.id, l]));
    return this.configs().map((c) => {
      const l = live.get(c.id);
      return { id: c.id, name: c.name, enabled: c.enabled !== false, state: c.enabled === false ? 'off' : l?.state ?? 'off', tools: (l?.tools ?? []).map((t) => t.name), error: l?.error };
    });
  }

  /** Restarts one server (or all) and reports. */
  async restart(id?: string): Promise<McpServerStatus[]> {
    for (const [k, l] of this.live) if (!id || k === id) { l.transport?.close(); this.live.delete(k); }
    await this.ready();
    return this.status();
  }

  /** The agent tools of every ready server. Call `ready()` first to start them. */
  tools(): Tool[] {
    const out: Tool[] = [];
    const seen = new Set<string>();
    for (const l of this.live.values()) {
      if (l.state !== 'ready') continue;
      for (const t of l.tools) {
        const name = mcpToolName(l.cfg.name || l.cfg.id, t.name);
        if (seen.has(name)) continue;
        seen.add(name);
        const { schema, jsonArgs } = toLotusSchema(t.inputSchema);
        const server = l.cfg.name || l.cfg.id;
        out.push({
          name,
          label: `Using ${server}: ${t.name}`,
          description: `${(t.description ?? '').slice(0, 900)} (MCP tool "${t.name}" from ${server})`.trim(),
          parameters: schema,
          risk: 'risky',
          describe: (a) => `${server} · ${t.name}${Object.keys(a).length ? ` ${JSON.stringify(a).slice(0, 160)}` : ''}`,
          run: async (args): Promise<ToolResult> => {
            const sent: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(args)) {
              if (jsonArgs.has(k) && typeof v === 'string') { try { sent[k] = JSON.parse(v); continue; } catch { /* plain text */ } }
              sent[k] = v;
            }
            try {
              if (l.state !== 'ready' || !l.transport) await this.start(l);
              if (!l.transport) throw new Error(l.error ?? 'The tool server is not running.');
              const r = resultText(await l.transport.request('tools/call', { name: t.name, arguments: sent }, CALL_TIMEOUT));
              return { ok: r.ok, text: r.text, summary: `${r.ok ? 'Used' : 'Tried'} ${server}: ${t.name}` };
            } catch (e) {
              return { ok: false, text: (e as Error).message, summary: `${server}: ${t.name} failed` };
            }
          },
        });
      }
    }
    return out;
  }

  stop(): void {
    for (const l of this.live.values()) l.transport?.close();
    this.live.clear();
  }
}
