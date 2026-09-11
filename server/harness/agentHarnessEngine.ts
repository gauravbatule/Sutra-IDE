/**
 * SUTRA Studio - Canonical Agent Harness Engine Alias
 *
 * Exports SutraHarnessEngine and canonical agent harness APIs with backward and forward compatibility.
 */
export {
  SutraHarnessEngine,
  sutraHarness,
  estimateMessageTokens,
  compactConversationContext,
  redactAllSecrets,
} from './sutraHarness.js';
export type { HarnessContext, HarnessPlugin } from './sutraHarness.js';

import { sutraHarness, SutraHarnessEngine } from './sutraHarness.js';

export const agentHarnessEngine = sutraHarness;
export const AgentHarnessEngine = SutraHarnessEngine;
export default sutraHarness;
