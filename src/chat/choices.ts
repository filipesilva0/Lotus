// Interactive choices in chat replies (session 7).
//
// When a reply asks the user to pick something, Lotus shows the options as buttons instead of
// making the user retype them. Two sources:
//   1. A fenced ```choices block with JSON (the system prompt asks models to use it). One question,
//      or a questionnaire: { "title"?, "questions": [ … ] }.
//   2. A fallback for models that ignore the instruction: the reply ends with a question followed
//      (or preceded) by a short lettered/numbered/bulleted list of options.
// Pure functions only, so the harness can test them without a DOM.

export type QuestionType = 'single' | 'multi' | 'text';

export interface ChoiceQuestion {
  id: string;
  question: string;
  type: QuestionType;
  options: string[];
  /** Offer a free-text "Other" answer next to the options. */
  allowOther: boolean;
}

export interface ChoicePoll {
  title?: string;
  questions: ChoiceQuestion[];
  /** 'block' = the model sent a ```choices block; 'list' = recognised from a plain list. */
  source: 'block' | 'list';
}

export interface ParsedChoices {
  /** Reply text with the choices block removed (unchanged for 'list' polls). */
  text: string;
  poll: ChoicePoll | null;
  /** True while a ```choices block is still streaming in (hide it, show a placeholder). */
  pending: boolean;
}

/** Added to the system prompt so models emit options in a form Lotus can turn into buttons. */
export const CHOICES_INSTRUCTIONS =
  '\n\nWhen you ask the user to choose between options (or ask several short questions at once), add a fenced code block with the language "choices" at the very end of your reply, after the question in plain text. Its content is JSON: ' +
  '{"question":"…","type":"single","options":["…","…"],"allowOther":true} for one question (type "multi" when several answers may be picked), or ' +
  '{"title":"…","questions":[{"question":"…","type":"single","options":["…"]},{"question":"…","type":"text"}]} for a short questionnaire. ' +
  'Keep options short (under 80 characters), 2 to 8 per question. Do not use the block for anything else.';

const MAX_OPTIONS = 12;
const MAX_QUESTIONS = 8;
const OPEN_RE = /(^|\n)[ ]{0,3}(`{3,}|~{3,})[ \t]*choices[ \t]*\n/i;

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

function normaliseQuestion(raw: unknown, i: number): ChoiceQuestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const question = str(r.question ?? r.q ?? r.prompt ?? r.label, 300);
  const opts = Array.isArray(r.options ?? r.choices) ? ((r.options ?? r.choices) as unknown[]) : [];
  const options = [...new Set(opts.map((o) => (typeof o === 'object' && o ? str((o as Record<string, unknown>).label ?? (o as Record<string, unknown>).text, 160) : str(o, 160))).filter(Boolean))].slice(0, MAX_OPTIONS);
  let type: QuestionType = r.type === 'multi' || r.multi === true || r.multiple === true ? 'multi' : r.type === 'text' ? 'text' : 'single';
  if (type !== 'text' && options.length < 2) {
    // A question without usable options is still answerable as free text.
    if (!question) return null;
    type = 'text';
  }
  if (!question && type === 'text') return null;
  return {
    id: str(r.id, 40) || `q${i + 1}`,
    question,
    type,
    options: type === 'text' ? [] : options,
    allowOther: type !== 'text' && r.allowOther !== false && r.other !== false,
  };
}

/** Validates the JSON of a ```choices block. Returns null when it holds nothing usable. */
export function pollFromJson(json: unknown): ChoicePoll | null {
  if (Array.isArray(json)) json = { questions: json };
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  const list = Array.isArray(o.questions) ? o.questions : [o];
  const questions = list.slice(0, MAX_QUESTIONS).map(normaliseQuestion).filter((q): q is ChoiceQuestion => !!q);
  // Ids must be unique for the answer form.
  questions.forEach((q, i) => { if (questions.findIndex((x) => x.id === q.id) !== i) q.id = `q${i + 1}`; });
  if (!questions.length) return null;
  const title = Array.isArray(o.questions) ? str(o.title, 160) || undefined : undefined;
  return { title, questions, source: 'block' };
}

/** Finds and removes a ```choices block. Unclosed blocks (still streaming) are hidden and flagged. */
function extractBlock(content: string): ParsedChoices | null {
  const m = OPEN_RE.exec(content);
  if (!m) return null;
  const start = m.index + m[1].length;
  const fence = m[2];
  const bodyStart = m.index + m[0].length;
  const closeRe = new RegExp(`\\n[ ]{0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*(?:\\n|$)`);
  const rest = content.slice(bodyStart - 1);
  const c = closeRe.exec(rest);
  const before = content.slice(0, start).replace(/\s+$/, '');
  if (!c) return { text: before, poll: null, pending: true };
  const body = rest.slice(1, c.index);
  const after = rest.slice(c.index + c[0].length);
  const text = (before + (after.trim() ? `\n\n${after.trim()}` : '')).trim();
  let poll: ChoicePoll | null = null;
  try { poll = pollFromJson(JSON.parse(body)); } catch { poll = null; }
  // Broken JSON: show the reply without the block rather than a wall of JSON.
  return { text, poll, pending: false };
}

const OPTION_RE = /^\s*(?:\(?([A-Ha-h])[).:]|\(?([1-9])[).]|[-*•])\s+(.+?)\s*$/;
const ASKS_RE = /\?\s*\**\s*$|\b(choose|pick|select|which (one|option)|prefer|would you like|let me know which|options?:)\b/i;
const CHOICE_WORDS_RE = /\b(which|choose|pick|select|prefer|would you like|want me to|do you want|should i|option|go with)\b/i;
const CODE_FENCE_RE = /^\s*(`{3,}|~{3,})/;

/** Removes simple Markdown emphasis so "**A) Fast**" becomes "Fast". */
const plain = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/(^|\s)[*_](\S.*?\S|\S)[*_](?=\s|$)/g, '$1$2').replace(/`([^`]+)`/g, '$1').trim();

/**
 * Fallback: recognises a short option list tied to a question at the end of a reply.
 * Conservative on purpose: lists inside code, long items, or lists that are not about a choice
 * are left alone, so ordinary bullet points never turn into buttons.
 */
export function pollFromList(content: string): ChoicePoll | null {
  const lines = content.replace(/\r/g, '').split('\n');
  // Ignore anything inside code fences.
  let inCode = false;
  const visible = lines.map((l) => { if (CODE_FENCE_RE.test(l)) { inCode = !inCode; return ''; } return inCode ? '' : l; });
  // Trim trailing blank lines.
  let end = visible.length - 1;
  while (end >= 0 && !visible[end].trim()) end--;
  if (end < 1) return null;

  const collect = (from: number, dir: 1 | -1) => {
    const items: { text: string; marker: string }[] = [];
    let i = from;
    while (i >= 0 && i < visible.length) {
      const l = visible[i];
      if (!l.trim()) { if (items.length) break; i += dir; continue; }
      const m = OPTION_RE.exec(l);
      if (!m) break;
      items.push({ text: plain(m[3]), marker: m[1] ? 'letter' : m[2] ? 'number' : 'bullet' });
      i += dir;
    }
    return { items: dir === -1 ? items.reverse() : items, next: i };
  };
  const valid = (items: { text: string; marker: string }[]) =>
    items.length >= 2 && items.length <= 8 && items.every((x) => x.text.length > 0 && x.text.length <= 120 && !/\n/.test(x.text)) &&
    new Set(items.map((x) => x.marker)).size === 1;

  // Case 1: "…which do you prefer?" followed by the list as the last block.
  const tail = collect(end, -1);
  if (valid(tail.items)) {
    let q = tail.next;
    while (q >= 0 && !visible[q].trim()) q--;
    const question = q >= 0 ? plain(visible[q].replace(/^#+\s*/, '')) : '';
    if (question && ASKS_RE.test(question) && !OPTION_RE.test(visible[q])) {
      return {
        questions: [{ id: 'q1', question, type: /\b(any|all|several|multiple) (of|that)\b|select all/i.test(question) ? 'multi' : 'single', options: tail.items.map((x) => x.text), allowOther: true }],
        source: 'list',
      };
    }
  }
  // Case 2: the list, then a closing question as the last line ("Which one should I use?").
  const lastLine = plain(visible[end]);
  if (/\?\s*$/.test(lastLine) && !OPTION_RE.test(visible[end])) {
    let k = end - 1;
    while (k >= 0 && !visible[k].trim()) k--;
    const before = collect(k, -1);
    if (valid(before.items) && before.items[0].marker !== 'bullet' && CHOICE_WORDS_RE.test(lastLine)) {
      return { questions: [{ id: 'q1', question: lastLine, type: 'single', options: before.items.map((x) => x.text), allowOther: true }], source: 'list' };
    }
  }
  return null;
}

/** Everything the chat view needs: the text to render, and the poll (if any). */
export function parseChoices(content: string): ParsedChoices {
  const block = extractBlock(content);
  if (block) return block;
  return { text: content, poll: pollFromList(content), pending: false };
}

export type ChoiceAnswers = Record<string, string[]>;

/** The message sent on the user's behalf when they answer. One question → just the answer. */
export function answerText(poll: ChoicePoll, answers: ChoiceAnswers): string {
  const filled = poll.questions.filter((q) => (answers[q.id] ?? []).some((a) => a.trim()));
  if (poll.questions.length === 1) return (answers[poll.questions[0].id] ?? []).map((a) => a.trim()).filter(Boolean).join(', ');
  return filled.map((q) => `**${q.question || q.id}**\n${(answers[q.id] ?? []).map((a) => a.trim()).filter(Boolean).join(', ')}`).join('\n\n');
}

/** Every question needs an answer before a questionnaire can be sent. */
export function complete(poll: ChoicePoll, answers: ChoiceAnswers): boolean {
  return poll.questions.every((q) => (answers[q.id] ?? []).some((a) => a.trim()));
}
