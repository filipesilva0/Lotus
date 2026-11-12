// Engine ids, in a file of their own so pure modules (setup/catalog.ts, shared with the core) can
// name them without pulling in engineConfig's storage.
export type EngineId = 'ollama' | 'comfyui' | 'voicebox';
