import React, { useState } from 'react';
import { Check, CornerDownLeft, ListChecks } from 'lucide-react';
import { ChoiceAnswers, ChoicePoll, ChoiceQuestion, answerText, complete } from '../../chat/choices';
import { Btn, cx } from '../common/ui';

/**
 * Options from a reply as buttons. One single-choice question sends on click; several questions
 * or multi-choice questions collect the answers and send them together. After answering the card
 * stays as a record of what was picked and can't be answered again.
 */
export const ChoiceCard: React.FC<{
  poll: ChoicePoll;
  /** What the user already answered (read-only view). */
  answered?: string;
  /** False while a reply is streaming or when a later message exists. */
  enabled: boolean;
  onAnswer: (text: string) => void;
}> = ({ poll, answered, enabled, onAnswer }) => {
  const [answers, setAnswers] = useState<ChoiceAnswers>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [otherOn, setOtherOn] = useState<Record<string, boolean>>({});
  const live = enabled && !answered;
  const instant = poll.questions.length === 1 && poll.questions[0].type === 'single';

  const withOther = (q: ChoiceQuestion, list: string[]) => (otherOn[q.id] && other[q.id]?.trim() ? [...list.filter((x) => q.options.includes(x)), other[q.id].trim()] : list.filter((x) => q.options.includes(x)));
  const merged = (): ChoiceAnswers => Object.fromEntries(poll.questions.map((q) => [q.id, q.type === 'text' ? [other[q.id] ?? ''] : withOther(q, answers[q.id] ?? [])]));

  const pick = (q: ChoiceQuestion, opt: string) => {
    if (!live) return;
    if (instant) { onAnswer(opt); return; }
    setAnswers((a) => {
      const cur = a[q.id] ?? [];
      const next = q.type === 'multi' ? (cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt]) : [opt];
      return { ...a, [q.id]: next };
    });
    if (q.type === 'single') setOtherOn((o) => ({ ...o, [q.id]: false }));
  };
  const send = () => { const m = merged(); if (complete(poll, m)) onAnswer(answerText(poll, m)); };
  const ready = complete(poll, merged());

  // Read-only: highlight what was chosen (matched by text in the answer).
  const picked = new Set((answered ?? '').replace(/\*\*/g, '').split(/,\s*|\n+/).map((x) => x.trim().toLowerCase()).filter(Boolean));
  const chosen = (opt: string) => picked.has(opt.toLowerCase());

  return (
    <div role="group" aria-label={poll.title ?? 'Choose an answer'}
      className="mt-2 w-[min(560px,100%)] rounded-[12px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep),var(--shadow-1)] overflow-hidden">
      {(poll.title || poll.questions.length > 1) && (
        <div className="flex items-center gap-2 px-3.5 h-9 border-b border-[var(--sep)] text-[12px] font-semibold text-[var(--color-text-muted)]">
          <ListChecks className="w-3.5 h-3.5 text-[var(--petal-violet)]" aria-hidden="true" />
          <span className="truncate">{poll.title ?? 'A few questions'}</span>
          <span className="ml-auto font-medium tabular-nums">{poll.questions.length} questions</span>
        </div>
      )}
      <div className="flex flex-col divide-y divide-[var(--sep)]">
        {poll.questions.map((q, qi) => (
          <fieldset key={q.id} className="px-3.5 py-3 min-w-0" disabled={!live}>
            {/* A list-style poll repeats the reply's own question, so it is only read out, not shown twice. */}
            {q.question && <legend className={cx('float-left w-full mb-2 text-[13px] font-semibold text-[var(--color-text-main)]', poll.source === 'list' && 'sr-only')}>{poll.questions.length > 1 && <span className="text-[var(--color-text-muted)] mr-1.5 tabular-nums">{qi + 1}.</span>}{q.question}</legend>}
            {q.type === 'text' ? (
              <input type="text" value={other[q.id] ?? ''} onChange={(e) => setOther((o) => ({ ...o, [q.id]: e.target.value }))} aria-label={q.question || 'Your answer'}
                onKeyDown={(e) => { if (e.key === 'Enter' && ready) { e.preventDefault(); send(); } }}
                placeholder={answered ? '' : 'Type your answer'}
                className="clear-left w-full h-8 px-2.5 rounded-[8px] bg-[var(--hover)] text-[13px] focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)] disabled:opacity-60" />
            ) : (
              <div className="clear-left flex flex-col gap-1" role={q.type === 'multi' ? 'group' : 'radiogroup'} aria-label={q.question || 'Options'}>
                {q.options.map((opt, i) => {
                  const on = answered ? chosen(opt) : (answers[q.id] ?? []).includes(opt);
                  return (
                    <button key={opt} type="button" role={q.type === 'multi' ? 'checkbox' : 'radio'} aria-checked={on} onClick={() => pick(q, opt)}
                      className={cx('choice-option group/opt w-full min-h-9 flex items-center gap-2.5 px-2.5 py-1.5 rounded-[8px] text-left text-[13px] transition-colors duration-100 focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)]',
                        on ? 'bg-[var(--color-accent-pastel)] text-[var(--color-text-main)] shadow-[inset_0_0_0_1px_var(--color-accent-vibrant)]' : 'hover:bg-[var(--hover)] active:bg-[var(--pressed)]',
                        !live && !on && 'opacity-60')}>
                      <span aria-hidden="true" className={cx('w-5 h-5 shrink-0 inline-flex items-center justify-center text-[12px] font-semibold tabular-nums',
                        q.type === 'multi' ? 'rounded-[5px]' : 'rounded-[6px]',
                        on ? 'bg-[var(--color-accent-fill)] text-white' : 'bg-[var(--hover)] text-[var(--color-text-muted)] group-hover/opt:text-[var(--color-text-main)]')}>
                        {on ? <Check className="w-3 h-3" strokeWidth={3} /> : String.fromCharCode(65 + i)}
                      </span>
                      <span className="flex-1 min-w-0 break-words">{opt}</span>
                      {instant && live && <CornerDownLeft className="w-3.5 h-3.5 shrink-0 opacity-0 group-hover/opt:opacity-60" aria-hidden="true" />}
                    </button>
                  );
                })}
                {q.allowOther && live && (
                  otherOn[q.id] ? (
                    <div className="flex items-center gap-2 pl-[34px] pr-0.5">
                      <input autoFocus type="text" value={other[q.id] ?? ''} aria-label="Your own answer" placeholder="Your own answer"
                        onChange={(e) => setOther((o) => ({ ...o, [q.id]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && other[q.id]?.trim()) { e.preventDefault(); if (instant) onAnswer(other[q.id].trim()); else if (ready) send(); }
                          if (e.key === 'Escape') setOtherOn((o) => ({ ...o, [q.id]: false }));
                        }}
                        className="flex-1 h-8 px-2.5 rounded-[8px] bg-[var(--hover)] text-[13px] focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)]" />
                      {instant && <Btn size="sm" variant="primary" disabled={!other[q.id]?.trim()} onClick={() => onAnswer(other[q.id].trim())}>Send</Btn>}
                    </div>
                  ) : (
                    <button type="button" onClick={() => { setOtherOn((o) => ({ ...o, [q.id]: true })); if (q.type === 'single') setAnswers((a) => ({ ...a, [q.id]: [] })); }}
                      className="self-start ml-[34px] h-7 px-1 text-[12px] font-medium text-[var(--color-accent-vibrant)] hover:underline focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)] rounded-[6px]">
                      Something else…
                    </button>
                  )
                )}
              </div>
            )}
          </fieldset>
        ))}
      </div>
      {!instant && live && (
        <div className="flex items-center justify-end gap-2 px-3.5 py-2.5 border-t border-[var(--sep)]">
          <span className="mr-auto text-[12px] text-[var(--color-text-muted)]">{ready ? 'Ready to send' : poll.questions.length > 1 ? 'Answer every question to send' : 'Pick at least one'}</span>
          <Btn size="sm" variant="primary" disabled={!ready} onClick={send}>Send Answers</Btn>
        </div>
      )}
      {answered && (
        <p className="px-3.5 py-2 border-t border-[var(--sep)] text-[12px] text-[var(--color-text-muted)] flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-[var(--c-green)]" aria-hidden="true" />Answered</p>
      )}
    </div>
  );
};
