import React, { createContext, useContext } from 'react';

/**
 * Left / right panel visibility for the current page (session 8).
 * The title bar's "Show/Hide left panel" and "Show/Hide right panel" buttons drive this. Each page
 * remembers its own choice (App keeps one entry per view in `lotus.panels.v1`).
 * - left  = the page's list (chats, image sessions, voices, research tasks, project files, models)
 * - right = the page's inspector
 * SidebarPane / InspectorPane read it, so any page built from them follows automatically.
 */
export interface PanelState { left: boolean; right: boolean }
export interface PanelsApi extends PanelState {
  setLeft: (on: boolean) => void;
  setRight: (on: boolean) => void;
}

const noop = () => undefined;
export const PanelsContext = createContext<PanelsApi>({ left: true, right: true, setLeft: noop, setRight: noop });

export const usePanels = (): PanelsApi => useContext(PanelsContext);

export const PanelsProvider: React.FC<{ value: PanelsApi; children: React.ReactNode }> = ({ value, children }) => (
  <PanelsContext.Provider value={value}>{children}</PanelsContext.Provider>
);

/** Default visibility for a page that has never been toggled. */
export const DEFAULT_PANELS: PanelState = { left: true, right: true };
