export type TargetId = 'website' | 'webapp' | 'pwa' | 'desktop' | 'mobile' | 'blank';

export interface BuilderProject {
  id: string;
  name: string;
  /** Absolute folder on this PC. */
  path: string;
  target: TargetId;
  createdAt: number;
  /** Folder (relative to the project) to serve in the built-in preview; '' = the project root. */
  previewDir: string;
  /** Let the agent run commands without asking. Off by default. */
  autoRun: boolean;
}

export interface FsEntry { rel: string; name: string; isDir: boolean; size: number }
export interface FileRead { text: string | null; size: number; binary: boolean; tooLarge: boolean }

export type AgentItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; streaming?: boolean; status?: string }
  | { kind: 'plan'; id: string; markdown: string; state: 'proposed' | 'approved' }
  | { kind: 'action'; id: string; tool: string; label: string; detail?: string; status: 'running' | 'ok' | 'error' | 'denied'; output?: string; added?: number; removed?: number }
  | { kind: 'note'; id: string; tone: 'info' | 'error' | 'done'; text: string };

export interface ChatMsg { role: 'system' | 'user' | 'assistant'; content: string }

export interface SavedChat { items: AgentItem[]; history: ChatMsg[]; plan: string }
