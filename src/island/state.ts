// Shared island types and settings. Settings live in `kv` (lotus.db); both windows see changes through `storage` events.

import { kv } from '../lib/store';
import type { IslandSurface } from './look';
import { DEFAULT_PINS } from './actions';
export type IslandView = 'strip' | 'peek' | 'chat' | 'approval';
export type Mood = 'idle' | 'thinking' | 'speaking' | 'listening' | 'alert' | 'happy' | 'sleep';

export interface IslandSettings {
  enabled: boolean;
  /** Ollama model used by the island chat; empty = follow the main window's model. */
  model: string;
  /** Voicebox profile used for read-aloud; empty = the profile selected in the Voice tab. */
  voiceProfileId: string;
  /** Collapse the chat a few seconds after you click away. */
  autoCollapse: boolean;
  /** Show Claude Code activity and permission prompts. */
  agents: boolean;
  /** 0.23: push the mouse to the top centre of the screen to open the island (and it opens on that screen). */
  wake: boolean;
  /** 0.23: the quick buttons, in order (actions.ts ids, or "skill:<id>" / "routine:<id>"). */
  pins: string[];
  /** 0.23: show what's playing, with play, pause and skip. */
  media: boolean;
  /** 0.23: pause music while Lotus listens or talks (dictation, read-aloud, calls), and play it again after. */
  autoPause: boolean;
  /** 0.23: offer actions after you copy text. Off until you turn it on. */
  clipboard: boolean;
  /** 0.23: language for "Translate" on copied text. */
  translateTo: string;
  /** 0.23: a private calendar address (.ics) for "Next up"; empty = tasks and routines only. */
  calendarUrl: string;
  /** 0.23: minutes for a focus timer. */
  focusMinutes: number;
  /** 0.23: 'auto' = white island in light mode, black in dark mode; 'black' = always black.
   *  0.23.1: 'glass' = frosted glass, see-through, light or dark with Lotus. */
  surface: IslandSurface;
  /** Settings format. 2 (session 11) = the one-time "start switched off" reset has been applied. */
  schema?: number;
}

const KEY = 'lotus.island.v1';
const SCHEMA = 2;
/** The island starts switched off on every OS; turn it on in Settings or with Ctrl+Alt+T. */
const DEFAULTS: IslandSettings = {
  enabled: false, model: '', voiceProfileId: '', autoCollapse: true, agents: true,
  wake: true, pins: DEFAULT_PINS, media: true, autoPause: true, clipboard: false, translateTo: 'English', calendarUrl: '', focusMinutes: 25, surface: 'auto',
  schema: SCHEMA,
};

export function loadIsland(): IslandSettings {
  try {
    const saved = JSON.parse(kv.getItem(KEY) || '{}') as Partial<IslandSettings>;
    if (saved.schema === SCHEMA) return { ...DEFAULTS, ...saved };
    // Session 11: settings saved by older builds (where the island was on by default) are switched
    // off once, so every install starts with the main window and no island. The user's later choice sticks.
    const next = { ...DEFAULTS, ...saved, enabled: false, schema: SCHEMA };
    if (Object.keys(saved).length) kv.setItem(KEY, JSON.stringify(next));
    return next;
  } catch {
    return DEFAULTS;
  }
}

export function saveIsland(patch: Partial<IslandSettings>): IslandSettings {
  const next = { ...loadIsland(), ...patch };
  kv.setItem(KEY, JSON.stringify(next));
  return next;
}

/** Fields of the main window's saved settings the island needs. */
export function mainSettings(): { model: string; systemPrompt: string; palette: string; temperature: number; appearance: 'auto' | 'light' | 'dark' } {
  try {
    const s = JSON.parse(kv.getItem('lotus.settings.v1') || '{}');
    return {
      model: s.selectedModel || 'llama3.2:3b',
      systemPrompt: s.systemPrompt || 'You are Lotus, a helpful local AI assistant.',
      palette: s.palette || 'blue',
      temperature: typeof s.temperature === 'number' ? s.temperature : 0.7,
      appearance: s.appearance === 'light' || s.appearance === 'dark' ? s.appearance : 'auto',
    };
  } catch {
    return { model: 'llama3.2:3b', systemPrompt: 'You are Lotus, a helpful local AI assistant.', palette: 'blue', temperature: 0.7, appearance: 'auto' };
  }
}

/** A task running somewhere in Lotus that deserves a pill on the island. */
export interface Activity {
  id: string;
  kind: 'image' | 'voice' | 'chat' | 'download' | 'research' | 'build';
  label: string;
  /** 0..1, omitted when indeterminate */
  progress?: number;
  done?: boolean;
  /** 0.11.0: a Work helper agent's name; shown with its face. */
  agent?: string;
  /** 0.23.1: the small word above the line ("Task", "Routine"); else the kind's word. */
  kicker?: string;
}

export interface AgentSession {
  id: string;
  project: string;
  state: 'idle' | 'working' | 'waiting' | 'done';
  note?: string;
  at: number;
}

export interface PermissionRequest {
  requestId: number;
  sessionId: string;
  project: string;
  tool: string;
  /** One-line human summary, e.g. the shell command or file path. */
  summary: string;
  detail: string;
}

export const baseName = (p?: string) => (p ? p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p : 'Claude Code');
