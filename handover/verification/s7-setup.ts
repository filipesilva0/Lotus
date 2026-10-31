// Session 7: modules that listen for cross-window storage events need window.addEventListener.
const g = globalThis as any;
if (typeof g.addEventListener !== 'function') { g.addEventListener = () => undefined; g.removeEventListener = () => undefined; }
