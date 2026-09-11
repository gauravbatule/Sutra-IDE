/**
 * SUTRA Studio — Unified Agent Status Vocabulary
 *
 * One source of truth for Astra's run state across every surface (Manager,
 * AgentChat, status bars). Components derive state through here so labels and
 * semantics never drift apart.
 */

export type AgentStatusKey = 'idle' | 'working' | 'waiting' | 'avo_working' | 'paused' | 'approval_required';

export interface AgentStatus {
  key: AgentStatusKey;
  /** Short user-facing label — brand voice, no jargon. */
  label: string;
  /** Longer variant for tooltips / aria descriptions. */
  detail: string;
}

/**
 * The working label rotates so a long run never looks frozen on a single
 * phrase. Consumers should pick the next entry from this list every few
 * seconds (see AgentStatusBanner's rotation interval). The array is read-only
 * so it can be safely shared across components without defensive copies.
 */
export const ROTATING_WORKING_LABELS: readonly string[] = [
  'Working…',
  'Reading code…',
  'Planning next step…',
  'Preparing tools…',
  'Writing code…',
  'Verifying changes…',
  'Checking results…',
];

/**
 * Rotating labels for the AVO Pro engine — distinct voice from standard
 * Astra so the right harness reads in the status strip at a glance.
 */
export const ROTATING_AVO_LABELS: readonly string[] = [
  'AVO Pro • Exploring variations…',
  'AVO Pro • Drafting candidates…',
  'AVO Pro • Running fitness checks…',
  'AVO Pro • Verifying convergence…',
];

const STATUS: Record<AgentStatusKey, AgentStatus> = {
  idle: {
    key: 'idle',
    label: 'Ready',
    detail: 'Astra is ready when you are',
  },
  working: {
    key: 'working',
    label: ROTATING_WORKING_LABELS[0],
    detail: 'Astra is autonomously executing tools and writing code',
  },
  avo_working: {
    key: 'avo_working',
    label: ROTATING_AVO_LABELS[0],
    detail: 'AVO Pro is evaluating candidate variations and verifying convergence',
  },
  waiting: {
    key: 'waiting',
    label: 'Waiting for your answer',
    detail: 'Astra needs your input before it can continue',
  },
  approval_required: {
    key: 'approval_required',
    label: 'Action Approval Required',
    detail: 'Astra is waiting for your confirmation to execute this action',
  },
  paused: {
    key: 'paused',
    label: 'Execution Paused',
    detail: 'Execution is paused. Click Resume or type a steer prompt to continue.',
  },
};

/**
 * Pick a rotating label for a status, deterministically when a stable index is
 * supplied (e.g. "show the 3rd variant for this chat") and round-robin when
 * the index is omitted. Always returns a string in the brand voice — never
 * the raw enum — so a long run cycles through phrases the user actually
 * wants to read.
 */
export function pickRotatingLabel(
  key: AgentStatusKey,
  index?: number
): string {
  const pool =
    key === 'avo_working'
      ? ROTATING_AVO_LABELS
      : key === 'working'
      ? ROTATING_WORKING_LABELS
      : null;
  if (!pool || pool.length === 0) return STATUS[key]?.label ?? '';
  if (typeof index === 'number' && Number.isFinite(index)) {
    return pool[((index % pool.length) + pool.length) % pool.length];
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

export function deriveAgentStatus(input: {
  isGenerating?: boolean;
  isPaused?: boolean;
  hasPendingQuestion?: boolean;
  hasPendingApprovals?: boolean;
  harnessMode?: 'standard' | 'avo';
  activeTool?: string;
}): AgentStatus {
  if (input.hasPendingApprovals) return STATUS.approval_required;
  if (input.hasPendingQuestion) return STATUS.waiting;
  if (input.isPaused && !input.isGenerating) return STATUS.paused;
  if (input.isGenerating) {
    if (input.activeTool) {
      return {
        key: input.harnessMode === 'avo' ? 'avo_working' : 'working',
        label: `Executing: ${input.activeTool}`,
        detail: `Astra is currently executing the ${input.activeTool} tool`,
      };
    }
    const key = input.harnessMode === 'avo' ? 'avo_working' : 'working';
    return STATUS[key];
  }
  return STATUS.idle;
}
