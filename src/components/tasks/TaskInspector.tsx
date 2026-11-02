import React, { useEffect, useState } from 'react';
import { Bot, Check, ChevronDown, Globe, Loader2, Play, RotateCcw, Square, Trash2, X } from 'lucide-react';
import { blockedBy, blockersOf, COLUMNS, Priority, Status, Task, TaskLink } from '../../tasks/kanban';
import { tasks as store } from '../../tasks/store';
import { uid } from '../../lib/persist';
import { MarkdownLite } from '../../lib/markdownLite';
import { InspectorPane, PaneBar, Section } from '../common/Pane';
import { Banner, Btn, Checkbox, IconBtn, Label, Segmented, Select, TextArea, TextInput, cx } from '../common/ui';

const PRIORITIES: Priority[] = ['urgent', 'high', 'normal', 'low'];

export const TaskInspector: React.FC<{ task: Task; all: Task[]; onClose: () => void }> = ({ task: t, all, onClose }) => {
  const [title, setTitle] = useState(t.title);
  const [desc, setDesc] = useState(t.description);
  const [editDesc, setEditDesc] = useState(!t.description);
  const [stepDraft, setStepDraft] = useState('');
  const [linkTo, setLinkTo] = useState('');
  const [linkType, setLinkType] = useState<TaskLink['type'] | 'blocked-by'>('blocks');
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  useEffect(() => { setTitle(t.title); setDesc(t.description); setEditDesc(!t.description); }, [t.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (fn: (x: Task) => Task) => store.patch(t.id, fn);
  const running = t.run?.state === 'running' || t.run?.state === 'queued';
  const blockers = blockersOf(t.id, all);
  const blocks = blockedBy(t.id, all);
  const relates = t.links.filter((l) => l.type === 'relates').map((l) => all.find((x) => x.id === l.to)).filter((x): x is Task => !!x);
  const incomingRelates = all.filter((x) => x.links.some((l) => l.type === 'relates' && l.to === t.id));
  const others = all.filter((x) => x.id !== t.id);

  const addLink = () => {
    if (!linkTo) return;
    const ok = linkType === 'blocked-by' ? store.link(linkTo, 'blocks', t.id) : store.link(t.id, linkType, linkTo);
    if (ok) setLinkTo('');
  };

  return (
    <InspectorPane label="Task details" className="!w-[360px]">
      <PaneBar>
        <span className="text-[13px] font-semibold flex-1 truncate">Task</span>
        <IconBtn label="Delete task" onClick={() => { store.remove(t.id); onClose(); }}><Trash2 className="w-4 h-4" /></IconBtn>
        <IconBtn label="Close details" onClick={onClose}><X className="w-4 h-4" /></IconBtn>
      </PaneBar>
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pt-3 pb-2">
          <TextArea aria-label="Task title" rows={2} value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== t.title && patch((x) => ({ ...x, title: title.trim() }))}
            className="!text-[15px] !font-semibold !shadow-none hover:!shadow-[inset_0_0_0_0.5px_var(--sep)] !px-1.5" />
          {t.source && <p className="mt-1 px-1.5 text-[12px] text-[var(--color-text-muted)]">From routine “{t.source.name}”</p>}
        </div>

        <Section title="Agent">
          <Segmented label="Assignee" value={t.assignee} onChange={(a) => patch((x) => ({ ...x, assignee: a }))}
            options={[{ id: 'me', label: 'Me' }, { id: 'lotus', label: 'Lotus', icon: <Bot className="w-3.5 h-3.5" /> }]} />
          <p className="mt-1.5 text-[12px] text-[var(--color-text-muted)] leading-snug">
            {t.assignee === 'lotus' ? 'Lotus starts this when it is in To do and nothing blocks it, plans steps if there are none, works through them and moves it to Review.' : 'You do this one. Assign it to Lotus to have the local model work on it.'}
          </p>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {running
              ? <Btn variant="secondary" icon={<Square className="w-3 h-3" fill="currentColor" />} onClick={() => store.stop(t.id)}>Stop</Btn>
              : t.run?.state === 'failed'
                ? <Btn variant="primary" icon={<RotateCcw className="w-3.5 h-3.5" />} onClick={() => store.retry(t.id)} disabled={blockers.length > 0}>Try Again</Btn>
                : <Btn variant="primary" icon={<Play className="w-3.5 h-3.5" />} onClick={() => store.run(t.id)} disabled={blockers.length > 0 || t.status === 'done'}>{t.result ? 'Run again' : 'Run with Lotus'}</Btn>}
            <Checkbox checked={!!t.web} onChange={(v) => patch((x) => ({ ...x, web: v }))} label="Search the web first" />
          </div>
          {running && <p className="mt-2 text-[12px] inline-flex items-center gap-1.5 text-[var(--color-accent-vibrant)]"><Loader2 className="w-3.5 h-3.5 animate-spin" />{t.run?.state === 'queued' ? 'Waiting for a free agent slot (limited by video memory).' : t.log[t.log.length - 1]?.text}</p>}
          {t.run?.state === 'failed' && t.run.error && t.run.error !== 'Stopped' && <Banner tone="error" className="mt-2">{t.run.error}</Banner>}
          {blockers.length > 0 && <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">Waiting for {blockers.map((b) => `“${b.title}”`).join(', ')}.</p>}
        </Section>

        {t.result && (
          <Section title="Result" action={t.status === 'review' ? <Btn size="sm" variant="primary" icon={<Check className="w-3.5 h-3.5" />} onClick={() => store.move(t.id, 'done')}>Accept</Btn> : undefined}>
            <div className="text-[13px] leading-relaxed max-h-[360px] overflow-y-auto"><MarkdownLite text={t.result} onDark={false} /></div>
            <button type="button" className="mt-1.5 text-[12px] font-medium text-[var(--color-accent-vibrant)]" onClick={() => void navigator.clipboard.writeText(t.result!)}>Copy result</button>
          </Section>
        )}

        <Section title="Details">
          <div className="grid grid-cols-2 gap-2 mb-2.5">
            <div><Label>Status</Label>
              <Select aria-label="Status" value={t.status} onChange={(e) => store.move(t.id, e.target.value as Status)}>
                {COLUMNS.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </Select></div>
            <div><Label>Priority</Label>
              <Select aria-label="Priority" value={t.priority} onChange={(e) => patch((x) => ({ ...x, priority: e.target.value as Priority }))}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
              </Select></div>
            <div><Label>Due</Label><TextInput type="date" aria-label="Due date" value={t.due ?? ''} onChange={(e) => patch((x) => ({ ...x, due: e.target.value || undefined }))} /></div>
            <div><Label>Labels</Label><TextInput aria-label="Labels, comma separated" placeholder="design, bug" defaultValue={t.labels.join(', ')} key={t.id}
              onBlur={(e) => patch((x) => ({ ...x, labels: e.target.value.split(',').map((l) => l.trim()).filter(Boolean).slice(0, 6) }))} /></div>
          </div>
          <Label hint={<button type="button" className="font-medium text-[var(--color-accent-vibrant)]" onClick={() => { if (editDesc) patch((x) => ({ ...x, description: desc })); setEditDesc(!editDesc); }}>{editDesc ? 'Done' : 'Edit'}</button>}>Description (Markdown)</Label>
          {editDesc
            ? <TextArea aria-label="Description" rows={5} value={desc} onChange={(e) => setDesc(e.target.value)} onBlur={() => patch((x) => ({ ...x, description: desc }))} placeholder="What should the result be? Any constraints?" />
            : <div className="text-[13px] leading-relaxed"><MarkdownLite text={t.description} onDark={false} /></div>}
        </Section>

        <Section title={`Steps${t.steps.length ? ` · ${t.steps.filter((s) => s.done).length}/${t.steps.length}` : ''}`} hint={!t.steps.length ? 'Add steps, or leave it empty and Lotus will plan them when it runs.' : undefined}>
          <ul className="space-y-1">
            {t.steps.map((s, i) => (
              <li key={s.id} className="rounded-[8px] hover:bg-[var(--hover)]">
                <div className="flex items-start gap-2 px-1.5 py-1">
                  <input type="checkbox" className="mt-1" checked={s.done} aria-label={`Step ${i + 1} done`} onChange={(e) => patch((x) => ({ ...x, steps: x.steps.map((y) => (y.id === s.id ? { ...y, done: e.target.checked } : y)) }))} />
                  <span className={cx('flex-1 text-[13px] leading-snug', s.done && 'text-[var(--color-text-muted)] line-through')}>{s.text}</span>
                  {s.result && <IconBtn label={openStep === s.id ? 'Hide step result' : 'Show step result'} className="!w-6 !h-6" onClick={() => setOpenStep(openStep === s.id ? null : s.id)}><ChevronDown className={cx('w-3.5 h-3.5 transition-transform', openStep === s.id && 'rotate-180')} /></IconBtn>}
                  <IconBtn label={`Remove step ${i + 1}`} className="!w-6 !h-6" onClick={() => patch((x) => ({ ...x, steps: x.steps.filter((y) => y.id !== s.id) }))}><X className="w-3.5 h-3.5" /></IconBtn>
                </div>
                {openStep === s.id && s.result && <div className="mx-7 mb-2 text-[12px] leading-relaxed max-h-60 overflow-y-auto"><MarkdownLite text={s.result} onDark={false} /></div>}
              </li>
            ))}
          </ul>
          <form className="mt-1.5 flex gap-2" onSubmit={(e) => { e.preventDefault(); const v = stepDraft.trim(); if (v) { patch((x) => ({ ...x, steps: [...x.steps, { id: uid('step'), text: v, done: false }] })); setStepDraft(''); } }}>
            <TextInput value={stepDraft} onChange={(e) => setStepDraft(e.target.value)} placeholder="Add a step" aria-label="New step" />
            <Btn type="submit" size="md" disabled={!stepDraft.trim()}>Add</Btn>
          </form>
        </Section>

        <Section title="Links" hint="“Blocks” means the other task can’t start until this one is done.">
          {[...blockers.map((b) => ({ t: b, rel: 'Blocked by', remove: () => store.unlink(b.id, t.id) })),
            ...blocks.map((b) => ({ t: b, rel: 'Blocks', remove: () => store.unlink(t.id, b.id) })),
            ...relates.map((b) => ({ t: b, rel: 'Related', remove: () => store.unlink(t.id, b.id) })),
            ...incomingRelates.map((b) => ({ t: b, rel: 'Related', remove: () => store.unlink(b.id, t.id) })),
            ...all.filter((x) => x.status === 'done' && x.links.some((l) => l.type === 'blocks' && l.to === t.id)).map((b) => ({ t: b, rel: 'Was blocked by', remove: () => store.unlink(b.id, t.id) })),
          ].map((l) => (
            <div key={`${l.rel}-${l.t.id}`} className="flex items-center gap-2 py-0.5 text-[13px]">
              <span className="w-[92px] shrink-0 text-[12px] text-[var(--color-text-muted)]">{l.rel}</span>
              <span className={cx('flex-1 truncate', l.t.status === 'done' && 'line-through text-[var(--color-text-muted)]')}>{l.t.title}</span>
              <IconBtn label={`Remove link to ${l.t.title}`} className="!w-6 !h-6" onClick={l.remove}><X className="w-3.5 h-3.5" /></IconBtn>
            </div>
          ))}
          {others.length > 0 ? (
            <div className="mt-1.5 flex gap-2">
              <span className="w-[110px] shrink-0"><Select aria-label="Link type" value={linkType} onChange={(e) => setLinkType(e.target.value as typeof linkType)}>
                <option value="blocks">Blocks</option><option value="blocked-by">Blocked by</option><option value="relates">Related to</option>
              </Select></span>
              <Select aria-label="Task to link" value={linkTo} onChange={(e) => setLinkTo(e.target.value)}>
                <option value="">Choose a task…</option>
                {others.map((o) => <option key={o.id} value={o.id}>{o.title.slice(0, 60)}</option>)}
              </Select>
              <Btn disabled={!linkTo} onClick={addLink}>Link</Btn>
            </div>
          ) : <p className="text-[12px] text-[var(--color-text-muted)]">Add another task to link them.</p>}
        </Section>

        <Section title="Activity" action={<button type="button" className="text-[12px] font-medium text-[var(--color-accent-vibrant)]" onClick={() => setShowLog(!showLog)}>{showLog ? 'Hide' : `Show (${t.log.length})`}</button>}>
          {showLog && (
            <ol className="space-y-1">
              {[...t.log].reverse().map((l, i) => (
                <li key={i} className="flex gap-2 text-[12px]">
                  <span className="shrink-0 tabular-nums text-[var(--color-text-muted)]">{new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className={cx(l.kind === 'error' && 'text-[var(--c-red)]', l.kind === 'agent' && 'inline-flex gap-1')}>{l.kind === 'agent' && <Bot className="w-3 h-3 mt-0.5 shrink-0" />}{l.text}</span>
                </li>
              ))}
            </ol>
          )}
          {!showLog && <p className="text-[12px] text-[var(--color-text-muted)]">Created {new Date(t.created).toLocaleString()} · updated {new Date(t.updated).toLocaleString()}</p>}
        </Section>
        {t.web && <p className="px-4 pb-4 text-[12px] text-[var(--color-text-muted)] inline-flex items-center gap-1"><Globe className="w-3 h-3" />The task title is sent to your web search provider when Lotus runs it.</p>}
      </div>
    </InspectorPane>
  );
};
