import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  initMemory,
  AgentMemoryEngine,
  rememberMemory,
  listMemories,
  buildMemorySection,
  getWorkingMemory,
  updateWorkingMemory,
  storeSemanticFact,
  getSemanticFacts,
  tombstoneSemanticFact,
  recordEpisodicEpisode,
  searchEpisodicEpisodes,
  reflectOnEpisode,
  recordProceduralRecipe,
  findProceduralRecipes,
  getParametricMemoryProfile,
  scheduleProspectiveTask,
  listPendingProspectiveTasks,
  checkAndTriggerProspectiveTasks,
  completeProspectiveTask,
} from '../../server/harness/memory.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  initMemory(db);
});

describe('7-Type Cognitive Agent Memory System', () => {
  // 1. Working Memory
  describe('Type 1: In-Context / Working Memory', () => {
    it('manages active scratchpad, goals, subgoals, and invariants', () => {
      const initial = getWorkingMemory('chat-123', '/workspace');
      expect(initial.activeGoal).toBe('');

      updateWorkingMemory('chat-123', {
        activeGoal: 'Refactor Auth Provider Pipeline',
        subgoals: [
          { id: '1', text: 'Parse cookie headers', status: 'completed' },
          { id: '2', text: 'Validate OAuth signature', status: 'in_progress' },
        ],
        activeInvariants: ['Never log plain tokens', 'Preserve backwards compatibility'],
        scratchpad: 'Testing with token expiration = 3600',
      }, '/workspace');

      const updated = getWorkingMemory('chat-123', '/workspace');
      expect(updated.activeGoal).toBe('Refactor Auth Provider Pipeline');
      expect(updated.subgoals).toHaveLength(2);
      expect(updated.subgoals[0].status).toBe('completed');
      expect(updated.activeInvariants).toContain('Never log plain tokens');

      const section = AgentMemoryEngine.working.buildSection('chat-123', '/workspace');
      expect(section).toContain('ACTIVE WORKING MEMORY');
      expect(section).toContain('Refactor Auth Provider Pipeline');
      expect(section).toContain('[DONE] Parse cookie headers');
    });
  });

  // 2. Semantic Memory
  describe('Type 2: Semantic Memory', () => {
    it('stores structured facts with confidence and decay/tombstoning', () => {
      const fact = storeSemanticFact({
        entity: 'user',
        attribute: 'preferred_language',
        value: 'TypeScript',
        confidence: 0.95,
        scope: 'user',
      });

      expect(fact.entity).toBe('user');
      expect(fact.attribute).toBe('preferred_language');
      expect(fact.value).toBe('TypeScript');

      const facts = getSemanticFacts();
      expect(facts).toHaveLength(1);
      expect(facts[0].value).toBe('TypeScript');

      // Tombstoning / Purposeful Forgetting
      tombstoneSemanticFact(fact.id);
      const activeFacts = getSemanticFacts({ includeTombstoned: false });
      expect(activeFacts).toHaveLength(0);

      const allFacts = getSemanticFacts({ includeTombstoned: true });
      expect(allFacts).toHaveLength(1);
      expect(allFacts[0].tombstoned).toBe(true);
    });
  });

  // 3. Episodic Memory
  describe('Type 3: Episodic Memory', () => {
    it('stores past task episodes and performs reflection distillation', () => {
      const episode = recordEpisodicEpisode({
        taskQuery: 'Fix port collision on dev server',
        actionSummary: 'Discovered PID 25160 holding port 56676 and redirected proxy',
        trajectory: ['lsof -i :56676', 'kill PID', 'start proxy on 56677'],
        toolsUsed: ['run_command', 'read_file'],
        outcome: 'success',
        fitnessScore: 0.98,
        lessonsLearned: ['Always check port availability before binding server daemon'],
      });

      expect(episode.id).toBeTruthy();
      expect(episode.fitnessScore).toBe(0.98);

      const recalled = searchEpisodicEpisodes('port collision');
      expect(recalled).toHaveLength(1);
      expect(recalled[0].actionSummary).toContain('PID 25160');

      // Post-task reflection
      reflectOnEpisode(episode.id, 'Crucial lesson: dynamic port allocation prevents test race conditions', [
        'Always check port availability before binding server daemon',
      ]);

      const lessons = listMemories();
      expect(lessons.some((l) => l.content.includes('Always check port availability'))).toBe(true);
    });
  });

  // 4. Procedural Memory
  describe('Type 4: Procedural Memory', () => {
    it('records and retrieves verified recipes and SOPs', () => {
      const recipe = recordProceduralRecipe({
        name: 'Safe Git Deployment Recipe',
        triggerPattern: 'deploy|release|ship',
        prerequisites: ['git status is clean', 'all tests passing'],
        steps: [
          { order: 1, tool: 'run_command', description: 'npm run test:ci' },
          { order: 2, tool: 'run_command', description: 'npm run build' },
          { order: 3, tool: 'run_command', description: 'git push origin main' },
        ],
        verificationAssertions: ['exit code 0', 'bundle size under 2MB'],
      });

      expect(recipe.name).toBe('Safe Git Deployment Recipe');
      const found = findProceduralRecipes('deploy release');
      expect(found).toHaveLength(1);
      expect(found[0].steps).toHaveLength(3);

      const procSection = AgentMemoryEngine.procedural.buildSection('deploy', null);
      expect(procSection).toContain('PROCEDURAL MEMORY');
      expect(procSection).toContain('Safe Git Deployment Recipe');
    });
  });

  // 5. External / Retrieval Memory
  describe('Type 5: External / Retrieval Memory', () => {
    it('retrieves relevant memory slices into working context', () => {
      rememberMemory({ kind: 'fact', content: 'Database uses SQLite with WAL mode' });
      const results = AgentMemoryEngine.retrieval.perform('SQLite WAL mode', ['memory']);
      expect(results).toHaveLength(1);
      expect(results[0].snippet).toContain('SQLite with WAL mode');
    });
  });

  // 6. Parametric Memory
  describe('Type 6: Parametric Memory', () => {
    it('provides capability tier profiling and calibration bounds', () => {
      const frontierProfile = getParametricMemoryProfile('claude-3-7-sonnet', 'anthropic');
      expect(frontierProfile.capabilityTier).toBe('FRONTIER');
      expect(frontierProfile.contextWindow).toBeGreaterThanOrEqual(200000);

      const weakProfile = getParametricMemoryProfile('llama-3.1-8b', 'groq');
      expect(weakProfile.capabilityTier).toBe('COMPACT_WEAK');
      expect(weakProfile.knownWeaknesses).toHaveLength(2);
    });
  });

  // 7. Prospective Memory ("Remembering the Future")
  describe('Type 7: Prospective Memory', () => {
    it('schedules future tasks, checks triggers, and marks completion', () => {
      const now = Date.now();
      const task = scheduleProspectiveTask({
        taskDescription: 'Retry model completion after rate limit cooldown',
        triggerType: 'time',
        triggerCondition: 'rate_limit_cooldown_60s',
        dueAt: now - 1000, // Due immediately
      });

      expect(task.status).toBe('pending');
      const pending = listPendingProspectiveTasks();
      expect(pending).toHaveLength(1);

      // Check and trigger due tasks
      const triggered = checkAndTriggerProspectiveTasks(now);
      expect(triggered).toHaveLength(1);
      expect(triggered[0].id).toBe(task.id);
      expect(triggered[0].status).toBe('active');

      // Complete task
      completeProspectiveTask(task.id);
      const after = listPendingProspectiveTasks();
      expect(after).toHaveLength(0);
    });
  });

  // Comprehensive System Integration
  describe('Comprehensive 7-Type Prompt Builder', () => {
    it('blends working, semantic, procedural, prospective, and long-term memory into structured prompt', () => {
      storeSemanticFact({ entity: 'project', attribute: 'stack', value: 'React + Express' });
      rememberMemory({ kind: 'preference', content: 'User prefers dark theme' });
      scheduleProspectiveTask({
        taskDescription: 'Verify test bundle after build',
        triggerType: 'time',
        triggerCondition: 'post_build',
        dueAt: Date.now() + 30000,
      });

      const { text, usedIds } = buildMemorySection(null, 10, 'project stack');
      expect(text).toContain('MEMORY TYPE 2: SEMANTIC MEMORY');
      expect(text).toContain('project.stack: "React + Express"');
      expect(text).toContain('MEMORY TYPE 7: PROSPECTIVE MEMORY');
      expect(text).toContain('Verify test bundle after build');
      expect(text).toContain('[User preference] User prefers dark theme');
      expect(usedIds).toHaveLength(1);
    });
  });
});
