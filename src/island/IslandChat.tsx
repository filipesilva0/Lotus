import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ArrowUp, Square, Mic, Paperclip, Copy, Check, Volume2, RotateCcw, ExternalLink, X, FileText } from 'lucide-react';
import { ollamaClient, ChatTurn, fileToBase64 } from '../services/ollamaService';
import { voicebox } from '../services/voicebox';
import { MicRecorder, micErrorMessage } from '../lib/audio';
import { emitEvent, invokeNative } from '../lib/bus';
import { MarkdownLite, toSpeakable } from '../lib/markdownLite';
import { loadIsland, mainSettings, Mood } from './state';

interface Msg { role: 'user' | 'assistant'; content: string; error?: boolean; files?: string[] }
interface Attach { name: string; kind: 'text' | 'image'; data: string }

const HISTORY_KEY = 'tomo.island.chat.v1';
const MAX_TEXT_FILE = 100_000;

export interface IslandChatHandle { toggleDictation: () => void; focusInput: () => void }

export const IslandChat = forwardRef<IslandChatHandle, {
  onMood: (m: Mood) => void;
  onBusy: (busy: boolean, tokensPerSec?: number) => void;
  onClose: () => void;
  onHasContent: (has: boolean) => void;
}>(({ onMood, onBusy, onClose, onHasContent }, ref) => {
  const [msgs, setMsgs] = useState<Msg[]>(() => { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; } });
  const [input, setInput] = useState('');
  const [attach, setAttach] = useState<Attach[]>([]);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState(() => loadIsland().model || mainSettings().model);

  const abort = useRef<AbortController | null>(null);
  const rec = useRef<MicRecorder | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const input$ = useRef<HTMLTextAreaElement>(null);
  const end$ = useRef<HTMLDivElement>(null);

  useEffect(() => { localStorage.setItem(HISTORY_KEY, JSON.stringify(msgs.slice(-30).map(({ files: _f, ...m }) => m))); onHasContent(msgs.length > 0); }, [msgs, onHasContent]);
  useEffect(() => { end$.current?.scrollIntoView({ block: 'end' }); }, [msgs]);
  useEffect(() => { ollamaClient.listModels().then((m) => setModels(m.map((x) => x.name))).catch(() => undefined); }, []);
  useEffect(() => { input$.current?.focus(); }, []);
  useEffect(() => {
    onMood(recording ? 'listening' : speakingIdx !== null ? 'speaking' : busy ? 'thinking' : 'idle');
  }, [recording, speakingIdx, busy, onMood]);
  useEffect(() => () => { rec.current?.cancel(); audio.current?.pause(); abort.current?.abort(); }, []);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 4000); return () => clearTimeout(t); }, [notice]);

  const flash = (m: string) => setNotice(m);

  // ── Send ──────────────────────────────────────────────────────────────────
  const send = async (retryText?: string) => {
    const text = (retryText ?? input).trim();
    if ((!text && !attach.length) || busy) return;
    const files = attach;
    const textFiles = files.filter((f) => f.kind === 'text').map((f) => `\n\n[${f.name}]\n\`\`\`\n${f.data}\n\`\`\``).join('');
    const content = `${text}${textFiles}`;
    const userMsg: Msg = { role: 'user', content: text || '(attached files)', files: files.map((f) => f.name) };
    const history = retryText ? msgs.slice(0, -1) : msgs;
    setMsgs([...history, ...(retryText ? [] : [userMsg]), { role: 'assistant', content: '' }]);
    if (!retryText) { setInput(''); setAttach([]); }
    setBusy(true);

    const ms = mainSettings();
    const turns: ChatTurn[] = [
      { role: 'system', content: `${ms.systemPrompt}\nYou are replying inside a small floating panel: keep answers short unless asked for detail.` },
      ...history.filter((m) => !m.error).slice(-12).map((m) => ({ role: m.role, content: m.content }) as ChatTurn),
      { role: 'user', content, images: files.filter((f) => f.kind === 'image').map((f) => f.data) },
    ];
    const c = new AbortController();
    abort.current = c;
    let acc = '';
    try {
      for await (const tok of ollamaClient.streamChat(turns, { model, temperature: ms.temperature, signal: c.signal }, (s) => onBusy(true, s.tokensPerSec))) {
        acc += tok;
        setMsgs((cur) => [...cur.slice(0, -1), { role: 'assistant', content: acc }]);
      }
    } catch (e) {
      if (!c.signal.aborted) setMsgs((cur) => [...cur.slice(0, -1), { role: 'assistant', content: acc || (e as Error).message, error: !acc }]);
    } finally {
      setBusy(false); onBusy(false); abort.current = null;
    }
  };

  // ── Files ─────────────────────────────────────────────────────────────────
  const addFiles = async (list: FileList | File[]) => {
    for (const f of Array.from(list)) {
      try {
        if (f.type.startsWith('image/')) {
          const data = await fileToBase64(f);
          setAttach((a) => [...a, { name: f.name, kind: 'image', data }]);
        } else if (f.size <= MAX_TEXT_FILE && (f.type.startsWith('text/') || /\.(md|json|csv|log|ts|tsx|js|jsx|py|rs|go|java|c|cpp|h|cs|sql|yml|yaml|toml|xml|html|css|sh|bat|ps1)$/i.test(f.name))) {
          const data = await f.text();
          setAttach((a) => [...a, { name: f.name, kind: 'text', data }]);
        } else flash(`${f.name}: only images and text files up to 100 KB are supported.`);
      } catch { flash(`Couldn't read ${f.name}.`); }
    }
  };

  // ── Dictation ─────────────────────────────────────────────────────────────
  const toggleDictation = async () => {
    if (transcribing) return;
    if (!recording) {
      try { rec.current = new MicRecorder(); await rec.current.start(); setRecording(true); }
      catch (e) { flash(micErrorMessage(e)); }
      return;
    }
    setRecording(false); setTranscribing(true);
    try {
      const r = await rec.current!.stop();
      const t = await voicebox.transcribe(r.wav);
      if (t.text.trim()) setInput((cur) => `${cur}${cur && !cur.endsWith(' ') ? ' ' : ''}${t.text.trim()}`);
      else flash('Heard nothing. Try again a little closer to the mic.');
    } catch (e) { flash((e as Error).message); }
    finally { setTranscribing(false); input$.current?.focus(); }
  };
  useImperativeHandle(ref, () => ({ toggleDictation, focusInput: () => input$.current?.focus() }));

  // ── Read aloud ────────────────────────────────────────────────────────────
  const speak = async (i: number) => {
    if (speakingIdx === i) { audio.current?.pause(); setSpeakingIdx(null); return; }
    audio.current?.pause();
    setSpeakingIdx(i);
    try {
      const profile = loadIsland().voiceProfileId || localStorage.getItem('tomo.voice.profile') || undefined;
      const q = await voicebox.speak(toSpeakable(msgs[i].content), { profile });
      const done = await voicebox.waitFor(q.id);
      const a = new Audio(await voicebox.audioUrl(done.id));
      audio.current = a;
      a.onended = () => setSpeakingIdx(null);
      await a.play();
    } catch (e) { setSpeakingIdx(null); flash((e as Error).message); }
  };

  const lastIdx = msgs.length - 1;
  const clear = () => { abort.current?.abort(); audio.current?.pause(); setSpeakingIdx(null); setMsgs([]); };

  return (
    <div className="flex flex-col h-full min-h-0"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); void addFiles(e.dataTransfer.files); }}>
      {/* Header */}
      <div className="flex items-center gap-1.5 pl-14 pr-3 pt-2.5 pb-1.5">
        <select aria-label="Model" value={model} onChange={(e) => setModel(e.target.value)}
          className="max-w-[170px] bg-white/10 hover:bg-white/15 text-white/90 text-[11px] font-semibold rounded-full px-2.5 h-6 outline-none appearance-none cursor-pointer truncate">
          {[...new Set([model, ...models])].map((m) => <option key={m} value={m} className="text-black">{m}</option>)}
        </select>
        <div className="flex-1" />
        {msgs.length > 0 && (
          <>
            <HeaderBtn label="Continue in Tomo" onClick={() => { void emitEvent('chat:import', msgs.map(({ role, content }) => ({ role, content }))); void invokeNative('open_main', { view: 'chat' }); }}><ExternalLink className="w-3.5 h-3.5" /></HeaderBtn>
            <HeaderBtn label="New chat" onClick={clear}><RotateCcw className="w-3.5 h-3.5" /></HeaderBtn>
          </>
        )}
        <HeaderBtn label="Collapse" onClick={onClose}><X className="w-3.5 h-3.5" /></HeaderBtn>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2 space-y-3 text-[13px] leading-relaxed text-white/90" aria-live="polite">
        {msgs.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center text-white/50 text-xs px-6">
            <p className="font-semibold text-white/80 text-[13px]">Ask anything</p>
            <p className="mt-1">Runs on {model}, on this PC. Drop a file or image here to include it.</p>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
            <div className={m.role === 'user' ? 'max-w-[85%] rounded-2xl rounded-br-md bg-[var(--color-accent-vibrant)] text-white px-3 py-2' : `group max-w-full ${m.error ? 'text-amber-300' : ''}`}>
              {m.files?.length ? <p className="text-[11px] opacity-80 mb-1 flex items-center gap-1"><FileText className="w-3 h-3" />{m.files.join(', ')}</p> : null}
              {m.content ? <MarkdownLite text={m.content} /> : <span className="inline-flex gap-1 py-1" aria-label="Thinking">{[0, 1, 2].map((d) => <span key={d} className="w-1.5 h-1.5 rounded-full bg-white/50" style={{ animation: `tomo-dots 1.2s ${d * 0.2}s infinite` }} />)}</span>}
              {m.role === 'assistant' && m.content && !m.error && !(busy && i === lastIdx) && (
                <div className="flex gap-0.5 mt-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <HeaderBtn label={copied === i ? 'Copied' : 'Copy'} onClick={() => { void navigator.clipboard.writeText(m.content); setCopied(i); setTimeout(() => setCopied(null), 1200); }}>{copied === i ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}</HeaderBtn>
                  <HeaderBtn label={speakingIdx === i ? 'Stop' : 'Read aloud'} onClick={() => speak(i)}>{speakingIdx === i ? <Square className="w-3 h-3" fill="currentColor" /> : <Volume2 className="w-3.5 h-3.5" />}</HeaderBtn>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={end$} />
      </div>

      {/* Composer */}
      <div className="px-3 pb-3 pt-1">
        {notice && <p role="status" className="text-[11px] text-amber-300 px-2 pb-1.5">{notice}</p>}
        {attach.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1 pb-1.5">
            {attach.map((a) => (
              <span key={a.name} className="inline-flex items-center gap-1 bg-white/10 rounded-full pl-2.5 pr-1 h-6 text-[11px] text-white/80">
                <span className="max-w-[120px] truncate">{a.name}</span>
                <button aria-label={`Remove ${a.name}`} onClick={() => setAttach((cur) => cur.filter((x) => x !== a))} className="w-4 h-4 rounded-full hover:bg-white/15 flex items-center justify-center"><X className="w-2.5 h-2.5" /></button>
              </span>
            ))}
          </div>
        )}
        <div className={`flex items-end gap-1 rounded-[20px] bg-white/10 pl-2 pr-1.5 py-1.5 ring-1 transition-shadow ${dragOver ? 'ring-[var(--color-accent-vibrant)] ring-2' : 'ring-white/10 focus-within:ring-white/30'}`}>
          <label className="w-8 h-8 shrink-0 rounded-full hover:bg-white/10 flex items-center justify-center text-white/60 cursor-pointer" title="Attach a file" aria-label="Attach a file">
            <Paperclip className="w-4 h-4" />
            <input type="file" multiple hidden onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ''; }} />
          </label>
          <textarea ref={input$} rows={1} value={input} aria-label="Message" placeholder={recording ? 'Listening…' : transcribing ? 'Transcribing…' : dragOver ? 'Drop to attach' : 'Message'}
            onChange={(e) => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(96, e.target.scrollHeight)}px`; }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } if (e.key === 'Escape') onClose(); }}
            className="flex-1 bg-transparent resize-none outline-none text-[13px] text-white placeholder:text-white/40 py-1.5 max-h-24" />
          <button onClick={toggleDictation} aria-label={recording ? 'Stop dictation' : 'Dictate'} aria-pressed={recording} disabled={transcribing}
            className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center transition-colors ${recording ? 'bg-rose-500 text-white' : 'text-white/60 hover:bg-white/10'} disabled:opacity-40`}>
            <Mic className="w-4 h-4" />
          </button>
          {busy ? (
            <button onClick={() => abort.current?.abort()} aria-label="Stop generating" className="w-8 h-8 shrink-0 rounded-full bg-white text-black flex items-center justify-center"><Square className="w-3 h-3" fill="currentColor" /></button>
          ) : (
            <button onClick={() => send()} disabled={!input.trim() && !attach.length} aria-label="Send"
              className="w-8 h-8 shrink-0 rounded-full bg-[var(--color-accent-vibrant)] text-white flex items-center justify-center disabled:opacity-30 transition-opacity"><ArrowUp className="w-4 h-4" /></button>
          )}
        </div>
      </div>
    </div>
  );
});
IslandChat.displayName = 'IslandChat';

const HeaderBtn: React.FC<{ label: string; onClick: () => void; children: React.ReactNode }> = ({ label, onClick, children }) => (
  <button onClick={onClick} title={label} aria-label={label}
    className="w-6 h-6 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50">{children}</button>
);
