import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, Mic, X } from 'lucide-react';
import { emitEvent, invokeNative, onEvent } from '../lib/bus';
import { applyThemeToDocument } from '../styles/theme';
import { Mascot } from './Mascot';
import { IslandChat, IslandChatHandle } from './IslandChat';
import { ApprovalCard } from './ApprovalCard';
import { useActivity, useAgents, useCoreRuns } from './hooks';
import { runActivities } from './runs';
import { WorkView, wordOf } from './WorkView';
import { Activity, Mood, loadIsland, mainSettings, saveIsland } from './state';
import { onCoreEvent, rpc } from '../lib/core';
import { answerAsk, decideStep } from '../lib/agent';
import { describeAllow } from '../lib/allowRules';
import { kv } from '../lib/store';
import { AgentFace } from '../components/common/AgentFace';
import { droppedFiles, dragHasFiles } from '../lib/fileDrop';
import { openExternal, revealPath } from '../lib/open';
import { speak, transcribe } from '../voice/voice';
import { FLOAT_GAP, islandLook } from './look';
import { Pill, Ring } from './parts';
import { Home, pinOptions, pinsFrom } from './Home';
import { DropZones, ShelfView, type DropZone } from './ShelfView';
import { ClipPeek, FocusDone } from './ClipPeek';
import { clipPrompt, clipWorthShowing, type ClipActionId } from './clip';
import { FOCUS_KEY, Focus, focusLabel, focusLeft, focusMore, focusPause, focusResume, focusStart } from './focus';
import { nextUp } from './nextUp';
import { askPrompt, isAudio, type UsePage } from './shelfRules';
import { shelf, useAutoPause, useBoard, useCalendar, useNowPlaying, type ShelfItem } from './sources';

/**
 * The island, 0.23 redesign. It grows out of the top centre of the screen: pure black and flush with the
 * edge in dark mode (the notch on a MacBook), a white card just below the edge in light mode (look.ts).
 * One accent, the app's; Petal keeps its pink face.
 *
 * It is not there unless something is happening, or you reach for it:
 *   - push the mouse to the top centre of the screen (or hover the pill): the home opens, with what is
 *     running, now playing, a focus timer, next up, the shelf, your quick buttons and a note box
 *   - work in progress: a slim pill (Petal, a number, a ring); an update peeks open for a moment
 *   - a question or permission request from an agent: the answer buttons are right there
 *   - voice: while Lotus speaks or listens
 *   - drag a file to the top: drop zones (keep, ask, convert, use in)
 *   - copy some text (if turned on): a few things Lotus can do with it
 *   - the quick chat, when you summon it (Ctrl+Alt+Space / tray / Ask)
 * The × hides it until the next new event.
 */

type Ask = { runId: string; askId: string; question: string; options: string[] };
type Perm = { runId: string; stepId: string; text: string; always?: string };
type VoiceState = 'idle' | 'speaking' | 'listening' | 'transcribing';

/** A spring with a little overshoot, like the Dynamic Island. */
const ease = 'cubic-bezier(.34,1.36,.64,1)';
const DONE_MS = 4000;
/** 0.23.1: how long closing takes (the island folds back into the top edge, then the window hides). */
const CLOSE_MS = 260;
/** 0.23.1: a woken island folds away this fast after the mouse leaves it (or never reaches it). */
const FOLD_AFTER_LEAVE = 260, FOLD_UNTOUCHED = 1100;
const reduceMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const CLIP_MS = 8000;
/**
 * macOS: the island sits over the notch. Its compact form keeps Petal and the status on either side
 * of the notch (the middle 200 pt is hidden by the camera housing) and expanded content starts below it.
 * ⚠️ Not yet seen on a real Mac; on Macs without a notch the middle is simply empty black.
 */
const MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
const NOTCH_W = 200, NOTCH_H = 32;
/** Size of the flared top corners (black island only). */
const EAR = 9;

const systemDark = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
const appDark = () => { const a = mainSettings().appearance; return a === 'auto' ? systemDark() : a === 'dark'; };
const loadFocus = (): Focus | null => { try { return JSON.parse(kv.getItem(FOCUS_KEY) || 'null'); } catch { return null; } };
const saveFocus = (f: Focus | null) => { try { if (f) kv.setItem(FOCUS_KEY, JSON.stringify(f)); else kv.removeItem(FOCUS_KEY); } catch { /* memory only */ } };

export const Island: React.FC = () => {
  const [settings, setSettings] = useState(loadIsland);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMounted, setChatMounted] = useState(false);
  const [hasChat, setHasChat] = useState(false);
  const [chatMood, setChatMood] = useState<Mood>('idle');
  const [dismissed, setDismissed] = useState<string>('');
  const [hovered, setHovered] = useState(false);
  const [woken, setWoken] = useState(false);
  const [typing, setTyping] = useState(false);
  const [asks, setAsks] = useState<Ask[]>([]);
  const [perms, setPerms] = useState<Perm[]>([]);
  const [voice, setVoice] = useState<VoiceState>('idle');
  const [typed, setTyped] = useState('');
  const [hue, setHue] = useState(() => Number(kv.getItem('lotus.petal.hue')) || 330);
  const [dark, setDark] = useState(appDark);
  // 'auto': what Lotus is doing when it is busy, else the menu. 'menu': the menu (home). 'shelf'.
  const [view, setView] = useState<'auto' | 'menu' | 'shelf'>('auto');
  const [dragging, setDragging] = useState(false);
  const [shelfItems, setShelfItems] = useState<ShelfItem[]>([]);
  const [shelfSel, setShelfSel] = useState<string | null>(null);
  const [shelfStatus, setShelfStatus] = useState<string | null>(null);
  const [shelfBusy, setShelfBusy] = useState<string | null>(null);
  const [clip, setClip] = useState<string | null>(null);
  const [focus, setFocusState] = useState<Focus | null>(loadFocus);
  const [focusDone, setFocusDone] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [skills, setSkills] = useState<{ id: string; name: string }[]>([]);
  const [now, setNow] = useState(Date.now());
  /** 0.23.1: the open/close animation (see below). */
  const [phase, setPhase] = useState<'closed' | 'opening' | 'open' | 'closing'>('closed');
  const activity = useActivity();
  const agents = useAgents(settings.agents);
  const chat = useRef<IslandChatHandle>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const entered = useRef(false);
  const coreRuns = useCoreRuns();

  const look = islandLook(dark, settings.surface, MAC);
  const setFocus = useCallback((f: Focus | null) => { setFocusState(f); saveFocus(f); }, []);
  const flash = useCallback((m: string) => { setNotice(m); setTimeout(() => setNotice((cur) => (cur === m ? null : cur)), 3200); }, []);

  useEffect(() => {
    const sync = (e: StorageEvent) => { if (e.key === 'lotus.island.v1') setSettings(loadIsland()); if (!e.key || e.key === 'lotus.settings.v1') setDark(appDark()); };
    const mq = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)') : null;
    const sys = () => setDark(appDark());
    window.addEventListener('storage', sync);
    mq?.addEventListener('change', sys);
    return () => { window.removeEventListener('storage', sync); mq?.removeEventListener('change', sys); };
  }, []);
  // The accent has a brighter variant on black; follow the island's own surface, not the main window's.
  useEffect(() => { applyThemeToDocument(mainSettings().palette as never, 'jakarta', 'md', look.dark); }, [look.dark]);

  // Lotus's own agents: questions and permission requests, from any window's runs.
  useEffect(() => onCoreEvent((raw) => {
    const e = raw as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (e.type !== 'agent') return;
    if (e.kind === 'ask') setAsks((l) => [...l, { runId: e.runId, askId: e.askId, question: e.question, options: e.options ?? [] }]);
    else if (e.kind === 'answered') setAsks((l) => l.filter((a) => !(a.runId === e.runId && a.askId === e.askId)));
    else if (e.kind === 'step') {
      if (e.step?.status === 'waiting') setPerms((l) => (l.some((p) => p.stepId === e.step.id) ? l : [...l, { runId: e.runId, stepId: e.step.id, text: e.step.ask ?? e.step.label, always: e.step.always }]));
      else setPerms((l) => l.filter((p) => p.stepId !== e.step?.id));
    } else if (e.kind === 'done' || e.kind === 'error') {
      setAsks((l) => l.filter((a) => a.runId !== e.runId));
      setPerms((l) => l.filter((p) => p.runId !== e.runId));
    }
  }), []);

  const openChat = useCallback(() => { setChatMounted(true); setChatOpen(true); setDismissed(''); setWoken(false); void invokeNative('island_focus'); setTimeout(() => chat.current?.focusInput(), 80); }, []);
  /** Opens the quick chat and runs `fn` once it is there. */
  const withChat = useCallback((fn: (c: IslandChatHandle) => void) => { openChat(); const go = (n: number) => (chat.current ? fn(chat.current) : n > 0 && setTimeout(() => go(n - 1), 60)); setTimeout(() => go(20), 60); }, [openChat]);

  useEffect(() => {
    const offs: (() => void)[] = [];
    void onEvent('island:toggle', () => setChatOpen((v) => { if (!v) openChat(); return !v; })).then((u) => offs.push(u));
    void onEvent('island:open-chat', openChat).then((u) => offs.push(u));
    void onEvent('island:dictate', () => withChat((c) => setTimeout(() => c.toggleDictation(), 90))).then((u) => offs.push(u));
    void onEvent<VoiceState>('voice:state', (s) => setVoice(s)).then((u) => offs.push(u));
    void onEvent<number>('petal:hue', (h) => setHue(h)).then((u) => offs.push(u));
    // 0.23: the mouse touched the top centre of the screen (src-tauri/src/island.rs).
    void onEvent('island:wake', () => { setWoken((was) => { if (!was) { setView('auto'); entered.current = false; } return true; }); setDismissed(''); }).then((u) => offs.push(u));
    // 0.23: you copied text (only sent while "Offer actions for copied text" is on; never from password managers).
    void onEvent<{ text: string }>('island:clip', (c) => { if (c?.text && clipWorthShowing(c.text)) { setClip(c.text); setDismissed(''); } }).then((u) => offs.push(u));
    // 0.23: "Focus" on a task card in the main window.
    void onEvent<{ id: string; title: string }>('island:focus', (t) => { setFocus(focusStart(loadIsland().focusMinutes, Date.now(), t)); setFocusDone(false); setView('auto'); setWoken(true); }).then((u) => offs.push(u));
    return () => offs.forEach((o) => o());
  }, [openChat, withChat, setFocus]);

  // Tell the app shell whether to watch the top edge (and for copied text).
  useEffect(() => { void invokeNative('island_watch', { wake: settings.enabled && settings.wake, clipboard: settings.enabled && settings.clipboard }).catch(() => undefined); }, [settings.enabled, settings.wake, settings.clipboard]);

  useAutoPause(settings.autoPause);

  // ── What to show ─────────────────────────────────────────────────────────
  const claude = agents.queue[0];
  const ask = asks[0];
  const perm = perms[0];
  // Windows' own lines, then Lotus's agent runs they don't already show, then Claude Code sessions at work.
  const items = useMemo<Activity[]>(() => [
    ...activity.items,
    ...runActivities(coreRuns, activity.items, Date.now()),
    ...(settings.agents ? agents.sessions.filter((x) => x.state === 'working').map((x) => ({ id: `cc-${x.id}`, kind: 'build' as const, label: x.project ? `Working in ${x.project}` : 'Working', kicker: 'Claude Code' })) : []),
  ], [activity.items, coreRuns, agents.sessions, settings.agents]);
  const running = items.filter((a) => !a.done);
  const finished = items.filter((a) => a.done);
  const head: Activity | undefined = running[0] ?? finished[finished.length - 1];
  const agentRows = running.slice(1).filter((a) => a.agent);
  // When each line was first seen, for "3 min" on the work view.
  const firstSeen = useRef(new Map<string, number>());
  for (const a of items) if (!firstSeen.current.has(a.id)) firstSeen.current.set(a.id, Date.now());
  const left = focus ? focusLeft(focus, now) : 0;
  type Mode = 'hidden' | 'pill' | 'home' | 'ask' | 'perm' | 'claude' | 'chat' | 'clip' | 'drop' | 'focus-done';
  // A key for "the thing on screen", so × hides only that and the next new thing shows again.
  const key = claude ? `c${claude.requestId}` : ask ? `a${ask.askId}` : perm ? `p${perm.stepId}` : voice !== 'idle' ? `v${voice}` : head ? `h${head.id}${head.done ? 'd' : ''}` : focus ? 'focus' : '';
  const on = settings.enabled;
  const mode: Mode = chatOpen ? 'chat' : claude ? 'claude' : ask ? 'ask' : perm ? 'perm'
    : !on ? 'hidden'
      : focusDone ? 'focus-done'
        : dragging ? 'drop'
          : clip ? 'clip'
            : woken || (hovered && !!key) ? 'home'
              : key && key !== dismissed ? 'pill' : 'hidden';
  const mood: Mood = mode === 'ask' || mode === 'perm' || mode === 'claude' ? 'alert' : voice === 'listening' ? 'listening' : voice === 'speaking' ? 'speaking'
    : mode === 'chat' ? chatMood : running.length ? 'thinking' : head?.done ? 'happy' : 'idle';

  // Like the Dynamic Island, an update (something starts or finishes) shows more for a moment.
  const [peek, setPeek] = useState(false);
  const peekKey = `${head?.id ?? ''}${head?.done ? 'd' : ''}`;
  useEffect(() => {
    if (!peekKey) return;
    setPeek(true);
    const t = setTimeout(() => setPeek(false), 2600);
    return () => clearTimeout(t);
  }, [peekKey]);

  // "Done" lines leave on their own.
  useEffect(() => {
    if (running.length || !head?.done) return;
    const t = setTimeout(() => setDismissed(`h${head.id}d`), DONE_MS);
    return () => clearTimeout(t);
  }, [head?.id, head?.done, running.length]);

  // The clock ticks while a focus timer runs (and for "in 18 min" on the home).
  // 0.23.1: every second too while the work view shows how long something has taken.
  const workTick = mode === 'home' && !!head && !head.done && view === 'auto';
  useEffect(() => {
    if (!focus || focus.since === null) { if (mode !== 'home') return; }
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), (focus && focus.since !== null) || workTick ? 1000 : 30_000);
    return () => clearInterval(t);
  }, [focus, mode, workTick]);
  useEffect(() => { if (focus && focus.since !== null && left <= 0) { setFocusDone(true); setDismissed(''); } }, [focus, left]);

  // A woken island that the mouse never enters, or leaves, folds away (not while you type).
  useEffect(() => {
    if (!woken || hovered) return;
    const t = setTimeout(() => { if (!typing) { setWoken(false); setView('auto'); } }, entered.current ? FOLD_AFTER_LEAVE : FOLD_UNTOUCHED);
    return () => clearTimeout(t);
  }, [woken, hovered, typing]);
  // The copied-text peek leaves on its own unless you hover it.
  useEffect(() => {
    if (!clip || hovered) return;
    const t = setTimeout(() => setClip(null), CLIP_MS);
    return () => clearTimeout(t);
  }, [clip, hovered]);

  // ── Data for the home ───────────────────────────────────────────────────
  const homeOpen = mode === 'home';
  const [media, mediaControl] = useNowPlaying(settings.media && (homeOpen || mode === 'pill'));
  const board = useBoard(homeOpen);
  const cal = useCalendar(settings.calendarUrl);
  const next = useMemo(() => nextUp({ now, tasks: board.tasks, routines: board.routines, events: cal.events }), [now, board, cal.events]);
  const refreshShelf = useCallback(() => void shelf.list().then(setShelfItems).catch(() => undefined), []);
  useEffect(() => { if (homeOpen) refreshShelf(); }, [homeOpen, refreshShelf]);
  useEffect(() => { if (homeOpen) void rpc<{ id: string; name: string; enabled?: boolean }[]>('skills_list').then((l) => setSkills((l ?? []).filter((s) => s.enabled !== false).map((s) => ({ id: s.id, name: s.name })))).catch(() => undefined); }, [homeOpen]);
  const allPins = useMemo(() => pinOptions(skills, board.routines.map((r) => ({ id: r.id, name: r.name }))), [skills, board.routines]);
  const pins = pinsFrom(settings.pins, allPins);

  // ── Files dragged to the island ─────────────────────────────────────────
  useEffect(() => {
    if (!on || mode === 'chat') return;
    let depth = 0;
    const enter = (e: DragEvent) => { if (!dragHasFiles(e.dataTransfer?.types)) return; depth++; setDragging(true); };
    const over = (e: DragEvent) => { if (!dragHasFiles(e.dataTransfer?.types)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; };
    const leave = (e: DragEvent) => { if (!dragHasFiles(e.dataTransfer?.types)) return; depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const drop = (e: DragEvent) => {
      depth = 0; setDragging(false);
      if (!dragHasFiles(e.dataTransfer?.types) || e.defaultPrevented) return;
      e.preventDefault();
      void droppedFiles(e.dataTransfer).then((f) => takeFiles(f, 'keep'));
    };
    window.addEventListener('dragenter', enter); window.addEventListener('dragover', over); window.addEventListener('dragleave', leave); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); };
  }, [on, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const takeFiles = async (files: File[], zone: DropZone) => {
    if (!files.length) return;
    setWoken(true);
    if (zone === 'ask') { withChat((c) => void c.ask(askPrompt(files[0].name), files)); }
    const kept: ShelfItem[] = [];
    for (const f of files) { try { kept.push(await shelf.add(f)); } catch (e) { setShelfStatus((e as Error).message); } }
    refreshShelf();
    if (zone === 'ask') return;
    setView('shelf');
    setShelfSel(zone === 'keep' ? null : kept[0]?.name ?? null);
    if (kept.length) setShelfStatus(zone === 'keep' ? `Kept ${kept.length === 1 ? kept[0].name : `${kept.length} files`} on the shelf.` : zone === 'convert' ? 'Pick what to turn it into.' : 'Pick where to use it.');
  };
  const dropOnZone = (z: DropZone, e: React.DragEvent) => { setDragging(false); void droppedFiles(e.dataTransfer).then((f) => takeFiles(f, z)); };

  const shelfActs = {
    ask: (it: ShelfItem) => { void shelf.file(it).then((f) => withChat((c) => void c.ask(askPrompt(it.name), [f]))).catch((e) => setShelfStatus((e as Error).message)); },
    convert: async (it: ShelfItem, to: string) => {
      setShelfBusy(it.name); setShelfStatus(`Turning ${it.name} into ${to.toUpperCase()}…`);
      try { const out = await shelf.convert(it.name, to); setShelfStatus(`Saved ${out.name} on the shelf.`); setShelfSel(out.name); refreshShelf(); }
      catch (e) { setShelfStatus((e as Error).message); } finally { setShelfBusy(null); }
    },
    transcribe: async (it: ShelfItem) => {
      setShelfBusy(it.name); setShelfStatus(`Writing down what is said in ${it.name}…`);
      let temp: string | null = null;
      try {
        let src = it;
        if (!/\.wav$/i.test(it.name)) { const w = await shelf.convert(it.name, 'wav'); temp = w.name; src = w; }
        const text = (await transcribe(await shelf.file(src))).trim();
        if (!text) throw new Error(`No speech found in ${it.name}.`);
        const stem = it.name.replace(/\.[^.]+$/, '');
        const out = await shelf.add(new File([text], `${stem} (text).txt`, { type: 'text/plain' }));
        try { await navigator.clipboard.writeText(text); } catch { /* the window may not have focus */ }
        setShelfStatus(`Saved ${out.name} on the shelf and copied the text.`); setShelfSel(out.name);
      } catch (e) { setShelfStatus((e as Error).message); }
      finally { if (temp) await shelf.remove(temp).catch(() => undefined); setShelfBusy(null); refreshShelf(); }
    },
    use: (it: ShelfItem, page: UsePage) => { void emitEvent('main:files', { page, names: [it.name] }); void invokeNative('open_main', { view: page }); setShelfStatus(`Sent ${it.name} to ${page[0].toUpperCase()}${page.slice(1)}.`); },
    reveal: (it: ShelfItem) => { void shelf.path(it.name).then((p) => (p ? revealPath(p) : undefined)).catch((e) => setShelfStatus((e as Error).message)); },
    remove: (it: ShelfItem) => { void shelf.remove(it.name).then(() => { setShelfSel(null); refreshShelf(); }).catch((e) => setShelfStatus((e as Error).message)); },
  };
  // Screenshots and previews in a plain browser.
  useEffect(() => { (window as unknown as Record<string, unknown>).__islandDropDemo = () => void takeFiles([new File(['x'.repeat(48_213)], 'Interview with Ana.m4a', { type: 'audio/mp4' }), new File(['x'.repeat(912_000)], 'Quarterly report.pdf', { type: 'application/pdf' })], 'convert'); }); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Quick buttons, notes, copied text, focus ────────────────────────────
  const clipboardText = async (): Promise<string> => {
    const native = await invokeNative<string | null>('clip_text').catch(() => null);
    if (native) return native;
    try { return await navigator.clipboard.readText(); } catch { return ''; }
  };
  const runAction = async (id: string) => {
    const page = (v: string) => void invokeNative('open_main', { view: v });
    if (id === 'ask') return openChat();
    if (id === 'dictate') return withChat((c) => setTimeout(() => c.toggleDictation(), 90));
    if (id === 'call') { void emitEvent('main:call'); return page('voice'); }
    if (id === 'image') return page('images');
    if (id === 'work' || id === 'video' || id === 'tasks') return page(id);
    if (id === 'focus') { if (!focus) setFocus(focusStart(settings.focusMinutes, Date.now())); return; }
    if (id === 'clip-summary' || id === 'read-clip') {
      const t = (await clipboardText()).trim();
      if (!t) return flash('Copy some text first.');
      if (id === 'read-clip') { void speak(t).catch((e) => flash((e as Error).message)); return flash('Reading what you copied…'); }
      return withChat((c) => void c.ask(clipPrompt('summarise', t, settings.translateTo)));
    }
    if (id.startsWith('skill:')) { const s = skills.find((x) => `skill:${x.id}` === id); return withChat((c) => c.prefill(`Use my “${s?.name ?? 'skill'}” skill: `)); }
    if (id.startsWith('routine:')) {
      const r = board.routines.find((x) => `routine:${x.id}` === id);
      try { await rpc('routine_run', { id: id.slice(8) }); flash(`Running “${r?.name ?? 'routine'}”. The result is in Tasks → Routines.`); } catch (e) { flash((e as Error).message); }
    }
  };
  const remember = async (text: string): Promise<string> => {
    const at = Date.now();
    try {
      await rpc('memories_put', { items: [{ id: `mem-${at.toString(36)}`, kind: 'memory', text, source: 'user', uses: 0, ts: at, updated: at, tier: 'long', chatId: null, lastUsed: null }] });
      void emitEvent('memory:changed');
      return 'Kept in memory. Lotus will remember it.';
    } catch (e) { return `Couldn't save: ${(e as Error).message}`; }
  };
  const addTask = async (title: string): Promise<string> => {
    try { await rpc('task_add', { id: `task-${Date.now().toString(36)}`, title, assignee: 'me', status: 'todo' }); return 'Added to your tasks (To do).'; }
    catch (e) { return `Couldn't add it: ${(e as Error).message}`; }
  };
  const clipAction = (id: ClipActionId) => {
    const t = clip ?? '';
    setClip(null);
    if (id === 'read') { void speak(t).catch((e) => flash((e as Error).message)); return; }
    withChat((c) => void c.ask(clipPrompt(id, t, settings.translateTo)));
  };
  const focusAct = (a: 'pause' | 'resume' | 'stop') => setFocus(!focus || a === 'stop' ? null : a === 'pause' ? focusPause(focus, Date.now()) : focusResume(focus, Date.now()));
  const finishFocus = (more: boolean) => {
    setFocusDone(false);
    if (more && focus) return setFocus(focusMore(focus, 5, Date.now()));
    if (focus?.task) void rpc('task_move', { id: focus.task.id, status: 'done' }).catch(() => undefined);
    setFocus(null);
  };

  // 0.23.1: while Lotus is doing something, opening the island shows only that (Menu goes to the home).
  const busy = !!head;
  const workView = busy && view === 'auto';

  // ── Window size and visibility ───────────────────────────────────────────
  const content = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(0);
  const measuredMode = mode === 'home' || mode === 'clip' || mode === 'drop' || mode === 'focus-done' || (mode === 'pill' && peek);
  useLayoutEffect(() => {
    const el = content.current;
    if (!el || !measuredMode) return;
    const ro = new ResizeObserver(() => setMeasured(Math.ceil(el.scrollHeight)));
    ro.observe(el);
    setMeasured(Math.ceil(el.scrollHeight));
    return () => ro.disconnect();
    // The content exists only once the window is open, so measure again then (0.23.1).
  }, [measuredMode, mode, view, workView, phase === 'closed']);

  const top = MAC ? NOTCH_H : 0;
  const dims = useMemo(() => {
    if (mode === 'chat') return { w: 460, h: top + (hasChat ? 500 : 214) };
    if (mode === 'claude') return { w: 480, h: top + 236 };
    if (mode === 'ask') return { w: 440, h: top + 92 + (ask?.options.length ? 40 : 0) + 44 };
    if (mode === 'perm') return { w: 420, h: top + 124 };
    if (mode === 'home' || mode === 'drop') return { w: 440, h: top + Math.max(measured, 120) };
    if (mode === 'clip' || mode === 'focus-done') return { w: 420, h: top + Math.max(measured, 60) };
    if (mode === 'pill' && peek) return { w: 380, h: top + Math.max(measured, 56) };
    // Compact: a leading glyph and a short trailing value on either side of the (real or imagined) notch.
    return { w: MAC ? NOTCH_W + 92 : 200, h: MAC ? NOTCH_H : 34 };
  }, [mode, hasChat, ask?.options.length, peek, measured, top]);

  const shown = mode !== 'hidden';
  const compact = mode === 'pill' && !peek;
  // 0.23.1: opening and closing are animated. Opening: the window shows, the island starts as a small
  // pill, faded, and springs to its size. Closing: the content fades, the island folds back into the
  // top edge, then the window hides.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  useEffect(() => {
    const ph = phaseRef.current;
    if (shown) {
      if (ph === 'open' || ph === 'opening') return;
      void invokeNative('island_show');
      setPhase('opening');
      let r2 = 0;
      const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setPhase('open')); });
      return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
    }
    if (ph === 'closed') return;
    setPhase('closing');
    const t = setTimeout(() => { setPhase('closed'); void invokeNative('island_hide'); }, reduceMotion() ? 60 : CLOSE_MS);
    return () => clearTimeout(t);
  }, [shown]);
  // Drawn smaller while opening and closing; the window keeps the full size meanwhile.
  const small = phase !== 'open';
  const drawn = small ? { w: MAC ? NOTCH_W + 92 : 200, h: MAC ? NOTCH_H : 34 } : dims;
  const padX = look.floating ? FLOAT_GAP.side : EAR;
  const padTop = look.floating ? FLOAT_GAP.top : 0;
  const padBottom = look.floating ? FLOAT_GAP.bottom : 0;
  const winW = dims.w + 2 * padX, winH = dims.h + padTop + padBottom;
  const prev = useRef({ w: 0, h: 0 });
  useEffect(() => {
    if (!shown) return;
    const p = prev.current;
    void invokeNative('island_resize', { width: Math.max(p.w, winW), height: Math.max(p.h, winH) });
    const t = setTimeout(() => void invokeNative('island_resize', { width: winW, height: winH }), 420);
    prev.current = { w: winW, h: winH };
    return () => clearTimeout(t);
  }, [winW, winH, shown]);

  const close = useCallback(() => { setChatOpen(false); setWoken(false); setView('auto'); setClip(null); setDismissed(key); }, [key]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && (mode === 'chat' || mode === 'pill' || mode === 'home' || mode === 'clip')) close(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [mode, close]);

  const enter = () => { clearTimeout(leaveTimer.current); entered.current = true; setHovered(true); };
  const leave = () => { clearTimeout(leaveTimer.current); leaveTimer.current = setTimeout(() => { setHovered(false); if (!woken) setView('auto'); }, 120); };

  const line = voice === 'listening' ? 'Listening…' : voice === 'transcribing' ? 'Got it, writing it down…' : voice === 'speaking' ? 'Speaking…' : head ? head.label : '';
  // Compact trailing value: a number when there is one, else a word (Dynamic Island keeps it to one value).
  const trailing = voice === 'speaking' ? 'Speaking' : voice === 'transcribing' ? '…' : head ? (head.done ? 'Done' : head.progress != null ? `${Math.round(head.progress * 100)}%` : running.length > 1 ? `${running.length}` : '')
    : focus ? focusLabel(left) : '';
  const kicker = voice !== 'idle' ? 'Voice' : head ? wordOf(head) : new Date(now).toLocaleString([], { weekday: 'long', hour: '2-digit', minute: '2-digit' });
  const title = line || (focus ? `Focus · ${focusLabel(left)} left` : 'Nothing running right now');
  const announce = mode === 'clip' ? 'You copied some text. Lotus can explain, summarise, translate, fix or read it.'
    : mode === 'drop' ? 'Drop the file on Keep for later, Ask Lotus, Turn into, or Use in.'
      : mode === 'focus-done' ? 'Focus time is up.'
        : head ? `${wordOf(head)}: ${head.label}${head.done ? ', done' : ''}` : voice !== 'idle' ? line : '';
  const radius = compact || small ? 17 : 26;
  const motion = reduceMotion();
  const closing = phase === 'closing';
  const spring = closing ? 'cubic-bezier(.4,0,.9,.4)' : ease;
  const dur = motion ? '.01s' : closing ? `${CLOSE_MS / 1000}s` : '.42s';
  const surfaceStyle: React.CSSProperties = {
    ...(look.vars as React.CSSProperties),
    left: padX + (dims.w - drawn.w) / 2, top: padTop, width: drawn.w, height: drawn.h,
    background: 'var(--is-bg)', color: 'var(--is-text)', boxShadow: 'var(--is-shadow)',
    borderRadius: look.floating ? radius : `0 0 ${radius}px ${radius}px`,
    opacity: small ? 0 : 1,
    transform: small && !motion ? (look.floating ? 'translateY(-6px) scale(.96)' : 'scaleY(.9)') : 'none',
    transformOrigin: 'top center',
    transition: ['width', 'height', 'border-radius', 'left', 'transform'].map((k) => `${k} ${dur} ${spring}`).concat(`opacity ${motion ? '.12s' : closing ? '.2s' : '.18s'} ease`).join(', '),
  };
  // The content shows once the island has room for it, and goes first when it closes.
  const contentStyle: React.CSSProperties = { opacity: small ? 0 : 1, transition: small ? 'opacity .1s ease' : `opacity .2s ease ${motion ? 0 : 0.08}s` };

  return (
    <div className="w-screen h-screen flex justify-center items-start select-none overflow-hidden" style={look.vars as React.CSSProperties}>
      {phase !== 'closed' && (
        <div className="relative" style={{ width: winW, height: winH }}>
          {/* The flared top corners notch apps use: the black curves outwards into the screen's top edge. */}
          {/* 0.23.1: a 1 px soft edge (0.23.0 had a hard half-pixel one that looked jagged), tucked 2 px under */}
          {/* the island so no hairline gap shows at 125 % or 150 % screen scaling; they move with the island. */}
          {!look.floating && <>
            <span aria-hidden className="absolute top-0" style={{ left: padX + (dims.w - drawn.w) / 2 - EAR, width: EAR + 2, height: EAR, opacity: small ? 0 : 1, background: `radial-gradient(circle at 0 100%, transparent ${EAR - 1}px, var(--is-bg) ${EAR}px)`, transition: surfaceStyle.transition }} />
            <span aria-hidden className="absolute top-0" style={{ left: padX + (dims.w + drawn.w) / 2 - 2, width: EAR + 2, height: EAR, opacity: small ? 0 : 1, background: `radial-gradient(circle at ${EAR + 2}px 100%, transparent ${EAR - 1}px, var(--is-bg) ${EAR}px)`, transition: surfaceStyle.transition }} />
          </>}
          <div role="region" aria-label="Lotus island" onPointerEnter={enter} onPointerLeave={leave}
            className="absolute overflow-hidden" style={surfaceStyle}>
            {/* What a screen reader hears: changes of state only, never the ticking timer. */}
            <p className="sr-only" aria-live="polite">{announce}</p>
            <div className="absolute inset-x-0 bottom-0" style={{ top: MAC && !compact ? NOTCH_H : 0, ...contentStyle }}>
              <div ref={content}>
                {mode === 'pill' && (compact ? (
                  <div className="h-[34px] flex items-center justify-between pl-2 pr-2.5" title={line}>
                    <Mascot hue={hue} mood={mood} size={22} />
                    <span className="flex items-center gap-1.5 text-[12px] font-semibold tabular-nums text-[var(--color-accent-vibrant)]">
                      {voice === 'listening' ? <Mic className="w-3.5 h-3.5 animate-pulse" /> : <>{trailing}{voice === 'idle' && (head ? <Ring progress={head.progress ?? null} done={head.done} /> : focus ? <Ring progress={1 - left / focus.total} /> : null)}</>}
                    </span>
                  </div>
                ) : (
                  <div className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      {head?.agent && voice === 'idle' ? <AgentFace name={head.agent} size={34} animate={!head.done} mood={head.done ? undefined : 'thinking'} /> : <Mascot hue={hue} mood={mood} size={34} />}
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] leading-tight text-[var(--is-muted)]">{kicker}</p>
                        <p className="truncate text-[14px] font-semibold leading-snug">{title}</p>
                      </div>
                      <span className="flex items-center gap-1.5 text-[12px] font-semibold tabular-nums text-[var(--color-accent-vibrant)]">
                        {trailing && trailing !== 'Done' && trailing}
                        {voice === 'listening' ? <Mic className="w-5 h-5 animate-pulse" /> : <Ring progress={head?.progress ?? null} done={head?.done} size={22} />}
                      </span>
                    </div>
                    {agentRows.slice(0, 4).map((a) => <div key={a.id} className="h-6 pl-[46px] flex items-center gap-2 text-[12px] text-[var(--is-muted)]"><AgentFace name={a.agent} size={16} mood="thinking" /><span className="flex-1 truncate">{a.label}</span><Ring progress={a.progress ?? null} /></div>)}
                  </div>
                ))}

                {mode === 'home' && workView && head && (
                  <WorkView head={head} others={items.filter((a) => a.id !== head.id && !a.done)} mood={mood} hue={hue}
                    since={firstSeen.current.get(head.id) ?? now} now={now} voice={voice} voiceLine={line}
                    onMenu={() => setView('menu')} onOpen={(page) => void invokeNative('open_main', { view: page })} onHide={close}
                    onStop={head.id.startsWith('run-') ? () => void rpc('agent_stop', { runId: head.id.slice(4) }).catch(() => undefined) : undefined} />
                )}
                {mode === 'home' && !workView && view !== 'shelf' && (
                  <Home onShowWork={busy ? () => setView('auto') : undefined} mood={mood} hue={hue} kicker={kicker} title={title} head={head} running={running}
                    media={settings.media ? media : null} onMedia={mediaControl}
                    focus={focus} now={now} onFocus={focusAct}
                    next={next} onJoin={(u) => void openExternal(u)} onFocusTask={(id, t) => setFocus(focusStart(settings.focusMinutes, Date.now(), { id, title: t }))}
                    shelf={shelfItems} onOpenShelf={() => { setShelfStatus(null); setView('shelf'); }}
                    pins={pins} allPins={allPins} onPins={(ids) => setSettings(saveIsland({ pins: ids }))} onAction={(id) => void runAction(id)}
                    onAsk={(t) => withChat((c) => void c.ask(t))} onRemember={remember} onAddTask={addTask}
                    onDictate={() => void runAction('dictate')} onOpen={() => void invokeNative('open_main', {})} onHide={close}
                    onTyping={(b) => { setTyping(b); if (b) void invokeNative('island_focus'); }} notice={notice} />
                )}
                {mode === 'home' && view === 'shelf' && (
                  <ShelfView items={shelfItems} selected={shelfSel} onSelect={setShelfSel} onBack={() => { setView('auto'); setShelfSel(null); }} act={shelfActs} status={shelfStatus} busy={shelfBusy} />
                )}
                {mode === 'drop' && <DropZones onDropZone={dropOnZone} />}
                {mode === 'clip' && clip && <ClipPeek text={clip} onAction={clipAction} onClose={() => setClip(null)} />}
                {mode === 'focus-done' && <FocusDone task={focus?.task} onMore={() => finishFocus(true)} onDone={() => finishFocus(false)} onClose={() => { setFocusDone(false); setFocus(null); }} />}
              </div>

              {mode === 'ask' && ask && (
                <div className="h-full p-3 flex flex-col" role="alertdialog" aria-label="Lotus is asking you">
                  <div className="flex items-start gap-2.5">
                    <Mascot hue={hue} mood={mood} size={28} />
                    <p className="flex-1 text-[13px] font-medium leading-snug pt-1 line-clamp-2">{ask.question}</p>
                  </div>
                  {ask.options.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5 pl-[38px]">{ask.options.map((o) => <Pill key={o} onClick={() => void answerAsk(ask.runId, ask.askId, o)}>{o}</Pill>)}</div>}
                  <form className="mt-auto pl-[38px] flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { void answerAsk(ask.runId, ask.askId, typed.trim()); setTyped(''); } }}>
                    <input value={typed} onChange={(e) => setTyped(e.target.value)} onFocus={() => void invokeNative('island_focus')} placeholder={voice === 'listening' ? 'Listening… or type' : 'Type an answer'} aria-label="Your answer"
                      className="flex-1 h-8 px-3 rounded-full bg-[var(--is-raised)] text-[13px] text-[var(--is-text)] placeholder:text-[var(--is-muted)] focus:outline-none focus:bg-[var(--is-raised-hover)]" />
                    {voice === 'listening' && <span className="w-8 h-8 inline-flex items-center justify-center text-[var(--petal-red)]" title="Listening"><Mic className="w-4 h-4 animate-pulse" /></span>}
                    <Pill type="submit" primary disabled={!typed.trim()} onClick={() => undefined}>Answer</Pill>
                  </form>
                </div>
              )}

              {mode === 'perm' && perm && (
                <div className="h-full p-3 flex flex-col" role="alertdialog" aria-label="Lotus needs your permission">
                  <div className="flex items-start gap-2.5">
                    <Mascot hue={hue} mood={mood} size={28} />
                    <div className="flex-1 min-w-0 pt-0.5"><p className="text-[12px] text-[var(--is-muted)]">Lotus needs your permission</p><p className="text-[13px] font-medium leading-snug line-clamp-2">{perm.text}</p></div>
                  </div>
                  <div className="mt-auto flex justify-end gap-2">
                    <Pill onClick={() => void decideStep(perm.runId, perm.stepId, false)}><X className="w-3.5 h-3.5" />Deny</Pill>
                    {perm.always && <Pill title={`Stops asking for ${describeAllow(perm.always)}`} onClick={() => void decideStep(perm.runId, perm.stepId, true, true)}>Always Allow</Pill>}
                    <Pill primary onClick={() => void decideStep(perm.runId, perm.stepId, true)}><Check className="w-3.5 h-3.5" />Allow</Pill>
                  </div>
                </div>
              )}

              {mode === 'claude' && claude && (
                <div className="h-full relative">
                  <div className="absolute left-3 top-3"><Mascot hue={hue} mood={mood} size={28} /></div>
                  <ApprovalCard req={claude} more={agents.queue.length - 1} onAnswer={(allow) => void agents.answer(claude, allow)} />
                </div>
              )}

              {chatMounted && (
                <div className={mode === 'chat' ? 'absolute inset-0' : 'hidden'}>
                  <div className="absolute left-3 top-[7px] z-10"><Mascot hue={hue} mood={mood} size={24} /></div>
                  <IslandChat ref={chat} active={mode === 'chat'} onMood={setChatMood} onBusy={(busy, tps) => activity.put({ id: 'island-chat', kind: 'chat', label: busy ? (tps ? `${tps} tok/s` : 'Thinking') : 'Answered', done: !busy })} onClose={close} onHasContent={setHasChat} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
