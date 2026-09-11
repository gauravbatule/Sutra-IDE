import { describe, it, expect } from 'vitest';
import {
  detectModelTier,
  buildCoreAgentContract,
  buildToolContract,
  buildPlanningContract,
  buildExecutionContract,
  buildMasterSystemPrompt,
  buildProModeContract,
} from '../../server/harness/agentPromptArchitecture.js';

describe('SUTRA Studio - Agent Prompt Architecture & Tier Adaptation', () => {
  describe('Model Tier Detection', () => {
    it('accurately identifies FRONTIER tier models', () => {
      expect(detectModelTier('claude-3-7-sonnet-20250219')).toBe('FRONTIER');
      expect(detectModelTier('gpt-5-turbo')).toBe('FRONTIER');
      expect(detectModelTier('gemini-2.5-pro')).toBe('FRONTIER');
      expect(detectModelTier('deepseek-r1')).toBe('FRONTIER');
      expect(detectModelTier('antigravity-alpha')).toBe('FRONTIER');
    });

    it('accurately identifies COMPACT_WEAK tier models', () => {
      expect(detectModelTier('llama-3.1-8b-instruct')).toBe('COMPACT_WEAK');
      expect(detectModelTier('qwen2.5-coder-7b')).toBe('COMPACT_WEAK');
      expect(detectModelTier('phi-4')).toBe('COMPACT_WEAK');
      expect(detectModelTier('llama-3-8b', 'groq')).toBe('COMPACT_WEAK');
    });

    it('defaults standard models to BALANCED tier', () => {
      expect(detectModelTier('gpt-4o-mini')).toBe('BALANCED');
      expect(detectModelTier('gemini-2.5-flash')).toBe('BALANCED');
      expect(detectModelTier('qwen2.5-32b')).toBe('BALANCED');
      expect(detectModelTier('')).toBe('BALANCED');
    });
  });

  describe('Tiered Scaffolding Density', () => {
    it('generates ultra-compact contracts for COMPACT_WEAK tier without prose bloat', () => {
      const core = buildCoreAgentContract('COMPACT_WEAK');
      expect(core).toContain('Role: Autonomous software engineer');
      expect(core.length).toBeLessThan(350);

      const tool = buildToolContract('COMPACT_WEAK');
      expect(tool).toContain('read_file: Read files');
      expect(tool.length).toBeLessThan(300);

      const planning = buildPlanningContract('COMPACT_WEAK');
      expect(planning).toContain('write_todos');
      expect(planning.length).toBeLessThan(200);

      const exec = buildExecutionContract('COMPACT_WEAK');
      expect(exec).toContain('Act immediately');
      expect(exec).toContain('// ... existing code ...');
      expect(exec.length).toBeLessThan(250);
    });

    it('generates rich, parallelized contracts for FRONTIER tier', () => {
      const tool = buildToolContract('FRONTIER');
      expect(tool).toContain('Parallel Tool Dispatch');
      expect(tool).toContain('codebase_search');
      expect(tool).toContain('ast_grep');

      const core = buildCoreAgentContract('FRONTIER');
      expect(core).toContain('Principal Software Engineer');
      expect(core).toContain('Zero-Hallucination');
    });
  });

  describe('Master System Prompt Builder', () => {
    it('omits empty or irrelevant sections for compact models to conserve tokens', () => {
      const prompt = buildMasterSystemPrompt({
        modelId: 'llama-3.1-8b',
        workspaceRoot: '/test/workspace',
        workspaceSnapshot: 'some large file list',
        codeNotesSection: 'some code notes',
        toolStatsSection: 'some tool stats',
      });

      expect(prompt).toContain('Model tier: COMPACT_WEAK');
      expect(prompt).not.toContain('### WORKSPACE SNAPSHOT:');
      expect(prompt).not.toContain('some code notes');
      expect(prompt).not.toContain('some tool stats');
    });

    it('includes full snapshot, memory, and stats for frontier models', () => {
      const prompt = buildMasterSystemPrompt({
        modelId: 'claude-3-7-sonnet',
        workspaceRoot: '/test/workspace',
        workspaceSnapshot: 'fileA.ts, fileB.ts',
        memorySection: 'Memory Fact: Uses Tailwind',
        codeNotesSection: 'Note: authHandler.ts requires cookie',
        toolStatsSection: 'Tool stats: 98% pass',
      });

      expect(prompt).toContain('Model tier: FRONTIER');
      expect(prompt).toContain('### WORKSPACE SNAPSHOT:');
      expect(prompt).toContain('Memory Fact: Uses Tailwind');
      expect(prompt).toContain('Note: authHandler.ts requires cookie');
      expect(prompt).toContain('Tool stats: 98% pass');
    });
  });

  describe('Pro Mode Contract Invariants', () => {
    it('retains all 7 phases and hard rules required for Pro Mode execution', () => {
      const contract = buildProModeContract('SUTRA IDE');
      expect(contract).toContain('Pro Mode');
      expect(contract).toContain('1. **INSPECT**');
      expect(contract).toContain('2. **HYPOTHESIZE**');
      expect(contract).toContain('3. **PLAN**');
      expect(contract).toContain('4. **ACT**');
      expect(contract).toContain('5. **EXECUTE / VERIFY**');
      expect(contract).toContain('6. **INTERPRET**');
      expect(contract).toContain('7. **CHECKPOINT**');
      expect(contract).toContain('Never mark a task, subtask, or todo complete without a structured pass result');
      expect(contract).toContain('Never fabricate a tool result');
      expect(contract).toContain('No silent scope expansion');
      expect(contract).toContain('No fallback-as-fix');
      expect(contract).toContain('One hypothesis, one test, one iteration');
    });
  });
});