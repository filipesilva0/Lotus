// Memory reading: what long-term memory adds to a request.
//   * standing instructions and remembered facts (all of them while they fit; otherwise the user's own
//     plus the best full-text matches),
//   * snippets from past conversations that match the message (SQLite FTS5 session search),
//   * up to two learned skills whose description matches the message,
//   * project context files from the workspace folder.
// Called only when memory is on for the chat (the header toggle), except project soul/rules files.

import { MemoryItem } from '../types/lotus';
import { memoryStore, SessionHit, Skill } from './store';
import { ContextFile, contextBlock } from '../context/discover';

export interface RecallInput {
  query: string;
  sessionId: string;
  memoryOn: boolean;
  sessionRecall: boolean;
  projectFiles: ContextFile[];
  projectOff?: string[];
  /** Characters this block may use in total. */
  budgetChars: number;
}

export interface RecallResult {
  system: string;
  info: { memories: number; sessions: number; skills: string[]; projectFiles: number };
  usedSkills: Skill[];
  usedMemoryIds: string[];
}

const MEMORY_ALL_CHARS = 2400;

/** Chooses memory items: all if they fit, else user-written ones, then matches, then most recent. */
export function pickMemories(all: MemoryItem[], matchIds: string[], maxChars: number): MemoryItem[] {
  const size = (l: MemoryItem[]) => l.reduce((n, m) => n + m.text.length + 4, 0);
  if (size(all) <= maxChars) return all;
  const out: MemoryItem[] = [];
  const add = (m: MemoryItem | undefined) => { if (m && !out.includes(m) && size(out) + m.text.length + 4 <= maxChars) out.push(m); };
  all.filter((m) => m.kind === 'instruction').forEach(add);
  all.filter((m) => m.source !== 'auto').forEach(add);
  matchIds.forEach((id) => add(all.find((m) => m.id === id)));
  [...all].sort((a, b) => (b.updated ?? b.ts) - (a.updated ?? a.ts)).forEach(add);
  return out;
}

/** Groups hits by conversation: at most `n` conversations, two snippets each. */
export function groupHits(hits: SessionHit[], n = 3): { sessionId: string; title: string; ts: number; snippets: string[] }[] {
  const groups: { sessionId: string; title: string; ts: number; snippets: string[] }[] = [];
  for (const h of hits) {
    let g = groups.find((x) => x.sessionId === h.sessionId);
    if (!g) { if (groups.length >= n) continue; g = { sessionId: h.sessionId, title: h.title, ts: h.ts, snippets: [] }; groups.push(g); }
    if (g.snippets.length < 2) g.snippets.push(`${h.role === 'user' ? 'User' : 'Assistant'}: ${h.snippet.replace(/\s+/g, ' ').slice(0, 300)}`);
  }
  return groups;
}

export async function buildRecall(i: RecallInput): Promise<RecallResult> {
  const info = { memories: 0, sessions: 0, skills: [] as string[], projectFiles: 0 };
  let system = '';
  const usedSkills: Skill[] = [];
  const usedMemoryIds: string[] = [];

  // Project files: soul and rules always apply to the workspace; project memory only while memory is on.
  if (i.projectFiles.length) {
    const pb = contextBlock(i.projectFiles, { off: i.projectOff, includeMemory: i.memoryOn, budgetChars: Math.floor(i.budgetChars * 0.45) });
    system += pb.text;
    info.projectFiles = pb.used.length;
  }
  if (!i.memoryOn) return { system, info, usedSkills, usedMemoryIds };

  const st = memoryStore.get();
  const q = i.query.slice(0, 600);
  const [memIds, hits, skillIds] = await Promise.all([
    st.memories.length ? memoryStore.searchMemories(q, 10) : Promise.resolve([] as string[]),
    i.sessionRecall && q.trim() ? memoryStore.searchSessions(q, i.sessionId, 8) : Promise.resolve([] as SessionHit[]),
    st.skills.some((s) => s.enabled) && q.trim() ? memoryStore.searchSkills(q, 4) : Promise.resolve([] as string[]),
  ]);

  const mems = pickMemories(st.memories, memIds, Math.min(MEMORY_ALL_CHARS, Math.floor(i.budgetChars * 0.2)));
  const instr = mems.filter((m) => m.kind === 'instruction');
  const facts = mems.filter((m) => m.kind === 'memory');
  if (instr.length) system += `\n\nStanding instructions from the user:\n${instr.map((m) => `- ${m.text}`).join('\n')}`;
  if (facts.length) system += `\n\nWhat you know about the user (from earlier conversations; use when relevant, don't recite):\n${facts.map((m) => `- ${m.text}`).join('\n')}`;
  info.memories = mems.length;
  usedMemoryIds.push(...mems.map((m) => m.id));

  const groups = groupHits(hits, 3);
  if (groups.length) {
    let left = Math.floor(i.budgetChars * 0.15);
    const lines: string[] = [];
    for (const g of groups) {
      const block = `• “${g.title}” (${new Date(g.ts).toLocaleDateString()}):\n  ${g.snippets.join('\n  ')}`;
      if (block.length > left) break;
      left -= block.length;
      lines.push(block);
    }
    if (lines.length) {
      system += `\n\nPossibly relevant excerpts from past conversations with this user (they may be outdated; mention them only if they help):\n${lines.join('\n')}`;
      info.sessions = lines.length;
    }
  }

  const skills = skillIds.map((id) => st.skills.find((s) => s.id === id)).filter((s): s is Skill => !!s && s.enabled).slice(0, 2);
  if (skills.length) {
    let left = Math.floor(i.budgetChars * 0.2);
    const parts: string[] = [];
    for (const s of skills) {
      const body = s.body.length > left ? `${s.body.slice(0, Math.max(0, left))}…` : s.body;
      if (left < 300) break;
      left -= body.length;
      parts.push(`### Skill: ${s.name}\nUse when: ${s.whenToUse}\n${body}`);
      usedSkills.push(s);
      info.skills.push(s.name);
    }
    if (parts.length) system += `\n\nSkills you wrote for yourself after earlier tasks. Follow one if it fits this request; ignore them otherwise:\n${parts.join('\n\n')}`;
  }
  return { system, info, usedSkills, usedMemoryIds };
}
