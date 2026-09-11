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
    const normOld = (oldContent ?? '').replace(/\r\n/g, '\n');
    const normNew = (newContent ?? '').replace(/\r\n/g, '\n');
    const patches = diff.structuredPatch(
      filePath,
      filePath,
      normOld,
      normNew,
      'Original',
      'Modified'
    );

    const hunks: DiffHunk[] = patches.hunks.map((hunk) => {
      const changes: DiffChange[] = [];
      let oldLineNumber = hunk.oldStart;
      let newLineNumber = hunk.newStart;

      hunk.lines.forEach((line) => {
        const type = line[0];
        const content = line.substring(1);

        if (type === '+') {
          changes.push({
            type: 'add',
            content,
            lineNumber: newLineNumber,
          });
          newLineNumber++;
        } else if (type === '-') {
          changes.push({
            type: 'remove',
            content,
            lineNumber: oldLineNumber,
          });
          oldLineNumber++;
        } else {
          changes.push({
            type: 'context',
            content,
            lineNumber: newLineNumber,
          });
          oldLineNumber++;
          newLineNumber++;
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
    const isCRLF = (originalContent || '').includes('\r\n');
    const normOriginal = (originalContent ?? '').replace(/\r\n/g, '\n');
    const normDiff = (unifiedDiff ?? '').replace(/\r\n/g, '\n');
    const patches = diff.parsePatch(normDiff);
    if (patches.length === 0) return originalContent;

    const result = diff.applyPatch(normOriginal, patches[0]);
    if (typeof result !== 'string') return originalContent;
    return isCRLF ? result.replace(/\n/g, '\r\n') : result;
  }

  /**
   * Format diff summary for display
   */
  formatDiffSummary(inlineDiff: InlineDiff): string {
    return `${inlineDiff.filePath}: +${inlineDiff.additions} -${inlineDiff.deletions} (${inlineDiff.hunks.length} hunk${inlineDiff.hunks.length !== 1 ? 's' : ''})`;
  }
}

export interface AntiStubbingResult {
  hasStub: boolean;
  stubMarkers: string[];
  warning?: string;
}

/**
 * Detects lazy LLM placeholder markers (e.g. // ... existing code ...) that destroy real business logic
 */
export function detectStubbingMarkers(content: string): AntiStubbingResult {
  if (!content || typeof content !== 'string') return { hasStub: false, stubMarkers: [] };

  const stubPatterns = [
    /\/\/\s*\.\.\.\s*existing\s+code\b/i,
    /\/\/\s*\.\.\.\s*rest\s+of\s+code\b/i,
    /\/\/\s*\.\.\.\s*remain(?:s|ing)?\s+unchanged\b/i,
    /\/\/\s*\.\.\.\s*previous\s+code\b/i,
    /\/\*\s*\.\.\.\s*existing\s+code[\s\S]*?\*\//i,
    /\/\*\s*implement\s+(?:the\s+)?rest[\s\S]*?\*\//i,
    /\/\/\s*TODO:\s*(?:add|implement)\s+(?:rest|remaining|the\s+rest)\b/i,
    /\/\/\s*keep\s+existing\s+(?:implementation|code|methods)\b/i,
    /\/\*\s*\.\.\.\s*\*\//,
    /\/\/\s*\.\.\.\s*same\s+as\s+before\b/i,
  ];

  const markers: string[] = [];
  for (const pattern of stubPatterns) {
    const match = content.match(pattern);
    if (match) {
      markers.push(match[0]);
    }
  }

  if (markers.length > 0) {
    return {
      hasStub: true,
      stubMarkers: markers,
      warning: `Destructive stub placeholder detected: "${markers.join('", "')}". Provide complete implementations without lazy placeholders.`,
    };
  }

  return { hasStub: false, stubMarkers: [] };
}

/**
 * Validates that an edit is non-destructive and doesn't accidentally erase code
 */
export function validateNonDestructiveEdit(oldContent: string, newContent: string): {
  safe: boolean;
  reason?: string;
} {
  const stubCheck = detectStubbingMarkers(newContent);
  if (stubCheck.hasStub) {
    return { safe: false, reason: stubCheck.warning };
  }

  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  if (oldLines.length > 40 && newLines.length < oldLines.length * 0.25) {
    if (newContent.length < 300 && oldContent.length > 1500) {
      return {
        safe: false,
        reason: `Destructive truncation alert: replacing ${oldLines.length} lines with ${newLines.length} lines. Use surgical line-range edits instead of truncating existing code.`,
      };
    }
  }

  return { safe: true };
}

export const inlineDiffEngine = new InlineDiffEngine();

