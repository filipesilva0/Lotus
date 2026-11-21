// Settings → Advanced (0.18.0): the enthusiast tools, all free. Cloud models with your own key, MCP tool
// servers and a local API for other apps. Shown when Advanced mode is on (Settings → General).

import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Plus, RotateCw, Trash2 } from 'lucide-react';
import { LotusSettings } from '../../types/lotus';
import { Toggle } from '../common/Toggle';
import { Banner, Btn, IconBtn, Select, TextInput, useFlash } from '../common/ui';
import { kv } from '../../lib/store';
import { onCoreEvent, rpc } from '../../lib/core';
import { llamacppToken, setLlamacppToken } from '../../services/engineConfig';
import { offerUndo } from '../common/Alerts';
import { putBack, takeOut } from '../../lib/undoList';

interface P { settings: LotusSettings; onUpdateSettings: (p: Partial<LotusSettings>) => void }

const Section: React.FC<{ title: string; hint: React.ReactNode; children: React.ReactNode }> = ({ title, hint, children }) => (
  <section aria-label={title} className="py-4 border-b border-[var(--sep)] last:border-b-0 space-y-3">
    <div>
      <h3 className="text-[13px] font-semibold">{title}</h3>
      <p className="text-[12px] text-[var(--color-text-muted)] leading-snug mt-0.5">{hint}</p>
    </div>
    {children}
  </section>
);

// ── Cloud models with your own key ───────────────────────────────────────

/** OpenAI-style services. Lotus adds /v1/chat/completions to the address. */
export const CLOUD_PROVIDERS: { id: string; name: string; url: string; keys: string }[] = [
  { id: 'openai', name: 'OpenAI', url: 'https://api.openai.com', keys: 'https://platform.openai.com/api-keys' },
  { id: 'openrouter', name: 'OpenRouter', url: 'https://openrouter.ai/api', keys: 'https://openrouter.ai/keys' },
  { id: 'groq', name: 'Groq', url: 'https://api.groq.com/openai', keys: 'https://console.groq.com/keys' },
  { id: 'mistral', name: 'Mistral', url: 'https://api.mistral.ai', keys: 'https://console.mistral.ai/api-keys' },
];
export const providerFor = (url: string) => CLOUD_PROVIDERS.find((p) => url.replace(/\/+$/, '') === p.url);

const CloudKeys: React.FC<P> = ({ settings: s, onUpdateSettings: set }) => {
  const current = s.llmBackend === 'llamacpp' ? providerFor(s.llamacppUrl) : undefined;
  const [provider, setProvider] = useState(current?.id ?? 'openai');
  const [key, setKey] = useState('');
  const p = CLOUD_PROVIDERS.find((x) => x.id === provider) ?? CLOUD_PROVIDERS[0];
  const use = () => { setLlamacppToken(key.trim()); set({ llmBackend: 'llamacpp', llamacppUrl: p.url }); setKey(''); };
  return (
    <Section title="Cloud models with your own key" hint="Chat with a cloud model through your own account. Your messages go to that service and it bills you directly; Lotus never sees or keeps a copy. The key stays on this PC.">
      {current ? (
        <Banner tone="info" action={<Btn size="sm" onClick={() => set({ llmBackend: 'builtin' })}>Back to Lotus's engine</Btn>}>
          Chat uses {current.name} with your key{llamacppToken() ? '' : ' (no key saved yet)'}. Pick a model next to the message box.
        </Banner>
      ) : null}
      <div className="flex gap-2 flex-wrap items-center">
        <div className="w-36 shrink-0"><Select aria-label="Cloud service" value={provider} onChange={(e) => setProvider(e.target.value)}>
          {CLOUD_PROVIDERS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </Select></div>
        <div className="flex-1 min-w-[200px]"><TextInput type="password" aria-label={`${p.name} API key`} placeholder={`${p.name} API key`} value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} /></div>
        <Btn variant="primary" disabled={!key.trim()} onClick={use}>Use for chat</Btn>
      </div>
      <p className="text-[12px] text-[var(--color-text-muted)]">Get a key at <span className="font-mono">{p.keys}</span>. Any other OpenAI-style service works too: Settings → Engines → Your server, with its address and key.</p>
    </Section>
  );
};

// ── MCP tool servers ─────────────────────────────────────────────────────

export const MCP_KEY = 'lotus.mcp.v1';
export interface McpServerConfig { id: string; name: string; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string>; enabled?: boolean }
interface McpStatus { id: string; name: string; enabled: boolean; state: 'off' | 'starting' | 'ready' | 'error'; tools: string[]; error?: string }

/** `npx -y "@scope/server" --dir "C:\My Files"` → ['npx', '-y', '@scope/server', '--dir', 'C:\My Files']. */
export function splitCommand(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

const readMcp = (): McpServerConfig[] => { try { const l = JSON.parse(kv.getItem(MCP_KEY) || '[]'); return Array.isArray(l) ? l : []; } catch { return []; } };

const McpServers: React.FC = () => {
  const [list, setList] = useState<McpServerConfig[]>(readMcp);
  const [status, setStatus] = useState<McpStatus[]>([]);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<'program' | 'address'>('program');
  const [name, setName] = useState('');
  const [line, setLine] = useState('');
  const [token, setToken] = useState('');
  const refresh = useCallback(() => { rpc<McpStatus[]>('mcp_status').then(setStatus).catch(() => undefined); }, []);
  useEffect(() => { refresh(); return onCoreEvent((e) => { if (e.type === 'mcp') refresh(); }); }, [refresh]);
  const save = (l: McpServerConfig[]) => { setList(l); kv.setItem(MCP_KEY, JSON.stringify(l)); setTimeout(refresh, 300); };
  const add = () => {
    const id = `mcp-${Date.now().toString(36)}`;
    const cfg: McpServerConfig = kind === 'address'
      ? { id, name: name.trim(), url: line.trim(), headers: token.trim() ? { authorization: /^(bearer|basic) /i.test(token.trim()) ? token.trim() : `Bearer ${token.trim()}` } : undefined, enabled: true }
      : (() => { const [command, ...args] = splitCommand(line.trim()); return { id, name: name.trim(), command, args, enabled: true }; })();
    save([...list, cfg]);
    setAdding(false); setName(''); setLine(''); setToken('');
  };
  const stateText = (st?: McpStatus) => !st ? 'Not started' : st.state === 'ready' ? `${st.tools.length} tool${st.tools.length === 1 ? '' : 's'}` : st.state === 'starting' ? 'Starting…' : st.state === 'error' ? 'Not working' : 'Off';
  const valid = name.trim() && line.trim() && (kind === 'program' || /^https?:\/\//i.test(line.trim()));
  return (
    <Section title="Tool servers (MCP)" hint="Give chat and Work more tools by connecting MCP servers: a program Lotus starts on this PC, or a web address. Lotus asks before each use of their tools, as it does for anything that changes your files or sends something out.">
      {list.length > 0 && (
        <ul className="divide-y divide-[var(--sep)] rounded-[10px] border border-[var(--sep)]">
          {list.map((c) => {
            const st = status.find((x) => x.id === c.id);
            return (
              <li key={c.id} className="px-3 py-2 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] truncate">{c.name}</p>
                  <p className="text-[12px] text-[var(--color-text-muted)] truncate font-mono">{c.url ?? [c.command, ...(c.args ?? [])].join(' ')}</p>
                  <p className={`text-[12px] ${st?.state === 'error' ? 'text-[var(--c-red)]' : 'text-[var(--color-text-muted)]'}`} title={st?.tools.join(', ')}>{c.enabled === false ? 'Off' : stateText(st)}{st?.error ? `: ${st.error}` : ''}</p>
                </div>
                <IconBtn label={`Restart ${c.name}`} onClick={() => { void rpc('mcp_restart', { id: c.id }).then(refresh); }}><RotateCw className="w-3.5 h-3.5" /></IconBtn>
                <Toggle checked={c.enabled !== false} onChange={(v) => save(list.map((x) => (x.id === c.id ? { ...x, enabled: v } : x)))} ariaLabel={`Use ${c.name}`} />
                <IconBtn label={`Remove ${c.name}`} onClick={() => { const { rest, index } = takeOut(list, c.id); save(rest); offerUndo(`${c.name} removed`, () => save(putBack(rest, c, index)), () => undefined); }}><Trash2 className="w-3.5 h-3.5" /></IconBtn>
              </li>
            );
          })}
        </ul>
      )}
      {adding ? (
        <div className="space-y-2 rounded-[10px] border border-[var(--sep)] p-3">
          <div className="flex gap-2">
            <div className="w-44 shrink-0"><Select aria-label="Server kind" value={kind} onChange={(e) => setKind(e.target.value as 'program' | 'address')}>
              <option value="program">Program on this PC</option>
              <option value="address">Web address</option>
            </Select></div>
            <div className="flex-1"><TextInput aria-label="Server name" placeholder="Name, e.g. GitHub" value={name} onChange={(e) => setName(e.target.value)} /></div>
          </div>
          <TextInput aria-label={kind === 'program' ? 'Command' : 'Address'} className="font-mono" value={line} onChange={(e) => setLine(e.target.value)}
            placeholder={kind === 'program' ? 'npx -y @modelcontextprotocol/server-filesystem C:\\Users\\me\\Documents' : 'https://example.com/mcp'} />
          {kind === 'address' && <TextInput type="password" aria-label="Access key" placeholder="Access key (optional)" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />}
          <div className="flex gap-2 justify-end">
            <Btn variant="ghost" onClick={() => setAdding(false)}>Cancel</Btn>
            <Btn variant="primary" disabled={!valid} onClick={add}>Add server</Btn>
          </div>
        </div>
      ) : (
        <Btn icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setAdding(true)}>Add a tool server</Btn>
      )}
    </Section>
  );
};

// ── Local API ────────────────────────────────────────────────────────────

export const LOCAL_API_KEY = 'lotus.localApi.v1';
interface LocalApiSettings { enabled: boolean; port: number; key: string }
interface LocalApiStatus { enabled: boolean; running: boolean; port: number; url: string; error?: string }

const newKey = () => {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return `lotus-${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
};
const readApi = (): LocalApiSettings => {
  try { const s = JSON.parse(kv.getItem(LOCAL_API_KEY) || '{}'); return { enabled: s.enabled === true, port: typeof s.port === 'number' ? s.port : 11470, key: typeof s.key === 'string' ? s.key : '' }; }
  catch { return { enabled: false, port: 11470, key: '' }; }
};

const LocalApiSection: React.FC = () => {
  const [s, setS] = useState<LocalApiSettings>(readApi);
  const [st, setSt] = useState<LocalApiStatus | null>(null);
  const [copied, flash] = useFlash();
  const [copiedKey, flashKey] = useFlash();
  const refresh = useCallback(() => { rpc<LocalApiStatus>('local_api_status').then(setSt).catch(() => undefined); }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const save = (p: Partial<LocalApiSettings>) => {
    const n = { ...s, ...p };
    if (n.enabled && n.key.length < 16) n.key = newKey();
    setS(n); kv.setItem(LOCAL_API_KEY, JSON.stringify(n)); setTimeout(refresh, 400);
  };
  const copy = async (text: string, done: () => void) => { try { await navigator.clipboard.writeText(text); done(); } catch { /* no clipboard */ } };
  return (
    <Section title="Local API" hint="Let other apps on this PC (editors, scripts, note apps) use Lotus's chat model through the OpenAI-style API most of them support. Only this PC can reach it, and only with the key below.">
      <div className="flex items-center justify-between gap-4">
        <span className="text-[13px]">Turn on the local API</span>
        <Toggle checked={s.enabled} onChange={(v) => save({ enabled: v })} ariaLabel="Turn on the local API" />
      </div>
      {s.enabled && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[12px] w-20 shrink-0 text-[var(--color-text-muted)]">Address</span>
            <code className="flex-1 text-[12px] font-mono truncate">{st?.url ?? `http://127.0.0.1:${s.port}/v1`}</code>
            <IconBtn label={copied ? 'Copied' : 'Copy address'} onClick={() => void copy(st?.url ?? `http://127.0.0.1:${s.port}/v1`, flash)}><Copy className="w-3.5 h-3.5" /></IconBtn>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[12px] w-20 shrink-0 text-[var(--color-text-muted)]">Key</span>
            <code className="flex-1 text-[12px] font-mono truncate">{s.key ? `${s.key.slice(0, 10)}…${s.key.slice(-4)}` : '—'}</code>
            <IconBtn label={copiedKey ? 'Copied' : 'Copy key'} onClick={() => void copy(s.key, flashKey)}><Copy className="w-3.5 h-3.5" /></IconBtn>
            <Btn size="sm" variant="ghost" onClick={() => save({ key: newKey() })}>New key</Btn>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[12px] w-20 shrink-0 text-[var(--color-text-muted)]">Port</span>
            <div className="w-28"><TextInput aria-label="Port" inputMode="numeric" value={String(s.port)} onChange={(e) => { const n = Number(e.target.value.replace(/\D/g, '')); if (n >= 1024 && n <= 65535) save({ port: n }); else setS({ ...s, port: n }); }} /></div>
          </div>
          {st?.error ? <Banner tone="error">{st.error}</Banner> : st?.running ? <p className="text-[12px] text-[var(--color-text-muted)]">Running. Apps use the model chosen in Lotus unless they name another.</p> : null}
        </div>
      )}
    </Section>
  );
};

export const AdvancedPanel: React.FC<P> = (p) => (
  <div>
    <CloudKeys {...p} />
    <McpServers />
    <LocalApiSection />
  </div>
);
