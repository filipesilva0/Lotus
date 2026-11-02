import React, { useEffect, useState } from 'react';
import { Code2, Copy, Download, FileText, Layers, FlaskConical, SlidersHorizontal, Trash2, X, ExternalLink, Dices, FolderOpen, RefreshCw, Sparkles } from 'lucide-react';
import type { ContextFile } from '../../context/discover';
import { useMemoryStore } from '../../memory/store';
import { useHardware } from '../../hardware/monitor';
import { ChatMessage, ChatSession, ContextItem, LotusSettings, MemoryItem } from '../../types/lotus';
import { artifactsFrom, contextTokens } from '../../chat/helpers';
import { InspectorPane, KV, Section, SliderField } from '../common/Pane';
import { Banner, Btn, Checkbox, IconBtn, Segmented, Stepper, TextInput, cx } from '../common/ui';
import { openExternal } from '../../lib/open';
import { RawExchange } from '../../hooks/useChat';

export type InspectorTab = 'artifacts' | 'context' | 'research' | 'params';

interface Props {
  tab: InspectorTab; onTab: (t: InspectorTab) => void;
  session: ChatSession; settings: LotusSettings; onSettings: (p: Partial<LotusSettings>) => void;
  memory: MemoryItem[]; onMemory: (m: MemoryItem[]) => void;
  onContext: (fn: (c: ContextItem[]) => ContextItem[]) => void;
  onAddFiles: (files: File[]) => void;
  raw: RawExchange | null;
  focusArtifact: { code: string; nonce: number } | null;
  searchOn: boolean; onToggleSearch: () => void;
  project: { files: ContextFile[]; loading: boolean; error: string | null; refresh: () => void };
  onFolder: (path: string | null) => void;
  onToggleFile: (rel: string) => void;
}

const TABS: { id: InspectorTab; label: string; icon: React.ReactNode }[] = [
  { id: 'artifacts', label: 'Artifacts', icon: <Code2 className="w-3.5 h-3.5" /> },
  { id: 'context', label: 'Context', icon: <Layers className="w-3.5 h-3.5" /> },
  { id: 'research', label: 'Sources', icon: <FlaskConical className="w-3.5 h-3.5" /> },
  { id: 'params', label: 'Model', icon: <SlidersHorizontal className="w-3.5 h-3.5" /> },
];

// ── Artifacts ─────────────────────────────────────────────────────────────
const PREVIEWABLE = ['html', 'svg', 'xml'];
const ArtifactsTab: React.FC<{ messages: ChatMessage[]; focus: Props['focusArtifact'] }> = ({ messages, focus }) => {
  const list = artifactsFrom(messages);
  const [id, setId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<'preview' | 'code'>('preview');
  useEffect(() => { if (focus) { const hit = list.find((a) => a.code.trim() === focus.code.trim()); if (hit) setId(hit.id); } }, [focus?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = list.find((a) => a.id === id) ?? list[list.length - 1];
  if (!cur) return <p className="p-4 text-[13px] text-[var(--color-text-muted)]">Code the model writes shows up here. HTML and SVG can be previewed; any code can be edited and copied.</p>;
  const code = edits[cur.id] ?? cur.code;
  const canPreview = PREVIEWABLE.includes(cur.lang);
  const doc = cur.lang === 'svg' ? `<!doctype html><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#fff">${code}</body>` : code;
  const download = () => {
    const ext = { html: 'html', svg: 'svg', css: 'css', javascript: 'js', js: 'js', typescript: 'ts', python: 'py', json: 'json' }[cur.lang] ?? 'txt';
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([code])); a.download = `artifact.${ext}`; a.click();
  };
  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="p-3 space-y-2 border-b border-[var(--sep)]">
        <select aria-label="Artifact" value={cur.id} onChange={(e) => setId(e.target.value)} className="w-full h-7 px-2 rounded-[6px] bg-[var(--color-bg-card)] text-[13px] shadow-[0_0_0_0.5px_var(--sep)]">
          {list.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
        </select>
        <div className="flex items-center gap-2">
          {canPreview && <Segmented label="View" value={mode} onChange={setMode} options={[{ id: 'preview', label: 'Preview' }, { id: 'code', label: 'Code' }]} />}
          <div className="flex-1" />
          <IconBtn label="Copy code" onClick={() => void navigator.clipboard.writeText(code)}><Copy className="w-3.5 h-3.5" /></IconBtn>
          <IconBtn label="Download" onClick={download}><Download className="w-3.5 h-3.5" /></IconBtn>
        </div>
      </div>
      {canPreview && mode === 'preview' ? (
        <>
          <iframe title="Artifact preview" srcDoc={doc} sandbox="" className="flex-1 min-h-[240px] w-full bg-white" />
          <p className="px-3 py-2 text-[12px] text-[var(--color-text-muted)] border-t border-[var(--sep)]">Previews run without scripts, for safety. Layout, styles and SVG graphics render; JavaScript does not.</p>
        </>
      ) : (
        <textarea aria-label="Edit code" spellCheck={false} value={code} onChange={(e) => setEdits((x) => ({ ...x, [cur.id]: e.target.value }))}
          className="flex-1 min-h-[240px] w-full resize-none p-3 font-mono text-[12px] leading-relaxed bg-transparent focus:outline-none" />
      )}
    </div>
  );
};

// ── Context & memory ──────────────────────────────────────────────────────
const KIND_LABEL: Record<ContextFile['kind'], string> = { soul: 'Persona', rules: 'Rules', memory: 'Memory' };

const ContextTab: React.FC<Pick<Props, 'session' | 'memory' | 'onMemory' | 'onContext' | 'onAddFiles' | 'settings' | 'project' | 'onFolder' | 'onToggleFile'>> = ({ session, memory, onMemory, onContext, onAddFiles, settings, project, onFolder, onToggleFile }) => {
  const items = session.context ?? [];
  const [open, setOpen] = useState<string | null>(null);
  const [peek, setPeek] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const { status, error: memError } = useMemoryStore();
  const toks = contextTokens(items);
  const memOn = !session.incognito && !session.memoryOff;
  const shown = filter ? memory.filter((m) => m.text.toLowerCase().includes(filter.toLowerCase())) : memory;
  const pickFolder = async () => {
    const { isTauri } = await import('../../lib/http');
    if (!isTauri) return;
    const { open: pick } = await import('@tauri-apps/plugin-dialog');
    const p = await pick({ title: 'Choose a workspace folder for this chat', directory: true, multiple: false });
    if (typeof p === 'string') onFolder(p);
  };
  return (
    <div className="overflow-y-auto flex-1">
      <Section title="Workspace folder" hint="Lotus reads the folder's context files (SOUL.md, memory.md, AGENTS.md, CLAUDE.md, .hermes.md, .cursorrules, .cursor/rules, .lotus/…) and applies them to this chat. It never writes to them."
        action={session.folder
          ? <span className="flex items-center gap-1"><IconBtn label="Scan again" className="!w-6 !h-6" onClick={project.refresh}><RefreshCw className={cx('w-3.5 h-3.5', project.loading && 'animate-spin')} /></IconBtn><IconBtn label="Remove folder" className="!w-6 !h-6" onClick={() => onFolder(null)}><X className="w-3.5 h-3.5" /></IconBtn></span>
          : <button type="button" className="text-[12px] font-medium text-[var(--color-accent-vibrant)]" onClick={() => void pickFolder()}>Choose…</button>}>
        {!session.folder && <p className="text-[13px] text-[var(--color-text-muted)]">No folder. Choose one to give this chat a project's persona, rules and memory.</p>}
        {session.folder && (<>
          <button type="button" onClick={() => void pickFolder()} className="w-full flex items-center gap-1.5 text-left text-[12px] mb-2 hover:underline" title={session.folder}><FolderOpen className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{session.folder}</span></button>
          {project.error && <Banner tone="error">{project.error}</Banner>}
          {!project.loading && !project.error && !project.files.length && <p className="text-[13px] text-[var(--color-text-muted)]">No context files found in this folder.</p>}
          <ul className="space-y-1">
            {project.files.map((f) => {
              const off = session.folderOff?.includes(f.rel) ?? false;
              const memSkip = f.kind === 'memory' && !memOn;
              return (
                <li key={f.rel} className="rounded-[8px] bg-[var(--hover)]">
                  <div className="flex items-center gap-2 px-2.5 h-8">
                    <input type="checkbox" aria-label={`Apply ${f.rel}`} checked={!off} onChange={() => onToggleFile(f.rel)} />
                    <button type="button" className={cx('flex-1 min-w-0 flex items-center gap-1.5 text-left text-[13px]', (off || memSkip) && 'opacity-50')} aria-expanded={peek === f.rel} onClick={() => setPeek(peek === f.rel ? null : f.rel)}>
                      <span className="truncate">{f.rel}</span>
                    </button>
                    <span className="text-[12px] text-[var(--color-text-muted)]">{KIND_LABEL[f.kind]}</span>
                  </div>
                  {peek === f.rel && <pre className="mx-2.5 mb-2 p-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-[6px] bg-[var(--color-bg-card)] text-[12px] leading-snug font-mono">{f.content.slice(0, 2000)}{f.truncated ? '\n…(longer file: the first 24 KB is used)' : ''}</pre>}
                  {memSkip && !off && <p className="px-2.5 pb-1.5 text-[12px] text-[var(--color-text-muted)]">Not applied while memory is off for this chat.</p>}
                </li>
              );
            })}
          </ul>
        </>)}
      </Section>
      <Section title="Mounted files" hint="Only ticked chunks are sent with each message. Untick parts you don't want in the model's context."
        action={<label className="text-[12px] font-medium text-[var(--color-accent-vibrant)] cursor-default"><input type="file" multiple className="sr-only" aria-label="Mount files" onChange={(e) => { if (e.target.files) onAddFiles(Array.from(e.target.files)); e.target.value = ''; }} />+ Add</label>}>
        {!items.length && <p className="text-[13px] text-[var(--color-text-muted)]">No files mounted. Attach a text or code file in the composer, or add one here.</p>}
        <div className="space-y-2">
          {items.map((it) => {
            const on = it.chunks.filter((c) => c.on).length;
            return (
              <div key={it.id} className="rounded-[8px] bg-[var(--hover)]">
                <div className="flex items-center gap-2 px-2.5 h-8">
                  <input type="checkbox" aria-label={`Include ${it.name}`} checked={on === it.chunks.length} ref={(el) => { if (el) el.indeterminate = on > 0 && on < it.chunks.length; }}
                    onChange={(e) => onContext((c) => c.map((x) => (x.id === it.id ? { ...x, chunks: x.chunks.map((k) => ({ ...k, on: e.target.checked })) } : x)))} />
                  <button type="button" className="flex-1 min-w-0 flex items-center gap-1.5 text-left text-[13px]" onClick={() => setOpen(open === it.id ? null : it.id)} aria-expanded={open === it.id}>
                    <FileText className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{it.name}</span><span className="ml-auto text-[12px] text-[var(--color-text-muted)] tabular-nums">{on}/{it.chunks.length}</span>
                  </button>
                  <IconBtn label={`Remove ${it.name}`} className="!w-6 !h-6" onClick={() => onContext((c) => c.filter((x) => x.id !== it.id))}><X className="w-3.5 h-3.5" /></IconBtn>
                </div>
                {open === it.id && (
                  <div className="px-2.5 pb-2 space-y-1">
                    {it.chunks.map((k, i) => (
                      <label key={k.id} className={cx('flex items-start gap-2 p-1.5 rounded-[6px] text-[12px] leading-snug bg-[var(--color-bg-card)]', !k.on && 'opacity-50')}>
                        <input type="checkbox" className="mt-0.5" checked={k.on} onChange={(e) => onContext((c) => c.map((x) => (x.id === it.id ? { ...x, chunks: x.chunks.map((z) => (z.id === k.id ? { ...z, on: e.target.checked } : z)) } : x)))} />
                        <span><span className="font-semibold">Chunk {i + 1}</span> · {k.text.slice(0, 140).replace(/\s+/g, ' ')}…</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {items.length > 0 && <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">About {toks.toLocaleString()} tokens of the {settings.contextWindow.toLocaleString()}-token window.</p>}
        <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">For current information from the web, turn on Web search (globe) in the message box instead.</p>
      </Section>
      <Section title="Memory & instructions" hint={memOn
        ? 'Lotus saves what you ask it to (“remember …”, “from now on …”) and learns lasting facts and preferences as you talk. Learned items are marked; remove anything that is wrong.'
        : session.incognito ? 'Incognito: this chat reads no memories and creates none.' : 'Memory is off for this chat (header button): nothing is recalled or learned until you turn it back on.'}>
        {memError && <Banner tone="error">{memError}</Banner>}
        {memory.length > 6 && <TextInput value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter memories" aria-label="Filter memories" className="mb-2" />}
        {!memory.length && <p className="text-[13px] text-[var(--color-text-muted)]">Nothing stored yet.</p>}
        <ul className="space-y-1">
          {shown.map((m) => (
            <li key={m.id} className="flex items-start gap-2 text-[13px]">
              <span className="px-1.5 rounded-[4px] bg-[var(--hover)] text-[12px] font-semibold mt-0.5 shrink-0">{m.kind === 'memory' ? 'Fact' : 'Rule'}</span>
              <span className="flex-1">{m.text}{m.source === 'auto' && <span className="ml-1.5 inline-flex items-center gap-0.5 text-[12px] text-[var(--color-text-muted)]" title="Learned from a conversation"><Sparkles className="w-3 h-3" />learned</span>}</span>
              <IconBtn label="Forget" className="!w-6 !h-6" onClick={() => onMemory(memory.filter((x) => x.id !== m.id))}><Trash2 className="w-3.5 h-3.5" /></IconBtn>
            </li>
          ))}
        </ul>
        {status && (
          <p className="mt-2 text-[12px] text-[var(--color-text-muted)] leading-snug">
            {status.native
              ? `${status.messages.toLocaleString()} messages searchable · ${status.skills} skills · ${status.fts5 ? 'SQLite full-text search (FTS5)' : 'SQLite (FTS5 unavailable: simple search)'} · stored only on this computer`
              : 'Browser preview: memory is kept in this browser only.'}
          </p>
        )}
      </Section>
    </div>
  );
};

// ── Research ──────────────────────────────────────────────────────────────
const ResearchTab: React.FC<Pick<Props, 'session' | 'searchOn' | 'onToggleSearch'>> = ({ session, searchOn, onToggleSearch }) => {
  const withWork = session.messages.filter((m) => m.tools?.length || m.sources?.length);
  return (
    <div className="overflow-y-auto flex-1">
      <Section title="Source search">
        <Checkbox checked={searchOn} onChange={onToggleSearch} label="Search academic sources before answering" />
        <p className="mt-2 text-[12px] text-[var(--color-text-muted)] leading-snug">When on, your message's keywords are sent to OpenAlex, arXiv and PubMed (not the model). The best matches are given to the model, which cites them as [1], [2]…</p>
      </Section>
      {!withWork.length && <p className="p-4 text-[13px] text-[var(--color-text-muted)]">Queries and sources from this conversation will be listed here.</p>}
      {withWork.map((m) => (
        <Section key={m.id} title={`Reply at ${m.timestamp}`}>
          <div className="space-y-1.5 mb-2">
            {m.tools?.map((t) => <p key={t.id} className="text-[12px]"><span className={cx('inline-block w-1.5 h-1.5 rounded-full mr-1.5', t.status === 'done' ? 'bg-[var(--c-green)]' : t.status === 'error' ? 'bg-[var(--c-red)]' : 'bg-[var(--c-orange)]')} /><span className="font-medium">{t.label}</span><span className="text-[var(--color-text-muted)]"> · {t.detail}</span></p>)}
          </div>
          <div className="space-y-1.5">
            {m.sources?.map((s) => (
              <button key={s.n} type="button" onClick={() => void openExternal(s.url)} className="w-full text-left p-2 rounded-[8px] bg-[var(--hover)] hover:bg-[var(--pressed)]">
                <span className="flex items-start gap-2 text-[12px]"><span className="font-semibold text-[var(--color-accent-vibrant)]">[{s.n}]</span><span className="flex-1 leading-snug">{s.title}</span><ExternalLink className="w-3 h-3 mt-0.5 opacity-60" /></span>
                <span className="block mt-0.5 ml-6 text-[12px] text-[var(--color-text-muted)]">{[s.repo, s.year].filter(Boolean).join(' · ')}</span>
              </button>
            ))}
          </div>
        </Section>
      ))}
    </div>
  );
};

// ── Parameters & developer ────────────────────────────────────────────────
const CodeBlock: React.FC<{ title: string; value: unknown }> = ({ title, value }) => {
  const text = value ? JSON.stringify(value, null, 2) : '';
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1"><span className="text-[12px] font-medium">{title}</span>{text && <IconBtn label={`Copy ${title}`} className="!w-6 !h-6" onClick={() => void navigator.clipboard.writeText(text)}><Copy className="w-3.5 h-3.5" /></IconBtn>}</div>
      <pre className="max-h-56 overflow-auto p-2 rounded-[8px] bg-[var(--hover)] text-[12px] leading-relaxed font-mono whitespace-pre-wrap break-all">{text || 'Send a message to see it.'}</pre>
    </div>
  );
};

const ParamsTab: React.FC<Pick<Props, 'settings' | 'onSettings' | 'raw'>> = ({ settings: s, onSettings: set, raw }) => {
  const hw = useHardware();
  const [stopDraft, setStopDraft] = useState('');
  const addStop = () => { const v = stopDraft.replace(/\\n/g, '\n'); if (v && !s.stopSequences.includes(v)) set({ stopSequences: [...s.stopSequences, v] }); setStopDraft(''); };
  return (
    <div className="overflow-y-auto flex-1">
      <Section title="Sampling">
        <SliderField label="Temperature" value={s.temperature} min={0} max={2} step={0.05} onChange={(v) => set({ temperature: v })} format={(v) => v.toFixed(2)} />
        <SliderField label="Top-P" value={s.topP} min={0.05} max={1} step={0.01} onChange={(v) => set({ topP: v })} format={(v) => v.toFixed(2)} />
        <SliderField label="Top-K" value={s.topK} min={1} max={200} step={1} onChange={(v) => set({ topK: v })} />
        <SliderField label="Frequency penalty" value={s.frequencyPenalty} min={0} max={2} step={0.05} onChange={(v) => set({ frequencyPenalty: v })} format={(v) => v.toFixed(2)} />
        <SliderField label="Presence penalty" value={s.presencePenalty} min={0} max={2} step={0.05} onChange={(v) => set({ presencePenalty: v })} format={(v) => v.toFixed(2)} />
      </Section>
      <Section title="Limits">
        {s.autoScale ? (
          <div className="mb-2">
            <div className="flex items-center justify-between text-[12px]"><span>Context window</span><span className="tabular-nums">Auto · {hw.plan.numCtx.toLocaleString()} tokens</span></div>
            <p className="text-[12px] text-[var(--color-text-muted)] leading-snug mt-0.5">Sized to free video memory. <button type="button" className="text-[var(--color-accent-vibrant)] font-medium" onClick={() => set({ autoScale: false })}>Set it by hand</button></p>
          </div>
        ) : (
          <div className="flex items-center justify-between text-[12px] mb-2"><span>Context window</span><Stepper label="Context window" value={s.contextWindow} min={512} max={131072} step={512} onChange={(v) => set({ contextWindow: v })} unit="tokens" /></div>
        )}
        <div className="flex items-center justify-between text-[12px] mb-2"><span>Max reply length</span><Stepper label="Max reply tokens, 0 for no limit" value={s.maxTokens} min={0} max={32768} step={64} onChange={(v) => set({ maxTokens: v })} unit="tokens" /></div>
        <div className="flex items-center justify-between text-[12px]">
          <span>Seed</span>
          <span className="inline-flex items-center gap-1.5">
            {s.seed === null ? <span className="text-[var(--color-text-muted)]">Random</span> : <Stepper label="Seed" value={s.seed} min={0} max={2 ** 31 - 1} step={1} onChange={(v) => set({ seed: v })} />}
            <IconBtn label="Pick a random seed and lock it" onClick={() => set({ seed: Math.floor(Math.random() * 2 ** 31) })}><Dices className="w-3.5 h-3.5" /></IconBtn>
            {s.seed !== null && <IconBtn label="Unlock seed" onClick={() => set({ seed: null })}><X className="w-3.5 h-3.5" /></IconBtn>}
          </span>
        </div>
      </Section>
      <Section title="Stop sequences" hint="Generation stops when any of these appears. Use \n for a line break.">
        <div className="flex gap-1.5 mb-2"><TextInput value={stopDraft} onChange={(e) => setStopDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addStop(); }} placeholder="e.g. ###" aria-label="New stop sequence" /><Btn size="sm" onClick={addStop} disabled={!stopDraft}>Add</Btn></div>
        <div className="flex flex-wrap gap-1.5">{s.stopSequences.map((x) => <span key={x} className="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-[6px] bg-[var(--hover)] text-[12px] font-mono">{x.replace(/\n/g, '\\n')}<IconBtn label={`Remove ${x}`} className="!w-4 !h-4" onClick={() => set({ stopSequences: s.stopSequences.filter((y) => y !== x) })}><X className="w-3 h-3" /></IconBtn></span>)}</div>
      </Section>
      <Section title="System prompt">
        <textarea aria-label="System prompt" value={s.systemPrompt} onChange={(e) => set({ systemPrompt: e.target.value })} rows={4} className="w-full p-2 rounded-[8px] bg-[var(--hover)] text-[12px] leading-relaxed resize-y focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)]" />
      </Section>
      <Section title="Developer inspector" hint="The exact request Lotus sent to Ollama and the summary Ollama returned for the latest reply.">
        <CodeBlock title="Request" value={raw?.request} />
        <CodeBlock title="Response" value={raw?.response} />
        {raw?.response ? (() => { const r = raw.response as any; return (<div>
          <KV k="Prompt tokens" v={r.prompt_eval_count ?? '—'} /><KV k="Reply tokens" v={r.eval_count ?? '—'} />
          <KV k="Load time" v={r.load_duration ? `${Math.round(r.load_duration / 1e6)} ms` : '—'} /><KV k="Finish" v={r.done_reason ?? '—'} />
        </div>); })() : null}
        <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">Logit bias and per-token confidence aren't offered here: they aren't part of the request Lotus sends to Ollama.</p>
      </Section>
    </div>
  );
};

export const ChatInspector: React.FC<Props> = (p) => (
  <InspectorPane label="Inspector">
    <div className="shrink-0 p-2 border-b border-[var(--sep)]">
      <div role="tablist" aria-label="Inspector" className="grid grid-cols-4 gap-0.5 p-0.5 rounded-[8px] bg-[var(--hover)]">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={p.tab === t.id} title={t.label} onClick={() => p.onTab(t.id)}
            className={cx('h-7 inline-flex items-center justify-center gap-1 rounded-[6px] text-[12px] font-medium', p.tab === t.id ? 'bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep),0_1px_2px_rgba(0,0,0,.12)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-main)]')}>
            {t.icon}<span className="truncate">{t.label}</span>
          </button>
        ))}
      </div>
    </div>
    {p.tab === 'artifacts' && <ArtifactsTab messages={p.session.messages} focus={p.focusArtifact} />}
    {p.tab === 'context' && <ContextTab {...p} />}
    {p.tab === 'research' && <ResearchTab session={p.session} searchOn={p.searchOn} onToggleSearch={p.onToggleSearch} />}
    {p.tab === 'params' && <ParamsTab settings={p.settings} onSettings={p.onSettings} raw={p.raw} />}
  </InspectorPane>
);
