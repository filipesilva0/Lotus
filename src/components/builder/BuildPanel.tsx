import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, FolderOpen, Play, RefreshCw, X } from 'lucide-react';
import { Banner, Btn, Card, Checkbox, Select, Spinner } from '../common/ui';
import { Section } from '../common/Pane';
import { revealPath } from '../../lib/open';
import { slugify, Template } from '../../builder/templates';
import { toolchainCheck, ToolInfo } from '../../builder/projectFs';
import type { BuilderProject } from '../../builder/types';

const TOOL_NAMES: Record<string, string> = { node: 'Node.js', npm: 'npm', git: 'Git', python: 'Python', cargo: 'Rust (cargo)', rustc: 'Rust compiler', java: 'Java', dotnet: '.NET', adb: 'Android tools (adb)' };

/** What this project can do, what is installed, and the settings for the agent. */
export const BuildPanel: React.FC<{
  project: BuilderProject; template: Template; hasWorkflow: boolean;
  numCtx: number; onNumCtx: (n: number) => void; onAutoRun: (on: boolean) => void;
  onAction: (command: string, server: boolean) => void; onRemove: () => void;
}> = ({ project, template, hasWorkflow, numCtx, onNumCtx, onAutoRun, onAction, onRemove }) => {
  const [tools, setTools] = useState<ToolInfo[] | null>(null);
  const [toolErr, setToolErr] = useState<string | null>(null);
  const check = () => { setTools(null); setToolErr(null); toolchainCheck().then(setTools).catch((e: Error) => { setToolErr(e.message); setTools([]); }); };
  useEffect(check, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const have = (id: string) => tools?.find((t) => t.id === id)?.found ?? false;
  const slug = slugify(project.name);
  const needed = Array.from(new Set(template.actions.flatMap((a) => a.needs)));
  const missing = (needs: string[]) => (tools && tools.length ? needs.filter((n) => !have(n)) : []);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <Section title="Run and build" hint={template.blurb}>
        {template.actions.length === 0 && <p className="text-[12px] text-[var(--color-text-muted)]">Nothing to run: this project needs no build step. The preview updates as you save.</p>}
        <ul className="space-y-2">
          {template.actions.map((a) => {
            const miss = missing(a.needs);
            return (
              <li key={a.id}><Card className="p-3">
                <div className="flex items-center gap-2">
                  <span className="flex-1 min-w-0 text-[13px] font-medium">{a.label}</span>
                  <Btn size="sm" variant="secondary" icon={<Play className="w-3 h-3" />} disabled={miss.length > 0} onClick={() => onAction(a.command.split('__SLUG__').join(slug), !!a.server)}>Run</Btn>
                </div>
                <p className="mt-1 text-[11px] font-mono text-[var(--color-text-muted)] break-all">{a.command.split('__SLUG__').join(slug)}</p>
                {a.note && <p className="mt-1 text-[12px] text-[var(--color-text-muted)] leading-snug">{a.note}</p>}
                {miss.length > 0 && <p className="mt-1 text-[12px] text-[var(--c-orange)] flex gap-1"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />Needs {miss.map((m) => TOOL_NAMES[m] ?? m).join(', ')}</p>}
              </Card></li>
            );
          })}
        </ul>
        {hasWorkflow && <p className="mt-3 text-[12px] text-[var(--color-text-muted)] leading-snug">Builds for other systems (macOS, Linux, iPhone) run on GitHub. Push this folder to a GitHub repository, open its Actions tab and run "{template.id === 'mobile' ? 'Build mobile apps' : 'Build desktop apps'}". The workflow is in <span className="font-mono">.github/workflows/build.yml</span>.</p>}
      </Section>

      <Section title="Tools on this PC" action={<Btn size="sm" variant="ghost" icon={<RefreshCw className="w-3 h-3" />} onClick={check}>Check</Btn>}
        hint={needed.length ? 'What this project type uses. Missing tools can be installed from their websites; restart Lotus afterwards so it sees them.' : undefined}>
        {tools === null ? <Spinner className="w-4 h-4 text-[var(--color-accent-vibrant)]" /> : (
          <ul className="space-y-1">
            {tools.filter((t) => needed.includes(t.id) || t.found).map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-[12px]">
                {t.found ? <Check className="w-3.5 h-3.5 text-[var(--c-green)] shrink-0" /> : <X className="w-3.5 h-3.5 text-[var(--color-text-muted)] shrink-0" />}
                <span className="w-32 shrink-0">{TOOL_NAMES[t.id] ?? t.id}</span>
                <span className="truncate text-[var(--color-text-muted)] font-mono text-[11px]">{t.found ? t.version : 'not found'}</span>
              </li>
            ))}
          </ul>
        )}
        {toolErr && <Banner tone="warn" className="mt-2">{toolErr}</Banner>}
        <p className="mt-2 text-[11px] text-[var(--color-text-muted)] leading-snug">iPhone and Mac apps can only be built with Apple's tools on a Mac. Lotus builds them on GitHub's Macs through the included workflow instead.</p>
      </Section>

      <Section title="Agent">
        <label className="block text-[12px] mb-1" htmlFor="ctx">Context size</label>
        <Select id="ctx" value={numCtx} onChange={(e) => onNumCtx(Number(e.target.value))}>
          <option value={8192}>8K (small models, low memory)</option>
          <option value={16384}>16K (recommended)</option>
          <option value={32768}>32K (needs more memory)</option>
        </Select>
        <p className="mt-1 text-[11px] text-[var(--color-text-muted)] leading-snug">How much the model can keep in mind at once. Building needs far more than chat; a larger value uses more memory.</p>
        <div className="mt-3"><Checkbox checked={project.autoRun} onChange={onAutoRun} label="Run commands without asking" /></div>
        <p className="mt-1 text-[11px] text-[var(--color-text-muted)] leading-snug">Off by default. When on, the agent can run installs and builds on its own. Commands that look destructive still ask first.</p>
      </Section>

      <Section title="Project">
        <p className="text-[11px] font-mono text-[var(--color-text-muted)] break-all mb-2">{project.path}</p>
        <div className="flex gap-2">
          <Btn size="sm" icon={<FolderOpen className="w-3 h-3" />} onClick={() => void revealPath(project.path)}>Show in Explorer</Btn>
          <Btn size="sm" variant="ghost" onClick={onRemove}>Remove from list</Btn>
        </div>
        <p className="mt-1.5 text-[11px] text-[var(--color-text-muted)]">Removing only takes it off this list; the files stay on disk.</p>
      </Section>
    </div>
  );
};
