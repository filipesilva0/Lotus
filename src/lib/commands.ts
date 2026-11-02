// Menu-bar commands that a page carries out (session 13): File › New Image, New Project…, New Task.
// The App's menus navigate to the page, then `runCommand` hands the command to it. A page that is
// not mounted yet picks the command up as soon as it mounts, so the menu item always does its job.

import { useEffect, useRef } from 'react';

export type PageCommand = 'new-image' | 'new-project' | 'new-task';

const handlers = new Map<PageCommand, () => void>();
const pending = new Set<PageCommand>();

export function runCommand(c: PageCommand) {
  const h = handlers.get(c);
  if (h) h(); else pending.add(c);
}

/** Registers the page's handler for `c` while it is mounted. */
export function useCommand(c: PageCommand, handler: () => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const h = () => ref.current();
    handlers.set(c, h);
    if (pending.delete(c)) queueMicrotask(h);
    return () => { if (handlers.get(c) === h) handlers.delete(c); };
  }, [c]);
}

/**
 * Edit › Find: puts the cursor in the current page's search field (the first visible one), opening
 * the page's sidebar first when the field lives there. Returns false when the page has none.
 */
export function focusPageSearch(root: ParentNode = document): boolean {
  const fields = Array.from(root.querySelectorAll<HTMLInputElement>('main input[type="search"]'));
  const f = fields.find((x) => x.offsetParent !== null || x.getClientRects().length > 0);
  if (!f) return false;
  f.focus();
  f.select();
  return true;
}
