import { describe, it, expect } from 'vitest';
import { agentSwarm } from '../../server/agentSwarm.js';

describe('codebase_search tool', () => {
  it('semantically searches codebase symbols via agent swarm', async () => {
    const result = await agentSwarm.executeTool({
      id: 'tc-1',
      tool: 'codebase_search',
      params: { query: 'Monaco Editor', limit: 5 },
      status: 'pending',
      requiresApproval: false,
      timestamp: Date.now(),
    });

    expect(result).toBeDefined();
    expect(result.query).toBe('Monaco Editor');
    expect(Array.isArray(result.results)).toBe(true);
  }, 20000);
});
