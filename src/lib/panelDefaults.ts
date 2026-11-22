// Which panels a page shows before you toggle them (DOM-free, so core tests can import it).

export interface PanelState { left: boolean; right: boolean }

/** Default visibility for a page that has never been toggled. The inspector starts closed (session 16):
 *  it holds settings you reach for now and then, not something to look at all the time. */
export const DEFAULT_PANELS: PanelState = { left: true, right: false };

/** 0.21: Work's right panel holds the files a job makes, so it starts open there (it can be hidden now). */
export const defaultPanelsFor = (view: string): PanelState => (view === 'work' ? { left: true, right: true } : DEFAULT_PANELS);
