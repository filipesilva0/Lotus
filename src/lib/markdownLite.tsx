import React from 'react';
import { openExternal } from './open';
import { Align, Block, Inline, inlineText, parseMarkdown, safeHref } from './gfm';

// Renders GitHub Flavored Markdown (parsed by ./gfm) as React elements for chat bubbles, the
// island and task notes. It never uses dangerouslySetInnerHTML, so model output cannot inject markup.
// Links open in the user's browser; remote images are shown as links (loading them would send a
// request to a third party just by displaying a reply).

export interface CiteSource { n: number; title: string; url: string }

interface Opts {
  onDark: boolean;
  sources?: CiteSource[];
  codeActions?: (lang: string, code: string) => React.ReactNode;
  /** Prefix for footnote anchors so several messages on one page do not clash. */
  idp: string;
}

const linkCls = (o: Opts) => (o.onDark ? 'underline underline-offset-2 decoration-white/60 hover:decoration-white' : 'text-[var(--color-accent-vibrant)] underline underline-offset-2 decoration-[var(--color-accent-vibrant)]/40 hover:decoration-[var(--color-accent-vibrant)]');
const localImage = (src: string) => /^(data:image\/|blob:|https?:\/\/(127\.0\.0\.1|localhost)[:/])/i.test(src);

function renderInline(list: Inline[], o: Opts, key: string): React.ReactNode[] {
  return list.map((x, i) => {
    const k = `${key}.${i}`;
    switch (x.t) {
      case 'text': return <React.Fragment key={k}>{x.v}</React.Fragment>;
      case 'br': return <br key={k} />;
      case 'code': return <code key={k} className={`px-1 py-px rounded-[4px] font-mono text-[0.9em] ${o.onDark ? 'bg-white/15' : 'bg-[var(--hover)]'}`}>{x.v}</code>;
      case 'strong': return <strong key={k} className="font-semibold">{renderInline(x.c, o, k)}</strong>;
      case 'em': return <em key={k}>{renderInline(x.c, o, k)}</em>;
      case 'del': return <del key={k} className="opacity-70">{renderInline(x.c, o, k)}</del>;
      case 'link': {
        const href = safeHref(x.href);
        if (!href) return <React.Fragment key={k}>{renderInline(x.c, o, k)}</React.Fragment>;
        return <a key={k} href={href} title={x.title ?? href} className={`${linkCls(o)} break-words`} onClick={(e) => { e.preventDefault(); void openExternal(href); }}>{renderInline(x.c, o, k)}</a>;
      }
      case 'image': {
        if (localImage(x.src)) return <img key={k} src={x.src} alt={x.alt} className="my-1 max-w-full rounded-[8px]" />;
        const href = safeHref(x.src);
        return href
          ? <a key={k} href={href} className={linkCls(o)} onClick={(e) => { e.preventDefault(); void openExternal(href); }}>Image: {x.alt || href}</a>
          : <React.Fragment key={k}>{x.alt}</React.Fragment>;
      }
      case 'cite': {
        const src = o.sources?.find((s) => s.n === x.n);
        return src
          ? <button key={k} type="button" onClick={() => void openExternal(src.url)} title={src.title} aria-label={`Source ${x.n}: ${src.title}`} className="align-super mx-px px-1 rounded-[4px] text-[10px] font-semibold bg-[var(--color-accent-fill)] text-white hover:brightness-110">{x.n}</button>
          : <React.Fragment key={k}>[{x.n}]</React.Fragment>;
      }
      case 'fnref': return <sup key={k}><a href={`#${o.idp}-fn-${x.id}`} id={`${o.idp}-fnref-${x.id}`} className={linkCls(o)} onClick={(e) => { e.preventDefault(); document.getElementById(`${o.idp}-fn-${x.id}`)?.scrollIntoView({ block: 'nearest' }); }}>{x.id}</a></sup>;
    }
  });
}

const alignCls = (a: Align) => (a === 'center' ? 'text-center' : a === 'right' ? 'text-right' : 'text-left');
const HSIZE = ['', 'text-[18px]', 'text-[16px]', 'text-[15px]', 'text-[14px]', 'text-[14px]', 'text-[13px]'];

function renderBlocks(blocks: Block[], o: Opts, key: string, tight = false): React.ReactNode[] {
  return blocks.map((b, i) => {
    const k = `${key}/${i}`;
    switch (b.t) {
      case 'p':
        return tight ? <React.Fragment key={k}>{renderInline(b.c, o, k)}</React.Fragment> : <p key={k} className="[&:not(:first-child)]:mt-2 break-words">{renderInline(b.c, o, k)}</p>;
      case 'h': {
        const Tag = `h${Math.min(6, b.level)}` as 'h1';
        return <Tag key={k} className={`${HSIZE[b.level]} font-semibold leading-snug [&:not(:first-child)]:mt-3 mb-1`}>{renderInline(b.c, o, k)}</Tag>;
      }
      case 'hr': return <hr key={k} className={`my-3 border-0 h-px ${o.onDark ? 'bg-white/30' : 'bg-[var(--sep)]'}`} />;
      case 'code':
        return (
          <div key={k} className="my-2 relative group/code">
            {b.lang && <span className={`absolute top-1.5 left-2.5 text-[10px] uppercase tracking-wide ${o.onDark ? 'text-white/60' : 'text-[var(--color-text-muted)]'}`}>{b.lang}</span>}
            <pre className={`p-2.5 ${b.lang ? 'pt-6' : ''} rounded-[8px] text-[12px] leading-relaxed overflow-x-auto whitespace-pre font-mono ${o.onDark ? 'bg-black/30' : 'bg-[var(--hover)]'}`}><code>{b.v}</code></pre>
            {o.codeActions && !b.open && <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover/code:opacity-100 focus-within:opacity-100 transition-opacity">{o.codeActions(b.lang, b.v)}</div>}
          </div>
        );
      case 'quote':
        return <blockquote key={k} className={`my-2 pl-3 border-l-2 ${o.onDark ? 'border-white/50 text-white/90' : 'border-[var(--sep)] text-[var(--color-text-muted)]'}`}>{renderBlocks(b.c, o, k)}</blockquote>;
      case 'list': {
        const tightList = !b.loose;
        const items = b.items.map((it, j) => (
          <li key={`${k}-${j}`} className={`${it.task !== null ? 'list-none -ml-5 flex gap-2 items-start' : ''} [&:not(:first-child)]:mt-0.5`}>
            {it.task !== null && <input type="checkbox" checked={it.task} readOnly disabled aria-label={it.task ? 'Done' : 'Not done'} className="mt-1 accent-[var(--color-accent-fill)] shrink-0" />}
            <div className="min-w-0 flex-1">{renderBlocks(it.c, o, `${k}-${j}`, tightList)}</div>
          </li>
        ));
        return b.ordered
          ? <ol key={k} start={b.start} className="my-1.5 pl-6 list-decimal marker:opacity-70">{items}</ol>
          : <ul key={k} className="my-1.5 pl-6 list-disc marker:opacity-70">{items}</ul>;
      }
      case 'table':
        return (
          <div key={k} className="my-2 overflow-x-auto" role="region" aria-label="Table" tabIndex={0}>
            <table className="border-collapse text-[13px] min-w-full">
              <thead>
                <tr>{b.head.map((c, j) => <th key={j} scope="col" className={`px-2.5 py-1.5 font-semibold border-b ${o.onDark ? 'border-white/40' : 'border-[var(--sep)]'} ${alignCls(b.align[j])}`}>{renderInline(c, o, `${k}h${j}`)}</th>)}</tr>
              </thead>
              <tbody>
                {b.rows.map((r, ri) => (
                  <tr key={ri} className={o.onDark ? '' : 'even:bg-[var(--hover)]'}>
                    {r.map((c, j) => <td key={j} className={`px-2.5 py-1.5 align-top border-b ${o.onDark ? 'border-white/20' : 'border-[var(--sep)]'} ${alignCls(b.align[j])}`}>{renderInline(c, o, `${k}r${ri}c${j}`)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'footnotes':
        return (
          <section key={k} aria-label="Footnotes" className={`mt-3 pt-2 border-t text-[12px] ${o.onDark ? 'border-white/30' : 'border-[var(--sep)] text-[var(--color-text-muted)]'}`}>
            <ol className="pl-5 list-decimal">
              {b.items.map((f) => <li key={f.id} id={`${o.idp}-fn-${f.id}`}>{renderBlocks(f.c, o, `${k}-${f.id}`, true)}</li>)}
            </ol>
          </section>
        );
    }
  });
}

let seq = 0;

/** GitHub Flavored Markdown for chat bubbles. (Name kept from the earlier, smaller renderer.) */
export const MarkdownLite: React.FC<{ text: string; onDark?: boolean; sources?: CiteSource[]; codeActions?: (lang: string, code: string) => React.ReactNode }> = ({ text, onDark = true, sources, codeActions }) => {
  const idp = React.useMemo(() => `md${++seq}`, []);
  const blocks = React.useMemo(() => parseMarkdown(text), [text]);
  return <div className="gfm min-w-0">{renderBlocks(blocks, { onDark, sources, codeActions, idp }, idp)}</div>;
};

export const Markdown = MarkdownLite;

/** Plain text for text-to-speech: drops code blocks and markdown punctuation. */
export function toSpeakable(md: string): string {
  return parseMarkdown(md).map(function walk(b: Block): string {
    switch (b.t) {
      case 'code': return ' code omitted. ';
      case 'p': case 'h': return inlineText(b.c);
      case 'quote': return b.c.map(walk).join(' ');
      case 'list': return b.items.map((it) => it.c.map(walk).join(' ')).join('. ');
      case 'table': return b.rows.map((r) => r.map(inlineText).join(', ')).join('. ');
      case 'footnotes': return '';
      case 'hr': return ' ';
    }
  }).join(' ').replace(/\s+/g, ' ').trim();
}
