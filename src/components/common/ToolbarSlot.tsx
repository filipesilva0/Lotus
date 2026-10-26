import React, { createContext, useContext } from 'react';
import { createPortal } from 'react-dom';

/**
 * The window toolbar owns one slot. A workspace that has sections (Voice, Engines) renders its tabs
 * into that slot, so the app has a single top bar instead of a toolbar plus a second header.
 */
export const ToolbarSlotContext = createContext<HTMLElement | null>(null);

export const ToolbarContent: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const slot = useContext(ToolbarSlotContext);
  return slot ? createPortal(children, slot) : null;
};
