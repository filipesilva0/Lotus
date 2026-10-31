export type ViewMode = 'chat' | 'images' | 'voice' | 'research' | 'builder' | 'tasks' | 'engines';

export interface ChatSource { n: number; title: string; url: string; repo?: string; year?: number }
export interface ChatToolCall { id: string; label: string; status: 'running' | 'done' | 'error'; detail?: string }
export interface ChatMemoryEvent { kind: 'memory' | 'instruction'; text: string; itemId: string; status: 'saved' | 'confirmed' | 'forgotten' }
export interface ChatFileRef { name: string; kind: 'image' | 'text'; url?: string }

export interface ChatMessage {
  id: string;
  /** Reasoning tokens from thinking models, and how long the model thought. */
  thinking?: string;
  thinkingMs?: number;
  tools?: ChatToolCall[];
  sources?: ChatSource[];
  memoryEvent?: ChatMemoryEvent;
  /** Base64 images for vision models. Held in memory only (never persisted). */
  images?: string[];
  files?: ChatFileRef[];
  /** The reply was cut short because the user steered or pressed Stop. */
  interrupted?: boolean;
  /** Set on the first message of a tail that has alternatives: `< 1 / 3 >`. Each list entry is a full tail. */
  branch?: { list: ChatMessage[][]; index: number };
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  attachment?: {
    type: 'image';
    url: string;
    name: string;
  };
  tokensPerSec?: number;
  durationMs?: number;
  isStreaming?: boolean;
  /** What long-term memory contributed to this reply (shown under it so recall is never hidden). */
  recall?: { memories: number; sessions: number; skills: string[]; skillIds?: string[]; projectFiles: number };
  /** The reply came from Thinking mode (several passes) or used web results. */
  mode?: { thinking?: boolean; web?: boolean };
  /** The answer the user picked on this reply's options card (session 7). */
  pollAnswer?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  model: string;
  updatedAt: string;
  unreadCount?: number;
  messages: ChatMessage[];
  category: string;
  modelTag?: string;
  /** Creation/update time in ms, used to group the history (Today, Yesterday…). */
  ts: number;
  pinned?: boolean;
  folderId?: string;
  /** Incognito threads are never written to disk and do not create memories. */
  incognito?: boolean;
  /** Files mounted into this thread; their enabled chunks are sent with every request. */
  context?: ContextItem[];
  /** Search academic sources before answering (sends keywords to arXiv, PubMed, OpenAlex). */
  searchSources?: boolean;
  /** Real token count of the last request (prompt + reply), from Ollama. */
  usedTokens?: number;
  /** Memory is on unless this is true: recall (reading) and learning (writing) are both suspended. */
  memoryOff?: boolean;
  /** Thinking mode: several passes (analyse, draft, check) before the final answer. */
  thinking?: boolean;
  /** Search the web before answering. */
  webSearch?: boolean;
  /** Workspace folder for this chat; its context files (SOUL.md, memory.md, AGENTS.md…) are applied. */
  folder?: string;
  /** Context files the user switched off for this chat (relative paths). */
  folderOff?: string[];
  /** Title Lotus set itself (first words, then the auto-rename). A different title was set by the user and is never replaced. */
  autoTitle?: string;
}

export interface ContextChunk { id: string; text: string; on: boolean }
export interface ContextItem { id: string; name: string; kind: 'file' | 'source'; url?: string; chunks: ContextChunk[] }
export interface ChatFolder { id: string; name: string }
export interface MemoryItem {
  id: string; text: string; kind: 'memory' | 'instruction'; ts: number;
  /** 'user' = the user said "remember…"; 'auto' = Lotus learned it from a conversation. */
  source?: 'user' | 'auto';
  /** How many replies used it (recall), and when it last changed. */
  uses?: number; updated?: number;
}

export type ColorPalette = 'blue' | 'amber' | 'purple' | 'green' | 'pink';
export type FontFamily = 'jakarta' | 'inter' | 'outfit' | 'mono';
export type FontSize = 'sm' | 'md' | 'lg';

export interface LotusSettings {
  darkMode: boolean;
  lotusFolderPath: string;
  keepEnginesRunningOnQuit: boolean;
  selectedModel: string;
  temperature: number;
  topP: number;
  contextWindow: number;
  frequencyPenalty: number;
  presencePenalty: number;
  topK: number;
  stopSequences: string[];
  /** null = random each time */
  seed: number | null;
  maxTokens: number;
  systemPrompt: string;
  streamingEnabled: boolean;
  reasoningBlockMode: 'collapsed' | 'expanded' | 'hidden';
  sendOnEnter: boolean;
  autoScroll: boolean;
  codeCopyLanguage: boolean;
  vramCapPercent: number;
  comfyUiIdleStopMinutes: number;
  defaultTtsVoice: string;
  ttsRate: number;
  autoReadResponses: boolean;
  whisperLanguage: string;
  density: 'comfortable' | 'compact';
  palette: ColorPalette;
  fontFamily: FontFamily;
  fontSize: FontSize;
  // ── Local execution layer (session 5) ──
  /** Which local server answers chat: Ollama, or a llama.cpp `llama-server`. */
  llmBackend: 'ollama' | 'llamacpp';
  llamacppUrl: string;
  /** Scale context size, chunking and background-agent count to free video memory. */
  autoScale: boolean;
  /** Video memory kept free for the desktop, games and other apps (MB). */
  vramReserveMb: number;
  /** Upper bound for background agents, whatever the GPU allows. */
  maxSubagents: number;
  // ── Chat modes ──
  webSearchProvider: 'duckduckgo' | 'searxng';
  searxngUrl: string;
  /** How many result pages Web search opens and reads. */
  webPagesToRead: number;
  // ── Memory & skills ──
  /** Learn facts and preferences from conversations (memory toggle must also be on). */
  autoMemory: boolean;
  /** Write and refine skills after complex tasks. */
  autoSkills: boolean;
  /** Search past conversations for relevant context. */
  sessionRecall: boolean;
  // ── Background tasks (session 7) ──
  /** Model for housekeeping work: memory learning, skill writing and chat titles. '' = the chat model. */
  backgroundModel: string;
  /** Give new chats a short title after the first reply (uses the background model). */
  autoRename: boolean;
}

export interface GeneratedImage {
  id: string;
  url: string;
  /** The image data itself; `url` is an object URL made from it each launch. */
  blob?: Blob;
  sampler?: string;
  /** LoRAs used for this image. */
  loras?: { name: string; strength: number }[];
  denoise?: number;
  kind?: 'txt2img' | 'img2img' | 'upscale' | 'inpaint' | 'outpaint' | 'variation';
  prompt: string;
  negativePrompt?: string;
  seed: number;
  steps: number;
  cfg: number;
  dimensions: string;
  generationTimeSec: number;
  timestamp: string;
  checkpoint: string;
}
