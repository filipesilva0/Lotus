// Settings → Tools names each tool as an ability (0.20). Pure, for tests.

/** Tool labels are written for the progress line ("Reading a file"); here they name an ability ("Read a file"). */
export const toolLabel = (label: string) => label
  .replace(/^(\w+?)(?:ing)\b/, (_m, stem: string) => {
    const w = stem.toLowerCase();
    const fixed: Record<string, string> = { mak: 'Make', writ: 'Write', sav: 'Save', mov: 'Move', chang: 'Change', creat: 'Create', delet: 'Delete', remov: 'Remove', updat: 'Update', us: 'Use', tak: 'Take', typ: 'Type', clos: 'Close', describ: 'Describe', schedul: 'Schedule', rememb: 'Remember', run: 'Run', stopp: 'Stop', plann: 'Plan', scroll: 'Scroll', search: 'Search', read: 'Read', open: 'Open', add: 'Add', list: 'List', ask: 'Ask', click: 'Click', press: 'Press', look: 'Look', check: 'Check', find: 'Find', fetch: 'Fetch', start: 'Start', edit: 'Edit', draw: 'Draw', speak: 'Speak', send: 'Send', learn: 'Learn', forgett: 'Forget', forget: 'Forget' };
    return fixed[w] ?? stem[0].toUpperCase() + stem.slice(1);
  })
  .replace(/\bits soul\b/g, 'the Soul');
