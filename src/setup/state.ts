// First-run guide state (session 10). `lotus.setup.v1` in localStorage.

import type { EngineId } from '../services/engineConfig';

export const SETUP_KEY = 'lotus.setup.v1';

export interface SetupState {
  /** Finished or skipped. The guide can be reopened from Help → Setup Guide. */
  done: boolean;
  /** How it ended (for the docs and support, never sent anywhere). */
  outcome?: 'finished' | 'skipped';
  studioDir?: string;
  engines?: Partial<Record<EngineId, boolean>>;
  /** Engines the user connected to on another computer instead of installing (session 11). */
  remote?: Partial<Record<EngineId, boolean>>;
  at?: number;
}

export function loadSetup(): SetupState {
  try {
    const raw = localStorage.getItem(SETUP_KEY);
    if (raw) return { done: false, ...(JSON.parse(raw) as Partial<SetupState>) };
  } catch { /* fall through */ }
  // Installs from before session 10 that were really used skip the guide (it stays in Help).
  const legacy = hasRealChats(localStorage.getItem('lotus.sessions.v1')) || localStorage.getItem('lotus.setup.dismissed') === '1';
  return { done: legacy, outcome: legacy ? 'skipped' : undefined };
}

/**
 * True when saved chats hold at least one message. The Chat page saves an empty "New chat" the
 * moment it first loads, even behind the guide, so the key alone does not mean Lotus was used
 * (session 12: on macOS the guide never appeared because an earlier launch, where only the island
 * showed, had already saved that empty chat).
 */
export function hasRealChats(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) && list.some((s) => Array.isArray((s as { messages?: unknown[] } | null)?.messages) && (s as { messages: unknown[] }).messages.length > 0);
  } catch {
    return false;
  }
}

export function saveSetup(s: SetupState) {
  try { localStorage.setItem(SETUP_KEY, JSON.stringify(s)); } catch { /* storage full or blocked: the guide shows again next time */ }
}

export const STEPS = ['welcome', 'folder', 'engines', 'install', 'chat', 'images', 'voice', 'done'] as const;
export type StepId = (typeof STEPS)[number];
export const MODEL_STEP: Record<EngineId, StepId> = { ollama: 'chat', comfyui: 'images', voicebox: 'voice' };

/**
 * Steps the user actually sees, one idea per screen: Install only when something needs installing,
 * and one model screen per engine that is switched on and present.
 */
export function visibleSteps(needsInstall: boolean, modelEngines: EngineId[] = []): StepId[] {
  const models = new Set(modelEngines.map((e) => MODEL_STEP[e]));
  return STEPS.filter((s) => (s === 'install' ? needsInstall : s === 'chat' || s === 'images' || s === 'voice' ? models.has(s) : true));
}

/** Engines to install: switched on, not already found on this computer, and not used from another computer. */
export function enginesToInstall(
  want: Partial<Record<EngineId, boolean>>, found: Partial<Record<EngineId, string | null>>, remote: Partial<Record<EngineId, boolean>> = {},
): EngineId[] {
  return (['ollama', 'comfyui', 'voicebox'] as EngineId[]).filter((id) => want[id] && !found[id] && !remote[id]);
}

/**
 * Engines that get a model screen: switched on and available. ComfyUI on another computer is left out,
 * because its model files have to be put on that computer (Lotus downloads into a folder here).
 */
export function modelScreenEngines(
  want: Partial<Record<EngineId, boolean>>, available: (id: EngineId) => boolean, remote: Partial<Record<EngineId, boolean>> = {},
): EngineId[] {
  return (['ollama', 'comfyui', 'voicebox'] as EngineId[]).filter((id) => want[id] && available(id) && !(id === 'comfyui' && remote.comfyui));
}

/** Starting toggles: what the MSI asked for, else on for engines already found plus Ollama. */
export function initialEngines(installer: Partial<Record<EngineId, boolean>> | null | undefined, found: Partial<Record<EngineId, string | null>>): Record<EngineId, boolean> {
  const base = installer ?? { ollama: true };
  return {
    ollama: !!(base.ollama || found.ollama),
    comfyui: !!(base.comfyui || found.comfyui),
    voicebox: !!(base.voicebox || found.voicebox),
  };
}
