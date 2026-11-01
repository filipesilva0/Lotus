// Shared island types and settings. Settings live in localStorage, which both windows share.

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
}

const KEY = 'lotus.island.v1';
/** The island starts switched off on every OS (session 10); turn it on in Settings or with Ctrl+Alt+T. */
const DEFAULTS: IslandSettings = { enabled: false, model: '', voiceProfileId: '', autoCollapse: true, agents: true };

export function loadIsland(): IslandSettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return DEFAULTS;
  }
}

export function saveIsland(patch: Partial<IslandSettings>): IslandSettings {
  const next = { ...loadIsland(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

/** Fields of the main window's saved settings the island needs. */
export function mainSettings(): { model: string; systemPrompt: string; palette: string; temperature: number } {
  try {
    const s = JSON.parse(localStorage.getItem('lotus.settings.v1') || '{}');
    return {
      model: s.selectedModel || 'llama3.2:3b',
      systemPrompt: s.systemPrompt || 'You are Lotus, a helpful local AI assistant.',
      palette: s.palette || 'blue',
      temperature: typeof s.temperature === 'number' ? s.temperature : 0.7,
    };
  } catch {
    return { model: 'llama3.2:3b', systemPrompt: 'You are Lotus, a helpful local AI assistant.', palette: 'blue', temperature: 0.7 };
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
