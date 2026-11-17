import React, { useState } from 'react';
import { usePending } from '../../lib/approvals';
import { answerAsk, decideStep } from '../../lib/agent';
import { Banner, Btn, TextInput } from '../common/ui';

/** What Lotus's agents are waiting for you to answer (tasks and routines run while nobody watches). */
export const PendingApprovals: React.FC<{ className?: string }> = ({ className }) => {
  const { perms, asks } = usePending();
  const [typed, setTyped] = useState<Record<string, string>>({});
  if (!perms.length && !asks.length) return null;
  return (
    <div className={`space-y-2 ${className ?? ''}`}>
      {perms.map((p) => (
        <Banner key={p.stepId} tone="warn" action={<span className="flex gap-1.5 shrink-0">
          <Btn size="sm" onClick={() => void decideStep(p.runId, p.stepId, false).catch(() => undefined)}>Deny</Btn>
          <Btn size="sm" variant="primary" onClick={() => void decideStep(p.runId, p.stepId, true).catch(() => undefined)}>Allow</Btn>
        </span>}>
          Lotus is waiting for your permission: {p.text}
        </Banner>
      ))}
      {asks.map((a) => {
        const k = `${a.runId}/${a.askId}`;
        const send = (v: string) => void answerAsk(a.runId, a.askId, v).catch(() => undefined);
        return (
          <Banner key={k} tone="info" action={<span className="flex flex-wrap gap-1.5 shrink-0 justify-end">
            {a.options.map((o) => <Btn key={o} size="sm" onClick={() => send(o)}>{o}</Btn>)}
          </span>}>
            <div>{a.question}</div>
            <form className="mt-1.5 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if ((typed[k] ?? '').trim()) send(typed[k]); }}>
              <TextInput aria-label="Your answer" placeholder="Type an answer" value={typed[k] ?? ''} onChange={(e) => setTyped((t) => ({ ...t, [k]: e.target.value }))} />
              <Btn size="sm" type="submit" disabled={!(typed[k] ?? '').trim()}>Answer</Btn>
            </form>
          </Banner>
        );
      })}
    </div>
  );
};
