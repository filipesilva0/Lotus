import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Boxes, Check, Cpu, Download, Image as ImageIcon, Mic, Plus, Power, PowerOff, Search, Sparkles, Square, Swords, Trash2, ThumbsUp, Eye, EyeOff, Play, MessageSquare } from 'lucide-react';
import { ollamaClient, OllamaModel, RunningModel } from '../../services/ollamaService';
import { comfy, ComfyStats } from '../../services/comfyService';
import { voicebox, Health } from '../../services/voicebox';
import { requestLog, RequestLogEntry } from '../../lib/http';
import { EngineId } from '../../services/engineConfig';
import type { EngineState } from '../../hooks/useEngines';
import { usePersisted, uid } from '../../lib/persist';
import { CATALOG, CatalogModel, ModelTag, QUANTS, Quant, estimateVram, fmtGB, paramsOf } from '../../models/catalog';
import { Banner, Btn, Card, Empty, Gauge, cx } from '../common/ui';
import { ActiveDownloads } from '../models/ActiveDownloads';
import { AddModelDialog, ModelKind } from '../models/AddModelDialog';
import { ImageModelsHub } from '../models/ImageModelsHub';
import { VoiceModelsHub } from '../models/VoiceModelsHub';
import { useFileDownloads } from '../models/useFileDownloads';
import { findModelsDir, savedModelsDir, setSavedModelsDir } from '../../services/downloadService';
import { InspectorPane, KV, Section, SidebarPane } from '../common/Pane';
import { reportActivity } from '../../lib/bus';
import { ScalingCard } from '../hardware/ScalingCard';

type Mode = 'hub' | 'arena' | 'monitor';
interface Props { engines: Record<EngineId, EngineState>; onOpenEngines: () => void }

// ── Shared pull state (one download at a time) ──────────────────────────────
function usePull(onDone: () => void) {
  const [name, setName] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [frac, setFrac] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const start = useCallback(async (model: string) => {
    if (ctrl.current) return;
    const c = new AbortController(); ctrl.current = c;
    setName(model); setError(null); setStatus('Starting…'); setFrac(null);
    const id = `pull-${model}`;
    reportActivity({ id, kind: 'download', label: model, progress: 0 });
    try {
      for await (const p of ollamaClient.pull(model, c.signal)) {
        setStatus(p.status);
        const f = p.total ? (p.completed ?? 0) / p.total : null;
        setFrac(f);
        reportActivity({ id, kind: 'download', label: model, progress: f ?? undefined });
      }
      onDone();
    } catch (e) { if (!c.signal.aborted) setError((e as Error).message); }
    finally { ctrl.current = null; setName(null); reportActivity({ id, kind: 'download', label: model, done: true }); }
  }, [onDone]);
  return { name, status, frac, error, start, cancel: () => ctrl.current?.abort(), clearError: () => setError(null) };
}

// ── Hub ─────────────────────────────────────────────────────────────────────
const Hub: React.FC<{ q: string; installed: OllamaModel[]; running: RunningModel[]; refresh: () => void; pull: ReturnType<typeof usePull>; vramGb: number | null; ollamaUp: boolean | null; selected: string | null; onSelect: (n: string | null) => void; onOpenEngines: () => void }> = ({ q, installed, running, refresh, pull, vramGb, ollamaUp, selected, onSelect, onOpenEngines }) => {
  const [filter, setFilter] = useState<ModelTag | 'Installed' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const needle = q.trim().toLowerCase();
  const act = async (name: string, fn: () => Promise<void>) => { setBusy(name); setErr(null); try { await fn(); refresh(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); } };

  const inst = installed.filter((m) => (!needle || m.name.toLowerCase().includes(needle)) && (!filter || filter === 'Installed'));
  const cat = CATALOG.filter((m) => (!needle || `${m.title} ${m.id} ${m.maker}`.toLowerCase().includes(needle)) && (!filter || (filter !== 'Installed' && m.tags.includes(filter))));

  return (
    <div className="space-y-6">
      {ollamaUp === false && <Banner tone="warn" action={<Btn size="sm" variant="secondary" onClick={onOpenEngines}>Engines</Btn>}>Ollama isn't running. You can browse, but downloads and loading need it.</Banner>}
      {err && <Banner tone="error">{err}</Banner>}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter">
        {(['Installed', 'Coding', 'Reasoning', 'Vision', 'Small'] as const).map((t) => (
          <button key={t} type="button" aria-pressed={filter === t} onClick={() => setFilter(filter === t ? null : t)} className={cx('h-7 px-3 rounded-full text-[12px] font-medium', filter === t ? 'bg-[var(--color-accent-fill)] text-white' : 'bg-[var(--hover)] hover:bg-[var(--pressed)]')}>{t}</button>
        ))}
      </div>

      <section>
        <h2 className="text-[13px] font-semibold mb-2">Installed ({inst.length})</h2>
        {!inst.length && <p className="text-[13px] text-[var(--color-text-muted)]">{ollamaUp ? 'No installed models match.' : 'Start Ollama to list installed models.'}</p>}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">
          {inst.map((m) => {
            const run = running.find((r) => r.name === m.name);
            return (
              <Card key={m.name} className={cx('p-3.5 cursor-default', selected === m.name && 'shadow-[0_0_0_2px_var(--color-accent-fill)]')} onClick={() => onSelect(m.name)}>
                <div className="flex items-start gap-2"><div className="flex-1 min-w-0"><p className="text-[14px] font-semibold truncate">{m.name}</p><p className="text-[12px] text-[var(--color-text-muted)]">{[m.details?.parameter_size, m.details?.quantization_level, fmtGB(m.size)].filter(Boolean).join(' · ')}</p></div>
                  {run && <span className="px-1.5 h-5 inline-flex items-center rounded-[5px] bg-[var(--c-green)]/15 text-[var(--c-green)] text-[11px] font-semibold">Loaded</span>}</div>
                <div className="mt-3 flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                  {run ? <Btn size="sm" loading={busy === m.name} icon={<PowerOff className="w-3 h-3" />} onClick={() => void act(m.name, () => ollamaClient.unload(m.name))}>Unload</Btn>
                    : <Btn size="sm" variant="primary" loading={busy === m.name} icon={<Power className="w-3 h-3" />} disabled={!ollamaUp} onClick={() => void act(m.name, () => ollamaClient.load(m.name))}>Load model</Btn>}
                  <Btn size="sm" variant="danger" icon={<Trash2 className="w-3 h-3" />} onClick={() => { if (window.confirm(`Delete the weights for ${m.name}? This frees ${fmtGB(m.size)}.`)) void act(m.name, () => ollamaClient.deleteModel(m.name)); }}>Delete weights</Btn>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="text-[13px] font-semibold mb-2">Suggested to download</h2>
        {!cat.length && <p className="text-[13px] text-[var(--color-text-muted)]">Nothing matches. Use “Add model” to download any model by name.</p>}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">{cat.map((m) => <CatalogCard key={m.id} m={m} installed={installed} pull={pull} vramGb={vramGb} />)}</div>
      </section>
    </div>
  );
};

const CatalogCard: React.FC<{ m: CatalogModel; installed: OllamaModel[]; pull: ReturnType<typeof usePull>; vramGb: number | null }> = ({ m, installed, pull, vramGb }) => {
  const [size, setSize] = useState(m.sizes.find((s) => s >= 7) ?? m.sizes[m.sizes.length - 1]);
  const [quant, setQuant] = useState<Quant>('default');
  const bpw = QUANTS.find((x) => x.id === quant)!.bpw;
  const need = estimateVram(size, bpw);
  const tag = quant === 'default' || !m.quantTag ? `${m.id}:${size}b` : m.quantTag(size, quant);
  const have = installed.some((i) => i.name === tag || i.name === `${tag}`);
  const fit = vramGb ? (need <= vramGb ? 'fits' : need <= vramGb * 1.5 ? 'partial' : 'no') : null;
  return (
    <Card className="p-3.5">
      <div className="flex items-start justify-between gap-2"><div><p className="text-[14px] font-semibold">{m.title}</p><p className="text-[12px] text-[var(--color-text-muted)]">{m.maker}</p></div>
        <div className="flex gap-1 flex-wrap justify-end">{m.tags.map((t) => <span key={t} className="px-1.5 h-5 inline-flex items-center rounded-[5px] bg-[var(--hover)] text-[11px] font-medium">{t}</span>)}</div></div>
      <p className="mt-1.5 text-[12px] text-[var(--color-text-muted)] leading-snug">{m.blurb}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-[11px] text-[var(--color-text-muted)]">Size<select aria-label={`${m.title} size`} value={size} onChange={(e) => setSize(parseFloat(e.target.value))} className="mt-0.5 w-full h-7 px-1.5 rounded-[6px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)] text-[12px] text-[var(--color-text-main)]">{m.sizes.map((s) => <option key={s} value={s}>{s}B</option>)}</select></label>
        <label className="text-[11px] text-[var(--color-text-muted)]">Quantisation<select aria-label={`${m.title} quantisation`} value={quant} onChange={(e) => setQuant(e.target.value as Quant)} disabled={!m.quantTag} title={m.quantTag ? undefined : 'This model is only listed in its default build. Use Import / Download with a Hugging Face path for others.'} className="mt-0.5 w-full h-7 px-1.5 rounded-[6px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)] text-[12px] text-[var(--color-text-main)] disabled:opacity-50">{QUANTS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
      </div>
      <p className="mt-2 text-[12px] tabular-nums">≈ {need} GB video memory{fit && <span className={cx('ml-2 font-medium', fit === 'fits' ? 'text-[var(--c-green)]' : fit === 'partial' ? 'text-[var(--c-orange)]' : 'text-[var(--c-red)]')}>{fit === 'fits' ? 'fits your GPU' : fit === 'partial' ? 'will spill into RAM' : 'too large for your GPU'}</span>}</p>
      <p className="text-[11px] text-[var(--color-text-muted)] font-mono truncate">{tag}</p>
      <div className="mt-2.5">{have ? <span className="inline-flex items-center gap-1 text-[12px] text-[var(--c-green)] font-medium"><Check className="w-3.5 h-3.5" />Installed</span>
        : <Btn size="sm" variant="primary" icon={<Download className="w-3 h-3" />} disabled={!!pull.name} onClick={() => void pull.start(tag)}>Download</Btn>}</div>
    </Card>
  );
};

// ── Arena ───────────────────────────────────────────────────────────────────
interface ArenaCol { model: string; text: string; ttft: number | null; tps: number | null; total: number | null; tokens: number; state: 'idle' | 'running' | 'done' | 'error'; error?: string }
interface ArenaRecord { id: string; ts: number; prompt: string; winner: string | null; results: { model: string; ttft: number | null; tps: number | null; total: number | null }[] }

const Arena: React.FC<{ installed: OllamaModel[]; history: ArenaRecord[]; setHistory: React.Dispatch<React.SetStateAction<ArenaRecord[]>>; ollamaUp: boolean | null }> = ({ installed, history, setHistory, ollamaUp }) => {
  const [picked, setPicked] = usePersisted<string[]>('lotus.arena.models.v1', []);
  const [prompt, setPrompt] = useState('');
  const [blind, setBlind] = useState(false);
  const [cols, setCols] = useState<ArenaCol[]>([]);
  const [voted, setVoted] = useState<string | null>(null);
  const [rec, setRec] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const names = installed.map((m) => m.name);
  const valid = picked.filter((p) => names.includes(p));
  const running = cols.some((c) => c.state === 'running');
  const order = useMemo(() => cols.map((_, i) => i).sort(() => Math.random() - 0.5), [rec]); // eslint-disable-line react-hooks/exhaustive-deps
  const label = (i: number) => `Model ${String.fromCharCode(65 + order.indexOf(i))}`;

  const toggle = (n: string) => setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : p.length >= 3 ? p : [...p, n]));

  const run = async () => {
    if (!prompt.trim() || valid.length < 2 || running) return;
    const c = new AbortController(); ctrl.current = c;
    setVoted(null); const id = uid('arena'); setRec(id);
    const init: ArenaCol[] = valid.map((model) => ({ model, text: '', ttft: null, tps: null, total: null, tokens: 0, state: 'running' }));
    setCols(init);
    const upd = (i: number, p: Partial<ArenaCol>) => setCols((cs) => cs.map((c2, j) => (j === i ? { ...c2, ...p } : c2)));
    await Promise.all(valid.map(async (model, i) => {
      const t0 = performance.now(); let first = 0, acc = '', toks = 0;
      try {
        let final: any = null;
        const stream = ollamaClient.streamChat([{ role: 'user', content: prompt }], { model, signal: c.signal, temperature: 0.7, onFinal: (f) => { final = f; } });
        for await (const t of stream) {
          if (!first) { first = performance.now(); upd(i, { ttft: Math.round(first - t0) }); }
          acc += t; toks++;
          upd(i, { text: acc, tokens: toks });
        }
        const total = Math.round(performance.now() - t0);
        const tps = final?.eval_count && final?.eval_duration ? Math.round((final.eval_count / (final.eval_duration / 1e9)) * 10) / 10 : Math.round((toks / Math.max(0.001, (performance.now() - first) / 1000)) * 10) / 10;
        upd(i, { state: 'done', total, tps, tokens: final?.eval_count ?? toks });
      } catch (e) { upd(i, { state: c.signal.aborted ? 'done' : 'error', error: c.signal.aborted ? undefined : (e as Error).message }); }
    }));
    ctrl.current = null;
  };

  const vote = (model: string) => {
    setVoted(model);
    setHistory((h) => [{ id: rec ?? uid('arena'), ts: Date.now(), prompt, winner: model, results: cols.map((c) => ({ model: c.model, ttft: c.ttft, tps: c.tps, total: c.total })) }, ...h].slice(0, 100));
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="p-4 border-b border-[var(--sep)] space-y-3">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Models to compare (pick 2 or 3)">
          {!names.length && <span className="text-[13px] text-[var(--color-text-muted)]">{ollamaUp ? 'Install at least two models in the Hub first.' : 'Start Ollama to list installed models.'}</span>}
          {names.map((n) => <button key={n} type="button" aria-pressed={valid.includes(n)} onClick={() => toggle(n)} className={cx('h-7 px-3 rounded-full text-[12px] font-medium', valid.includes(n) ? 'bg-[var(--color-accent-fill)] text-white' : 'bg-[var(--hover)] hover:bg-[var(--pressed)]')}>{n}</button>)}
        </div>
        <div className="flex gap-2 items-end">
          <textarea aria-label="Prompt to test" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} placeholder="Type one prompt to send to every selected model"
            className="flex-1 resize-none p-2.5 rounded-[8px] bg-[var(--color-bg-card)] text-[13px] shadow-[inset_0_0_0_0.5px_var(--sep)] focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)]" />
          <div className="flex flex-col gap-1.5">
            <label className="inline-flex items-center gap-1.5 text-[12px]"><input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} />{blind ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}Blind test</label>
            {running ? <Btn icon={<Square className="w-3 h-3" fill="currentColor" />} onClick={() => ctrl.current?.abort()}>Stop</Btn>
              : <Btn variant="primary" icon={<Play className="w-3 h-3" />} disabled={!prompt.trim() || valid.length < 2 || !ollamaUp} onClick={() => void run()}>Run</Btn>}
          </div>
        </div>
        <p className="text-[11px] text-[var(--color-text-muted)]">Requests go out together. If the models don't all fit in video memory at once, Ollama loads them in turn and the first-token time includes that load.</p>
      </div>
      {!cols.length ? <Empty icon={<Swords className="w-5 h-5" />} title="Compare models side by side" body="Pick two or three installed models, enter a prompt and press Run." className="flex-1" /> : (
        <div className="flex-1 min-h-0 grid gap-px bg-[var(--sep)]" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
          {cols.map((c, i) => {
            const hide = blind && !voted;
            return (
              <div key={c.model} className="bg-[var(--color-bg-panel)] min-w-0 flex flex-col min-h-0">
                <div className="px-3 h-9 flex items-center justify-between border-b border-[var(--sep)]"><span className="text-[13px] font-semibold truncate">{hide ? label(i) : c.model}</span>{c.state === 'running' && <span className="text-[11px] text-[var(--color-text-muted)] animate-pulse">Generating…</span>}</div>
                <div className="grid grid-cols-3 gap-2 px-3 py-2 text-center border-b border-[var(--sep)]">
                  {[['First token', c.ttft !== null ? `${c.ttft} ms` : '—'], ['Speed', c.tps !== null ? `${c.tps} tok/s` : c.state === 'running' && c.tokens ? '…' : '—'], ['Total', c.total !== null ? `${(c.total / 1000).toFixed(1)} s` : '—']].map(([k, v]) => (
                    <div key={k}><p className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">{k}</p><p className="text-[13px] font-semibold tabular-nums">{v}</p></div>
                  ))}
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap">{c.error ? <span className="text-[var(--c-red)]">{c.error}</span> : c.text || <span className="text-[var(--color-text-muted)]">Waiting…</span>}</div>
                <div className="p-2 border-t border-[var(--sep)]">
                  <Btn size="sm" className="w-full" variant={voted === c.model ? 'primary' : 'secondary'} disabled={running || !!voted || c.state === 'error'} icon={<ThumbsUp className="w-3 h-3" />} onClick={() => vote(c.model)}>{voted === c.model ? 'Winner' : 'This one is better'}</Btn>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── Monitor ─────────────────────────────────────────────────────────────────
const Spark: React.FC<{ values: number[]; max: number; label: string; color?: string }> = ({ values, max, label, color = 'var(--color-accent-fill)' }) => {
  const w = 240, h = 56;
  const pts = values.map((v, i) => `${(i / Math.max(1, 59)) * w},${h - Math.min(1, v / Math.max(0.0001, max)) * (h - 4) - 2}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className="w-full h-14 rounded-[6px] bg-[var(--hover)]">
      {values.length > 1 && <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />}
    </svg>
  );
};

interface Sample { vram: number; ram: number; ollama: number; vbox: number }
const Monitor: React.FC<{ engines: Record<EngineId, EngineState> }> = ({ engines }) => {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [stats, setStats] = useState<ComfyStats | null>(null);
  const [ps, setPs] = useState<RunningModel[]>([]);
  const [vb, setVb] = useState<Health | null>(null);
  const [log, setLog] = useState<RequestLogEntry[]>([...requestLog.entries()]);
  const [onlyErr, setOnlyErr] = useState(false);
  useEffect(() => requestLog.subscribe(() => setLog([...requestLog.entries()])), []);

  useEffect(() => {
    let off = false;
    const tick = async () => {
      const [s, p, h] = await Promise.all([
        engines.comfyui.up ? comfy.stats().catch(() => null) : Promise.resolve(null),
        engines.ollama.up ? ollamaClient.runningModels().catch(() => [] as RunningModel[]) : Promise.resolve([] as RunningModel[]),
        engines.voicebox.up ? voicebox.health().catch(() => null) : Promise.resolve(null),
      ]);
      if (off) return;
      setStats(s); setPs(p); setVb(h);
      setSamples((a) => [...a, {
        vram: s ? s.vramTotalGb - s.vramFreeGb : 0, ram: s && s.ramTotalGb ? s.ramTotalGb - s.ramFreeGb : 0,
        ollama: p.reduce((n, m) => n + m.size_vram, 0) / 1024 ** 3, vbox: (h?.vram_used_mb ?? 0) / 1024,
      }].slice(-60));
    };
    void tick(); const t = setInterval(tick, 2000);
    return () => { off = true; clearInterval(t); };
  }, [engines.comfyui.up, engines.ollama.up, engines.voicebox.up]);

  const ollamaVram = ps.reduce((n, m) => n + m.size_vram, 0) / 1024 ** 3;
  const shown = (onlyErr ? log.filter((l) => l.status === 'error' || (typeof l.status === 'number' && l.status >= 400)) : log).slice(-120).reverse();

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5">
      <div className="grid grid-cols-3 gap-3">
        {(['ollama', 'comfyui', 'voicebox'] as EngineId[]).map((id) => {
          const e = engines[id];
          return <Card key={id} className="p-3.5"><div className="flex items-center gap-2"><span className={cx('w-2.5 h-2.5 rounded-full', e.up ? 'bg-[var(--c-green)]' : e.up === null ? 'bg-[var(--c-orange)] animate-pulse' : 'bg-[var(--c-red)]')} /><span className="text-[14px] font-semibold capitalize">{id === 'comfyui' ? 'ComfyUI' : id}</span></div>
            <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">{e.up ? `Online${e.version ? ` · v${e.version}` : ''}` : e.up === null ? 'Checking…' : 'Offline'}{e.supervised ? ' · started by Lotus' : ''}</p></Card>;
        })}
      </div>

      <ScalingCard />

      <div className="grid grid-cols-2 gap-3">
        <Card className="p-3.5"><div className="flex justify-between text-[13px] mb-1.5"><span className="font-semibold">GPU video memory</span><span className="tabular-nums text-[var(--color-text-muted)]">{stats && stats.vramTotalGb ? `${(stats.vramTotalGb - stats.vramFreeGb).toFixed(1)} / ${stats.vramTotalGb.toFixed(1)} GB` : '—'}</span></div>
          {stats && stats.vramTotalGb ? <><Gauge value={(stats.vramTotalGb - stats.vramFreeGb) / stats.vramTotalGb} label="Video memory" className="mb-2" /><Spark values={samples.map((s) => s.vram)} max={stats.vramTotalGb} label="Video memory over the last two minutes" /><p className="mt-1.5 text-[11px] text-[var(--color-text-muted)]">{stats.device} · whole-GPU figure reported by ComfyUI</p></> : <p className="text-[12px] text-[var(--color-text-muted)]">GPU memory is read from ComfyUI. Start it to see this.</p>}</Card>
        <Card className="p-3.5"><div className="flex justify-between text-[13px] mb-1.5"><span className="font-semibold">System memory</span><span className="tabular-nums text-[var(--color-text-muted)]">{stats && stats.ramTotalGb ? `${(stats.ramTotalGb - stats.ramFreeGb).toFixed(1)} / ${stats.ramTotalGb.toFixed(1)} GB` : '—'}</span></div>
          {stats && stats.ramTotalGb ? <><Gauge value={(stats.ramTotalGb - stats.ramFreeGb) / stats.ramTotalGb} label="System memory" className="mb-2" /><Spark values={samples.map((s) => s.ram)} max={stats.ramTotalGb} label="System memory over the last two minutes" color="var(--c-green)" /><p className="mt-1.5 text-[11px] text-[var(--color-text-muted)]">Reported by ComfyUI</p></> : <p className="text-[12px] text-[var(--color-text-muted)]">System memory is read from ComfyUI. Start it to see this.</p>}</Card>
        <Card className="p-3.5"><div className="flex justify-between text-[13px] mb-1.5"><span className="font-semibold">Ollama models in memory</span><span className="tabular-nums text-[var(--color-text-muted)]">{ps.length ? `${ollamaVram.toFixed(1)} GB on GPU` : 'none loaded'}</span></div>
          <Spark values={samples.map((s) => s.ollama)} max={Math.max(1, ...samples.map((s) => s.ollama))} label="Ollama video memory over time" color="var(--c-orange)" />
          <ul className="mt-2 space-y-0.5 text-[12px]">{ps.map((m) => <li key={m.name} className="flex justify-between"><span className="truncate">{m.name}</span><span className="tabular-nums text-[var(--color-text-muted)]">{fmtGB(m.size)} ({Math.round((m.size_vram / Math.max(1, m.size)) * 100)}% on GPU)</span></li>)}</ul></Card>
        <Card className="p-3.5"><div className="flex justify-between text-[13px] mb-1.5"><span className="font-semibold">Voicebox</span><span className="tabular-nums text-[var(--color-text-muted)]">{vb ? (vb.vram_used_mb ? `${(vb.vram_used_mb / 1024).toFixed(1)} GB` : vb.gpu_available ? 'GPU ready' : 'CPU') : '—'}</span></div>
          {vb ? <p className="text-[12px] text-[var(--color-text-muted)]">{[vb.gpu_type, vb.backend_type, vb.model_loaded ? `model loaded${vb.model_size ? ` (${vb.model_size})` : ''}` : 'no model loaded'].filter(Boolean).join(' · ')}</p> : <p className="text-[12px] text-[var(--color-text-muted)]">Start Voicebox to see its status.</p>}</Card>
      </div>

      <Card className="p-3.5"><div className="flex items-center gap-2 text-[13px] font-semibold"><Cpu className="w-4 h-4" />CPU load and temperature</div>
        <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">Not shown. None of your engines report them, and reading them needs a native helper that Lotus doesn't include. Use Task Manager for now.</p></Card>

      <section>
        <div className="flex items-center justify-between mb-2"><h2 className="text-[13px] font-semibold">Request log</h2>
          <div className="flex items-center gap-3"><label className="inline-flex items-center gap-1.5 text-[12px]"><input type="checkbox" checked={onlyErr} onChange={(e) => setOnlyErr(e.target.checked)} />Errors only</label><Btn size="sm" variant="ghost" onClick={() => { requestLog.entries().length = 0; setLog([]); }}>Clear</Btn></div></div>
        <div className="rounded-[10px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)] max-h-72 overflow-y-auto font-mono text-[11px]" role="log" aria-label="Requests Lotus made to the engines">
          {!shown.length && <p className="p-3 font-sans text-[12px] text-[var(--color-text-muted)]">Nothing yet. Calls Lotus makes to Ollama, ComfyUI and Voicebox appear here (routine status checks are hidden).</p>}
          {shown.map((l, i) => <div key={i} className="flex gap-3 px-3 py-1 border-b border-[var(--sep)] last:border-b-0"><span className="text-[var(--color-text-muted)] tabular-nums">{new Date(l.t).toLocaleTimeString()}</span><span className="w-12">{l.method}</span><span className="flex-1 truncate">{l.url}</span><span className={cx('w-10 text-right', l.status === 'error' || (typeof l.status === 'number' && l.status >= 400) ? 'text-[var(--c-red)]' : 'text-[var(--c-green)]')}>{l.status}</span><span className="w-14 text-right tabular-nums text-[var(--color-text-muted)]">{l.ms} ms</span></div>)}
        </div>
        <p className="mt-1.5 text-[11px] text-[var(--color-text-muted)]">Output from the engine programs themselves isn't captured: engines Lotus starts have their console output discarded.</p>
      </section>
    </div>
  );
};

// ── Workspace ───────────────────────────────────────────────────────────────
type LibKind = ModelKind;
const KINDS: { id: LibKind; label: string; icon: React.ReactNode }[] = [
  { id: 'language', label: 'Language models', icon: <MessageSquare className="w-4 h-4" /> },
  { id: 'image', label: 'Image checkpoints', icon: <ImageIcon className="w-4 h-4" /> },
  { id: 'lora', label: 'LoRAs', icon: <Sparkles className="w-4 h-4" /> },
  { id: 'voice', label: 'Voice models', icon: <Mic className="w-4 h-4" /> },
];

/** Engines → Models: every model Lotus uses (language, image, LoRA, voice), plus Arena and Monitor. */
export const ModelsWorkspace: React.FC<Props> = ({ engines, onOpenEngines }) => {
  const [gpuTotalGb, setGpuTotalGb] = useState<number | null>(null);
  useEffect(() => { if (engines.comfyui.up) void comfy.stats().then((s) => setGpuTotalGb(s.vramTotalGb || null)).catch(() => undefined); }, [engines.comfyui.up]);
  const [mode, setMode] = usePersisted<Mode>('lotus.models.mode.v1', 'hub');
  const [kind, setKind] = usePersisted<LibKind>('lotus.models.kind.v1', 'language');
  const [q, setQ] = useState('');
  const [installed, setInstalled] = useState<OllamaModel[]>([]);
  const [running, setRunning] = useState<RunningModel[]>([]);
  const [checkpoints, setCheckpoints] = useState<string[]>([]);
  const [loras, setLoras] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [voiceTick, setVoiceTick] = useState(0);
  const [modelsDir, setModelsDirState] = useState(savedModelsDir());
  const [history, setHistory] = usePersisted<ArenaRecord[]>('lotus.arena.history.v1', []);
  const up = engines.ollama.up;
  const comfyUp = engines.comfyui.up;

  const setModelsDir = (p: string) => { setSavedModelsDir(p); setModelsDirState(p); };
  useEffect(() => { if (!modelsDir) void findModelsDir().then((d) => d && setModelsDirState(d)); }, [modelsDir]);

  const refresh = useCallback(() => {
    if (!up) { setInstalled([]); setRunning([]); } else {
      void ollamaClient.listModels().then(setInstalled).catch(() => setInstalled([]));
      void ollamaClient.runningModels().then(setRunning).catch(() => setRunning([]));
    }
  }, [up]);
  useEffect(refresh, [refresh]);

  const refreshImages = useCallback(() => {
    if (!comfyUp) { setCheckpoints([]); setLoras([]); return; }
    void comfy.checkpoints().then(setCheckpoints).catch(() => setCheckpoints([]));
    void comfy.loras().then(setLoras);
  }, [comfyUp]);
  useEffect(refreshImages, [refreshImages]);
  useEffect(() => { window.addEventListener('focus', refreshImages); return () => window.removeEventListener('focus', refreshImages); }, [refreshImages]);

  const pull = usePull(refresh);
  const files = useFileDownloads(refreshImages);

  const sel = installed.find((m) => m.name === selected);
  const wins = useMemo(() => { const m = new Map<string, { w: number; n: number; tps: number[] }>(); history.forEach((h) => h.results.forEach((r) => { const e = m.get(r.model) ?? { w: 0, n: 0, tps: [] }; e.n++; if (h.winner === r.model) e.w++; if (r.tps) e.tps.push(r.tps); m.set(r.model, e); })); return [...m.entries()].sort((a, b) => b[1].w - a[1].w); }, [history]);

  const modes = [
    { id: 'hub' as const, label: 'Library', icon: <Boxes className="w-4 h-4" /> },
    { id: 'arena' as const, label: 'Arena & Benchmark', icon: <Swords className="w-4 h-4" /> },
    { id: 'monitor' as const, label: 'Hardware & Runtime', icon: <Activity className="w-4 h-4" /> },
  ];
  const navBtn = (on: boolean) => cx('w-full h-9 px-2.5 flex items-center gap-2.5 rounded-[8px] text-[13px] text-left', on ? 'bg-[var(--pressed)] font-medium' : 'text-[var(--color-text-muted)] hover:bg-[var(--hover)] hover:text-[var(--color-text-main)]');

  return (
    <div className="flex-1 min-h-0 flex bg-[var(--color-bg-panel)] overflow-hidden">
      <SidebarPane label="Models">
        <div className="p-3 space-y-2">
          <Btn variant="primary" className="w-full" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setAddOpen(true)}>Add model…</Btn>
          <div className="relative"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-muted)]" aria-hidden="true" />
            <input type="search" aria-label="Search models and benchmark history" placeholder="Search models" value={q} onChange={(e) => setQ(e.target.value)} className="w-full h-7 pl-8 pr-2 rounded-[6px] bg-[var(--hover)] text-[13px] placeholder:text-[var(--color-text-muted)] focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)]" /></div>
        </div>
        <nav className="px-2 space-y-0.5" aria-label="Modes">
          {modes.map((m) => <button key={m.id} type="button" aria-current={mode === m.id ? 'page' : undefined} onClick={() => setMode(m.id)} className={navBtn(mode === m.id)}>{m.icon}{m.label}</button>)}
        </nav>
        <div className="flex-1 min-h-0 overflow-y-auto px-2 py-3">
          {mode === 'hub' && (<>
            <h3 className="px-1.5 mb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--color-text-muted)]">Model type</h3>
            <nav className="space-y-0.5" aria-label="Model type">
              {KINDS.map((k) => <button key={k.id} type="button" aria-current={kind === k.id ? 'true' : undefined} onClick={() => setKind(k.id)} className={navBtn(kind === k.id)}>{k.icon}{k.label}</button>)}
            </nav>
          </>)}
          {mode === 'arena' && (<>
            <h3 className="px-1.5 mb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--color-text-muted)]">Benchmark history</h3>
            {history.filter((h) => !q.trim() || h.prompt.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 30).map((h) => (
              <div key={h.id} className="px-2.5 py-1.5 rounded-[8px] hover:bg-[var(--hover)]"><p className="text-[12px] truncate">{h.prompt}</p><p className="text-[11px] text-[var(--color-text-muted)] truncate">Winner: {h.winner ?? '—'}</p></div>
            ))}
            {!history.length && <p className="px-2.5 text-[12px] text-[var(--color-text-muted)]">Run a comparison and pick a winner to start a history.</p>}
          </>)}
          {mode === 'monitor' && <p className="px-2.5 text-[12px] text-[var(--color-text-muted)] leading-snug">Readings update every two seconds while this page is open.</p>}
        </div>
      </SidebarPane>

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {mode === 'hub' && (
          <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5">
            <ActiveDownloads pull={pull} files={files} />
            {kind === 'language' && <Hub q={q} installed={installed} running={running} refresh={refresh} pull={pull} vramGb={gpuTotalGb} ollamaUp={up} selected={selected} onSelect={setSelected} onOpenEngines={onOpenEngines} />}
            {(kind === 'image' || kind === 'lora') && (
              <ImageModelsHub folder={kind === 'image' ? 'checkpoints' : 'loras'} names={(kind === 'image' ? checkpoints : loras).filter((n) => !q.trim() || n.toLowerCase().includes(q.trim().toLowerCase()))}
                comfyUp={comfyUp} modelsDir={modelsDir} onModelsDir={setModelsDir} onAdd={() => setAddOpen(true)} onOpenEngines={onOpenEngines} />
            )}
            {kind === 'voice' && <VoiceModelsHub up={engines.voicebox.up} refreshKey={voiceTick} onOpenEngines={onOpenEngines} onAdd={() => setAddOpen(true)} />}
          </div>
        )}
        {mode === 'arena' && <Arena installed={installed} history={history} setHistory={setHistory} ollamaUp={up} />}
        {mode === 'monitor' && <Monitor engines={engines} />}
      </div>

      {mode === 'arena' && (
        <InspectorPane label="Leaderboard">
          <Section title="Leaderboard" hint="From the winners you picked.">
            {!wins.length && <p className="text-[13px] text-[var(--color-text-muted)]">No votes yet.</p>}
            {wins.map(([m, e]) => <KV key={m} k={m} v={`${e.w}/${e.n} wins${e.tps.length ? ` · ${Math.round(e.tps.reduce((a, b) => a + b, 0) / e.tps.length)} tok/s` : ''}`} />)}
            {history.length > 0 && <Btn size="sm" variant="ghost" className="mt-3" onClick={() => setHistory([])}>Clear history</Btn>}
          </Section>
        </InspectorPane>
      )}
      {mode === 'hub' && kind === 'language' && (
        <InspectorPane label="Model details">
          {sel ? (
            <Section title={sel.name}>
              <KV k="Family" v={sel.details?.family ?? '—'} /><KV k="Parameters" v={sel.details?.parameter_size ?? '—'} /><KV k="Quantisation" v={sel.details?.quantization_level ?? '—'} />
              <KV k="Size on disk" v={fmtGB(sel.size)} /><KV k="Modified" v={new Date(sel.modified_at).toLocaleDateString()} />
              <KV k="In memory" v={running.find((r) => r.name === sel.name) ? `${fmtGB(running.find((r) => r.name === sel.name)!.size_vram)} on GPU` : 'Not loaded'} />
              <KV k="Estimated need" v={`≈ ${estimateVram(paramsOf(sel.details?.parameter_size), 4.85)} GB at Q4`} />
            </Section>
          ) : <p className="p-4 text-[13px] text-[var(--color-text-muted)]">Select an installed model to see its details.</p>}
        </InspectorPane>
      )}

      <AddModelDialog open={addOpen} onClose={() => setAddOpen(false)} initialKind={mode === 'hub' ? kind : 'language'}
        startPull={(n) => void pull.start(n)} pulling={!!pull.name} files={files} modelsDir={modelsDir} onModelsDir={setModelsDir}
        onVoiceDownload={async (n) => { await voicebox.downloadModel(n); setVoiceTick((t) => t + 1); }}
        onStarted={(k) => { setMode('hub'); setKind(k); }} />
    </div>
  );
};
