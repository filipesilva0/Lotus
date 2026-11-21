// "1 item", "2 items", "1 memory", "3 memories". Used for every count shown next to a noun, so the
// app never says "1 microphones found".

const IRREGULAR: Record<string, string> = {
  memory: 'memories', story: 'stories', entry: 'entries', library: 'libraries', activity: 'activities',
  child: 'children', person: 'people', match: 'matches', search: 'searches', process: 'processes',
};

/** The plural of an English noun Lotus shows (simple rules, plus a few irregular words). */
export function pluralOf(word: string): string {
  const lower = word.toLowerCase();
  if (IRREGULAR[lower]) return word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase()
    ? IRREGULAR[lower][0].toUpperCase() + IRREGULAR[lower].slice(1) : IRREGULAR[lower];
  if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + 'ies';
  if (/(s|x|z|ch|sh)$/i.test(word)) return word + 'es';
  return word + 's';
}

/** The word on its own, singular for exactly one. */
export function noun(n: number, word: string, plural?: string): string {
  return n === 1 ? word : (plural ?? pluralOf(word));
}

/** "1 item" / "2 items", with the number formatted for the user's locale. */
export function count(n: number, word: string, plural?: string): string {
  return `${n.toLocaleString()} ${noun(n, word, plural)}`;
}
