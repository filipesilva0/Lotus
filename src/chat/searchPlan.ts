// Web search planning (pure, tested in core/test/web-search.test.ts). With Web on, Chat used to search
// every message by its own words: a follow-up such as "and the yellow one?" in a chat about graphics
// cards went to the search engine as "the yellow one" (and found bananas), and "thanks!" was searched too.
// Now, before searching, the chat model reads the recent conversation and answers in one line whether
// the latest message needs the web and, if so, a query that stands on its own. If the model can't answer
// in that shape (or takes too long), a simple rule does the same job less cleverly.

import { queryFromMessage } from './webQuery';

export interface PlanMsg { role: 'user' | 'assistant' | 'system'; content: string }
export interface SearchPlan { search: boolean; query: string; by: 'model' | 'rule' }

export const PLAN_SYSTEM = `You decide whether the user's latest chat message needs a web search, and write the search query.
Reply with exactly one line, either
SEARCH: <query>
or
NO SEARCH
Search when a good answer depends on facts that are current, specific or that you may not know well: news, prices, releases, product specs, people, companies, places, events, sports, weather, software versions and documentation, anything "latest" or "today".
Do not search for greetings, thanks, small talk, opinions or advice, writing, rewriting or translating text, maths, code the user pasted, or questions about this conversation itself.
The query must make sense on its own, without the conversation: replace words like it, that, this one, they, the yellow one with what they refer to earlier in the conversation. Use 3 to 10 keywords in the language of the user's message. No quotes and no explanation.`;

const clip = (s: string, n: number) => {
  const t = s.replace(/```[\s\S]*?```/g, ' [code] ').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/** The two messages for the planning call: the rules, and the last few turns plus the latest message. */
export function planTurns(history: PlanMsg[], message: string): { role: 'system' | 'user'; content: string }[] {
  const recent = history.filter((m) => m.role !== 'system' && m.content.trim()).slice(-6);
  const convo = recent.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${clip(m.content, m.role === 'user' ? 300 : 400)}`).join('\n');
  return [
    { role: 'system', content: PLAN_SYSTEM },
    { role: 'user', content: `${convo ? `Conversation so far:\n${convo}\n\n` : ''}Latest message from the user:\n${clip(message, 600)}\n\nYour one line:` },
  ];
}

/** Reads the model's one line. null when it didn't follow the format (the rule is used instead). */
export function parsePlan(raw: string): { search: boolean; query: string } | null {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*<\/think>/i, '').trim();
  for (const line of text.split('\n').map((l) => l.replace(/\*\*|__/g, '').replace(/^[\s>*_`#-]+|[\s*_`]+$/g, ''))) {
    if (/^no[\s_-]*search\b/i.test(line)) return { search: false, query: '' };
    const m = /^search\s*(?:query)?\s*[:：-]\s*(.+)$/i.exec(line);
    if (m) {
      const query = m[1].replace(/^["'“”‘’<\[]+|["'“”‘’>\].]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
      return query.length >= 2 && !/^<?query>?$/i.test(query) ? { search: true, query } : null;
    }
  }
  return null;
}

const SMALL_TALK = /^(?:thanks?(?: you)?|thx|ty|ok(?:ay)?|cool|nice|great|perfect|awesome|got it|hi|hello|hey|yo|lol|haha|yes|no|yep|nope|sure|good(?: (?:morning|night|evening))?|bye)\b[\s!.,:)]*$/i;
const NO_SEARCH = /^(?:(?:please\s+)?(?:re)?write|rephrase|translate|summari[sz]e (?:this|that|it|the above)|fix (?:this|my) (?:code|text|grammar)|make it (?:shorter|longer|simpler|funnier))\b/i;
const FOLLOW_UP = /^(?:and|or|but|so|also|what about|how about|what of|which one|is it|are they|does it|do they|can it|why|how come)\b|\b(?:it|its|it's|that|this|these|those|they|them|their|one|ones|same|there)\b/i;
const STOP = new Set('a an the and or but so of to in on at for with by from about as is are was were be been it its this that these those they them their there here what which who whom whose when where why how do does did can could would should will i you he she we me my your our us please tell show find give know think want need like just also any some more most much many very really one ones same'.split(' '));

/** The main words of a message (for topping up a follow-up's query). */
export function keywords(text: string, max = 6): string[] {
  const words = queryFromMessage(text).replace(/[^\p{L}\p{N}\s.+#-]/gu, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w.toLowerCase()));
  return [...new Set(words)].slice(0, max);
}

/** The rule used when the model's answer can't be read: skip small talk and text jobs; give follow-ups their topic. */
export function rulePlan(history: PlanMsg[], message: string): SearchPlan {
  const m = message.replace(/\s+/g, ' ').trim();
  if (m.length < 3 || SMALL_TALK.test(m) || NO_SEARCH.test(m)) return { search: false, query: '', by: 'rule' };
  let query = queryFromMessage(m) || m.slice(0, 200);
  const prevUser = [...history].reverse().find((x) => x.role === 'user' && x.content.trim() && x.content.trim() !== m);
  const words = m.split(' ').length;
  if (prevUser && (FOLLOW_UP.test(m) || words <= 6)) {
    const have = new Set(keywords(query, 20).map((w) => w.toLowerCase()));
    const topic = keywords(prevUser.content).filter((w) => !have.has(w.toLowerCase()));
    if (topic.length) query = `${topic.join(' ')} ${query}`.slice(0, 200);
  }
  return { search: true, query, by: 'rule' };
}

/**
 * Plans the search: asks the model (with `ask`), falls back to the rule. `ask` gets the turns and returns
 * the model's reply; errors and timeouts (the caller's signal) count as no answer.
 */
export async function planSearch(history: PlanMsg[], message: string, ask: ((turns: ReturnType<typeof planTurns>) => Promise<string>) | null): Promise<SearchPlan> {
  const m = message.replace(/\s+/g, ' ').trim();
  if (m.length < 3 || SMALL_TALK.test(m)) return { search: false, query: '', by: 'rule' };
  if (ask) {
    try {
      const p = parsePlan(await ask(planTurns(history, message)));
      if (p) return { ...p, by: 'model' };
    } catch { /* the rule below */ }
  }
  return rulePlan(history, message);
}
