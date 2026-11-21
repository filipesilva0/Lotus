// One assistant identity (0.20). The Soul (Settings → system prompt, Assistant → Soul) already reaches every
// surface: Chat, Work, voice calls and the island all send it first. What differed was the name on screen:
// Chat had no label, Work, Call and Talk said "Lotus" even when the Soul said "You are Aura". The name
// shown everywhere now comes from the Soul, so the label and the voice always match.

import { useEffect, useState } from 'react';

const NAME = "[A-Z\\u00C0-\\u024F][\\w\\u00C0-\\u024F'’-]{0,23}(?: [A-Z\\u00C0-\\u024F][\\w\\u00C0-\\u024F'’-]{0,23})?";
const PATTERNS = [
  new RegExp(`\\byour name is\\s+["“]?(${NAME})`, 'i'),
  new RegExp(`\\bcall yourself\\s+["“]?(${NAME})`, 'i'),
  new RegExp(`\\byou are called\\s+["“]?(${NAME})`, 'i'),
  new RegExp(`\\b[Yy]ou(?: are|'re|’re)\\s+["“]?(${NAME})\\b`),
  new RegExp(`\\b(?:I am|I'm|I’m)\\s+["“]?(${NAME})\\b`),
];
/** Words that follow "You are" without being a name ("You are Helpful", "You are An assistant"). */
const NOT_NAMES = new Set(['a', 'an', 'the', 'my', 'your', 'not', 'now', 'here', 'very', 'always', 'never', 'helpful', 'friendly', 'concise', 'running', 'english', 'portuguese']);

/** The name the Soul gives the assistant, or "Lotus". Pure, for tests. */
export function assistantName(soul: string | undefined | null): string {
  const text = String(soul ?? '').slice(0, 2000);
  for (const re of PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const name = m[1].trim().replace(/[.,;:!?'’"”]+$/, '');
    const [first, second] = name.split(' ');
    if (!first || NOT_NAMES.has(first.toLowerCase()) || first[0] !== first[0].toUpperCase()) continue;
    // A second word counts only when it is capitalised too ("Lotus Pro", not "Ana and").
    return second && second[0] === second[0].toUpperCase() && second[0] !== second[0].toLowerCase() ? `${first} ${second}` : first;
  }
  return 'Lotus';
}

let current = 'Lotus';
const subs = new Set<(n: string) => void>();
/** App calls this whenever the Soul changes. */
export function setSoul(soul: string | undefined | null): void {
  const n = assistantName(soul);
  if (n === current) return;
  current = n;
  subs.forEach((f) => f(n));
}
export const currentAssistantName = (): string => current;
/** The assistant's name, updated live when the Soul changes. */
export function useAssistantName(): string {
  const [n, setN] = useState(current);
  useEffect(() => { setN(current); subs.add(setN); return () => { subs.delete(setN); }; }, []);
  return n;
}
