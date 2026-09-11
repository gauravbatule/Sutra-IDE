/**
 * SUTRA Studio — Unified Agent Status Vocabulary
 *
 * One source of truth for Astra's run state across every surface (Manager,
 * AgentChat, status bars). Components derive state through here so labels and
 * semantics never drift apart.
 */

export type AgentStatusKey = 'idle' | 'working' | 'waiting';

export interface AgentStatus {
  key: AgentStatusKey;
  /** Short user-facing label — brand voice, no jargon. */
  label: string;
  /** Longer variant for tooltips / aria descriptions. */
  detail: string;
}

const STATUS: Record<AgentStatusKey, AgentStatus> = {
  idle: {
    key: 'idle',
    label: 'Ready',
    detail: 'Astra is ready when you are',
  },
  working: {
    key: 'working',
    label: 'Astra is working',
    detail: 'Astra is actively working on your request',
  },
  waiting: {
    key: 'waiting',
    label: 'Astra is waiting for your answer',
    detail: 'Astra needs your input before it can continue',
  },
};

export function deriveAgentStatus(input: {
  isGenerating?: boolean;
  hasPendingQuestion?: boolean;
  hasPendingApprovals?: boolean;
}): AgentStatus {
  if (input.hasPendingQuestion || input.hasPendingApprovals) return STATUS.waiting;
  if (input.isGenerating) return STATUS.working;
  return STATUS.idle;
}
