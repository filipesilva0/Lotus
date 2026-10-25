import React from 'react';
import { Copy, Check, Download, FileText, RefreshCw } from 'lucide-react';
import { ResearchApi } from '../../research/store';
import { Project } from '../../research/types';
import { downloadBlob } from '../../lib/audio';
import { openExternal } from '../../lib/open';
import { Btn, Banner, Empty, Skeleton, useFlash } from '../common/ui';

function inline(text: string, onCite: (n: number) => void, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\[\d+(?:\s*[,;-]\s*\d+)*\]|\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|https?:\/\/[^\s)<]+)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0], k = `${key}-${i++}`;
    if (t.startsWith('[')) {
      t.slice(1, -1).split(/[,;]/).forEach((part, j) => {
        const range = part.split('-').map((x) => parseInt(x, 10));
        const n = range[0];
        out.push(<button key={`${k}-${j}`} onClick={() => onCite(n)} className="mx-px px-1 rounded-[6px] bg-[var(--color-accent-pastel)] text-[var(--color-accent-vibrant)] text-xs font-semibold align-super hover:brightness-95" aria-label={`Citation ${part.trim()}`}>{part.trim()}</button>);
      });
    } else if (t.startsWith('**')) out.push(<strong key={k}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith('*')) out.push(<em key={k}>{t.slice(1, -1)}</em>);
    else if (t.startsWith('`')) out.push(<code key={k} className="px-1 rounded-[6px] bg-black/5 dark:bg-white/10 text-[0.92em]">{t.slice(1, -1)}</code>);
    else out.push(<button key={k} onClick={() => void openExternal(t)} className="text-[var(--color-accent-vibrant)] underline underline-offset-2 break-all text-left">{t}</button>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export const ReportMarkdown: React.FC<{ text: string; onCite: (n: number) => void }> = ({ text, onCite }) => {
  const nodes: React.ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: { n?: number; t: string }[] } | null = null;
  let inRefs = false;
  const flushP = () => { if (para.length) { nodes.push(<p key={nodes.length} className="my-2.5 leading-relaxed">{inline(para.join(' '), onCite, `p${nodes.length}`)}</p>); para = []; } };
  const flushL = () => {
    if (!list) return;
    const L = list;
    nodes.push(L.ordered
      ? <ol key={nodes.length} className="my-2.5 space-y-1.5 text-[13px]">{L.items.map((it, i) => <li id={inRefs ? `ref-${it.n}` : undefined} key={i} className="flex gap-2 scroll-mt-4 rounded-[6px] px-1 -mx-1 target:bg-[var(--color-accent-pastel)]"><span className="text-[var(--color-text-muted)] tabular-nums shrink-0 w-6 text-right">{it.n}.</span><span>{inline(it.t, onCite, `o${i}`)}</span></li>)}</ol>
      : <ul key={nodes.length} className="my-2.5 list-disc pl-5 space-y-1">{L.items.map((it, i) => <li key={i}>{inline(it.t, onCite, `u${i}`)}</li>)}</ul>);
    list = null;
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line), ul = /^\s*[-*]\s+(.*)$/.exec(line), ol = /^\s*(\d+)\.\s+(.*)$/.exec(line);
    if (h) {
      flushP(); flushL();
      inRefs = /^references?$/i.test(h[2].trim());
      const lvl = h[1].length;
      nodes.push(React.createElement(`h${lvl + 0}`, { key: nodes.length, className: lvl === 1 ? 'text-xl font-semibold mt-1 mb-3 text-[var(--color-text-main)]' : lvl === 2 ? 'text-base font-semibold mt-6 mb-1.5 text-[var(--color-text-main)]' : 'text-sm font-semibold mt-4 mb-1 text-[var(--color-text-main)]' }, h[2]));
    } else if (ul) { flushP(); if (!list || list.ordered) { flushL(); list = { ordered: false, items: [] }; } list.items.push({ t: ul[1] }); }
    else if (ol) { flushP(); if (!list || !list.ordered) { flushL(); list = { ordered: true, items: [] }; } list.items.push({ n: Number(ol[1]), t: ol[2] }); }
    else if (!line.trim()) { flushP(); flushL(); }
    else { flushL(); para.push(line.trim()); }
  }
  flushP(); flushL();
  return <div className="text-[13.5px] text-[#1F2937] dark:text-slate-200">{nodes}</div>;
};

export const ReportView: React.FC<{ r: ResearchApi; p: Project }> = ({ r, p }) => {
  const [copied, flash] = useFlash();
  const writing = p.phase === 'synthesizing';
  const rejected = p.sources.filter((s) => s.rejected).length;

  if (!p.report && !writing) {
    return <Empty icon={<FileText className="w-5 h-5" />} title="No report yet" body={p.phase === 'running' ? 'The report is written once the agents finish. Watch their progress on the Live tab.' : 'Run the research to produce a cited report.'} />;
  }
  const jump = (n: number) => { const el = document.getElementById(`ref-${n}`); el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); if (el) { el.animate([{ background: 'var(--color-accent-pastel)' }, { background: 'transparent' }], { duration: 1600 }); } };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Btn size="sm" variant="secondary" icon={copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} disabled={writing} onClick={() => { void navigator.clipboard.writeText(p.report); flash(); }}>{copied ? 'Copied' : 'Copy Markdown'}</Btn>
        <Btn size="sm" variant="secondary" icon={<Download className="w-3 h-3" />} disabled={writing || !p.report} onClick={() => downloadBlob(new Blob([p.report], { type: 'text/markdown' }), `${p.title.replace(/[^\w-]+/g, '-').slice(0, 60) || 'report'}.md`)}>Save .md</Btn>
        {p.phase === 'done' && rejected > 0 && <Btn size="sm" variant="ghost" icon={<RefreshCw className="w-3 h-3" />} onClick={() => r.writeReportFromPartial(p.id)}>Rewrite without {rejected} rejected source{rejected > 1 ? 's' : ''}</Btn>}
      </div>
      <Banner tone="info">Written by a local model from paper <strong>abstracts only</strong>. Treat it as a map of the literature and check claims against the cited sources.</Banner>
      <article className="rounded-[10px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-card)] px-7 py-6">
        {p.report ? <ReportMarkdown text={p.report} onCite={jump} /> : <div className="space-y-2.5">{[90, 70, 85, 60].map((w) => <Skeleton key={w} className="h-3" />)}</div>}
        {writing && <span className="inline-block w-1.5 h-4 bg-[var(--color-accent-vibrant)] animate-pulse align-middle ml-0.5" aria-hidden />}
      </article>
    </div>
  );
};
