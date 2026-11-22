// 0.21: the files a Work job makes, as the user meets them: a card under the answer (opens in the
// Artifacts panel, or straight in Word / Excel / PowerPoint / the browser) and the panel's previews of
// Word, Excel and PowerPoint files, drawn from the text Lotus built them from (src/lib/officeText.ts).

import React, { useState } from 'react';
import { AudioLines, Clapperboard, Code2, ExternalLink, FileSpreadsheet, FileText, Globe, Image as ImageIcon, Presentation, Table2 } from 'lucide-react';
import { OFFICE_LABEL, cellOf, parseSheets, splitSlides, type Block, type Inline } from '../../lib/officeText';
import { MarkdownLite } from '../../lib/markdownLite';
import { IconBtn, Segmented, cx } from '../common/ui';

export const KIND_ICON: Record<string, React.ReactNode> = {
  document: <FileText className="w-4 h-4" />, page: <Globe className="w-4 h-4" />, table: <Table2 className="w-4 h-4" />,
  image: <ImageIcon className="w-4 h-4" />, picture: <ImageIcon className="w-4 h-4" />, video: <Clapperboard className="w-4 h-4" />, audio: <AudioLines className="w-4 h-4" />,
  code: <Code2 className="w-4 h-4" />, data: <Code2 className="w-4 h-4" />, file: <FileText className="w-4 h-4" />,
  word: <FileText className="w-4 h-4" />, spreadsheet: <FileSpreadsheet className="w-4 h-4" />, slides: <Presentation className="w-4 h-4" />,
};
/** Each Office kind keeps its app's familiar colour, so a Word file is recognisable at a glance. */
const KIND_TINT: Record<string, string> = { word: '#2B579A', spreadsheet: '#217346', slides: '#C43E1C' };
const LABEL: Record<string, string> = { ...OFFICE_LABEL, picture: 'Picture', video: 'Video', audio: 'Sound' };
export const kindLabel = (kind: string) => LABEL[kind] ?? 'File';
/** Kinds the computer's own app opens better than Lotus's preview. */
export const opensOutside = (kind: string) => kind === 'word' || kind === 'spreadsheet' || kind === 'slides' || kind === 'page';
export const openLabel = (kind: string) => kind === 'word' ? 'Open in Word' : kind === 'spreadsheet' ? 'Open in Excel' : kind === 'slides' ? 'Open in PowerPoint' : kind === 'page' ? 'Open in browser' : 'Open';

export const KindTile: React.FC<{ kind: string; size?: number }> = ({ kind, size = 32 }) => {
  const tint = KIND_TINT[kind];
  return (
    <span style={{ width: size, height: size, ...(tint ? { background: tint, color: '#fff' } : {}) }}
      className={cx('rounded-[7px] inline-flex items-center justify-center shrink-0', !tint && 'bg-[var(--color-accent-pastel)] text-[var(--color-accent-vibrant)]')}>
      {KIND_ICON[kind] ?? KIND_ICON.file}
    </span>
  );
};

/** A file the answer made: click to preview it in the panel; the arrow opens it in its own app. */
export const FileCard: React.FC<{ file: string; title: string; kind: string; onPreview: () => void; onOpen?: () => void }> = ({ file, title, kind, onPreview, onOpen }) => (
  <div className="group flex items-center gap-2.5 w-[260px] max-w-full p-2 pr-1.5 rounded-[12px] bg-[var(--color-bg-card)] shadow-[0_0_0_0.5px_var(--sep)] hover:shadow-[0_0_0_1px_var(--color-accent-fill)] transition-shadow">
    <button type="button" onClick={onPreview} className="flex-1 min-w-0 flex items-center gap-2.5 text-left focus:outline-none focus-visible:outline-[3px] focus-visible:outline-[var(--ring)] rounded-[8px]" aria-label={`Preview ${title}`}>
      <KindTile kind={kind} size={36} />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium truncate">{title}</span>
        <span className="block text-[12px] text-[var(--color-text-muted)] truncate">{kindLabel(kind)} · {file}</span>
      </span>
    </button>
    {onOpen && opensOutside(kind) && <IconBtn label={openLabel(kind)} className="!w-7 !h-7 shrink-0" onClick={onOpen}><ExternalLink className="w-3.5 h-3.5" /></IconBtn>}
  </div>
);

// ── Previews ────────────────────────────────────────────────────────────────
const Runs: React.FC<{ t: Inline[] }> = ({ t }) => <>{t.map((r, i) => {
  let n: React.ReactNode = r.text;
  if (r.code) n = <code className="px-1 rounded bg-black/5 font-mono text-[0.92em]">{n}</code>;
  if (r.bold) n = <strong>{n}</strong>;
  if (r.italic) n = <em>{n}</em>;
  if (r.link) n = <span className="text-[#2563EB] underline">{n}</span>;
  return <React.Fragment key={i}>{n}</React.Fragment>;
})}</>;

const SlideBlocks: React.FC<{ blocks: Block[] }> = ({ blocks }) => (
  <div className="space-y-[0.4em]">
    {blocks.map((b, i) => b.type === 'list' ? (
      <ul key={i} className="space-y-[0.25em]">{b.items.map((it, k) => <li key={k} className="flex gap-[0.5em]" style={{ paddingLeft: `${it.level * 1.2}em` }}><span className="text-[#2563EB]">{b.ordered ? `${k + 1}.` : '•'}</span><span><Runs t={it.text} /></span></li>)}</ul>
    ) : b.type === 'table' ? (
      <table key={i} className="w-full border-collapse text-[0.8em]">
        <tbody>{b.rows.map((r, ri) => <tr key={ri} className={ri === 0 ? 'bg-[#EEF2FF] font-semibold' : ''}>{r.map((c, ci) => <td key={ci} className="border border-[#D1D5DB] px-[0.4em] py-[0.15em]"><Runs t={c} /></td>)}</tr>)}</tbody>
      </table>
    ) : b.type === 'code' ? <pre key={i} className="font-mono text-[0.75em] whitespace-pre-wrap">{b.text}</pre>
      : b.type === 'rule' ? null
      : <p key={i} className={b.type === 'heading' ? 'font-semibold text-[#2563EB]' : b.type === 'quote' ? 'italic text-[#6B7280]' : ''}><Runs t={b.text} /></p>)}
  </div>
);

/** A slide drawn the way the .pptx lays it out (16:9, accent bar, title, bullets). */
const SlideCard: React.FC<{ s: ReturnType<typeof splitSlides>[number]; n: number; first: boolean }> = ({ s, n, first }) => {
  const titleSlide = !s.blocks.length && (first || !!s.subtitle);
  return (
    <figure className="m-0">
      <div className="relative aspect-video rounded-[6px] bg-white text-[#1F2937] shadow-[0_0_0_0.5px_var(--sep),0_1px_4px_rgba(0,0,0,.08)] overflow-hidden text-[10px] [container-type:inline-size]" style={{ fontSize: 'clamp(6px, 2.6cqw, 14px)' }}>
        {titleSlide ? (<>
          <span className="absolute left-0 top-0 bottom-0 w-[1.9%] bg-[#2563EB]" />
          <div className="absolute left-[7%] right-[7%] top-[30%]">
            <p className="text-[2.6em] font-bold leading-tight">{s.title}</p>
            {s.subtitle && <p className="mt-[0.4em] text-[1.3em] text-[#6B7280]">{s.subtitle}</p>}
          </div>
        </>) : (<>
          <p className="absolute left-[4.5%] right-[4.5%] top-[6%] text-[1.9em] font-bold leading-tight truncate">{s.title}</p>
          <span className="absolute left-[4.5%] top-[18%] w-[9%] h-[0.8%] bg-[#2563EB]" />
          <div className="absolute left-[4.5%] right-[4.5%] top-[23%] bottom-[5%] overflow-hidden text-[1.25em] leading-snug"><SlideBlocks blocks={s.blocks} /></div>
        </>)}
      </div>
      <figcaption className="mt-1 text-[12px] text-[var(--color-text-muted)]">Slide {n}{s.notes ? ` · Notes: ${s.notes.slice(0, 120)}${s.notes.length > 120 ? '…' : ''}` : ''}</figcaption>
    </figure>
  );
};

const SheetView: React.FC<{ text: string }> = ({ text }) => {
  const sheets = parseSheets(text);
  const [tab, setTab] = useState(0);
  const sh = sheets[Math.min(tab, sheets.length - 1)];
  if (!sh) return <p className="p-4 text-[13px] text-[var(--color-text-muted)]">This spreadsheet is empty.</p>;
  const cols = Math.max(...sh.rows.map((r) => r.length));
  const col = (i: number) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex-1 min-h-0 overflow-auto bg-white text-[#1F2937]">
        <table className="text-[12px] border-collapse">
          <thead><tr><th className="sticky top-0 w-8 bg-[#F3F4F6] border border-[#E5E7EB]" />{Array.from({ length: cols }, (_, i) => <th key={i} className="sticky top-0 px-2 py-0.5 bg-[#F3F4F6] border border-[#E5E7EB] font-normal text-[#6B7280]">{col(i)}</th>)}</tr></thead>
          <tbody>{sh.rows.map((r, ri) => (
            <tr key={ri}>
              <td className="px-1.5 text-right bg-[#F3F4F6] border border-[#E5E7EB] text-[#6B7280] tabular-nums">{ri + 1}</td>
              {Array.from({ length: cols }, (_, ci) => {
                const raw = r[ci] ?? '';
                const c = ri === 0 ? null : cellOf(raw);
                const num = c && (c.t === 'n' || c.t === 'd');
                return <td key={ci} title={c?.t === 'f' ? raw : undefined} className={cx('px-2 py-0.5 border border-[#E5E7EB] whitespace-nowrap max-w-[220px] truncate', ri === 0 && 'font-semibold bg-[#EEF2FF]', num && 'text-right tabular-nums', c?.t === 'f' && 'text-[#217346] font-mono')}>{raw}</td>;
              })}
            </tr>
          ))}</tbody>
        </table>
      </div>
      {sheets.length > 1 && (
        <div role="tablist" aria-label="Sheets" className="shrink-0 flex gap-0.5 px-2 py-1 border-t border-[var(--sep)] overflow-x-auto">
          {sheets.map((x, i) => <button key={x.name} type="button" role="tab" aria-selected={i === tab} onClick={() => setTab(i)} className={cx('h-7 px-2.5 rounded-[6px] text-[12px] whitespace-nowrap', i === tab ? 'bg-[var(--pressed)] font-medium' : 'text-[var(--color-text-muted)] hover:bg-[var(--hover)]')}>{x.name}</button>)}
        </div>
      )}
      <p className="shrink-0 px-3 py-1.5 text-[12px] text-[var(--color-text-muted)] border-t border-[var(--sep)]">Formulas are worked out when the file opens in Excel.</p>
    </div>
  );
};

/** The preview of a Word, Excel or PowerPoint artifact, from its text. */
export const OfficePreview: React.FC<{ kind: string; text: string }> = ({ kind, text }) => {
  const [mode, setMode] = useState<'preview' | 'source'>('preview');
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-3 py-1.5 flex items-center border-b border-[var(--sep)]">
        <Segmented label="View" value={mode} onChange={setMode} options={[{ id: 'preview', label: 'Preview' }, { id: 'source', label: kind === 'spreadsheet' ? 'Data' : 'Text' }]} />
      </div>
      {mode === 'source' ? <pre className="flex-1 min-h-0 overflow-auto p-3 text-[12px] font-mono leading-relaxed whitespace-pre-wrap break-words">{text}</pre>
        : kind === 'spreadsheet' ? <SheetView text={text} />
        : kind === 'slides' ? (
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3 bg-[var(--color-bg-main)]">{splitSlides(text).map((s, i) => <SlideCard key={i} s={s} n={i + 1} first={i === 0} />)}</div>
        ) : (
          // A page of the Word document: white paper whatever the app's theme, like Word shows it.
          <div className="flex-1 min-h-0 overflow-y-auto p-3 bg-[var(--color-bg-main)]">
            <div className="bg-white text-[#1F2937] rounded-[4px] shadow-[0_0_0_0.5px_var(--sep),0_1px_4px_rgba(0,0,0,.08)] px-7 py-8 text-[13px] leading-relaxed [&_h1]:text-[22px] [&_h2]:text-[17px] [&_h1]:font-bold [&_h2]:font-semibold [&_h2]:text-[#2B579A]">
              <MarkdownLite text={text} onDark={false} />
            </div>
          </div>
        )}
    </div>
  );
};
