import React, { useEffect, useRef, useState } from 'react';
import { Eraser, Square, X } from 'lucide-react';
import { Btn, IconBtn, cx } from '../common/ui';
import type { Terminal } from '../../builder/useTerminal';

/** Output of every command the user or the agent ran, plus a line to run your own. */
export const TerminalPanel: React.FC<{ term: Terminal; disabled: boolean }> = ({ term, disabled }) => {
  const [cmd, setCmd] = useState('');
  const [past, setPast] = useState<string[]>([]);
  const [at, setAt] = useState<number | null>(null);
  const pre = useRef<HTMLPreElement>(null);
  const stick = useRef(true);
  const cur = term.current;

  useEffect(() => { const el = pre.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [cur?.text, cur?.id]);

  const submit = () => {
    const c = cmd.trim();
    if (!c || disabled) return;
    setPast((p) => [...p.filter((x) => x !== c), c].slice(-50)); setAt(null); setCmd('');
    void term.run(c);
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { submit(); return; }
    if (e.key === 'ArrowUp' && past.length) { e.preventDefault(); const i = at === null ? past.length - 1 : Math.max(0, at - 1); setAt(i); setCmd(past[i]); }
    if (e.key === 'ArrowDown' && at !== null) { e.preventDefault(); const i = at + 1; if (i >= past.length) { setAt(null); setCmd(''); } else { setAt(i); setCmd(past[i]); } }
  };

  return (
    <div className="h-full min-h-0 flex flex-col bg-[var(--color-bg-panel)]">
      <div className="h-8 shrink-0 flex items-center gap-1 px-2 border-b border-[var(--sep)] overflow-x-auto" role="tablist" aria-label="Terminal sessions">
        {term.sessions.map((s) => (
          <span key={s.id} className={cx('shrink-0 inline-flex items-center gap-1.5 h-6 pl-2 pr-1 rounded-[6px] text-[12px]', cur?.id === s.id ? 'bg-[var(--pressed)] font-medium' : 'hover:bg-[var(--hover)]')}>
            <button type="button" role="tab" aria-selected={cur?.id === s.id} onClick={() => term.setActive(s.id)} className="inline-flex items-center gap-1.5 max-w-[160px]">
              <span className={cx('w-1.5 h-1.5 rounded-full shrink-0', s.running ? 'bg-[var(--c-green)] animate-pulse' : s.code === 0 || s.code === undefined ? 'bg-[var(--color-text-muted)]' : 'bg-[var(--c-red)]')} aria-label={s.running ? 'Running' : 'Finished'} />
              <span className="truncate font-mono">{s.title}</span>
            </button>
            <IconBtn label={`Close ${s.title}`} className="!w-4 !h-4" onClick={() => term.close(s.id)}><X className="w-3 h-3" /></IconBtn>
          </span>
        ))}
        {!term.sessions.length && <span className="text-[12px] text-[var(--color-text-muted)] px-1">Terminal</span>}
        <span className="flex-1" />
        {cur?.running && <Btn size="sm" icon={<Square className="w-3 h-3" fill="currentColor" />} onClick={() => term.kill(cur.id)}>Stop</Btn>}
        {cur && <IconBtn label="Clear output" className="!w-6 !h-6" onClick={() => term.clear(cur.id)}><Eraser className="w-3.5 h-3.5" /></IconBtn>}
      </div>
      <pre ref={pre} tabIndex={0} aria-label="Terminal output" aria-live="off"
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}
        className="flex-1 min-h-0 overflow-auto m-0 px-3 py-2 font-mono text-[12px] leading-[18px] whitespace-pre-wrap break-words text-[var(--color-text-main)]">{cur?.text || (term.sessions.length ? '' : 'Commands you run, and commands the agent runs, appear here.\n')}</pre>
      <div className="h-9 shrink-0 flex items-center gap-2 px-3 border-t border-[var(--sep)]">
        <span className="font-mono text-[12px] text-[var(--color-text-muted)]" aria-hidden="true">&gt;</span>
        <input aria-label="Run a command in the project folder" value={cmd} onChange={(e) => setCmd(e.target.value)} onKeyDown={onKey} disabled={disabled} spellCheck={false}
          placeholder={disabled ? 'Open a project to run commands' : 'Run a command in the project folder, e.g. npm install'}
          className="flex-1 min-w-0 bg-transparent font-mono text-[12px] outline-none placeholder:text-[var(--color-text-muted)]" />
      </div>
    </div>
  );
};
