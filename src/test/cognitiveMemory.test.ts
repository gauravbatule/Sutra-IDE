import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  initMemory,
  rememberMemory,
  getWorkingMemory,
  updateWorkingMemory,
  clearWorkingMemory,
  buildWorkingMemorySection,
  recordProceduralRecipe,
  findProceduralRecipes,
  recordRecipeOutcome,
  buildProceduralSection,
  recordEpisodicEpisode,
  searchEpisodicEpisodes,
  buildMemorySection,
} from '../../server/harness/memory.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  initMemory(db);
});

describe('4-Tier Cognitive Memory Architecture', () => {
  describe('Tier 1: Working Memory Context & Scratchpad', () => {
    it('initializes and updates working memory for a conversation', () => {
      const initial = getWorkingMemory('chat-123', '/workspace/app');
      expect(initial.activeGoal).toBe('');
      expect(initial.subgoals).toEqual([]);

      const updated = updateWorkingMemory('chat-123', {
        activeGoal: 'Refactor authentication state machine',
        subgoals: [
          { id: '1', text: 'Define auth state types', status: 'completed' },
          { id: '2', text: 'Implement JWT refresh loop', status: 'in_progress' },
        ],
        activeInvariants: ['Never log user passwords in telemetry', 'Maintain backward compatibility'],
        scratchpad: 'Note: Port 3001 is listening for OAuth callback',
      }, '/workspace/app');

      expect(updated.activeGoal).toBe('Refactor authentication state machine');
      expect(updated.subgoals).toHaveLength(2);
      expect(updated.activeInvariants).toHaveLength(2);

      const section = buildWorkingMemorySection('chat-123', '/workspace/app');
      expect(section).toContain('Refactor authentication state machine');
      expect(section).toContain('[DONE] Define auth state types');
      expect(section).toContain('[IN_PROGRESS] Implement JWT refresh loop');
      expect(section).toContain('Never log user passwords in telemetry');
      expect(section).toContain('Port 3001 is listening for OAuth callback');
    });

    it('clears working memory cleanly', () => {
      updateWorkingMemory('chat-456', { activeGoal: 'Temporary goal' });
      expect(getWorkingMemory('chat-456').activeGoal).toBe('Temporary goal');

      clearWorkingMemory('chat-456');
      expect(getWorkingMemory('chat-456').activeGoal).toBe('');
    });
  });

  describe('Tier 4: Procedural Memory (How-To Execution Recipes)', () => {
    it('records and retrieves verified procedural recipes with step actions', () => {
      const recipe = recordProceduralRecipe({
        name: 'Fix React Hydration Mismatch',
        triggerPattern: 'hydration failed initial ui does not match',
        prerequisites: ['Monaco editor is mounted on client only'],
        steps: [
          { order: 1, tool: 'grep_search', description: 'Search for typeof window or useEffect guards' },
          { order: 2, tool: 'edit_file', description: 'Wrap client-only component with dynamic ssr:false or useEffect' },
          { order: 3, tool: 'run_unit_tests', description: 'Run vitest to verify hydration fix', expectedOutcome: 'All tests pass' },
        ],
        verificationAssertions: ['Component mounts without console warnings'],
        workspaceRoot: '/workspace/app',
      });

      expect(recipe.id).toMatch(/^rec-/);
      expect(recipe.steps).toHaveLength(3);

      const matches = findProceduralRecipes('how to fix react hydration mismatch error', '/workspace/app');
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches[0].name).toBe('Fix React Hydration Mismatch');
      expect(matches[0].steps[0].tool).toBe('grep_search');

      const section = buildProceduralSection('react hydration error', '/workspace/app');
      expect(section).toContain('Fix React Hydration Mismatch');
      expect(section).toContain('[grep_search]');
    });

    it('updates recipe outcome statistics on success and failure', () => {
      const recipe = recordProceduralRecipe({
        name: 'Vite Build TS Config Alignment',
        triggerPattern: 'vite build cannot find module',
        prerequisites: [],
        steps: [{ order: 1, description: 'Check tsconfig.json moduleResolution' }],
        verificationAssertions: [],
        workspaceRoot: '/workspace/app',
      });

      recordRecipeOutcome(recipe.id, true);
      recordRecipeOutcome(recipe.id, true);
      recordRecipeOutcome(recipe.id, false);

      const found = findProceduralRecipes('vite build moduleResolution');
      expect(found[0].successCount).toBe(3);
      expect(found[0].failureCount).toBe(1);
    });
  });

  describe('Tier 2: Episodic Memory (Task Trajectories & Outcomes)', () => {
    it('records and retrieves task trajectories and post-mortems', () => {
      const episode = recordEpisodicEpisode({
        taskQuery: 'Resolve ConPTY terminal hang on Windows',
        actionSummary: 'Replaced synchronous wait with EventEmitter non-blocking loop',
        trajectory: ['inspect ptyManager.ts', 'identify blocking loop', 'patch with event listener', 'verify tests'],
        toolsUsed: ['read_file', 'edit_file', 'run_unit_tests'],
        outcome: 'success',
        fitnessScore: 0.98,
        lessonsLearned: ['Windows ConPTY requires explicit event teardown on close'],
        workspaceRoot: '/workspace/app',
      });

      expect(episode.id).toMatch(/^eps-/);
      expect(episode.fitnessScore).toBe(0.98);

      const searchResults = searchEpisodicEpisodes('Windows ConPTY terminal hang', '/workspace/app');
      expect(searchResults.length).toBeGreaterThanOrEqual(1);
      expect(searchResults[0].taskQuery).toContain('ConPTY terminal');
      expect(searchResults[0].lessonsLearned).toContain('Windows ConPTY requires explicit event teardown on close');
    });
  });

  describe('Integrated Multi-Tier buildMemorySection', () => {
    it('blends Working Memory, Procedural Memory, Semantic Invariants and Lessons seamlessly', () => {
      updateWorkingMemory('chat-main', {
        activeGoal: 'Complete full-stack feature implementation',
        scratchpad: 'Keep database connections pooled',
      });

      recordProceduralRecipe({
        name: 'Database Migration Safe Sequence',
        triggerPattern: 'database migration alter table',
        prerequisites: [],
        steps: [{ order: 1, description: 'Wrap alter table in transaction' }],
        verificationAssertions: [],
        workspaceRoot: '/workspace/app',
      });

      rememberMemory({ kind: 'semantic', content: 'Database uses better-sqlite3 with WAL mode enabled' });
      rememberMemory({ kind: 'preference', content: 'Use dark theme with Paper+Ink palette' });
      rememberMemory({ kind: 'lesson', content: 'Always run CI=1 on test runners to prevent hanging' });

      const memoryOutput = buildMemorySection(null, 10, 'database migration', 'chat-main');
      expect(memoryOutput.text).toContain('ACTIVE WORKING MEMORY');
      expect(memoryOutput.text).toContain('Complete full-stack feature implementation');
      expect(memoryOutput.text).toContain('PROCEDURAL MEMORY');
      expect(memoryOutput.text).toContain('Database Migration Safe Sequence');
      expect(memoryOutput.text).toContain('LONG-TERM COGNITIVE MEMORY');
      expect(memoryOutput.text).toContain('[Semantic Invariant] Database uses better-sqlite3 with WAL mode enabled');
      expect(memoryOutput.text).toContain('[User preference] Use dark theme with Paper+Ink palette');
      expect(memoryOutput.text).toContain('[Lesson] Always run CI=1 on test runners to prevent hanging');
    });
  });
});
