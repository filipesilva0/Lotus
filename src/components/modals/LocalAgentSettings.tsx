import React, { useState } from 'react';
import { Eraser } from 'lucide-react';
import { Tip } from '../common/Tip';
import { LotusSettings } from '../../types/lotus';
import { Toggle } from '../common/Toggle';
import { Segmented, Stepper, TextInput, Btn, InfoNote, SettingRow } from '../common/ui';
import { ScalingCard } from '../hardware/ScalingCard';
import { llamacpp } from '../../services/llm';
import { llamacppToken, setLlamacppToken } from '../../services/engineConfig';
import { memoryStore, useMemoryStore } from '../../memory/store';
import { providerOf } from '../../chat/webCore';

interface P { settings: LotusSettings; onUpdateSettings: (p: Partial<LotusSettings>) => void }

const Row: React.FC<{ title: string; hint: React.ReactNode; children?: React.ReactNode }> = (p) => <SettingRow {...p} tip />;

/** Settings → Local engine & VRAM. */
export const EngineScalingPanel: React.FC<P> = ({ settings: s, onUpdateSettings: set }) => {
  const [probe, setProbe] = useState<string | null>(null);
  const test = async () => {
    setProbe('Checking…');
    try { const p = await llamacpp.props(); setProbe(`Connected · ${p.model || 'model loaded'} · ${p.nCtx.toLocaleString()} tokens across ${p.slots} slot${p.slots > 1 ? 's' : ''}`); }
    catch (e) {
      // LM Studio and vLLM have no /props; their model list is enough to know they answer.
      const ids = await llamacpp.listModels();
      setProbe(ids.length ? `Connected · ${ids.length} model${ids.length > 1 ? 's' : ''}: ${ids.slice(0, 3).join(', ')}${ids.length > 3 ? '…' : ''}` : (e as Error).message);
    }
  };
  const [key, setKey] = useState(() => llamacppToken());
  return (
    <div className="space-y-4">
      <Row title="Chat engine" hint="What runs chat, Work, tasks, routines and memory learning. Lotus keeps its own engine and models in Lotus Studio; Ollama, or your own server (llama-server, LM Studio, vLLM), are there if you already use them.">
        <Segmented label="Chat engine" value={s.llmBackend} onChange={(v) => set({ llmBackend: v })} options={[{ id: 'builtin', label: 'Lotus' }, { id: 'ollama', label: 'Ollama' }, { id: 'llamacpp', label: 'Your server' }]} />
      </Row>
      <Row title="Image engine" hint="What makes images. Lotus's engine runs stable-diffusion.cpp; ComfyUI adds inpainting, extending and custom workflows. Both use the models in Lotus Studio/Models/image.">
        <Segmented label="Image engine" value={s.imageEngine} onChange={(v) => set({ imageEngine: v })} options={[{ id: 'builtin', label: 'Lotus' }, { id: 'comfyui', label: 'ComfyUI' }]} />
      </Row>
      <Row title="Keep engine models in Lotus Studio" hint="When Lotus starts Ollama or Voicebox, their models go in Lotus Studio/Models, next to everything else. Models they downloaded before stay where they are (download them again, or move them yourself). ComfyUI always reads Lotus Studio/Models/image.">
        <Toggle checked={s.engineModelsInStudio !== false} onChange={(v) => set({ engineModelsInStudio: v })} ariaLabel="Keep engine models in Lotus Studio" />
      </Row>
      <Row title="Voice engine" hint="What speaks and listens. Lotus's engine runs Kokoro and Piper voices and Whisper dictation; Voicebox adds voice cloning and stories.">
        <Segmented label="Voice engine" value={s.voiceEngine} onChange={(v) => set({ voiceEngine: v })} options={[{ id: 'builtin', label: 'Lotus' }, { id: 'voicebox', label: 'Voicebox' }]} />
      </Row>
      {s.llmBackend === 'llamacpp' && (
        <div className="py-3.5 border-b border-[var(--sep)] last:border-b-0 space-y-2">
          <span className="text-xs font-semibold">Server address (llama-server, LM Studio or vLLM)</span>
          <div className="flex gap-2"><TextInput value={s.llamacppUrl} onChange={(e) => set({ llamacppUrl: e.target.value })} aria-label="Server address" className="font-mono" /><Btn onClick={() => void test()}>Test</Btn></div>
          <span className="inline-flex items-center gap-1 text-xs font-semibold">Access key (optional)<Tip text="Only if the server asks for one (vLLM --api-key, LM Studio with authentication on, a server behind a password). Sent only to this address." /></span>
          <TextInput type="password" value={key} onChange={(e) => { setKey(e.target.value); setLlamacppToken(e.target.value); }} aria-label="Access key" placeholder="None" autoComplete="off" />
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
  <div>
    <Row title="Web search provider" hint="Used when Web is on in the message box, and by tasks and routines that search the web. Lotus Search is built in and needs no account: it asks DuckDuckGo, then Bing and Wikipedia when one is busy or asks for a captcha. SearXNG is a search engine you can run yourself.">
      <Segmented label="Web search provider" value={providerOf(s.webSearchProvider)} onChange={(v) => set({ webSearchProvider: v })} options={[{ id: 'auto', label: 'Lotus Search' }, { id: 'searxng', label: 'SearXNG' }]} />
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
      <InfoNote title="Memory in each chat">Memory is on for every new chat. The Memory button in the chat bar, under the message box beside Incognito, pauses it for that chat: no recall and no learning until you turn it back on. Incognito chats never use memory.</InfoNote>
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
          <Btn variant="danger" icon={<Eraser className="w-3.5 h-3.5" />} disabled={wiped} onClick={() => void memoryStore.wipeHistory().then(() => setWiped(true))}>{wiped ? 'Search Index Cleared' : 'Clear Search Index'}</Btn>
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">Clearing the index does not delete your chats; it stops them from being recalled until they are indexed again (new messages are indexed as you chat).</p>
      </div>
    </div>
  );
};
