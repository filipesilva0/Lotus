// "Do something with what I just copied" (idea 4). The Windows side reports copied text (never from
// password managers, which mark their copies); these rules decide whether the island offers actions.

export type ClipActionId = 'explain' | 'summarise' | 'translate' | 'fix' | 'read';
export const clipActions: { id: ClipActionId; label: string }[] = [
  { id: 'explain', label: 'Explain' },
  { id: 'summarise', label: 'Summarise' },
  { id: 'translate', label: 'Translate' },
  { id: 'fix', label: 'Fix wording' },
  { id: 'read', label: 'Read aloud' },
];

/** Worth a peek: some words, not a password-looking token, not a single link or number. */
export function clipWorthShowing(text: string): boolean {
  const t = text.trim();
  if (t.length < 12) return false;
  if (!/\s/.test(t)) return false; // one token: a password, key, link or file path
  return (t.match(/\p{L}{2,}/gu) ?? []).length >= 3;
}

export function clipPrompt(id: Exclude<ClipActionId, 'read'>, text: string, language: string): string {
  const quote = `"""\n${text.slice(0, 20_000)}\n"""`;
  switch (id) {
    case 'explain': return `Explain this simply, in a few sentences:\n${quote}`;
    case 'summarise': return `Summarise this in 3 short bullet points:\n${quote}`;
    case 'translate': return `Translate this into ${language}. Reply with the translation only:\n${quote}`;
    case 'fix': return `Fix the spelling, grammar and wording of this. Keep the meaning and tone. Reply with the fixed text only:\n${quote}`;
  }
}
