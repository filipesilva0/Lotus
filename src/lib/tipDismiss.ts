// Tips (`.tip[data-tip]`, index.css) show on hover. After a click the pointer is usually still over the
// control, so the tip used to stay up and cover what the click opened (rail tips over the sidebar).
// A click hides it until the pointer leaves the control.

export function installTipDismiss(doc: Document = document): () => void {
  const down = (e: Event) => {
    const el = (e.target as Element | null)?.closest?.('.tip');
    if (!el) return;
    el.classList.add('tip-off');
    const leave = () => { el.classList.remove('tip-off'); el.removeEventListener('pointerleave', leave); };
    el.addEventListener('pointerleave', leave);
  };
  doc.addEventListener('pointerdown', down, true);
  return () => doc.removeEventListener('pointerdown', down, true);
}
