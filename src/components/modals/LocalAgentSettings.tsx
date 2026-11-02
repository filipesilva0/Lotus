import React, { useState } from 'react';
import { LotusSettings } from '../../types/lotus';
import { Toggle } from '../common/Toggle';
import { Segmented, Stepper, TextInput, Btn } from '../common/ui';
import { ScalingCard } from '../hardware/ScalingCard';
import { llamacpp } from '../../services/llm';
import { memoryStore, useMemoryStore } from '../../memory/store';

interface P { settings: LotusSettings; onUpdateSettings: (p: Partial<LotusSettings>) => void }

const Row: React.FC<{ title: string; hint: React.ReactNode; children: React.ReactNode }> = ({ title, hint, children }) => (
  <div className="py-3.5 border-b border-[var(--sep)] last:border-b-0 flex items-center justify-between gap-4">
    <div className="min-w-0">
      <span className="text-xs font-semibold text-[var(--color-text-main)]">{title}</span>
      <p className="text-xs text-[var(--color-text-muted)] mt-0.5 leading-snug">{hint}</p>
    </div>
    <div className="shrink-0">{children}</div>
  </div>
);

/** Settings → Local engine & VRAM. */
export const EngineScalingPanel: React.FC<P> = ({ settings: s, onUpdateSettings: set }) => {
  const [probe, setProbe] = useState<string | null>(null);
  const test = async () => {
    setProbe('Checking…');
    try { const p = await llamacpp.props(); setProbe(`Connected · ${p.model || 'model loaded'} · ${p.nCtx.toLocaleString()} tokens across ${p.slots} slot${p.slots > 1 ? 's' : ''}`); }
    catch (e) { setProbe((e as Error).message); }
  };
  return (
    <div className="space-y-4">
      <Row title="Model server" hint="Where chat, Thinking mode, tasks, routines and memory learning send requests. Images, voice, Research and the App Builder keep using their own engines.">
        <Segmented label="Model server" value={s.llmBackend} onChange={(v) => set({ llmBackend: v })} options={[{ id: 'ollama', label: 'Ollama' }, { id: 'llamacpp', label: 'llama.cpp' }]} />
      </Row>
      {s.llmBackend === 'llamacpp' && (
        <div className="py-3.5 border-b border-[var(--sep)] last:border-b-0 space-y-2">
          <span className="text-xs font-semibold">llama-server address</span>
          <div className="flex gap-2"><TextInput value={s.llamacppUrl} onChange={(e) => set({ llamacppUrl: e.target.value })} aria-label="llama-server address" className="font-mono" /><Btn onClick={() => void test()}>Test</Btn></div>
          {probe && <p className="text-xs text-[var(--color-text-muted)]" role="status">{probe}</p>}
          <p className="text-xs text-[var(--color-text-muted)] leading-snug">llama-server fixes its context size (-c) and parallel slots (-np) when it starts, so Lotus reads them and suggests flags that fit your GPU instead of changing them.</p>
        </div>
      )}
      <Row title="Auto-scale to video memory" hint="Measures free VRAM every few seconds and sizes the context window, file chunks and the number of background agents so the model never runs out of memory. Off: your fixed context setting and one agent at a time.">
        <Toggle checked={s.autoScale} onChange={(v) => set({ autoScale: v })} ariaLabel="Auto-scale to video memory" />
      </Row>
      <Row title="Keep free for other apps" hint="Video memory Lotus leaves alone for Windows, browsers and games.">
        <Stepper label="Video memory to keep free" value={s.vramReserveMb} min={0} max={16384} step={256} onChange={(v) => set({ vramReserveMb: v })} unit="MB" />
      </Row>
      <Row title="Most background agents at once" hint="An upper limit. The real limit is the lower of this and what free video memory allows.">
        <Stepper label="Most background agents" value={s.maxSubagents} min={1} max={8} step={1} onChange={(v) => set({ maxSubagents: v })} />
      </Row>
      <ScalingCard />
    </div>
  );
};

/** Settings → Chat: web search. */
export const WebSearchPanel: React.FC<P> = ({ settings: s, onUpdateSettings: set }) => (
  <div className="space-y-4">
    <Row title="Web search provider" hint="Used when Web is on in the message box, and by tasks and routines that search the web. DuckDuckGo needs no account; SearXNG is a search engine you can run yourself.">
      <Segmented label="Web search provider" value={s.webSearchProvider} onChange={(v) => set({ webSearchProvider: v })} options={[{ id: 'duckduckgo', label: 'DuckDuckGo' }, { id: 'searxng', label: 'SearXNG' }]} />
    </Row>
    {s.webSearchProvider === 'searxng' && (
      <div className="py-3.5 border-b border-[var(--sep)] last:border-b-0 space-y-2">
        <span className="text-xs font-semibold">SearXNG address</span>
        <TextInput value={s.searxngUrl} onChange={(e) => set({ searxngUrl: e.target.value })} aria-label="SearXNG address" className="font-mono" />
        <p className="text-xs text-[var(--color-text-muted)]">Enable the JSON format in SearXNG's settings.yml (search → formats → json).</p>
      </div>
    )}
    <Row title="Pages to read" hint="How many of the top results Lotus opens and reads. More pages: better answers, slower, more context used.">
      <Stepper label="Pages to read" value={s.webPagesToRead} min={0} max={5} step={1} onChange={(v) => set({ webPagesToRead: v })} />
    </Row>
    <p className="text-xs text-[var(--color-text-muted)] leading-snug px-1">Privacy: with Web on, your question goes to the search provider and the result pages are fetched from their websites. With it off, nothing leaves this computer except Deep Research and source-search queries you turn on.</p>
  </div>
);

/** Settings → Memory. */
export const MemorySkillsPanel: React.FC<P> = ({ settings: s, onUpdateSettings: set }) => {
  const { status, memories, skills } = useMemoryStore();
  const [wiped, setWiped] = useState(false);
  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--color-text-muted)] leading-snug px-1">Memory is on for every new chat. The Memory button next to Incognito in the chat header pauses it for one chat at once: no recall and no learning until you turn it back on. Incognito chats never use memory.</p>
      <Row title="Learn from conversations" hint="Every few messages, a background agent notes lasting facts and preferences you mention, and corrects ones that changed. Learned items are marked in the chat inspector, where you can delete them.">
        <Toggle checked={s.autoMemory} onChange={(v) => set({ autoMemory: v })} ariaLabel="Learn from conversations" />
      </Row>
      <Row title="Recall past conversations" hint="Searches earlier chats (full-text search on this computer) for parts relevant to your message and gives them to the model.">
        <Toggle checked={s.sessionRecall} onChange={(v) => set({ sessionRecall: v })} ariaLabel="Recall past conversations" />
      </Row>
      <Row title="Write and improve skills" hint="After a complex chat or a finished task, Lotus writes the procedure as a skill; it uses matching skills later and rewrites one when you correct it. Manage them in Tasks → Skills.">
        <Toggle checked={s.autoSkills} onChange={(v) => set({ autoSkills: v })} ariaLabel="Write and improve skills" />
      </Row>
      <div className="py-3.5 border-b border-[var(--sep)] last:border-b-0 space-y-2">
        <span className="text-xs font-semibold">Stored on this computer</span>
        <p className="text-xs text-[var(--color-text-muted)]">
          {memories.length} memories · {skills.length} skills{status ? ` · ${status.messages.toLocaleString()} searchable messages` : ''}
          {status?.native ? ` · ${status.path}` : ''}
        </p>
        <div className="flex gap-2">
          <Btn variant="danger" disabled={wiped} onClick={() => void memoryStore.wipeHistory().then(() => setWiped(true))}>{wiped ? 'Search index cleared' : 'Clear conversation search index'}</Btn>
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">Clearing the index does not delete your chats; it stops them from being recalled until they are indexed again (new messages are indexed as you chat).</p>
      </div>
    </div>
  );
};
