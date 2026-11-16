// Work (session 16, replaces App Builder): hand Lotus a job and get finished things back.
// Left: your pieces of work. Middle: the conversation, with the plan as a checklist, every step the
// agent and its helpers took (each agent with its own face), and questions it asks you. Right: the
// artifacts it made (documents, pages, tables, images, code), previewed and saved as real files.

import { Starters } from '../common/Starters';
import { WORK_STARTERS } from '../../data/starters';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, Check, ChevronDown, Code2, Copy, Download, FileText, FolderOpen, Globe, Image as ImageIcon, Mic, MonitorSmartphone, Pin, PinOff, Plus, Search, Table2, Trash2, X } from 'lucide-react';
import { Work, WorkAttachment, WorkItem, WorkMsg, helpersOf, planOf } from '../../work/store';
import { useFileIntake } from '../../lib/fileDrop';
import { fileToBase64 } from '../../services/ollamaService';
import { TEXT_EXT } from '../../chat/helpers';
import { folderName, pickFolderPath } from '../../chat/folder';
import { isTauri } from '../../lib/http';
import type { ArtifactInfo, AgentStep } from '../../lib/agent';
import { agentAvailable, workArtifact, workDir } from '../../lib/agent';
import { AgentSteps, UnverifiedNote } from '../chat/AgentSteps';
import { AgentFace } from '../common/AgentFace';
import { MarkdownLite } from '../../lib/markdownLite';
import { InspectorPane, MenuItem, Popover, SidebarPane, groupByDate } from '../common/Pane';
import { Btn, IconBtn, Segmented, cx } from '../common/ui';
import { ModeButton, PickerButton, PromptShell, RoundIcon, SendButton, VramMeter } from '../common/PromptBox';
import { BuiltinNotice, EngineNotice } from '../common/EngineNotice';
import { Tip } from '../common/Tip';
import { useCommand } from '../../lib/commands';
import { offerUndo } from '../common/Alerts';
import { listen, matchOption, speak, voiceState, VoiceState, hush } from '../../voice/voice';
import { revealPath } from '../../lib/open';
import type { ModelOption } from './ChatWorkspace';
import type { LotusSettings } from '../../types/lotus';


const KIND_ICON: Record<string, React.ReactNode> = {
  document: <FileText className="w-4 h-4" />, page: <Globe className="w-4 h-4" />, table: <Table2 className="w-4 h-4" />,
  image: <ImageIcon className="w-4 h-4" />, code: <Code2 className="w-4 h-4" />, data: <Code2 className="w-4 h-4" />, file: <FileText className="w-4 h-4" />,
};

/** CSV → rows (quotes and commas inside quotes handled). */
export function parseCsv(text: string, sep = text.split('\n')[0].includes('\t') ? '\t' : ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

// ── Artifacts panel ─────────────────────────────────────────────────────────
const ArtifactView: React.FC<{ workId: string; a: ArtifactInfo; nonce: number }> = ({ workId, a, nonce }) => {
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'preview' | 'source'>('preview');
  useEffect(() => { setText(null); setErr(null); workArtifact(workId, a.file).then(setText).catch((e) => setErr((e as Error).message)); }, [workId, a.file, a.updated, nonce]);
  if (err) return <p className="p-4 text-[13px] text-[var(--c-red)]">{err}</p>;
  if (text === null) return <p className="p-4 text-[13px] text-[var(--color-text-muted)]">Opening…</p>;
  const previewable = a.kind === 'document' || a.kind === 'page' || a.kind === 'table' || a.kind === 'image';
  const download = () => { const el = document.createElement('a'); el.href = URL.createObjectURL(new Blob([text])); el.download = a.file; el.click(); };
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-[var(--sep)]">
        {previewable && <Segmented label="View" value={mode} onChange={setMode} options={[{ id: 'preview', label: 'Preview' }, { id: 'source', label: 'Source' }]} />}
        <span className="flex-1" />
        <IconBtn label="Copy" onClick={() => void navigator.clipboard.writeText(text)}><Copy className="w-3.5 h-3.5" /></IconBtn>
        <IconBtn label="Download" onClick={download}><Download className="w-3.5 h-3.5" /></IconBtn>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {mode === 'source' || !previewable ? <pre className="p-3 text-[12px] font-mono leading-relaxed whitespace-pre-wrap break-words">{text}</pre>
          : a.kind === 'document' ? <div className="p-4 text-[13px] leading-relaxed"><MarkdownLite text={text} onDark={false} /></div>
          : a.kind === 'table' ? (() => { const rows = parseCsv(text); return (
            <table className="m-3 text-[12px] border-collapse">
              <thead><tr>{(rows[0] ?? []).map((h, i) => <th key={i} className="px-2 py-1 text-left font-semibold border-b border-[var(--sep)] whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody>{rows.slice(1).map((r, i) => <tr key={i}>{r.map((c, k) => <td key={k} className="px-2 py-1 border-b border-[var(--sep)] align-top">{c}</td>)}</tr>)}</tbody>
            </table>); })()
          : <iframe title={a.title} sandbox={a.kind === 'page' ? 'allow-scripts' : ''} className="w-full h-full min-h-[360px] bg-white"
              srcDoc={a.kind === 'image' ? `<!doctype html><body style="margin:0;display:grid;place-items:center;min-height:100vh">${text}</body>` : text} />}
      </div>
    </div>
  );
};

const ArtifactsPanel: React.FC<{ work: Work; open: string | null; onOpen: (f: string | null) => void }> = ({ work, open, onOpen }) => {
  const list = work.artifacts;
  const cur = list.find((a) => a.file === open) ?? null;
  const [nonce, setNonce] = useState(0);
  const reveal = async () => { const d = await workDir(work.activeId).catch(() => null); if (d) void revealPath(d); };
  return (
    <InspectorPane label="Artifacts" pinned className="w-[380px]">
      <div className="h-11 shrink-0 flex items-center gap-1.5 px-3 border-b border-[var(--sep)]">
        {cur ? <><IconBtn label="All artifacts" onClick={() => onOpen(null)}><X className="w-3.5 h-3.5" /></IconBtn><span className="text-[13px] font-semibold truncate flex-1">{cur.title}</span><IconBtn label="Reload" onClick={() => setNonce((n) => n + 1)}><AudioLines className="w-3.5 h-3.5 rotate-90" /></IconBtn></>
          : <><span className="text-[13px] font-semibold flex-1 inline-flex items-center gap-1">Artifacts<Tip label="Artifacts" /></span><IconBtn label="Show in folder" onClick={() => void reveal()}><FolderOpen className="w-3.5 h-3.5" /></IconBtn></>}
      </div>
      {cur ? <ArtifactView workId={work.activeId} a={cur} nonce={nonce} /> : (
        <div className="flex-1 min-h-0 overflow-y-auto p-2">
          {!list.length && <p className="p-3 text-[13px] text-[var(--color-text-muted)] leading-snug">What Lotus makes for this work shows up here: documents, web pages, tables, images and code, saved in your Lotus Studio folder.</p>}
          {list.map((a) => (
            <button key={a.file} type="button" onClick={() => onOpen(a.file)} className="w-full flex items-center gap-2.5 p-2 rounded-[8px] text-left hover:bg-[var(--hover)]">
              <span className="w-8 h-8 rounded-[7px] bg-[var(--color-accent-pastel)] text-[var(--color-accent-vibrant)] inline-flex items-center justify-center shrink-0">{KIND_ICON[a.kind] ?? KIND_ICON.file}</span>
              <span className="min-w-0"><span className="block text-[13px] font-medium truncate">{a.title}</span><span className="block text-[12px] text-[var(--color-text-muted)] truncate">{a.file} · {new Date(a.updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></span>
            </button>
          ))}
        </div>
      )}
    </InspectorPane>
  );
};

// ── Conversation ────────────────────────────────────────────────────────────
const Plan: React.FC<{ item: WorkItem; busy: boolean }> = ({ item, busy }) => {
  const plan = planOf(item);
  if (!plan?.steps.length) return null;
  const next = plan.steps.findIndex((_, i) => !plan.done.has(i + 1));
  return (
    <div className="mb-4 rounded-[12px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)] p-3" aria-label="Plan">
      <p className="text-[12px] font-semibold text-[var(--color-text-muted)] mb-1.5">Plan · {plan.done.size} of {plan.steps.length} done</p>
      <ol className="space-y-1">
        {plan.steps.map((s, i) => {
          const done = plan.done.has(i + 1);
          return (
            <li key={i} className="flex items-start gap-2 text-[13px]">
              <span className={cx('mt-0.5 w-4 h-4 rounded-full shrink-0 inline-flex items-center justify-center', done ? 'bg-[var(--c-green)] text-white' : i === next && busy ? 'border-2 border-[var(--color-accent-vibrant)] border-t-transparent animate-spin' : 'border border-[var(--sep-strong,var(--sep))]')}>{done && <Check className="w-3 h-3" />}</span>
              <span className={done ? 'text-[var(--color-text-muted)] line-through' : ''}>{s}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
};

const Reply: React.FC<{ m: WorkMsg; live: boolean; onDecide: (s: AgentStep, allow: boolean) => void; onArtifact: (f: string) => void }> = ({ m, live, onDecide, onArtifact }) => {
  const steps = m.steps ?? [];
  const own = steps.filter((s) => !s.data?.helper && s.tool !== 'plan.set' && s.tool !== 'plan.check');
  const helpers = helpersOf(steps);
  const made = steps.filter((s) => s.tool === 'artifact.write' && s.status === 'done').map((s) => s.data?.artifact as { file: string; title: string; kind: string }).filter(Boolean);
  return (
    <div className="min-w-0">
      {/* The face is the status: it only moves (and thinks) while Lotus is working. */}
      <p className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--color-text-muted)] mb-1"><AgentFace size={18} animate={live} mood={live ? 'thinking' : m.error ? 'sad' : undefined} />Lotus</p>
      <div className="min-w-0">
        {(() => {
          // Each helper's steps sit right under the step that started it, with the helper's own face.
          const out: React.ReactNode[] = [];
          let seg: AgentStep[] = [];
          let k = 0;
          const flush = () => { if (seg.length) out.push(<AgentSteps key={`s${out.length}`} steps={seg as never} onDecide={live ? (s, allow) => onDecide(s as unknown as AgentStep, allow) : undefined} />); seg = []; };
          for (const st of own) {
            seg.push(st);
            if (st.tool !== 'agent.delegate') continue;
            flush();
            k++;
            const want = String(st.args?.name ?? '').trim().slice(0, 40) || `Helper ${k}`;
            const h = helpers.find((x) => x.name === want) ?? (st.status === 'running' ? { name: want, goal: String(st.args?.goal ?? ''), steps: [] } : null);
            if (h) out.push(
              <div key={`h${k}`} className="my-2 ml-1.5 pl-3 border-l-2 border-[var(--sep)]">
                <p className="flex items-center gap-2 text-[12px] font-semibold mb-1"><AgentFace name={h.name} size={16} animate={live && st.status === 'running'} mood={live && st.status === 'running' ? 'thinking' : undefined} />{h.name}<span className="font-normal text-[var(--color-text-muted)] truncate">· {h.goal}</span></p>
                <AgentSteps steps={h.steps as never} onDecide={live ? (s, allow) => onDecide(s as unknown as AgentStep, allow) : undefined} />
                {!h.steps.length && <p className="text-[12px] text-[var(--color-text-muted)]">Starting…</p>}
              </div>,
            );
          }
          flush();
          return out;
        })()}
        {made.length > 0 && (
          <div className="flex flex-wrap gap-2 my-2">
            {made.map((a) => (
              <button key={a.file} type="button" onClick={() => onArtifact(a.file)} className="h-9 pl-2 pr-3 inline-flex items-center gap-2 rounded-[9px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)] hover:shadow-[0_0_0_1px_var(--color-accent-fill)] text-[13px]">
                <span className="text-[var(--color-accent-vibrant)]">{KIND_ICON[a.kind] ?? KIND_ICON.file}</span>{a.title}
              </button>
            ))}
          </div>
        )}
        {m.content && <div className="text-[14px] leading-relaxed"><MarkdownLite text={m.content} onDark={false} /></div>}
        {live && !m.content && !steps.length && <p className="text-[13px] text-[var(--color-text-muted)]">Thinking about how to do this…</p>}
        {m.error && <p className="mt-1 text-[13px] text-[var(--c-red)]">{m.error}</p>}
        {m.unverified?.length ? <UnverifiedNote items={m.unverified} /> : null}
      </div>
    </div>
  );
};

const AskCard: React.FC<{ work: Work }> = ({ work }) => {
  const a = work.asks[0];
  const [text, setText] = useState('');
  const [vs, setVs] = useState<VoiceState>(voiceState.get());
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => voiceState.on(setVs), []);
  if (!a) return null;
  const say = async () => {
    setNote(null);
    try { const t = await listen(); if (t) await work.answer(a, matchOption(t, a.options)); else setNote('Heard nothing. Try again.'); } catch (e) { setNote((e as Error).message); }
  };
  return (
    <div role="group" aria-label="Lotus is asking you" className="mb-3 rounded-[14px] p-3.5 bg-[var(--color-accent-pastel)] shadow-[0_0_0_1px_var(--color-accent-pastel-border)]">
      <div className="flex items-start gap-2.5">
        <AgentFace size={22} mood="unsure" />
        <p className="flex-1 text-[14px] font-medium leading-snug pt-1">{a.question}</p>
        <IconBtn label="Read aloud" onClick={() => void speak(`${a.question} ${a.options.join(', ')}`)}><AudioLines className="w-3.5 h-3.5" /></IconBtn>
      </div>
      {a.options.length > 0 && <div className="mt-2.5 flex flex-wrap gap-2 pl-8">{a.options.map((o) => <Btn key={o} size="sm" variant="secondary" onClick={() => void work.answer(a, o)}>{o}</Btn>)}</div>}
      <form className="mt-2.5 pl-8 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { void work.answer(a, text.trim()); setText(''); } }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={a.options.length ? 'Or type something else…' : 'Your answer'} aria-label="Your answer"
          className="flex-1 h-8 px-3 rounded-full bg-[var(--color-bg-card)] text-[13px] shadow-[0_0_0_0.5px_var(--sep)] focus:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-accent-fill)]" />
        <IconBtn label={vs === 'listening' ? 'Listening…' : 'Answer by voice'} active={vs === 'listening'} onClick={() => void say()}><Mic className="w-4 h-4" /></IconBtn>
        <Btn size="sm" variant="primary" type="submit" disabled={!text.trim()}>Answer</Btn>
      </form>
      {note && <p className="mt-1.5 pl-8 text-[12px] text-[var(--color-text-muted)]">{note}</p>}
    </div>
  );
};

// ── Page ────────────────────────────────────────────────────────────────────
interface Props { work: Work; settings: LotusSettings; onSettings: (p: Partial<LotusSettings>) => void; models: ModelOption[]; ollamaUp: boolean | null; onOpenModels: () => void; onOpenSettings: () => void }

export const WorkWorkspace: React.FC<Props> = ({ work, settings, onSettings, models, ollamaUp, onOpenModels, onOpenSettings }) => {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [openArtifact, setOpenArtifact] = useState<string | null>(null);
  const [talk, setTalk] = useState(false);
  const [vs, setVs] = useState<VoiceState>(voiceState.get());
  const [notice, setNotice] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => voiceState.on(setVs), []);
  const item = work.active;
  useEffect(() => { setOpenArtifact(null); }, [work.activeId]);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }, [item.messages, work.asks.length]);
  useCommand('new-work', () => { work.newWork(); setText(''); setFiles([]); });

  const addFiles = (list: FileList | File[]) => {
    const arr = Array.from(list);
    setFiles((f) => [...f, ...arr]);
    arr.filter((f) => f.type.startsWith('image/')).forEach((f) => setPreviews((p) => ({ ...p, [f.name + f.size]: URL.createObjectURL(f) })));
  };
  // Drop files anywhere on the Work page, or paste them: all of them are attached.
  const drag = useFileIntake(addFiles);
  // Images go to the model as pictures; text and code files are read and sent with the request.
  const readFiles = async (list: File[]): Promise<{ out: WorkAttachment[]; errors: string[] }> => {
    const out: WorkAttachment[] = [], errors: string[] = [];
    for (const f of list) {
      if (f.type.startsWith('image/')) out.push({ name: f.name, kind: 'image', data: await fileToBase64(f) });
      else if (f.type.startsWith('text/') || TEXT_EXT.test(f.name) || f.type === 'application/json') out.push({ name: f.name, kind: 'text', data: await f.text() });
      else errors.push(`${f.name}: Lotus can read images and text or code files. PDFs and other formats can't be read yet.`);
    }
    return { out, errors };
  };

  const go = async (t = text, withFiles = true) => {
    const list = withFiles ? files : [];
    if (!t.trim() && !list.length) return;
    setText(''); setNotice(null);
    let attach: WorkAttachment[] = [];
    if (list.length) {
      const r = await readFiles(list);
      attach = r.out; setFiles([]); setPreviews({});
      if (r.errors.length) setNotice(r.errors.join(' '));
      if (!t.trim() && !attach.length) return '';
    }
    try { return await work.send(t, work.activeId, attach); } catch (e) { setNotice((e as Error).message); return ''; }
  };

  // Talk: listen → send → read the reply → listen again, until you switch it off or say nothing.
  const talkRef = useRef(false);
  talkRef.current = talk;
  useEffect(() => {
    if (!talk) { hush(); return; }
    let live = true;
    void (async () => {
      while (live && talkRef.current) {
        let said = '';
        try { said = await listen({ waitSec: 12 }); } catch (e) { setNotice((e as Error).message); setTalk(false); return; }
        if (!live || !talkRef.current) return;
        if (!said) { setTalk(false); setNotice('Talk ended: Lotus heard nothing for a while.'); return; }
        const reply = await go(said, false);
        if (!live || !talkRef.current) return;
        if (reply) await speak(reply);
      }
    })();
    return () => { live = false; };
  }, [talk]); // eslint-disable-line react-hooks/exhaustive-deps

  const needle = q.trim().toLowerCase();
  // Deleting hides the row at once and offers Undo; the work is removed when the note closes.
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const list = work.items.filter((w) => !hidden.has(w.id) && (w.messages.length || w.id === work.activeId) && (!needle || w.title.toLowerCase().includes(needle)));
  const groups = groupByDate<WorkItem>(list.filter((w) => !w.pinned));
  const unhide = (id: string) => setHidden((h) => { const n = new Set(h); n.delete(id); return n; });
  const deleteWork = (id: string) => {
    const keep = work.items.find((w) => w.id === id);
    if (!keep?.messages.length) { work.remove(id); return; }
    setHidden((h) => new Set(h).add(id));
    if (work.activeId === id) work.newWork();
    offerUndo('Work deleted', () => { unhide(id); work.setActiveId(id); }, () => { work.remove(id); unhide(id); });
  };

  const row = (w: WorkItem) => (
    <div key={w.id} role="button" tabIndex={0} onClick={() => work.setActiveId(w.id)} onKeyDown={(e) => { if (e.key === 'Enter') work.setActiveId(w.id); }}
      className={cx('group relative flex items-center gap-2 px-2.5 h-9 rounded-[8px] cursor-default',
        w.id === work.activeId ? 'bg-[var(--pressed)] font-medium' : 'text-[var(--color-text-muted)] hover:bg-[var(--hover)] hover:text-[var(--color-text-main)]')}>
      {work.runningIds.includes(w.id) ? <AgentFace size={16} mood="thinking" /> : null}
      <span className="flex-1 min-w-0 truncate text-[13px]">{w.title}</span>
      {work.allAsks.some((a) => a.workId === w.id) && <span className="w-2 h-2 rounded-full bg-[var(--c-orange)]" title="Waiting for your answer" />}
      <span className="hidden group-hover:flex group-focus-within:flex items-center shrink-0" onClick={(e) => e.stopPropagation()}>
        <IconBtn label={w.pinned ? 'Unpin' : 'Pin'} className="!w-6 !h-6" onClick={() => work.patch(w.id, (x) => ({ ...x, pinned: !x.pinned }))}>{w.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}</IconBtn>
        <IconBtn label="Delete work" className="!w-6 !h-6 hover:!text-[var(--c-red)]" onClick={() => deleteWork(w.id)}><Trash2 className="w-3.5 h-3.5" /></IconBtn>
      </span>
      {w.pinned && <Pin className="w-3 h-3 shrink-0 group-hover:hidden opacity-60" aria-hidden="true" />}
    </div>
  );

  const model = settings.selectedModel;
  const tools = useMemo(() => [settings.browserUse && 'browser', settings.computerUse && 'computer'].filter(Boolean) as string[], [settings.browserUse, settings.computerUse]);
  const empty = !item.messages.length;

  return (
    <div className="flex-1 min-h-0 flex bg-[var(--color-bg-panel)] overflow-hidden">
      <SidebarPane label="Work">
        <div className="p-3 space-y-2">
          <Btn variant="primary" className="w-full" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => { work.newWork(); setText(''); setFiles([]); }}>New Work</Btn>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-muted)]" aria-hidden="true" />
            <input type="search" data-page-search value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search work"
              className="w-full h-7 pl-8 pr-2 rounded-[6px] bg-[var(--hover)] text-[13px] placeholder:text-[var(--color-text-muted)] focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)]" />
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3 space-y-3">
          {list.some((w) => w.pinned) && <div><h3 className="px-1.5 mb-1 text-[12px] font-semibold text-[var(--color-text-muted)]">Pinned</h3><div className="space-y-0.5">{list.filter((w) => w.pinned).map(row)}</div></div>}
          {groups.map((g) => <div key={g.label}><h3 className="px-1.5 mb-1 text-[12px] font-semibold text-[var(--color-text-muted)]">{g.label}</h3><div className="space-y-0.5">{g.items.map(row)}</div></div>)}
          {!list.length && <p className="px-2.5 py-3 text-[13px] text-[var(--color-text-muted)]">{needle ? `No work matches “${q.trim()}”.` : 'No work here yet.'}</p>}
        </div>
      </SidebarPane>

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-[760px] mx-auto px-6 py-6">
            {empty ? (
              <div className="pt-[8vh] text-center">
                <div className="flex justify-center mb-2"><AgentFace size={44} /></div>
                <h2 className="text-[22px] font-semibold tracking-[-0.01em]">What should Lotus work on?</h2>
                <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">Describe the result you want. Lotus plans it, works through it with helper agents, and hands you the finished files.</p>
                <Starters id="work" groups={WORK_STARTERS} className="mt-6" onPick={setText} />
              </div>
            ) : (
              <>
                <Plan item={item} busy={work.busy} />
                <div className="space-y-6">
                  {item.messages.map((m, i) => m.role === 'user'
                    ? <div key={m.id} className="flex flex-col items-end gap-1.5">
                        {m.files?.length ? <div className="flex flex-wrap justify-end gap-1.5">{m.files.map((f, k) => <span key={k} className="inline-flex items-center gap-1.5 h-7 px-2 rounded-[8px] bg-[var(--hover)] text-[12px] max-w-[220px]">{f.kind === 'image' ? <ImageIcon className="w-3.5 h-3.5 shrink-0" /> : <FileText className="w-3.5 h-3.5 shrink-0" />}<span className="truncate">{f.name}</span></span>)}</div> : null}
                        <div className="max-w-[80%] px-3.5 py-2 rounded-[16px] bg-[var(--color-accent-pastel)] text-[14px] whitespace-pre-wrap">{m.content}</div>
                      </div>
                    : <Reply key={m.id} m={m} live={work.busy && i === item.messages.length - 1} onDecide={(s, allow) => void work.decide(s, allow)} onArtifact={setOpenArtifact} />)}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="px-6 pb-4 pt-2 shrink-0">
          <div className="max-w-[760px] mx-auto">
            <AskCard work={work} />
            {ollamaUp === false && settings.llmBackend === 'ollama' && <EngineNotice id="ollama" purpose="to work" className="mb-2" />}
            {ollamaUp === false && settings.llmBackend === 'builtin' && <BuiltinNotice kind="chat" purpose="to work" className="mb-2" />}
            {!agentAvailable() && <p className="mb-2 text-[12px] text-[var(--color-text-muted)]">Work mode runs in the desktop app (it needs the Lotus core).</p>}
            {notice && <p role="status" className="mb-2 text-[12px] text-[var(--c-orange)]">{notice}</p>}
            <PromptShell drag={drag}
              tray={<>
              {item.folder ? (
                <span className="h-7 inline-flex items-center gap-1.5 pl-2 pr-0.5 rounded-[8px] bg-[var(--color-accent-pastel)] text-[var(--color-accent-vibrant)] text-[13px] max-w-[220px]" title={`Lotus can read and edit files in ${item.folder} (saving asks first)`}>
                  <FolderOpen className="w-4 h-4 shrink-0" /><span className="truncate">{folderName(item.folder)}</span>
                  <IconBtn label="Stop using this folder" className="!w-6 !h-6" onClick={() => work.patch(item.id, (x) => ({ ...x, folder: undefined }))}><X className="w-3 h-3" /></IconBtn>
                </span>
              ) : isTauri && (
                <button type="button" title="Let Lotus work in a folder: it opens, searches and edits the files it needs (saving asks first)"
                  onClick={async () => { const p = await pickFolderPath('Give Lotus a folder for this work'); if (p) work.patch(item.id, (x) => ({ ...x, folder: p })); }}
                  className="h-7 px-2 inline-flex items-center gap-1.5 rounded-[8px] text-[13px] text-[var(--color-text-muted)] hover:bg-[var(--hover)] hover:text-[var(--color-text-main)]"><FolderOpen className="w-4 h-4" />Choose Folder</button>
              )}
              <span className="text-[12px] text-[var(--color-text-muted)] px-1 inline-flex items-center gap-1">Can use: files, web, tasks, images{tools.length ? `, ${tools.join(', ')}` : ''}<Tip text="What the agent can do in Work. Turn on browser and computer control in Settings → Tools. Steps that change your files or control your computer ask first unless you changed that there." /></span>
              <span className="flex-1" />
              <button type="button" onClick={onOpenSettings} className="h-7 px-2 inline-flex items-center gap-1.5 rounded-[8px] text-[13px] text-[var(--color-text-muted)] hover:bg-[var(--hover)]"><MonitorSmartphone className="w-3.5 h-3.5" />Tools</button>
            </>}>
              {/* Video memory in use, as a thin bar along the top edge (numbers in the tip). */}
              <VramMeter />
              {(files.length > 0 || drag) && (
                <div className="flex flex-wrap gap-2 px-3.5 pt-3" aria-label="Attachments">
                  {drag && !files.length && <p className="text-[12px] text-[var(--color-text-muted)] px-1 py-2">Drop images, text or code files to attach them. You can also paste them.</p>}
                  {files.map((f, i) => {
                    const url = previews[f.name + f.size];
                    return (
                      <span key={f.name + i} className="inline-flex items-center gap-1.5 h-8 pl-1.5 pr-1 rounded-[8px] bg-[var(--hover)] text-[12px] max-w-[220px]">
                        {url ? <img src={url} alt="" className="w-6 h-6 rounded-[4px] object-cover" /> : <FileText className="w-3.5 h-3.5 ml-1" />}
                        <span className="truncate">{f.name}</span>
                        <IconBtn label={`Remove ${f.name}`} className="!w-5 !h-5" onClick={() => setFiles((l) => l.filter((_, j) => j !== i))}><X className="w-3 h-3" /></IconBtn>
                      </span>
                    );
                  })}
                </div>
              )}
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder={talk ? (vs === 'listening' ? 'Listening… just talk' : vs === 'speaking' ? 'Lotus is speaking…' : 'Talk mode is on') : 'Describe the job, e.g. “Make a study plan for my exams as a document”'}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void go(); } }} aria-label="Describe the work"
                className="w-full resize-none bg-transparent px-4 pt-4 pb-1 text-[14px] leading-relaxed placeholder:text-[var(--color-text-muted)] focus:outline-none max-h-48" />
              <div className="flex items-center gap-1 px-2.5 pb-2.5">
                <input ref={fileInput} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
                <RoundIcon label="Attach files" tip="Attach images, text or code" onClick={() => fileInput.current?.click()}><Plus className="w-[18px] h-[18px]" /></RoundIcon>
                <ModeButton on={talk} onClick={() => setTalk((t) => !t)} icon={<AudioLines className="w-4 h-4" />} label={talk ? (vs === 'listening' ? 'Listening' : vs === 'speaking' ? 'Speaking' : 'Talk') : 'Talk'} title="Talk with Lotus hands-free: it listens, works, answers aloud and listens again (needs Voicebox for listening)" />
                <span className="flex-1" />
                <Popover up align="right" className="w-[280px]" trigger={(o, t) => <PickerButton open={o} onClick={t} title="Model" text={model || 'No model'} chevron={<ChevronDown className={cx('w-3.5 h-3.5 shrink-0 opacity-70', o && 'rotate-180')} />} />}>
                  {(close) => (<>
                    {models.map((m) => <MenuItem key={m.id} active={m.id === model} onClick={() => { onSettings({ selectedModel: m.id }); close(); }}><span className="truncate flex-1">{m.name}</span><span className="text-[12px] opacity-70">{m.tag}</span></MenuItem>)}
                    {!models.length && <p className="p-2.5 text-[12px] text-[var(--color-text-muted)]">No chat models yet.</p>}
                    <div className="my-1 border-t border-[var(--sep)]" />
                    <MenuItem onClick={() => { close(); onOpenModels(); }}>Get more models…</MenuItem>
                  </>)}
                </Popover>
                {work.busy ? <SendButton stop onClick={() => work.stop()} label="Stop working" /> : <SendButton disabled={(!text.trim() && !files.length) || !model} onClick={() => void go()} label="Start" tip="Start (Enter)" />}
              </div>
            </PromptShell>
          </div>
        </div>
      </div>

      <ArtifactsPanel work={work} open={openArtifact} onOpen={setOpenArtifact} />
    </div>
  );
};
