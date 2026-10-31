import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Brain, Copy, Download, FileText, Flower2, Lock, Plus, Puzzle, Sparkles, Trash2, Upload, Wand2, X } from 'lucide-react';
import { MarkdownLite } from '../../lib/markdownLite';
import { Banner, Btn, IconBtn, Segmented, Spinner, TextArea, cx, useFlash } from '../common/ui';
import { Toggle } from '../common/Toggle';
import { useMemoryStore } from '../../memory/store';
import { SYSTEM_SKILLS } from '../../skills/system';
import { memoryFile, pluginSkillFile, skillFile, soulFile, systemSkillFile } from '../../library/docs';
import { useProjectContext, stripFrontMatter } from '../../context/discover';
import { LotusPlugin, fromFileText, plugins, toFile, usePlugins, validatePlugin } from '../../plugins/store';
import { draftPlugin, DraftResult } from '../../plugins/creator';
import type { LotusSettings } from '../../types/lotus';

export type LibraryTab = 'skills' | 'memory' | 'soul' | 'plugins';

interface Props {
  open: boolean;
  tab: LibraryTab;
  onTab: (t: LibraryTab) => void;
  onClose: () => void;
  settings: LotusSettings;
  onSettings: (p: Partial<LotusSettings>) => void;
  /** Workspace folder of the open chat: its SOUL.md / memory.md are listed too. */
  folder?: string;
}

/** One readable document in the left list. */
interface Doc {
  id: string;
  group: string;
  title: string;
  subtitle?: string;
  badge?: string;
  /** File text (Markdown, possibly with front matter). */
  text: string;
  readOnly?: string;
  icon: React.ReactNode;
}

const TABS: { id: LibraryTab; label: string }[] = [
  { id: 'skills', label: 'Skills' },
  { id: 'memory', label: 'Memory' },
  { id: 'soul', label: 'Soul' },
  { id: 'plugins', label: 'Plugins' },
];

/**
 * Library: read what Lotus actually sends to the model. Skills (system, learned and plugin skills),
 * memory (long-term memory and project memory files), the soul (system prompt and project persona
 * files) and plugins, including the plugin creator. Opened from the profile menu, /library or /plugins.
 */
export const LibrarySheet: React.FC<Props> = ({ open, tab, onTab, onClose, settings, onSettings, folder }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => { window.removeEventListener('keydown', h); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[6vh] px-4 bg-black/25 dark:bg-black/45" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Library"
        className="material-frosted w-full max-w-[980px] h-[86vh] max-h-[720px] flex flex-col rounded-[12px] outline-none overflow-hidden">
        <div className="flex items-center gap-3 px-4 h-12 shrink-0 border-b border-[var(--sep)]">
          <BookOpen className="w-4 h-4 text-[var(--petal-violet)]" aria-hidden="true" />
          <h2 className="text-[13px] font-semibold text-[var(--color-text-main)]">Library</h2>
          <Segmented label="Library sections" value={tab} onChange={onTab} options={TABS} className="ml-2" />
          <div className="flex-1" />
          <IconBtn label="Close" onClick={onClose}><X className="w-4 h-4" /></IconBtn>
        </div>
        <div className="flex-1 min-h-0 flex">
          {tab === 'plugins'
            ? <PluginsPane />
            : <DocsPane tab={tab} settings={settings} onSettings={onSettings} folder={folder} />}
        </div>
      </div>
    </div>
  );
};

// ── Skills / Memory / Soul ──────────────────────────────────────────────────

const DocsPane: React.FC<{ tab: Exclude<LibraryTab, 'plugins'>; settings: LotusSettings; onSettings: (p: Partial<LotusSettings>) => void; folder?: string }> = ({ tab, settings, onSettings, folder }) => {
  const mem = useMemoryStore();
  const installed = usePlugins();
  const project = useProjectContext(folder);
  const [sel, setSel] = useState<string>('');
  const [view, setView] = useState<'read' | 'source'>('read');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [copied, flash] = useFlash();

  const docs = useMemo<Doc[]>(() => {
    const projFiles = (kind: 'soul' | 'memory' | 'rules') => project.files.filter((f) => f.kind === kind).map<Doc>((f) => ({
      id: `proj:${f.rel}`, group: 'This chat’s workspace folder', title: f.rel, subtitle: `${(f.bytes / 1024).toFixed(1)} KB${f.truncated ? ' · cut at 24 KB' : ''}`,
      text: f.content, readOnly: 'Lotus never edits files in your folders.', icon: <FileText className="w-3.5 h-3.5" />,
    }));
    if (tab === 'skills') {
      return [
        ...SYSTEM_SKILLS.map<Doc>((s) => ({ id: s.id, group: 'System skills', title: s.name, subtitle: s.description, badge: s.usedBy, text: systemSkillFile(s), readOnly: 'Built into Lotus. This is the exact text the feature sends.', icon: <Lock className="w-3.5 h-3.5" /> })),
        ...mem.skills.map<Doc>((s) => ({ id: s.id, group: 'Your skills', title: s.name, subtitle: s.description, badge: `${s.origin === 'auto' ? 'Learned' : 'Yours'} · v${s.version}${s.enabled ? '' : ' · off'}`, text: skillFile(s), readOnly: 'Edit or switch it off in Tasks → Skills.', icon: <Sparkles className="w-3.5 h-3.5" /> })),
        ...installed.flatMap((p) => p.skills.map<Doc>((k, i) => ({ id: `plg:${p.id}:${i}`, group: 'Plugin skills', title: k.name, subtitle: k.description, badge: `${p.name}${p.enabled ? '' : ' · off'}`, text: pluginSkillFile(k, p), readOnly: 'Part of a plugin. Edit it in Library → Plugins.', icon: <Puzzle className="w-3.5 h-3.5" /> }))),
      ];
    }
    if (tab === 'memory') {
      return [
        { id: 'memory', group: 'Long-term memory', title: 'memory.md', subtitle: mem.status ? `${mem.status.memories} items · ${mem.status.messages.toLocaleString()} indexed messages` : 'Loading…', text: memoryFile(mem.memories), readOnly: 'A view of the memory database. Add with “remember …”, edit in the chat inspector → Context.', icon: <Brain className="w-3.5 h-3.5" /> },
        ...projFiles('memory'),
        ...projFiles('rules'),
      ];
    }
    return [
      { id: 'soul', group: 'Lotus', title: 'System prompt', subtitle: 'Sent first in every chat', text: soulFile(settings.systemPrompt), icon: <Flower2 className="w-3.5 h-3.5" /> },
      ...projFiles('soul'),
      ...installed.filter((p) => p.instructions).map<Doc>((p) => ({ id: `plgi:${p.id}`, group: 'Plugin instructions', title: p.name, subtitle: p.enabled ? 'On: added after the system prompt' : 'Off', text: `# ${p.name}\n\n${p.instructions}`, readOnly: 'Part of a plugin. Edit it in Library → Plugins.', icon: <Puzzle className="w-3.5 h-3.5" /> })),
    ];
  }, [tab, mem.skills, mem.memories, mem.status, installed, project.files, settings.systemPrompt]);

  useEffect(() => { setSel((s) => (docs.some((d) => d.id === s) ? s : docs[0]?.id ?? '')); setEditing(false); }, [docs, tab]);
  // Until the effect has run (first paint), show the first document rather than an empty viewer.
  const doc = docs.find((d) => d.id === sel) ?? docs[0];
  const groups = [...new Set(docs.map((d) => d.group))];
  const isSoul = doc?.id === 'soul';

  return (<>
    <nav aria-label={`${tab} files`} className="w-[290px] shrink-0 border-r border-[var(--sep)] overflow-y-auto p-2">
      {tab === 'memory' && mem.status && <p className="px-2 pb-2 text-[11px] text-[var(--color-text-muted)] break-all" title={mem.status.path}>Stored in {mem.status.native ? mem.status.path : 'this browser (preview)'}</p>}
      {!folder && tab !== 'skills' && <p className="px-2 pb-2 text-[11px] text-[var(--color-text-muted)]">Choose a workspace folder for the chat (inspector → Context) to see its SOUL.md and memory.md here.</p>}
      {project.loading && <p className="px-2 py-1 text-[12px] text-[var(--color-text-muted)] flex items-center gap-2"><Spinner />Reading the workspace folder…</p>}
      {groups.map((g) => (
        <div key={g} className="mb-2">
          <p className="px-2 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-[.04em] text-[var(--color-text-muted)]">{g}</p>
          {docs.filter((d) => d.group === g).map((d) => (
            <button key={d.id} type="button" onClick={() => setSel(d.id)} aria-current={d.id === doc?.id ? 'true' : undefined}
              className={cx('w-full flex items-start gap-2 px-2 py-1.5 rounded-[8px] text-left focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)]', d.id === doc?.id ? 'bg-[var(--pressed)]' : 'hover:bg-[var(--hover)]')}>
              <span className="mt-0.5 text-[var(--color-text-muted)] shrink-0">{d.icon}</span>
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-1.5"><span className="text-[13px] font-medium truncate">{d.title}</span>{d.badge && <span className="ml-auto shrink-0 px-1.5 rounded-[4px] bg-[var(--hover)] text-[10px] font-semibold text-[var(--color-text-muted)]">{d.badge}</span>}</span>
                {d.subtitle && <span className="block text-[12px] text-[var(--color-text-muted)] truncate">{d.subtitle}</span>}
              </span>
            </button>
          ))}
        </div>
      ))}
      {tab === 'skills' && !mem.skills.length && <p className="px-2 py-1 text-[12px] text-[var(--color-text-muted)]">Lotus writes skills after complex tasks while memory and “Write skills” are on.</p>}
    </nav>
    <section className="flex-1 min-w-0 flex flex-col" aria-label="Viewer">
      {doc ? (<>
        <div className="flex items-center gap-2 px-4 h-11 shrink-0 border-b border-[var(--sep)]">
          <span className="text-[13px] font-semibold truncate">{doc.title}</span>
          <div className="flex-1" />
          {!editing && <Segmented label="View" value={view} onChange={setView} options={[{ id: 'read', label: 'Read' }, { id: 'source', label: 'Source' }]} />}
          <IconBtn label={copied ? 'Copied' : 'Copy text'} onClick={() => { void navigator.clipboard.writeText(doc.text); flash(); }}><Copy className="w-4 h-4" /></IconBtn>
          {isSoul && !editing && <Btn size="sm" onClick={() => { setDraft(settings.systemPrompt); setEditing(true); }}>Edit</Btn>}
        </div>
        {doc.readOnly && <p className="px-4 pt-2.5 text-[12px] text-[var(--color-text-muted)] flex items-center gap-1.5"><Lock className="w-3 h-3" />{doc.readOnly}</p>}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
          {editing ? (
            <div className="flex flex-col gap-2 h-full">
              <TextArea aria-label="System prompt" value={draft} onChange={(e) => setDraft(e.target.value)} className="flex-1 min-h-[260px] font-mono text-[12px]" />
              <div className="flex justify-end gap-2"><Btn variant="ghost" onClick={() => setEditing(false)}>Cancel</Btn><Btn variant="primary" onClick={() => { onSettings({ systemPrompt: draft }); setEditing(false); }}>Save</Btn></div>
            </div>
          ) : view === 'source'
            ? <pre className="selectable whitespace-pre-wrap break-words text-[12px] leading-relaxed font-mono">{doc.text}</pre>
            : <div className="text-[14px] leading-relaxed max-w-[680px]"><FrontMatter text={doc.text} /><MarkdownLite text={stripFrontMatter(doc.text)} onDark={false} /></div>}
        </div>
      </>) : <p className="m-auto text-[13px] text-[var(--color-text-muted)]">Nothing here yet.</p>}
    </section>
  </>);
};

/** Shows SKILL.md front matter as a small key/value table above the body. */
const FrontMatter: React.FC<{ text: string }> = ({ text }) => {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const rows = m[1].split('\n').map((l) => /^([\w_]+):\s*(.*)$/.exec(l)).filter((x): x is RegExpExecArray => !!x)
    .map((x) => [x[1].replace(/_/g, ' '), x[2].replace(/^"|"$/g, '')] as const).filter(([, v]) => v && v !== '[]');
  return (
    <dl className="mb-3 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-[12px] p-2.5 rounded-[8px] bg-[var(--hover)]">
      {rows.map(([k, v]) => (<React.Fragment key={k}><dt className="text-[var(--color-text-muted)] capitalize">{k}</dt><dd className="min-w-0 break-words">{v}</dd></React.Fragment>))}
    </dl>
  );
};

// ── Plugins ────────────────────────────────────────────────────────────────

const BLANK = { name: '', version: '1.0.0', description: '', instructions: '', commands: [{ name: '', description: '', prompt: '{{input}}' }], skills: [] };

const PluginsPane: React.FC = () => {
  const list = usePlugins();
  const [sel, setSel] = useState<string>('new');
  const file = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  useEffect(() => { if (sel !== 'new' && !list.some((p) => p.id === sel)) setSel(list[0]?.id ?? 'new'); }, [list, sel]);
  const cur = list.find((p) => p.id === sel);

  const onImport = async (f: File) => {
    try {
      const r = plugins.install(fromFileText(await f.text()), 'imported');
      if (r.id) { setSel(r.id); setImportMsg({ tone: 'info', text: `Installed ${r.plugin?.name}.${r.warnings.length ? ` ${r.warnings.join(' ')}` : ''}` }); }
      else setImportMsg({ tone: 'error', text: r.errors.join(' ') });
    } catch { setImportMsg({ tone: 'error', text: `${f.name} is not a Lotus plugin file (expected JSON).` }); }
  };

  return (<>
    <nav aria-label="Plugins" className="w-[290px] shrink-0 border-r border-[var(--sep)] overflow-y-auto p-2 flex flex-col">
      <button type="button" onClick={() => setSel('new')} aria-current={sel === 'new' ? 'true' : undefined}
        className={cx('w-full flex items-center gap-2 px-2 h-9 rounded-[8px] text-left text-[13px] font-medium focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)]', sel === 'new' ? 'bg-[var(--pressed)]' : 'hover:bg-[var(--hover)]')}>
        <span className="w-6 h-6 rounded-[6px] inline-flex items-center justify-center bg-[var(--color-accent-fill)] text-white"><Plus className="w-3.5 h-3.5" /></span>Create a plugin
      </button>
      <p className="px-2 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-[.04em] text-[var(--color-text-muted)]">Installed</p>
      {!list.length && <p className="px-2 py-1 text-[12px] text-[var(--color-text-muted)]">No plugins yet. Describe one and Lotus drafts it, or import a .lotus-plugin.json file.</p>}
      {list.map((p) => (
        <div key={p.id} className={cx('flex items-center gap-2 px-2 py-1.5 rounded-[8px]', p.id === sel ? 'bg-[var(--pressed)]' : 'hover:bg-[var(--hover)]')}>
          <button type="button" onClick={() => setSel(p.id)} className="flex-1 min-w-0 flex items-start gap-2 text-left focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)] rounded-[6px]">
            <Puzzle className={cx('w-3.5 h-3.5 mt-0.5 shrink-0', p.enabled ? 'text-[var(--petal-green)]' : 'text-[var(--color-text-muted)]')} />
            <span className="min-w-0"><span className="block text-[13px] font-medium truncate">{p.name}</span><span className="block text-[12px] text-[var(--color-text-muted)] truncate">{p.description}</span></span>
          </button>
          <Toggle size="sm" checked={p.enabled} onChange={(v) => plugins.setEnabled(p.id, v)} ariaLabel={`${p.name} on`} />
        </div>
      ))}
      <div className="flex-1" />
      <input ref={file} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onImport(f); }} />
      {importMsg && <Banner tone={importMsg.tone} className="mx-1 mb-2">{importMsg.text}</Banner>}
      <Btn variant="ghost" icon={<Upload className="w-3.5 h-3.5" />} onClick={() => file.current?.click()} className="justify-start">Import plugin file…</Btn>
    </nav>
    <section className="flex-1 min-w-0 flex flex-col overflow-y-auto" aria-label={cur ? cur.name : 'Create a plugin'}>
      {cur ? <PluginDetail key={cur.id} p={cur} /> : <PluginCreator onInstalled={(id) => setSel(id)} />}
    </section>
  </>);
};

const PluginSummary: React.FC<{ p: Pick<LotusPlugin, 'name' | 'version' | 'description' | 'instructions' | 'commands' | 'skills'> }> = ({ p }) => (
  <div className="flex flex-col gap-4">
    <div>
      <h3 className="text-[18px] font-semibold">{p.name} <span className="text-[12px] font-medium text-[var(--color-text-muted)]">v{p.version}</span></h3>
      <p className="text-[13px] text-[var(--color-text-muted)]">{p.description}</p>
    </div>
    {p.commands.length > 0 && (
      <div>
        <p className="mb-1.5 text-[12px] font-semibold text-[var(--color-text-muted)]">Commands</p>
        <ul className="flex flex-col gap-1.5">
          {p.commands.map((c) => (
            <li key={c.name} className="p-2.5 rounded-[8px] bg-[var(--hover)]">
              <p className="text-[13px]"><span className="font-mono font-semibold text-[var(--petal-violet)]">/{c.name}</span> <span className="text-[var(--color-text-muted)]">· {c.description}</span></p>
              <p className="mt-1 text-[12px] font-mono whitespace-pre-wrap break-words text-[var(--color-text-main)] max-h-24 overflow-y-auto selectable">{c.prompt}</p>
            </li>
          ))}
        </ul>
      </div>
    )}
    {p.instructions && (
      <div>
        <p className="mb-1.5 text-[12px] font-semibold text-[var(--color-text-muted)]">Instructions (added to every chat while on)</p>
        <div className="p-2.5 rounded-[8px] bg-[var(--hover)] text-[13px] leading-relaxed"><MarkdownLite text={p.instructions} onDark={false} /></div>
      </div>
    )}
    {p.skills.length > 0 && (
      <div>
        <p className="mb-1.5 text-[12px] font-semibold text-[var(--color-text-muted)]">Skills (loaded when a question matches)</p>
        <ul className="flex flex-col gap-1">
          {p.skills.map((k) => <li key={k.name} className="text-[13px]"><span className="font-medium">{k.name}</span> <span className="text-[var(--color-text-muted)]">· {k.whenToUse || k.description}</span></li>)}
        </ul>
      </div>
    )}
  </div>
);

const PluginDetail: React.FC<{ p: LotusPlugin }> = ({ p }) => {
  const [editing, setEditing] = useState(false);
  const [json, setJson] = useState('');
  const [errs, setErrs] = useState<string[]>([]);
  const [confirmDel, setConfirmDel] = useState(false);
  const exportFile = () => {
    const blob = new Blob([JSON.stringify(toFile(p), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.lotus-plugin.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const save = () => {
    try { const r = plugins.update(p.id, JSON.parse(json)); if (r.plugin) { setEditing(false); setErrs([]); } else setErrs(r.errors); }
    catch (e) { setErrs([`That is not valid JSON: ${(e as Error).message}`]); }
  };
  return (
    <div className="p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="text-[12px] text-[var(--color-text-muted)]">{p.origin === 'imported' ? 'Imported' : 'Created'} {new Date(p.created).toLocaleDateString()}</span>
        <div className="flex-1" />
        <label className="inline-flex items-center gap-2 text-[13px]">{p.enabled ? 'On' : 'Off'}<Toggle checked={p.enabled} onChange={(v) => plugins.setEnabled(p.id, v)} ariaLabel={`${p.name} on`} /></label>
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          {errs.length > 0 && <Banner tone="error">{errs.join(' ')}</Banner>}
          <TextArea aria-label="Plugin JSON" value={json} onChange={(e) => setJson(e.target.value)} rows={18} className="font-mono text-[12px]" spellCheck={false} />
          <div className="flex justify-end gap-2"><Btn variant="ghost" onClick={() => { setEditing(false); setErrs([]); }}>Cancel</Btn><Btn variant="primary" onClick={save}>Save changes</Btn></div>
        </div>
      ) : <PluginSummary p={p} />}
      {!editing && (
        <div className="flex items-center gap-2 pt-3 border-t border-[var(--sep)]">
          <Btn onClick={() => { setJson(JSON.stringify(toFile(p), null, 2)); setEditing(true); }}>Edit</Btn>
          <Btn icon={<Download className="w-3.5 h-3.5" />} onClick={exportFile}>Export</Btn>
          <div className="flex-1" />
          {confirmDel
            ? <><span className="text-[12px] text-[var(--color-text-muted)]">Remove {p.name}?</span><Btn variant="ghost" onClick={() => setConfirmDel(false)}>Keep</Btn><Btn variant="danger" onClick={() => plugins.remove(p.id)}>Remove</Btn></>
            : <Btn variant="danger" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={() => setConfirmDel(true)}>Remove</Btn>}
        </div>
      )}
    </div>
  );
};

const IDEAS = ['A daily stand-up helper: /standup turns my notes into Yesterday / Today / Blockers', 'Physiotherapy exercise explainer that always adds safety notes and asks about pain level', 'Code reviewer: /review checks a diff for bugs, naming and missing tests'];

/** The plugin creator: describe → Lotus drafts with the plugin-creator skill → review → install. */
const PluginCreator: React.FC<{ onInstalled: (id: string) => void }> = ({ onInstalled }) => {
  const [idea, setIdea] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [json, setJson] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);

  const run = async (fb?: string) => {
    setBusy(true); setError('');
    ctrl.current = new AbortController();
    try {
      const r = await draftPlugin(idea, { previous: fb ? draft?.raw : undefined, feedback: fb, signal: ctrl.current.signal });
      setDraft(r); setJson(null); setFeedback('');
    } catch (e) { if ((e as Error).name !== 'AbortError') setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const fromJson = (text: string) => {
    try { const raw = JSON.parse(text); setDraft({ raw, ...validatePlugin(raw, plugins.get()) }); setError(''); }
    catch (e) { setError(`That is not valid JSON: ${(e as Error).message}`); }
  };
  const install = () => {
    const r = plugins.install(draft?.raw, 'created');
    if (r.id) onInstalled(r.id); else setDraft((d) => (d ? { ...d, ...r } : d));
  };

  return (
    <div className="p-5 flex flex-col gap-4 max-w-[680px]">
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 shrink-0 rounded-[10px] inline-flex items-center justify-center bg-[var(--color-accent-pastel)] text-[var(--petal-violet)]"><Wand2 className="w-4.5 h-4.5" /></span>
        <div>
          <h3 className="text-[18px] font-semibold">Create a plugin</h3>
          <p className="text-[13px] text-[var(--color-text-muted)]">Describe what it should do. Lotus drafts it with the built-in <span className="font-mono">plugin-creator</span> skill on your local model; you review it before anything is installed. Plugins are instructions, commands and notes; they never run code.</p>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <TextArea aria-label="Plugin idea" value={idea} onChange={(e) => setIdea(e.target.value)} rows={4} placeholder="e.g. A meeting-notes plugin: /minutes turns a transcript into decisions, owners and dates" />
        {!idea && (
          <div className="flex flex-wrap gap-1.5">
            {IDEAS.map((i) => <button key={i} type="button" onClick={() => setIdea(i)} className="px-2 h-7 rounded-[6px] text-[12px] bg-[var(--hover)] hover:bg-[var(--pressed)] text-left truncate max-w-full">{i}</button>)}
          </div>
        )}
        <div className="flex items-center gap-2">
          <Btn variant="primary" icon={<Wand2 className="w-3.5 h-3.5" />} loading={busy && !feedback} disabled={!idea.trim() || busy} onClick={() => void run()}>{draft ? 'Draft again' : 'Draft with Lotus'}</Btn>
          {busy && <Btn variant="ghost" onClick={() => ctrl.current?.abort()}>Cancel</Btn>}
          <div className="flex-1" />
          <Btn variant="ghost" onClick={() => { setJson(JSON.stringify(BLANK, null, 2)); setDraft(null); }}>Start from a blank template</Btn>
        </div>
      </div>
      {error && <Banner tone="error">{error}</Banner>}

      {json !== null && (
        <div className="flex flex-col gap-2">
          <TextArea aria-label="Plugin JSON" value={json} onChange={(e) => setJson(e.target.value)} rows={14} className="font-mono text-[12px]" spellCheck={false} />
          <div className="flex justify-end"><Btn onClick={() => fromJson(json)}>Check</Btn></div>
        </div>
      )}

      {draft && (
        <div className="flex flex-col gap-3 p-4 rounded-[12px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep),var(--shadow-1)]">
          {draft.errors.length > 0 && <Banner tone="error">{draft.errors.join(' ')}</Banner>}
          {draft.warnings.length > 0 && <Banner tone="warn">{draft.warnings.join(' ')}</Banner>}
          {draft.plugin && <PluginSummary p={draft.plugin} />}
          <div className="flex items-center gap-2 pt-3 border-t border-[var(--sep)]">
            <input value={feedback} onChange={(e) => setFeedback(e.target.value)} aria-label="Ask for changes" placeholder="Ask for changes, e.g. “add a /weekly command”"
              onKeyDown={(e) => { if (e.key === 'Enter' && feedback.trim() && !busy) void run(feedback); }}
              className="flex-1 h-7 px-2.5 rounded-[6px] bg-[var(--hover)] text-[13px] focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)]" />
            <Btn loading={busy && !!feedback} disabled={!feedback.trim() || busy || !draft.raw} onClick={() => void run(feedback)}>Revise</Btn>
            <Btn variant="ghost" onClick={() => setJson(JSON.stringify(draft.raw, null, 2))}>Edit JSON</Btn>
            <Btn variant="primary" disabled={!draft.plugin} onClick={install}>Install</Btn>
          </div>
        </div>
      )}
    </div>
  );
};
