// Work (session 16, replaces App Builder): hand Lotus a job and get finished things back.
// Left: your pieces of work. Middle: the conversation, with the plan as a checklist, every step the
// agent and its helpers took (each agent with its own face), and questions it asks you. Right: the
// artifacts it made (documents, pages, tables, images, code), previewed and saved as real files.

import { Starters } from '../common/Starters';
import { documentText, READABLE } from '../../lib/docText';
import { WORK_STARTERS } from '../../data/starters';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, AudioLines, Brain, Check, ChevronRight, Copy, Download, ExternalLink, FileText, FolderOpen, Image as ImageIcon, Mic, MonitorSmartphone, BookOpen, Puzzle, Pencil, Pin, PinOff, Plus, PanelRightClose, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { Work, WorkAttachment, WorkItem, WorkMsg, agentProgress, helpersOf, planOf } from '../../work/store';
import { interruptedNote, stoppedNote } from '../../work/interrupted';
import { splitThink } from '../../work/think';
import { ThinkingDrawer } from '../chat/ChatStream';
import type { ChatMessage } from '../../types/lotus';
import { useFileIntake } from '../../lib/fileDrop';
import { fileToBase64 } from '../../services/ollamaService';
import { folderName, pickFolderPath } from '../../chat/folder';
import { isTauri } from '../../lib/http';
import type { ArtifactInfo, AgentStep, HelperInfo } from '../../lib/agent';
import { agentAvailable, isMediaArtifact, isOfficeArtifact, workArtifact, workDir, workFile, workOpen } from '../../lib/agent';
import { AgentSteps, UnverifiedNote } from '../chat/AgentSteps';
import { ReplyHeader } from '../common/ReplyHeader';
import { AgentFace } from '../common/AgentFace';
import { MarkdownLite } from '../../lib/markdownLite';
import { InspectorPane, SidebarPane, groupByDate } from '../common/Pane';
import { Btn, IconBtn, Segmented, TextArea, cx, useFlash } from '../common/ui';
import { ModeButton, PromptRow, PromptShell, PromptText, RoundIcon, SendButton, TrayButton, TrayRow, VramMeter } from '../common/PromptBox';
import { useAssistantName } from '../../lib/identity';
import { BuiltinNotice, EngineNotice } from '../common/EngineNotice';
import { Tip } from '../common/Tip';
import { useCommand } from '../../lib/commands';
import { offerUndo } from '../common/Alerts';
import { listen, matchOption, speak, voiceState, VoiceState, hush } from '../../voice/voice';
import { revealPath } from '../../lib/open';
import type { ModelOption } from './ChatWorkspace';
import type { LotusSettings } from '../../types/lotus';
import { attachWithDialog } from '../../lib/pickFiles';
import { FileCard, KindTile, OfficePreview, kindLabel, openLabel, opensOutside } from './workFiles';
import { usePanels } from '../../lib/panels';
import { AttachmentChips, DictateButton, ModelMenu, useAttachments, useAutoGrow } from '../common/PromptParts';
import type { LibraryTab } from '../library/LibraryPane';


// KIND_ICON, the file cards and the Office previews live in workFiles.tsx (0.21).

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
/** 0.21: videos, voiceovers and pictures from the video tools, played in place. */
export const MediaArtifact: React.FC<{ workId: string; a: ArtifactInfo; nonce: number }> = ({ workId, a, nonce }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null, live = true;
    setUrl(null); setErr(null);
    workFile(workId, a.file).then((b) => { u = URL.createObjectURL(b); if (live) setUrl(u); }).catch((e) => setErr((e as Error).message));
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [workId, a.file, a.updated, nonce]);
  const reveal = async () => { const d = await workDir(workId).catch(() => null); if (d) void revealPath(`${d}/${a.file}`); };
  if (err) return <p className="p-4 text-[13px] text-[var(--c-red)]">{err}</p>;
  if (!url) return <p className="p-4 text-[13px] text-[var(--color-text-muted)]">Opening…</p>;
  const download = () => { const el = document.createElement('a'); el.href = url; el.download = a.file; el.click(); };
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-[var(--sep)]">
        <span className="text-[12px] text-[var(--color-text-muted)] truncate flex-1">{a.file} · {(a.bytes / 1e6).toFixed(1)} MB</span>
        <IconBtn label="Show in folder" onClick={() => void reveal()}><FolderOpen className="w-3.5 h-3.5" /></IconBtn>
        <IconBtn label="Download" onClick={download}><Download className="w-3.5 h-3.5" /></IconBtn>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-3 flex items-start justify-center bg-[var(--color-bg-main)]">
        {a.kind === 'video' ? <video key={url} src={url} controls playsInline className="w-full max-h-full rounded-[8px] bg-black" aria-label={a.title} />
          : a.kind === 'audio' ? <audio key={url} src={url} controls className="w-full mt-6" aria-label={a.title} />
          : <img src={url} alt={a.title} className="max-w-full rounded-[8px]" />}
      </div>
    </div>
  );
};

/** The bar over a Word, Excel or PowerPoint preview: open it in its app, show it in the folder, download it. */
const OpenBar: React.FC<{ workId: string; a: ArtifactInfo; onDownload: () => void }> = ({ workId, a, onDownload }) => {
  const [err, setErr] = useState<string | null>(null);
  const reveal = async () => { const d = await workDir(workId).catch(() => null); if (d) void revealPath(`${d}/${a.file}`).catch((e) => setErr((e as Error).message)); };
  return (
    <div className="px-3 py-2 flex items-center gap-2 border-b border-[var(--sep)]">
      <KindTile kind={a.kind} size={24} />
      <span className="text-[12px] text-[var(--color-text-muted)] truncate flex-1">{kindLabel(a.kind)} · {Math.max(1, Math.round(a.bytes / 1024))} KB</span>
      {isTauri && <Btn size="sm" variant="primary" icon={<ExternalLink className="w-3.5 h-3.5" />} onClick={() => void workOpen(workId, a.file).catch((e) => setErr((e as Error).message))}>{openLabel(a.kind)}</Btn>}
      {isTauri && <IconBtn label="Show in folder" onClick={() => void reveal()}><FolderOpen className="w-3.5 h-3.5" /></IconBtn>}
      <IconBtn label="Download" onClick={onDownload}><Download className="w-3.5 h-3.5" /></IconBtn>
      {err && <p role="alert" className="sr-only">{err}</p>}
    </div>
  );
};

const ArtifactView: React.FC<{ workId: string; a: ArtifactInfo; nonce: number }> = (props) => (isMediaArtifact(props.a) ? <MediaArtifact {...props} /> : <TextArtifact {...props} />);

const TextArtifact: React.FC<{ workId: string; a: ArtifactInfo; nonce: number }> = ({ workId, a, nonce }) => {
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'preview' | 'source'>('preview');
  useEffect(() => { setText(null); setErr(null); workArtifact(workId, a.file).then(setText).catch((e) => setErr((e as Error).message)); }, [workId, a.file, a.updated, nonce]);
  if (err) return <p className="p-4 text-[13px] text-[var(--c-red)]">{err}</p>;
  if (text === null) return <p className="p-4 text-[13px] text-[var(--color-text-muted)]">Opening…</p>;
  const previewable = a.kind === 'document' || a.kind === 'page' || a.kind === 'table' || a.kind === 'image';
  const office = isOfficeArtifact(a);
  // Office files are binary: download the real file, not the text it was made from.
  const download = async () => { const blob = office ? await workFile(workId, a.file).catch(() => null) : new Blob([text]); if (!blob) return; const el = document.createElement('a'); el.href = URL.createObjectURL(blob); el.download = a.file; el.click(); };
  if (office) return (
    <div className="flex-1 min-h-0 flex flex-col">
      <OpenBar workId={workId} a={a} onDownload={() => void download()} />
      <OfficePreview kind={a.kind} text={text} />
    </div>
  );
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-[var(--sep)]">
        {previewable && <Segmented label="View" value={mode} onChange={setMode} options={[{ id: 'preview', label: 'Preview' }, { id: 'source', label: 'Source' }]} />}
        <span className="flex-1" />
        {opensOutside(a.kind) && isTauri && <Btn size="sm" variant="secondary" icon={<ExternalLink className="w-3.5 h-3.5" />} onClick={() => void workOpen(workId, a.file)}>{openLabel(a.kind)}</Btn>}
        <IconBtn label="Copy" onClick={() => void navigator.clipboard.writeText(text)}><Copy className="w-3.5 h-3.5" /></IconBtn>
        <IconBtn label="Download" onClick={() => void download()}><Download className="w-3.5 h-3.5" /></IconBtn>
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
  // 0.21: the panel follows the title bar's inspector button (and this close button), remembered per page.
  const { setRight } = usePanels();
  const hide = <IconBtn label="Hide artifacts" onClick={() => setRight(false)}><PanelRightClose className="w-3.5 h-3.5" /></IconBtn>;
  return (
    <InspectorPane label="Artifacts" className="w-[380px]">
      <div className="h-11 shrink-0 flex items-center gap-1.5 px-3 border-b border-[var(--sep)]">
        {cur ? <><IconBtn label="All artifacts" onClick={() => onOpen(null)}><X className="w-3.5 h-3.5" /></IconBtn><span className="text-[13px] font-semibold truncate flex-1">{cur.title}</span><IconBtn label="Reload" onClick={() => setNonce((n) => n + 1)}><RefreshCw className="w-3.5 h-3.5" /></IconBtn>{hide}</>
          : <><span className="text-[13px] font-semibold flex-1 inline-flex items-center gap-1">Artifacts<Tip label="Artifacts" /></span><IconBtn label="Show in folder" onClick={() => void reveal()}><FolderOpen className="w-3.5 h-3.5" /></IconBtn>{hide}</>}
      </div>
      {cur ? <ArtifactView workId={work.activeId} a={cur} nonce={nonce} /> : (
        <div className="flex-1 min-h-0 overflow-y-auto p-2">
          {!list.length && <p className="p-3 text-[13px] text-[var(--color-text-muted)] leading-snug">What Lotus makes for this work shows up here: Word documents, Excel sheets, PowerPoint decks, web pages, images, videos and code, saved in your Lotus Studio folder.</p>}
          {list.map((a) => (
            <button key={a.file} type="button" onClick={() => onOpen(a.file)} className="w-full flex items-center gap-2.5 p-2 rounded-[8px] text-left hover:bg-[var(--hover)]">
              <KindTile kind={a.kind} />
              <span className="min-w-0"><span className="block text-[13px] font-medium truncate">{a.title}</span><span className="block text-[12px] text-[var(--color-text-muted)] truncate">{kindLabel(a.kind)} · {a.file} · {new Date(a.updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></span>
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

/**
 * 0.11.0: the agents Lotus deployed for this reply, each with its face, its task and how far it got.
 * A row opens to show the agent's own steps and what it returned.
 */
const STATUS_WORD: Record<HelperInfo['status'], string> = { queued: 'Waiting its turn', running: 'Working', done: 'Done', error: 'Failed', stopped: 'Stopped' };
const AgentsPanel: React.FC<{ agents: HelperInfo[]; steps: AgentStep[]; live: boolean; interrupted?: boolean; onDecide: (s: AgentStep, allow: boolean, always?: boolean) => void }> = ({ agents, steps, live, interrupted, onDecide }) => {
  const [open, setOpen] = useState<string | null>(null);
  const p = agentProgress(agents);
  // A cut-off reply counts only the agents that really finished (stopped ones are not done).
  const finished = interrupted ? agents.filter((h) => h.status === 'done').length : p.done;
  return (
    <div className="my-3 rounded-[12px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)] overflow-hidden" aria-label="Agents">
      <div className="px-3 pt-2.5 pb-2">
        <p className="flex items-center gap-2 text-[12px] font-semibold text-[var(--color-text-muted)]">
          <span className="flex-1">{p.total === 1 ? '1 agent' : `${p.total} agents`} · {interrupted ? `${finished} of ${p.total} finished` : `${p.done} of ${p.total} done`}</span>
          {live && p.running > 0 && <span className="font-normal">{p.running} working</span>}
          {interrupted && <span className="font-normal">Cut off</span>}
        </p>
        {live && agents.some((h) => h.status === 'queued') && (
          // 0.20.0: say why some agents wait, instead of leaving three numbers that disagree.
          <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5" role="status">Agents take turns when the chat engine can't run them all at once. Lotus's own engine runs one at a time.</p>
        )}
        <div className="mt-1.5 h-1 rounded-full bg-[var(--hover)] overflow-hidden" role="progressbar" aria-label="Agents done" aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={finished}>
          <div className="h-full rounded-full bg-[var(--color-accent-vibrant)] transition-[width] duration-300" style={{ width: `${p.total ? (finished / p.total) * 100 : 0}%` }} />
        </div>
      </div>
      <ul>
        {agents.map((h) => {
          const mine = steps.filter((s) => s.data?.helperId === h.id || (!s.data?.helperId && s.data?.helper === h.name));
          const busy = live && h.status === 'running';
          const isOpen = open === h.id;
          return (
            <li key={h.id} className="border-t border-[var(--sep)]">
              <button type="button" onClick={() => setOpen(isOpen ? null : h.id)} aria-expanded={isOpen}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--hover)]">
                <AgentFace name={h.name} size={26} animate={busy} mood={busy ? 'thinking' : h.status === 'error' ? 'sad' : undefined} />
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-1.5 text-[13px]"><span className="font-semibold truncate">{h.name}</span><span className="text-[var(--color-text-muted)] truncate">· {h.goal}</span></span>
                  <span className={cx('block text-[12px] truncate', h.status === 'error' ? 'text-[var(--c-red)]' : 'text-[var(--color-text-muted)]')}>
                    {h.status === 'running' && live ? `${h.current ?? 'Working'}…` : h.status === 'running' ? 'Stopped' : interrupted && h.status === 'stopped' ? 'Cut off when Lotus closed' : STATUS_WORD[h.status]}{h.steps ? ` · ${h.steps} step${h.steps === 1 ? '' : 's'}` : ''}
                  </span>
                </span>
                {h.status === 'done' ? <Check className="w-4 h-4 text-[var(--c-green)] shrink-0" aria-label="Done" />
                  : h.status === 'error' ? <AlertCircle className="w-4 h-4 text-[var(--c-red)] shrink-0" aria-label="Failed" />
                  : busy ? <span className="w-4 h-4 rounded-full border-2 border-[var(--color-accent-vibrant)] border-t-transparent animate-spin shrink-0" aria-label="Working" />
                  : <span className="w-4 h-4 rounded-full border border-[var(--sep)] shrink-0" aria-hidden="true" />}
                <ChevronRight className={cx('w-3.5 h-3.5 text-[var(--color-text-muted)] transition-transform shrink-0', isOpen && 'rotate-90')} aria-hidden="true" />
              </button>
              {isOpen && (
                <div className="px-3 pb-3 pl-[50px]">
                  {mine.length ? <AgentSteps steps={mine as never} onDecide={live ? (s, allow, always) => onDecide(s as unknown as AgentStep, allow, always) : undefined} /> : <p className="text-[12px] text-[var(--color-text-muted)]">No steps yet.</p>}
                  {h.result && <div className="mt-2 text-[13px] leading-relaxed"><p className="text-[12px] font-semibold text-[var(--color-text-muted)] mb-0.5">Returned</p><MarkdownLite text={h.result} onDark={false} /></div>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

const Reply: React.FC<{ m: WorkMsg; live: boolean; busy: boolean; reasoning: 'collapsed' | 'expanded' | 'hidden'; onDecide: (s: AgentStep, allow: boolean, always?: boolean) => void; onArtifact: (f: string) => void; onOpenFile?: (f: string) => void; onRetry: () => void; savedFiles: number }> = ({ m, live, busy, reasoning, onDecide, onArtifact, onOpenFile, onRetry, savedFiles }) => {
  const steps = m.steps ?? [];
  const [copied, flash] = useFlash();
  const agents = m.agents ?? [];
  // Code Lotus moved out of the answer into files (0.21) shows only as file cards.
  // Saved files show as cards under the answer, so a finished reply doesn't list them as steps too.
  const own = steps.filter((s) => !s.data?.helper && !s.data?.fromAnswer && s.tool !== 'plan.set' && s.tool !== 'plan.check' && (live || !(s.tool === 'artifact.write' && s.status === 'done')));
  const { answer, thought } = splitThink(m.content);
  const helpers = helpersOf(steps);
  // One card per file (its latest version), in the order they were first made.
  const made = [...new Map(steps.filter((s) => s.tool === 'artifact.write' && s.status === 'done').map((s) => s.data?.artifact as { file: string; title: string; kind: string }).filter(Boolean).map((a) => [a.file, a] as const)).values()];
  return (
    <div className="min-w-0">
      <ReplyHeader live={live} mood={live ? 'thinking' : m.error ? 'sad' : undefined} />
      <div className="min-w-0">
        <ThinkingDrawer m={{ id: m.id, role: 'assistant', content: m.content, timestamp: '', thinking: [m.thinking, thought].filter(Boolean).join('\n\n') || undefined, thinkingMs: m.thinkingMs, isStreaming: live && m.thinkingMs === undefined } as ChatMessage} mode={reasoning} />
        {agents.length > 0 && <AgentsPanel agents={agents} steps={steps} live={live} interrupted={m.interrupted} onDecide={onDecide} />}
        {(() => {
          // Each helper's steps sit right under the step that started it, with the helper's own face.
          const out: React.ReactNode[] = [];
          let seg: AgentStep[] = [];
          let k = 0;
          const flush = () => { if (seg.length) out.push(<AgentSteps key={`s${out.length}`} steps={seg as never} onDecide={live ? (s, allow, always) => onDecide(s as unknown as AgentStep, allow, always) : undefined} />); seg = []; };
          for (const st of own) {
            seg.push(st);
            if (st.tool !== 'agent.delegate' || agents.length) continue;
            flush();
            k++;
            const want = String(st.args?.name ?? '').trim().slice(0, 40) || `Helper ${k}`;
            const h = helpers.find((x) => x.name === want) ?? (st.status === 'running' ? { name: want, goal: String(st.args?.goal ?? ''), steps: [] } : null);
            if (h) out.push(
              <div key={`h${k}`} className="my-2 ml-1.5 pl-3 border-l-2 border-[var(--sep)]">
                <p className="flex items-center gap-2 text-[12px] font-semibold mb-1"><AgentFace name={h.name} size={16} animate={live && st.status === 'running'} mood={live && st.status === 'running' ? 'thinking' : undefined} />{h.name}<span className="font-normal text-[var(--color-text-muted)] truncate">· {h.goal}</span></p>
                <AgentSteps steps={h.steps as never} onDecide={live ? (s, allow, always) => onDecide(s as unknown as AgentStep, allow, always) : undefined} />
                {!h.steps.length && <p className="text-[12px] text-[var(--color-text-muted)]">Starting…</p>}
              </div>,
            );
          }
          flush();
          return out;
        })()}
        {answer && <div className="text-[14px] leading-relaxed"><MarkdownLite text={answer} onDark={false} /></div>}
        {made.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3 mb-1" aria-label="Files made">
            {made.map((a) => <FileCard key={a.file} file={a.file} title={a.title} kind={a.kind} onPreview={() => onArtifact(a.file)} onOpen={isTauri && onOpenFile ? () => onOpenFile(a.file) : undefined} />)}
          </div>
        )}
        {live && !m.content && !steps.length && <p className="text-[13px] text-[var(--color-text-muted)]">Thinking about how to do this…</p>}
        {m.error && <p className="mt-1 text-[13px] text-[var(--c-red)]">{m.error}</p>}
        {m.interrupted && !live && (
          // 0.15.1: Lotus (the app or its core) closed while this was running; it can't pick up where it left off.
          <div role="status" className="mt-2 flex items-start gap-2.5 rounded-[10px] px-3 py-2.5 bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)]">
            <AlertCircle className="w-4 h-4 mt-0.5 text-[var(--c-orange)] shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0 text-[13px] leading-snug">
              <p className="font-semibold">Interrupted</p>
              <p className="text-[var(--color-text-muted)]">{interruptedNote(m, savedFiles)}</p>
            </div>
            {!busy && <Btn size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={onRetry}>Try again</Btn>}
          </div>
        )}
        {m.stopped && !m.interrupted && !m.content && !m.error && <p role="status" className="mt-1 text-[13px] text-[var(--color-text-muted)]">{stoppedNote(m)}</p>}
        {m.unverified?.length ? <UnverifiedNote items={m.unverified} /> : null}
        {!live && (m.content || m.error || (m.stopped && !m.interrupted)) && (
          <div className="mt-1.5 flex items-center gap-0.5 text-[var(--color-text-muted)]">
            <IconBtn label={copied ? 'Copied' : 'Copy'} className="!w-6 !h-6" onClick={() => { void navigator.clipboard.writeText(m.content); flash(); }}>{copied ? <Check className="w-3.5 h-3.5 text-[var(--c-green)]" /> : <Copy className="w-3.5 h-3.5" />}</IconBtn>
            {!busy && <IconBtn label="Try again" className="!w-6 !h-6" onClick={onRetry}><RefreshCw className="w-3.5 h-3.5" /></IconBtn>}
            {m.content && <IconBtn label="Read aloud" className="!w-6 !h-6" onClick={() => void speak(m.content)}><AudioLines className="w-3.5 h-3.5" /></IconBtn>}
            {m.tokensPerSec ? <span className="ml-1.5 text-[12px] tabular-nums">{m.tokensPerSec} tok/s</span> : null}
          </div>
        )}
      </div>
    </div>
  );
};

/** A request you sent, with Edit (sends the new text in its place) and Copy. */
const Request: React.FC<{ m: WorkMsg; busy: boolean; onEdit: (text: string) => void }> = ({ m, busy, onEdit }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content);
  const [copied, flash] = useFlash();
  return (
    <div className="group flex flex-col items-end gap-1.5">
      {m.files?.length ? <div className="flex flex-wrap justify-end gap-1.5">{m.files.map((f, k) => <span key={k} className="inline-flex items-center gap-1.5 h-7 px-2 rounded-[8px] bg-[var(--hover)] text-[12px] max-w-[220px]">{f.kind === 'image' ? <ImageIcon className="w-3.5 h-3.5 shrink-0" /> : <FileText className="w-3.5 h-3.5 shrink-0" />}<span className="truncate">{f.name}</span></span>)}</div> : null}
      {editing ? (
        <div className="w-full max-w-[80%] flex flex-col gap-2">
          <TextArea autoFocus rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Edit your request"
            onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); if (e.key === 'Enter' && !e.shiftKey && draft.trim()) { e.preventDefault(); onEdit(draft.trim()); setEditing(false); } }} />
          <div className="flex justify-end gap-2"><Btn size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Btn><Btn size="sm" variant="primary" disabled={!draft.trim() || busy} onClick={() => { onEdit(draft.trim()); setEditing(false); }}>Send</Btn></div>
        </div>
      ) : <div className="max-w-[80%] px-3.5 py-2 rounded-[16px] bg-[var(--color-accent-pastel)] text-[14px] whitespace-pre-wrap">{m.content}</div>}
      {!editing && (
        <div className="flex items-center gap-0.5 text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          {!busy && <IconBtn label="Edit request" className="!w-6 !h-6" onClick={() => { setDraft(m.content); setEditing(true); }}><Pencil className="w-3.5 h-3.5" /></IconBtn>}
          <IconBtn label={copied ? 'Copied' : 'Copy'} className="!w-6 !h-6" onClick={() => { void navigator.clipboard.writeText(m.content); flash(); }}>{copied ? <Check className="w-3.5 h-3.5 text-[var(--c-green)]" /> : <Copy className="w-3.5 h-3.5" />}</IconBtn>
        </div>
      )}
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
interface Props { work: Work; settings: LotusSettings; onSettings: (p: Partial<LotusSettings>) => void; models: ModelOption[]; ollamaUp: boolean | null; onOpenModels: () => void; onOpenSettings: () => void; /** Skills and Plugins in the tray, as in Chat (0.21). */ onOpenLibrary?: (tab: LibraryTab) => void }

export const WorkWorkspace: React.FC<Props> = ({ work, settings, onSettings, models, ollamaUp, onOpenModels, onOpenSettings, onOpenLibrary }) => {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [openArtifact, setOpenArtifact] = useState<string | null>(null);
  const [talk, setTalk] = useState(false);
  const name = useAssistantName();
  const [vs, setVs] = useState<VoiceState>(voiceState.get());
  const [notice, setNotice] = useState<string | null>(null);
  // 0.21: the same attachment chips, dictation, model menu and growing text field as Chat (PromptParts).
  const att = useAttachments();
  const files = att.files;
  const ta = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(ta, text);
  const fileInput = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => voiceState.on(setVs), []);
  const item = work.active;
  useEffect(() => { setOpenArtifact(null); }, [work.activeId]);
  // A file card opens the Artifacts panel on that file (the panel may have been hidden).
  const { setRight } = usePanels();
  const showArtifact = (f: string) => { setOpenArtifact(f); setRight(true); };
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }, [item.messages, work.asks.length]);
  useCommand('new-work', () => { work.newWork(); setText(''); att.clear(); });

  const addFiles = att.add;
  // Drop files anywhere on the Work page, or paste them: all of them are attached.
  const drag = useFileIntake(addFiles);
  // Images go to the model as pictures; text and code files are read and sent with the request.
  const readFiles = async (list: File[]): Promise<{ out: WorkAttachment[]; errors: string[] }> => {
    const out: WorkAttachment[] = [], errors: string[] = [];
    for (const f of list) {
      if (f.type.startsWith('image/')) out.push({ name: f.name, kind: 'image', data: await fileToBase64(f) });
      else {
        try {
          const text = await documentText(f);
          if (text === null) errors.push(`${f.name}: Lotus can read ${READABLE}; this kind of file isn't one of them.`);
          else out.push({ name: f.name, kind: 'text', data: text });
        } catch (e) { errors.push(e instanceof Error ? e.message : `${f.name}: couldn't be read.`); }
      }
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
      attach = r.out; att.clear();
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
    <div key={w.id} role="button" tabIndex={0} onClick={() => work.setActiveId(w.id)} aria-keyshortcuts="Delete"
      onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter') work.setActiveId(w.id); else if (e.key === 'Delete') { e.preventDefault(); deleteWork(w.id); } }}
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
          <Btn variant="primary" className="w-full" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => { work.newWork(); setText(''); att.clear(); }}>New Work</Btn>
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
                <h2 className="text-[22px] font-semibold tracking-[-0.01em]">What should {name} work on?</h2>
                <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">Describe the result you want. {name} plans it, deploys agents for the parts that can run side by side, and hands you the finished files.</p>
                <Starters id="work" groups={WORK_STARTERS} className="mt-6" onPick={setText} />
              </div>
            ) : (
              <>
                <Plan item={item} busy={work.busy} />
                <div className="space-y-6">
                  {item.messages.map((m, i) => m.role === 'user'
                    ? <Request key={m.id} m={m} busy={work.busy} onEdit={(t) => void work.edit(m.id, t).catch((e) => setNotice((e as Error).message))} />
                    : <Reply key={m.id} m={m} live={work.busy && i === item.messages.length - 1} busy={work.busy} reasoning={settings.reasoningBlockMode ?? 'collapsed'}
                        onDecide={(s, allow, always) => void work.decide(s, allow, always)} onArtifact={showArtifact} onOpenFile={(f) => void workOpen(work.activeId, f).catch((e) => setNotice((e as Error).message))} savedFiles={work.artifacts.length} onRetry={() => void work.retry(m.id).catch((e) => setNotice((e as Error).message))} />)}
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
            {notice && <p role="status" className="mb-2 px-1 text-[12px] text-[var(--c-orange)]">{notice}</p>}
            <PromptShell drag={drag}
              tray={<TrayRow
              actions={<>
              {item.folder ? (
                <span className="h-7 inline-flex items-center gap-1.5 pl-2 pr-0.5 rounded-[8px] bg-[var(--color-accent-pastel)] text-[var(--color-accent-vibrant)] text-[13px] max-w-[220px]" title={`${name} can read and edit files in ${item.folder} (saving asks first)`}>
                  <FolderOpen className="w-4 h-4 shrink-0" /><span className="truncate">{folderName(item.folder)}</span>
                  <IconBtn label="Stop using this folder" className="!w-6 !h-6" onClick={() => work.patch(item.id, (x) => ({ ...x, folder: undefined }))}><X className="w-3 h-3" /></IconBtn>
                </span>
              ) : isTauri && (
                <TrayButton title={`Let ${name} work in a folder: it opens, searches and edits the files it needs (saving asks first)`}
                  onClick={async () => { const p = await pickFolderPath(`Give ${name} a folder for this work`); if (p) work.patch(item.id, (x) => ({ ...x, folder: p })); }}
                  icon={<FolderOpen className="w-4 h-4" />} label="Choose Folder" />
              )}
              {onOpenLibrary && <TrayButton onClick={() => onOpenLibrary('skills')} icon={<BookOpen className="w-4 h-4" />} label="Skills" title={`The skills, memory and soul ${name} uses (Assistant page)`} />}
              {onOpenLibrary && <TrayButton onClick={() => onOpenLibrary('plugins')} icon={<Puzzle className="w-4 h-4" />} label="Plugins" title="Your plugins and their / commands" />}
              <TrayButton onClick={onOpenSettings} icon={<MonitorSmartphone className="w-4 h-4" />} label="Tools" title={`What the agent can use: files, web, tasks, images${tools.length ? `, ${tools.join(', ')}` : ''}. Turn on browser and computer control, and choose which steps ask first, in Settings → Tools.`} />
              </>} />}>
              {/* Video memory in use, as a thin bar along the top edge (numbers in the tip). */}
              <VramMeter />
              <AttachmentChips files={files} previews={att.previews} drag={drag} onRemove={att.remove} />
              <PromptText ref={ta} value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder={talk ? (vs === 'listening' ? 'Listening… just talk' : vs === 'speaking' ? `${name} is speaking…` : 'Talk mode is on') : `Describe the job for ${name}`}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && (settings.sendOnEnter !== false || e.ctrlKey || e.metaKey)) { e.preventDefault(); void go(); } }} aria-label="Describe the work" />
              <PromptRow
                attach={<>
                <input ref={fileInput} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
                <RoundIcon label="Attach files" tip="Attach images, PDFs, documents, spreadsheets, text or code (or paste or drop them)" onClick={() => void attachWithDialog(addFiles, () => fileInput.current?.click(), setNotice)}><Plus className="w-[18px] h-[18px]" /></RoundIcon>
                </>}
                chips={<>
                <ModeButton on={!!item.think} onClick={() => work.patch(item.id, (x) => ({ ...x, think: !x.think }))} icon={<Brain className="w-4 h-4" />} label="Think" title="Let the model think before it acts; its reasoning shows above the reply (slower, often better plans)" />
                <ModeButton on={talk} onClick={() => setTalk((t) => !t)} icon={<AudioLines className="w-4 h-4" />} label={talk ? (vs === 'listening' ? 'Listening' : vs === 'speaking' ? 'Speaking' : 'Talk') : 'Talk'} title={`Talk with ${name} hands-free: it listens, works, answers aloud and listens again`} />
                </>}
                picker={<ModelMenu model={model} models={models} onModel={(id) => onSettings({ selectedModel: id })} onOpenModels={onOpenModels} title={model ? `Model for this work (${model})` : 'Model for this work'} onPicked={() => ta.current?.focus()} />}
                mic={<DictateButton disabled={talk} onText={(said) => setText((p) => (p ? `${p} ${said}` : said))} onNotice={setNotice} />}
                send={work.busy ? <SendButton stop onClick={() => work.stop()} label="Stop working" /> : <SendButton disabled={(!text.trim() && !files.length) || !model} onClick={() => void go()} label="Start" tip={settings.sendOnEnter !== false ? 'Start (Enter)' : 'Start (Ctrl+Enter)'} />} />
            </PromptShell>
          </div>
        </div>
      </div>

      <ArtifactsPanel work={work} open={openArtifact} onOpen={setOpenArtifact} />
    </div>
  );
};
