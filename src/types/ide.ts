export type AIProviderId =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'deepseek'
  | 'ollama'
  | 'openrouter'
  | 'sutra'
  | 'groq'
  | 'github'
  | 'omniroute'
  | 'custom'
  | 'mock';

export type SubagentRole = 
  | 'architect'
  | 'frontend'
  | 'backend'
  | 'database'
  | 'media_generator'
  | 'qa_tester'
  | 'security_auditor'
  | 'ui_ux_designer'
  | 'video_director'
  | 'audio_designer';

export interface ModelDefinition {
  id: string;
  name: string;
  provider: AIProviderId;
  contextWindow: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  supportsVision: boolean;
  supportsTools: boolean;
  costPer1kTokens: { input: number; output: number };
  description: string;
  isCustom?: boolean;
}

export interface CustomProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  customHeaders?: Record<string, string>;
  models: ModelDefinition[];
  protocol: 'openai_compatible' | 'anthropic_compatible' | 'ollama' | 'raw_rest';
}

export type PermissionLevel = 'strict' | 'full';

export interface ToolCallPayload {
  id: string;
  tool: string;
  params: Record<string, any>;
  requiresApproval: boolean;
  status: 'pending' | 'approved' | 'rejected' | 'executing' | 'completed' | 'failed';
  result?: any;
  error?: string;
  timestamp: number;
  stagedDiff?: {
    file: string;
    oldContent: string;
    newContent: string;
    patch: string;
  };
}

export interface SubagentState {
  id: string;
  role: SubagentRole;
  name: string;
  status: 'idle' | 'thinking' | 'executing' | 'completed' | 'failed';
  currentTask: string;
  progress: number;
  toolCalls: ToolCallPayload[];
  tokensUsed: number;
  lastMessage: string;
  startedAt?: number;
  currentTool?: string;
}

export interface SwarmTaskMilestone {
  id: string;
  title: string;
  description: string;
  assignedRole: SubagentRole;
  status: 'pending' | 'in_progress' | 'review' | 'completed';
  dependencies: string[];
}

/**
 * A question the agent parked its run on via the ask_user tool.
 * Transported as { type: 'agent_question' } packets on the agent WebSocket;
 * answered with { type: 'agent_answer' } packets (see utils/agentSocket.ts).
 */
export interface PendingAgentQuestion {
  id: string;
  question: string;
  options: string[];
  allowFreeText: boolean;
}

export interface OmniAgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  subagentRole?: SubagentRole;
  content: string;
  thinking?: string;
  toolCalls?: ToolCallPayload[];
  timestamp: number;
  modelUsed?: string;
  tokens?: { input: number; output: number };
}

export interface OmniModel {
  id: string;
  name: string;
  provider: AIProviderId;
  contextWindow: number;
  supportsVision?: boolean;
  supportsTools?: boolean;
  reasoningEffort?: 'low' | 'medium' | 'high';
  costPer1kTokens?: { input: number; output: number };
  description?: string;
  isCustom?: boolean;
}

export interface ProjectAsset {
  id: string;
  name: string;
  type: 'image' | 'video' | 'audio' | 'svg' | 'shader' | '3d';
  path: string;
  url: string;
  prompt?: string;
  dimensions?: string;
  sizeBytes?: number;
  createdAt: number;
}

export interface OpenFileTab {
  path: string;
  name: string;
  content: string;
  isDirty: boolean;
  language: string;
}

/**
 * A per-file before/after snapshot captured for the Manager Review flow.
 * Populated by utils/agentSocket when the stream delivers inline_diff packets
 * (and by any surface that records staged diffs); keyed by file path in the
 * store's reviewDiffs slice. `originalContent === null` means the file had no
 * recorded prior state (new file from the agent's perspective).
 */
export interface ReviewDiffEntry {
  path: string;
  tool: string;
  originalContent: string | null;
  proposedContent: string | null;
  capturedAt: number;
}

/** One project check executed by the end-of-run verification stage. */
export interface VerificationCheck {
  name: string;
  status: 'passed' | 'failed' | 'timeout' | 'skipped';
  durationMs: number;
  summary: string;
}

/** Structured evidence produced after a run mutated workspace files. */
export interface VerificationReport {
  ranAt: number;
  workspaceRoot: string;
  filesChanged: number;
  checks: VerificationCheck[];
  allPassed: boolean;
}
