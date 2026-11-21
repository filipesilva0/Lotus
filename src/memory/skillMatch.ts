// When a learned skill fits a message. Full-text search finds any skill that shares a single word with
// the message ("today", "write", "plan"…), which put "skill: draft a difficult email" under an agenda
// question. A skill is only used when the message names its subject: at least two distinct words in
// common with the skill's name, "when to use" and description, or, for a short message, one word that
// is part of the skill's name.
//
// Shared by the core (SQLite search) and the browser preview store.

const STOP = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'your', 'with', 'this', 'that', 'was', 'what', 'how', 'can', 'could',
  'would', 'should', 'have', 'has', 'had', 'from', 'they', 'them', 'then', 'than', 'there', 'here', 'about', 'into',
  'just', 'like', 'please', 'want', 'need', 'make', 'does', 'did', 'its', 'our', 'out', 'who', 'why', 'when',
  'where', 'which', 'will', 'all', 'any', 'some', 'one', 'get', 'got', 'use', 'using', 'me', 'my', 'is', 'it', 'to',
  'of', 'in', 'on', 'a', 'an', 'be', 'do', 'so', 'if', 'or', 'as', 'at', 'by', 'we', 'i',
  // Words almost every request or skill contains: they say nothing about the subject.
  'help', 'user', 'users', 'asks', 'ask', 'asked', 'write', 'writing', 'today', 'now', 'new', 'good', 'more', 'also', 'very',
  'thing', 'things', 'something', 'way', 'time', 'day', 'know', 'tell', 'give', 'show', 'let', 'lets', 'see', 'look', 'find',
  'work', 'task', 'tasks', 'step', 'steps', 'request', 'requests', 'question', 'questions', 'answer', 'reply', 'hey', 'hello', 'thanks']);

/** A rough stem, so "emails", "emailing" and "email" count as the same word. */
function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('es') && /(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** The distinct subject words of a text, stemmed, without stop words or very short words. */
export function subjectWords(text: string): string[] {
  const out: string[] = [];
  for (const raw of String(text ?? '').split(/[^\p{L}\p{N}]+/u)) {
    const w = raw.toLowerCase();
    if ([...w].length < 3 || STOP.has(w)) continue;
    const s = stem(w);
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

export interface SkillText { name: string; description?: string; whenToUse?: string }

/** How many distinct subject words of the message the skill shares, and whether one is in its name. */
export function skillOverlap(query: string, skill: SkillText): { shared: number; inName: boolean; queryWords: number } {
  const q = subjectWords(query).slice(0, 24);
  const name = new Set(subjectWords(skill.name));
  const all = new Set([...name, ...subjectWords(`${skill.whenToUse ?? ''} ${skill.description ?? ''}`)]);
  const hit = q.filter((w) => all.has(w));
  return { shared: hit.length, inName: hit.some((w) => name.has(w)), queryWords: q.length };
}

/** True when the skill is about what the message asks. */
export function skillFits(query: string, skill: SkillText): boolean {
  const o = skillOverlap(query, skill);
  if (o.shared >= 2) return true;
  return o.shared === 1 && o.inName && o.queryWords <= 3;
}
