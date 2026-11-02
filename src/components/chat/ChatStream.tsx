import React, { useEffect, useRef, useState } from 'react';
import { Bot, Brain, BrainCircuit, Globe, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, ExternalLink, FileText, Loader2, Pencil, RefreshCw, ThumbsDown, ThumbsUp, Wrench, User, AlertCircle, PanelRight } from 'lucide-react';
import { ChatMessage, ChatSession } from '../../types/lotus';
import { MarkdownLite } from '../../lib/markdownLite';
import { openExternal } from '../../lib/open';
import { Btn, IconBtn, TextArea, cx } from '../common/ui';
import { parseChoices } from '../../chat/choices';
import { ChoiceCard } from './ChoiceCard';
import { parseInstall, type InstallTarget } from '../../chat/install';
import { InstallCard } from './InstallCard';

interface Props {
  session: ChatSession; isStreaming: boolean; autoScroll: boolean; reasoningMode: 'collapsed' | 'expanded' | 'hidden';
  onEdit: (id: string, text: string) => void; onRegenerate: (id: string) => void; onSwitch: (id: string, d: -1 | 1) => void;
  onMemory: (id: string, v: 'confirmed' | 'forgotten') => void; onOpenArtifact: (lang: string, code: string) => void;
  /** Thumbs up / down on a reply. */
  onFeedback?: (id: string, v: 'good' | 'bad') => void;
  /** The user clicked an option on a reply's choices card. */
  onAnswer?: (msgId: string, text: string) => void;
  /** Allow / Deny on a model install the reply proposed. */
  onInstall?: (msgId: string, target: InstallTarget, allow: boolean) => void;
}

const ThinkingDrawer: React.FC<{ m: ChatMessage; mode: 'collapsed' | 'expanded' | 'hidden' }> = ({ m, mode }) => {
  const [open, setOpen] = useState(mode === 'expanded');
  const running = m.isStreaming && !m.content;
  const tools = m.tools ?? [];
  if (mode === 'hidden' || (!m.thinking && !tools.length)) return null;
  const secs = m.thinkingMs ? (m.thinkingMs / 1000).toFixed(1) : null;
  return (
    <div className="mb-2 rounded-[8px] bg-[var(--hover)]">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full flex items-center gap-2 px-2.5 h-8 text-[12px] text-[var(--color-text-muted)]">
        {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
        <span className="font-medium">{running ? `${tools.find((t) => t.status === 'running')?.label ?? 'Reasoning'}…` : m.thinking ? `Thought${secs ? ` for ${secs}s` : ''}` : 'Steps'}</span>
        {tools.length > 0 && <span>· {tools.length} tool call{tools.length > 1 ? 's' : ''}</span>}
        <ChevronDown className={cx('w-3.5 h-3.5 ml-auto transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="px-2.5 pb-2.5 space-y-2">
          {tools.map((t) => (
            <div key={t.id} className="flex items-start gap-2 text-[12px]">
              {t.status === 'running' ? <Loader2 className="w-3.5 h-3.5 mt-px animate-spin shrink-0" /> : t.status === 'error' ? <AlertCircle className="w-3.5 h-3.5 mt-px text-[var(--c-red)] shrink-0" /> : <Wrench className="w-3.5 h-3.5 mt-px text-[var(--c-green)] shrink-0" />}
              <span><span className="font-medium">{t.label}</span>{t.detail && <span className="text-[var(--color-text-muted)]"> · {t.detail}</span>}</span>
            </div>
          ))}
          {m.thinking && <div className="text-[12px] leading-relaxed text-[var(--color-text-muted)] max-h-72 overflow-y-auto"><MarkdownLite text={m.thinking} onDark={false} /></div>}
        </div>
      )}
    </div>
  );
};

export const ChatStream: React.FC<Props> = ({ session, isStreaming, autoScroll, reasoningMode, onEdit, onRegenerate, onSwitch, onMemory, onOpenArtifact, onAnswer, onInstall, onFeedback }) => {
  const modelName = session.model || 'The model';
  const end = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  useEffect(() => { if (autoScroll) end.current?.scrollIntoView({ behavior: 'smooth' }); }, [session.messages, isStreaming, autoScroll]);

  const copy = (t: string, id: string) => { void navigator.clipboard.writeText(t); setCopied(id); setTimeout(() => setCopied(null), 1500); };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
      <div className="max-w-[760px] mx-auto space-y-5">
        {session.messages.map((m, mi) => {
          const user = m.role === 'user';
          const b = m.branch;
          const inst = user ? null : parseInstall(m.content);
          const parsed = user || !inst ? null : parseChoices(inst.text);
          const body = parsed ? parsed.text : m.content;
          const next = session.messages[mi + 1];
          const isLast = mi === session.messages.length - 1;
          return (
            <div key={m.id} className={cx('group flex gap-3', user && 'flex-row-reverse')}>
              <div className={cx('w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5', user ? 'bg-[var(--color-accent-fill)] text-white' : 'bg-[var(--color-accent-pastel)] text-[var(--color-accent-vibrant)] shadow-[0_0_0_0.5px_var(--sep)]')}>
                {user ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
              </div>
              <div className={cx('min-w-0 max-w-[85%]', user && 'flex flex-col items-end')}>
                {!user && <ThinkingDrawer m={m} mode={reasoningMode} />}
                {editing === m.id ? (
                  <div className="w-[min(560px,80vw)] space-y-2">
                    <TextArea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} aria-label="Edit message" />
                    <div className="flex justify-end gap-2">
                      <Btn size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Btn>
                      <Btn size="sm" variant="primary" disabled={!draft.trim()} onClick={() => { onEdit(m.id, draft.trim()); setEditing(null); }}>Save as New Version</Btn>
                    </div>
                  </div>
                ) : (
                  <div className={cx('rounded-[12px] px-3.5 py-2.5 text-[14px] leading-relaxed', user ? 'bg-[var(--color-accent-fill)] text-white' : 'bg-[var(--color-bg-sidebar)] shadow-[0_0_0_0.5px_var(--sep)]')}>
                    {m.files?.map((f) => f.kind === 'image' && f.url
                      ? <img key={f.name} src={f.url} alt={f.name} className="mb-2 max-w-[240px] rounded-[8px]" />
                      : <span key={f.name} className="mb-2 mr-1 inline-flex items-center gap-1 px-2 h-6 rounded-[6px] bg-black/10 text-[12px]"><FileText className="w-3 h-3" />{f.name}</span>)}
                    {m.attachment && <img src={m.attachment.url} alt={m.attachment.name} className="mb-2 max-w-[240px] rounded-[8px]" />}
                    {body
                      ? <MarkdownLite text={body} onDark={user} sources={m.sources}
                          codeActions={(lang, code) => (<>
                            <button type="button" onClick={() => void navigator.clipboard.writeText(code)} className="h-6 px-2 rounded-[5px] bg-black/50 text-white text-[12px]">Copy</button>
                            <button type="button" onClick={() => onOpenArtifact(lang, code)} className="h-6 px-2 rounded-[5px] bg-black/50 text-white text-[12px] inline-flex items-center gap-1"><PanelRight className="w-3 h-3" />Open in Artifacts</button>
                          </>)} />
                      : m.isStreaming ? <span className="text-[var(--color-text-muted)] animate-pulse">{m.tools?.find((t) => t.status === 'running')?.label.concat('…') ?? (m.thinking ? `${modelName} is reasoning before it answers…` : `${modelName} is reading your message…`)}</span> : null}
                    {inst?.pending && <p className="mt-1.5 text-[12px] text-[var(--color-text-muted)] animate-pulse">Preparing an install request…</p>}
                    {parsed?.pending && <p className="mt-1.5 text-[12px] text-[var(--color-text-muted)] animate-pulse">Preparing options…</p>}
                    {m.interrupted && <p className="mt-1.5 text-[12px] opacity-70">Stopped here.</p>}
                  </div>
                )}

                {parsed?.poll && !m.isStreaming && (
                  <ChoiceCard poll={parsed.poll} enabled={!!onAnswer && isLast && !isStreaming}
                    answered={m.pollAnswer ?? (next?.role === 'user' ? next.content : undefined)}
                    onAnswer={(text) => onAnswer?.(m.id, text)} />
                )}

                {inst && (inst.target || inst.problem) && !m.isStreaming && (
                  <InstallCard target={inst.target} problem={inst.problem} decision={m.install}
                    enabled={!!onInstall && isLast && !isStreaming}
                    onDecide={(allow) => inst.target && onInstall?.(m.id, inst.target, allow)} />
                )}

                {m.sources && m.sources.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {m.sources.map((s) => (
                      <button key={s.n} type="button" onClick={() => void openExternal(s.url)} title={s.title}
                        className="inline-flex items-center gap-1.5 h-6 px-2 max-w-[260px] rounded-[6px] text-[12px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)] hover:bg-[var(--hover)]">
                        <span className="font-semibold text-[var(--color-accent-vibrant)]">{s.n}</span><span className="truncate">{s.title}</span><ExternalLink className="w-3 h-3 shrink-0 opacity-60" />
                      </button>
                    ))}
                  </div>
                )}

                {m.memoryEvent && (
                  <div className="mt-1.5 flex items-center gap-2 text-[12px] text-[var(--color-text-muted)]" role="status">
                    <span>{m.memoryEvent.status === 'forgotten' ? 'Forgotten' : m.memoryEvent.kind === 'instruction' ? 'Standing instruction saved' : 'Saved to memory'}: “{m.memoryEvent.text}”</span>
                    {m.memoryEvent.status === 'saved' && (<>
                      <IconBtn label="Keep this" className="!w-6 !h-6" onClick={() => onMemory(m.id, 'confirmed')}><ThumbsUp className="w-3.5 h-3.5" /></IconBtn>
                      <IconBtn label="Forget this" className="!w-6 !h-6" onClick={() => onMemory(m.id, 'forgotten')}><ThumbsDown className="w-3.5 h-3.5" /></IconBtn>
                    </>)}
                    {m.memoryEvent.status === 'confirmed' && <Check className="w-3.5 h-3.5 text-[var(--c-green)]" aria-label="Kept" />}
                  </div>
                )}

                {!user && !m.isStreaming && (m.recall || m.mode) && (
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-[var(--color-text-muted)]">
                    {m.mode?.thinking && <span className="inline-flex items-center gap-1"><Brain className="w-3 h-3" />Thinking mode</span>}
                    {m.mode?.web && <span className="inline-flex items-center gap-1"><Globe className="w-3 h-3" />Web search</span>}
                    {m.recall && (() => {
                      const r = m.recall;
                      const parts = [
                        r.memories ? `${r.memories} memor${r.memories === 1 ? 'y' : 'ies'}` : '',
                        r.sessions ? `${r.sessions} past chat${r.sessions === 1 ? '' : 's'}` : '',
                        r.skills.length ? `skill${r.skills.length > 1 ? 's' : ''}: ${r.skills.join(', ')}` : '',
                        r.projectFiles ? `${r.projectFiles} project file${r.projectFiles === 1 ? '' : 's'}` : '',
                      ].filter(Boolean);
                      return parts.length ? <span className="inline-flex items-center gap-1" title="What long-term memory added to this reply"><BrainCircuit className="w-3 h-3" />Used {parts.join(' · ')}</span> : null;
                    })()}
                  </div>
                )}

                {/* HIG Generative AI: edit, retry and feedback sit next to the output. The latest reply always shows them. */}
                {!user && m.feedbackNote && <p role="status" className="mt-1 text-[12px] text-[var(--color-text-muted)]">{m.feedbackNote}</p>}
                <div className={cx('mt-1 flex items-center gap-0.5 h-6 transition-opacity', !(isLast && !user && !m.isStreaming) && 'opacity-0 group-hover:opacity-100 focus-within:opacity-100', user && 'flex-row-reverse')}>
                  {b && b.list.length > 1 && (
                    <span className="inline-flex items-center text-[12px] text-[var(--color-text-muted)] tabular-nums">
                      <IconBtn label="Previous version" className="!w-5 !h-5" disabled={b.index === 0} onClick={() => onSwitch(m.id, -1)}><ChevronLeft className="w-3.5 h-3.5" /></IconBtn>
                      {b.index + 1} / {b.list.length}
                      <IconBtn label="Next version" className="!w-5 !h-5" disabled={b.index === b.list.length - 1} onClick={() => onSwitch(m.id, 1)}><ChevronRight className="w-3.5 h-3.5" /></IconBtn>
                    </span>
                  )}
                  {user && !isStreaming && <IconBtn label="Edit message" className="!w-6 !h-6" onClick={() => { setDraft(m.content); setEditing(m.id); }}><Pencil className="w-3.5 h-3.5" /></IconBtn>}
                  <IconBtn label="Copy" className="!w-6 !h-6" onClick={() => copy(m.content, m.id)}>{copied === m.id ? <Check className="w-3.5 h-3.5 text-[var(--c-green)]" /> : <Copy className="w-3.5 h-3.5" />}</IconBtn>
                  {!user && !m.isStreaming && !isStreaming && <IconBtn label="Try again" className="!w-6 !h-6" onClick={() => onRegenerate(m.id)}><RefreshCw className="w-3.5 h-3.5" /></IconBtn>}
                  {!user && !m.isStreaming && onFeedback && (<>
                    <IconBtn label="Good reply" active={m.feedback === 'good'} className="!w-6 !h-6" onClick={() => onFeedback(m.id, 'good')}><ThumbsUp className="w-3.5 h-3.5" /></IconBtn>
                    <IconBtn label="Bad reply" active={m.feedback === 'bad'} className="!w-6 !h-6" onClick={() => onFeedback(m.id, 'bad')}><ThumbsDown className="w-3.5 h-3.5" /></IconBtn>
                  </>)}
                  {!user && m.tokensPerSec ? <span className="ml-1.5 text-[12px] text-[var(--color-text-muted)] tabular-nums">{m.tokensPerSec} tok/s</span> : null}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
    </div>
  );
};
