// Rethink (0.9.1): the model reads its own answer again and writes an improved one, 2, 3 or 4 times
// in total ("multi-round thinking"). Offered in Chat's right panel for Nemotron models, which handle
// their own answer as input well. Pure: used by hooks/useChat.ts and tested in core/test/s18.test.ts.

/** Models the right panel offers Rethink for. */
export const canRethink = (model: string) => /nemotron/i.test(model);

/** How many answers to write in total (1 = no rethinking), for this model and setting. */
export function rethinkRounds(model: string, setting: number | undefined): number {
  if (!canRethink(model) || !setting) return 1;
  return Math.max(1, Math.min(4, Math.round(setting)));
}

export const RETHINK_CHOICES: { rounds: number; label: string }[] = [
  { rounds: 1, label: 'Once' },
  { rounds: 2, label: '2 Times' },
  { rounds: 3, label: '3 Times' },
  { rounds: 4, label: '4 Times' },
];

/** The message that asks for the next version. `round` is the answer about to be written (2…of). */
export function rethinkRequest(round: number, of: number): string {
  const last = round === of;
  return [
    `Rethink your answer above (review ${round - 1} of ${of - 1}).`,
    'Check it carefully: is everything correct, is anything important missing, is any part unclear or longer than it needs to be?',
    'Then write the complete improved answer.',
    last ? 'This is the final version the user will read.' : '',
    'Reply with the answer only, written as if it were your first reply: do not mention this review, your earlier version or what you changed.',
  ].filter(Boolean).join(' ');
}

/** Earlier versions of a reply, oldest first, as shown under the final answer. */
export const draftLabel = (i: number, total: number) => (i === 0 ? 'First answer' : `Rethink ${i} of ${total - 1}`);
