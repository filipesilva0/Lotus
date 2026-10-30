import React, { useRef } from 'react';

const GUTTER_MAX = 20000;

/**
 * A small plain-text code editor: line numbers, Tab indents, Ctrl/Cmd+S saves.
 * (No syntax colouring and no autocomplete; the agent and the preview are the main tools here.)
 */
export const CodeEditor: React.FC<{ path: string; value: string; onChange: (v: string) => void; onSave: () => void }> = ({ path, value, onChange, onSave }) => {
  const gutter = useRef<HTMLPreElement>(null);
  const lines = value.split('\n').length;
  const nums = Array.from({ length: Math.min(lines, GUTTER_MAX) }, (_, i) => i + 1).join('\n');

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); onSave(); return; }
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const t = e.currentTarget;
      t.setRangeText('  ', t.selectionStart, t.selectionEnd, 'end');
      onChange(t.value);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex bg-[var(--color-bg-panel)] font-mono text-[12px] leading-[20px]">
      <pre ref={gutter} aria-hidden="true" className="shrink-0 select-none overflow-hidden py-2 pl-3 pr-2 text-right text-[var(--color-text-muted)] opacity-70 bg-[var(--hover)]/40 m-0" style={{ minWidth: `${String(lines).length + 3}ch` }}>{nums}</pre>
      <textarea
        aria-label={`Editing ${path}`} value={value} spellCheck={false} wrap="off" autoCapitalize="off" autoCorrect="off"
        onChange={(e) => onChange(e.target.value)} onKeyDown={onKey}
        onScroll={(e) => { if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop; }}
        className="flex-1 min-w-0 resize-none py-2 px-3 bg-transparent text-[var(--color-text-main)] whitespace-pre overflow-auto outline-none focus-visible:outline-none"
      />
    </div>
  );
};
