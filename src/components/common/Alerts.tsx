import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Btn } from './ui';
import { LotusMark } from './LotusMark';

/*
 * HIG alerts and undo (session 13).
 * - `confirmAlert` replaces window.confirm: app icon, a title that says what will happen, optional
 *   informative text, Cancel on the leading side and a specific verb on the trailing side. The verb
 *   is the default button (Return) because the person already chose the action; Escape cancels.
 * - `offerUndo` is for deletes that can be taken back: the item disappears at once and a small
 *   "Undo" note stays for a few seconds instead of asking first. The delete is only carried out
 *   when the note goes away (or another delete replaces it).
 */

interface AlertReq { id: number; title: string; message?: string; confirm: string; cancel: string; resolve: (ok: boolean) => void }
interface UndoReq { id: number; message: string; undo: () => void; commit: () => void; timer: ReturnType<typeof setTimeout> }

let alertQ: AlertReq[] = [];
let undoNow: UndoReq | null = null;
let seq = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
let snap = { alert: null as AlertReq | null, undo: null as UndoReq | null };
const refresh = () => { snap = { alert: alertQ[0] ?? null, undo: undoNow }; emit(); };

/** Asks before an action that can't be undone. Resolves true when the person picks the action. */
export function confirmAlert(o: { title: string; message?: string; confirm: string; cancel?: string }): Promise<boolean> {
  return new Promise((resolve) => {
    alertQ = [...alertQ, { id: ++seq, title: o.title, message: o.message, confirm: o.confirm, cancel: o.cancel ?? 'Cancel', resolve }];
    refresh();
  });
}

const answer = (ok: boolean) => {
  const a = alertQ[0];
  if (!a) return;
  alertQ = alertQ.slice(1);
  refresh();
  a.resolve(ok);
};

/** How long the Undo note stays (ms). */
export const UNDO_MS = 8000;

/** Shows "<message> · Undo". `commit` runs when the note closes without Undo. */
export function offerUndo(message: string, undo: () => void, commit: () => void) {
  if (undoNow) { clearTimeout(undoNow.timer); undoNow.commit(); }
  const id = ++seq;
  const timer = setTimeout(() => { if (undoNow?.id === id) { const u = undoNow; undoNow = null; refresh(); u.commit(); } }, UNDO_MS);
  undoNow = { id, message, undo, commit, timer };
  refresh();
}

const takeUndo = () => {
  const u = undoNow;
  if (!u) return;
  clearTimeout(u.timer);
  undoNow = null;
  refresh();
  u.undo();
};

const typingIn = (t: Element | null) => !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || (t as HTMLElement).isContentEditable);

/** Edit › Undo: takes back a pending delete unless the cursor is in a text field. True when it did. */
export function takeUndoIfIdle(): boolean {
  if (!undoNow || typingIn(document.activeElement)) return false;
  takeUndo();
  return true;
}

/** Finish a pending delete right away (e.g. before quitting). */
export function flushUndo() {
  const u = undoNow;
  if (!u) return;
  clearTimeout(u.timer);
  undoNow = null;
  refresh();
  u.commit();
}

/** Mount once near the root. */
export const AlertHost: React.FC = () => {
  const { alert, undo } = useSyncExternalStore(subscribe, () => snap, () => snap);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!alert) return;
    const prev = document.activeElement as HTMLElement | null;
    boxRef.current?.querySelector<HTMLButtonElement>('[data-default]')?.focus();
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || (e.key === '.' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); e.stopPropagation(); answer(false); }
    };
    window.addEventListener('keydown', h, true);
    return () => { window.removeEventListener('keydown', h, true); prev?.focus?.(); };
  }, [alert]);

  // Edit > Undo (Ctrl/Cmd+Z) also takes back the delete while the note is showing, unless you are typing.
  useEffect(() => {
    if (!undo) return;
    const h = (e: KeyboardEvent) => {
      if (!typingIn(e.target as Element | null) && (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); takeUndo(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [undo]);

  return createPortal(<>
    {alert && (
      <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[14vh] px-4 bg-black/20 dark:bg-black/40">
        <div ref={boxRef} role="alertdialog" aria-modal="true" aria-labelledby={`alert-t-${alert.id}`} aria-describedby={alert.message ? `alert-m-${alert.id}` : undefined}
          className="material-frosted w-[260px] rounded-[12px] px-4 pt-5 pb-4 flex flex-col items-center text-center">
          <LotusMark size={44} />
          <h2 id={`alert-t-${alert.id}`} className="mt-3 text-[13px] font-semibold leading-snug text-[var(--color-text-main)]">{alert.title}</h2>
          {alert.message && <p id={`alert-m-${alert.id}`} className="mt-1.5 text-[12px] leading-snug text-[var(--color-text-main)]">{alert.message}</p>}
          <div className="mt-4 w-full grid grid-cols-2 gap-2">
            <Btn onClick={() => answer(false)}>{alert.cancel}</Btn>
            <Btn data-default variant="primary" onClick={() => answer(true)}>{alert.confirm}</Btn>
          </div>
        </div>
      </div>
    )}
    {undo && (
      <div role="status" className="fixed z-[65] top-12 left-1/2 -translate-x-1/2 material-frosted rounded-[10px] pl-3.5 pr-1.5 h-9 flex items-center gap-3 text-[13px] text-[var(--color-text-main)]">
        <span>{undo.message}</span>
        <Btn size="sm" variant="ghost" onClick={takeUndo}>Undo</Btn>
      </div>
    )}
  </>, document.body);
};
