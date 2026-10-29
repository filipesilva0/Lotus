import React from 'react';
import { openExternal } from './open';

// Small, dependency-free renderer for chat bubbles: code fences, `inline code`, **bold**, *italic*, links.
// It never uses dangerouslySetInnerHTML, so model output cannot inject markup.

export interface CiteSource { n: number; title: string; url: string }

function inline(text: string, keyBase: string, sources?: CiteSource[]): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|https?:\/\/[^\s)]+|\[\d{1,2}\])/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0], k = `${keyBase}-${i++}`;
    if (t.startsWith('`')) out.push(<code key={k} className="px-1 py-px rounded-[6px] bg-white/10 text-[0.92em]">{t.slice(1, -1)}</code>);
    else if (t.startsWith('**')) out.push(<strong key={k} className="font-semibold">{t.slice(2, -2)}</strong>);
    else if (t.startsWith('*')) out.push(<em key={k}>{t.slice(1, -1)}</em>);
    else if (/^\[\d{1,2}\]$/.test(t)) {
      const n = parseInt(t.slice(1, -1), 10), src = sources?.find((x) => x.n === n);
      out.push(src
        ? <button key={k} type="button" onClick={() => void openExternal(src.url)} title={src.title} aria-label={`Source ${n}: ${src.title}`} className="align-super mx-px px-1 rounded-[4px] text-[10px] font-semibold bg-[var(--color-accent-fill)] text-white hover:brightness-110">{n}</button>
        : t);
    }
    else out.push(<span key={k} className="underline underline-offset-2 break-all">{t}</span>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export const MarkdownLite: React.FC<{ text: string; onDark?: boolean; sources?: CiteSource[]; codeActions?: (lang: string, code: string) => React.ReactNode }> = ({ text, onDark = true, sources, codeActions }) => {
  const parts = text.split(/```/);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 1) {
          const lang = (part.match(/^([^\n]*)\n/)?.[1] ?? '').trim();
          const body = part.replace(/^[^\n]*\n/, '').replace(/\n$/, '');
          return (
            <div key={i} className="my-1.5 relative group/code">
              <pre className={`p-2.5 rounded-[10px] text-[11px] leading-relaxed overflow-x-auto whitespace-pre ${onDark ? 'bg-black/40' : 'bg-black/5'}`}>
                <code>{body}</code>
              </pre>
              {codeActions && <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover/code:opacity-100 focus-within:opacity-100 transition-opacity">{codeActions(lang, body)}</div>}
            </div>
          );
        }
        return part.split(/\n{2,}/).map((para, j) =>
          para.trim() ? (
            <p key={`${i}-${j}`} className="whitespace-pre-wrap [&:not(:first-child)]:mt-2">{inline(para.replace(/^\s+|\s+$/g, ''), `${i}-${j}`, sources)}</p>
          ) : null,
        );
      })}
    </>
  );
};

/** Plain text for text-to-speech: drops code blocks and markdown punctuation. */
export function toSpeakable(md: string): string {
  return md.replace(/```[\s\S]*?```/g, ' code omitted. ').replace(/[`*_#>]/g, '').replace(/\s+/g, ' ').trim();
}
