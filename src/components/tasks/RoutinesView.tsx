import React, { useMemo, useState } from 'react';
import { AlarmClock, AlertCircle, Check, Loader2, Play, Plus, Trash2 } from 'lucide-react';
import { Routine, routines as store } from '../../tasks/store';
import { cronFromPreset, describeCron, nextRun, validateCron } from '../../tasks/cron';
import { MarkdownLite } from '../../lib/markdownLite';
import { InspectorPane, PaneBar, Section, SidebarPane } from '../common/Pane';
import { Toggle } from '../common/Toggle';
import { Banner, Btn, Checkbox, Empty, IconBtn, Label, Segmented, Select, TextArea, TextInput, cx } from '../common/ui';

type Preset = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'custom';
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const EXAMPLES: { name: string; prompt: string; schedule: string; action: Routine['action']; web: boolean }[] = [
  { name: 'Morning briefing', prompt: 'Give me a short briefing of the most important tech and AI news from the last 24 hours, with links.', schedule: '45 7 * * 1-5', action: 'log', web: true },
  { name: 'Weekly review prompt', prompt: 'Write a short checklist to help me review my week: what went well, what slipped, and three priorities for next week.', schedule: '0 17 * * 5', action: 'card', web: false },
];

const fmt = (t?: number) => (t ? new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

const Editor: React.FC<{ r: Routine }> = ({ r }) => {
  const [name, setName] = useState(r.name);
  const [prompt, setPrompt] = useState(r.prompt);
  const [cron, setCron] = useState(r.schedule);
  const [preset, setPreset] = useState<Preset>('custom');
  const [time, setTime] = useState('09:00');
  const [weekday, setWeekday] = useState(1);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(0);
  const cronErr = validateCron(cron);
  const upcoming = useMemo(() => {
    if (cronErr) return [];
    const out: Date[] = []; let d = new Date();
    for (let i = 0; i < 3; i++) { const n = nextRun(cron, d); if (!n) break; out.push(n); d = n; }
    return out;
  }, [cron, cronErr]);

  const applyPreset = (p: Preset, t = time, w = weekday) => {
    setPreset(p);
    if (p !== 'custom') setCron(cronFromPreset(p, t, w));
  };
  const save = () => {
    const e = store.update(r.id, { name: name.trim() || r.name, prompt: prompt.trim(), schedule: cron.trim() });
    setErr(e);
  };
  const dirty = name !== r.name || prompt !== r.prompt || cron !== r.schedule;

  return (
    <InspectorPane label="Routine" className="!w-auto flex-1 !border-l-0" pinned>
      <PaneBar>
        <AlarmClock className="w-4 h-4 text-[var(--color-accent-vibrant)]" aria-hidden="true" />
        <span className="text-[13px] font-semibold flex-1 truncate">{r.name}</span>
        <Toggle size="sm" checked={r.enabled} onChange={(v) => store.update(r.id, { enabled: v })} ariaLabel={r.enabled ? 'Routine on' : 'Routine off'} />
        <Btn size="sm" icon={r.running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} disabled={r.running} onClick={() => store.run(r.id)}>Run Now</Btn>
        <IconBtn label="Delete routine" onClick={() => store.remove(r.id)}><Trash2 className="w-4 h-4" /></IconBtn>
      </PaneBar>
      <div className="flex-1 overflow-y-auto">
        <Section title="What to do">
          <Label>Name</Label>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} aria-label="Routine name" className="mb-2.5" />
          <Label>Instructions for Lotus</Label>
          <TextArea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label="Instructions" placeholder="For example: summarise the newest Ollama release notes and say whether I should update." />
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            <div><Label>Then</Label>
              <Select aria-label="What to do with the result" value={r.action} onChange={(e) => store.update(r.id, { action: e.target.value as Routine['action'] })}>
                <option value="log">Keep the answer here</option>
                <option value="card">Post it to the board (Review)</option>
                <option value="task">Add a task for Lotus to work through</option>
              </Select></div>
            <div className="flex flex-col justify-end gap-1.5 pb-0.5">
              <Checkbox checked={r.web} onChange={(v) => store.update(r.id, { web: v })} label="Search the web first" />
              <Checkbox checked={r.catchUp} onChange={(v) => store.update(r.id, { catchUp: v })} label="Catch up if missed" />
            </div>
          </div>
        </Section>
        <Section title="When" hint="Routines run while Lotus is open, including when it is hidden in the tray. Times are this computer’s local time.">
          <Segmented<Preset> label="Schedule" value={preset} onChange={(p) => applyPreset(p)} className="flex-wrap"
            options={[{ id: 'hourly', label: 'Hourly' }, { id: 'daily', label: 'Daily' }, { id: 'weekdays', label: 'Weekdays' }, { id: 'weekly', label: 'Weekly' }, { id: 'monthly', label: 'Monthly' }, { id: 'custom', label: 'Cron' }]} />
          {preset !== 'custom' && (
            <div className="mt-2 flex gap-2">
              <TextInput type="time" aria-label="Time" value={time} onChange={(e) => { setTime(e.target.value); applyPreset(preset, e.target.value); }} className="!w-[120px]" />
              {preset === 'weekly' && <span className="w-[160px]"><Select aria-label="Weekday" value={weekday} onChange={(e) => { const w = Number(e.target.value); setWeekday(w); applyPreset(preset, time, w); }}>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</Select></span>}
            </div>
          )}
          <div className="mt-2"><Label hint={cronErr ? '' : describeCron(cron)}>Cron expression</Label>
            <TextInput value={cron} onChange={(e) => { setCron(e.target.value); setPreset('custom'); }} aria-label="Cron expression" className="font-mono" aria-invalid={!!cronErr} /></div>
          {cronErr ? <p className="mt-1 text-[12px] text-[var(--c-red)]">{cronErr}</p>
            : <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">Next: {upcoming.map((d) => fmt(d.getTime())).join(' · ') || 'never'}</p>}
        </Section>
        {err && <div className="px-4 pt-3"><Banner tone="error">{err}</Banner></div>}
        <div className="px-4 py-3 flex justify-end"><Btn variant="primary" disabled={!dirty || !!cronErr || !prompt.trim()} onClick={save}>Save Changes</Btn></div>
        <Section title={`Runs${r.runs.length ? ` · ${r.runs.length}` : ''}`}>
          {!r.runs.length && <p className="text-[13px] text-[var(--color-text-muted)]">No runs yet. Next run: {fmt(r.enabled ? r.nextRun : undefined)}.</p>}
          <ul className="space-y-1.5">
            {r.runs.map((run, i) => (
              <li key={run.at} className="rounded-[8px] bg-[var(--hover)]">
                <button type="button" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} className="w-full flex items-center gap-2 px-2.5 h-8 text-[12px]">
                  {run.ok ? <Check className="w-3.5 h-3.5 text-[var(--c-green)]" /> : <AlertCircle className="w-3.5 h-3.5 text-[var(--c-red)]" />}
                  <span className="font-medium">{fmt(run.at)}</span>
                  <span className="text-[var(--color-text-muted)]">{(run.ms / 1000).toFixed(1)} s</span>
                </button>
                {open === i && <div className={cx('px-3 pb-2.5 text-[13px] leading-relaxed', !run.ok && 'text-[var(--c-red)]')}><MarkdownLite text={run.output} onDark={false} /></div>}
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </InspectorPane>
  );
};

export const RoutinesView: React.FC<{ list: Routine[] }> = ({ list }) => {
  const [sel, setSel] = useState<string | null>(list[0]?.id ?? null);
  const cur = list.find((r) => r.id === sel) ?? list[0];
  const add = (ex?: typeof EXAMPLES[number]) => {
    const r = store.add(ex ?? { name: 'New routine', prompt: '', schedule: '0 9 * * *', action: 'log', web: false });
    if (typeof r !== 'string') setSel(r.id);
  };
  return (
    <div className="flex-1 min-h-0 flex">
      <SidebarPane label="Routines">
        <PaneBar><span className="text-[13px] font-semibold flex-1">Routines</span><IconBtn label="New routine" onClick={() => add()}><Plus className="w-4 h-4" /></IconBtn></PaneBar>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {list.map((r) => (
            <button key={r.id} type="button" onClick={() => setSel(r.id)} aria-current={cur?.id === r.id ? 'true' : undefined}
              className={cx('w-full text-left px-2.5 py-2 rounded-[8px]', cur?.id === r.id ? 'bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep),var(--shadow-1)]' : 'hover:bg-[var(--hover)]')}>
              <span className="flex items-center gap-1.5">
                <span className={cx('w-1.5 h-1.5 rounded-full shrink-0', r.enabled ? 'bg-[var(--c-green)]' : 'bg-[var(--color-text-muted)] opacity-50')} aria-hidden="true" />
                <span className="text-[13px] font-medium truncate flex-1">{r.name}</span>
                {r.running && <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--color-accent-vibrant)]" aria-label="Running" />}
              </span>
              <span className="block pl-3 text-[12px] text-[var(--color-text-muted)] truncate">{r.enabled ? describeCron(r.schedule) : 'Off'}</span>
            </button>
          ))}
          {!list.length && <p className="px-2 py-3 text-[12px] text-[var(--color-text-muted)]">No routines yet.</p>}
        </div>
      </SidebarPane>
      {cur ? <Editor key={cur.id} r={cur} /> : (
        <div className="flex-1 flex">
          <Empty icon={<AlarmClock className="w-5 h-5" />} className="flex-1" title="Scheduled routines"
            body="Lotus can run instructions on a schedule with your local model: a morning briefing, a weekly checklist, a task it then works through. They run while Lotus is open."
            action={<div className="flex gap-2 flex-wrap justify-center"><Btn variant="primary" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => add()}>New Routine</Btn>{EXAMPLES.map((e) => <Btn key={e.name} onClick={() => add(e)}>{e.name}</Btn>)}</div>} />
        </div>
      )}
    </div>
  );
};
