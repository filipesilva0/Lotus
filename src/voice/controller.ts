// Spoken notifications (session 16): when voice is on in Settings → Voice, an agent's question
// (ask.user) or permission request is read aloud, and Lotus listens for your answer. Typing or clicking
// an answer anywhere (Work, Chat, the island) still works and cancels the listening.

import { onCoreEvent } from '../lib/core';
import { answerAsk, decideStep } from '../lib/agent';
import { hush, listen, matchOption, speak, voicePrefs } from './voice';

const YES = /\b(yes|yeah|yep|allow|ok|okay|sure|go ahead|do it|continue|approve)\b/i;
const NO = /\b(no|nope|deny|don'?t|stop|cancel|reject)\b/i;

let started = false;
export function startVoiceController() {
  if (started) return;
  started = true;
  const open = new Map<string, AbortController>(); // runId/askId or runId/stepId → its listening
  const queue: (() => Promise<void>)[] = [];
  let busy = false;
  const pump = async () => {
    if (busy) return;
    busy = true;
    while (queue.length) { try { await queue.shift()!(); } catch { /* next */ } }
    busy = false;
  };
  const close = (key: string) => { open.get(key)?.abort(); open.delete(key); };

  onCoreEvent((raw) => {
    const e = raw as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (e.type !== 'agent') return;
    if (e.kind === 'answered') { close(`${e.runId}/${e.askId}`); hush(); return; }
    if (e.kind === 'done' || e.kind === 'error') { for (const k of [...open.keys()]) if (k.startsWith(`${e.runId}/`)) close(k); return; }
    const p = voicePrefs();
    if (!p.notify) return;
    if (e.kind === 'ask') {
      const key = `${e.runId}/${e.askId}`;
      const ctrl = new AbortController();
      open.set(key, ctrl);
      const opts: string[] = e.options ?? [];
      queue.push(async () => {
        if (ctrl.signal.aborted) return;
        await speak(`${e.question}${opts.length ? ` ${opts.length > 1 ? `${opts.slice(0, -1).join(', ')}, or ${opts[opts.length - 1]}?` : opts[0]}` : ''}`);
        if (!p.answer || ctrl.signal.aborted) return;
        const said = await listen({ signal: ctrl.signal }).catch(() => '');
        if (said && !ctrl.signal.aborted) await answerAsk(e.runId, e.askId, matchOption(said, opts)).catch(() => undefined);
        open.delete(key);
      });
      void pump();
    }
    if (e.kind === 'step' && e.step?.status === 'waiting') {
      const key = `${e.runId}/${e.step.id}`;
      if (open.has(key)) return;
      const ctrl = new AbortController();
      open.set(key, ctrl);
      queue.push(async () => {
        if (ctrl.signal.aborted) return;
        await speak(`Lotus needs your permission: ${e.step.ask ?? e.step.label}. Say allow or deny.`);
        if (!p.answer || ctrl.signal.aborted) return;
        const said = await listen({ signal: ctrl.signal }).catch(() => '');
        if (!ctrl.signal.aborted && said) {
          if (NO.test(said)) await decideStep(e.runId, e.step.id, false).catch(() => undefined);
          else if (YES.test(said)) await decideStep(e.runId, e.step.id, true).catch(() => undefined);
        }
        open.delete(key);
      });
      void pump();
    }
    if (e.kind === 'step' && e.step?.status !== 'waiting') close(`${e.runId}/${e.step?.id}`);
  });
}
