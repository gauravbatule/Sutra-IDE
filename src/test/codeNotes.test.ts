import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initCodeNotes, saveCodeNote, deleteCodeNote, listCodeNotes, touchCodeNotes, buildCodeNotesSection } from '../../server/harness/codeNotes.js';

describe('codeNotes', () => {
  beforeEach(() => {
    initCodeNotes(new Database(':memory:'));
  });

  it('saves and lists notes with normalized paths', () => {
    expect(saveCodeNote('src\\app.tsx', 'Root component; renders Layout + router.')).toBe(true);
    const notes = listCodeNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].filePath).toBe('src/app.tsx');
    expect(notes[0].note).toContain('router');
  });

  it('upserts by path and truncates oversized notes', () => {
    saveCodeNote('a.ts', 'first');
    saveCodeNote('a.ts', 'second');
    saveCodeNote('b.ts', 'x'.repeat(500));
    const notes = listCodeNotes();
    const a = notes.find((n) => n.filePath === 'a.ts');
    const b = notes.find((n) => n.filePath === 'b.ts');
    expect(a?.note).toBe('second');
    expect(b?.note.length).toBe(400);
    expect(notes).toHaveLength(2);
  });

  it('rejects empty inputs and deletes existing notes', () => {
    expect(saveCodeNote('', 'note')).toBe(false);
    expect(saveCodeNote('x.ts', '  ')).toBe(false);
    saveCodeNote('x.ts', 'keep me');
    expect(deleteCodeNote('x.ts')).toBe(true);
    expect(deleteCodeNote('x.ts')).toBe(false);
    expect(listCodeNotes()).toHaveLength(0);
  });

  it('builds a capped recall section, priority paths first', () => {
    for (let i = 0; i < 40; i++) {
      saveCodeNote(`gen/file${i}.ts`, `note ${i}`);
    }
    saveCodeNote('hot/target.ts', 'the important one');
    const section = buildCodeNotesSection({ priorityPaths: ['hot\\target.ts'] });
    const lines = section.split('\n').filter((l) => l.startsWith('- '));
    expect(lines.length).toBeLessThanOrEqual(30);
    expect(lines[0]).toContain('hot/target.ts');
    expect(lines[0]).toContain('the important one');
  });

  it('returns empty section when no notes exist', () => {
    expect(buildCodeNotesSection()).toBe('');
  });

  it('touch bumps use counts without failing on unknown paths', () => {
    saveCodeNote('used.ts', 'often read');
    expect(() => touchCodeNotes(['used.ts', 'missing.ts', '', 'used.ts'])).not.toThrow();
    expect(listCodeNotes()[0].useCount).toBe(1);
  });
});
