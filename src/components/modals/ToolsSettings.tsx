// Settings → Tools (session 15): whether chat models may use tools, when Lotus asks first, which
// folders the file tools may use, deny rules, and the list of tools the core offers.

import React, { useEffect, useState } from 'react';
import { Tip } from '../common/Tip';
import { FolderPlus, X } from 'lucide-react';
import { LotusSettings } from '../../types/lotus';
import { Toggle } from '../common/Toggle';
import { Btn, IconBtn, Segmented, TextArea } from '../common/ui';
import { agentAvailable, listTools, type ToolInfo } from '../../lib/agent';
import { DEFAULT_DENY } from '../../agents/toolDefaults';
import { isTauri } from '../../lib/http';
import { kv } from '../../lib/store';
import { ALLOW_KEY, describeAllow, parseAllow } from '../../lib/allowRules';

interface P { settings: LotusSettings; onUpdateSettings: (p: Partial<LotusSettings>) => void }

const Row: React.FC<{ title: string; hint: React.ReactNode; children?: React.ReactNode }> = ({ title, hint, children }) => (
  <div className="py-3.5 border-b border-[var(--sep)] last:border-b-0 flex items-center justify-between gap-4">
    <div className="min-w-0">
      <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--color-text-main)]">{title}<Tip label={title} /></span>
      <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 leading-snug">{hint}</p>
    </div>
    {children}
  </div>
);

const RISK: Record<ToolInfo['risk'], string> = { read: 'Looks only', write: 'Changes Lotus data', risky: 'Changes your files' };

export const ToolsPanel: React.FC<P> = ({ settings: s, onUpdateSettings: set }) => {
  const [tools, setTools] = useState<ToolInfo[] | null>(null);
  const [studio, setStudio] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deny, setDeny] = useState(s.agentDeny.join('\n'));
  const live = agentAvailable();
  // Always-allow rules: saved by the core when you press Always Allow on a permission request.
  const [allow, setAllow] = useState<string[]>(() => parseAllow(kv.getItem(ALLOW_KEY)));
  useEffect(() => {
    const on = (e: StorageEvent) => { if (e.key === ALLOW_KEY) setAllow(parseAllow(kv.getItem(ALLOW_KEY))); };
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, []);
  const saveAllow = (next: string[]) => { setAllow(next); kv.setItem(ALLOW_KEY, JSON.stringify(next)); };

  useEffect(() => {
    if (!live) return;
    listTools().then((r) => { setTools(r.tools); setStudio(r.studio); setError(null); }).catch((e) => setError((e as Error).message));
  }, [live, s.agentFolders]);

  const addFolder = async () => {
    if (!isTauri) return;
    const { open } = await import('@tauri-apps/plugin-dialog');
    const p = await open({ title: 'Let Lotus use a folder', directory: true, multiple: false });
    if (typeof p === 'string' && !s.agentFolders.includes(p)) set({ agentFolders: [...s.agentFolders, p] });
  };
  const saveDeny = (text: string) => set({ agentDeny: text.split('\n').map((l) => l.trim()).filter(Boolean) });

  return (
    <div className="space-y-1">
      <Row title="Let models use tools" hint="Chat models can read and save files, add and move tasks, make images, use memory and, when Web is on for a chat, search the web. Every step shows in the chat with its result. Off: replies only, as before.">
        <Toggle checked={s.agentTools} onChange={(v) => set({ agentTools: v })} ariaLabel="Let models use tools" />
      </Row>
      <Row title="Use a browser" hint="Lets the agent open web pages in its own Chrome window (a separate profile: it never sees your tabs, passwords or cookies), read them, click and type. Clicking and typing ask first unless “Ask before” is Never. Needs Google Chrome, Edge or Chromium.">
        <Toggle checked={s.browserUse === true} onChange={(v) => set({ browserUse: v })} ariaLabel="Use a browser" />
      </Row>
      <Row title="Control this computer" hint={`Lets the agent take screenshots and use your mouse and keyboard, like a person at your desk. Every click, key press and typing asks first unless “Ask before” is Never. Works best with a model that can see images (Qwen 3.5, Gemma 4).${navigator.platform.startsWith('Mac') ? ' macOS asks you to allow Lotus under Screen Recording and Accessibility.' : navigator.platform.startsWith('Linux') ? ' Needs xdotool and scrot.' : ''}`}>
        <Toggle checked={s.computerUse === true} onChange={(v) => set({ computerUse: v })} ariaLabel="Control this computer" />
      </Row>
      <Row title="Ask before" hint={s.agentApproval === 'ask' ? 'Lotus waits for Allow before every tool step, even reading a file.' : s.agentApproval === 'auto' ? 'Lotus never waits; deny rules below still apply. Use this only with folders you don’t mind being changed.' : 'Lotus asks before it changes or creates files. Looking at files, tasks and images it makes happen without asking.'}>
        <Segmented label="Ask before" className="shrink-0 whitespace-nowrap" value={s.agentApproval} onChange={(v) => set({ agentApproval: v })}
          options={[{ id: 'ask', label: 'Every Step' }, { id: 'risky', label: 'File Changes' }, { id: 'auto', label: 'Never' }]} />
      </Row>

      <div className="py-3.5 border-b border-[var(--sep)] space-y-2">
        <div className="flex items-center justify-between gap-4">
          <div>
            <span className="text-[13px] font-semibold">Folders Lotus can use</span>
            <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 leading-snug">The file tools can’t see anything outside these. A chat with its own folder can use that one too.</p>
          </div>
          {isTauri && <Btn size="sm" icon={<FolderPlus className="w-3.5 h-3.5" />} onClick={() => void addFolder()}>Add Folder…</Btn>}
        </div>
        <ul className="space-y-1">
          {studio && <li className="text-[12px] flex items-center gap-2 h-7 px-2 rounded-[8px] bg-[var(--hover)]"><span className="truncate flex-1" title={studio}>{studio}</span><span className="text-[var(--color-text-muted)] shrink-0">Lotus Studio folder</span></li>}
          {s.agentFolders.map((f) => (
            <li key={f} className="text-[12px] flex items-center gap-2 h-7 pl-2 rounded-[8px] bg-[var(--hover)]">
              <span className="truncate flex-1" title={f}>{f}</span>
              <IconBtn label={`Stop letting Lotus use ${f}`} className="!w-6 !h-6" onClick={() => set({ agentFolders: s.agentFolders.filter((x) => x !== f) })}><X className="w-3.5 h-3.5" /></IconBtn>
            </li>
          ))}
        </ul>
      </div>

      <div className="py-3.5 border-b border-[var(--sep)] space-y-2">
        <div className="flex items-center justify-between gap-4">
          <div>
            <span className="text-[13px] font-semibold">Always allowed</span>
            <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 leading-snug">What you answered with Always Allow. Lotus does these without asking, in every mode; Never allow rules still come first, and emptying a file always asks.</p>
          </div>
          {allow.length > 0 && <Btn size="sm" variant="ghost" onClick={() => saveAllow([])}>Remove All</Btn>}
        </div>
        {allow.length ? (
          <ul className="space-y-1">
            {allow.map((r) => (
              <li key={r} className="text-[12px] flex items-center gap-2 h-7 pl-2 rounded-[8px] bg-[var(--hover)]">
                <span className="truncate flex-1" title={r}>{describeAllow(r)}</span>
                <IconBtn label={`Ask again for ${describeAllow(r)}`} className="!w-6 !h-6" onClick={() => saveAllow(allow.filter((x) => x !== r))}><X className="w-3.5 h-3.5" /></IconBtn>
              </li>
            ))}
          </ul>
        ) : <p className="text-[12px] text-[var(--color-text-muted)]">Nothing yet. Press Always Allow on a permission request to add one.</p>}
      </div>

      <div className="py-3.5 border-b border-[var(--sep)] space-y-2">
        <div className="flex items-center justify-between gap-4">
          <div>
            <span className="text-[13px] font-semibold">Never allow</span>
            <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 leading-snug">One rule per line, refused without asking: a tool (<code>files.write</code>), a group (<code>web.*</code>), or a tool and a pattern for its file or address (<code>files.read:*.env</code>).</p>
          </div>
          <Btn size="sm" variant="ghost" onClick={() => { setDeny(DEFAULT_DENY.join('\n')); saveDeny(DEFAULT_DENY.join('\n')); }}>Restore Defaults</Btn>
        </div>
        <TextArea aria-label="Never allow rules" rows={4} value={deny} onChange={(e) => setDeny(e.target.value)} onBlur={() => saveDeny(deny)} className="font-mono text-[12px]" />
      </div>

      <div className="py-3.5 space-y-2">
        <span className="text-[13px] font-semibold">Tools</span>
        {!live && <p className="text-[12px] text-[var(--color-text-muted)]">Tools run in Lotus’s background service, which isn’t running here. They work in the desktop app.</p>}
        {error && <p className="text-[12px] text-[var(--c-red)]">Couldn’t read the tool list: {error}</p>}
        {tools && (
          <ul className="divide-y divide-[var(--sep)]">
            {tools.map((t) => (
              <li key={t.name} className="py-2 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <span className="text-[13px]">{t.label}</span> <code className="text-[12px] text-[var(--color-text-muted)]">{t.name}</code>
                  <p className="text-[12px] text-[var(--color-text-muted)] leading-snug">{t.description}</p>
                </div>
                <span className="text-[12px] text-[var(--color-text-muted)] shrink-0">{RISK[t.risk]}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
