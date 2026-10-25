import React from 'react';

// Small, dependency-free renderer for chat bubbles: code fences, `inline code`, **bold**, *italic*, links.
// It never uses dangerouslySetInnerHTML, so model output cannot inject markup.

function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|https?:\/\/[^\s)]+)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0], k = `${keyBase}-${i++}`;
    if (t.startsWith('`')) out.push(<code key={k} className="px-1 py-px rounded-[6px] bg-white/10 text-[0.92em]">{t.slice(1, -1)}</code>);
    else if (t.startsWith('**')) out.push(<strong key={k} className="font-semibold">{t.slice(2, -2)}</strong>);
    else if (t.startsWith('*')) out.push(<em key={k}>{t.slice(1, -1)}</em>);
    else out.push(<span key={k} className="underline underline-offset-2 break-all">{t}</span>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export const MarkdownLite: React.FC<{ text: string; onDark?: boolean }> = ({ text, onDark = true }) => {
  const parts = text.split(/```/);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 1) {
          const body = part.replace(/^[^\n]*\n/, '');
          return (
            <pre key={i} className={`my-1.5 p-2.5 rounded-[10px] text-[11px] leading-relaxed overflow-x-auto whitespace-pre ${onDark ? 'bg-black/40' : 'bg-black/5'}`}>
              <code>{body.replace(/\n$/, '')}</code>
            </pre>
          );
        }
        return part.split(/\n{2,}/).map((para, j) =>
          para.trim() ? (
            <p key={`${i}-${j}`} className="whitespace-pre-wrap [&:not(:first-child)]:mt-2">{inline(para.replace(/^\s+|\s+$/g, ''), `${i}-${j}`)}</p>
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
