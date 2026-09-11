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
  | 'gateway'
  | 'pollinations'
  | 'chatgpt-web'
  | 'antigravity'
  | 'antigravity-ide'
  | 'zhipu'
  | 'glm'
  | 'xai'
  | 'qwen'
  | 'mistral'
  | 'cohere'
  | 'perplexity'
  | 'together'
  | 'fireworks'
  | 'cerebras'
  | 'sambanova'
  | 'hyperbolic'
  | 'deepinfra'
  | 'novita'
  | 'lepton'
  | 'nebius'
  | 'scaleway'
  | 'ovhcloud'
  | 'baseten'
  | 'featherless'
  | 'siliconflow'
  | 'moonshot'
  | 'minimax'
  | 'baichuan'
  | 'yi-01ai'
  | 'doubao'
  | 'hunyuan'
  | 'sarvam'
  | 'upstage'
  | 'lmstudio'
  | 'localai'
  | 'jan-ai'
  | 'vllm'
  | 'litellm'
  | 'cloudflare'
  | 'replicate'
  | 'nvidia-nim'
  | 'bai'
  | 'anyapi'
  | 'kilo'
  | 'llm7'
  | 'huggingface'
  | 'opencode'
  | 'ovh'
  | 'agnes'
  | 'reka'
  | 'routeway'
  | 'bazaarlink'
  | 'ainative'
  | 'aion'
  | 'requesty'
  | 'navy'
  | 'nara'
  | 'sealion'
  | 'orcarouter'
  | 'unorouter'
  | 'xkiro'
  | 'modelscope'
  | 'custom'
  | 'mock'
  | (string & {});

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

export type ModelStatus = 
  | 'active'
  | 'preview'
  | 'deprecated'
  | 'retired'
  | 'unavailable'
  | 'unknown';

export type ModelSource = 
  | 'provider-api'
  | 'antigravity-catalog'
  | 'local'
  | 'curated'
  | 'custom';

export interface SutraModel {
  id: string;
  name: string;
  canonicalId?: string;
  provider: AIProviderId | string;
  providerModelId?: string;
  wireModelId?: string;
  displayName?: string;
  status?: ModelStatus;
  modalities?: {
    input: string[];
    output: string[];
  };
  capabilities?: {
    reasoning?: boolean;
    thinking?: boolean;
    tools?: boolean;
    vision?: boolean;
    structuredOutput?: boolean;
    streaming?: boolean;
    mcp?: boolean;
    image?: boolean;
    audio?: boolean;
    video?: boolean;
  };
  thinking?: {
    supported: boolean;
    levels?: ('low' | 'medium' | 'high')[];
    default?: 'low' | 'medium' | 'high';
  };
  contextWindow?: number;
  costPer1kTokens?: { input: number; output: number };
  description?: string;
  aliases?: string[];
  discoveredAt?: string;
  lastVerifiedAt?: string;
  source?: ModelSource;
  supportsVision?: boolean;
  supportsTools?: boolean;
  reasoningEffort?: 'low' | 'medium' | 'high';
  isCustom?: boolean;
  category?: 'llm' | 'image' | 'video' | 'audio' | 'multimodal';
  baseUrl?: string;
}

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
  baseUrl?: string;
  // SutraModel compatibility fields
  canonicalId?: string;
  providerModelId?: string;
  wireModelId?: string;
  displayName?: string;
  status?: ModelStatus;
  modalities?: {
    input: string[];
    output: string[];
  };
  capabilities?: {
    reasoning?: boolean;
    thinking?: boolean;
    tools?: boolean;
    vision?: boolean;
    structuredOutput?: boolean;
    streaming?: boolean;
    mcp?: boolean;
    image?: boolean;
    audio?: boolean;
    video?: boolean;
  };
  thinking?: {
    supported: boolean;
    levels?: ('low' | 'medium' | 'high')[];
    default?: 'low' | 'medium' | 'high';
  };
  aliases?: string[];
  source?: ModelSource;
  discoveredAt?: string;
  lastVerifiedAt?: string;
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
export type HarnessMode = 'standard' | 'avo';

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

export interface SutraAgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  subagentRole?: SubagentRole;
  content: string;
  thinking?: string;
  toolCalls?: ToolCallPayload[];
  timestamp: number;
  modelUsed?: string;
  tokens?: { input: number; output: number };
  images?: string[];
  mode?: 'plan' | 'build' | 'edit' | 'chat';
}

export type OmniAgentMessage = SutraAgentMessage;
export type FallbackModel = SutraModel;
export type OmniModel = SutraModel;

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

export interface ArtifactItem {
  id: string;
  chatId?: string;
  name: string;
  type: 'plan' | 'implementation' | 'design' | 'asset' | 'verification' | 'doc' | 'findings' | 'audit';
  status: 'draft' | 'in_progress' | 'done';
  content: string;
  updatedAt: number;
}
