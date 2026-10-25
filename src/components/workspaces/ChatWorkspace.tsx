import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Paperclip,
  Mic,
  MicOff,
  Copy,
  Check,
  ChevronDown,
  Sparkles,
  Bot,
  User,
  Plus,
  Trash2,
  X,
  Activity,
  Square,
} from 'lucide-react';
import { ChatSession } from '../../types/lotus';
import { voicebox } from '../../services/voicebox';
import { engineUrl } from '../../services/engineConfig';
import { MicRecorder, micErrorMessage } from '../../lib/audio';

export interface ModelOption { id: string; name: string; tag: string }

interface ChatWorkspaceProps {
  sessions: ChatSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onSendMessage: (text: string, file?: File) => void;
  onDeleteSession: (id: string) => void;
  isStreaming: boolean;
  selectedModel: string;
  onSelectModel: (model: string) => void;
  models: ModelOption[];
  ollamaUp: boolean | null;
  onStop: () => void;
  onOpenEngines: () => void;
  /** Text sent in from the island or the Dictate tab. `nonce` changes on every send. */
  prefill?: { text: string; nonce: number } | null;
}

export const ChatWorkspace: React.FC<ChatWorkspaceProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onSendMessage,
  onDeleteSession,
  isStreaming,
  selectedModel,
  onSelectModel,
  models,
  ollamaUp,
  onStop,
  onOpenEngines,
  prefill,
}) => {
  const [inputText, setInputText] = useState('');
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const recorder = useRef<MicRecorder | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (prefill?.text) setInputText((prev) => (prev ? `${prev} ${prefill.text}` : prefill.text));
  }, [prefill?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => recorder.current?.cancel(), []);

  const activeSession =
    sessions.find((s) => s.id === activeSessionId) || sessions[0];
  const lastTps = [...(activeSession?.messages ?? [])].reverse().find((m) => m.role === 'assistant' && m.tokensPerSec)?.tokensPerSec ?? 0;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession?.messages, isStreaming]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setAttachedFile(file);
      const url = URL.createObjectURL(file);
      setFilePreview(url);
    }
  };

  const removeAttachment = () => {
    setAttachedFile(null);
    setFilePreview(null);
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() && !attachedFile) return;
    onSendMessage(inputText, attachedFile || undefined);
    setInputText('');
    removeAttachment();
  };

  // Dictation runs Whisper locally through Voicebox; no audio leaves this PC.
  const toggleRecording = async () => {
    setMicError(null);
    if (isTranscribing) return;
    if (!isRecording) {
      try {
        recorder.current = new MicRecorder();
        await recorder.current.start();
        setIsRecording(true);
      } catch (e) {
        setMicError(micErrorMessage(e));
      }
      return;
    }
    setIsRecording(false);
    setIsTranscribing(true);
    try {
      const r = await recorder.current!.stop();
      const t = await voicebox.transcribe(r.wav);
      if (t.text.trim()) setInputText((prev) => (prev ? `${prev} ${t.text.trim()}` : t.text.trim()));
      else setMicError('Heard nothing. Try again a little closer to the mic.');
    } catch (e) {
      setMicError((e as Error).message);
    } finally {
      setIsTranscribing(false);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const availableModels = models;

  return (
    <div className="flex-1 flex flex-col md:flex-row h-full min-h-[580px] bg-[var(--color-bg-panel)] overflow-hidden select-none">
      {/* Session List Sidebar */}
      <div className="w-full md:w-64 border-b md:border-b-0 md:border-r border-[var(--color-border-subtle)] p-4 flex flex-col justify-between shrink-0 bg-[var(--color-bg-sidebar)]">
        <div>
          <div className="flex items-center justify-between mb-3 px-1">
            <span className="text-xs font-semibold text-[var(--color-text-main)] uppercase tracking-wider">
              Conversations
            </span>
            <button
              onClick={onNewSession}
              className="p-1 rounded-[6px] bg-[var(--color-accent-vibrant)] text-white hover:brightness-110 active:scale-95 transition-all "
              title="New Chat Session"
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
            </button>
          </div>

          <div className="space-y-1.5 overflow-y-auto max-h-[420px] pr-1 no-scrollbar">
            {sessions.map((s) => {
              const isActive = s.id === activeSession?.id;
              return (
                <div
                  key={s.id}
                  onClick={() => onSelectSession(s.id)}
                  className={`group flex items-center justify-between p-2.5 rounded-[10px] cursor-pointer transition-all border ${
                    isActive
                      ? 'bg-[var(--color-accent-pastel)] border-[var(--color-accent-pastel-border)] text-[var(--color-accent-vibrant)] font-semibold '
                      : 'border-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-bg-card)] dark:hover:bg-[#282B34] hover:text-[var(--color-text-main)]'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs truncate">{s.title}</p>
                    <p className="text-xs opacity-70 font-normal">
                      {[s.category || 'Local AI', s.modelTag || s.model].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {sessions.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteSession(s.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-[var(--c-red)] hover:text-rose-600 transition-opacity"
                      title="Delete chat"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Engine status indicator */}
        <div className="pt-3 border-t border-[var(--color-border-subtle)] text-xs text-[var(--color-text-muted)] flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${ollamaUp ? 'bg-[var(--c-green)]' : ollamaUp === null ? 'bg-[var(--c-orange)] animate-pulse' : 'bg-[var(--c-red)]'}`} />
            <span className="font-semibold text-[var(--color-text-main)]">{ollamaUp ? 'Ollama running' : ollamaUp === null ? 'Connecting…' : 'Ollama stopped'}</span>
          </div>
          <span className="tabular-nums font-mono text-xs">{engineUrl('ollama').replace('http://', '')}</span>
        </div>
      </div>

      {/* Main Chat Thread */}
      <div className="flex-1 flex flex-col justify-between h-full bg-[var(--color-bg-panel)]">
        {/* Header with Model Selector */}
        <div className="h-14 px-6 border-b border-[var(--color-border-subtle)] flex items-center justify-between">
          {/* Model Selector Pill */}
          <div className="relative">
            <button
              onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
              className="h-8 px-3.5 bg-[var(--color-accent-pastel)] border border-[var(--color-accent-pastel-border)] hover:brightness-95 rounded-[6px] flex items-center gap-2 text-xs font-semibold text-[var(--color-accent-vibrant)] transition-all "
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{selectedModel}</span>
              <ChevronDown className="w-3 h-3 opacity-70" />
            </button>

            {modelDropdownOpen && (
              <div className="absolute top-10 left-0 z-30 w-64 bg-[var(--color-bg-card)] rounded-[10px] shadow-xl border border-[var(--color-accent-pastel-border)] dark:border-[var(--color-border-subtle)] p-1.5 space-y-1">
                {availableModels.length === 0 && (
                  <div className="p-3 text-xs text-[var(--color-text-muted)] leading-relaxed">
                    No models installed yet.
                    <button onClick={onOpenEngines} className="block mt-1 font-semibold text-[var(--color-accent-vibrant)] hover:underline">Pull one from Engines</button>
                  </div>
                )}
                {availableModels.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      onSelectModel(m.id);
                      setModelDropdownOpen(false);
                    }}
                    className={`w-full text-left p-2 rounded-[6px] text-xs flex flex-col transition-colors ${
                      selectedModel === m.id
                        ? 'bg-[var(--color-accent-vibrant)] text-white'
                        : 'hover:bg-[var(--color-accent-pastel)] text-[var(--color-text-main)]'
                    }`}
                  >
                    <span className="font-semibold">{m.name}</span>
                    <span className="text-xs opacity-80">{m.tag}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Speed of the latest reply in this conversation (hidden until there is one) */}
          {lastTps > 0 && (
            <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]" title="Speed of the latest reply">
              <Activity className="w-3.5 h-3.5 text-[var(--c-green)]" />
              <span className="tabular-nums font-semibold px-2 py-0.5 rounded-[6px] bg-[var(--color-badge-bg)] text-[var(--color-badge-text)] text-xs">
                {lastTps} tok/s
              </span>
            </div>
          )}
        </div>

        {/* Message Log */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {activeSession?.messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 ${
                msg.role === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              {msg.role !== 'user' && (
                <div className="w-7 h-7 rounded-full bg-[var(--color-accent-pastel)] border border-[var(--color-accent-pastel-border)] flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="w-3.5 h-3.5 text-[var(--color-accent-vibrant)]" />
                </div>
              )}

              <div
                className={`max-w-[78%] rounded-[10px] p-4 text-sm leading-relaxed group relative  ${
                  msg.role === 'user'
                    ? 'bg-[var(--color-accent-vibrant)] text-white rounded-br-sm'
                    : 'bg-[var(--color-accent-pastel)] dark:bg-[#22242B] text-[var(--color-text-main)] rounded-bl-sm border border-[var(--color-accent-pastel-border)] dark:border-[var(--color-border-subtle)]'
                }`}
              >
                {/* Image attachment preview if present */}
                {msg.attachment && (
                  <div className="mb-2 rounded-[10px] overflow-hidden max-w-[240px]">
                    <img
                      src={msg.attachment.url}
                      alt={msg.attachment.name}
                      className="w-full object-cover"
                    />
                  </div>
                )}

                <div className="whitespace-pre-wrap">{msg.content}</div>

                {/* Tokens per sec footer */}
                {msg.tokensPerSec ? (
                  <div className="mt-2 pt-2 border-t border-[var(--sep)] flex items-center justify-between text-xs text-[var(--color-text-muted)]">
                    <span>Local VRAM inference</span>
                    <span className="tabular-nums font-medium">
                      {msg.tokensPerSec} tok/s · {msg.durationMs}ms
                    </span>
                  </div>
                ) : null}

                {/* Copy button */}
                <button
                  onClick={() => copyToClipboard(msg.content, msg.id)}
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 rounded-[6px] bg-black/10 dark:bg-white/10 hover:bg-black/20 text-current transition-opacity"
                  title="Copy message"
                >
                  {copiedId === msg.id ? (
                    <Check className="w-3 h-3 text-[var(--c-green)]" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                </button>
              </div>

              {msg.role === 'user' && (
                <div className="w-7 h-7 rounded-full bg-[var(--color-accent-vibrant)] text-white flex items-center justify-center shrink-0 mt-0.5 ">
                  <User className="w-3.5 h-3.5" />
                </div>
              )}
            </div>
          ))}

          {isStreaming && (
            <div className="flex gap-3 items-center text-xs text-[var(--color-text-muted)] animate-pulse">
              <div className="w-7 h-7 rounded-full bg-[var(--color-accent-pastel)] border border-[var(--color-accent-pastel-border)] flex items-center justify-center shrink-0">
                <Bot className="w-3.5 h-3.5 text-[var(--color-accent-vibrant)]" />
              </div>
              <span>Generating on your GPU…</span>
              <button onClick={onStop} className="ml-1 h-6 px-2.5 rounded-[6px] bg-black/5 dark:bg-white/10 text-xs font-semibold text-[var(--color-text-main)] hover:bg-black/10 dark:hover:bg-white/15 not-italic">Stop</button>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Composer Box */}
        <div className="p-4 border-t border-[var(--color-border-subtle)]">
          {/* File Attachment Pill */}
          {filePreview && (
            <div className="mb-2 flex items-center gap-2 p-1.5 pl-3 bg-[var(--color-accent-pastel)] border border-[var(--color-accent-pastel-border)] rounded-[6px] w-fit max-w-sm">
              <img
                src={filePreview}
                alt="Upload preview"
                className="w-5 h-5 rounded-full object-cover"
              />
              <span className="text-xs font-medium text-[var(--color-accent-vibrant)] truncate">
                {attachedFile?.name}
              </span>
              <button
                onClick={removeAttachment}
                className="p-1 rounded-[6px] hover:bg-black/10 dark:hover:bg-white/10"
              >
                <X className="w-3 h-3 text-[var(--color-text-muted)]" />
              </button>
            </div>
          )}

          {micError && <p role="alert" className="mb-2 px-3 text-xs text-[var(--c-red)]">{micError}</p>}
          <form
            onSubmit={handleSend}
            className="flex items-center gap-2 bg-[var(--color-bg-sidebar)] rounded-[6px] p-2 pl-4 border border-[var(--color-accent-pastel-border)] dark:border-[var(--color-border-subtle)] "
          >
            {/* Attachment Button */}
            <label className="cursor-pointer text-[var(--color-text-muted)] hover:text-[var(--color-accent-vibrant)] dark:text-slate-400 dark:hover:text-white transition-colors p-1">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
              <Paperclip className="w-4 h-4" />
            </label>

            {/* Dictation STT Mic */}
            <button
              type="button"
              onClick={toggleRecording}
              className={`p-1.5 rounded-[6px] transition-colors ${
                isRecording
                  ? 'bg-[var(--c-red)] text-white animate-pulse'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-accent-vibrant)] dark:text-slate-400 dark:hover:text-white'
              }`}
              title={isRecording ? 'Stop dictation' : isTranscribing ? 'Transcribing…' : 'Dictate (local Whisper)'}
              aria-label={isRecording ? 'Stop dictation' : 'Dictate'}
            >
              {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>

            {/* Input field */}
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={`Message ${selectedModel}`}
              className="flex-1 bg-transparent text-xs text-[var(--color-text-main)] placeholder-[#9CA3AF] focus:outline-none"
            />

            {/* Send button */}
            <button
              type="submit"
              disabled={(!inputText.trim() && !attachedFile) || isStreaming}
              className="w-8 h-8 rounded-full bg-[var(--color-accent-vibrant)] text-white flex items-center justify-center hover:brightness-110 active:scale-95 disabled:opacity-40 transition-all shrink-0 "
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
