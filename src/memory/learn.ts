// Memory writing ("learning as we talk") and the skill loop. Runs as low-priority background agents
// (agentPool priority 2), so it never competes with a reply the user is waiting for, and only when
// memory is on for that chat (header toggle) and not in incognito.
//
//   reflect()        – every few turns: proposes add / update / remove operations on learned memories
//                      (never touches what the user saved by hand), deduplicated and size-capped.
//   considerSkill()  – after a complex task: writes a reusable skill, or improves the closest existing one.
//   refineSkill()    – when a skill that was used gets corrected by the user: rewrites that skill.
//   recordOutcome()  – positive feedback after a skill was used counts as a win.

import { MemoryItem } from '../types/lotus';
import { agentPool } from '../agents/pool';
import { extractJson, llm } from '../services/llm';
import { uid } from '../lib/persist';
import { memoryStore, queryWords, Skill } from './store';

export interface Turn { role: 'user' | 'assistant' | 'system'; content: string }

export const MAX_LEARNED = 80;
const MAX_TEXT = 220;

// ── pure helpers (tested) ───────────────────────────────────────────────────

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();

/** Word-set overlap (Jaccard) between two short texts. */
export function similarity(a: string, b: string): number {
  const A = new Set(norm(a).split(' ').filter(Boolean)), B = new Set(norm(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((w) => { if (B.has(w)) inter++; });
  return inter / (A.size + B.size - inter);
}

/** Things never to store, whatever the model proposes: secrets and identifiers. */
export function looksSensitive(text: string): boolean {
  return /\b(password|passcode|pin code|api[ _-]?key|secret|token|private key|ssh-rsa|iban|credit card|card number|social security|passport number)\b/i.test(text)
    || /\b(?:\d[ -]?){13,19}\b/.test(text) // card-like numbers
    || /\b(sk|pk|ghp|xox[abp])[-_][A-Za-z0-9]{12,}/.test(text); // key-like strings
}

export interface MemoryOps { add: { kind: 'memory' | 'instruction'; text: string }[]; update: { id: string; text: string }[]; remove: string[] }

/** Validates the model's proposal against the current list. Only learned ('auto') items can be changed. */
export function parseMemoryOps(raw: unknown, current: MemoryItem[]): MemoryOps {
  const out: MemoryOps = { add: [], update: [], remove: [] };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  const auto = new Set(current.filter((m) => m.source === 'auto').map((m) => m.id));
  const clean = (t: unknown) => (typeof t === 'string' ? t.replace(/\s+/g, ' ').trim().replace(/^[-•*]\s*/, '') : '');
  // Up to 3 accepted additions; rejected proposals do not use up a slot.
  for (const a of Array.isArray(r.add) ? r.add.slice(0, 10) : []) {
    if (out.add.length >= 3) break;
    const text = clean((a as Record<string, unknown>)?.text ?? a);
    const kind = (a as Record<string, unknown>)?.kind === 'instruction' ? 'instruction' : 'memory';
    if (text.length < 6 || text.length > MAX_TEXT || looksSensitive(text)) continue;
    if (current.some((m) => similarity(m.text, text) >= 0.7) || out.add.some((x) => similarity(x.text, text) >= 0.7)) continue;
    out.add.push({ kind, text });
  }
  for (const u of Array.isArray(r.update) ? r.update.slice(0, 5) : []) {
    const id = String((u as Record<string, unknown>)?.id ?? ''), text = clean((u as Record<string, unknown>)?.text);
    if (!auto.has(id) || text.length < 6 || text.length > MAX_TEXT || looksSensitive(text)) continue;
    out.update.push({ id, text });
  }
  for (const id of Array.isArray(r.remove) ? r.remove.slice(0, 5) : []) if (auto.has(String(id))) out.remove.push(String(id));
  return out;
}

/** Reflect every 3rd user turn, or sooner when the user says something about themselves. */
export function shouldReflect(userTurns: number, lastUserText: string): boolean {
  if (userTurns < 1) return false;
  if (/\b(i am|i'm|i work|my (name|job|team|project|company|wife|husband|kids?|setup|pc|gpu)|i prefer|i like|i hate|i use|call me|i live|we use|our (stack|team|company))\b/i.test(lastUserText)) return true;
  return userTurns % 3 === 0;
}

/** Whether a finished exchange looks like a multi-step task worth turning into a skill. */
export function isComplexExchange(turns: Turn[], o: { thinking?: boolean; taskSteps?: number }): boolean {
  if ((o.taskSteps ?? 0) >= 3) return true;
  const last = [...turns].reverse().find((t) => t.role === 'assistant')?.content ?? '';
  const steps = (last.match(/^\s*(?:\d+[.)]|[-*])\s+/gm) ?? []).length;
  const code = (last.match(/```/g) ?? []).length / 2;
  const heads = (last.match(/^#{1,4}\s/gm) ?? []).length;
  const userTurns = turns.filter((t) => t.role === 'user').length;
  const structured = steps >= 4 || code >= 1 || heads >= 2;
  return (last.length >= 1200 && structured) || (!!o.thinking && last.length >= 600) || (userTurns >= 4 && structured && last.length >= 500);
}

export const positiveFeedback = (t: string) => /\b(thanks?|thank you|works?( now)?|worked|perfect|great|awesome|nice|solved|fixed it|that did it)\b/i.test(t) && !/\b(doesn'?t|didn'?t|not|no longer)\s+work/i.test(t);
export const correction = (t: string) => /\b(doesn'?t work|didn'?t work|not working|wrong|incorrect|that'?s not|error|still (fails|broken)|failed|no,|actually)\b/i.test(t);

export interface SkillDraft { name: string; description: string; whenToUse: string; body: string; tags: string[] }

export function parseSkillDraft(raw: unknown): SkillDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.create === false || r.changed === false) return null;
  const s = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const name = s(r.name, 80).replace(/[\r\n]+/g, ' ');
  const body = s(r.body, 8000);
  const whenToUse = s(r.when_to_use ?? r.whenToUse, 300);
  const description = s(r.description, 300);
  if (!body || body.length < 80) return null;
  if (r.create === true && (!name || !whenToUse)) return null;
  if (looksSensitive(body)) return null;
  const tags = Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string').map((t) => t.toLowerCase().slice(0, 24)).slice(0, 6) : [];
  return { name, description, whenToUse, body, tags };
}

const transcript = (turns: Turn[], max = 9000) => {
  const text = turns.filter((t) => t.role !== 'system').map((t) => `${t.role === 'user' ? 'USER' : 'ASSISTANT'}: ${t.content}`).join('\n\n');
  return text.length > max ? `…${text.slice(-max)}` : text;
};

// ── background jobs ─────────────────────────────────────────────────────────

const REFLECT_PROMPT = (mem: MemoryItem[], convo: string) => `You maintain the long-term memory of a personal assistant that runs on the user's own PC.
Current memory (id: text; "user" items were saved by the user and must not be changed):
${mem.length ? mem.map((m) => `${m.id} [${m.source === 'auto' ? 'learned' : 'user'}${m.kind === 'instruction' ? ', instruction' : ''}]: ${m.text}`).join('\n') : '(empty)'}

Recent conversation:
${convo}

Propose changes so the memory stays accurate, short and useful for FUTURE conversations:
- add: durable facts the USER stated about themselves, their work, projects, setup or preferences, and standing instructions ("always …"). One fact per item, under 200 characters, written in the third person ("Uses Windows 11 with an RTX 4070").
- update: learned items that the conversation corrected or made more precise.
- remove: learned items the conversation shows are wrong or obsolete.
Never store: passwords, keys, account or ID numbers, health, religion, politics or other sensitive details, things the assistant said, one-off task details, or guesses.
If nothing is worth changing, return empty lists.
Reply with JSON only: {"add":[{"kind":"memory"|"instruction","text":"..."}],"update":[{"id":"...","text":"..."}],"remove":["id"]}`;

/** Background: update learned memories from the recent part of a conversation. */
export function reflect(turns: Turn[], label = 'Updating memory'): Promise<number> {
  return agentPool.run(label, 'memory', async ({ model, numCtx, signal }) => {
    const current = memoryStore.get().memories;
    const r = await llm.chatOnce([{ role: 'user', content: REFLECT_PROMPT(current, transcript(turns.slice(-8), 6000)) }], { model, numCtx, temperature: 0.1, json: true, signal, numPredict: 600 });
    const ops = parseMemoryOps(extractJson(r.content), current);
    const now = Date.now();
    const learned = current.filter((m) => m.source === 'auto').length;
    const room = Math.max(0, MAX_LEARNED - learned + ops.remove.length);
    const adds: MemoryItem[] = ops.add.slice(0, room).map((a) => ({ id: uid('mem'), kind: a.kind, text: a.text, source: 'auto', ts: now, updated: now, uses: 0 }));
    const ups: MemoryItem[] = ops.update.map((u) => ({ ...current.find((m) => m.id === u.id)!, text: u.text, updated: now }));
    for (const id of ops.remove) await memoryStore.deleteMemory(id);
    await memoryStore.putMemories([...adds, ...ups]);
    return adds.length + ups.length + ops.remove.length;
  }, { priority: 2 });
}

const SKILL_NEW_PROMPT = (convo: string, outcome: string) => `You are improving a local AI assistant by writing reusable "skills": short procedures it can follow next time a similar request comes up.
Here is a task it just completed${outcome ? ` (${outcome})` : ''}:
${convo}

Decide whether this contains a REUSABLE procedure (several concrete steps, commands, checks or decisions that would help with similar future requests). Small talk, single facts, opinions and one-off content are NOT skills.
If it is not worth saving, reply {"create": false}.
Otherwise reply with JSON only:
{"create": true,
 "name": "short imperative title, e.g. Set up a Vite + React project on Windows",
 "description": "one sentence: what the skill achieves",
 "when_to_use": "the kind of request that should trigger it",
 "tags": ["2-5 lowercase keywords"],
 "body": "Markdown with: ## Steps (numbered, concrete, generalised: no names or data specific to this one user), ## Pitfalls, ## Check that it worked"}`;

const SKILL_REFINE_PROMPT = (skill: Skill, convo: string, why: string) => `You maintain a skill (a reusable procedure) for a local AI assistant.
Current skill "${skill.name}" (version ${skill.version}):
When to use: ${skill.whenToUse}
${skill.body}

It was just used in this conversation, and ${why}:
${convo}

Improve the skill with what this conversation taught (fix wrong steps, add the missing step or pitfall, make vague steps concrete). Keep it general and in the same Markdown structure.
If the conversation teaches nothing new, reply {"changed": false}.
Otherwise reply with JSON only: {"changed": true, "description": "...", "when_to_use": "...", "body": "...", "note": "one line: what changed"}`;

/** Background: after a complex task, write a new skill or improve the most similar existing one. */
export function considerSkill(turns: Turn[], o: { outcome?: string; label?: string } = {}): Promise<Skill | null> {
  return agentPool.run(o.label ?? 'Learning a skill', 'skill', async ({ model, numCtx, signal }) => {
    const convo = transcript(turns, Math.min(12_000, numCtx * 2));
    const firstUser = turns.find((t) => t.role === 'user')?.content ?? '';
    // Similar skill already there? Improve it instead of adding a near-duplicate.
    const ids = await memoryStore.searchSkills(firstUser, 1);
    const near = ids.length ? memoryStore.get().skills.find((s) => s.id === ids[0]) : undefined;
    if (near && queryWords(firstUser).filter((w) => queryWords(`${near.name} ${near.whenToUse}`).includes(w)).length >= 2) {
      return refineWith(near, convo, 'the user found it helpful for a similar task', model, numCtx, signal);
    }
    const r = await llm.chatOnce([{ role: 'user', content: SKILL_NEW_PROMPT(convo, o.outcome ?? '') }], { model, numCtx, temperature: 0.2, json: true, signal, numPredict: 1500 });
    const d = parseSkillDraft(extractJson(r.content));
    if (!d || !d.name) return null;
    if (memoryStore.get().skills.some((s) => similarity(s.name, d.name) >= 0.6)) return null;
    const now = Date.now();
    const skill: Skill = { id: uid('skill'), name: d.name, description: d.description, whenToUse: d.whenToUse, body: d.body, tags: d.tags, version: 1, uses: 0, wins: 0, enabled: true, origin: 'auto', created: now, updated: now, history: [{ at: now, note: 'Written after a completed task' }] };
    await memoryStore.putSkill(skill);
    return skill;
  }, { priority: 2 });
}

async function refineWith(skill: Skill, convo: string, why: string, model: string, numCtx: number, signal: AbortSignal): Promise<Skill | null> {
  const r = await llm.chatOnce([{ role: 'user', content: SKILL_REFINE_PROMPT(skill, convo, why) }], { model, numCtx, temperature: 0.2, json: true, signal, numPredict: 1500 });
  const raw = extractJson<Record<string, unknown>>(r.content);
  const d = parseSkillDraft(raw);
  if (!d) return null;
  const now = Date.now();
  const note = typeof raw?.note === 'string' ? raw.note.slice(0, 160) : 'Improved after use';
  const next: Skill = {
    ...skill, body: d.body, description: d.description || skill.description, whenToUse: d.whenToUse || skill.whenToUse,
    version: skill.version + 1, updated: now, origin: skill.origin, history: [...(skill.history ?? []), { at: now, note }],
  };
  await memoryStore.putSkill(next);
  return next;
}

/** Background: a skill that was used got corrected; rewrite it with the correction. */
export function refineSkill(skill: Skill, turns: Turn[]): Promise<Skill | null> {
  return agentPool.run(`Improving skill: ${skill.name}`, 'skill', ({ model, numCtx, signal }) =>
    refineWith(skill, transcript(turns.slice(-6), 8000), 'the user said something did not work or was wrong', model, numCtx, signal), { priority: 2 });
}

/** Counts a use, and a win when the user's next message is positive. */
export async function recordUse(skills: Skill[]) {
  for (const s of skills) {
    const cur = memoryStore.get().skills.find((x) => x.id === s.id);
    if (cur) await memoryStore.putSkill({ ...cur, uses: cur.uses + 1 });
  }
}
export async function recordWin(skillIds: string[]) {
  for (const id of skillIds) {
    const cur = memoryStore.get().skills.find((x) => x.id === id);
    if (cur) await memoryStore.putSkill({ ...cur, wins: cur.wins + 1 });
  }
}
