export type ViewMode = 'chat' | 'images' | 'voice' | 'research' | 'engines';

export interface ChatMessage {
  id: string;
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
}

export interface GeneratedImage {
  id: string;
  url: string;
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
