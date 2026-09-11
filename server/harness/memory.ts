/**
 * SUTRA Studio — 7-Type Cognitive Agent Memory Architecture
 *
 * Implements the 7 foundational memory types for autonomous language agents:
 *
 * 1. In-Context / Working Memory: Active conversation package, checkpointer state,
 *    token budget tracking, working scratchpad, active goals/subgoals, invariants.
 * 2. Semantic Memory: Persistent, lasting facts separated from original episodes
 *    (user preferences, tech stack facts, entity-attribute-value store with decay/tombstoning).
 * 3. Episodic Memory: Whole-event diary of past task trajectories (objective, actions,
 *    tools, errors, outcome) distilled through reflection into reusable lessons.
 * 4. Procedural Memory: Reusable methods, standard operating procedures (SOPs),
 *    step sequences, trigger patterns, and verification assertions.
 * 5. External / Retrieval Memory: Hybrid multi-index retrieval (AST symbols,
 *    file topology, keyword search, vector similarity) returning targeted slices.
 * 6. Parametric Memory: Pretrained model capabilities, tier calibration (FRONTIER,
 *    BALANCED, COMPACT_WEAK), knowledge boundaries, and context limits.
 * 7. Prospective Memory: "Remembering the future" — scheduled follow-ups, delayed
 *    verification triggers, rate-limit reset timers, cron jobs, and task queues.
 */

import type Database from 'better-sqlite3';

// ===========================================================================
// Core Memory Types & Schemas
// ===========================================================================

export type MemoryKind =
  | 'lesson'
  | 'preference'
  | 'fact'
  | 'architecture'
  | 'episodic'
  | 'semantic'
  | 'procedural'
  | 'prospective';

export interface MemoryEntry {
  id: number;
  kind: MemoryKind;
  content: string;
  /** Workspace this memory belongs to, or null for globally applicable memories. */
  workspaceRoot: string | null;
  createdAt: number;
  lastUsedAt: number;
  useCount: number;
}

// ---------------------------------------------------------------------------
// Type 1: In-Context / Working Memory (Active Context Scratchpad)
// ---------------------------------------------------------------------------

export interface WorkingSubgoal {
  id: string;
  text: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface WorkingMemoryContext {
  chatId: string;
  workspaceRoot: string | null;
  activeGoal: string;
  subgoals: WorkingSubgoal[];
  activeInvariants: string[];
  workingHypotheses: string[];
  groundedFiles: string[];
  scratchpad: string;
  tokenBudget?: number;
  compactedSummary?: string;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Type 2: Semantic Memory (Entity-Attribute-Value Facts with Decay & Tombstoning)
// ---------------------------------------------------------------------------

export interface SemanticFact {
  id: string;
  entity: string; // e.g. 'user', 'project', 'backend', 'auth', 'ui'
  attribute: string; // e.g. 'preferred_language', 'tailwind_version', 'api_style'
  value: string; // e.g. 'TypeScript', 'v4.0', 'REST'
  confidence: number; // 0.0 to 1.0
  scope: 'user' | 'workspace' | 'global';
  workspaceRoot: string | null;
  tombstoned: boolean; // Purposeful forgetting / decay
  expiresAt: number | null; // Ephemeral facts expiration
  createdAt: number;
  updatedAt: number;
  accessCount: number;
}

// ---------------------------------------------------------------------------
// Type 3: Episodic Memory (Task Trajectories & Post-Mortems)
// ---------------------------------------------------------------------------

export interface EpisodicEpisode {
  id: string;
  taskQuery: string;
  actionSummary: string;
  trajectory: string[];
  toolsUsed: string[];
  outcome: 'success' | 'failure' | 'partial';
  fitnessScore: number; // 0.00 to 1.00
  lessonsLearned: string[];
  userFeedback?: string;
  reflection?: string;
  workspaceRoot: string | null;
  createdAt: number;
  lastRecalledAt: number;
  recallCount: number;
}

// ---------------------------------------------------------------------------
// Type 4: Procedural Memory (Executable Verified Recipes & SOPs)
// ---------------------------------------------------------------------------

export interface ProceduralStep {
  order: number;
  tool?: string;
  description: string;
  expectedOutcome?: string;
}

export interface ProceduralRecipe {
  id: string;
  name: string;
  triggerPattern: string;
  prerequisites: string[];
  steps: ProceduralStep[];
  verificationAssertions: string[];
  successCount: number;
  failureCount: number;
  workspaceRoot: string | null;
  createdAt: number;
  lastUsedAt: number;
}

// ---------------------------------------------------------------------------
// Type 5: External / Retrieval Memory (Multi-Index Hybrid Retrieval)
// ---------------------------------------------------------------------------

export interface RetrievalResult {
  source: 'ast_symbol' | 'workspace_file' | 'doc' | 'sqlite' | 'memory';
  title: string;
  snippet: string;
  score: number;
  metadata?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Type 6: Parametric Memory (Pretrained Model Bounds & Profile)
// ---------------------------------------------------------------------------

export interface ParametricMemoryProfile {
  modelId: string;
  provider: string;
  capabilityTier: 'FRONTIER' | 'BALANCED' | 'COMPACT_WEAK';
  contextWindow: number;
  parametricStrengths: string[];
  knownWeaknesses: string[];
  calibrationNotes: string;
}

// ---------------------------------------------------------------------------
// Type 7: Prospective Memory ("Remembering the Future" — Scheduled Tasks & Timers)
// ---------------------------------------------------------------------------

export interface ProspectiveTask {
  id: string;
  taskDescription: string;
  triggerType: 'time' | 'event' | 'condition' | 'interval';
  triggerCondition: string; // ISO timestamp, event name (e.g. 'rate_limit_reset'), or condition
  payload?: Record<string, any>;
  status: 'pending' | 'active' | 'completed' | 'cancelled' | 'expired';
  workspaceRoot: string | null;
  dueAt: number; // Unix timestamp
  createdAt: number;
  completedAt?: number | null;
}

// ===========================================================================
// Database Initialization
// ===========================================================================

let db: Database.Database | null = null;

export function initMemory(database: Database.Database): void {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      workspace_root TEXT,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL,
      use_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_agent_memories_used ON agent_memories(last_used_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_memories_dedupe ON agent_memories(kind, content);

    -- Type 1: Working Memory
    CREATE TABLE IF NOT EXISTS agent_working_memories (
      chat_id TEXT PRIMARY KEY,
      workspace_root TEXT,
      active_goal TEXT NOT NULL DEFAULT '',
      subgoals TEXT NOT NULL DEFAULT '[]',
      active_invariants TEXT NOT NULL DEFAULT '[]',
      working_hypotheses TEXT NOT NULL DEFAULT '[]',
      grounded_files TEXT NOT NULL DEFAULT '[]',
      scratchpad TEXT NOT NULL DEFAULT '',
      token_budget INTEGER,
      compacted_summary TEXT,
      updated_at INTEGER NOT NULL
    );

    -- Type 2: Semantic Facts Store
    CREATE TABLE IF NOT EXISTS agent_semantic_facts (
      id TEXT PRIMARY KEY,
      entity TEXT NOT NULL,
      attribute TEXT NOT NULL,
      value TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0,
      scope TEXT NOT NULL DEFAULT 'workspace',
      workspace_root TEXT,
      tombstoned INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      access_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_semantic_facts_lookup ON agent_semantic_facts(entity, attribute, tombstoned);
    CREATE INDEX IF NOT EXISTS idx_semantic_facts_workspace ON agent_semantic_facts(workspace_root);

    -- Type 3: Episodic Memory Episodes
    CREATE TABLE IF NOT EXISTS agent_episodic_episodes (
      id TEXT PRIMARY KEY,
      task_query TEXT NOT NULL,
      action_summary TEXT NOT NULL,
      trajectory TEXT NOT NULL DEFAULT '[]',
      tools_used TEXT NOT NULL DEFAULT '[]',
      outcome TEXT NOT NULL,
      fitness_score REAL NOT NULL DEFAULT 0.0,
      lessons_learned TEXT NOT NULL DEFAULT '[]',
      user_feedback TEXT,
      reflection TEXT,
      workspace_root TEXT,
      created_at INTEGER NOT NULL,
      last_recalled_at INTEGER NOT NULL,
      recall_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_episodic_episodes_recalled ON agent_episodic_episodes(last_recalled_at DESC);

    -- Type 4: Procedural Recipes
    CREATE TABLE IF NOT EXISTS agent_procedural_recipes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      trigger_pattern TEXT NOT NULL,
      prerequisites TEXT NOT NULL DEFAULT '[]',
      steps TEXT NOT NULL DEFAULT '[]',
      verification_assertions TEXT NOT NULL DEFAULT '[]',
      success_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      workspace_root TEXT,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_procedural_recipes_used ON agent_procedural_recipes(last_used_at DESC);

    -- Type 7: Prospective Memory (Scheduled Future Tasks)
    CREATE TABLE IF NOT EXISTS agent_prospective_tasks (
      id TEXT PRIMARY KEY,
      task_description TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      trigger_condition TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      workspace_root TEXT,
      due_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_prospective_tasks_due ON agent_prospective_tasks(status, due_at ASC);
  `);
}

function requireDb(): Database.Database {
  if (!db) throw new Error('memory not initialized — call initMemory first');
  return db;
}

/** Defensive JSON parse that returns a fallback on corrupt or truncated SQLite rows */
function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const val = JSON.parse(raw);
    return val !== null && val !== undefined ? val : fallback;
  } catch {
    return fallback;
  }
}

// ===========================================================================
// Curation & Text Normalization Helpers (Pure Functions)
// ===========================================================================

const MEMORY_SIMILARITY_THRESHOLD = 0.70;
const MIN_LESSON_LENGTH = 25;
const MEMORY_SECTION_CAP = 8;

export const normalizeMemoryText = (content: string): string => {
  return content
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\s.,;:!?"'`)\]}—–-]+$/, '');
};

const tokenizeMemory = (normalized: string): Set<string> =>
  new Set(normalized.split(/[^a-z0-9]+/).filter(Boolean));

export const areMemoriesSimilar = (a: string, b: string): boolean => {
  const left = normalizeMemoryText(a);
  const right = normalizeMemoryText(b);
  if (left === '' || right === '') return false;
  if (left === right) return true;
  const leftTokens = tokenizeMemory(left);
  const rightTokens = tokenizeMemory(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return false;

  // Check polarity / negation conflict
  const NEGATION_WORDS = new Set(['not', 'never', 'no', 'avoid', 'avoids', 'avoiding', 'dont', 'cannot', 'cant']);
  const leftHasNegation = Array.from(leftTokens).some((t) => NEGATION_WORDS.has(t));
  const rightHasNegation = Array.from(rightTokens).some((t) => NEGATION_WORDS.has(t));
  if (leftHasNegation !== rightHasNegation) {
    // Conflicting polarity: one is negative/preventative, the other is affirmative.
    // They are contradictory or distinct directives and must not be merged.
    return false;
  }

  const isSubset = (small: Set<string>, big: Set<string>): boolean => {
    if (small.size >= big.size) return false;
    for (const token of small) if (!big.has(token)) return false;
    return true;
  };
  if (isSubset(leftTokens, rightTokens) || isSubset(rightTokens, leftTokens)) return true;
  let overlap = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
  const union = leftTokens.size + rightTokens.size - overlap;
  return overlap / union >= MEMORY_SIMILARITY_THRESHOLD;
};

const ACTIONABLE_PATTERN =
  /\b(must|always|never|use[sd]?|using|avoids?|avoided|avoiding|prefers?|preferred|instead|because|fails?|failed|failing|errors?|fix(es|ed)?|requires?|required|missing|wrong|correct(ly)?|ensures?|ensured|should)\b/i;

const GENERIC_FILLER_PATTERN =
  /^(thank you|thanks|thx|ty\b|great|good job|good|nice work|nice|perfect|awesome|excellent|amazing|fantastic|cool|well done|got it|sounds good|it works|works now|all good|done|sure|yep|nope)\b/i;

export const shouldAutoRecordLesson = (content: string): { ok: boolean; reason: string } => {
  const trimmed = content.trim();
  if (trimmed.length < MIN_LESSON_LENGTH) return { ok: false, reason: 'too_short' };
  if (!/[a-z]/i.test(trimmed)) return { ok: false, reason: 'no_letters' };
  const normalized = normalizeMemoryText(trimmed);
  if (!ACTIONABLE_PATTERN.test(normalized)) {
    if (GENERIC_FILLER_PATTERN.test(normalized)) return { ok: false, reason: 'generic_filler' };
    return { ok: false, reason: 'not_actionable' };
  }
  return { ok: true, reason: 'actionable' };
};

// ===========================================================================
// Core agent_memories Table Operations
// ===========================================================================

function findSimilarMemory(
  database: Database.Database,
  kind: MemoryKind,
  content: string,
  workspaceRoot: string | null
): MemoryEntry | null {
  const wsNorm = workspaceRoot ? workspaceRoot.replace(/\\/g, '/') : null;
  const rows = (
    kind === 'preference'
      ? database.prepare('SELECT * FROM agent_memories WHERE kind = ? AND (workspace_root IS NULL OR workspace_root = ? OR replace(workspace_root, \'\\\', \'/\') = ?) ORDER BY last_used_at DESC').all(kind, workspaceRoot, wsNorm)
      : workspaceRoot
        ? database.prepare('SELECT * FROM agent_memories WHERE kind = ? AND (workspace_root = ? OR replace(workspace_root, \'\\\', \'/\') = ?) ORDER BY last_used_at DESC').all(kind, workspaceRoot, wsNorm)
        : database.prepare('SELECT * FROM agent_memories WHERE kind = ? AND workspace_root IS NULL ORDER BY last_used_at DESC').all(kind)
  ) as any[];
  for (const row of rows) {
    if (areMemoriesSimilar(content, String(row.content))) return rowToEntry(row);
  }
  return null;
}

export function rememberMemory(input: {
  kind: MemoryKind;
  content: string;
  workspaceRoot?: string | null;
  autoLesson?: boolean;
}): MemoryEntry {
  const database = requireDb();
  const content = input.content.trim().slice(0, 500);
  const workspaceRoot = input.workspaceRoot ? input.workspaceRoot.replace(/\\/g, '/') : null;
  const now = Date.now();

  if (input.autoLesson && input.kind === 'lesson') {
    const verdict = shouldAutoRecordLesson(content);
    if (!verdict.ok) throw new Error(`lesson rejected (${verdict.reason}): ${content.slice(0, 80)}`);
  }

  const similar = findSimilarMemory(database, input.kind, content, workspaceRoot);
  if (similar) {
    const adoptWording = content.length < similar.content.length * 0.8;
    try {
      database
        .prepare(
          `UPDATE agent_memories SET last_used_at = ?, use_count = use_count + 1${
            adoptWording ? ', content = ?' : ''
          } WHERE id = ?`
        )
        .run(...(adoptWording ? [now, content, similar.id] : [now, similar.id]));
    } catch {
      database
        .prepare('UPDATE agent_memories SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?')
        .run(now, similar.id);
    }
    const row = database.prepare('SELECT * FROM agent_memories WHERE id = ?').get(similar.id) as any;
    return rowToEntry(row);
  }

  database
    .prepare(
      `INSERT INTO agent_memories (kind, content, workspace_root, created_at, last_used_at, use_count)
       VALUES (?, ?, ?, ?, ?, 1)
       ON CONFLICT(kind, content) DO UPDATE SET last_used_at = excluded.last_used_at, use_count = use_count + 1`
    )
    .run(input.kind, content, workspaceRoot, now, now);
  const row = database
    .prepare('SELECT * FROM agent_memories WHERE kind = ? AND content = ?')
    .get(input.kind, content) as any;
  return rowToEntry(row);
}

export function listMemories(opts: { workspaceRoot?: string | null; limit?: number } = {}): MemoryEntry[] {
  const database = requireDb();
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  let rows: any[];
  if (opts.workspaceRoot) {
    const wsNorm = opts.workspaceRoot.replace(/\\/g, '/');
    rows = database
      .prepare(
        "SELECT * FROM agent_memories WHERE (workspace_root = ? OR replace(workspace_root, '\\', '/') = ? OR workspace_root IS NULL) ORDER BY CASE WHEN workspace_root IS NOT NULL THEN 0 ELSE 1 END, last_used_at DESC, id DESC LIMIT ?"
      )
      .all(opts.workspaceRoot, wsNorm, limit);
  } else {
    rows = database.prepare('SELECT * FROM agent_memories ORDER BY last_used_at DESC, id DESC LIMIT ?').all(limit);
  }
  return rows.map(rowToEntry);
}

export function searchMemories(opts: {
  query?: string;
  kind?: MemoryKind;
  workspaceRoot?: string | null;
  limit?: number;
}): MemoryEntry[] {
  const database = requireDb();
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
  let rows: any[] = [];

  if (opts.workspaceRoot) {
    const wsNorm = opts.workspaceRoot.replace(/\\/g, '/');
    if (opts.kind) {
      rows = database
        .prepare(
          "SELECT * FROM agent_memories WHERE kind = ? AND (workspace_root = ? OR replace(workspace_root, '\\', '/') = ? OR workspace_root IS NULL) ORDER BY CASE WHEN workspace_root IS NOT NULL THEN 0 ELSE 1 END, last_used_at DESC, id DESC LIMIT ?"
        )
        .all(opts.kind, opts.workspaceRoot, wsNorm, limit);
    } else {
      rows = database
        .prepare(
          "SELECT * FROM agent_memories WHERE (workspace_root = ? OR replace(workspace_root, '\\', '/') = ? OR workspace_root IS NULL) ORDER BY CASE WHEN workspace_root IS NOT NULL THEN 0 ELSE 1 END, last_used_at DESC, id DESC LIMIT ?"
        )
        .all(opts.workspaceRoot, wsNorm, limit);
    }
  } else if (opts.kind) {
    rows = database
      .prepare('SELECT * FROM agent_memories WHERE kind = ? ORDER BY last_used_at DESC, id DESC LIMIT ?')
      .all(opts.kind, limit);
  } else {
    rows = database.prepare('SELECT * FROM agent_memories ORDER BY last_used_at DESC, id DESC LIMIT ?').all(limit);
  }

  const entries = rows.map(rowToEntry);
  if (!opts.query || !opts.query.trim()) return entries;

  const queryTokens = tokenizeMemory(normalizeMemoryText(opts.query));
  if (queryTokens.size === 0) return entries;

  return entries
    .map((entry) => {
      const entryTokens = tokenizeMemory(normalizeMemoryText(entry.content));
      let overlap = 0;
      for (const t of queryTokens) {
        if (entryTokens.has(t)) overlap += 1;
      }
      const score = overlap / Math.max(1, queryTokens.size);
      return { entry, score };
    })
    .sort((a, b) => b.score - a.score || b.entry.lastUsedAt - a.entry.lastUsedAt)
    .filter((item) => item.score > 0 || entries.length <= 5)
    .map((item) => item.entry)
    .slice(0, limit);
}

export function forgetMemory(id: number): boolean {
  const database = requireDb();
  const result = database.prepare('DELETE FROM agent_memories WHERE id = ?').run(id);
  return result.changes > 0;
}

export function touchMemories(ids: number[]): void {
  if (ids.length === 0) return;
  const database = requireDb();
  const now = Date.now();
  const stmt = database.prepare('UPDATE agent_memories SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?');
  const tx = database.transaction((idsToUpdate: number[]) => {
    for (const id of idsToUpdate) stmt.run(now, id);
  });
  try {
    tx(ids);
  } catch {
    // Non-blocking
  }
}

export function pruneMemories(keep = 200): number {
  const database = requireDb();
  const result = database
    .prepare(
      'DELETE FROM agent_memories WHERE id NOT IN (SELECT id FROM agent_memories ORDER BY last_used_at DESC, id DESC LIMIT ?)'
    )
    .run(Math.min(Math.max(keep, 10), 1000));
  return result.changes;
}

export function consolidateMemories(): { mergedCount: number; remainingCount: number } {
  const database = requireDb();
  const allRows = (database.prepare('SELECT * FROM agent_memories ORDER BY kind, last_used_at DESC').all() as any[]).map(rowToEntry);
  let mergedCount = 0;
  const toDelete = new Set<number>();

  for (let i = 0; i < allRows.length; i++) {
    const a = allRows[i];
    if (toDelete.has(a.id)) continue;

    for (let j = i + 1; j < allRows.length; j++) {
      const b = allRows[j];
      if (toDelete.has(b.id)) continue;
      if (a.kind !== b.kind) continue;

      if (areMemoriesSimilar(a.content, b.content)) {
        const keepA = a.content.length <= b.content.length;
        const target = keepA ? a : b;
        const victim = keepA ? b : a;

        try {
          database.prepare('UPDATE agent_memories SET use_count = use_count + ?, last_used_at = MAX(last_used_at, ?) WHERE id = ?')
            .run(victim.useCount, victim.lastUsedAt, target.id);
          database.prepare('DELETE FROM agent_memories WHERE id = ?').run(victim.id);
          toDelete.add(victim.id);
          mergedCount++;
        } catch {
          // Ignore unique collision
        }
      }
    }
  }

  const remaining = database.prepare('SELECT COUNT(*) as cnt FROM agent_memories').get() as any;
  return { mergedCount, remainingCount: remaining?.cnt || 0 };
}

// ===========================================================================
// TYPE 1: In-Context / Working Memory
// ===========================================================================

export function getWorkingMemory(chatId: string, workspaceRoot?: string | null): WorkingMemoryContext {
  const database = requireDb();
  const safeChatId = chatId || 'default';
  const row = database.prepare('SELECT * FROM agent_working_memories WHERE chat_id = ?').get(safeChatId) as any;
  if (!row) {
    return {
      chatId: safeChatId,
      workspaceRoot: workspaceRoot ?? null,
      activeGoal: '',
      subgoals: [],
      activeInvariants: [],
      workingHypotheses: [],
      groundedFiles: [],
      scratchpad: '',
      updatedAt: Date.now(),
    };
  }
  return {
    chatId: row.chat_id,
    workspaceRoot: row.workspace_root ?? null,
    activeGoal: row.active_goal || '',
    subgoals: safeJsonParse<WorkingSubgoal[]>(row.subgoals, []),
    activeInvariants: safeJsonParse<string[]>(row.active_invariants, []),
    workingHypotheses: safeJsonParse<string[]>(row.working_hypotheses, []),
    groundedFiles: safeJsonParse<string[]>(row.grounded_files, []),
    scratchpad: row.scratchpad || '',
    tokenBudget: row.token_budget || undefined,
    compactedSummary: row.compacted_summary || undefined,
    updatedAt: row.updated_at,
  };
}

export function updateWorkingMemory(
  chatId: string,
  updates: Partial<WorkingMemoryContext>,
  workspaceRoot?: string | null
): WorkingMemoryContext {
  const database = requireDb();
  const current = getWorkingMemory(chatId, workspaceRoot);
  const updated: WorkingMemoryContext = {
    ...current,
    ...updates,
    chatId: current.chatId,
    workspaceRoot: updates.workspaceRoot !== undefined ? updates.workspaceRoot : current.workspaceRoot,
    updatedAt: Date.now(),
  };

  database
    .prepare(
      `INSERT INTO agent_working_memories (chat_id, workspace_root, active_goal, subgoals, active_invariants, working_hypotheses, grounded_files, scratchpad, token_budget, compacted_summary, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET
         workspace_root = excluded.workspace_root,
         active_goal = excluded.active_goal,
         subgoals = excluded.subgoals,
         active_invariants = excluded.active_invariants,
         working_hypotheses = excluded.working_hypotheses,
         grounded_files = excluded.grounded_files,
         scratchpad = excluded.scratchpad,
         token_budget = excluded.token_budget,
         compacted_summary = excluded.compacted_summary,
         updated_at = excluded.updated_at`
    )
    .run(
      updated.chatId,
      updated.workspaceRoot,
      updated.activeGoal,
      JSON.stringify(updated.subgoals),
      JSON.stringify(updated.activeInvariants),
      JSON.stringify(updated.workingHypotheses),
      JSON.stringify(updated.groundedFiles),
      updated.scratchpad,
      updated.tokenBudget ?? null,
      updated.compactedSummary ?? null,
      updated.updatedAt
    );

  return updated;
}

export function clearWorkingMemory(chatId: string): void {
  const database = requireDb();
  database.prepare('DELETE FROM agent_working_memories WHERE chat_id = ?').run(chatId || 'default');
}

export function buildWorkingMemorySection(chatId: string, workspaceRoot?: string | null): string {
  try {
    const wm = getWorkingMemory(chatId, workspaceRoot);
    const lines: string[] = [];

    if (wm.activeGoal) {
      lines.push(`- Active Mission Goal: "${wm.activeGoal}"`);
    }
    if (wm.subgoals.length > 0) {
      const formatted = wm.subgoals.map(
        (s) => `  * [${s.status === 'completed' ? 'DONE' : s.status === 'in_progress' ? 'IN_PROGRESS' : 'TODO'}] ${s.text}`
      );
      lines.push('- Subgoals:\n' + formatted.join('\n'));
    }
    if (wm.activeInvariants.length > 0) {
      lines.push('- Active Invariants (MUST NOT VIOLATE):\n' + wm.activeInvariants.map((i) => `  * ${i}`).join('\n'));
    }
    if (wm.workingHypotheses.length > 0) {
      lines.push('- Working Hypotheses:\n' + wm.workingHypotheses.map((h) => `  * ${h}`).join('\n'));
    }
    if (wm.groundedFiles.length > 0) {
      lines.push(`- Active Grounded Files: [${wm.groundedFiles.map((f) => `"${f}"`).join(', ')}]`);
    }
    if (wm.scratchpad) {
      lines.push(`- Working Scratchpad Notes: ${wm.scratchpad}`);
    }
    if (wm.compactedSummary) {
      lines.push(`- Compacted Prior Context: ${wm.compactedSummary}`);
    }

    if (lines.length === 0) return '';
    return `ACTIVE WORKING MEMORY (Active Context Scratchpad):\n${lines.join('\n')}`;
  } catch {
    return '';
  }
}

// ===========================================================================
// TYPE 2: Semantic Memory (Entity-Attribute-Value Facts Store)
// ===========================================================================

export function storeSemanticFact(fact: {
  entity: string;
  attribute: string;
  value: string;
  confidence?: number;
  scope?: 'user' | 'workspace' | 'global';
  workspaceRoot?: string | null;
  expiresInSeconds?: number;
}): SemanticFact {
  const database = requireDb();
  const id = `fact-${fact.entity.toLowerCase().replace(/[^a-z0-9]/g, '_')}-${fact.attribute.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
  const now = Date.now();
  const expiresAt = fact.expiresInSeconds ? now + fact.expiresInSeconds * 1000 : null;

  const entry: SemanticFact = {
    id,
    entity: fact.entity.trim(),
    attribute: fact.attribute.trim(),
    value: fact.value.trim(),
    confidence: typeof fact.confidence === 'number' ? Math.min(Math.max(fact.confidence, 0), 1) : 1.0,
    scope: fact.scope || 'workspace',
    workspaceRoot: fact.workspaceRoot ?? null,
    tombstoned: false,
    expiresAt,
    createdAt: now,
    updatedAt: now,
    accessCount: 1,
  };

  database
    .prepare(
      `INSERT INTO agent_semantic_facts (id, entity, attribute, value, confidence, scope, workspace_root, tombstoned, expires_at, created_at, updated_at, access_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(id) DO UPDATE SET
         value = excluded.value,
         confidence = excluded.confidence,
         scope = excluded.scope,
         workspace_root = excluded.workspace_root,
         tombstoned = 0,
         expires_at = excluded.expires_at,
         updated_at = excluded.updated_at,
         access_count = agent_semantic_facts.access_count + 1`
    )
    .run(
      entry.id,
      entry.entity,
      entry.attribute,
      entry.value,
      entry.confidence,
      entry.scope,
      entry.workspaceRoot,
      0,
      entry.expiresAt,
      entry.createdAt,
      entry.updatedAt
    );

  return entry;
}

export function getSemanticFacts(opts: {
  workspaceRoot?: string | null;
  entity?: string;
  includeTombstoned?: boolean;
  limit?: number;
} = {}): SemanticFact[] {
  const database = requireDb();
  const now = Date.now();
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);

  let query = 'SELECT * FROM agent_semantic_facts WHERE (expires_at IS NULL OR expires_at > ?)';
  const params: any[] = [now];

  if (!opts.includeTombstoned) {
    query += ' AND tombstoned = 0';
  }

  if (opts.entity) {
    query += ' AND entity = ?';
    params.push(opts.entity);
  }

  if (opts.workspaceRoot) {
    const wsNorm = opts.workspaceRoot.replace(/\\/g, '/');
    query += " AND (workspace_root = ? OR replace(workspace_root, '\\', '/') = ? OR (scope = 'global' AND entity = 'user'))";
    params.push(opts.workspaceRoot, wsNorm);
  }

  query += ' ORDER BY confidence DESC, updated_at DESC LIMIT ?';
  params.push(limit);

  const rows = database.prepare(query).all(...params) as any[];
  return rows.map((r) => ({
    id: r.id,
    entity: r.entity,
    attribute: r.attribute,
    value: r.value,
    confidence: r.confidence,
    scope: r.scope,
    workspaceRoot: r.workspace_root,
    tombstoned: Boolean(r.tombstoned),
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    accessCount: r.access_count,
  }));
}

export function tombstoneSemanticFact(id: string): boolean {
  const database = requireDb();
  const result = database.prepare('UPDATE agent_semantic_facts SET tombstoned = 1, updated_at = ? WHERE id = ?').run(Date.now(), id);
  return result.changes > 0;
}

export function searchSemanticFacts(query: string, workspaceRoot?: string | null): SemanticFact[] {
  const all = getSemanticFacts({ workspaceRoot, limit: 100 });
  if (!query || !query.trim()) return all.slice(0, 10);

  const tokens = tokenizeMemory(normalizeMemoryText(query));
  return all
    .map((fact) => {
      const text = `${fact.entity} ${fact.attribute} ${fact.value}`;
      const factTokens = tokenizeMemory(normalizeMemoryText(text));
      let matches = 0;
      for (const t of tokens) if (factTokens.has(t)) matches++;
      return { fact, score: matches };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.fact.confidence - a.fact.confidence)
    .map((item) => item.fact)
    .slice(0, 10);
}

export function buildSemanticFactsSection(workspaceRoot?: string | null, query?: string): string {
  try {
    const facts = query ? searchSemanticFacts(query, workspaceRoot) : getSemanticFacts({ workspaceRoot, limit: 8 });
    if (facts.length === 0) return '';
    const lines = facts.map((f) => `  * ${f.entity}.${f.attribute}: "${f.value}" (confidence: ${Math.round(f.confidence * 100)}%)`);
    return `[MEMORY TYPE 2: SEMANTIC MEMORY (Persistent Declarative Facts)]:\n${lines.join('\n')}`;
  } catch {
    return '';
  }
}

// ===========================================================================
// TYPE 3: Episodic Memory (Task Trajectories & Reflections)
// ===========================================================================

export function recordEpisodicEpisode(
  episode: Omit<EpisodicEpisode, 'id' | 'createdAt' | 'lastRecalledAt' | 'recallCount' | 'workspaceRoot'> & {
    id?: string;
    workspaceRoot?: string | null;
  }
): EpisodicEpisode {
  const database = requireDb();
  const id = episode.id || `eps-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const now = Date.now();
  const entry: EpisodicEpisode = {
    id,
    taskQuery: episode.taskQuery.trim().slice(0, 500),
    actionSummary: episode.actionSummary.trim().slice(0, 500),
    trajectory: episode.trajectory || [],
    toolsUsed: episode.toolsUsed || [],
    outcome: episode.outcome,
    fitnessScore: Number(episode.fitnessScore.toFixed(3)),
    lessonsLearned: episode.lessonsLearned || [],
    userFeedback: episode.userFeedback,
    reflection: episode.reflection,
    workspaceRoot: episode.workspaceRoot ?? null,
    createdAt: now,
    lastRecalledAt: now,
    recallCount: 0,
  };

  database
    .prepare(
      `INSERT INTO agent_episodic_episodes (id, task_query, action_summary, trajectory, tools_used, outcome, fitness_score, lessons_learned, user_feedback, reflection, workspace_root, created_at, last_recalled_at, recall_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    )
    .run(
      entry.id,
      entry.taskQuery,
      entry.actionSummary,
      JSON.stringify(entry.trajectory),
      JSON.stringify(entry.toolsUsed),
      entry.outcome,
      entry.fitnessScore,
      JSON.stringify(entry.lessonsLearned),
      entry.userFeedback || null,
      entry.reflection || null,
      entry.workspaceRoot,
      entry.createdAt,
      entry.lastRecalledAt
    );

  return entry;
}

export function searchEpisodicEpisodes(query: string, workspaceRoot?: string | null, limit = 3): EpisodicEpisode[] {
  const database = requireDb();
  const wsNorm = workspaceRoot ? workspaceRoot.replace(/\\/g, '/') : null;
  const rows = (
    workspaceRoot
      ? database
          .prepare(
            "SELECT * FROM agent_episodic_episodes WHERE workspace_root = ? OR replace(workspace_root, '\\', '/') = ? ORDER BY last_recalled_at DESC LIMIT 50"
          )
          .all(workspaceRoot, wsNorm)
      : database.prepare('SELECT * FROM agent_episodic_episodes ORDER BY last_recalled_at DESC LIMIT 50').all()
  ) as any[];

  if (rows.length === 0) return [];
  const queryTokens = tokenizeMemory(normalizeMemoryText(query));

  const parsed: EpisodicEpisode[] = rows.map((r) => ({
    id: r.id,
    taskQuery: r.task_query,
    actionSummary: r.action_summary,
    trajectory: safeJsonParse<string[]>(r.trajectory, []),
    toolsUsed: safeJsonParse<string[]>(r.tools_used, []),
    outcome: r.outcome,
    fitnessScore: r.fitness_score,
    lessonsLearned: safeJsonParse<string[]>(r.lessons_learned, []),
    userFeedback: r.user_feedback || undefined,
    reflection: r.reflection || undefined,
    workspaceRoot: r.workspace_root,
    createdAt: r.created_at,
    lastRecalledAt: r.last_recalled_at,
    recallCount: r.recall_count,
  }));

  if (queryTokens.size === 0) return parsed.slice(0, limit);

  return parsed
    .map((ep) => {
      const text = `${ep.taskQuery} ${ep.actionSummary} ${ep.lessonsLearned.join(' ')} ${ep.reflection || ''}`;
      const tokens = tokenizeMemory(normalizeMemoryText(text));
      let matches = 0;
      for (const t of queryTokens) {
        if (tokens.has(t)) matches++;
      }
      return { ep, relevance: matches };
    })
    .filter((item) => item.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || b.ep.fitnessScore - a.ep.fitnessScore)
    .map((item) => item.ep)
    .slice(0, limit);
}

export function touchEpisodicEpisode(id: string): void {
  const database = requireDb();
  database
    .prepare('UPDATE agent_episodic_episodes SET last_recalled_at = ?, recall_count = recall_count + 1 WHERE id = ?')
    .run(Date.now(), id);
}

export function reflectOnEpisode(id: string, reflection: string, extractedLessons: string[] = []): void {
  const database = requireDb();
  database
    .prepare('UPDATE agent_episodic_episodes SET reflection = ?, lessons_learned = ? WHERE id = ?')
    .run(reflection.trim(), JSON.stringify(extractedLessons), id);

  for (const lesson of extractedLessons) {
    try {
      rememberMemory({ kind: 'lesson', content: lesson, autoLesson: true });
    } catch {
      // Non-blocking
    }
  }
}

export function buildEpisodicSection(query?: string, workspaceRoot?: string | null, limit = 2): string {
  try {
    if (!query) return '';
    const episodes = searchEpisodicEpisodes(query, workspaceRoot, limit);
    if (episodes.length === 0) return '';
    const lines = episodes.map((ep) => {
      const lessonSnippet = ep.lessonsLearned.length > 0 ? ` Lessons: ${ep.lessonsLearned.join('; ')}` : '';
      return `  - Episode: "${ep.taskQuery}" [Outcome: ${ep.outcome.toUpperCase()}] -> ${ep.actionSummary}.${lessonSnippet}`;
    });
    return `[MEMORY TYPE 3: EPISODIC MEMORY (Prior Task Trajectories & Post-Mortems)]:\n${lines.join('\n')}`;
  } catch {
    return '';
  }
}

// ===========================================================================
// TYPE 4: Procedural Memory (Verified How-To Execution Recipes)
// ===========================================================================

export function recordProceduralRecipe(
  recipe: Omit<ProceduralRecipe, 'id' | 'createdAt' | 'lastUsedAt' | 'successCount' | 'failureCount' | 'workspaceRoot'> & {
    id?: string;
    workspaceRoot?: string | null;
  }
): ProceduralRecipe {
  const database = requireDb();
  const id = recipe.id || `rec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const now = Date.now();
  const entry: ProceduralRecipe = {
    id,
    name: recipe.name.trim(),
    triggerPattern: recipe.triggerPattern.trim(),
    prerequisites: recipe.prerequisites || [],
    steps: recipe.steps || [],
    verificationAssertions: recipe.verificationAssertions || [],
    successCount: 1,
    failureCount: 0,
    workspaceRoot: recipe.workspaceRoot ?? null,
    createdAt: now,
    lastUsedAt: now,
  };

  database
    .prepare(
      `INSERT INTO agent_procedural_recipes (id, name, trigger_pattern, prerequisites, steps, verification_assertions, success_count, failure_count, workspace_root, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         trigger_pattern = excluded.trigger_pattern,
         prerequisites = excluded.prerequisites,
         steps = excluded.steps,
         verification_assertions = excluded.verification_assertions,
         last_used_at = excluded.last_used_at,
         success_count = agent_procedural_recipes.success_count + 1`
    )
    .run(
      entry.id,
      entry.name,
      entry.triggerPattern,
      JSON.stringify(entry.prerequisites),
      JSON.stringify(entry.steps),
      JSON.stringify(entry.verificationAssertions),
      entry.successCount,
      entry.failureCount,
      entry.workspaceRoot,
      entry.createdAt,
      entry.lastUsedAt
    );

  return entry;
}

export function findProceduralRecipes(query: string, workspaceRoot?: string | null, limit = 3): ProceduralRecipe[] {
  const database = requireDb();
  const rows = (
    workspaceRoot
      ? database
          .prepare(
            'SELECT * FROM agent_procedural_recipes WHERE (workspace_root IS NULL OR workspace_root = ?) ORDER BY last_used_at DESC LIMIT 50'
          )
          .all(workspaceRoot)
      : database.prepare('SELECT * FROM agent_procedural_recipes ORDER BY last_used_at DESC LIMIT 50').all()
  ) as any[];

  if (rows.length === 0) return [];
  const normalizedQuery = normalizeMemoryText(query);
  const queryTokens = tokenizeMemory(normalizedQuery);

  const parsed = rows.map((r) => ({
    id: r.id,
    name: r.name,
    triggerPattern: r.trigger_pattern,
    prerequisites: safeJsonParse<string[]>(r.prerequisites, []),
    steps: safeJsonParse<ProceduralStep[]>(r.steps, []),
    verificationAssertions: safeJsonParse<string[]>(r.verification_assertions, []),
    successCount: r.success_count,
    failureCount: r.failure_count,
    workspaceRoot: r.workspace_root,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  }));

  if (queryTokens.size === 0) return parsed.slice(0, limit);

  return parsed
    .map((recipe) => {
      const text = `${recipe.name} ${recipe.triggerPattern} ${recipe.prerequisites.join(' ')}`;
      const recipeTokens = tokenizeMemory(normalizeMemoryText(text));
      let matches = 0;
      for (const token of queryTokens) {
        if (recipeTokens.has(token)) matches++;
      }
      return { recipe, relevance: matches };
    })
    .filter((item) => item.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || b.recipe.lastUsedAt - a.recipe.lastUsedAt)
    .map((item) => item.recipe)
    .slice(0, limit);
}

export function recordRecipeOutcome(id: string, success: boolean): void {
  const database = requireDb();
  const now = Date.now();
  if (success) {
    database
      .prepare('UPDATE agent_procedural_recipes SET success_count = success_count + 1, last_used_at = ? WHERE id = ?')
      .run(now, id);
  } else {
    database
      .prepare('UPDATE agent_procedural_recipes SET failure_count = failure_count + 1, last_used_at = ? WHERE id = ?')
      .run(now, id);
  }
}

export function buildProceduralSection(query?: string, workspaceRoot?: string | null, limit = 2): string {
  try {
    const recipes = findProceduralRecipes(query || '', workspaceRoot, limit);
    if (recipes.length === 0) return '';
    const formatted = recipes.map((r) => {
      const stepLines = r.steps.map((s) => `    ${s.order}. ${s.tool ? `[${s.tool}] ` : ''}${s.description}`);
      return `  - Recipe: "${r.name}" (Trigger: ${r.triggerPattern})\n    Steps:\n${stepLines.join('\n')}${r.verificationAssertions.length > 0 ? `\n    Verify: ${r.verificationAssertions.join(', ')}` : ''}`;
    });
    return `PROCEDURAL MEMORY (Verified How-To Execution Workflows):\n${formatted.join('\n')}`;
  } catch {
    return '';
  }
}

// ===========================================================================
// TYPE 5: External / Retrieval Memory Coordinator
// ===========================================================================

export function performHybridRetrieval(
  query: string,
  sources: Array<'ast_symbol' | 'workspace_file' | 'doc' | 'memory'> = ['memory', 'ast_symbol'],
  limit = 5
): RetrievalResult[] {
  const results: RetrievalResult[] = [];
  const normalized = normalizeMemoryText(query);

  if (sources.includes('memory')) {
    const memoryMatches = searchMemories({ query: normalized, limit: 3 });
    for (const m of memoryMatches) {
      results.push({
        source: 'memory',
        title: `Memory: ${m.kind}`,
        snippet: m.content,
        score: 0.9,
      });
    }
  }

  return results.slice(0, limit);
}

export function buildRetrievalMemorySection(query?: string): string {
  if (!query || !query.trim()) return '';
  const retrieved = performHybridRetrieval(query, ['memory'], 3);
  if (retrieved.length === 0) return '';
  const lines = retrieved.map((r) => `  * [${r.source.toUpperCase()}] ${r.title}: "${r.snippet}"`);
  return `[MEMORY TYPE 5: EXTERNAL / RETRIEVAL MEMORY]:\n${lines.join('\n')}`;
}

// ===========================================================================
// TYPE 6: Parametric Memory (Pretrained Model Bounds & Calibration)
// ===========================================================================

export function getParametricMemoryProfile(modelId?: string, provider?: string): ParametricMemoryProfile {
  const id = (modelId || '').toLowerCase();
  const prov = (provider || '').toLowerCase();

  let tier: 'FRONTIER' | 'BALANCED' | 'COMPACT_WEAK' = 'BALANCED';
  let contextWindow = 128000;
  let parametricStrengths = ['TypeScript', 'Node.js', 'React', 'Python', 'Architectural Refactoring'];
  let knownWeaknesses = ['Real-time clock dates without tool assistance', 'Direct execution without sandbox'];
  let calibrationNotes = 'Standard balanced reasoning and tool call profile.';

  if (id.includes('claude-3-7') || id.includes('gpt-5') || id.includes('gemini-2.5-pro') || id.includes('deepseek-r1') || id.includes('antigravity')) {
    tier = 'FRONTIER';
    contextWindow = 200000;
    parametricStrengths = ['TypeScript', 'Node.js', 'React', 'Python', 'Deep extended reasoning', 'Massive parallel tool dispatch', 'Complex architectural invariants'];
    knownWeaknesses = ['Real-time clock dates without tool assistance'];
    calibrationNotes = 'Frontier capability profile active. Full multi-step autonomy enabled.';
  } else if (id.includes('llama-3.1-8b') || id.includes('qwen2.5-7b') || (prov === 'groq' && id.includes('8b'))) {
    tier = 'COMPACT_WEAK';
    contextWindow = 8192;
    parametricStrengths = ['Single-file edits', 'Basic scripting'];
    knownWeaknesses = ['High-entropy multi-tool calling', 'Long transcript retention'];
    calibrationNotes = 'Compact profile active: strict step-by-step checklist and tight tool schema enforced.';
  }

  return {
    modelId: modelId || 'default',
    provider: provider || 'sutra',
    capabilityTier: tier,
    contextWindow,
    parametricStrengths,
    knownWeaknesses,
    calibrationNotes,
  };
}

export function buildParametricSection(modelId?: string, provider?: string): string {
  const profile = getParametricMemoryProfile(modelId, provider);
  return `[MEMORY TYPE 6: PARAMETRIC MEMORY (Model Profile & Bounds)]:
  - Model Tier: ${profile.capabilityTier} (Context: ${Math.round(profile.contextWindow / 1000)}k tokens)
  - Calibration: ${profile.calibrationNotes}
  - Boundary: Rely on workspace tools for live state rather than parametric memory assumptions.`;
}

// ===========================================================================
// TYPE 7: Prospective Memory ("Remembering the Future")
// ===========================================================================

export function scheduleProspectiveTask(task: {
  taskDescription: string;
  triggerType: 'time' | 'event' | 'condition' | 'interval';
  triggerCondition: string;
  payload?: Record<string, any>;
  workspaceRoot?: string | null;
  dueAt: number;
}): ProspectiveTask {
  const database = requireDb();
  const id = `prosp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const now = Date.now();

  const entry: ProspectiveTask = {
    id,
    taskDescription: task.taskDescription.trim(),
    triggerType: task.triggerType,
    triggerCondition: task.triggerCondition.trim(),
    payload: task.payload,
    status: 'pending',
    workspaceRoot: task.workspaceRoot ?? null,
    dueAt: task.dueAt,
    createdAt: now,
    completedAt: null,
  };

  database
    .prepare(
      `INSERT INTO agent_prospective_tasks (id, task_description, trigger_type, trigger_condition, payload, status, workspace_root, due_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      entry.id,
      entry.taskDescription,
      entry.triggerType,
      entry.triggerCondition,
      JSON.stringify(entry.payload || {}),
      entry.status,
      entry.workspaceRoot,
      entry.dueAt,
      entry.createdAt
    );

  return entry;
}

export function listPendingProspectiveTasks(opts: { workspaceRoot?: string | null; limit?: number } = {}): ProspectiveTask[] {
  const database = requireDb();
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);

  const rows = (
    opts.workspaceRoot
      ? database
          .prepare(
            "SELECT * FROM agent_prospective_tasks WHERE status = 'pending' AND (workspace_root IS NULL OR workspace_root = ?) ORDER BY due_at ASC LIMIT ?"
          )
          .all(opts.workspaceRoot, limit)
      : database.prepare("SELECT * FROM agent_prospective_tasks WHERE status = 'pending' ORDER BY due_at ASC LIMIT ?").all(limit)
  ) as any[];

  return rows.map((r) => ({
    id: r.id,
    taskDescription: r.task_description,
    triggerType: r.trigger_type,
    triggerCondition: r.trigger_condition,
    payload: safeJsonParse<Record<string, any>>(r.payload, {}),
    status: r.status,
    workspaceRoot: r.workspace_root,
    dueAt: r.due_at,
    createdAt: r.created_at,
    completedAt: r.completed_at,
  }));
}

export function checkAndTriggerProspectiveTasks(now = Date.now(), workspaceRoot?: string | null): ProspectiveTask[] {
  const database = requireDb();
  const pending = listPendingProspectiveTasks({ workspaceRoot, limit: 50 });
  const due = pending.filter((t) => t.dueAt <= now);

  const stmt = database.prepare("UPDATE agent_prospective_tasks SET status = 'active' WHERE id = ?");
  for (const t of due) {
    stmt.run(t.id);
    t.status = 'active';
  }

  return due;
}

export function completeProspectiveTask(id: string): boolean {
  const database = requireDb();
  const result = database
    .prepare("UPDATE agent_prospective_tasks SET status = 'completed', completed_at = ? WHERE id = ?")
    .run(Date.now(), id);
  return result.changes > 0;
}

export function cancelProspectiveTask(id: string): boolean {
  const database = requireDb();
  const result = database.prepare("UPDATE agent_prospective_tasks SET status = 'cancelled' WHERE id = ?").run(id);
  return result.changes > 0;
}

export function buildProspectiveSection(workspaceRoot?: string | null): string {
  try {
    const tasks = listPendingProspectiveTasks({ workspaceRoot, limit: 3 });
    if (tasks.length === 0) return '';
    const lines = tasks.map(
      (t) => `  * [Due in ${Math.max(0, Math.round((t.dueAt - Date.now()) / 1000))}s] ${t.taskDescription} (trigger: ${t.triggerType} -> ${t.triggerCondition})`
    );
    return `[MEMORY TYPE 7: PROSPECTIVE MEMORY ("Remembering the Future" / Scheduled To-Dos)]:\n${lines.join('\n')}`;
  } catch {
    return '';
  }
}

// ===========================================================================
// Comprehensive 7-Type Cognitive Memory Section Builder
// ===========================================================================

export function buildMemorySection(
  workspaceRoot: string | null,
  limit = 12,
  userQuery?: string,
  chatId?: string
): { text: string; usedIds: number[] } {
  let memories: MemoryEntry[] = [];
  try {
    const capped = Math.min(Math.max(limit, 1), MEMORY_SECTION_CAP);
    if (userQuery && userQuery.trim()) {
      memories = searchMemories({ query: userQuery, workspaceRoot, limit: capped });
    } else {
      memories = listMemories({ workspaceRoot, limit: capped });
    }
  } catch {
    return { text: '', usedIds: [] };
  }

  if (memories.length === 0 && !userQuery && !chatId) {
    return { text: '', usedIds: [] };
  }

  const sections: string[] = [];

  // Type 1: Working Memory — active context, subgoals, invariants
  if (chatId) {
    const wmText = buildWorkingMemorySection(chatId, workspaceRoot);
    if (wmText) sections.push(wmText);
  }

  // Type 2: Semantic Memory — entity/attribute facts, user preferences
  const semText = buildSemanticFactsSection(workspaceRoot, userQuery);
  if (semText) sections.push(semText);

  // Type 3: Episodic Memory — past run trajectories & lessons
  if (userQuery) {
    const epsText = buildEpisodicSection(userQuery, workspaceRoot, 2);
    if (epsText) sections.push(epsText);
  }

  // Type 4: Procedural Memory — reusable recipes / standard operating
  // procedures indexed by trigger pattern
  if (userQuery) {
    const procText = buildProceduralSection(userQuery, workspaceRoot, 2);
    if (procText) sections.push(procText);
  }

  // Type 5: External / Retrieval Memory — hybrid multi-index slice
  // (AST symbols, file topology, keyword matches, vector similarity).
  if (userQuery) {
    const retrText = buildRetrievalMemorySection(userQuery);
    if (retrText) sections.push(retrText);
  }

  // Type 6: Parametric Memory — model-tier calibration, capability
  // boundaries, and context budget hint so the agent doesn't over-promise
  // what the active model can deliver.
  const paramText = buildParametricSection();
  if (paramText) sections.push(paramText);

  // Type 7: Prospective Memory — scheduled follow-ups, delayed
  // verifications, cron tasks the agent should remember to do later
  const prospText = buildProspectiveSection(workspaceRoot);
  if (prospText) sections.push(prospText);

  // Classic Labeled Memories (Lessons & Preferences)
  if (memories.length > 0) {
    const kindRank: Record<MemoryKind, number> = {
      preference: 0,
      fact: 1,
      architecture: 2,
      semantic: 3,
      lesson: 4,
      episodic: 5,
      procedural: 6,
      prospective: 7,
    };
    memories.sort((a, b) => (kindRank[a.kind] ?? 4) - (kindRank[b.kind] ?? 4));

    const label: Record<MemoryKind, string> = {
      lesson: 'Lesson',
      preference: 'User preference',
      fact: 'Fact',
      architecture: 'Architecture',
      semantic: 'Semantic Invariant',
      episodic: 'Past Episode',
      procedural: 'Procedural Recipe',
      prospective: 'Prospective Item',
    };
    const lines = memories.map((m) => `- [${label[m.kind] || 'Memory'}] ${m.content}`);
    const header =
      'LONG-TERM COGNITIVE MEMORY (Semantic Facts & Verified Lessons):\n' +
      'Lessons and architecture patterns describe verified facts and solutions. Apply them directly.';
    sections.push(`${header}\n${lines.join('\n')}`);
  }

  if (sections.length === 0) return { text: '', usedIds: [] };
  return { text: sections.join('\n\n'), usedIds: memories.map((m) => m.id) };
}

// Unified Agent Memory Engine Export
export const AgentMemoryEngine = {
  working: {
    get: getWorkingMemory,
    update: updateWorkingMemory,
    clear: clearWorkingMemory,
    buildSection: buildWorkingMemorySection,
  },
  semantic: {
    store: storeSemanticFact,
    list: getSemanticFacts,
    search: searchSemanticFacts,
    tombstone: tombstoneSemanticFact,
    buildSection: buildSemanticFactsSection,
  },
  episodic: {
    record: recordEpisodicEpisode,
    search: searchEpisodicEpisodes,
    touch: touchEpisodicEpisode,
    reflect: reflectOnEpisode,
    buildSection: buildEpisodicSection,
  },
  procedural: {
    record: recordProceduralRecipe,
    find: findProceduralRecipes,
    recordOutcome: recordRecipeOutcome,
    buildSection: buildProceduralSection,
  },
  retrieval: {
    perform: performHybridRetrieval,
    buildSection: buildRetrievalMemorySection,
  },
  parametric: {
    getProfile: getParametricMemoryProfile,
    buildSection: buildParametricSection,
  },
  prospective: {
    schedule: scheduleProspectiveTask,
    list: listPendingProspectiveTasks,
    checkDue: checkAndTriggerProspectiveTasks,
    complete: completeProspectiveTask,
    cancel: cancelProspectiveTask,
    buildSection: buildProspectiveSection,
  },
  buildComprehensiveSection: buildMemorySection,
};

function rowToEntry(row: any): MemoryEntry {
  return {
    id: Number(row.id),
    kind: row.kind,
    content: row.content,
    workspaceRoot: row.workspace_root ?? null,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    useCount: row.use_count,
  };
}
