// Long-term memory store used by chat, tasks and skills.
// In the desktop app everything lives in SQLite with FTS5 full-text search (src-tauri/src/memory_db.rs).
// In a plain browser (vite preview, tests) a localStorage + word-matching fallback keeps the UI working.
// One shared instance; React components subscribe with `useMemoryStore()`.

import { useSyncExternalStore } from 'react';
import { invokeNative } from '../lib/bus';
import { isTauri } from '../lib/http';
import { MemoryItem } from '../types/lotus';

export interface Skill {
  id: string;
  name: string;
  description: string;
  whenToUse: string;
  /** Markdown: steps, pitfalls, how to check the result. */
  body: string;
  tags: string[];
  version: number;
  /** Times it was loaded into a reply, and times the user confirmed it worked. */
  uses: number;
  wins: number;
  enabled: boolean;
  /** 'auto' = written by Lotus; 'user' = written or edited by the user. */
  origin: 'auto' | 'user';
  created: number;
  updated: number;
  /** Change notes, newest last (kept short). */
  history?: { at: number; note: string }[];
}

export interface SessionHit { id: string; sessionId: string; title: string; role: string; snippet: string; ts: number; score: number }
export interface IndexedMsg { id: string; sessionId: string; title: string; role: string; content: string; ts: number }
export interface MemoryStatus { native: boolean; fts5: boolean; path: string; messages: number; memories: number; skills: number }

// ── word matching shared by the browser fallback and tests ─────────────────

const STOP = new Set('the and for are but not you your with this that was what how can could would should have has had from they them then than there here about into just like please want need make does did its it\'s our out who why when where which will all any some one get got use using me my is it to of in on a an be do so if or as at by we i'.split(' '));

/** Same filtering as the Rust `fts_query`: up to 12 distinct lowercase words. */
export function queryWords(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[^\p{L}\p{N}]+/u)) {
    const w = raw.toLowerCase();
    if ([...w].length < 2 || STOP.has(w) || out.includes(w)) continue;
    out.push(w);
    if (out.length === 12) break;
  }
  return out;
}

/** How many query words (as prefixes of a word) appear in `text`. */
export function matchScore(words: string[], text: string): number {
  const toks = new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u));
  let n = 0;
  for (const w of words) { for (const t of toks) { if (t.startsWith(w)) { n++; break; } } }
  return n;
}

// ── backends ────────────────────────────────────────────────────────────────

interface Backend {
  status(): Promise<MemoryStatus>;
  index(msgs: IndexedMsg[]): Promise<void>;
  forgetSession(id: string): Promise<void>;
  wipeHistory(): Promise<void>;
  search(query: string, exclude: string, limit: number): Promise<SessionHit[]>;
  listMemories(): Promise<MemoryItem[]>;
  putMemories(items: MemoryItem[]): Promise<void>;
  deleteMemory(id: string): Promise<void>;
  searchMemories(query: string, limit: number): Promise<string[]>;
  listSkills(): Promise<Skill[]>;
  putSkill(s: Skill): Promise<string | undefined>;
  deleteSkill(id: string): Promise<void>;
  searchSkills(query: string, limit: number): Promise<string[]>;
}

interface SkillRow { id: string; name: string; description: string; whenToUse: string; body: string; tags: string[]; version: number; uses: number; wins: number; enabled: boolean; origin: string; created: number; updated: number }
interface MemRow { id: string; kind: string; text: string; source: string; uses: number; ts: number; updated: number }

const SKILL_META = 'lotus.skills.meta.v1'; // change history is UI-only metadata, kept beside the DB

const nativeBackend: Backend = {
  status: async () => ({ native: true, ...(await invokeNative<Omit<MemoryStatus, 'native'>>('mem_status'))! }),
  index: async (messages) => { await invokeNative('mem_index', { messages }); },
  forgetSession: async (sessionId) => { await invokeNative('mem_forget_session', { sessionId }); },
  wipeHistory: async () => { await invokeNative('mem_wipe_history'); },
  search: async (query, excludeSession, limit) => (await invokeNative<SessionHit[]>('mem_search', { query, excludeSession, limit })) ?? [],
  listMemories: async () => ((await invokeNative<MemRow[]>('memories_list')) ?? []).map((r) => ({ id: r.id, kind: r.kind === 'instruction' ? 'instruction' : 'memory', text: r.text, source: r.source === 'auto' ? 'auto' : 'user', uses: r.uses, ts: r.ts, updated: r.updated })),
  putMemories: async (items) => { await invokeNative('memories_put', { items: items.map((m) => ({ id: m.id, kind: m.kind, text: m.text, source: m.source ?? 'user', uses: m.uses ?? 0, ts: m.ts, updated: m.updated ?? m.ts })) }); },
  deleteMemory: async (id) => { await invokeNative('memories_delete', { id }); },
  searchMemories: async (query, limit) => (await invokeNative<string[]>('memories_search', { query, limit })) ?? [],
  listSkills: async () => {
    const meta = readMeta();
    return ((await invokeNative<SkillRow[]>('skills_list')) ?? []).map((r) => ({ ...r, origin: r.origin === 'user' ? 'user' : 'auto', history: meta[r.id] }));
  },
  putSkill: async (s) => {
    const { history, ...row } = s;
    writeMeta(s.id, history);
    return invokeNative<string>('skills_put', { skill: row });
  },
  deleteSkill: async (id) => { writeMeta(id, undefined); await invokeNative('skills_delete', { id }); },
  searchSkills: async (query, limit) => (await invokeNative<string[]>('skills_search', { query, limit })) ?? [],
};

function readMeta(): Record<string, Skill['history']> { try { return JSON.parse(localStorage.getItem(SKILL_META) || '{}'); } catch { return {}; } }
function writeMeta(id: string, h: Skill['history'] | undefined) {
  const m = readMeta();
  if (h?.length) m[id] = h.slice(-12); else delete m[id];
  try { localStorage.setItem(SKILL_META, JSON.stringify(m)); } catch { /* quota */ }
}

/** Browser fallback: memories and skills in localStorage, chat index in memory for this tab. */
function webBackend(): Backend {
  const load = <T,>(k: string): T[] => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
  const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota */ } };
  const MEM = 'lotus.memory.v1', SK = 'lotus.skills.v1';
  const idx = new Map<string, IndexedMsg>();
  return {
    status: async () => ({ native: false, fts5: false, path: 'browser storage', messages: idx.size, memories: load(MEM).length, skills: load(SK).length }),
    index: async (msgs) => { msgs.forEach((m) => (m.content.trim() ? idx.set(m.id, m) : idx.delete(m.id))); },
    forgetSession: async (id) => { [...idx.values()].filter((m) => m.sessionId === id).forEach((m) => idx.delete(m.id)); },
    wipeHistory: async () => idx.clear(),
    search: async (query, exclude, limit) => {
      const w = queryWords(query);
      if (!w.length) return [];
      return [...idx.values()].filter((m) => m.sessionId !== exclude)
        .map((m) => ({ m, s: matchScore(w, `${m.title} ${m.content}`) })).filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || b.m.ts - a.m.ts).slice(0, limit)
        .map(({ m, s }) => ({ id: m.id, sessionId: m.sessionId, title: m.title, role: m.role, snippet: m.content.slice(0, 220), ts: m.ts, score: s }));
    },
    listMemories: async () => load<MemoryItem>(MEM),
    putMemories: async (items) => { const cur = load<MemoryItem>(MEM); items.forEach((it) => { const i = cur.findIndex((x) => x.id === it.id); if (i >= 0) cur[i] = it; else cur.push(it); }); save(MEM, cur); },
    deleteMemory: async (id) => save(MEM, load<MemoryItem>(MEM).filter((x) => x.id !== id)),
    searchMemories: async (query, limit) => { const w = queryWords(query); return load<MemoryItem>(MEM).map((m) => ({ id: m.id, s: matchScore(w, m.text) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.id); },
    listSkills: async () => load<Skill>(SK),
    putSkill: async (s) => { const cur = load<Skill>(SK).filter((x) => x.id !== s.id); save(SK, [s, ...cur]); return undefined; },
    deleteSkill: async (id) => save(SK, load<Skill>(SK).filter((x) => x.id !== id)),
    searchSkills: async (query, limit) => { const w = queryWords(query); return load<Skill>(SK).map((s) => ({ id: s.id, s: matchScore(w, `${s.name} ${s.name} ${s.whenToUse} ${s.description}`) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.id); },
  };
}

const be: Backend = isTauri ? nativeBackend : webBackend();

// ── shared state ────────────────────────────────────────────────────────────

interface State { memories: MemoryItem[]; skills: Skill[]; status: MemoryStatus | null; loaded: boolean; error: string | null }
let state: State = { memories: [], skills: [], status: null, loaded: false, error: null };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };

let loading: Promise<void> | null = null;

/** Loads memories and skills once; moves memories saved by older versions (localStorage) into the database. */
export function loadMemory(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    try {
      let memories = await be.listMemories();
      if (isTauri && !memories.length) {
        try {
          const legacy = JSON.parse(localStorage.getItem('lotus.memory.v1') || '[]') as MemoryItem[];
          if (legacy.length) { await be.putMemories(legacy.map((m) => ({ ...m, source: m.source ?? 'user' }))); memories = await be.listMemories(); localStorage.removeItem('lotus.memory.v1'); }
        } catch { /* keep going */ }
      }
      const skills = await be.listSkills();
      const status = await be.status().catch(() => null);
      set({ memories, skills, status, loaded: true, error: null });
    } catch (e) {
      set({ loaded: true, error: `The memory database could not be opened: ${(e as Error).message}` });
    }
  })();
  return loading;
}

const refreshStatus = () => { void be.status().then((status) => set({ status })).catch(() => undefined); };

export const memoryStore = {
  get: () => state,
  subscribe: (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn); }; },

  // memory items
  async putMemories(items: MemoryItem[]) {
    if (!items.length) return;
    const map = new Map(state.memories.map((m) => [m.id, m]));
    items.forEach((m) => map.set(m.id, m));
    set({ memories: [...map.values()].sort((a, b) => a.ts - b.ts) });
    await be.putMemories(items).catch((e) => set({ error: `Could not save memory: ${(e as Error).message}` }));
    refreshStatus();
  },
  async deleteMemory(id: string) {
    set({ memories: state.memories.filter((m) => m.id !== id) });
    await be.deleteMemory(id).catch(() => undefined);
    refreshStatus();
  },
  /** Replace the whole list (inspector edits): deletes what is gone, saves what is new or changed. */
  async setMemories(list: MemoryItem[]) {
    const keep = new Set(list.map((m) => m.id));
    const gone = state.memories.filter((m) => !keep.has(m.id));
    const changed = list.filter((m) => { const o = state.memories.find((x) => x.id === m.id); return !o || o.text !== m.text || o.kind !== m.kind; });
    set({ memories: list });
    await Promise.all(gone.map((m) => be.deleteMemory(m.id).catch(() => undefined)));
    if (changed.length) await be.putMemories(changed).catch(() => undefined);
    refreshStatus();
  },
  searchMemories: (q: string, limit = 8) => be.searchMemories(q, limit).catch(() => [] as string[]),

  // chat history index
  index: (msgs: IndexedMsg[]) => be.index(msgs).then(refreshStatus).catch(() => undefined),
  forgetSession: (id: string) => be.forgetSession(id).then(refreshStatus).catch(() => undefined),
  wipeHistory: () => be.wipeHistory().then(refreshStatus),
  searchSessions: (q: string, exclude: string, limit = 6) => be.search(q, exclude, limit).catch(() => [] as SessionHit[]),

  // skills
  async putSkill(s: Skill): Promise<string | undefined> {
    set({ skills: [s, ...state.skills.filter((x) => x.id !== s.id)] });
    try { const p = await be.putSkill(s); refreshStatus(); return p; }
    catch (e) { set({ error: `Could not save the skill: ${(e as Error).message}` }); return undefined; }
  },
  async deleteSkill(id: string) {
    set({ skills: state.skills.filter((s) => s.id !== id) });
    await be.deleteSkill(id).catch(() => undefined);
    refreshStatus();
  },
  searchSkills: (q: string, limit = 3) => be.searchSkills(q, limit).catch(() => [] as string[]),
  clearError: () => set({ error: null }),
};

export function useMemoryStore(): State {
  return useSyncExternalStore(memoryStore.subscribe, memoryStore.get, memoryStore.get);
}
