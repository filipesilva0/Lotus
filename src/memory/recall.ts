// Memory reading: what memory adds to a request.
//   * 0.22: only the memories that fit this message, from three layers (memory/layers.ts pickRecall):
//     standing instructions, this chat's notes, short-term matches and the newest short-term items, and
//     long-term facts that match. The rest stays out of the prompt; the model can look it up with
//     memory.search (said in one line when it has tools),
//   * snippets from past conversations that match the message (SQLite FTS5 session search),
//   * up to two learned skills whose description matches the message,
//   * project context files from the workspace folder.
// Called only when memory is on for the chat (the header toggle), except project soul/rules files.

import { MemoryItem } from '../types/lotus';
import { pickRecall } from './layers';
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
  /** The model has the memory.search tool (agent tools on): tell it there is more to look up. */
  canSearch?: boolean;
}

export interface RecallResult {
  system: string;
  info: { memories: number; sessions: number; skills: string[]; projectFiles: number };
  usedSkills: Skill[];
  usedMemoryIds: string[];
}

/** 0.22: at most this much memory per message (about 350 tokens), was 2,400 characters of everything. */
export const MEMORY_CHARS = 1400;

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
    st.memories.length && q.trim() ? memoryStore.searchMemories(q, 12, { chatId: i.sessionId }) : Promise.resolve([] as string[]),
    i.sessionRecall && q.trim() ? memoryStore.searchSessions(q, i.sessionId, 8) : Promise.resolve([] as SessionHit[]),
    st.skills.some((s) => s.enabled) && q.trim() ? memoryStore.searchSkills(q, 4) : Promise.resolve([] as string[]),
  ]);

  const pick = pickRecall(st.memories, memIds, { chatId: i.sessionId, maxChars: Math.min(MEMORY_CHARS, Math.floor(i.budgetChars * 0.2)) });
  const list = (l: MemoryItem[]) => l.map((m) => `- ${m.text}`).join('\n');
  if (pick.instructions.length) system += `\n\nStanding instructions from the user:\n${list(pick.instructions)}`;
  const facts = [
    pick.chat.length ? `About this chat:\n${list(pick.chat)}` : '',
    pick.short.length ? `Going on lately:\n${list(pick.short)}` : '',
    pick.long.length ? `${pick.chat.length || pick.short.length ? 'Lasting facts:\n' : ''}${list(pick.long)}` : '',
  ].filter(Boolean);
  if (facts.length) system += `\n\nWhat you remember about the user (use when relevant, don't recite):\n${facts.join('\n')}`;
  if (pick.more > 0 && i.canSearch) system += `\n(You remember ${pick.more} more thing${pick.more === 1 ? '' : 's'}; use memory.search if something about the user or an earlier chat would help.)`;
  const mems = [...pick.instructions, ...pick.chat, ...pick.short, ...pick.long];
  info.memories = mems.length;
  usedMemoryIds.push(...mems.map((m) => m.id));
  if (pick.matched.length) void memoryStore.touch(pick.matched);

  const groups = groupHits(hits, 2);
  if (groups.length) {
    let left = Math.min(900, Math.floor(i.budgetChars * 0.15));
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
