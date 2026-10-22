import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, Mic, Volume2, LayoutGrid, Image as ImageIcon, AudioLines, Download, Bot, FlaskConical } from 'lucide-react';
import { invokeNative, onEvent } from '../lib/bus';
import { voicebox } from '../services/voicebox';
import { applyThemeToDocument } from '../styles/theme';
import { Mascot } from './Mascot';
import { IslandChat, IslandChatHandle } from './IslandChat';
import { ApprovalCard } from './ApprovalCard';
import { useActivity, useAgents, useEngineStatus } from './hooks';
import { Activity, IslandView, Mood, loadIsland, mainSettings } from './state';

const ease = 'cubic-bezier(.32,.72,0,1)';

export const Island: React.FC = () => {
  const [settings, setSettings] = useState(loadIsland);
  const [view, setView] = useState<IslandView>('strip');
  const [visible, setVisible] = useState(settings.enabled);
  const [chatMounted, setChatMounted] = useState(false);
  const [hasChat, setHasChat] = useState(false);
  const [chatMood, setChatMood] = useState<Mood>('idle');
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const [toast, setToast] = useState<string | null>(null);

  const engines = useEngineStatus();
  const activity = useActivity();
  const agents = useAgents(settings.agents);
  const chat = useRef<IslandChatHandle>(null);
  const hover = useRef(0);
  const blurT = useRef(0);
  const returnView = useRef<IslandView>('strip');
  const forcedShow = useRef(false);

  // Settings are edited in the main window; the two windows share localStorage.
  useEffect(() => {
    const sync = (e: StorageEvent) => {
      if (e.key !== 'lotus.island.v1') return;
      const next = loadIsland();
      setSettings(next);
      setVisible(next.enabled);
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  // Accent colour follows the main window's palette; the island itself is always dark.
  useEffect(() => {
    const apply = () => applyThemeToDocument(mainSettings().palette as never, 'jakarta', 'md', true);
    apply();
    window.addEventListener('storage', apply);
    return () => window.removeEventListener('storage', apply);
  }, []);

  // ── View transitions ──────────────────────────────────────────────────────
  const openChat = useCallback(() => {
    setChatMounted(true);
    setView('chat');
    void invokeNative('island_focus');
    setTimeout(() => chat.current?.focusInput(), 80);
  }, []);
  const collapse = useCallback(() => { setView((v) => (v === 'approval' ? v : 'strip')); }, []);

  useEffect(() => {
    const offs: (() => void)[] = [];
    void onEvent('island:toggle', () => setVisible((v) => !v)).then((u) => offs.push(u));
    void onEvent('island:open-chat', () => { setVisible(true); openChat(); }).then((u) => offs.push(u));
    void onEvent('island:dictate', () => { setVisible(true); openChat(); setTimeout(() => chat.current?.toggleDictation(), 120); }).then((u) => offs.push(u));
    return () => offs.forEach((o) => o());
  }, [openChat]);

  useEffect(() => { void invokeNative(visible ? 'island_show' : 'island_hide'); }, [visible]);

  // A permission prompt always wins, and must be visible even if the island is switched off.
  const pending = agents.queue[0];
  useEffect(() => {
    if (pending && view !== 'approval') {
      returnView.current = view;
      setView('approval');
      if (!visible) { forcedShow.current = true; setVisible(true); }
    } else if (!pending && view === 'approval') {
      setView(returnView.current === 'approval' ? 'strip' : returnView.current);
      if (forcedShow.current) { forcedShow.current = false; setVisible(false); }
    }
  }, [pending, view, visible]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && view !== 'approval') collapse(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [view, collapse]);

  // Collapse the chat a few seconds after you click away (unless it's busy).
  useEffect(() => {
    const onBlur = () => {
      if (view !== 'chat' || !settings.autoCollapse) return;
      blurT.current = window.setTimeout(() => { if (!busyRef.current) collapse(); }, 8000);
    };
    const onFocus = () => clearTimeout(blurT.current);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => { window.removeEventListener('blur', onBlur); window.removeEventListener('focus', onFocus); clearTimeout(blurT.current); };
  }, [view, settings.autoCollapse, collapse]);

  const busyRef = useRef(false);
  const onChatBusy = useCallback((busy: boolean, tps?: number) => {
    busyRef.current = busy;
    activity.put({ id: 'island-chat', kind: 'chat', label: tps ? `${tps} tok/s` : 'Thinking', done: !busy });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Pills ─────────────────────────────────────────────────────────────────
  const agentPills: Activity[] = agents.sessions
    .filter((s) => s.state === 'working' || s.state === 'waiting' || s.state === 'done')
    .map((s) => ({ id: `agent-${s.id}`, kind: 'chat', label: s.state === 'done' ? `${s.project} done` : s.state === 'waiting' ? `${s.project} waiting` : s.project, done: s.state === 'done' }));
  const pills = [...activity.items.filter((a) => view !== 'chat' || a.id !== 'island-chat'), ...agentPills];
  const shown = pills.slice(0, 2);

  const anyWorking = activity.items.some((a) => !a.done) || agents.sessions.some((s) => s.state === 'working');
  const justDone = pills.some((p) => p.done);
  const allDown = engines.ollama === false && engines.voicebox === false && engines.comfyui === false;
  const mood: Mood = pending ? 'alert' : view === 'chat' ? chatMood : anyWorking ? 'thinking' : justDone ? 'happy' : allDown ? 'sleep' : 'idle';

  // ── Window size follows the target dimensions ─────────────────────────────
  const dims = useMemo(() => {
    if (view === 'chat') return { w: 460, h: hasChat ? 500 : 214, r: 28 };
    if (view === 'approval') return { w: 480, h: 236, r: 26 };
    if (view === 'peek') return { w: Math.max(340, 120 + shown.length * 100), h: 96, r: 26 };
    return { w: 56 + 44 + shown.length * 100 + 12, h: 36, r: 18 };
  }, [view, hasChat, shown.length]);

  const prev = useRef({ w: 0, h: 0 });
  useEffect(() => {
    const p = prev.current;
    // Grow the native window first so the content has room; shrink it after the animation.
    void invokeNative('island_resize', { width: Math.max(p.w, dims.w), height: Math.max(p.h, dims.h) });
    const t = setTimeout(() => void invokeNative('island_resize', { width: dims.w, height: dims.h }), 340);
    prev.current = { w: dims.w, h: dims.h };
    return () => clearTimeout(t);
  }, [dims.w, dims.h]);

  // ── Peek actions ──────────────────────────────────────────────────────────
  const say = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); };
  const speakClipboard = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) return say('The clipboard is empty.');
      const profile = loadIsland().voiceProfileId || localStorage.getItem('lotus.voice.profile') || undefined;
      say('Reading aloud…');
      const q = await voicebox.speak(text.slice(0, 4000), { profile });
      const done = await voicebox.waitFor(q.id);
      await new Audio(await voicebox.audioUrl(done.id)).play();
      setToast(null);
    } catch (e) { say((e as Error).message); }
  };

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setGaze({ x: Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2)), y: Math.max(-1, Math.min(1, ((e.clientY - r.top) / Math.max(r.height, 60) - 0.5) * 2)) });
  };

  const dot = (up: boolean | null, label: string) => (
    <span key={label} title={`${label}: ${up === null ? 'checking' : up ? 'running' : 'stopped'}`}
      className={`w-1.5 h-1.5 rounded-full ${up === null ? 'bg-white/25' : up ? 'bg-emerald-400' : 'bg-white/25'}`} />
  );

  const Chip: React.FC<{ a: Activity }> = ({ a }) => (
    <span className="inline-flex items-center gap-1.5 h-6 w-[92px] px-2 rounded-full bg-white/10 text-[11px] font-semibold text-white/90" title={a.label}>
      {a.kind === 'image' ? <ImageIcon className="w-3 h-3 shrink-0" /> : a.kind === 'voice' ? <AudioLines className="w-3 h-3 shrink-0" /> : a.kind === 'download' ? <Download className="w-3 h-3 shrink-0" /> : a.kind === 'research' ? <FlaskConical className="w-3 h-3 shrink-0" /> : a.id.startsWith('agent') ? <Bot className="w-3 h-3 shrink-0" /> : <MessageSquare className="w-3 h-3 shrink-0" />}
      <span className="truncate">{a.progress != null && !a.done ? `${Math.round(a.progress * 100)}%` : a.label}</span>
    </span>
  );

  const cls = (v: IslandView) => `absolute inset-0 transition-opacity duration-200 ${view === v ? 'opacity-100' : 'opacity-0 pointer-events-none'}`;

  return (
    <div className="w-screen h-screen flex justify-center items-start select-none overflow-hidden">
      {visible && (
        <div
          onPointerEnter={() => { if (view === 'strip') { clearTimeout(hover.current); hover.current = window.setTimeout(() => setView('peek'), 140); } }}
          onPointerLeave={() => { clearTimeout(hover.current); if (view === 'peek') hover.current = window.setTimeout(() => setView('strip'), 450); }}
          onPointerMove={onMove}
          role="region" aria-label="Lotus island"
          className="relative bg-black text-white overflow-hidden ring-1 ring-white/10 shadow-[0_10px_34px_rgba(0,0,0,.5)]"
          style={{ width: dims.w, height: dims.h, borderRadius: dims.r, transition: `width .34s ${ease}, height .34s ${ease}, border-radius .34s ${ease}` }}>

          {/* Mascot sits in the top-left corner in every view */}
          <div className="absolute left-3 top-[6px] z-10"><Mascot mood={mood} size={24} gaze={gaze} /></div>

          {/* strip + peek header */}
          <div className={cls('strip')} inert={view !== 'strip'}>
            <div className="h-9 pl-12 pr-3 flex items-center gap-2">
              <span className="flex items-center gap-1" aria-label="Engine status">{dot(engines.ollama, 'Ollama')}{dot(engines.voicebox, 'Voicebox')}{dot(engines.comfyui, 'ComfyUI')}</span>
              {shown.map((a) => <Chip key={a.id} a={a} />)}
            </div>
          </div>

          <div className={cls('peek')} inert={view !== 'peek'}>
            <div className="h-9 pl-12 pr-3 flex items-center gap-2">
              <span className="flex items-center gap-1" aria-label="Engine status">{dot(engines.ollama, 'Ollama')}{dot(engines.voicebox, 'Voicebox')}{dot(engines.comfyui, 'ComfyUI')}</span>
              {shown.map((a) => <Chip key={a.id} a={a} />)}
              {toast && <span role="status" className="text-[11px] text-amber-300 truncate flex-1 text-right">{toast}</span>}
            </div>
            <div className="px-3 pb-2.5 grid grid-cols-4 gap-1.5">
              {[
                { l: 'Chat', i: <MessageSquare className="w-4 h-4" />, f: openChat },
                { l: 'Dictate', i: <Mic className="w-4 h-4" />, f: () => { openChat(); setTimeout(() => chat.current?.toggleDictation(), 150); } },
                { l: 'Read clipboard', i: <Volume2 className="w-4 h-4" />, f: speakClipboard },
                { l: 'Open Lotus', i: <LayoutGrid className="w-4 h-4" />, f: () => void invokeNative('open_main', {}) },
              ].map((b) => (
                <button key={b.l} onClick={b.f} title={b.l} aria-label={b.l}
                  className="h-11 rounded-[14px] bg-white/[.07] hover:bg-white/15 flex flex-col items-center justify-center gap-0.5 text-white/80 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
                  {b.i}<span className="text-[10px] font-semibold">{b.l === 'Read clipboard' ? 'Read aloud' : b.l}</span>
                </button>
              ))}
            </div>
          </div>

          {chatMounted && (
            <div className={cls('chat')} inert={view !== 'chat'}>
              <IslandChat ref={chat} onMood={setChatMood} onBusy={onChatBusy} onClose={collapse} onHasContent={setHasChat} />
            </div>
          )}

          <div className={cls('approval')} inert={view !== 'approval'}>
            {pending && <ApprovalCard req={pending} more={agents.queue.length - 1} onAnswer={(allow) => void agents.answer(pending, allow)} />}
          </div>
        </div>
      )}
    </div>
  );
};
