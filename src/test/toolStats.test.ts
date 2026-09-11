import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  initToolStats,
  recordToolOutcome,
  listToolStats,
  buildToolStatsSection,
} from '../../server/harness/toolStats.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  initToolStats(db);
});

describe('toolStats', () => {
  it('accumulates ok/fail counts per tool', () => {
    recordToolOutcome('read_file', true);
    recordToolOutcome('read_file', true);
    recordToolOutcome('read_file', false);
    const stats = listToolStats();
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ tool: 'read_file', ok: 2, fail: 1 });
  });

  it('ignores empty tool names', () => {
    recordToolOutcome('', true);
    recordToolOutcome('   ', true);
    expect(listToolStats()).toHaveLength(0);
  });

  it('orders by total attempts descending', () => {
    recordToolOutcome('a_tool', true);
    for (let i = 0; i < 5; i++) recordToolOutcome('b_tool', true);
    const stats = listToolStats();
    expect(stats[0].tool).toBe('b_tool');
    expect(stats[1].tool).toBe('a_tool');
  });

  it('omits tools with fewer than the minimum attempts from the prompt section', () => {
    recordToolOutcome('new_tool', false);
    recordToolOutcome('new_tool', false);
    expect(buildToolStatsSection()).toBe('');
  });

  it('warns about low-success tools once they have enough attempts', () => {
    for (let i = 0; i < 2; i++) recordToolOutcome('shell_run', true);
    for (let i = 0; i < 8; i++) recordToolOutcome('shell_run', false);
    const section = buildToolStatsSection();
    expect(section).toContain('shell_run');
    expect(section).toContain('20% success');
  });

  it('stays silent when every tool is healthy', () => {
    for (let i = 0; i < 10; i++) recordToolOutcome('read_file', true);
    expect(buildToolStatsSection()).toBe('');
  });
});
