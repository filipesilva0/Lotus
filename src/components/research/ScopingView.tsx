import React, { useState } from 'react';
import { FlaskConical, Plus, Trash2, Sparkles, RefreshCw, Play, User } from 'lucide-react';
import { ResearchApi } from '../../research/store';
import { Project, SubTopic, Persona } from '../../research/types';
import { REPO_INFO } from '../../research/repos';
import { uid } from '../../research/llm';
import { Btn, Card, TextArea, TextInput, Label, Banner, Skeleton, Select, IconBtn } from '../common/ui';
import { ChipInput } from './bits';

interface Props { r: ResearchApi; p: Project; models: string[]; ollamaUp: boolean | null; onOpenEngines: () => void }

const EXAMPLES = ['Does intermittent fasting improve cardiovascular outcomes?', 'State of the art in sparse attention for long-context transformers', 'Prior art for solid-state battery electrolyte coatings'];

export const ScopingView: React.FC<Props> = ({ r, p, models, ollamaUp, onOpenEngines }) => {
  const [question, setQuestion] = useState(p.question);
  const locked = p.phase !== 'scoping' && p.phase !== 'planning';
  const stage = locked ? 'locked' : p.plan.length ? 'plan' : p.clarifications.length ? 'clarify' : 'ask';
  const patchPlan = (fn: (plan: SubTopic[]) => SubTopic[]) => r.patch(p.id, (q) => ({ ...q, plan: fn(q.plan) }));
  const patchPersonas = (fn: (x: Persona[]) => Persona[]) => r.patch(p.id, (q) => ({ ...q, personas: fn(q.personas) }));
  const enabled = Object.entries(p.limits.repos).filter(([, on]) => on).map(([id]) => REPO_INFO[id as keyof typeof REPO_INFO].name);
  const noModel = !p.model && !models.length;

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      {r.error && <Banner tone="error" action={<Btn size="sm" variant="secondary" onClick={onOpenEngines}>Engines</Btn>}>{r.error}</Banner>}
      {ollamaUp === false && <Banner tone="warn" action={<Btn size="sm" variant="secondary" onClick={onOpenEngines}>Engines</Btn>}>Ollama isn't running. Deep research uses your local model for every step.</Banner>}

      {/* 1 · Question */}
      {stage === 'ask' && (
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text-main)]">What do you want to research?</h2>
            <p className="text-xs text-[var(--color-text-muted)] mt-1 leading-relaxed">State the question in your own words. Lotus will ask a few questions to narrow it, then draft a plan for you to approve before anything is searched.</p>
          </div>
          <TextArea aria-label="Research question" rows={4} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Does intermittent fasting improve cardiovascular outcomes in adults?" className="!text-sm" />
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((x) => <button key={x} onClick={() => setQuestion(x)} className="text-xs px-2.5 h-6 rounded-full bg-black/[.04] dark:bg-white/[.06] text-[var(--color-text-muted)] hover:bg-black/[.08] dark:hover:bg-white/10 transition-colors">{x}</button>)}
          </div>
          <div><Label hint="optional">Tags</Label><ChipInput label="Tags" values={p.tags} onChange={(t) => r.patch(p.id, (q) => ({ ...q, tags: t }))} placeholder="#Biomedical, #MachineLearning" /></div>
          {models.length > 0 && (
            <div className="flex items-center gap-3">
              <Label className="!mb-0">Model</Label>
              <Select aria-label="Research model" value={p.model} onChange={(e) => r.patch(p.id, (q) => ({ ...q, model: e.target.value }))} className="!w-56">
                {[...new Set([p.model, ...models].filter(Boolean))].map((m) => <option key={m}>{m}</option>)}
              </Select>
              <span className="text-xs text-[var(--color-text-muted)]">7B or larger works best</span>
            </div>
          )}
          <Btn variant="primary" loading={r.busy === 'questions'} disabled={question.trim().length < 8 || noModel || ollamaUp === false} icon={<Sparkles className="w-3.5 h-3.5" />} onClick={() => r.startScoping(p.id, question.trim())}>
            Start scoping
          </Btn>
          {noModel && <p className="text-xs text-amber-600">No chat model installed. Download one in Engines → Models.</p>}
        </section>
      )}

      {/* 2 · Clarification loop */}
      {(stage === 'clarify' || stage === 'plan') && (
        <section className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-[var(--color-accent-vibrant)] text-white flex items-center justify-center shrink-0"><FlaskConical className="w-4 h-4" /></div>
            <div className="rounded-2xl rounded-tl-md bg-[var(--color-accent-pastel)] px-4 py-3 text-sm text-[var(--color-text-main)]">
              <span className="text-xs font-semibold text-[var(--color-accent-vibrant)] block mb-0.5">Your question</span>{p.question}
            </div>
          </div>
          <h3 className="text-sm font-semibold text-[var(--color-text-main)] pt-1">A few questions to narrow it down <span className="font-normal text-[var(--color-text-muted)]">· answer what matters, skip the rest</span></h3>
          {p.clarifications.map((c, i) => (
            <div key={c.id} className="space-y-1.5">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-black/5 dark:bg-white/10 text-[var(--color-text-muted)] flex items-center justify-center text-xs font-semibold shrink-0">{i + 1}</div>
                <div className="pt-1"><p className="text-sm text-[var(--color-text-main)]">{c.question}</p>{c.why && <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{c.why}</p>}</div>
              </div>
              <div className="pl-11"><TextInput aria-label={`Answer to question ${i + 1}`} value={c.answer} placeholder="Your answer (optional)" onChange={(e) => r.patch(p.id, (q) => ({ ...q, clarifications: q.clarifications.map((x) => (x.id === c.id ? { ...x, answer: e.target.value } : x)) }))} /></div>
            </div>
          ))}
          {stage === 'clarify' && (
            <Btn variant="primary" loading={r.busy === 'plan' || r.busy === 'personas'} icon={<Sparkles className="w-3.5 h-3.5" />} onClick={() => r.buildPlan(p.id)}>
              {r.busy === 'personas' ? 'Assembling expert panel…' : r.busy === 'plan' ? 'Drafting the plan…' : 'Build the research plan'}
            </Btn>
          )}
        </section>
      )}

      {/* 3 · Brief & plan approval */}
      {stage === 'plan' && (
        <>
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--color-text-main)]">Research plan</h3>
              <Btn size="sm" variant="ghost" loading={r.busy === 'plan'} icon={<RefreshCw className="w-3 h-3" />} onClick={() => r.buildPlan(p.id)}>Redraft</Btn>
            </div>
            <div><Label>Report title</Label><TextInput value={p.title} onChange={(e) => r.patch(p.id, (q) => ({ ...q, title: e.target.value }))} /></div>
            {p.plan.map((t, ti) => (
              <Card key={t.id} className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-[var(--color-accent-pastel)] text-[var(--color-accent-vibrant)] text-xs font-semibold flex items-center justify-center shrink-0">{ti + 1}</span>
                  <TextInput aria-label="Sub-topic title" value={t.title} className="font-semibold" onChange={(e) => patchPlan((pl) => pl.map((x) => (x.id === t.id ? { ...x, title: e.target.value } : x)))} />
                  <IconBtn label="Remove sub-topic" disabled={p.plan.length <= 1} onClick={() => patchPlan((pl) => pl.filter((x) => x.id !== t.id))}><Trash2 className="w-3.5 h-3.5" /></IconBtn>
                </div>
                <div><Label>Objective</Label><TextArea aria-label="Objective" rows={2} value={t.objective} onChange={(e) => patchPlan((pl) => pl.map((x) => (x.id === t.id ? { ...x, objective: e.target.value } : x)))} /></div>
                <div>
                  <Label>Sub-questions</Label>
                  <div className="space-y-1.5">
                    {t.questions.map((q, qi) => (
                      <div key={qi} className="flex gap-1.5">
                        <TextInput aria-label={`Sub-question ${qi + 1}`} value={q} onChange={(e) => patchPlan((pl) => pl.map((x) => (x.id === t.id ? { ...x, questions: x.questions.map((y, j) => (j === qi ? e.target.value : y)) } : x)))} />
                        <IconBtn label="Remove sub-question" onClick={() => patchPlan((pl) => pl.map((x) => (x.id === t.id ? { ...x, questions: x.questions.filter((_, j) => j !== qi) } : x)))}><Trash2 className="w-3.5 h-3.5" /></IconBtn>
                      </div>
                    ))}
                    <Btn size="sm" variant="ghost" icon={<Plus className="w-3 h-3" />} onClick={() => patchPlan((pl) => pl.map((x) => (x.id === t.id ? { ...x, questions: [...x.questions, ''] } : x)))}>Add sub-question</Btn>
                  </div>
                </div>
              </Card>
            ))}
            <Btn variant="secondary" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => patchPlan((pl) => [...pl, { id: uid(), title: 'New sub-topic', objective: '', questions: [''] }])}>Add sub-topic</Btn>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div><h3 className="text-sm font-semibold text-[var(--color-text-main)]">Expert panel</h3><p className="text-xs text-[var(--color-text-muted)]">These perspectives challenge the findings in the report's critical review.</p></div>
              <Btn size="sm" variant="ghost" loading={r.busy === 'personas'} icon={<RefreshCw className="w-3 h-3" />} onClick={() => r.regeneratePersonas(p.id)}>Regenerate</Btn>
            </div>
            {r.busy === 'personas' && !p.personas.length ? <Skeleton className="h-20" /> : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {p.personas.map((x) => (
                  <Card key={x.id} className="p-3.5 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-black/5 dark:bg-white/10 flex items-center justify-center shrink-0"><User className="w-3.5 h-3.5 text-[var(--color-text-muted)]" /></div>
                      <TextInput aria-label="Persona name" value={x.name} className="!h-7 font-semibold" onChange={(e) => patchPersonas((l) => l.map((y) => (y.id === x.id ? { ...y, name: e.target.value } : y)))} />
                      <IconBtn label="Remove persona" className="!w-7 !h-7" onClick={() => patchPersonas((l) => l.filter((y) => y.id !== x.id))}><Trash2 className="w-3.5 h-3.5" /></IconBtn>
                    </div>
                    <p className="text-xs text-[var(--color-text-muted)]">{x.role}</p>
                    <TextInput aria-label="What this persona challenges" value={x.focus} className="!h-7 !text-xs" onChange={(e) => patchPersonas((l) => l.map((y) => (y.id === x.id ? { ...y, focus: e.target.value } : y)))} />
                  </Card>
                ))}
                {p.personas.length < 5 && (
                  <button onClick={() => patchPersonas((l) => [...l, { id: uid(), name: 'New expert', role: 'Describe their background', focus: 'What they challenge' }])}
                    className="rounded-2xl border border-dashed border-[#D5D8DF] dark:border-[#3A3E4A] text-xs font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-accent-vibrant)] hover:border-[var(--color-accent-vibrant)] min-h-[88px] transition-colors">+ Add expert</button>
                )}
              </div>
            )}
          </section>

          <div className="sticky bottom-0 -mx-6 px-6 py-4 bg-white/95 dark:bg-[#18191E]/95 backdrop-blur border-t border-[var(--color-border-subtle)] flex items-center gap-4">
            <p className="flex-1 text-xs text-[var(--color-text-muted)] leading-relaxed">
              Search keywords will be sent to <strong className="text-[var(--color-text-main)]">{enabled.length ? enabled.join(', ') : 'no repository (enable one in the inspector)'}</strong>. Everything else stays on this PC.
            </p>
            <Btn variant="primary" disabled={!enabled.length || !p.plan.some((t) => t.title.trim()) || ollamaUp === false} icon={<Play className="w-3.5 h-3.5" fill="currentColor" />} onClick={() => r.approveAndStart(p.id)}>Approve &amp; start research</Btn>
          </div>
        </>
      )}

      {/* Read-only once a run exists */}
      {stage === 'locked' && (
        <section className="space-y-4">
          <div><h2 className="text-lg font-semibold text-[var(--color-text-main)]">{p.title}</h2><p className="text-xs text-[var(--color-text-muted)] mt-1">{p.question}</p></div>
          <Card className="divide-y divide-[#EBECEF] dark:divide-[#2C2F38]">
            {p.plan.map((t, i) => (
              <div key={t.id} className="p-4"><p className="text-sm font-semibold text-[var(--color-text-main)]">{i + 1}. {t.title}</p><p className="text-xs text-[var(--color-text-muted)] mt-0.5">{t.objective}</p></div>
            ))}
          </Card>
          <Btn variant="secondary" onClick={() => r.backToPlan(p.id)}>Edit the plan and run again</Btn>
        </section>
      )}
    </div>
  );
};
