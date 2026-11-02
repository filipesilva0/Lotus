import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatFolder, ChatMessage, ChatSession, ChatSource, ChatToolCall, ContextItem, LotusSettings, MemoryItem } from '../types/lotus';
import { ChatTurn, fileToBase64 } from '../services/ollamaService';
import { llm } from '../services/llm';
import { voicebox } from '../services/voicebox';
import { searchRepo } from '../research/repos';
import { RepoId } from '../research/types';
import { reportActivity } from '../lib/bus';
import { uid, usePersisted } from '../lib/persist';
import { addBranch, switchBranch } from '../chat/branching';
import { contextItemFromText, contextPayload, detectMemory, estimateTokens, newSession, TEXT_EXT } from '../chat/helpers';
import { queryFromMessage, readPage, searchWeb, webContextBlock, WebResult } from '../chat/webSearch';
import { STAGES, thinkingStream } from '../chat/thinking';
import { effectiveNumCtx, hardware, modelCapabilities } from '../hardware/monitor';
import { agentPool } from '../agents/pool';
import { loadMemory, memoryStore, useMemoryStore } from '../memory/store';
import { buildRecall } from '../memory/recall';
import { feedbackEffect, feedbackNote, type Feedback } from '../chat/feedback';
import { considerSkill, correction, isComplexExchange, positiveFeedback, recordUse, recordWin, reflect, refineSkill, shouldReflect } from '../memory/learn';
import type { ContextFile } from '../context/discover';
import { CHOICES_INSTRUCTIONS } from '../chat/choices';
import { installInstructions, type InstallTarget } from '../chat/install';
import { installTarget } from '../setup/jobs';
import { shouldRename, suggestTitle } from '../chat/rename';
import { pluginSystemBlock } from '../plugins/store';

const SESSIONS_KEY = 'lotus.sessions.v1';
const ACTIVE_KEY = 'lotus.activeSession.v1';
const BACKFILL_KEY = 'lotus.memory.backfilled.v1';
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

/** Memory is on unless the chat is incognito or the user switched it off with the header toggle. */
export const memoryOnFor = (s: Pick<ChatSession, 'incognito' | 'memoryOff'>) => !s.incognito && !s.memoryOff;

const indexable = (s: ChatSession, ms: ChatMessage[]) =>
  ms.filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim() && !m.isStreaming)
    .map((m) => ({ id: m.id, sessionId: s.id, title: s.title, role: m.role, content: m.content, ts: s.ts }));

export interface SendOptions { files?: File[]; modelOverride?: string; forceFiles?: string[] }
export interface RawExchange { request: unknown; response: unknown; at: number }

interface GenOpts { model: string; search?: boolean; web?: boolean; thinking?: boolean; force?: string[]; query?: string }

export function useChat(settings: LotusSettings) {
  const initial = useRef<ChatSession[]>(null as unknown as ChatSession[]);
  if (!initial.current) { const l = load(); initial.current = l.length ? l : [newSession('')]; }
  const ref = useRef<ChatSession[]>(initial.current);
  const [sessions, setSessionsState] = useState<ChatSession[]>(initial.current);
  const [activeId, setActiveId] = useState<string>(() => { try { return JSON.parse(localStorage.getItem(ACTIVE_KEY) || '""'); } catch { return ''; } });
  const [folders, setFolders] = usePersisted<ChatFolder[]>('lotus.folders.v1', []);
  const { memories: memory } = useMemoryStore();
  const [isStreaming, setIsStreaming] = useState(false);
  const [raw, setRaw] = useState<RawExchange | null>(null);
  const abort = useRef<AbortController | null>(null);
  const run = useRef<Promise<void> | null>(null);
  const setRef = useRef(settings); setRef.current = settings;
  /** Context files of the active chat's workspace folder (set by ChatWorkspace). */
  const projectRef = useRef<{ sid: string; files: ContextFile[] }>({ sid: '', files: [] });

  const mutate = useCallback((fn: (p: ChatSession[]) => ChatSession[]) => { ref.current = fn(ref.current); setSessionsState(ref.current); }, []);
  const patchSession = useCallback((id: string, fn: (s: ChatSession) => ChatSession) => mutate((p) => p.map((s) => (s.id === id ? fn(s) : s))), [mutate]);
  const patchMsg = useCallback((sid: string, mid: string, patch: Partial<ChatMessage> | ((m: ChatMessage) => Partial<ChatMessage>)) =>
    patchSession(sid, (s) => ({ ...s, messages: s.messages.map((m) => (m.id === mid ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m)) })), [patchSession]);

  const active = sessions.find((s) => s.id === activeId) ?? sessions[0];

  useEffect(() => { if (!isStreaming) { try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(clean(sessions).slice(0, 80))); } catch { /* quota */ } } }, [sessions, isStreaming]);
  useEffect(() => { if (active) localStorage.setItem(ACTIVE_KEY, JSON.stringify(active.id)); }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Long-term memory: load it, and index chats saved before memory search existed (once).
  useEffect(() => {
    void loadMemory().then(() => {
      if (localStorage.getItem(BACKFILL_KEY)) return;
      const msgs = ref.current.filter(memoryOnFor).flatMap((s) => indexable(s, s.messages));
      void memoryStore.index(msgs).then(() => localStorage.setItem(BACKFILL_KEY, '1'));
    });
  }, []);

  /** After a reply: index it for recall and start learning jobs (memory on only). */
  const afterReply = useCallback((sid: string, aiId: string, o: GenOpts, usedSkillIds: string[]) => {
    const s = ref.current.find((x) => x.id === sid);
    if (!s || !memoryOnFor(s)) return;
    const st = setRef.current;
    const i = s.messages.findIndex((m) => m.id === aiId);
    const ai = s.messages[i];
    if (!ai?.content || ai.interrupted) return;
    void memoryStore.index(indexable(s, s.messages.slice(Math.max(0, i - 1), i + 1)));
    const turns = s.messages.slice(0, i + 1).map((m) => ({ role: m.role, content: m.content }));
    const userTurns = turns.filter((t) => t.role === 'user').length;
    const lastUser = s.messages[i - 1]?.content ?? '';
    if (usedSkillIds.length) void recordUse(memoryStore.get().skills.filter((k) => usedSkillIds.includes(k.id)));
    if (st.autoMemory && shouldReflect(userTurns, lastUser)) void reflect(turns).catch(() => undefined);
    if (st.autoSkills && !usedSkillIds.length && isComplexExchange(turns, { thinking: o.thinking })) void considerSkill(turns).catch(() => undefined);
  }, []);

  /** After the first reply: let the background tasks model name the chat (only if Lotus chose the title). */
  const autoRename = useCallback((sid: string) => {
    const s = ref.current.find((x) => x.id === sid);
    if (!s || !setRef.current.autoRename || !shouldRename(s)) return;
    const was = s.title;
    void suggestTitle(s).then((title) => {
      if (!title) return;
      // The user may have renamed it meanwhile: only replace the title Lotus set.
      patchSession(sid, (x) => (x.title === was && x.autoTitle === was ? { ...x, title, autoTitle: title } : x));
    }).catch(() => undefined);
  }, [patchSession]);

  // ── Generation ───────────────────────────────────────────────────────────
  const generate = useCallback(async (sid: string, aiId: string, o: GenOpts) => {
    const s = setRef.current;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setIsStreaming(true);
    agentPool.setForegroundBusy(true);
    let acc = '', thinking = '', tStart = 0, tEnd = 0;
    let lastReport = 0;
    let usedSkillIds: string[] = [];
    const session0 = ref.current.find((x) => x.id === sid)!;
    const idx = session0.messages.findIndex((m) => m.id === aiId);
    const history = session0.messages.slice(0, idx);
    const memOn = memoryOnFor(session0);
    const numCtx = effectiveNumCtx();
    const plan = hardware.get().plan;
    const budget = Math.max(4000, plan.contextBudgetTokens * 4);
    const tools: ChatToolCall[] = [];
    const tool = (label: string, detail?: string) => { const t: ChatToolCall = { id: uid('t'), label, status: 'running', detail }; tools.push(t); patchMsg(sid, aiId, { tools: [...tools] }); return t.id; };
    const toolDone = (id: string, status: 'done' | 'error', detail?: string) => { const k = tools.findIndex((t) => t.id === id); if (k >= 0) { tools[k] = { ...tools[k], status, detail: detail ?? tools[k].detail }; patchMsg(sid, aiId, { tools: [...tools] }); } };

    try {
      if (!o.model) throw new Error('No model selected. Open Models to download one.');
      const sources: ChatSource[] = [];
      let sourceText = '';

      // 1a. Optional academic source search (keywords go to the repositories).
      if (o.search && o.query) {
        const repos: RepoId[] = ['openalex', 'arxiv', 'pubmed'];
        const ids = repos.map((r) => tool(`Searching ${r}`, o.query));
        const results = await Promise.all(repos.map(async (r, i) => {
          const res = await searchRepo(r, o.query!, { limit: 3, signal: ctrl.signal });
          toolDone(ids[i], res.error ? 'error' : 'done', res.error ?? `${res.sources.length} found · ${o.query}`);
          return res.sources;
        }));
        const seen = new Set<string>();
        results.flat().forEach((src) => {
          const key = src.title.toLowerCase();
          if (seen.has(key) || sources.length >= 6) return;
          seen.add(key);
          sources.push({ n: sources.length + 1, title: src.title, url: src.url, repo: src.repo, year: src.year });
          sourceText += `[${sources.length}] ${src.title}${src.year ? ` (${src.year})` : ''}: ${(src.abstract ?? '').slice(0, 500)}\n`;
        });
      }

      // 1b. Optional web search: search, then open and read the top pages.
      if (o.web && o.query) {
        const q = queryFromMessage(o.query) || o.query;
        const sid1 = tool('Searching the web', q);
        let results: WebResult[] = [];
        try {
          results = (await searchWeb(q, { provider: s.webSearchProvider, searxngUrl: s.searxngUrl, limit: 6, signal: ctrl.signal })).slice(0, 6);
          toolDone(sid1, 'done', `${results.length} results · ${s.webSearchProvider === 'searxng' ? 'SearXNG' : 'DuckDuckGo'}`);
        } catch (e) {
          if (ctrl.signal.aborted) throw e;
          toolDone(sid1, 'error', (e as Error).message);
        }
        if (results.length) {
          const toRead = results.slice(0, Math.max(0, Math.min(5, s.webPagesToRead)));
          const pages = await Promise.all(toRead.map(async (r) => {
            const id = tool('Reading', r.url.replace(/^https?:\/\//, '').slice(0, 60));
            const p = await readPage(r.url, ctrl.signal);
            toolDone(id, p.error ? 'error' : 'done', p.error ?? `${p.title || r.title} · ${p.text.length.toLocaleString()} characters`);
            return p;
          }));
          const first = sources.length;
          results.forEach((r) => sources.push({ n: sources.length + 1, title: r.title, url: r.url, repo: 'web' }));
          sourceText += webContextBlock(results, pages, Math.floor(budget * 0.4)).replace(/^\[(\d+)\]/gm, (_m, n) => `[${Number(n) + first}]`);
        }
      }
      if (sources.length) patchMsg(sid, aiId, { sources });

      // 2. Build the request: system prompt, today's date, memory recall, project files, mounted files, sources.
      const proj = projectRef.current.sid === sid ? projectRef.current.files : [];
      const recall = await buildRecall({
        query: o.query ?? '', sessionId: sid, memoryOn: memOn, sessionRecall: s.sessionRecall,
        projectFiles: proj, projectOff: session0.folderOff, budgetChars: Math.floor(budget * 0.5),
      });
      usedSkillIds = recall.usedSkills.map((k) => k.id);
      let system = `${s.systemPrompt}\n\nToday's date is ${new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}. Format replies with GitHub Flavored Markdown when it helps (tables, task lists, code blocks).`;
      system += CHOICES_INSTRUCTIONS;
      system += installInstructions();
      system += pluginSystemBlock(o.query ?? '');
      system += recall.system;
      system += contextPayload(session0.context, o.force, Math.max(2000, budget - system.length - sourceText.length));
      if (sourceText) {
        system += `\n\nSources found for this question${o.web ? ' (web results are current as of today; prefer them over your training data for recent facts)' : ''}. Cite them inline as [1], [2]… only when you use them:\n${sourceText}`;
      }
      const ri = recall.info;
      if (ri.memories || ri.sessions || ri.skills.length || ri.projectFiles) patchMsg(sid, aiId, { recall: { ...ri, skillIds: usedSkillIds } });
      patchMsg(sid, aiId, { mode: o.thinking || o.web ? { thinking: o.thinking || undefined, web: o.web || undefined } : undefined });

      const turns: ChatTurn[] = [
        { role: 'system', content: system },
        ...history.filter((m) => m.content || m.images?.length).map((m) => ({ role: m.role === 'system' ? 'system' : m.role, content: m.content, images: m.images }) as ChatTurn),
      ];

      // 3. Stream (Thinking mode runs its passes first).
      const nativeThinking = s.llmBackend === 'ollama' && (await modelCapabilities(o.model)).includes('thinking');
      const opts = {
        model: o.model, temperature: s.temperature, topP: s.topP, topK: s.topK, numCtx,
        frequencyPenalty: s.frequencyPenalty, presencePenalty: s.presencePenalty,
        stop: s.stopSequences, seed: s.seed ?? undefined, numPredict: s.maxTokens > 0 ? s.maxTokens : undefined,
        signal: ctrl.signal,
        onRequest: (body: unknown) => setRaw({ request: body, response: null, at: Date.now() }),
        onThinking: (t: string) => {
          if (!tStart) tStart = performance.now();
          thinking += t; tEnd = performance.now();
          patchMsg(sid, aiId, { thinking, thinkingMs: Math.round(tEnd - tStart) });
        },
        onFinal: (chunk: any) => {
          const { message: _m, context: _c, ...meta } = chunk;
          setRaw((r) => ({ request: r?.request ?? null, response: { ...meta, message: { role: 'assistant', content: acc.length > 600 ? `${acc.slice(0, 600)}… (${acc.length} chars)` : acc } }, at: Date.now() }));
          const used = (chunk.prompt_eval_count ?? 0) + (chunk.eval_count ?? 0);
          if (used) patchSession(sid, (x) => ({ ...x, usedTokens: used }));
        },
      };
      const onStats = (st: { tokensPerSec: number; durationMs: number }) => {
        patchMsg(sid, aiId, { tokensPerSec: st.tokensPerSec, durationMs: st.durationMs });
        if (Date.now() - lastReport > 1000) { lastReport = Date.now(); reportActivity({ id: 'main-chat', kind: 'chat', label: `${st.tokensPerSec} tok/s` }); }
      };
      const t0 = performance.now();
      const stream = o.thinking
        ? thinkingStream(turns, { ...opts, nativeThinking }, {
          onStage: (id, status, detail) => {
            const label = STAGES.find((x) => x.id === id)!.label;
            const k = tools.findIndex((t) => t.label === label);
            if (k < 0) tool(label, detail); else toolDone(tools[k].id, status === 'running' ? 'done' : status, detail);
            reportActivity({ id: 'main-chat', kind: 'chat', label });
          },
          onThinking: (text) => { thinking = text; patchMsg(sid, aiId, { thinking, thinkingMs: Math.round(performance.now() - t0) }); },
        }, onStats)
        : llm.streamChat(turns, opts, onStats);
      for await (const token of stream) { acc += token; patchMsg(sid, aiId, { content: acc }); }
    } catch (e) {
      if (!ctrl.signal.aborted) {
        const msg = (e as Error).message;
        tools.filter((t) => t.status === 'running').forEach((t) => toolDone(t.id, 'error'));
        patchMsg(sid, aiId, { content: acc ? `${acc}\n\n_(${msg})_` : `Couldn't get a reply. ${msg}` });
      }
    } finally {
      const was = ctrl.signal.aborted;
      patchMsg(sid, aiId, { isStreaming: false, interrupted: was || undefined });
      if (abort.current === ctrl) { abort.current = null; setIsStreaming(false); agentPool.setForegroundBusy(false); }
      reportActivity({ id: 'main-chat', kind: 'chat', label: 'Done', done: true });
    }

    if (!ctrl.signal.aborted && acc) afterReply(sid, aiId, o, usedSkillIds);
    if (!ctrl.signal.aborted && acc) autoRename(sid);

    if (setRef.current.autoReadResponses && acc && !ctrl.signal.aborted) {
      try {
        const q = await voicebox.speak(acc.replace(/```[\s\S]*?```/g, ' ').slice(0, 4000), { profile: localStorage.getItem('lotus.voice.profile') ?? undefined });
        const done = await voicebox.waitFor(q.id);
        await new Audio(await voicebox.audioUrl(done.id)).play();
      } catch { /* read-aloud is best effort */ }
    }
  }, [patchMsg, patchSession, afterReply, autoRename]);

  const start = useCallback((sid: string, aiId: string, o: GenOpts) => {
    const p = generate(sid, aiId, o);
    run.current = p;
    return p;
  }, [generate]);

  const stop = useCallback(() => abort.current?.abort(), []);

  const genOpts = (s: ChatSession, model: string, text: string, force?: string[]): GenOpts =>
    ({ model, search: s.searchSources, web: s.webSearch, thinking: s.thinking, force, query: text.replace(/\s+/g, ' ').slice(0, 400) });

  /** Reads attachments: images → vision payload; text/code → mounted context files. */
  const readFiles = async (files: File[]) => {
    const images: string[] = [], refs: ChatMessage['files'] = [], ctx: ContextItem[] = [], errors: string[] = [];
    const chunk = hardware.get().plan.chunkChars;
    for (const f of files) {
      if (f.type.startsWith('image/')) { images.push(await fileToBase64(f)); refs.push({ name: f.name, kind: 'image', url: URL.createObjectURL(f) }); }
      else if (f.type.startsWith('text/') || TEXT_EXT.test(f.name) || f.type === 'application/json') {
        ctx.push(contextItemFromText(f.name, await f.text(), chunk)); refs.push({ name: f.name, kind: 'text' });
      } else errors.push(`${f.name}: Lotus can read images and text or code files. PDFs and other formats can't be read yet.`);
    }
    return { images, refs, ctx, errors };
  };

  /** Feedback on a reply that used skills: a correction rewrites the skill, thanks counts a win. */
  const skillFeedback = (s: ChatSession, text: string) => {
    if (!memoryOnFor(s) || !setRef.current.autoSkills) return;
    const prev = [...s.messages].reverse().find((m) => m.role === 'assistant');
    const ids = prev?.recall?.skillIds ?? [];
    if (!ids.length) return;
    if (correction(text)) {
      const turns = [...s.messages.map((m) => ({ role: m.role, content: m.content })), { role: 'user' as const, content: text }];
      memoryStore.get().skills.filter((k) => ids.includes(k.id)).slice(0, 1).forEach((k) => void refineSkill(k, turns).catch(() => undefined));
    } else if (positiveFeedback(text)) void recordWin(ids);
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

    skillFeedback(s, text);
    // Explicit memory / standing-instruction requests (only while memory is on, never in incognito).
    const hit = memoryOnFor(s) ? detectMemory(text) : null;
    if (hit) {
      const item: MemoryItem = { id: uid('mem'), text: hit.text, kind: hit.kind, ts: stamp, updated: stamp, source: 'user', uses: 0 };
      void memoryStore.putMemories([item]);
      ai.memoryEvent = { kind: hit.kind, text: hit.text, itemId: item.id, status: 'saved' };
    }
    patchSession(sid, (x) => ({
      ...x, updatedAt: 'Just now', ts: stamp, model,
      ...(x.messages.length === 0 || x.title === 'New conversation'
        ? (() => { const t = text.replace(/\s+/g, ' ').trim().slice(0, 40) || refs[0]?.name || 'New conversation'; return { title: t, autoTitle: t }; })()
        : {}),
      context: [...(x.context ?? []), ...ctx],
      messages: [...x.messages, user, ai],
    }));
    void start(sid, ai.id, genOpts(s, model, text, o.forceFiles));
    return errors;
  }, [activeId, patchSession, start]); // eslint-disable-line react-hooks/exhaustive-deps

  const regenerate = useCallback(async (msgId: string) => {
    const s = ref.current.find((x) => x.id === activeId) ?? ref.current[0];
    const j = s.messages.findIndex((m) => m.id === msgId);
    if (j < 1 || s.messages[j].role !== 'assistant') return;
    if (abort.current) { abort.current.abort(); await run.current?.catch(() => undefined); }
    const user = ref.current.find((x) => x.id === s.id)!.messages[j - 1];
    const ai: ChatMessage = { id: `assistant-${Date.now()}`, role: 'assistant', content: '', timestamp: now(), isStreaming: true };
    patchSession(s.id, (x) => ({ ...x, messages: addBranch(x.messages, j - 1, [user, ai]) }));
    void start(s.id, ai.id, genOpts(s, setRef.current.selectedModel, user.content));
  }, [activeId, patchSession, start]); // eslint-disable-line react-hooks/exhaustive-deps

  const editMessage = useCallback(async (msgId: string, text: string) => {
    const s = ref.current.find((x) => x.id === activeId) ?? ref.current[0];
    const i = s.messages.findIndex((m) => m.id === msgId);
    if (i < 0 || s.messages[i].role !== 'user') return;
    if (abort.current) { abort.current.abort(); await run.current?.catch(() => undefined); }
    const old = ref.current.find((x) => x.id === s.id)!.messages[i];
    const user: ChatMessage = { ...old, id: `user-${Date.now()}`, content: text, branch: undefined };
    const ai: ChatMessage = { id: `assistant-${Date.now()}`, role: 'assistant', content: '', timestamp: now(), isStreaming: true };
    patchSession(s.id, (x) => ({ ...x, messages: addBranch(x.messages, i, [user, ai]) }));
    void start(s.id, ai.id, genOpts(s, setRef.current.selectedModel, text));
  }, [activeId, patchSession, start]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The user clicked an option on a reply's choices card: record it and send it as their message. */
  const answerPoll = useCallback((msgId: string, text: string) => {
    if (!text.trim()) return Promise.resolve([] as string[]);
    patchMsg(activeId, msgId, { pollAnswer: text });
    return send(text);
  }, [activeId, patchMsg, send]);

  /** Allow or Deny on an install the model proposed. Nothing is downloaded unless the user allows it. */
  const decideInstall = useCallback(async (msgId: string, target: InstallTarget, allow: boolean) => {
    const sid = ref.current.find((x) => x.messages.some((m) => m.id === msgId))?.id ?? activeId;
    if (!allow) { patchMsg(sid, msgId, { install: { status: 'denied' } }); return; }
    patchMsg(sid, msgId, { install: { status: 'allowed' } });
    try { await installTarget(target); }
    catch (e) { patchMsg(sid, msgId, { install: { status: 'failed', error: (e as Error).message } }); }
  }, [activeId, patchMsg]);

  const switchTo = useCallback((msgId: string, dir: -1 | 1) => {
    if (abort.current) abort.current.abort();
    patchSession(activeId, (x) => { const i = x.messages.findIndex((m) => m.id === msgId); return i < 0 ? x : { ...x, messages: switchBranch(x.messages, i, dir) }; });
  }, [activeId, patchSession]);

  const rateMemory = useCallback((msgId: string, verdict: 'confirmed' | 'forgotten') => {
    const m = ref.current.flatMap((s) => s.messages).find((x) => x.id === msgId);
    if (!m?.memoryEvent) return;
    if (verdict === 'forgotten') void memoryStore.deleteMemory(m.memoryEvent.itemId);
    patchMsg(activeId, msgId, { memoryEvent: { ...m.memoryEvent, status: verdict } });
  }, [activeId, patchMsg]);

  /** Thumbs up / down on a reply (see chat/feedback.ts). Clicking the chosen thumb again clears it. */
  const rateReply = useCallback((msgId: string, v: Feedback) => {
    const s = ref.current.find((x) => x.messages.some((m) => m.id === msgId));
    const i = s ? s.messages.findIndex((m) => m.id === msgId) : -1;
    if (!s || i < 0) return;
    const m = s.messages[i];
    const next = m.feedback === v ? null : v;
    const ids = m.recall?.skillIds ?? [];
    const effect = feedbackEffect(m.feedback, next, ids.length > 0, memoryOnFor(s) && setRef.current.autoSkills);
    patchMsg(s.id, msgId, { feedback: next ?? undefined, feedbackNote: feedbackNote(next, effect) ?? undefined });
    if (effect === 'win') void recordWin(ids);
    if (effect === 'refine') {
      const turns = [...s.messages.slice(0, i + 1).map((x) => ({ role: x.role, content: x.content })), { role: 'user' as const, content: 'That answer was not helpful.' }];
      memoryStore.get().skills.filter((k) => ids.includes(k.id)).slice(0, 1).forEach((k) => void refineSkill(k, turns).catch(() => undefined));
    }
  }, [patchMsg]);

  const setMemory = useCallback((list: MemoryItem[] | ((p: MemoryItem[]) => MemoryItem[])) => {
    const next = typeof list === 'function' ? list(memoryStore.get().memories) : list;
    void memoryStore.setMemories(next);
  }, []);

  /** The memory toggle: suspends or resumes recall and learning for this chat, effective immediately. */
  const toggleMemory = useCallback((id: string) => {
    patchSession(id, (s) => ({ ...s, memoryOff: !s.memoryOff }));
    const s = ref.current.find((x) => x.id === id);
    // Resuming: make this chat's messages searchable now (they were not indexed while memory was off).
    if (s && memoryOnFor(s)) void memoryStore.index(indexable(s, s.messages));
  }, [patchSession]);

  // ── Threads, folders, context ────────────────────────────────────────────
  const newChat = useCallback((extra: Partial<ChatSession> = {}) => {
    const s = newSession(setRef.current.selectedModel, extra);
    mutate((p) => [s, ...p]); setActiveId(s.id); return s;
  }, [mutate]);

  const deleteChat = useCallback((id: string) => {
    void memoryStore.forgetSession(id);
    const rest = ref.current.filter((s) => s.id !== id);
    if (!rest.length) { const s = newSession(setRef.current.selectedModel); mutate(() => [s]); setActiveId(s.id); return; }
    mutate(() => rest);
    if (activeId === id) setActiveId(rest[0].id);
  }, [activeId, mutate]);

  const clearChat = useCallback(() => { stop(); void memoryStore.forgetSession(activeId); patchSession(activeId, (s) => ({ ...s, messages: [], title: 'New conversation', autoTitle: undefined, usedTokens: 0 })); }, [activeId, patchSession, stop]);

  const importMessages = useCallback((msgs: { role: 'user' | 'assistant'; content: string }[]) => {
    const s = newSession(setRef.current.selectedModel, {
      title: (msgs.find((m) => m.role === 'user')?.content ?? 'From the island').slice(0, 40),
      messages: msgs.map((m, i) => ({ id: `imp-${Date.now()}-${i}`, role: m.role, content: m.content, timestamp: now() })),
    });
    mutate((p) => [s, ...p]); setActiveId(s.id);
    void memoryStore.index(indexable(s, s.messages));
  }, [mutate]);

  const addContext = useCallback((item: ContextItem) => patchSession(activeId, (s) => ({ ...s, context: [...(s.context ?? []), item] })), [activeId, patchSession]);
  const patchContext = useCallback((fn: (c: ContextItem[]) => ContextItem[]) => patchSession(activeId, (s) => ({ ...s, context: fn(s.context ?? []) })), [activeId, patchSession]);
  const setProjectContext = useCallback((sid: string, files: ContextFile[]) => { projectRef.current = { sid, files }; }, []);

  return {
    sessions, active, activeId: active?.id ?? '', setActiveId, folders, setFolders, memory, setMemory, isStreaming, raw,
    send, answerPoll, decideInstall, stop, regenerate, editMessage, switchTo, rateMemory, rateReply, newChat, deleteChat, clearChat, importMessages,
    patchSession, addContext, patchContext, estimateTokens, toggleMemory, setProjectContext,
  };
}
