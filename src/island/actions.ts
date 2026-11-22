// Quick buttons on the island (idea 3). The catalogue is pure data so it can be tested; Home.tsx maps
// each to an icon and runs it. Skills and routines are pinned by id: "skill:<id>", "routine:<id>".

export type ActionId = 'ask' | 'dictate' | 'call' | 'image' | 'clip-summary' | 'read-clip' | 'focus' | 'work' | 'video' | 'tasks' | 'note';

export interface IslandAction { id: ActionId; label: string; hint: string }

export const ACTIONS: IslandAction[] = [
  { id: 'ask', label: 'Ask', hint: 'Open the quick chat' },
  { id: 'dictate', label: 'Dictate', hint: 'Speak, and Lotus writes it down in the quick chat' },
  { id: 'call', label: 'Call', hint: 'Start a voice call with Lotus' },
  { id: 'image', label: 'Image', hint: 'Open Images to make a picture' },
  { id: 'clip-summary', label: 'Summarise', hint: 'Summarise what you copied' },
  { id: 'read-clip', label: 'Read', hint: 'Read what you copied aloud' },
  { id: 'focus', label: 'Focus', hint: 'Start a focus timer' },
  { id: 'work', label: 'Work', hint: 'Open Work' },
  { id: 'video', label: 'Video', hint: 'Open Video' },
  { id: 'tasks', label: 'Tasks', hint: 'Open the task board' },
];

export const MAX_PINS = 6;
export const DEFAULT_PINS: string[] = ['ask', 'dictate', 'call', 'clip-summary', 'focus'];

export const actionById = (id: string): IslandAction | undefined => ACTIONS.find((a) => a.id === id);
export const pinnable = (id: string): boolean => !!actionById(id) || /^(skill|routine):.+/.test(id);
