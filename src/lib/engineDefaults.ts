// Which engines Lotus uses when Settings doesn't say (pure: the app, the island and the core all read
// it, so they never disagree — STATE #10).
//   no settings saved yet (a new install)       → Lotus's own engines
//   settings saved before session 17 (no imageEngine field) → Ollama, ComfyUI, Voicebox, as set up then
//   anything saved explicitly                   → kept

export interface EngineChoice {
  llmBackend: 'builtin' | 'ollama' | 'llamacpp';
  imageEngine: 'builtin' | 'comfyui';
  voiceEngine: 'builtin' | 'voicebox';
}

export const BUILTIN_ENGINES: EngineChoice = { llmBackend: 'builtin', imageEngine: 'builtin', voiceEngine: 'builtin' };
export const LEGACY_ENGINES: EngineChoice = { llmBackend: 'ollama', imageEngine: 'comfyui', voiceEngine: 'voicebox' };

/** `raw` is the saved `lotus.settings.v1` text (null when nothing is saved). */
export function engineChoice(raw: string | null | undefined): EngineChoice {
  if (!raw) return { ...BUILTIN_ENGINES };
  // Saved but unreadable counts as saved (App.loadSettings does the same).
  let s: Record<string, unknown> = {};
  try { const j = JSON.parse(raw); if (j && typeof j === 'object' && !Array.isArray(j)) s = j as Record<string, unknown>; } catch { /* {} */ }
  const base = s.imageEngine === undefined ? LEGACY_ENGINES : BUILTIN_ENGINES;
  return {
    llmBackend: s.llmBackend === 'builtin' || s.llmBackend === 'ollama' || s.llmBackend === 'llamacpp' ? s.llmBackend : base.llmBackend,
    imageEngine: s.imageEngine === 'builtin' || s.imageEngine === 'comfyui' ? s.imageEngine : base.imageEngine,
    voiceEngine: s.voiceEngine === 'builtin' || s.voiceEngine === 'voicebox' ? s.voiceEngine : base.voiceEngine,
  };
}

/**
 * ComfyUI's other usual address on this computer (STATE #13): a manual install serves on 8188, ComfyUI
 * Desktop on 8000. Null when the address is anything else (another computer, a port the user chose).
 */
export function comfyAlternate(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'http:' || !/^(localhost|127(\.\d{1,3}){3})$/i.test(u.hostname) || (u.pathname && u.pathname !== '/')) return null;
  if (u.port === '8188') return `http://${u.hostname === 'localhost' ? 'localhost' : '127.0.0.1'}:8000`;
  if (u.port === '8000') return `http://${u.hostname === 'localhost' ? 'localhost' : '127.0.0.1'}:8188`;
  return null;
}
