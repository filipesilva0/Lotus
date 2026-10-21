export type RepoId = 'arxiv' | 'pubmed' | 'openalex' | 'crossref';
export type Credibility = 'high' | 'medium' | 'preprint' | 'unknown';

export interface Source {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  url: string;
  doi?: string;
  abstract: string;
  repo: RepoId;
  domain: string;
  credibility: Credibility;
  /** Found by this agent, with this query. */
  agentId?: string;
  query?: string;
  /** One-line finding the local model extracted from the abstract. */
  finding?: string;
  /** 1 (off-topic) to 5 (directly answers the question). */
  relevance?: number;
  /** The user unticked this source; it is excluded from the report. */
  rejected?: boolean;
}

export interface SubTopic { id: string; title: string; objective: string; questions: string[] }
export interface Persona { id: string; name: string; role: string; focus: string }
export interface Clarification { id: string; question: string; why?: string; answer: string }

export interface ResearchLimits {
  repos: Record<RepoId, boolean>;
  maxDepth: number;            // iterations per agent, 1-5
  maxSourcesPerAgent: number;
  parallelAgents: number;
  yearCutoff: number | null;   // ignore papers older than this
  requiredKeywords: string[];  // a source must mention at least one
  excludedDomains: string[];
  language: string;            // '' = any
}

export const DEFAULT_LIMITS: ResearchLimits = {
  repos: { arxiv: true, pubmed: true, openalex: true, crossref: false },
  maxDepth: 2,
  maxSourcesPerAgent: 8,
  parallelAgents: 2,
  yearCutoff: null,
  requiredKeywords: [],
  excludedDomains: [],
  language: '',
};

export interface LogLine { t: number; text: string }

export interface AgentState {
  id: string;
  topicId: string;
  title: string;
  status: 'queued' | 'running' | 'done' | 'error';
  action: string;
  iteration: number;
  log: LogLine[];
  sourceIds: string[];
  tokensIn: number;
  tokensOut: number;
  /** Largest prompt this agent has sent, to show context pressure. */
  ctxPeak: number;
}

export interface QueryLog {
  t: number;
  agentId: string;
  repo: RepoId;
  query: string;
  /** HTTP status, or 0 when the request failed before a response. */
  status: number;
  ms: number;
  count: number;
}

export type Phase = 'scoping' | 'planning' | 'running' | 'synthesizing' | 'done' | 'stopped';

export interface Project {
  id: string;
  title: string;
  question: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  phase: Phase;
  model: string;
  clarifications: Clarification[];
  plan: SubTopic[];
  personas: Persona[];
  limits: ResearchLimits;
  agents: AgentState[];
  sources: Source[];
  queries: QueryLog[];
  injected: string[];
  report: string;
  tokensIn: number;
  tokensOut: number;
  startedAt?: number;
  finishedAt?: number;
  supervisorCtx: number;
  numCtx: number;
  paused: boolean;
  /** Plain-language problem that stopped the run, if any. */
  error?: string;
  /** Progress 0..1 for the ETA. */
  progress: number;
}
