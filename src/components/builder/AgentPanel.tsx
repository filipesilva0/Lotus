import React, { useEffect, useRef, useState } from 'react';
import { Ban, Check, ChevronRight, FileEdit, FilePlus2, FileSearch, ListTree, Play, Rocket, Send, Square, Terminal as TerminalIcon, Trash2, X } from 'lucide-react';
import { Banner, Btn, Card, IconBtn, Segmented, Spinner, TextArea, cx } from '../common/ui';
import type { AgentItem } from '../../builder/types';
import type { PendingApproval } from '../../builder/useAgent';

const ICON: Record<string, React.ReactNode> = {
  write_file: <FilePlus2 className="w-3.5 h-3.5" />, replace_in_file: <FileEdit className="w-3.5 h-3.5" />, read_file: <FileSearch className="w-3.5 h-3.5" />,
  list_files: <ListTree className="w-3.5 h-3.5" />, delete_path: <Trash2 className="w-3.5 h-3.5" />, run_command: <TerminalIcon className="w-3.5 h-3.5" />,
  start_server: <Play className="w-3.5 h-3.5" />, preview: <Rocket className="w-3.5 h-3.5" />,
};

const Plan: React.FC<{ item: Extract<AgentItem, { kind: 'plan' }>; disabled: boolean; onApprove: (md: string) => void }> = ({ item, disabled, onApprove }) => {
  const [md, setMd] = useState(item.markdown);
  const proposed = item.state === 'proposed';
  return (
    <Card className="p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--color-text-muted)] mb-1.5">{proposed ? 'Plan for your approval' : 'Plan'}</p>
      {proposed ? (<>
        <TextArea aria-label="Plan (you can edit it)" value={md} onChange={(e) => setMd(e.target.value)} rows={Math.min(12, Math.max(4, md.split('\n').length + 1))} className="font-mono !text-[12px]" />
        <div className="mt-2 flex items-center gap-2">
          <Btn variant="primary" size="sm" icon={<Check className="w-3 h-3" />} disabled={disabled || !md.trim()} onClick={() => onApprove(md)}>Approve and build</Btn>
          <span className="text-[11px] text-[var(--color-text-muted)]">Edit the steps first if you like.</span>
        </div>
      </>) : (
        <ul className="space-y-1">
          {item.markdown.split('\n').filter((l) => l.trim()).map((l, i) => {
            const m = /^\s*[-*]\s*\[( |x|X)\]\s*(.*)$/.exec(l);
            return m
              ? <li key={i} className="flex gap-2 text-[12px] leading-snug"><span className={cx('mt-0.5 w-3.5 h-3.5 shrink-0 rounded-[4px] border flex items-center justify-center', m[1] !== ' ' ? 'bg-[var(--color-accent-fill)] border-transparent text-white' : 'border-[var(--sep)]')} aria-label={m[1] !== ' ' ? 'Done' : 'To do'}>{m[1] !== ' ' && <Check className="w-2.5 h-2.5" />}</span><span className={m[1] !== ' ' ? 'text-[var(--color-text-muted)] line-through' : ''}>{m[2]}</span></li>
              : <li key={i} className="text-[12px] text-[var(--color-text-muted)]">{l}</li>;
          })}
        </ul>
      )}
    </Card>
  );
};

const Action: React.FC<{ item: Extract<AgentItem, { kind: 'action' }> }> = ({ item }) => {
  const [open, setOpen] = useState(item.status === 'error');
  useEffect(() => { if (item.status === 'error') setOpen(true); }, [item.status]);
  const has = !!item.output;
  return (
    <div className="rounded-[8px] bg-[var(--hover)]">
      <button type="button" onClick={() => has && setOpen((o) => !o)} aria-expanded={has ? open : undefined} className="w-full h-8 px-2.5 flex items-center gap-2 text-left text-[12px]">
        <span className="text-[var(--color-text-muted)] shrink-0">{ICON[item.tool] ?? <TerminalIcon className="w-3.5 h-3.5" />}</span>
        <span className="flex-1 min-w-0 truncate font-mono">{item.label}</span>
        {(item.added !== undefined || item.removed !== undefined) && <span className="shrink-0 tabular-nums text-[11px]"><span className="text-[var(--c-green)]">+{item.added ?? 0}</span> <span className="text-[var(--c-red)]">−{item.removed ?? 0}</span></span>}
        {item.detail && item.added === undefined && <span className="shrink-0 text-[11px] text-[var(--color-text-muted)]">{item.detail}</span>}
        <span className="shrink-0" aria-label={item.status}>
          {item.status === 'running' ? <Spinner className="w-3.5 h-3.5 text-[var(--color-accent-vibrant)]" /> : item.status === 'ok' ? <Check className="w-3.5 h-3.5 text-[var(--c-green)]" /> : item.status === 'denied' ? <Ban className="w-3.5 h-3.5 text-[var(--c-orange)]" /> : <X className="w-3.5 h-3.5 text-[var(--c-red)]" />}
        </span>
        {has && <ChevronRight className={cx('w-3 h-3 shrink-0 transition-transform text-[var(--color-text-muted)]', open && 'rotate-90')} />}
      </button>
      {has && open && <pre className="mx-2.5 mb-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-[var(--color-text-muted)]">{item.output}</pre>}
    </div>
  );
};

const SUGGESTIONS = ['A to-do list that saves to the browser', 'A landing page for a coffee shop', 'A simple calculator with a clean design'];

export const AgentPanel: React.FC<{
  items: AgentItem[]; running: boolean; approval: PendingApproval | null;
  mode: 'plan' | 'fast'; onMode: (m: 'plan' | 'fast') => void;
  model: string; ollamaUp: boolean | null; hasProject: boolean;
  onSend: (t: string) => void; onStop: () => void; onApprovePlan: (id: string, md: string) => void; onReset: () => void; onOpenEngines: () => void;
}> = ({ items, running, approval, mode, onMode, model, ollamaUp, hasProject, onSend, onStop, onApprovePlan, onReset, onOpenEngines }) => {
  const [text, setText] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => { const el = list.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [items, approval]);

  const planWaiting = items.some((i) => i.kind === 'plan' && i.state === 'proposed');
  const canSend = hasProject && !!model && ollamaUp !== false && !running && !!text.trim();
  const send = (t = text) => { if (!t.trim() || !hasProject || running) return; onSend(t.trim()); setText(''); stick.current = true; };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="h-10 shrink-0 flex items-center gap-2 px-3 border-b border-[var(--sep)]">
        <Segmented<'plan' | 'fast'> label="How the agent works" value={mode} onChange={onMode} options={[{ id: 'plan', label: 'Plan first' }, { id: 'fast', label: 'Build directly' }]} />
        <span className="flex-1" />
        <Btn size="sm" variant="ghost" onClick={onReset} disabled={running || !items.length}>New chat</Btn>
      </div>

      <div ref={list} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2.5" aria-live="polite" aria-label="Agent conversation">
        {ollamaUp === false && <Banner tone="warn" action={<Btn size="sm" variant="secondary" onClick={onOpenEngines}>Engines</Btn>}>Ollama isn't running, so the agent can't think. Start it in Engines.</Banner>}
        {ollamaUp !== false && !model && <Banner tone="info">Pick a model at the top. A code-tuned model of 7B or more (for example qwen2.5-coder) works best for building.</Banner>}
        {!items.length && hasProject && (
          <div className="pt-2">
            <p className="text-[13px] font-medium mb-1">What should we build?</p>
            <p className="text-[12px] text-[var(--color-text-muted)] leading-snug mb-3">Describe it in plain words. The agent writes the files, runs the commands and shows the result in the preview. {mode === 'plan' ? 'It shows you a plan first.' : 'It starts building straight away.'}</p>
            <div className="flex flex-col gap-1.5">{SUGGESTIONS.map((s) => <button key={s} type="button" disabled={!model || ollamaUp === false} onClick={() => send(`Build ${s.charAt(0).toLowerCase()}${s.slice(1)}.`)} className="text-left text-[12px] px-2.5 py-1.5 rounded-[8px] bg-[var(--hover)] hover:bg-[var(--pressed)] disabled:opacity-50">{s}</button>)}</div>
          </div>
        )}
        {!hasProject && <p className="text-[12px] text-[var(--color-text-muted)]">Create or open a project to start.</p>}
        {items.map((it) => {
          switch (it.kind) {
            case 'user': return <div key={it.id} className="ml-6 rounded-[10px] px-3 py-2 text-[13px] whitespace-pre-wrap bg-[var(--color-accent-pastel)]">{it.text}</div>;
            case 'assistant': return (it.text || it.streaming) ? (
              <div key={it.id} className="text-[13px] leading-snug whitespace-pre-wrap">{it.text}
                {it.streaming && <span className="flex items-center gap-1.5 mt-1 text-[12px] text-[var(--color-text-muted)]"><Spinner className="w-3 h-3 text-[var(--color-accent-vibrant)]" />{it.status ?? 'Working…'}</span>}
              </div>) : null;
            case 'plan': return <Plan key={it.id} item={it} disabled={running} onApprove={(md) => onApprovePlan(it.id, md)} />;
            case 'action': return <Action key={it.id} item={it} />;
            case 'note': return <Banner key={it.id} tone={it.tone === 'error' ? 'error' : 'info'}>{it.text}</Banner>;
          }
        })}
      </div>

      {approval && (
        <div className="shrink-0 mx-3 mb-2 p-3 rounded-[10px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep),0_2px_10px_rgba(0,0,0,.12)]" role="alertdialog" aria-label="Allow this command?">
          <p className="text-[12px] font-semibold mb-1">{approval.why === 'danger' ? 'This command looks risky. Run it?' : 'The agent wants to run a command'}</p>
          <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-[6px] bg-[var(--hover)] px-2 py-1.5 font-mono text-[11px]">{approval.command}</pre>
          <p className="mt-1.5 text-[11px] text-[var(--color-text-muted)] leading-snug">It runs in the project folder with your user's permissions.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn size="sm" variant="primary" onClick={() => approval.answer('once')}>Allow once</Btn>
            {approval.why === 'ask' && <Btn size="sm" onClick={() => approval.answer('always')}>Always allow in this project</Btn>}
            <Btn size="sm" variant="ghost" onClick={() => approval.answer('deny')}>Deny</Btn>
          </div>
        </div>
      )}

      <div className="shrink-0 p-3 border-t border-[var(--sep)]">
        <div className="relative">
          <TextArea aria-label="Message to the agent" value={text} rows={3} disabled={!hasProject}
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={planWaiting ? 'Approve the plan above, or describe what to change' : running ? 'The agent is working…' : 'Describe what to build or change'} className="!pr-10" />
          <div className="absolute right-1.5 bottom-1.5">
            {running
              ? <IconBtn label="Stop the agent" onClick={onStop}><Square className="w-3.5 h-3.5" fill="currentColor" /></IconBtn>
              : <IconBtn label="Send" disabled={!canSend} onClick={() => send()}><Send className="w-3.5 h-3.5" /></IconBtn>}
          </div>
        </div>
        <p className="mt-1 text-[11px] text-[var(--color-text-muted)] truncate">{model ? `Model: ${model}` : 'No model selected'} · Enter to send, Shift+Enter for a new line</p>
      </div>
    </div>
  );
};
