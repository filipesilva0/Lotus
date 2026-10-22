export type EngineId = 'ollama' | 'comfyui' | 'voicebox';

export const DEFAULT_URLS: Record<EngineId, string> = {
  ollama: 'http://127.0.0.1:11434',
  comfyui: 'http://127.0.0.1:8188',
  voicebox: 'http://127.0.0.1:17493',
};

const KEY = 'lotus.engineUrls.v1';

function read(): Partial<Record<EngineId, string>> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

export function engineUrl(id: EngineId): string {
  return (read()[id] || DEFAULT_URLS[id]).replace(/\/+$/, '');
}

export function setEngineUrl(id: EngineId, url: string) {
  const next = { ...read(), [id]: url.trim().replace(/\/+$/, '') || DEFAULT_URLS[id] };
  localStorage.setItem(KEY, JSON.stringify(next));
}

export function allEngineUrls(): Record<EngineId, string> {
  return { ollama: engineUrl('ollama'), comfyui: engineUrl('comfyui'), voicebox: engineUrl('voicebox') };
}
