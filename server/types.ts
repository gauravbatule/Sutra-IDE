export type AIProviderId = 
  | 'anthropic'
  | 'pollinations'
  | 'openai'
  | 'google'
  | 'deepseek'
  | 'ollama'
  | 'openrouter'
  | 'omniroute'
  | 'groq'
  | 'github'
  | 'sutra'
  | 'custom';

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
  progress: number; // 0 - 100
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
  metadata?: Record<string, any>;
}
