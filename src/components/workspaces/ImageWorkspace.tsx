import React, { useEffect, useMemo, useState } from 'react';
import { SlidersHorizontal, Palette, Boxes, Plus, ArrowUp, Check, ChevronDown, Sparkles, ChevronLeft, ChevronRight, Copy, Download, Dices, ImageIcon, Layers, Paintbrush, Shuffle, Square, Trash2, X, ZoomIn, MoveDiagonal } from 'lucide-react';
import { GeneratedImage } from '../../types/lotus';
import { ChatFolder } from '../../types/lotus';
import { DEFAULT_PARAMS, ImageParams, useGallery } from '../../hooks/useGallery';
import { comfy, ComfyStats, dimensionsFor } from '../../services/comfyService';
import { engineUrl } from '../../services/engineConfig';
import { usePanels } from '../../lib/panels';
import { EdgeMeter, ModeButton, PickerButton, PromptShell, RoundIcon, SendButton, TrayButton, TrayNote } from '../common/PromptBox';
import { usePersisted, uid } from '../../lib/persist';
import { ToolbarContent } from '../common/ToolbarSlot';
import { Banner, Btn, Empty, Gauge, IconBtn, Progress, Stepper, TextArea, TextInput, cx } from '../common/ui';
import { InspectorPane, KV, MenuItem, Popover, Section, SliderField } from '../common/Pane';
import { ImageSidebar } from '../images/ImageSidebar';
import { MaskEditor } from '../images/MaskEditor';
import { LoraPicker } from '../images/LoraPicker';

const ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '21:9'];
interface Style { id: string; name: string; prompt: string; negative?: string }
interface Props { comfyUp: boolean | null; checkpoints: string[]; onOpenEngines: () => void; onOpenModels: () => void }

const SLASH = [
  { name: 'ar', args: '<16:9 | 1024x768>', help: 'Aspect ratio or size' },
  { name: 'seed', args: '<number|random>', help: 'Lock or unlock the seed' },
  { name: 'steps', args: '<n>', help: 'Sampling steps' },
  { name: 'cfg', args: '<n>', help: 'Guidance scale' },
  { name: 'count', args: '<1|2|4|8>', help: 'Images per run' },
  { name: 'neg', args: '<text>', help: 'Negative prompt' },
];

export const ImageWorkspace: React.FC<Props> = ({ comfyUp, checkpoints, onOpenEngines, onOpenModels }) => {
  const g = useGallery(comfyUp);
  const [stored, setParams] = usePersisted<ImageParams>('lotus.image.params.v1', DEFAULT_PARAMS);
  const params: ImageParams = { ...DEFAULT_PARAMS, ...stored };
  const [loraList, setLoraList] = useState<string[]>([]);
  const loras = params.loras ?? [];
  const [folders, setFolders] = usePersisted<ChatFolder[]>('lotus.imgfolders.v1', []);
  const [styles, setStyles] = usePersisted<Style[]>('lotus.styles.v1', []);
  const { right: showInspector, setRight: setShowInspector } = usePanels();
  const [tab, setTab] = usePersisted<'params' | 'styles' | 'details'>('lotus.image.tab.v1', 'params');
  const [prompt, setPrompt] = useState('');
  const [ref, setRef] = useState<{ blob: Blob; url: string; name: string } | null>(null);
  const [drag, setDrag] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [maskOpen, setMaskOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const [styleName, setStyleName] = useState('');
  const [stats, setStats] = useState<ComfyStats | null>(null);
  const [lists, setLists] = useState<{ samplers: string[]; schedulers: string[] }>({ samplers: [], schedulers: [] });
  const set = (p: Partial<ImageParams>) => setParams((x) => ({ ...x, ...p }));

  useEffect(() => { if (checkpoints.length && !checkpoints.includes(params.checkpoint)) set({ checkpoint: checkpoints[0] }); }, [checkpoints]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!comfyUp) { setStats(null); return; } void comfy.samplers().then(setLists); }, [comfyUp]);
  // LoRAs: read when ComfyUI is up and again whenever the window regains focus (after a download in Models).
  useEffect(() => {
    if (!comfyUp) { setLoraList([]); return; }
    const load = () => { void comfy.loras().then(setLoraList); };
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [comfyUp]);
  // A LoRA that was deleted from disk is dropped from the selection once the list has loaded.
  useEffect(() => {
    if (loraList.length && loras.some((l) => !loraList.includes(l.name))) setParams((x) => ({ ...x, loras: (x.loras ?? []).filter((l) => loraList.includes(l.name)) }));
  }, [loraList]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!comfyUp) return;
    let off = false;
    const tick = () => comfy.stats().then((s) => { if (!off) setStats(s); }).catch(() => undefined);
    void tick(); const t = setInterval(tick, 4000);
    return () => { off = true; clearInterval(t); };
  }, [comfyUp]);

  const cur = g.current;
  const dims = useMemo(() => dimensionsFor(params.aspect, params.checkpoint), [params.aspect, params.checkpoint]);
  const vramUsed = stats && stats.vramTotalGb ? 1 - stats.vramFreeGb / stats.vramTotalGb : 0;

  // ── Prompt deck: / commands and @Style ────────────────────────────────────
  const slashQ = /^\/(\w*)$/.exec(prompt)?.[1];
  const atQ = /(?:^|\s)@([\w-]*)$/.exec(prompt)?.[1];
  const slashItems = slashQ === undefined ? [] : SLASH.filter((c) => c.name.startsWith(slashQ.toLowerCase()));
  const atItems = atQ === undefined ? [] : styles.filter((s) => s.name.toLowerCase().replace(/\s+/g, '-').includes(atQ.toLowerCase()));
  const menu = slashItems.length ? 'slash' : atItems.length ? 'at' : null;
  useEffect(() => setSel(0), [menu, slashQ, atQ]);
  const handle = (s: Style) => s.name.toLowerCase().replace(/\s+/g, '-');

  const runCommand = (name: string, arg: string): string => {
    switch (name) {
      case 'ar': { const ok = /^\d+:\d+$/.test(arg) || /^\d{2,5}\s*[x×]\s*\d{2,5}$/.test(arg); if (!ok) return 'Use a ratio like 16:9 or a size like 1024x768.'; set({ aspect: arg.replace(/\s+/g, '') }); return `Canvas ${arg}`; }
      case 'seed': if (arg === 'random' || arg === 'off') { set({ seed: null }); return 'Seed unlocked.'; } else { const v = parseInt(arg, 10); if (!(v >= 0)) return 'Use a whole number, or “random”.'; set({ seed: v }); return `Seed ${v}`; }
      case 'steps': { const v = parseInt(arg, 10); if (!(v >= 1 && v <= 150)) return 'Steps: 1–150.'; set({ steps: v }); return `Steps ${v}`; }
      case 'cfg': { const v = parseFloat(arg); if (!(v >= 0 && v <= 30)) return 'CFG: 0–30.'; set({ cfg: v }); return `CFG ${v}`; }
      case 'count': { const v = parseInt(arg, 10); if (![1, 2, 4, 8].includes(v)) return 'Count: 1, 2, 4 or 8.'; set({ count: v }); return `${v} per run`; }
      case 'neg': set({ negative: arg }); return 'Negative prompt updated.';
    }
    return '';
  };

  const expand = (text: string) => {
    let p = text, neg = params.negative;
    for (const s of styles) { const tag = `@${handle(s)}`; if (p.includes(tag)) { p = p.replace(tag, s.prompt); if (s.negative) neg = `${neg}, ${s.negative}`; } }
    return { p: p.replace(/\s{2,}/g, ' ').trim(), neg };
  };

  const go = () => {
    const t = prompt.trim();
    const cmd = /^\/(\w+)\s*(.*)$/s.exec(t);
    if (cmd && SLASH.some((c) => c.name === cmd[1])) { setNotice(runCommand(cmd[1], cmd[2].trim())); setPrompt(''); return; }
    if (!t || g.busy || !params.checkpoint) return;
    setNotice(null);
    const { p, neg } = expand(t);
    void g.generate(p, { ...params, negative: neg }, ref?.blob);
  };

  const pick = (i: number) => {
    if (menu === 'slash') setPrompt(`/${slashItems[i].name} `);
    else if (menu === 'at') setPrompt((t) => t.replace(/@[\w-]*$/, `@${handle(atItems[i])} `));
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (menu) {
      const n = menu === 'slash' ? slashItems.length : atItems.length;
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % n); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + n) % n); return; }
      if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); pick(sel); return; }
      if (e.key === 'Escape') { setPrompt((t) => t.replace(/[/@][\w-]*$/, '')); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); }
  };

  const takeRef = (f?: File | null) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) { setNotice('A reference has to be an image.'); return; }
    setRef({ blob: f, url: URL.createObjectURL(f), name: f.name });
  };

  const copyPrompt = () => { if (!cur) return; void navigator.clipboard.writeText(cur.prompt); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const download = () => { if (!cur) return; const a = document.createElement('a'); a.href = cur.url; a.download = `lotus-${cur.seed}-${cur.id}.png`; a.click(); };
  const useAsReference = () => { if (cur?.blob) setRef({ blob: cur.blob, url: cur.url, name: 'Current image' }); };
  const reuse = (im: GeneratedImage) => { setPrompt(im.prompt); set({ negative: im.negativePrompt ?? params.negative, steps: im.steps, cfg: im.cfg, seed: im.seed, checkpoint: im.checkpoint, loras: im.loras ?? [], ...(im.sampler ? { sampler: im.sampler } : {}) }); };

  const actionBtn = 'h-8 px-2.5 inline-flex items-center gap-1.5 rounded-[7px] text-[12px] font-medium text-white hover:bg-white/20 disabled:opacity-40';

  return (
    <div className="flex-1 min-h-0 flex bg-[var(--color-bg-panel)] overflow-hidden">

      <ImageSidebar sessions={g.sessions} activeId={g.activeId} folders={folders} onFolders={setFolders} onSelect={g.setActiveId} onNew={() => { g.newSession(); setPrompt(''); set({ seed: null }); setRef(null); }} onDelete={g.remove} onPatch={g.patch} />

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {comfyUp === false && <div className="px-6 pt-3"><Banner tone="warn" action={<Btn size="sm" variant="secondary" onClick={onOpenEngines}>Engines</Btn>}>ComfyUI isn't running at {engineUrl('comfyui')}. Start it to generate images.</Banner></div>}
        {g.error && <div className="px-6 pt-3"><Banner tone="error" action={<IconBtn label="Dismiss" onClick={() => g.setError(null)}><X className="w-3.5 h-3.5" /></IconBtn>}>{g.error}</Banner></div>}

        {/* Canvas */}
        <div className="flex-1 min-h-0 p-5 flex flex-col items-center justify-center">
          {!cur && !g.busy && <Empty icon={<ImageIcon className="w-5 h-5" />} title="Nothing generated yet" body="Describe an image below and press Generate. ComfyUI makes it on your own GPU." className="flex-1" />}
          {(cur || g.busy) && (
            <div className="relative group flex-1 min-h-0 w-full flex items-center justify-center">
              {cur && <img src={cur.url} alt={cur.prompt} className={cx('max-w-full max-h-full object-contain rounded-[12px] shadow-[0_0_0_0.5px_var(--sep),var(--shadow-1)]', g.busy && 'opacity-40 blur-[1px]')} />}
              {!cur && <div className="rounded-[12px] bg-[var(--hover)] shadow-[inset_0_0_0_0.5px_var(--sep)]" style={{ aspectRatio: `${dims.width}/${dims.height}`, height: '60%', maxWidth: '100%' }} />}

              {g.busy && (
                <div role="status" className="absolute inset-x-6 bottom-6 mx-auto max-w-[420px] p-3.5 rounded-[12px] material-overlay">
                  <div className="flex items-center justify-between text-[13px] mb-2"><span className="font-medium">{g.label}…</span><span className="tabular-nums text-[var(--color-text-muted)]">{Math.floor(g.elapsed)}s</span></div>
                  <Progress label="Generating" />
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 text-[11px] text-[var(--color-text-muted)]">
                    <div className="flex justify-between"><dt>Size</dt><dd className="tabular-nums">{g.info ? `${g.info.width}×${g.info.height}` : '—'}</dd></div>
                    <div className="flex justify-between"><dt>Steps</dt><dd className="tabular-nums">{g.info?.steps ?? '—'}</dd></div>
                    <div className="flex justify-between col-span-2"><dt>Checkpoint</dt><dd className="truncate ml-3">{g.info?.checkpoint ?? '—'}</dd></div>
                  </dl>
                  <Btn size="sm" className="mt-2.5 w-full" icon={<Square className="w-3 h-3" fill="currentColor" />} onClick={g.cancel}>Cancel</Btn>
                  <p className="mt-1.5 text-[11px] text-[var(--color-text-muted)]">ComfyUI doesn't report step progress over the connection Lotus uses, so this shows elapsed time.</p>
                </div>
              )}

              {cur && !g.busy && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-0.5 p-1 rounded-[10px] bg-black/65 backdrop-blur-md opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity" role="toolbar" aria-label="Image actions">
                  <button type="button" className={actionBtn} onClick={download}><Download className="w-3.5 h-3.5" />Download</button>
                  <Popover up={false} trigger={(_o, t) => <button type="button" className={actionBtn} onClick={t} disabled={!cur.blob}><ZoomIn className="w-3.5 h-3.5" />Upscale</button>}>
                    {(close) => (<><MenuItem onClick={() => { close(); void g.upscale(cur, 2); }}>×2 (Lanczos)</MenuItem><MenuItem onClick={() => { close(); void g.upscale(cur, 4); }}>×4 (Lanczos)</MenuItem></>)}
                  </Popover>
                  <button type="button" className={actionBtn} onClick={() => void g.variation(cur, params)} disabled={!comfyUp || !cur.blob}><Shuffle className="w-3.5 h-3.5" />Variations</button>
                  <Popover trigger={(_o, t) => <button type="button" className={actionBtn} onClick={t} disabled={!comfyUp || !cur.blob}><Paintbrush className="w-3.5 h-3.5" />Edit</button>}>
                    {(close) => {
                      const [w, h] = cur.dimensions.split('×').map(Number);
                      const out = (pad: { left: number; top: number; right: number; bottom: number }) => { close(); void g.outpaint(cur, pad, prompt.trim() || cur.prompt, params); };
                      return (<>
                        <MenuItem onClick={() => { close(); setMaskOpen(true); }}>Inpaint: paint an area…</MenuItem>
                        <p className="px-2.5 pt-1.5 text-[11px] text-[var(--color-text-muted)]">Outpaint: extend by 25%</p>
                        <MenuItem onClick={() => out({ left: w / 4, top: 0, right: 0, bottom: 0 })}>Left</MenuItem>
                        <MenuItem onClick={() => out({ left: 0, top: 0, right: w / 4, bottom: 0 })}>Right</MenuItem>
                        <MenuItem onClick={() => out({ left: 0, top: h / 4, right: 0, bottom: 0 })}>Top</MenuItem>
                        <MenuItem onClick={() => out({ left: 0, top: 0, right: 0, bottom: h / 4 })}>Bottom</MenuItem>
                        <MenuItem onClick={() => out({ left: w / 8, top: h / 8, right: w / 8, bottom: h / 8 })}>All sides</MenuItem>
                      </>);
                    }}
                  </Popover>
                  <button type="button" className={actionBtn} onClick={copyPrompt}>{copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}Copy prompt</button>
                </div>
              )}

              {g.active.versions.length > 1 && !g.busy && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 px-1 h-8 rounded-[10px] bg-black/65 text-white text-[12px] tabular-nums backdrop-blur-md">
                  <button type="button" aria-label="Previous version" disabled={g.active.index === 0} onClick={() => g.stepVersion(-1)} className="w-6 h-6 inline-flex items-center justify-center rounded-[6px] hover:bg-white/20 disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
                  {g.active.index + 1} / {g.active.versions.length}
                  <button type="button" aria-label="Next version" disabled={g.active.index === g.active.versions.length - 1} onClick={() => g.stepVersion(1)} className="w-6 h-6 inline-flex items-center justify-center rounded-[6px] hover:bg-white/20 disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
                </div>
              )}
            </div>
          )}
          {g.active.versions.length > 1 && (
            <div className="mt-3 flex gap-2 overflow-x-auto max-w-full py-1" role="list" aria-label="Versions">
              {g.active.versions.map((v, i) => (
                <button key={v.id} type="button" role="listitem" aria-label={`Version ${i + 1}`} aria-current={i === g.active.index} onClick={() => g.selectVersion(i)}
                  className={cx('w-12 h-12 rounded-[8px] overflow-hidden shrink-0', i === g.active.index ? 'shadow-[0_0_0_2px_var(--color-accent-fill)]' : 'shadow-[0_0_0_0.5px_var(--sep)] opacity-80 hover:opacity-100')}>
                  <img src={v.url} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Prompt deck */}
        <div className="px-6 pb-4 shrink-0">
          <div className="max-w-[820px] mx-auto relative">
            {menu && (
              <div role="listbox" className="absolute bottom-full mb-2 left-0 w-[340px] max-h-56 overflow-y-auto p-1 rounded-[10px] material-overlay z-20">
                {menu === 'slash' ? slashItems.map((c, i) => (
                  <button key={c.name} type="button" role="option" aria-selected={i === sel} onMouseDown={(e) => { e.preventDefault(); pick(i); }} className={cx('w-full flex items-baseline gap-2 px-2.5 py-1.5 rounded-[6px] text-left text-[13px]', i === sel && 'bg-[var(--color-accent-fill)] text-white')}>
                    <span className="font-medium">/{c.name}</span><span className="opacity-70 text-[12px]">{c.args}</span><span className="ml-auto text-[12px] opacity-70">{c.help}</span>
                  </button>
                )) : atItems.map((s, i) => (
                  <button key={s.id} type="button" role="option" aria-selected={i === sel} onMouseDown={(e) => { e.preventDefault(); pick(i); }} className={cx('w-full flex items-baseline gap-2 px-2.5 py-1.5 rounded-[6px] text-left text-[13px]', i === sel && 'bg-[var(--color-accent-fill)] text-white')}>
                    <span className="font-medium">@{handle(s)}</span><span className="ml-auto text-[12px] opacity-70 truncate">{s.prompt}</span>
                  </button>
                ))}
              </div>
            )}
            {notice && <p role="status" className="mb-1.5 px-1 text-[12px] text-[var(--color-text-muted)]">{notice}</p>}
            <PromptShell drag={drag} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); takeRef(e.dataTransfer.files[0]); }}
              tray={<>
                <TrayButton onClick={() => { setTab('params'); setShowInspector(true); }} icon={<SlidersHorizontal className="w-4 h-4" />} label="Parameters" title="Canvas, images per run, negative prompt, sampling" />
                <TrayButton onClick={() => { setTab('styles'); setShowInspector(true); }} icon={<Palette className="w-4 h-4" />} label="Styles" title="Saved styles you can call with @ in the prompt" />
                <TrayButton onClick={onOpenModels} icon={<Boxes className="w-4 h-4" />} label="Models" title="Get checkpoints and LoRAs" />
                <div className="flex-1" />
                <TrayNote>{dims.width}×{dims.height} · {params.count} image{params.count > 1 ? 's' : ''}{params.seed !== null ? ` · seed ${params.seed}` : ''}</TrayNote>
              </>}>
              {/* Video memory in use, as a thin bar along the top edge (numbers in the tip). */}
              <EdgeMeter value={stats && stats.vramTotalGb ? vramUsed : null} label="Video memory in use"
                title={stats && stats.vramTotalGb ? `${stats.device ?? 'GPU'}: ${(stats.vramTotalGb - stats.vramFreeGb).toFixed(1)} of ${stats.vramTotalGb.toFixed(1)} GB video memory in use` : 'Start ComfyUI to see video memory'} />
              {(ref || drag) && (
                <div className="flex items-center gap-2 px-3.5 pt-3">
                  {ref ? (
                    <span className="inline-flex items-center gap-2 h-10 pl-1 pr-1.5 rounded-[8px] bg-[var(--hover)] text-[12px]">
                      <img src={ref.url} alt="" className="w-8 h-8 rounded-[5px] object-cover" /><span className="max-w-[140px] truncate">Reference: {ref.name}</span>
                      <span className="text-[var(--color-text-muted)]">strength {Math.round(params.denoise * 100)}%</span>
                      <IconBtn label="Remove reference" className="!w-5 !h-5" onClick={() => setRef(null)}><X className="w-3 h-3" /></IconBtn>
                    </span>
                  ) : <p className="text-[12px] text-[var(--color-text-muted)] py-2">Drop an image to use it as a reference (image-to-image).</p>}
                </div>
              )}
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={onKey} rows={2} aria-label="Prompt"
                placeholder="Describe the image… (/ for settings, @ for saved styles)"
                className="w-full resize-none bg-transparent px-4 pt-4 pb-1 text-[14px] leading-relaxed placeholder:text-[var(--color-text-muted)] focus:outline-none" />
              <div className="flex items-center gap-1 px-2.5 pb-2.5">
                <label className="tip w-8 h-8 inline-flex items-center justify-center rounded-full text-[var(--color-text-main)] hover:bg-[var(--hover)] cursor-default" data-tip="Add a reference image">
                  <input type="file" accept="image/*" className="sr-only" aria-label="Add a reference image" onChange={(e) => { takeRef(e.target.files?.[0]); e.target.value = ''; }} /><Plus className="w-[18px] h-[18px]" />
                </label>
                {cur?.blob && <RoundIcon label="Use the current image as the reference" onClick={useAsReference}><MoveDiagonal className="w-4 h-4" /></RoundIcon>}
                <Popover up trigger={(o, t) => (
                  <ModeButton on={loras.length > 0 || o} onClick={t} icon={<Sparkles className="w-4 h-4" />} label={loras.length ? `LoRA · ${loras.length}` : 'LoRA'} title="LoRAs (optional): small add-on models that steer style or subject" />
                )} className="w-[300px] !p-3">
                  {() => <LoraPicker available={loraList} value={loras} comfyUp={comfyUp} onChange={(next) => set({ loras: next })} onGetMore={onOpenModels} />}
                </Popover>
                <div className="flex-1" />
                <Popover up align="right" className="w-[300px]" trigger={(o, t) => (
                  <PickerButton open={o} onClick={t} title="Checkpoint (image model)" text={params.checkpoint || (comfyUp ? 'No checkpoints' : 'ComfyUI stopped')}
                    chevron={<ChevronDown className={cx('w-3.5 h-3.5 shrink-0 opacity-70 transition-transform', o && 'rotate-180')} />} />
                )}>
                  {(close) => (<>
                    {!checkpoints.length && <p className="p-2.5 text-[12px] text-[var(--color-text-muted)]">{comfyUp ? 'No checkpoints found in ComfyUI’s models folder.' : 'Start ComfyUI to list checkpoints.'}</p>}
                    {checkpoints.map((c) => <MenuItem key={c} active={c === params.checkpoint} onClick={() => { set({ checkpoint: c }); close(); }}><span className="truncate">{c}</span></MenuItem>)}
                    <div className="my-1 border-t border-[var(--sep)]" />
                    <MenuItem onClick={() => { close(); onOpenModels(); }}><Boxes className="w-3.5 h-3.5" />Get more models…</MenuItem>
                  </>)}
                </Popover>
                {g.busy
                  ? <SendButton stop onClick={g.cancel} label="Stop generating" />
                  : <SendButton disabled={!prompt.trim() || !params.checkpoint || !comfyUp} onClick={go} label="Generate" tip="Generate (Enter)" />}
              </div>
            </PromptShell>
          </div>
        </div>
      </div>

      {showInspector && (
        <InspectorPane label="Generation inspector">
          <div className="shrink-0 p-2 border-b border-[var(--sep)]">
            <div role="tablist" aria-label="Inspector" className="grid grid-cols-3 gap-0.5 p-0.5 rounded-[8px] bg-[var(--hover)]">
              {([['params', 'Parameters'], ['styles', 'Styles'], ['details', 'Details']] as const).map(([id, label]) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cx('h-7 rounded-[6px] text-[12px] font-medium', tab === id ? 'bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep),0_1px_2px_rgba(0,0,0,.12)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-main)]')}>{label}</button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {tab === 'params' && (<>
              <Section title="Canvas">
                <div className="grid grid-cols-4 gap-1.5 mb-2">
                  {ASPECTS.map((a) => <button key={a} type="button" aria-pressed={params.aspect === a} onClick={() => set({ aspect: a })} className={cx('h-7 rounded-[6px] text-[12px] font-medium', params.aspect === a ? 'bg-[var(--color-accent-fill)] text-white' : 'bg-[var(--hover)] hover:bg-[var(--pressed)]')}>{a}</button>)}
                  <button type="button" aria-pressed={!ASPECTS.includes(params.aspect)} onClick={() => set({ aspect: '768x1024' })} className={cx('h-7 rounded-[6px] text-[12px] font-medium', !ASPECTS.includes(params.aspect) ? 'bg-[var(--color-accent-fill)] text-white' : 'bg-[var(--hover)] hover:bg-[var(--pressed)]')}>Custom</button>
                </div>
                {!ASPECTS.includes(params.aspect) && <TextInput aria-label="Custom size, for example 768x1024" value={params.aspect} onChange={(e) => set({ aspect: e.target.value })} placeholder="768x1024" />}
                <p className="mt-1.5 text-[11px] text-[var(--color-text-muted)]">{dims.width}×{dims.height} px (rounded to multiples of 64)</p>
              </Section>
              <Section title="Images per run">
                <div className="grid grid-cols-4 gap-1.5">{[1, 2, 4, 8].map((n) => <button key={n} type="button" aria-pressed={params.count === n} onClick={() => set({ count: n })} className={cx('h-7 rounded-[6px] text-[12px] font-medium tabular-nums', params.count === n ? 'bg-[var(--color-accent-fill)] text-white' : 'bg-[var(--hover)] hover:bg-[var(--pressed)]')}>{n}</button>)}</div>
              </Section>
              <Section title="Negative prompt" hint="Things to leave out.">
                <TextArea rows={2} value={params.negative} onChange={(e) => set({ negative: e.target.value })} aria-label="Negative prompt" />
              </Section>
              <Section title="LoRA" hint="Optional. Small add-on models that steer style or subject.">
                <LoraPicker available={loraList} value={loras} comfyUp={comfyUp} onChange={(next) => set({ loras: next })} onGetMore={onOpenModels} />
              </Section>
              <Section title="Sampling">
                <SliderField label="Guidance scale (CFG)" value={params.cfg} min={1} max={20} step={0.5} onChange={(v) => set({ cfg: v })} format={(v) => v.toFixed(1)} hint="How closely the image follows the prompt. FLUX models usually want 1–4." />
                <SliderField label="Steps" value={params.steps} min={4} max={80} step={1} onChange={(v) => set({ steps: v })} />
                <SliderField label="Reference strength" value={params.denoise} min={0.1} max={1} step={0.05} onChange={(v) => set({ denoise: v })} format={(v) => `${Math.round(v * 100)}%`} hint="With a reference image: higher changes more of it." />
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <label className="text-[12px]">Sampler<select aria-label="Sampler" value={params.sampler} onChange={(e) => set({ sampler: e.target.value })} className="mt-0.5 w-full h-7 px-1.5 rounded-[6px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)] text-[12px]">
                    {(lists.samplers.length ? lists.samplers : [params.sampler]).map((s) => <option key={s}>{s}</option>)}</select></label>
                  <label className="text-[12px]">Scheduler<select aria-label="Scheduler" value={params.scheduler} onChange={(e) => set({ scheduler: e.target.value })} className="mt-0.5 w-full h-7 px-1.5 rounded-[6px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)] text-[12px]">
                    {(lists.schedulers.length ? lists.schedulers : [params.scheduler]).map((s) => <option key={s}>{s}</option>)}</select></label>
                </div>
              </Section>
              <Section title="Seed">
                <div className="flex items-center gap-1.5 text-[12px]">
                  {params.seed === null ? <span className="text-[var(--color-text-muted)] flex-1">Random each run</span> : <div className="flex-1"><Stepper label="Seed" value={params.seed} min={0} max={2 ** 31 - 1} onChange={(v) => set({ seed: v })} /></div>}
                  <IconBtn label="Lock a random seed" onClick={() => set({ seed: Math.floor(Math.random() * 2 ** 31) })}><Dices className="w-4 h-4" /></IconBtn>
                  {params.seed !== null && <IconBtn label="Unlock seed" onClick={() => set({ seed: null })}><X className="w-4 h-4" /></IconBtn>}
                </div>
              </Section>
            </>)}

            {tab === 'styles' && (
              <Section title="Saved styles" hint="Type @name in the prompt to insert a style's text (and its negative prompt).">
                <div className="flex gap-1.5">
                  <TextInput value={styleName} onChange={(e) => setStyleName(e.target.value)} placeholder="Style name" aria-label="Style name" />
                  <Btn size="sm" disabled={!prompt.trim() || !styleName.trim()} onClick={() => { setStyles((s) => [...s, { id: uid('sty'), name: styleName.trim(), prompt: prompt.trim(), negative: undefined }]); setStyleName(''); }}>Save</Btn>
                </div>
                <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">Saves what is typed in the prompt box.</p>
                <ul className="mt-3 space-y-1.5">
                  {styles.map((s) => (
                    <li key={s.id} className="flex items-start gap-2 p-2 rounded-[8px] bg-[var(--hover)]">
                      <span className="flex-1 min-w-0"><span className="block text-[13px] font-medium">@{handle(s)}</span><span className="block text-[11px] text-[var(--color-text-muted)] line-clamp-2">{s.prompt}</span></span>
                      <IconBtn label={`Delete style ${s.name}`} className="!w-6 !h-6" onClick={() => setStyles((l) => l.filter((x) => x.id !== s.id))}><Trash2 className="w-3.5 h-3.5" /></IconBtn>
                    </li>
                  ))}
                  {!styles.length && <p className="text-[13px] text-[var(--color-text-muted)]">No styles yet. Write the prompt text you reuse, then save it here.</p>}
                </ul>
              </Section>
            )}

            {tab === 'details' && (cur ? (
              <Section title="This image" action={<Btn size="sm" variant="ghost" onClick={() => reuse(cur)}>Reuse settings</Btn>}>
                <p className="text-[12px] leading-snug mb-2">{cur.prompt}</p>
                <KV k="Type" v={cur.kind ?? 'txt2img'} /><KV k="Size" v={cur.dimensions} /><KV k="Seed" v={cur.seed} /><KV k="Steps" v={cur.steps} /><KV k="CFG" v={cur.cfg} />
                {cur.sampler && <KV k="Sampler" v={cur.sampler} />}{cur.denoise !== undefined && <KV k="Strength" v={`${Math.round(cur.denoise * 100)}%`} />}
                <KV k="Checkpoint" v={cur.checkpoint} mono />{cur.loras?.length ? <KV k="LoRA" v={cur.loras.map((l) => `${l.name} ×${l.strength}`).join(', ')} mono /> : null}<KV k="Time" v={`${cur.generationTimeSec}s`} /><KV k="Made" v={cur.timestamp} />
                {cur.negativePrompt && <KV k="Negative" v={cur.negativePrompt} />}
                <Btn size="sm" variant="danger" className="mt-3" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={() => g.removeVersion(g.active.id, cur.id)}>Delete this image</Btn>
              </Section>
            ) : <p className="p-4 text-[13px] text-[var(--color-text-muted)]">Generate an image to see its details.</p>)}
          </div>
        </InspectorPane>
      )}

      {cur && <MaskEditor open={maskOpen} src={cur.url} onClose={() => setMaskOpen(false)} onDone={(png) => { setMaskOpen(false); void g.inpaint(cur, png, prompt.trim() || cur.prompt, params); }} />}
    </div>
  );
};
