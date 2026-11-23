import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { engineChoice } from '../lib/engineDefaults';
import { llamacpp } from '../services/llm';
import { DocReadError, docKind, documentText } from '../lib/docText';
import { ArrowUp, Square, Mic, Paperclip, Plus, Copy, Check, Volume2, RotateCcw, ExternalLink, X, FileText } from 'lucide-react';
import { ollamaClient, ChatTurn, fileToBase64 } from '../services/ollamaService';
import { MicRecorder, micErrorMessage } from '../lib/audio';
import { agentAvailable, runAgent } from '../lib/agent';
import { builtinsNow, refreshBuiltins } from '../lib/builtins';
import { hush, speak as speakText, transcribe } from '../voice/voice';
import { emitEvent, invokeNative } from '../lib/bus';
import { MarkdownLite, toSpeakable } from '../lib/markdownLite';
import { loadIsland, mainSettings, Mood } from './state';
import { kv } from '../lib/store';
import { useFileIntake } from '../lib/fileDrop';

interface Msg { role: 'user' | 'assistant'; content: string; error?: boolean; files?: string[]; steps?: string[]; unverified?: boolean }
interface ModelOpt { id: string; name: string }

/** The chat engine Settings → Engines picks (the island has no live settings, so it reads them). */
function chatEngine(): 'builtin' | 'ollama' | 'llamacpp' {
  return engineChoice(kv.getItem('lotus.settings.v1')).llmBackend;
}

/** Chat models of that engine: Lotus's own downloads, Ollama's list, or the user's server's list. */
async function chatModels(): Promise<ModelOpt[]> {
  const engine = chatEngine();
  if (engine === 'builtin') {
    if (!builtinsNow().loaded) await refreshBuiltins();
    return builtinsNow().models.filter((m) => m.kind === 'chat').map((m) => ({ id: m.id, name: m.title }));
  }
  if (engine === 'ollama') return (await ollamaClient.listModels()).map((m) => ({ id: m.name, name: m.name }));
  // A llama-server, LM Studio or vLLM the user runs lists its models at /v1/models (STATE #7).
  return (await llamacpp.listModels()).map((id) => ({ id, name: id }));
}
interface Attach { name: string; kind: 'text' | 'image'; data: string }

const HISTORY_KEY = 'lotus.island.chat.v1';
const MAX_TEXT_FILE = 100_000;

export interface IslandChatHandle {
  toggleDictation: () => void;
  focusInput: () => void;
  /** 0.23: ask straight away (quick buttons, copied text, a dropped file). */
  ask: (text: string, files?: File[]) => Promise<void>;
  /** 0.23: put text in the box without sending it. */
  prefill: (text: string) => void;
}

export const IslandChat = forwardRef<IslandChatHandle, {
  onMood: (m: Mood) => void;
  onBusy: (busy: boolean, tokensPerSec?: number) => void;
  onClose: () => void;
  onHasContent: (has: boolean) => void;
  /** Only the open chat takes dropped and pasted files (0.23: the island's home has its own drop zones). */
  active?: boolean;
}>(({ onMood, onBusy, onClose, onHasContent, active = true }, ref) => {
  const [msgs, setMsgs] = useState<Msg[]>(() => { try { return JSON.parse(kv.getItem(HISTORY_KEY) || '[]'); } catch { return []; } });
  const [input, setInput] = useState('');
  const [attach, setAttach] = useState<Attach[]>([]);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [models, setModels] = useState<ModelOpt[]>([]);
  const [model, setModel] = useState(() => loadIsland().model || mainSettings().model);

  const abort = useRef<AbortController | null>(null);
  const rec = useRef<MicRecorder | null>(null);
  const input$ = useRef<HTMLTextAreaElement>(null);
  const end$ = useRef<HTMLDivElement>(null);

  useEffect(() => { kv.setItem(HISTORY_KEY, JSON.stringify(msgs.slice(-30).map(({ files: _f, ...m }) => m))); onHasContent(msgs.length > 0); }, [msgs, onHasContent]);
  useEffect(() => { end$.current?.scrollIntoView({ block: 'end' }); }, [msgs]);
  useEffect(() => {
    chatModels().then((list) => {
      setModels(list);
      // A model saved for another engine (e.g. an Ollama tag after switching to Lotus's engine) can't run here.
      setModel((cur) => (list.length && !list.some((m) => m.id === cur) ? (list.find((m) => m.id === mainSettings().model)?.id ?? list[0].id) : cur));
    }).catch(() => undefined);
  }, []);
  useEffect(() => { input$.current?.focus(); }, []);
  useEffect(() => {
    onMood(recording ? 'listening' : speakingIdx !== null ? 'speaking' : busy ? 'thinking' : 'idle');
  }, [recording, speakingIdx, busy, onMood]);
  useEffect(() => () => { rec.current?.cancel(); hush(); abort.current?.abort(); }, []);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 4000); return () => clearTimeout(t); }, [notice]);

  const flash = (m: string) => setNotice(m);

  // ── Send ──────────────────────────────────────────────────────────────────
  const send = async (retryText?: string, direct?: { text: string; attach: Attach[] }) => {
    const text = (direct?.text ?? retryText ?? input).trim();
    const files = direct?.attach ?? attach;
    if ((!text && !files.length) || busy) return;
    const textFiles = files.filter((f) => f.kind === 'text').map((f) => `\n\n[${f.name}]\n\`\`\`\n${f.data}\n\`\`\``).join('');
    const content = `${text}${textFiles}`;
    const userMsg: Msg = { role: 'user', content: text || '(attached files)', files: files.map((f) => f.name) };
    const history = retryText ? msgs.slice(0, -1) : msgs;
    setMsgs([...history, ...(retryText ? [] : [userMsg]), { role: 'assistant', content: '' }]);
    if (!retryText && !direct) { setInput(''); setAttach([]); }
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
    const steps: string[] = [];
    const show = (extra: Partial<Msg> = {}) => setMsgs((cur) => [...cur.slice(0, -1), { role: 'assistant', content: acc, steps: steps.length ? [...steps] : undefined, ...extra }]);
    try {
      if (agentAvailable()) {
        // The same agent as Chat (core): whichever engine Settings → Engines picks, with tools, approvals
        // (answered on the island) and the "no step, no claim" check.
        const done = await runAgent({
          model, prompt: text, chatId: 'island',
          messages: turns.map((t) => ({ role: t.role as 'system' | 'user' | 'assistant', content: t.content, images: t.images })),
          options: { temperature: ms.temperature }, memoryOn: false,
        }, (e) => {
          if (e.kind === 'token') { acc += e.text; show(); }
          else if (e.kind === 'reset') { acc = acc.slice(0, e.keep); show(); }
          else if (e.kind === 'stats') onBusy(true, e.tokensPerSec);
          else if (e.kind === 'step' && e.step.status !== 'running' && e.step.status !== 'waiting') {
            const line = `${e.step.status === 'done' ? '✓' : '✕'} ${e.step.label}`;
            const at = steps.findIndex((x) => x.endsWith(` ${e.step.label}`) && x.startsWith('…'));
            if (at >= 0) steps[at] = line; else steps.push(line);
            show();
          } else if (e.kind === 'step' && e.step.status === 'running' && !steps.includes(`… ${e.step.label}`)) { steps.push(`… ${e.step.label}`); show(); }
        }, c.signal);
        acc = done.content || acc;
        show({ unverified: done.unverified.length > 0 || undefined });
      } else {
        for await (const tok of ollamaClient.streamChat(turns, { model, temperature: ms.temperature, signal: c.signal }, (st) => onBusy(true, st.tokensPerSec))) {
          acc += tok;
          show();
        }
      }
    } catch (e) {
      if (!c.signal.aborted) setMsgs((cur) => [...cur.slice(0, -1), { role: 'assistant', content: acc || (e as Error).message, error: !acc }]);
    } finally {
      setBusy(false); onBusy(false); abort.current = null;
    }
  };

  // ── Files ─────────────────────────────────────────────────────────────────
  const toAttach = async (list: FileList | File[]): Promise<Attach[]> => {
    const out: Attach[] = [];
    for (const f of Array.from(list)) {
      try {
        if (f.type.startsWith('image/')) out.push({ name: f.name, kind: 'image', data: await fileToBase64(f) });
        else if (docKind(f.name, f.type)) {
          const data = (await documentText(f)) ?? '';
          if (data.length > MAX_TEXT_FILE) flash(`${f.name}: too long for the island (over ${Math.round(MAX_TEXT_FILE / 1000)} K characters). Open it in Chat instead.`);
          else out.push({ name: f.name, kind: 'text', data });
        } else flash(`${f.name}: the island reads images, PDFs, Office files and text files.`);
      } catch (e) { flash(e instanceof DocReadError ? e.message : `Couldn't read ${f.name}.`); }
    }
    return out;
  };
  const addFiles = async (list: FileList | File[]) => { const a = await toAttach(list); if (a.length) setAttach((cur) => [...cur, ...a]); };
  // Drop files on the island chat, or paste them (Ctrl/Cmd+V).
  const dragOver = useFileIntake((f) => void addFiles(f), { enabled: active });

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
      const said = await transcribe(r.wav);
      if (said) setInput((cur) => `${cur}${cur && !cur.endsWith(' ') ? ' ' : ''}${said}`);
      else flash('Heard nothing. Try again a little closer to the mic.');
    } catch (e) { flash((e as Error).message); }
    finally { setTranscribing(false); input$.current?.focus(); }
  };
  useImperativeHandle(ref, () => ({
    toggleDictation,
    focusInput: () => input$.current?.focus(),
    ask: async (text, files = []) => { const a = files.length ? await toAttach(files) : []; if (files.length && !a.length) return; await send(undefined, { text, attach: a }); },
    prefill: (text) => { setInput(text); setTimeout(() => input$.current?.focus(), 30); },
  }));

  // ── Read aloud ────────────────────────────────────────────────────────────
  const speak = async (i: number) => {
    hush();
    if (speakingIdx === i) { setSpeakingIdx(null); return; }
    setSpeakingIdx(i);
    // Lotus's voice engine, Voicebox or the system voice, as Settings → Engines picks (voice/voice.ts).
    try {
      const profile = loadIsland().voiceProfileId || kv.getItem('lotus.voice.profile') || undefined;
      if (!(await speakText(toSpeakable(msgs[i].content), profile))) flash('Nothing to read aloud.');
    } catch (e) { flash((e as Error).message); }
    finally { setSpeakingIdx((cur) => (cur === i ? null : cur)); }
  };

  const lastIdx = msgs.length - 1;
  const clear = () => { abort.current?.abort(); hush(); setSpeakingIdx(null); setMsgs([]); };

  return (
    <div className="flex flex-col h-full min-h-0"
>
      {/* Header */}
      <div className="flex items-center gap-1.5 pl-14 pr-3 pt-2.5 pb-1.5">
        <select aria-label="Model" value={model} onChange={(e) => setModel(e.target.value)}
          className="max-w-[170px] bg-[var(--is-raised)] hover:bg-[var(--is-raised-hover)] text-[var(--is-text)] text-[11px] font-semibold rounded-[6px] px-2.5 h-6 outline-none appearance-none truncate">
          {(models.some((m) => m.id === model) ? models : [{ id: model, name: model }, ...models]).map((m) => <option key={m.id} value={m.id} className="text-black bg-white">{m.name}</option>)}
        </select>
        <div className="flex-1" />
        {msgs.length > 0 && (
          <>
            <HeaderBtn label="Continue in Lotus" onClick={() => { void emitEvent('chat:import', msgs.map(({ role, content }) => ({ role, content }))); void invokeNative('open_main', { view: 'chat' }); }}><ExternalLink className="w-3.5 h-3.5" /></HeaderBtn>
            <HeaderBtn label="New chat" onClick={clear}><RotateCcw className="w-3.5 h-3.5" /></HeaderBtn>
          </>
        )}
        <HeaderBtn label="Collapse" onClick={onClose}><X className="w-3.5 h-3.5" /></HeaderBtn>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2 space-y-3 text-[13px] leading-relaxed text-[var(--is-text)]" aria-live="polite">
        {msgs.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center text-[var(--is-muted)] text-xs px-6">
            <p className="font-semibold text-[var(--is-text)] text-[13px]">Ask anything</p>
            <p className="mt-1">Runs on {models.find((m) => m.id === model)?.name ?? model}, on this computer. Drop a file or image here to include it.</p>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
            <div className={m.role === 'user' ? 'max-w-[85%] rounded-2xl rounded-br-md bg-[var(--color-accent-fill)] text-white px-3 py-2' : `group max-w-full ${m.error ? 'text-[var(--is-warn)]' : ''}`}>
              {m.files?.length ? <p className="text-[11px] opacity-80 mb-1 flex items-center gap-1"><FileText className="w-3 h-3" />{m.files.join(', ')}</p> : null}
              {m.steps?.length ? <ul aria-label="Steps Lotus took" className="mb-1 space-y-0.5 text-[11px] text-[var(--is-muted)]">{m.steps.map((x, k) => <li key={k}>{x}</li>)}</ul> : null}
              {m.unverified ? <p className="mb-1 text-[11px] text-[var(--is-warn)]">This reply says Lotus did something no step shows. Check before relying on it.</p> : null}
              {m.content ? <MarkdownLite text={m.content} /> : <span className="inline-flex gap-1 py-1" aria-label="Thinking">{[0, 1, 2].map((d) => <span key={d} className="w-1.5 h-1.5 rounded-full bg-[var(--is-muted)]" style={{ animation: `lotus-dots 1.2s ${d * 0.2}s infinite` }} />)}</span>}
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
        {notice && <p role="status" className="text-[11px] text-[var(--is-warn)] px-2 pb-1.5">{notice}</p>}
        {attach.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1 pb-1.5">
            {attach.map((a) => (
              <span key={a.name} className="inline-flex items-center gap-1 bg-[var(--is-raised)] rounded-[6px] pl-2.5 pr-1 h-6 text-[11px] text-[var(--is-text)]">
                <span className="max-w-[120px] truncate">{a.name}</span>
                <button aria-label={`Remove ${a.name}`} onClick={() => setAttach((cur) => cur.filter((x) => x !== a))} className="w-4 h-4 rounded-full hover:bg-[var(--is-raised-hover)] flex items-center justify-center"><X className="w-2.5 h-2.5" /></button>
              </span>
            ))}
          </div>
        )}
        <div className={`flex items-end gap-1 rounded-[20px] bg-[var(--is-raised)] pl-1.5 pr-1.5 py-1.5 ring-1 transition-shadow ${dragOver ? 'ring-[var(--color-accent-vibrant)] ring-2' : 'ring-[var(--is-hair)] focus-within:ring-[var(--is-focus)]'}`}>
          <label className="w-8 h-8 shrink-0 rounded-full hover:bg-[var(--is-raised)] flex items-center justify-center text-[var(--is-muted)]" title="Attach a file" aria-label="Attach a file">
            <Plus className="w-[18px] h-[18px]" />
            <input type="file" multiple hidden onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ''; }} />
          </label>
          <textarea ref={input$} rows={1} value={input} aria-label="Message" placeholder={recording ? 'Listening…' : transcribing ? 'Transcribing…' : dragOver ? 'Drop to attach' : 'Message'}
            onChange={(e) => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(96, e.target.scrollHeight)}px`; }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } if (e.key === 'Escape') onClose(); }}
            className="flex-1 bg-transparent resize-none outline-none text-[13px] text-[var(--is-text)] placeholder:text-[var(--is-muted)] py-1.5 max-h-24" />
          <button onClick={toggleDictation} aria-label={recording ? 'Stop dictation' : 'Dictate'} aria-pressed={recording} disabled={transcribing}
            className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center transition-colors ${recording ? 'bg-[var(--c-red)] text-white' : 'text-[var(--is-muted)] hover:bg-[var(--is-raised)]'} disabled:opacity-40`}>
            <Mic className="w-4 h-4" />
          </button>
          {busy ? (
            <button onClick={() => abort.current?.abort()} aria-label="Stop generating" className="w-8 h-8 shrink-0 rounded-full bg-[var(--is-text)] text-[var(--is-ink)] flex items-center justify-center"><Square className="w-3 h-3" fill="currentColor" /></button>
          ) : (
            <button onClick={() => send()} disabled={!input.trim() && !attach.length} aria-label="Send"
              className="w-8 h-8 shrink-0 rounded-full bg-[var(--color-accent-fill)] text-white flex items-center justify-center disabled:opacity-30 transition-opacity"><ArrowUp className="w-4 h-4" /></button>
          )}
        </div>
      </div>
    </div>
  );
});
IslandChat.displayName = 'IslandChat';

const HeaderBtn: React.FC<{ label: string; onClick: () => void; children: React.ReactNode }> = ({ label, onClick, children }) => (
  <button onClick={onClick} title={label} aria-label={label}
    className="w-6 h-6 rounded-full flex items-center justify-center text-[var(--is-muted)] hover:text-[var(--is-text)] hover:bg-[var(--is-raised)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--is-focus)]">{children}</button>
);
