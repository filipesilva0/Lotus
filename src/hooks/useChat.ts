import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatFolder, ChatMessage, ChatSession, ChatSource, ChatToolCall, ContextItem, LotusSettings, MemoryItem } from '../types/lotus';
import { ChatTurn, fileToBase64, ollamaClient } from '../services/ollamaService';
import { voicebox } from '../services/voicebox';
import { searchRepo } from '../research/repos';
import { RepoId } from '../research/types';
import { reportActivity } from '../lib/bus';
import { uid, usePersisted } from '../lib/persist';
import { addBranch, switchBranch } from '../chat/branching';
import { contextItemFromText, contextPayload, detectMemory, estimateTokens, newSession, TEXT_EXT } from '../chat/helpers';

const SESSIONS_KEY = 'lotus.sessions.v1';
const ACTIVE_KEY = 'lotus.activeSession.v1';
const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const clean = (list: ChatSession[]): ChatSession[] =>
  list.filter((s) => !s.incognito).map((s) => ({ ...s, messages: strip(s.messages) }));
function strip(ms: ChatMessage[]): ChatMessage[] {
  return ms.map((m) => {
    const { images: _i, ...rest } = m;
    return {
      ...rest, isStreaming: false,
      attachment: m.attachment?.url.startsWith('blob:') ? undefined : m.attachment,
      files: m.files?.map((f) => ({ ...f, url: undefined })),
      branch: m.branch ? { ...m.branch, list: m.branch.list.map(strip) } : undefined,
    };
  });
}

function load(): ChatSession[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]') as ChatSession[];
    const t = Date.now();
    return raw.map((s, i) => ({ ...s, ts: s.ts ?? t - i * 60_000 }));
  } catch { return []; }
}

export interface SendOptions { files?: File[]; modelOverride?: string; forceFiles?: string[] }
export interface RawExchange { request: unknown; response: unknown; at: number }

export function useChat(settings: LotusSettings) {
  const initial = useRef<ChatSession[]>(null as unknown as ChatSession[]);
  if (!initial.current) { const l = load(); initial.current = l.length ? l : [newSession('')]; }
  const ref = useRef<ChatSession[]>(initial.current);
  const [sessions, setSessionsState] = useState<ChatSession[]>(initial.current);
  const [activeId, setActiveId] = useState<string>(() => { try { return JSON.parse(localStorage.getItem(ACTIVE_KEY) || '""'); } catch { return ''; } });
  const [folders, setFolders] = usePersisted<ChatFolder[]>('lotus.folders.v1', []);
  const [memory, setMemory] = usePersisted<MemoryItem[]>('lotus.memory.v1', []);
  const [isStreaming, setIsStreaming] = useState(false);
  const [raw, setRaw] = useState<RawExchange | null>(null);
  const abort = useRef<AbortController | null>(null);
  const run = useRef<Promise<void> | null>(null);
  const memRef = useRef(memory); memRef.current = memory;
  const setRef = useRef(settings); setRef.current = settings;

  const mutate = useCallback((fn: (p: ChatSession[]) => ChatSession[]) => { ref.current = fn(ref.current); setSessionsState(ref.current); }, []);
  const patchSession = useCallback((id: string, fn: (s: ChatSession) => ChatSession) => mutate((p) => p.map((s) => (s.id === id ? fn(s) : s))), [mutate]);
  const patchMsg = useCallback((sid: string, mid: string, patch: Partial<ChatMessage> | ((m: ChatMessage) => Partial<ChatMessage>)) =>
    patchSession(sid, (s) => ({ ...s, messages: s.messages.map((m) => (m.id === mid ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m)) })), [patchSession]);

  const active = sessions.find((s) => s.id === activeId) ?? sessions[0];

  useEffect(() => { if (!isStreaming) { try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(clean(sessions).slice(0, 80))); } catch { /* quota */ } } }, [sessions, isStreaming]);
  useEffect(() => { if (active) localStorage.setItem(ACTIVE_KEY, JSON.stringify(active.id)); }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Generation ───────────────────────────────────────────────────────────
  const generate = useCallback(async (sid: string, aiId: string, o: { model: string; search?: boolean; force?: string[]; query?: string }) => {
    const s = setRef.current;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setIsStreaming(true);
    let acc = '', thinking = '', tStart = 0, tEnd = 0;
    let lastReport = 0;
    let abstractsAll: any[] = [];
    const session0 = ref.current.find((x) => x.id === sid)!;
    const idx = session0.messages.findIndex((m) => m.id === aiId);
    const history = session0.messages.slice(0, idx);

    try {
      if (!o.model) throw new Error('No model selected. Open Models to download one.');
      // 1. Optional source search (the only step that leaves this PC: keywords go to the repositories).
      const sources: ChatSource[] = [];
      if (o.search && o.query) {
        const repos: RepoId[] = ['openalex', 'arxiv', 'pubmed'];
        const tools: ChatToolCall[] = repos.map((r) => ({ id: uid('t'), label: `Searching ${r}`, status: 'running', detail: o.query }));
        patchMsg(sid, aiId, { tools });
        const results = await Promise.all(repos.map(async (r, i) => {
          const res = await searchRepo(r, o.query!, { limit: 3, signal: ctrl.signal });
          tools[i] = { ...tools[i], status: res.error ? 'error' : 'done', detail: res.error ?? `${res.sources.length} found · ${o.query}` };
          patchMsg(sid, aiId, { tools: [...tools] });
          return res.sources;
        }));
        const seen = new Set<string>();
        results.flat().forEach((src) => {
          const key = src.title.toLowerCase();
          if (seen.has(key) || sources.length >= 6) return;
          seen.add(key);
          sources.push({ n: sources.length + 1, title: src.title, url: src.url, repo: src.repo, year: src.year });
        });
        patchMsg(sid, aiId, { sources });
        abstractsAll = results.flat();
      }
      const abstracts = abstractsAll;

      // 2. Build the request.
      const mems = memRef.current.filter((m) => m.kind === 'memory').map((m) => `- ${m.text}`).join('\n');
      const instr = memRef.current.filter((m) => m.kind === 'instruction').map((m) => `- ${m.text}`).join('\n');
      let system = s.systemPrompt;
      if (instr) system += `\n\nStanding instructions from the user:\n${instr}`;
      if (mems) system += `\n\nThings the user asked you to remember:\n${mems}`;
      system += contextPayload(session0.context, o.force);
      if (sources.length) {
        system += `\n\nSources found for this question (cite them inline as [1], [2]… only when you use them):\n` +
          sources.map((x) => `[${x.n}] ${x.title}${x.year ? ` (${x.year})` : ''}: ${(abstracts.find((a) => a.title === x.title)?.abstract ?? '').slice(0, 500)}`).join('\n');
      }
      const turns: ChatTurn[] = [
        { role: 'system', content: system },
        ...history.filter((m) => m.content || m.images?.length).map((m) => ({ role: m.role === 'system' ? 'system' : m.role, content: m.content, images: m.images }) as ChatTurn),
      ];

      // 3. Stream.
      const stream = ollamaClient.streamChat(turns, {
        model: o.model, temperature: s.temperature, topP: s.topP, topK: s.topK, numCtx: s.contextWindow,
        frequencyPenalty: s.frequencyPenalty, presencePenalty: s.presencePenalty,
        stop: s.stopSequences, seed: s.seed ?? undefined, numPredict: s.maxTokens > 0 ? s.maxTokens : undefined,
        signal: ctrl.signal,
        onRequest: (body) => setRaw({ request: body, response: null, at: Date.now() }),
        onThinking: (t) => {
          if (!tStart) tStart = performance.now();
          thinking += t; tEnd = performance.now();
          patchMsg(sid, aiId, { thinking, thinkingMs: Math.round(tEnd - tStart) });
        },
        onFinal: (chunk) => {
          const { message: _m, context: _c, ...meta } = chunk;
          setRaw((r) => ({ request: r?.request ?? null, response: { ...meta, message: { role: 'assistant', content: acc.length > 600 ? `${acc.slice(0, 600)}… (${acc.length} chars)` : acc } }, at: Date.now() }));
          const used = (chunk.prompt_eval_count ?? 0) + (chunk.eval_count ?? 0);
          if (used) patchSession(sid, (x) => ({ ...x, usedTokens: used }));
        },
      }, (st) => {
        patchMsg(sid, aiId, { tokensPerSec: st.tokensPerSec, durationMs: st.durationMs });
        if (Date.now() - lastReport > 1000) { lastReport = Date.now(); reportActivity({ id: 'main-chat', kind: 'chat', label: `${st.tokensPerSec} tok/s` }); }
      });
      for await (const token of stream) { acc += token; patchMsg(sid, aiId, { content: acc }); }
    } catch (e) {
      if (!ctrl.signal.aborted) {
        const msg = (e as Error).message;
        patchMsg(sid, aiId, { content: acc ? `${acc}\n\n_(${msg})_` : `Couldn't get a reply. ${msg}` });
      }
    } finally {
      const was = ctrl.signal.aborted;
      patchMsg(sid, aiId, { isStreaming: false, interrupted: was || undefined });
      if (abort.current === ctrl) { abort.current = null; setIsStreaming(false); }
      reportActivity({ id: 'main-chat', kind: 'chat', label: 'Done', done: true });
    }

    if (setRef.current.autoReadResponses && acc && !ctrl.signal.aborted) {
      try {
        const q = await voicebox.speak(acc.replace(/```[\s\S]*?```/g, ' ').slice(0, 4000), { profile: localStorage.getItem('lotus.voice.profile') ?? undefined });
        const done = await voicebox.waitFor(q.id);
        await new Audio(await voicebox.audioUrl(done.id)).play();
      } catch { /* read-aloud is best effort */ }
    }
  }, [patchMsg, patchSession]);

  const start = useCallback((sid: string, aiId: string, o: Parameters<typeof generate>[2]) => {
    const p = generate(sid, aiId, o);
    run.current = p;
    return p;
  }, [generate]);

  const stop = useCallback(() => abort.current?.abort(), []);

  /** Reads attachments: images → vision payload; text/code → mounted context files. */
  const readFiles = async (files: File[]) => {
    const images: string[] = [], refs: ChatMessage['files'] = [], ctx: ContextItem[] = [], errors: string[] = [];
    for (const f of files) {
      if (f.type.startsWith('image/')) { images.push(await fileToBase64(f)); refs.push({ name: f.name, kind: 'image', url: URL.createObjectURL(f) }); }
      else if (f.type.startsWith('text/') || TEXT_EXT.test(f.name) || f.type === 'application/json') {
        ctx.push(contextItemFromText(f.name, await f.text())); refs.push({ name: f.name, kind: 'text' });
      } else errors.push(`${f.name}: Lotus can read images and text or code files. PDFs and other formats can't be read yet.`);
    }
    return { images, refs, ctx, errors };
  };

  const send = useCallback(async (text: string, o: SendOptions = {}): Promise<string[]> => {
    const sid = (ref.current.find((s) => s.id === activeId) ?? ref.current[0]).id;
    // Steer: interrupt the running reply, keep what it said so far, and continue from the new instruction.
    if (abort.current) { abort.current.abort(); await run.current?.catch(() => undefined); }
    const s = ref.current.find((x) => x.id === sid)!;
    const { images, refs, ctx, errors } = await readFiles(o.files ?? []);
    if (!text.trim() && !images.length && !ctx.length) return errors;
    const stamp = Date.now();
    const model = o.modelOverride || setRef.current.selectedModel;
    const user: ChatMessage = { id: `user-${stamp}`, role: 'user', content: text, timestamp: now(), images: images.length ? images : undefined, files: refs.length ? refs : undefined };
    const ai: ChatMessage = { id: `assistant-${stamp}`, role: 'assistant', content: '', timestamp: now(), isStreaming: true };

    // Explicit memory / standing-instruction requests (never in incognito).
    const hit = s.incognito ? null : detectMemory(text);
    if (hit) {
      const item: MemoryItem = { id: uid('mem'), text: hit.text, kind: hit.kind, ts: stamp };
      setMemory((m) => [...m, item]);
      memRef.current = [...memRef.current, item];
      ai.memoryEvent = { kind: hit.kind, text: hit.text, itemId: item.id, status: 'saved' };
    }
    patchSession(sid, (x) => ({
      ...x, updatedAt: 'Just now', ts: stamp, model,
      title: x.messages.length === 0 || x.title === 'New conversation' ? (text.slice(0, 40) || refs[0]?.name || 'New conversation') : x.title,
      context: [...(x.context ?? []), ...ctx],
      messages: [...x.messages, user, ai],
    }));
    void start(sid, ai.id, { model, search: s.searchSources, force: o.forceFiles, query: text.replace(/\s+/g, ' ').slice(0, 200) });
    return errors;
  }, [activeId, patchSession, setMemory, start]);

  const regenerate = useCallback(async (msgId: string) => {
    const s = ref.current.find((x) => x.id === activeId) ?? ref.current[0];
    const j = s.messages.findIndex((m) => m.id === msgId);
    if (j < 1 || s.messages[j].role !== 'assistant') return;
    if (abort.current) { abort.current.abort(); await run.current?.catch(() => undefined); }
    const user = ref.current.find((x) => x.id === s.id)!.messages[j - 1];
    const ai: ChatMessage = { id: `assistant-${Date.now()}`, role: 'assistant', content: '', timestamp: now(), isStreaming: true };
    patchSession(s.id, (x) => ({ ...x, messages: addBranch(x.messages, j - 1, [user, ai]) }));
    void start(s.id, ai.id, { model: setRef.current.selectedModel, search: s.searchSources, query: user.content.slice(0, 200) });
  }, [activeId, patchSession, start]);

  const editMessage = useCallback(async (msgId: string, text: string) => {
    const s = ref.current.find((x) => x.id === activeId) ?? ref.current[0];
    const i = s.messages.findIndex((m) => m.id === msgId);
    if (i < 0 || s.messages[i].role !== 'user') return;
    if (abort.current) { abort.current.abort(); await run.current?.catch(() => undefined); }
    const old = ref.current.find((x) => x.id === s.id)!.messages[i];
    const user: ChatMessage = { ...old, id: `user-${Date.now()}`, content: text, branch: undefined };
    const ai: ChatMessage = { id: `assistant-${Date.now()}`, role: 'assistant', content: '', timestamp: now(), isStreaming: true };
    patchSession(s.id, (x) => ({ ...x, messages: addBranch(x.messages, i, [user, ai]) }));
    void start(s.id, ai.id, { model: setRef.current.selectedModel, search: s.searchSources, query: text.slice(0, 200) });
  }, [activeId, patchSession, start]);

  const switchTo = useCallback((msgId: string, dir: -1 | 1) => {
    if (abort.current) abort.current.abort();
    patchSession(activeId, (x) => { const i = x.messages.findIndex((m) => m.id === msgId); return i < 0 ? x : { ...x, messages: switchBranch(x.messages, i, dir) }; });
  }, [activeId, patchSession]);

  const rateMemory = useCallback((msgId: string, verdict: 'confirmed' | 'forgotten') => {
    const m = ref.current.flatMap((s) => s.messages).find((x) => x.id === msgId);
    if (!m?.memoryEvent) return;
    if (verdict === 'forgotten') setMemory((list) => list.filter((x) => x.id !== m.memoryEvent!.itemId));
    patchMsg(activeId, msgId, { memoryEvent: { ...m.memoryEvent, status: verdict } });
  }, [activeId, patchMsg, setMemory]);

  // ── Threads, folders, context ────────────────────────────────────────────
  const newChat = useCallback((extra: Partial<ChatSession> = {}) => {
    const s = newSession(setRef.current.selectedModel, extra);
    mutate((p) => [s, ...p]); setActiveId(s.id); return s;
  }, [mutate]);

  const deleteChat = useCallback((id: string) => {
    const rest = ref.current.filter((s) => s.id !== id);
    if (!rest.length) { const s = newSession(setRef.current.selectedModel); mutate(() => [s]); setActiveId(s.id); return; }
    mutate(() => rest);
    if (activeId === id) setActiveId(rest[0].id);
  }, [activeId, mutate]);

  const clearChat = useCallback(() => { stop(); patchSession(activeId, (s) => ({ ...s, messages: [], title: 'New conversation', usedTokens: 0 })); }, [activeId, patchSession, stop]);

  const importMessages = useCallback((msgs: { role: 'user' | 'assistant'; content: string }[]) => {
    const s = newSession(setRef.current.selectedModel, {
      title: (msgs.find((m) => m.role === 'user')?.content ?? 'From the island').slice(0, 40),
      messages: msgs.map((m, i) => ({ id: `imp-${Date.now()}-${i}`, role: m.role, content: m.content, timestamp: now() })),
    });
    mutate((p) => [s, ...p]); setActiveId(s.id);
  }, [mutate]);

  const addContext = useCallback((item: ContextItem) => patchSession(activeId, (s) => ({ ...s, context: [...(s.context ?? []), item] })), [activeId, patchSession]);
  const patchContext = useCallback((fn: (c: ContextItem[]) => ContextItem[]) => patchSession(activeId, (s) => ({ ...s, context: fn(s.context ?? []) })), [activeId, patchSession]);

  return {
    sessions, active, activeId: active?.id ?? '', setActiveId, folders, setFolders, memory, setMemory, isStreaming, raw,
    send, stop, regenerate, editMessage, switchTo, rateMemory, newChat, deleteChat, clearChat, importMessages,
    patchSession, addContext, patchContext, estimateTokens,
  };
}
