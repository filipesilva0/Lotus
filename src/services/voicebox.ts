// Typed client for the Voicebox server (https://github.com/jamiepine/voicebox, MIT).
// Voicebox runs its own FastAPI server on :17493; Lotus is a second front end for it.
// Shapes below mirror backend/models.py in that repository.

import { http, EngineError, errorText, timeoutSignal } from '../lib/http';
import { engineUrl } from './engineConfig';

// ── Domain types ────────────────────────────────────────────────────────────

export type VoiceType = 'cloned' | 'preset' | 'designed';

export type TtsEngine =
  | 'qwen'
  | 'qwen_custom_voice'
  | 'qwen_voice_design'
  | 'luxtts'
  | 'chatterbox'
  | 'chatterbox_turbo'
  | 'tada'
  | 'kokoro'
  | 'omnivoice';

export const TTS_ENGINES: { id: TtsEngine; label: string }[] = [
  { id: 'qwen', label: 'Qwen3-TTS' },
  { id: 'qwen_custom_voice', label: 'Qwen Custom Voice' },
  { id: 'qwen_voice_design', label: 'Qwen Voice Design' },
  { id: 'luxtts', label: 'LuxTTS' },
  { id: 'chatterbox', label: 'Chatterbox' },
  { id: 'chatterbox_turbo', label: 'Chatterbox Turbo' },
  { id: 'tada', label: 'TADA' },
  { id: 'kokoro', label: 'Kokoro' },
  { id: 'omnivoice', label: 'OmniVoice' },
];

export const engineLabel = (id?: string | null) =>
  TTS_ENGINES.find((e) => e.id === id)?.label ?? id ?? 'Default';

/** The 23 languages the generate endpoint accepts. */
export const LANGUAGES: { code: string; name: string }[] = [
  ['en', 'English'], ['zh', 'Chinese'], ['ja', 'Japanese'], ['ko', 'Korean'],
  ['de', 'German'], ['fr', 'French'], ['es', 'Spanish'], ['it', 'Italian'],
  ['pt', 'Portuguese'], ['ru', 'Russian'], ['ar', 'Arabic'], ['he', 'Hebrew'],
  ['hi', 'Hindi'], ['tr', 'Turkish'], ['nl', 'Dutch'], ['pl', 'Polish'],
  ['sv', 'Swedish'], ['da', 'Danish'], ['no', 'Norwegian'], ['fi', 'Finnish'],
  ['el', 'Greek'], ['ms', 'Malay'], ['sw', 'Swahili'],
].map(([code, name]) => ({ code, name }));

/** Whisper (speech-to-text) accepts a smaller set. */
export const STT_LANGUAGES = ['en', 'zh', 'ja', 'ko', 'de', 'fr', 'ru', 'pt', 'es', 'it'];
export const STT_MODELS = ['base', 'small', 'medium', 'large', 'turbo'] as const;

export interface EffectConfig {
  type: string;
  enabled: boolean;
  params: Record<string, number>;
}

export interface EffectParamDef {
  default: number;
  min: number;
  max: number;
  step?: number;
  description?: string;
}

export interface AvailableEffect {
  type: string;
  label: string;
  description: string;
  params: Record<string, EffectParamDef>;
}

export interface EffectPreset {
  id: string;
  name: string;
  description?: string | null;
  effects_chain: EffectConfig[];
  is_builtin: boolean;
}

export interface VoiceProfile {
  id: string;
  name: string;
  description: string | null;
  language: string;
  avatar_path: string | null;
  effects_chain: EffectConfig[] | null;
  voice_type: VoiceType;
  preset_engine: string | null;
  preset_voice_id: string | null;
  design_prompt: string | null;
  default_engine: string | null;
  personality: string | null;
  generation_count: number;
  sample_count: number;
  created_at: string;
  updated_at: string;
}

export interface ProfileInput {
  name: string;
  description?: string | null;
  language?: string;
  voice_type?: VoiceType;
  preset_engine?: string | null;
  preset_voice_id?: string | null;
  design_prompt?: string | null;
  default_engine?: string | null;
  personality?: string | null;
}

export interface ProfileSample {
  id: string;
  profile_id: string;
  audio_path: string;
  reference_text: string;
}

export interface PresetVoice {
  voice_id: string;
  name: string;
  gender?: string;
  language?: string;
}

export type GenerationStatus = 'generating' | 'queued' | 'completed' | 'failed' | 'cancelled' | string;

export interface Generation {
  id: string;
  profile_id: string;
  profile_name?: string;
  text: string;
  language: string;
  audio_path: string | null;
  duration: number | null;
  seed: number | null;
  instruct: string | null;
  engine: string | null;
  model_size: string | null;
  status: GenerationStatus;
  error: string | null;
  is_favorited: boolean;
  source?: string;
  created_at: string;
}

export interface GenerateInput {
  profile_id: string;
  text: string;
  language: string;
  engine?: TtsEngine;
  seed?: number;
  model_size?: string;
  instruct?: string;
  personality?: boolean;
  normalize?: boolean;
  max_chunk_chars?: number;
  crossfade_ms?: number;
  effects_chain?: EffectConfig[];
}

export interface HistoryPage {
  items: Generation[];
  total: number;
}

export interface Story {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  item_count: number;
}

export interface StoryItem {
  id: string;
  story_id: string;
  generation_id: string;
  version_id: string | null;
  start_time_ms: number;
  track: number;
  trim_start_ms: number;
  trim_end_ms: number;
  profile_id: string;
  profile_name: string;
  text: string;
  language: string;
  duration: number;
  engine: string | null;
  volume: number;
}

export interface StoryDetail extends Story {
  items: StoryItem[];
}

export interface ModelStatus {
  model_name: string;
  display_name: string;
  hf_repo_id: string | null;
  downloaded: boolean;
  downloading: boolean;
  size_mb: number | null;
  loaded: boolean;
}

export interface DownloadTask {
  model_name: string;
  status: string;
  progress: number | null;
  current: number | null;
  total: number | null;
  filename: string | null;
  error: string | null;
}

export interface ActiveTasks {
  downloads: DownloadTask[];
  generations: { task_id: string; profile_id: string; text_preview: string }[];
}

export interface Health {
  status: string;
  model_loaded: boolean;
  model_downloaded?: boolean | null;
  model_size?: string | null;
  gpu_available: boolean;
  gpu_type?: string | null;
  vram_used_mb?: number | null;
  backend_type?: string | null;
  backend_variant?: string | null;
}

export interface Capture {
  id: string;
  audio_path: string;
  source: string;
  language: string | null;
  duration_ms: number | null;
  transcript_raw: string;
  transcript_refined: string | null;
  stt_model: string | null;
  llm_model: string | null;
  created_at: string;
}

export interface Transcription {
  text: string;
  duration: number;
}

// ── Client ──────────────────────────────────────────────────────────────────

const ENGINE = 'Voicebox';

class VoiceboxClient {
  get baseUrl() {
    return engineUrl('voicebox');
  }

  private async raw(path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> {
    let res: Response;
    try {
      res = await http(`${this.baseUrl}${path}`, { ...init, signal: init.signal ?? timeoutSignal(timeoutMs) });
    } catch {
      throw new EngineError(
        `Can't reach Voicebox at ${this.baseUrl}. Start the Voicebox engine from the Engines tab, then try again.`,
        ENGINE,
        undefined,
        true,
      );
    }
    if (!res.ok) throw new EngineError(await errorText(res), ENGINE, res.status);
    return res;
  }

  private async json<T>(path: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
    return (await this.raw(path, init, timeoutMs)).json() as Promise<T>;
  }

  private body(method: string, data?: unknown): RequestInit {
    return {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    };
  }

  // Health ------------------------------------------------------------------

  health(timeoutMs = 1500) {
    return this.json<Health>('/health', undefined, timeoutMs);
  }

  async isUp(): Promise<boolean> {
    try {
      await this.health();
      return true;
    } catch {
      return false;
    }
  }

  // Voice profiles ----------------------------------------------------------

  listProfiles() {
    return this.json<VoiceProfile[]>('/profiles');
  }
  createProfile(input: ProfileInput) {
    return this.json<VoiceProfile>('/profiles', this.body('POST', input));
  }
  updateProfile(id: string, input: ProfileInput) {
    return this.json<VoiceProfile>(`/profiles/${id}`, this.body('PUT', input));
  }
  async deleteProfile(id: string) {
    await this.raw(`/profiles/${id}`, { method: 'DELETE' });
  }
  setProfileEffects(id: string, chain: EffectConfig[] | null) {
    return this.json<VoiceProfile>(`/profiles/${id}/effects`, this.body('PUT', { effects_chain: chain }));
  }
  async presetVoices(engine: string): Promise<PresetVoice[]> {
    const r = await this.json<{ voices: PresetVoice[] }>(`/profiles/presets/${engine}`);
    return r.voices;
  }
  listSamples(profileId: string) {
    return this.json<ProfileSample[]>(`/profiles/${profileId}/samples`);
  }
  addSample(profileId: string, file: Blob, fileName: string, referenceText: string) {
    const form = new FormData();
    form.append('file', file, fileName);
    form.append('reference_text', referenceText);
    return this.json<ProfileSample>(`/profiles/${profileId}/samples`, { method: 'POST', body: form }, 120_000);
  }
  async deleteSample(sampleId: string) {
    await this.raw(`/profiles/samples/${sampleId}`, { method: 'DELETE' });
  }
  async exportProfile(id: string): Promise<Blob> {
    return (await this.raw(`/profiles/${id}/export`, {}, 120_000)).blob();
  }
  async importProfile(file: File) {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.json<VoiceProfile>('/profiles/import', { method: 'POST', body: form }, 120_000);
  }

  // Generation --------------------------------------------------------------

  generate(input: GenerateInput) {
    return this.json<Generation>('/generate', this.body('POST', input));
  }
  speak(text: string, opts: { profile?: string; engine?: TtsEngine; language?: string; personality?: boolean } = {}) {
    return this.json<Generation>('/speak', this.body('POST', { text, ...opts }));
  }
  async cancel(id: string) {
    await this.raw(`/generate/${id}/cancel`, { method: 'POST' });
  }
  retry(id: string) {
    return this.json<Generation>(`/generate/${id}/retry`, { method: 'POST' });
  }

  getGeneration(id: string) {
    return this.json<Generation>(`/history/${id}`);
  }

  /** Polls until the generation finishes. Resolves with the final row; throws if it failed. */
  async waitFor(id: string, onTick?: (g: Generation) => void, signal?: AbortSignal): Promise<Generation> {
    for (;;) {
      if (signal?.aborted) throw new EngineError('Cancelled', ENGINE);
      const g = await this.getGeneration(id);
      onTick?.(g);
      if (g.status === 'completed') return g;
      if (g.status === 'failed') throw new EngineError(g.error || 'Generation failed', ENGINE);
      if (g.status === 'cancelled') throw new EngineError('Cancelled', ENGINE);
      await new Promise((r) => setTimeout(r, 700));
    }
  }

  private audioCache = new Map<string, string>();

  /** Fetches generated audio and returns an object URL that <audio> and Web Audio can use. */
  async audioUrl(generationId: string, fresh = false): Promise<string> {
    const hit = this.audioCache.get(generationId);
    if (hit && !fresh) return hit;
    const blob = await (await this.raw(`/audio/${generationId}`, {}, 120_000)).blob();
    const url = URL.createObjectURL(blob);
    this.audioCache.set(generationId, url);
    return url;
  }

  // History -----------------------------------------------------------------

  history(q: { profile_id?: string; search?: string; limit?: number; offset?: number } = {}) {
    const p = new URLSearchParams();
    Object.entries(q).forEach(([k, v]) => v !== undefined && v !== '' && p.set(k, String(v)));
    return this.json<HistoryPage>(`/history?${p}`);
  }
  async toggleFavorite(id: string) {
    await this.raw(`/history/${id}/favorite`, { method: 'POST' });
  }
  async deleteGeneration(id: string) {
    await this.raw(`/history/${id}`, { method: 'DELETE' });
  }
  async exportAudio(id: string): Promise<Blob> {
    return (await this.raw(`/history/${id}/export-audio`, {}, 120_000)).blob();
  }

  // Effects -----------------------------------------------------------------

  async availableEffects(): Promise<AvailableEffect[]> {
    return (await this.json<{ effects: AvailableEffect[] }>('/effects/available')).effects;
  }
  effectPresets() {
    return this.json<EffectPreset[]>('/effects/presets');
  }
  saveEffectPreset(name: string, chain: EffectConfig[], description?: string) {
    return this.json<EffectPreset>('/effects/presets', this.body('POST', { name, description, effects_chain: chain }));
  }
  async deleteEffectPreset(id: string) {
    await this.raw(`/effects/presets/${id}`, { method: 'DELETE' });
  }

  // Stories (multi-voice timeline) -------------------------------------------

  listStories() {
    return this.json<Story[]>('/stories');
  }
  getStory(id: string) {
    return this.json<StoryDetail>(`/stories/${id}`);
  }
  createStory(name: string, description?: string) {
    return this.json<Story>('/stories', this.body('POST', { name, description }));
  }
  renameStory(id: string, name: string) {
    return this.json<Story>(`/stories/${id}`, this.body('PUT', { name }));
  }
  async deleteStory(id: string) {
    await this.raw(`/stories/${id}`, { method: 'DELETE' });
  }
  addStoryItem(storyId: string, generationId: string, startMs?: number, track = 0) {
    return this.json<StoryItem>(
      `/stories/${storyId}/items`,
      this.body('POST', { generation_id: generationId, start_time_ms: startMs, track }),
    );
  }
  async moveStoryItem(storyId: string, itemId: string, startMs: number, track: number) {
    await this.raw(`/stories/${storyId}/items/${itemId}/move`, this.body('PUT', { start_time_ms: startMs, track }));
  }
  async trimStoryItem(storyId: string, itemId: string, trimStartMs: number, trimEndMs: number) {
    await this.raw(
      `/stories/${storyId}/items/${itemId}/trim`,
      this.body('PUT', { trim_start_ms: trimStartMs, trim_end_ms: trimEndMs }),
    );
  }
  async setStoryItemVolume(storyId: string, itemId: string, volume: number) {
    await this.raw(`/stories/${storyId}/items/${itemId}/volume`, this.body('PUT', { volume }));
  }
  async splitStoryItem(storyId: string, itemId: string, splitMs: number) {
    await this.raw(`/stories/${storyId}/items/${itemId}/split`, this.body('POST', { split_time_ms: splitMs }));
  }
  async duplicateStoryItem(storyId: string, itemId: string) {
    await this.raw(`/stories/${storyId}/items/${itemId}/duplicate`, { method: 'POST' });
  }
  async deleteStoryItem(storyId: string, itemId: string) {
    await this.raw(`/stories/${storyId}/items/${itemId}`, { method: 'DELETE' });
  }
  async exportStoryAudio(id: string): Promise<Blob> {
    return (await this.raw(`/stories/${id}/export-audio`, {}, 300_000)).blob();
  }

  // Models ------------------------------------------------------------------

  async modelStatus(): Promise<ModelStatus[]> {
    return (await this.json<{ models: ModelStatus[] }>('/models/status')).models;
  }
  async downloadModel(name: string) {
    await this.raw('/models/download', this.body('POST', { model_name: name }), 60_000);
  }
  async loadModel(name: string) {
    await this.raw('/models/load', this.body('POST', { model_name: name }), 300_000);
  }
  async unloadModel(name: string) {
    await this.raw('/models/unload', this.body('POST', { model_name: name }));
  }
  async deleteModel(name: string) {
    await this.raw(`/models/${encodeURIComponent(name)}`, { method: 'DELETE' });
  }
  activeTasks() {
    return this.json<ActiveTasks>('/tasks/active', undefined, 5000);
  }

  // Speech-to-text & dictation captures -------------------------------------

  async transcribe(audio: Blob, opts: { language?: string; model?: string } = {}): Promise<Transcription> {
    const form = new FormData();
    form.append('file', audio, 'speech.webm');
    if (opts.language && STT_LANGUAGES.includes(opts.language)) form.append('language', opts.language);
    if (opts.model) form.append('model', opts.model);
    return this.json<Transcription>('/transcribe', { method: 'POST', body: form }, 180_000);
  }
  listCaptures(limit = 50, offset = 0) {
    return this.json<{ items: Capture[]; total: number }>(`/captures?limit=${limit}&offset=${offset}`);
  }
  createCapture(audio: Blob, opts: { language?: string; stt_model?: string; source?: string } = {}) {
    const form = new FormData();
    form.append('file', audio, 'capture.webm');
    form.append('source', opts.source ?? 'lotus');
    if (opts.language && STT_LANGUAGES.includes(opts.language)) form.append('language', opts.language);
    if (opts.stt_model) form.append('stt_model', opts.stt_model);
    return this.json<Capture>('/captures', { method: 'POST', body: form }, 180_000);
  }
  refineCapture(id: string) {
    return this.json<Capture>(`/captures/${id}/refine`, this.body('POST', {}), 180_000);
  }
  async deleteCapture(id: string) {
    await this.raw(`/captures/${id}`, { method: 'DELETE' });
  }
}

export const voicebox = new VoiceboxClient();

/** Formats seconds as m:ss. */
export function fmtDuration(sec?: number | null): string {
  if (!sec || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
