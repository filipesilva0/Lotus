import { MessageSquare, Image as ImageIcon, AudioLines, Server, Briefcase, SquareKanban, Sparkles, Clapperboard } from 'lucide-react';
import type { ViewMode } from '../../types/lotus';

export interface PageDef {
  id: ViewMode;
  label: string;
  glyph: typeof Server;
  /** Longer name for the rail's tip and screen readers, when the label is short. */
  title?: string;
}

/**
 * Every page on the rail, in order (0.21). The rail, the Go menu, the Ctrl+number shortcuts and the
 * pages the island or tray may open all come from this one list, so adding a page is one entry here
 * (plus its id in ViewMode and its render line in App.tsx). Engines & Models stays last: the rail shows
 * it at the foot, and it takes the number after the workspaces.
 *
 * 0.21: the pages no longer have their own colours; the whole app shares one accent (styles/theme.ts).
 * Video (0.21) sits after Voice: it uses Voice's voices and Work's video tools.
 * Tasks was split in two: Tasks keeps the board, routines and activity, and Assistant holds what shapes
 * the assistant itself (memory, soul, skills, plugins).
 */
export const PAGES: PageDef[] = [
  { id: 'chat', label: 'Chat', glyph: MessageSquare },
  { id: 'work', label: 'Work', glyph: Briefcase },
  { id: 'images', label: 'Images', glyph: ImageIcon },
  { id: 'voice', label: 'Voice', glyph: AudioLines },
  // 0.21: narrated videos from your video, your pictures or an idea (runs as a Work job).
  { id: 'video', label: 'Video', glyph: Clapperboard },
  { id: 'tasks', label: 'Tasks', glyph: SquareKanban },
  { id: 'assistant', label: 'Assistant', glyph: Sparkles },
  { id: 'engines', label: 'Engines & Models', glyph: Server },
];

/** The pages listed at the top of the rail (everything but Engines & Models, which sits at its foot). */
export const WORKSPACES = PAGES.filter((p) => p.id !== 'engines');

/** Ctrl+1 … Ctrl+9 follow the rail order. */
export const pageShortcut = (id: ViewMode): string | undefined => {
  const i = PAGES.findIndex((p) => p.id === id);
  return i >= 0 && i < 9 ? `Ctrl+${i + 1}` : undefined;
};

export const VIEW_TITLES = Object.fromEntries(PAGES.map((p) => [p.id, p.label])) as Record<ViewMode, string>;

/** A page name sent by the island, the tray or an older build, mapped to a page that exists now. */
export function pageFromName(v: unknown): ViewMode | null {
  if (typeof v !== 'string') return null;
  if (PAGES.some((p) => p.id === v)) return v as ViewMode;
  if (v === 'builder') return 'work';
  if (v === 'research') return 'chat';
  if (v === 'skills' || v === 'memory' || v === 'soul' || v === 'plugins' || v === 'library') return 'assistant';
  return null;
}
