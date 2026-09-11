/**
 * Inline Diff Engine for Streaming Code Changes
 * Generates unified diff format for Monaco editor decorations
 */

import * as diff from 'diff';

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  changes: DiffChange[];
}

export interface DiffChange {
  type: 'add' | 'remove' | 'context';
  content: string;
  lineNumber: number;
}

export interface InlineDiff {
  filePath: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  oldContent: string;
  newContent: string;
}

export class InlineDiffEngine {
  /**
   * Generate structured diff between old and new content
   */
  generateDiff(filePath: string, oldContent: string, newContent: string): InlineDiff {
    const patches = diff.structuredPatch(
      filePath,
      filePath,
      oldContent,
      newContent,
      'Original',
      'Modified'
    );

    const hunks: DiffHunk[] = patches.hunks.map((hunk) => {
      const changes: DiffChange[] = [];
      let currentLineNumber = hunk.oldStart;

      hunk.lines.forEach((line) => {
        const type = line[0];
        const content = line.substring(1);

        if (type === '+') {
          changes.push({
            type: 'add',
            content,
            lineNumber: currentLineNumber,
          });
        } else if (type === '-') {
          changes.push({
            type: 'remove',
            content,
            lineNumber: currentLineNumber,
          });
          currentLineNumber++;
        } else {
          changes.push({
            type: 'context',
            content,
            lineNumber: currentLineNumber,
          });
          currentLineNumber++;
        }
      });

      return {
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        changes,
      };
    });

    // Count additions and deletions
    let additions = 0;
    let deletions = 0;
    hunks.forEach((hunk) => {
      hunk.changes.forEach((change) => {
        if (change.type === 'add') additions++;
        if (change.type === 'remove') deletions++;
      });
    });

    return {
      filePath,
      hunks,
      additions,
      deletions,
      oldContent,
      newContent,
    };
  }

  /**
   * Generate Monaco editor decoration ranges for diff visualization
   */
  generateMonacoDecorations(inlineDiff: InlineDiff): {
    additions: Array<{ startLine: number; endLine: number; content: string }>;
    deletions: Array<{ startLine: number; endLine: number; content: string }>;
  } {
    const additions: Array<{ startLine: number; endLine: number; content: string }> = [];
    const deletions: Array<{ startLine: number; endLine: number; content: string }> = [];

    inlineDiff.hunks.forEach((hunk) => {
      let currentAddStart: number | null = null;
      let currentAddContent: string[] = [];
      let currentDelStart: number | null = null;
      let currentDelContent: string[] = [];

      hunk.changes.forEach((change, index) => {
        if (change.type === 'add') {
          if (currentAddStart === null) {
            currentAddStart = change.lineNumber;
          }
          currentAddContent.push(change.content);

          // Check if next change is not an addition
          const nextChange = hunk.changes[index + 1];
          if (!nextChange || nextChange.type !== 'add') {
            additions.push({
              startLine: currentAddStart,
              endLine: change.lineNumber,
              content: currentAddContent.join('\n'),
            });
            currentAddStart = null;
            currentAddContent = [];
          }
        } else if (change.type === 'remove') {
          if (currentDelStart === null) {
            currentDelStart = change.lineNumber;
          }
          currentDelContent.push(change.content);

          const nextChange = hunk.changes[index + 1];
          if (!nextChange || nextChange.type !== 'remove') {
            deletions.push({
              startLine: currentDelStart,
              endLine: change.lineNumber,
              content: currentDelContent.join('\n'),
            });
            currentDelStart = null;
            currentDelContent = [];
          }
        }
      });
    });

    return { additions, deletions };
  }

  /**
   * Generate unified diff string (Git-style diff format)
   */
  generateUnifiedDiff(filePath: string, oldContent: string, newContent: string): string {
    return diff.createPatch(filePath, oldContent, newContent, 'Original', 'Modified');
  }

  /**
   * Apply diff to original content
   */
  applyDiff(originalContent: string, unifiedDiff: string): string {
    const patches = diff.parsePatch(unifiedDiff);
    if (patches.length === 0) return originalContent;

    const result = diff.applyPatch(originalContent, patches[0]);
    return typeof result === 'string' ? result : originalContent;
  }

  /**
   * Format diff summary for display
   */
  formatDiffSummary(inlineDiff: InlineDiff): string {
    return `${inlineDiff.filePath}: +${inlineDiff.additions} -${inlineDiff.deletions} (${inlineDiff.hunks.length} hunk${inlineDiff.hunks.length !== 1 ? 's' : ''})`;
  }
}

export const inlineDiffEngine = new InlineDiffEngine();
