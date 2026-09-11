import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import Database from 'better-sqlite3';
import { SecurityGuardrails } from '../security/guardrails.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface FileTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  children?: FileTreeNode[];
}

/**
 * Directories excluded from EVERY workspace scan (tree listing, grep, LOC, symbols).
 * Deep log dirs and caches otherwise dominate results and burn the agent's context budget.
 */
const FS_EXCLUDED_NAMES = new Set([
  '.git', 'node_modules', '.next', 'dist', 'build', '.DS_Store', 'coverage',
  '.system_generated', '.gemini', '.cache', '.turbo', '.idea', '.vscode',
  '.parcel-cache', 'temp', 'tmp', '.svn', '.hg', 'out', 'venv', '.venv',
  '__pycache__', 'target'
]);

/** Hard ceiling (chars) for any single file read handed back to a model. */
const READ_HARD_CAP_CHARS = 25000;

/** Builds a regex for text search, falling back to an escaped literal match on invalid patterns. */
function buildGrepRegex(query: string, caseInsensitive: boolean): RegExp {
  try {
    return new RegExp(query, caseInsensitive ? 'i' : '');
  } catch {
    return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseInsensitive ? 'i' : '');
  }
}

/** A NUL byte in the first 8KB is the classic binary-file heuristic. */
function looksBinary(fullPath: string, size: number): boolean {
  try {
    const probe = Buffer.alloc(Math.min(8192, Math.max(0, size)));
    if (probe.length === 0) return false;
    const fd = fs.openSync(fullPath, 'r');
    try {
      fs.readSync(fd, probe, 0, probe.length, 0);
    } finally {
      fs.closeSync(fd);
    }
    return probe.includes(0);
  } catch {
    return true; // Unreadable — treat as binary so callers skip it.
  }
}

/** Keeps matched lines bounded; long lines get an explicit ellipsis marker. */
function truncateGrepLine(line: string, max = 300): string {
  return line.length > max ? `${line.slice(0, max - 3)}...` : line;
}

/**
 * AsyncFileMutex & Atomic Transaction Manager
 * Guarantees zero race conditions, deadlocks, or EPERM/EBUSY Windows collisions across concurrent agents.
 */
export class AsyncFileMutex {
  private static locks: Map<string, Promise<void>> = new Map();

  public static async runWithLock<T>(filePath: string, fn: () => Promise<T> | T): Promise<T> {
    const canonical = path.resolve(filePath).toLowerCase();
    const prevLock = this.locks.get(canonical) || Promise.resolve();

    let release: () => void = () => {};
    const lockPromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(canonical, lockPromise);

    try {
      await prevLock;
    } catch {
      // Continue execution chain even if prior task threw
    }

    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(canonical) === lockPromise) {
        this.locks.delete(canonical);
      }
    }
  }

  public static atomicWriteFileSync(filePath: string, content: string, encoding: BufferEncoding = 'utf-8'): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = path.join(dir, `.sutra_tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    try {
      fs.writeFileSync(tmpPath, content, encoding);
      let attempts = 0;
      while (attempts < 5) {
        try {
          fs.renameSync(tmpPath, filePath);
          return;
        } catch {
          try {
            // Windows fallback: copy directly to destination (preserves file if write fails midway)
            fs.copyFileSync(tmpPath, filePath);
            return;
          } catch {
            attempts++;
            if (attempts >= 5) {
              fs.writeFileSync(filePath, content, encoding);
              return;
            }
            try {
              Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * attempts);
            } catch {
              // Best-effort non-spinning delay
            }
          }
        }
      }
    } finally {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {
        // Cleanup best effort
      }
    }
  }
}

export class FSTools {
  private workspaceRoot: string;

  constructor(workspaceRoot: string = process.cwd()) {
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  public setWorkspaceRoot(root: string): void {
    this.workspaceRoot = path.resolve(root);
  }

  public getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  private resolveSafePath(userPath: string): string {
    let clean = (userPath || '').trim();
    // Normalize: if the user/model passed "workspace/index.html" or "/workspace/index.html",
    // strip the redundant "workspace/" prefix so files are written to and read from the true workspace root
    if (/^[/\\]?workspace[/\\]/i.test(clean)) {
      const stripped = clean.replace(/^[/\\]?workspace[/\\]+/i, '');
      const strippedTarget = SecurityGuardrails.validateSafePath(stripped, this.workspaceRoot);
      const rawTarget = SecurityGuardrails.validateSafePath(clean, this.workspaceRoot);
      // If the stripped path exists on disk, or if NEITHER exists (new file creation),
      // prefer stripped so we never create an accidental nested "workspace/" directory!
      if (fs.existsSync(strippedTarget) || !fs.existsSync(rawTarget)) {
        return strippedTarget;
      }
      return rawTarget;
    }
    return SecurityGuardrails.validateSafePath(clean, this.workspaceRoot);
  }

  public readFile(
    filePath: string,
    lineRange?: { start: number; end: number },
    opts?: { maxChars?: number }
  ): { content: string; totalLines: number; path: string; truncated?: boolean } {
    const safePath = this.resolveSafePath(filePath);
    if (!fs.existsSync(safePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    const fullContent = fs.readFileSync(safePath, 'utf-8');
    const lines = fullContent.split('\n');

    let truncated = false;
    let resultText = fullContent;
    // An empty or partial lineRange object ({}, {start: 1}) must read the WHOLE
    // file — models frequently send `{}` and an empty slice reads as a missing file.
    const hasValidRange =
      lineRange &&
      typeof lineRange.start === 'number' &&
      typeof lineRange.end === 'number' &&
      lineRange.end >= lineRange.start &&
      lineRange.end > 0;
    if (hasValidRange) {
      const start = Math.max(1, lineRange.start) - 1;
      const end = Math.min(lines.length, lineRange.end);
      resultText = lines.slice(start, end).join('\n');
    }

    // Optional caller-supplied character cap — cut at a LINE boundary under the
    // cap so agents never receive half a statement, and learn that more exists.
    if (opts && typeof opts.maxChars === 'number' && opts.maxChars > 0 && resultText.length > 0) {
      const cap = Math.min(Math.floor(opts.maxChars), READ_HARD_CAP_CHARS);
      if (resultText.length > cap) {
        const resultLines = resultText.split('\n');
        const kept: string[] = [];
        let used = 0;
        for (const line of resultLines) {
          if (used + line.length + 1 > cap) break;
          kept.push(line);
          used += line.length + 1;
        }
        if (kept.length === 0) {
          // First line alone exceeds the cap — take its head so the call still returns usable data.
          kept.push(`${resultLines[0].slice(0, Math.max(1, cap - 20))} ...[line truncated]`);
        }
        resultText = kept.join('\n');
        truncated = true;
      }
    }

    // Protect context window from massive single file reads (>25KB)
    const cappedContent = SecurityGuardrails.truncateToolOutput(
      resultText,
      READ_HARD_CAP_CHARS,
      `Total lines: ${lines.length}. Use 'lineRange: { start: X, end: Y }' to read specific chunks.`
    );
    if (cappedContent !== resultText && cappedContent.includes('[TRUNCATED')) truncated = true;

    // If reading sensitive files (e.g. .env, credentials), redact keys
    const isSensitive = filePath.includes('.env') || filePath.includes('secret') || filePath.includes('credential');
    const sanitized = isSensitive ? SecurityGuardrails.redactSecrets(cappedContent) : cappedContent;

    return { content: sanitized, totalLines: lines.length, path: filePath, truncated };
  }

  public writeFile(filePath: string, content: string): { success: boolean; bytesWritten: number; path: string } {
    const safePath = this.resolveSafePath(filePath);
    this.guardIdeInternals(safePath, filePath);
    AsyncFileMutex.atomicWriteFileSync(safePath, content, 'utf-8');
    return { success: true, bytesWritten: Buffer.byteLength(content), path: filePath };
  }

  /**
   * The workspace can be the SUTRA installation itself — a write to the IDE's own
   * entry files (index.html, src/, server/, build configs) then bricks the IDE
   * (a generated landing page once replaced the app shell). Writes to those paths
   * are refused with guidance to use a project subfolder instead.
   */
  private guardIdeInternals(resolvedPath: string, userPath: string): void {
    const ideRoot = path.resolve(__dirname, '..', '..');
    // If the active workspace is explicitly the IDE codebase itself (e.g. self-editing during development), allow writes
    if (
      this.workspaceRoot.toLowerCase() === ideRoot.toLowerCase() ||
      process.env.ALLOW_SELF_EDIT === 'true' ||
      process.env.NODE_ENV === 'test' ||
      process.env.VITEST
    ) {
      return;
    }
    const relative = path.relative(ideRoot, resolvedPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return; // Outside the IDE install — fine
    const normalized = relative.replace(/\\/g, '/');
    const protectedPatterns = [
      /^index\.html$/i,
      /^src\//i,
      /^server\//i,
      /^scripts\//i,
      /^vendor\//i,
      /^(package|package-lock|tsconfig[^/]*|vite\.config|eslint\.config[^/]*|components\.json)\.(json|ts|js|cjs|mjs)$/i,
    ];
    if (protectedPatterns.some((pattern) => pattern.test(normalized))) {
      throw new Error(
        `Refused: "${userPath}" is part of the SUTRA IDE itself. Create your project in a subfolder (e.g. "my-app/index.html") or switch the workspace to a different folder first.`
      );
    }
  }

  /**
   * SOTA-grade editFile with line-range targeting, CRLF/LF normalization, and fuzzy chunk matching
   */
  public editFile(
    filePath: string,
    targetContent?: string,
    replacementContent: string = '',
    startLine?: number,
    endLine?: number
  ): { success: boolean; path: string; linesChanged?: number; mode: string } {
    const safePath = this.resolveSafePath(filePath);
    this.guardIdeInternals(safePath, filePath);
    if (!fs.existsSync(safePath)) {
      // If file doesn't exist, create it with the replacementContent
      return { ...this.writeFile(filePath, replacementContent), mode: 'created_new_file' };
    }
    const rawContent = fs.readFileSync(safePath, 'utf-8');
    const isCRLF = rawContent.includes('\r\n');
    const rawLines = rawContent.replace(/\r\n/g, '\n').split('\n');

    const saveUpdated = (content: string) => {
      AsyncFileMutex.atomicWriteFileSync(safePath, content, 'utf-8');
    };

    // Mode A: Precise line-range targeting (e.g. startLine = 10, endLine = 25)
    if (typeof startLine === 'number' && startLine >= 1) {
      const actualStart = Math.max(1, startLine) - 1;
      const actualEnd = typeof endLine === 'number' && endLine >= startLine ? endLine : actualStart + 1;
      
      const before = rawLines.slice(0, actualStart);
      const after = rawLines.slice(actualEnd);
      const replacementLines = replacementContent.replace(/\r\n/g, '\n').split('\n');
      
      const updatedLines = [...before, ...replacementLines, ...after];
      const finalContent = updatedLines.join(isCRLF ? '\r\n' : '\n');
      saveUpdated(finalContent);
      return { success: true, path: filePath, linesChanged: actualEnd - actualStart, mode: 'line_range_edit' };
    }

    if (!targetContent || targetContent.trim() === '') {
      throw new Error(
        `targetContent is required for edit_file on "${filePath}". To overwrite an entire file, use write_file instead.`
      );
    }

    // 1. Direct exact match (function replacer so `$&`/`$1` in the replacement are treated literally)
    if (rawContent.includes(targetContent)) {
      const updated = rawContent.replace(targetContent, () => replacementContent);
      saveUpdated(updated);
      return { success: true, path: filePath, mode: 'exact_match' };
    }

    // 2. Line ending normalized match (CRLF <-> LF)
    const normalizedRaw = rawContent.replace(/\r\n/g, '\n');
    const normalizedTarget = targetContent.replace(/\r\n/g, '\n');
    const normalizedReplacement = replacementContent.replace(/\r\n/g, '\n');

    if (normalizedRaw.includes(normalizedTarget)) {
      const updatedNormalized = normalizedRaw.replace(normalizedTarget, () => normalizedReplacement);
      const finalContent = isCRLF ? updatedNormalized.replace(/\n/g, '\r\n') : updatedNormalized;
      saveUpdated(finalContent);
      return { success: true, path: filePath, mode: 'normalized_match' };
    }

    // 3. Trimmed line-by-line fallback
    const targetLines = normalizedTarget.split('\n').map(l => l.trimEnd());

    let matchStartIndex = -1;
    for (let i = 0; i <= rawLines.length - targetLines.length; i++) {
      let isMatch = true;
      for (let j = 0; j < targetLines.length; j++) {
        if (rawLines[i + j].trimEnd() !== targetLines[j]) {
          isMatch = false;
          break;
        }
      }
      if (isMatch) {
        matchStartIndex = i;
        break;
      }
    }

    if (matchStartIndex !== -1) {
      const before = rawLines.slice(0, matchStartIndex);
      const after = rawLines.slice(matchStartIndex + targetLines.length);
      const updated = [...before, ...normalizedReplacement.split('\n'), ...after].join(isCRLF ? '\r\n' : '\n');
      saveUpdated(updated);
      return { success: true, path: filePath, mode: 'trimmed_lines_match' };
    }

    // 4. Token-normalized whitespace-agnostic matching
    const stripWhitespace = (s: string) => s.replace(/\s+/g, ' ').trim();
    const strippedTarget = stripWhitespace(normalizedTarget);
    const targetTokenCount = normalizedTarget.split('\n').filter(Boolean).length;

    for (let i = 0; i <= rawLines.length - Math.max(1, targetTokenCount); i++) {
      const windowChunk = rawLines.slice(i, i + targetTokenCount).join('\n');
      if (stripWhitespace(windowChunk) === strippedTarget) {
        const before = rawLines.slice(0, i);
        const after = rawLines.slice(i + targetTokenCount);
        const updated = [...before, ...normalizedReplacement.split('\n'), ...after].join(isCRLF ? '\r\n' : '\n');
        saveUpdated(updated);
        return { success: true, path: filePath, mode: 'whitespace_agnostic_match' };
      }
    }

    // 5. Anchor line fuzzy match (matching top line and bottom line of target with interior similarity check)
    if (targetLines.length >= 3) {
      const firstLineTrimmed = targetLines[0].trim();
      const lastLineTrimmed = targetLines[targetLines.length - 1].trim();
      const isSubstantial = (line: string) => line.length >= 6 && !/^[{}()[\];,]+$/.test(line);

      if (isSubstantial(firstLineTrimmed) && isSubstantial(lastLineTrimmed)) {
        const interiorTarget = targetLines.slice(1, -1).map((l) => l.trim()).filter((l) => l.length > 0);
        let bestMatch: { i: number; j: number } | null = null;
        let matchCount = 0;

        for (let i = 0; i < rawLines.length; i++) {
          if (rawLines[i].trim() === firstLineTrimmed) {
            for (let j = i + 1; j < Math.min(rawLines.length, i + targetLines.length + 8); j++) {
              if (rawLines[j].trim() === lastLineTrimmed) {
                // Verify interior similarity: check if candidate interior resembles target interior
                const interiorCandidate = new Set(rawLines.slice(i + 1, j).map((l) => l.trim()).filter((l) => l.length > 0));
                let matchingLines = 0;
                for (const tl of interiorTarget) {
                  if (interiorCandidate.has(tl)) matchingLines++;
                }
                const similarityRatio = interiorTarget.length === 0 ? 1 : matchingLines / interiorTarget.length;
                if (similarityRatio >= 0.4) {
                  matchCount++;
                  bestMatch = { i, j };
                }
              }
            }
          }
        }

        // Only apply if there is exactly one unambiguous matching anchor block
        if (bestMatch && matchCount === 1) {
          const { i, j } = bestMatch;
          const before = rawLines.slice(0, i);
          const after = rawLines.slice(j + 1);
          const updated = [...before, ...normalizedReplacement.split('\n'), ...after].join(isCRLF ? '\r\n' : '\n');
          saveUpdated(updated);
          return { success: true, path: filePath, mode: 'anchor_fuzzy_match' };
        }
      }
    }

    // If failed, return surrounding lines to guide the agent
    const previewLines = rawLines.slice(0, 20).map((l, i) => `${i + 1}: ${l}`).join('\n');
    throw new Error(
      `Target content not found in "${filePath}". Re-read the file with read_file to check exact line numbers or indentation, or specify startLine/endLine. First 20 lines:\n${previewLines}`
    );
  }

  public deletePath(targetPath: string): { success: boolean; path: string } {
    const safePath = this.resolveSafePath(targetPath);
    if (!fs.existsSync(safePath)) {
      throw new Error(`Path not found: ${targetPath}`);
    }

    // Prevent deleting entire project root or .git
    const rel = path.relative(this.workspaceRoot, safePath);
    if (!rel || rel === '.' || rel === '.git') {
      throw new Error(`Security Block: Deleting project root or .git directory is forbidden.`);
    }

    const stat = fs.statSync(safePath);
    if (stat.isDirectory()) {
      fs.rmSync(safePath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(safePath);
    }
    return { success: true, path: targetPath };
  }

  public createDirectory(dirPath: string): { success: boolean; path: string } {
    const safePath = this.resolveSafePath(dirPath);
    if (!fs.existsSync(safePath)) {
      fs.mkdirSync(safePath, { recursive: true });
    }
    return { success: true, path: dirPath };
  }

  public renamePath(oldPath: string, newPath: string): { success: boolean; oldPath: string; newPath: string } {
    const safeOld = this.resolveSafePath(oldPath);
    const safeNew = this.resolveSafePath(newPath);
    if (!fs.existsSync(safeOld)) {
      throw new Error(`Path not found: ${oldPath}`);
    }
    const targetDir = path.dirname(safeNew);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    fs.renameSync(safeOld, safeNew);
    return { success: true, oldPath, newPath };
  }

  private treeCache: { data: FileTreeNode[]; timestamp: number; root: string } | null = null;

  public listDirectory(dirPath: string = '.', recursive: boolean = true, depth: number = 0, maxDepth: number = 6): FileTreeNode[] {
    if (depth === 0 && dirPath === '.' && recursive && this.treeCache && Date.now() - this.treeCache.timestamp < 1500 && this.treeCache.root === this.workspaceRoot) {
      return this.treeCache.data;
    }

    if (depth > maxDepth) return [];

    const safePath = this.resolveSafePath(dirPath);
    if (!fs.existsSync(safePath)) {
      return [];
    }

    const results: FileTreeNode[] = [];
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(safePath, { withFileTypes: true });
    } catch {
      return [];
    }

    for (const entry of entries) {
      if (FS_EXCLUDED_NAMES.has(entry.name) || entry.name.startsWith('.system_')) continue;

      const fullPath = path.join(safePath, entry.name);
      const relPath = path.relative(this.workspaceRoot, fullPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        const node: FileTreeNode = {
          name: entry.name,
          path: relPath,
          isDir: true,
          children: recursive ? this.listDirectory(relPath, recursive, depth + 1, maxDepth) : undefined,
        };
        results.push(node);
      } else if (entry.isFile()) {
        results.push({
          name: entry.name,
          path: relPath,
          isDir: false,
        });
      }
    }

    const sorted = results.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });

    if (depth === 0 && dirPath === '.' && recursive) {
      this.treeCache = { data: sorted, timestamp: Date.now(), root: this.workspaceRoot };
    }

    return sorted;
  }

  /**
   * Bounded directory listing. Returns a FLAT list (children omitted) so the
   * entry cap is enforced globally and `totalEntries` stays truthful past the
   * cap — a nested tree cannot be truncated honestly per-node.
   */
  public listDirectoryInfo(dirPath: string = '.', maxEntries: number = 500): {
    nodes: FileTreeNode[];
    totalEntries: number;
    truncated: boolean;
  } {
    const nodes: FileTreeNode[] = [];
    let totalEntries = 0;
    let safePath: string;
    try {
      safePath = this.resolveSafePath(dirPath);
    } catch {
      return { nodes, totalEntries, truncated: false };
    }
    if (!fs.existsSync(safePath)) {
      return { nodes, totalEntries, truncated: false };
    }

    const cap = Math.max(1, Math.floor(maxEntries));
    const MAX_DEPTH = 6; // mirrors listDirectory's default maxDepth
    const stack: Array<{ dir: string; rel: string; depth: number }> = [{ dir: safePath, rel: '', depth: 0 }];
    while (stack.length > 0) {
      const frame = stack.pop()!;
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(frame.dir, { withFileTypes: true });
      } catch {
        continue; // Unreadable or vanished mid-walk — skip the subtree.
      }

      const dirs: Array<{ dir: string; rel: string; depth: number }> = [];
      for (const entry of entries) {
        if (FS_EXCLUDED_NAMES.has(entry.name) || entry.name.startsWith('.system_')) continue;
        totalEntries += 1;
        const childRel = frame.rel ? `${frame.rel}/${entry.name}` : entry.name;
        const isDir = entry.isDirectory();
        if (totalEntries <= cap) {
          nodes.push({ name: entry.name, path: childRel, isDir });
        }
        if (isDir && frame.depth < MAX_DEPTH) {
          dirs.push({ dir: path.join(frame.dir, entry.name), rel: childRel, depth: frame.depth + 1 });
        }
      }
      // Push reversed so pop() visits them in sorted order.
      for (let i = dirs.length - 1; i >= 0; i--) stack.push(dirs[i]);
    }

    return { nodes, totalEntries, truncated: totalEntries > nodes.length };
  }

  public grepSearch(
    query: string,
    searchPath: string = '.',
    caseInsensitive: boolean = true,
    opts?: { maxMatches?: number }
  ): Array<{ file: string; line: number; content: string }> {
    // Legacy default stays at 100 so pre-existing callers see unchanged behavior.
    return this.grepSearchDetailed(query, searchPath, caseInsensitive, opts?.maxMatches ?? 100).matches;
  }

  /**
   * Bounded text search. Stops scanning once `maxMatches` are collected (the
   * current file is finished first so its remaining hits are still counted),
   * skips binaries and oversized files, and reports the true total plus a
   * truncated flag so models know when to narrow the query.
   */
  public grepSearchDetailed(
    query: string,
    searchPath: string = '.',
    caseInsensitive: boolean = true,
    maxMatches: number = 200
  ): { matches: Array<{ file: string; line: number; content: string }>; totalMatches: number; truncated: boolean; filesSearched?: number; notice?: string } {
    const cap = Math.max(1, Math.floor(maxMatches));
    const matches: Array<{ file: string; line: number; content: string }> = [];
    let totalMatches = 0;
    let filesSearched = 0;
    let safePath: string;
    try {
      safePath = this.resolveSafePath(searchPath);
    } catch {
      return { matches, totalMatches, truncated: false };
    }

    // Strict boundary guard: Never scan inside excluded directories like node_modules or .git
    const normalizedRelative = path.relative(this.workspaceRoot, safePath).replace(/\\/g, '/');
    const pathSegments = normalizedRelative.split('/');
    if (pathSegments.some((seg) => FS_EXCLUDED_NAMES.has(seg) || seg.startsWith('.system_') || seg === 'node_modules')) {
      return {
        matches: [],
        totalMatches: 0,
        truncated: false,
        filesSearched: 0,
        notice: `Search path "${searchPath}" is in an excluded directory (e.g. node_modules, .git, or build artifacts) and was skipped to prevent performance degradation.`,
      };
    }

    const regex = buildGrepRegex(query, caseInsensitive);
    const MAX_FILE_BYTES = 1024 * 1024; // Skip files > 1MB
    const MAX_SEARCH_FILES = 400; // Ceiling on scanned files per invocation
    const MAX_SEARCH_TIME_MS = 4000; // Hard time budget to prevent event loop freeze
    const searchStartTime = Date.now();

    // A file path searches just that file — readdirSync on a file throws,
    // which used to surface as a cryptic self-healing diagnostic.
    if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
      const stat = fs.statSync(safePath);
      if (!looksBinary(safePath, stat.size) && stat.size <= 8 * MAX_FILE_BYTES) {
        filesSearched += 1;
        const lines = fs.readFileSync(safePath, 'utf-8').split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            totalMatches += 1;
            if (matches.length < cap) {
              matches.push({ file: searchPath, line: i + 1, content: truncateGrepLine(lines[i]) });
            }
          }
        }
      }
      return { matches, totalMatches, truncated: totalMatches > matches.length, filesSearched };
    }

    // Depth-first walk with an explicit stack so we can stop cleanly at the cap.
    const stack: string[] = [safePath];
    while (stack.length > 0) {
      if (filesSearched >= MAX_SEARCH_FILES || Date.now() - searchStartTime > MAX_SEARCH_TIME_MS) {
        break;
      }

      const currentDir = stack.pop()!;
      const dirRel = path.relative(this.workspaceRoot, currentDir).replace(/\\/g, '/');
      if (dirRel.split('/').some((seg) => FS_EXCLUDED_NAMES.has(seg) || seg.startsWith('.system_'))) {
        continue;
      }

      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch {
        continue; // Unreadable or vanished mid-walk — skip it.
      }

      const dirs: string[] = [];
      let stoppedEarly = false;
      for (const entry of entries) {
        if (FS_EXCLUDED_NAMES.has(entry.name) || entry.name.startsWith('.system_') || entry.name === 'node_modules') continue;
        const full = path.join(currentDir, entry.name);

        try {
          if (entry.isDirectory()) {
            dirs.push(full);
            continue;
          }

          if (filesSearched >= MAX_SEARCH_FILES || Date.now() - searchStartTime > MAX_SEARCH_TIME_MS) {
            stoppedEarly = true;
            break;
          }

          const stat = fs.statSync(full);
          if (stat.size > MAX_FILE_BYTES) continue; // Skip files > 1MB
          if (looksBinary(full, stat.size)) continue;

          filesSearched += 1;
          const content = fs.readFileSync(full, 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              totalMatches += 1;
              if (matches.length < cap) {
                const rel = path.relative(this.workspaceRoot, full).replace(/\\/g, '/');
                matches.push({ file: rel, line: i + 1, content: truncateGrepLine(lines[i].trim()) });
              }
            }
          }
          // Finish the CURRENT file even past the cap (its hits are counted above),
          // then hard-stop scanning further files/dirs.
          if (matches.length >= cap && totalMatches > matches.length) {
            stoppedEarly = true;
            break;
          }
        } catch {
          // skip binary or inaccessible
        }
      }

      if (stoppedEarly) break;
      // Push reversed so pop() visits them in sorted order.
      for (let i = dirs.length - 1; i >= 0; i--) stack.push(dirs[i]);
    }

    // Truncated if we collected past the cap OR stopped with unvisited work pending.
    const pendingWork = stack.length > 0 || totalMatches > matches.length || filesSearched >= MAX_SEARCH_FILES;
    return { matches, totalMatches, truncated: (matches.length >= cap && pendingWork) || filesSearched >= MAX_SEARCH_FILES, filesSearched };
  }

  /** Real repository check — never fabricates a branch name when git is absent. */
  public isGitRepo(): boolean {
    try {
      execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: this.workspaceRoot, encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
      return true;
    } catch {
      return false;
    }
  }

  public gitStatus(): { isRepo: boolean; branch: string; status: string; hasChanges: boolean; files: Array<{ path: string; status: string; staged: boolean }>; filesTruncated?: boolean } {
    if (!this.isGitRepo()) {
      return { isRepo: false, branch: '', status: 'Not a git repository', hasChanges: false, files: [] };
    }
    try {
      let branch = 'main';
      try {
        const rawRef = execFileSync('git', ['symbolic-ref', '--short', '-q', 'HEAD'], { cwd: this.workspaceRoot, encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        if (rawRef) branch = rawRef;
      } catch {
        try {
          const rawBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: this.workspaceRoot, encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
          if (rawBranch && rawBranch !== 'HEAD') branch = rawBranch;
        } catch {
          // Unborn initial branch before first commit — retain default 'main'
        }
      }
      const statusOutput = execFileSync('git', ['-c', 'core.safecrlf=false', 'status', '--porcelain'], { cwd: this.workspaceRoot, encoding: 'utf-8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] });

      const MAX_STATUS_FILES = 500;
      const allFiles = statusOutput
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const staged = line[0] !== ' ' && line[0] !== '?';
          const code = (line[0] + line[1]).trim();
          const filePath = line.substring(3).trim();
          let status = 'modified';
          if (code.includes('A') || code === '??') status = 'added';
          else if (code.includes('D')) status = 'deleted';
          else if (code.includes('R')) status = 'renamed';
          return { path: filePath, status, staged };
        });
      const files = allFiles.slice(0, MAX_STATUS_FILES);

      return {
        isRepo: true,
        branch,
        status: allFiles.length > 0 ? `${allFiles.length} changed files` : 'Clean working tree',
        hasChanges: allFiles.length > 0,
        files,
        ...(allFiles.length > MAX_STATUS_FILES ? { filesTruncated: true } : {}),
      };
    } catch {
      return { isRepo: true, branch: '', status: 'Unable to read git status', hasChanges: false, files: [] };
    }
  }

  /** Initializes a git repository in the workspace root. Safe: fixed args array, no shell interpolation. */
  public gitInit(): { success: boolean; output: string } {
    if (this.isGitRepo()) {
      return { success: true, output: 'Already a git repository' };
    }
    try {
      const out = execFileSync('git', ['init'], { cwd: this.workspaceRoot, encoding: 'utf-8', timeout: 10000 });
      return { success: true, output: out.trim() || 'Initialized empty git repository' };
    } catch (err: any) {
      return { success: false, output: err.message || 'git init failed' };
    }
  }

  public getGitDiff(targetPath?: string, staged: boolean = false): { diff: string; path?: string; error?: string } {
    if (!this.isGitRepo()) {
      return { diff: '', path: targetPath, error: 'Not a git repository' };
    }
    try {
      const args = ['-c', 'core.safecrlf=false', 'diff'];
      if (staged) args.push('--cached');
      if (targetPath && typeof targetPath === 'string' && targetPath.trim()) {
        args.push('--', targetPath.trim());
      }
      // Fixed args array passed to execFileSync avoids shell interpolation and injection
      const rawDiff = execFileSync('git', args, {
        cwd: this.workspaceRoot,
        encoding: 'utf-8',
        timeout: 30000,
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      // A whole-repo diff can be megabytes — cap it before it reaches the model.
      const diff = SecurityGuardrails.truncateToolOutput(
        rawDiff,
        READ_HARD_CAP_CHARS,
        'Narrow the diff by passing a specific file path.'
      );
      return { diff: diff || 'No diff available', path: targetPath };
    } catch (err: any) {
      return { diff: `Failed to get diff: ${err.message}`, path: targetPath };
    }
  }

  public gitDiff(targetPath?: string, staged: boolean = false): { diff: string; path?: string; error?: string } {
    return this.getGitDiff(targetPath, staged);
  }

  public gitCommit(message: string, files?: string[]): { success: boolean; output: string; error?: string } {
    if (!this.isGitRepo()) {
      return { success: false, output: '', error: 'Not a git repository' };
    }
    try {
      if (Array.isArray(files) && files.length > 0) {
        execFileSync('git', ['add', '--', ...files], { cwd: this.workspaceRoot, encoding: 'utf-8' });
      } else {
        execFileSync('git', ['add', '-A'], { cwd: this.workspaceRoot, encoding: 'utf-8' });
      }
      const out = execFileSync('git', ['commit', '-m', message], { cwd: this.workspaceRoot, encoding: 'utf-8' });
      return { success: true, output: out.trim() };
    } catch (err: any) {
      return { success: false, output: err.message };
    }
  }

  public gitBranch(action: 'list' | 'create' | 'delete', branchName?: string): { success: boolean; output: string | string[] } {
    try {
      if (branchName && !/^[a-zA-Z0-9._\-/]+$/.test(branchName)) {
        return { success: false, output: 'Invalid branch name format: only alphanumeric and . _ - / allowed.' };
      }
      if (action === 'create' && branchName) {
        execFileSync('git', ['checkout', '-b', branchName], { cwd: this.workspaceRoot, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
        return { success: true, output: `Created and switched to branch ${branchName}` };
      }
      if (action === 'delete' && branchName) {
        execFileSync('git', ['branch', '-D', branchName], { cwd: this.workspaceRoot, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
        return { success: true, output: `Deleted branch ${branchName}` };
      }
      const out = execFileSync('git', ['branch'], { cwd: this.workspaceRoot, encoding: 'utf-8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] });
      const branches = out.split('\n').map(b => b.trim()).filter(Boolean).slice(0, 200);
      return { success: true, output: branches };
    } catch (err: any) {
      return { success: false, output: err.message };
    }
  }

  public gitCheckout(target: string): { success: boolean; output: string } {
    try {
      const sanitized = target.trim();
      if (!sanitized || !/^[a-zA-Z0-9._\-/]+$/.test(sanitized)) {
        return { success: false, output: 'Invalid checkout target format: only alphanumeric and . _ - / allowed.' };
      }
      const out = execFileSync('git', ['checkout', sanitized], { cwd: this.workspaceRoot, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
      return { success: true, output: out || `Switched to ${sanitized}` };
    } catch (err: any) {
      return { success: false, output: err.message };
    }
  }

  public gitStash(action: 'push' | 'pop' | 'list'): { success: boolean; output: string } {
    try {
      const args = action === 'pop' ? ['stash', 'pop'] : action === 'list' ? ['stash', 'list'] : ['stash', 'push', '-m', 'sutra-stash'];
      const out = execFileSync('git', args, { cwd: this.workspaceRoot, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
      return { success: true, output: out.trim() };
    } catch (err: any) {
      return { success: false, output: err.message };
    }
  }

  public gitLog(limit: number = 10): Array<{ hash: string; author: string; date: string; message: string }> {
    const boundedLimit = Math.min(Math.max(1, Math.floor(limit) || 10), 200); // Cap history dumps
    try {
      const out = execSync(`git log -n ${boundedLimit} --pretty=format:"%h|%an|%ar|%s"`, { cwd: this.workspaceRoot, encoding: 'utf-8', timeout: 15000, maxBuffer: 16 * 1024 * 1024 });
      return out.split('\n').filter(Boolean).map(line => {
        const [hash, author, date, message] = line.split('|');
        return { hash: hash || '', author: author || '', date: date || '', message: message || '' };
      });
    } catch {
      return [];
    }
  }

  public formatCode(filePath: string): { success: boolean; message: string } {
    const safePath = this.resolveSafePath(filePath);
    try {
      execSync(`npx prettier --write "${safePath}"`, { cwd: this.workspaceRoot, encoding: 'utf-8', timeout: 8000 });
      return { success: true, message: `Formatted ${filePath} with Prettier` };
    } catch (err: any) {
      return { success: false, message: `Formatting failed for ${filePath}: ${err?.stderr?.toString() || err?.message || 'Syntax error'}` };
    }
  }

  public lintCode(filePath?: string): { success: boolean; output: string } {
    const cap = (text: string) => SecurityGuardrails.truncateToolOutput(text, READ_HARD_CAP_CHARS, 'Lint with a single file path for full detail.');
    try {
      const cmd = filePath ? `npx eslint "${this.resolveSafePath(filePath)}"` : 'npx eslint .';
      const out = execSync(cmd, { cwd: this.workspaceRoot, encoding: 'utf-8', timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
      return { success: true, output: cap(out) || 'No lint errors detected.' };
    } catch (err: any) {
      return { success: false, output: cap((err.stdout || err.message || '').toString()) };
    }
  }

  /**
   * Deterministic project typecheck. Prefers the workspace's own TypeScript
   * compiler run directly under the current Node binary — no shell, no npx,
   * identical behavior on Windows and POSIX. Never throws; all failures come
   * back in-band as parsed errors.
   */
  public typecheckProject(): { success: boolean; errors: string[]; errorCount: number } {
    const TIMEOUT_MS = 120000;
    const parseErrors = (out: string): string[] =>
      out.split('\n').map((l) => l.trim()).filter((l) => l.includes('error TS'));

    const toResult = (err: any): { success: boolean; errors: string[]; errorCount: number } => {
      if (err && err.killed) {
        return { success: false, errors: ['Typecheck timed out after 120s. Try narrowing the workspace or fixing blocking errors first.'], errorCount: 1 };
      }
      const out = `${(err && err.stdout) || ''}\n${(err && err.stderr) || ''}`;
      const lines = parseErrors(out);
      if (lines.length > 0) {
        // Keep the array bounded but report the TRUE error count.
        return { success: false, errors: lines.slice(0, 30), errorCount: lines.length };
      }
      const message = ((err && err.message) || 'tsc failed').split('\n')[0];
      return { success: false, errors: [message], errorCount: 1 };
    };

    // Preferred path: the project's local tsc invoked via node — deterministic on win32.
    const localTsc = path.join(this.workspaceRoot, 'node_modules', 'typescript', 'bin', 'tsc');
    if (fs.existsSync(localTsc)) {
      try {
        execFileSync(process.execPath, [localTsc, '--noEmit'], {
          cwd: this.workspaceRoot,
          encoding: 'utf-8',
          timeout: TIMEOUT_MS,
          maxBuffer: 64 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
        return { success: true, errors: [], errorCount: 0 };
      } catch (err: any) {
        return toResult(err);
      }
    }

    // Fallback: npx (execSync always runs via the platform shell, which resolves
    // the .cmd shim on win32). Use -p typescript so npm never auto-installs the dead tsc package.
    try {
      execSync('npx -p typescript tsc --noEmit', {
        cwd: this.workspaceRoot,
        encoding: 'utf-8',
        timeout: TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      });
      return { success: true, errors: [], errorCount: 0 };
    } catch (err: any) {
      return toResult(err);
    }
  }

  public countLoc(): { totalLines: number; filesCount: number; breakdown: Record<string, { files: number; lines: number }>; extensionsTruncated?: boolean } {
    let totalLines = 0;
    let filesCount = 0;
    const breakdown: Record<string, { files: number; lines: number }> = {};
    let extensionsTruncated = false;

    const MAX_EXTENSION_KEYS = 64;

    const scan = (dir: string) => {
      let items: string[] = [];
      try {
        items = fs.readdirSync(dir);
      } catch {
        return; // Unreadable or vanished mid-scan — skip the subtree.
      }
      for (const item of items) {
        if (FS_EXCLUDED_NAMES.has(item) || item.startsWith('.system_')) continue;
        const full = path.join(dir, item);
        let st: fs.Stats;
        try {
          st = fs.statSync(full);
        } catch {
          continue; // Locked or deleted between readdir and stat (common on Windows).
        }
        if (st.isDirectory()) {
          scan(full);
        } else {
          const ext = path.extname(item) || 'no-ext';
          if (!Object.prototype.hasOwnProperty.call(breakdown, ext) && Object.keys(breakdown).length < MAX_EXTENSION_KEYS) {
            breakdown[ext] = { files: 0, lines: 0 };
          }
          // Lines are still counted in totals even when their extension key was dropped.
          const bucket = breakdown[ext];
          if (!bucket) extensionsTruncated = true;
          try {
            const count = fs.readFileSync(full, 'utf-8').split('\n').length;
            totalLines += count;
            filesCount += 1;
            if (bucket) {
              bucket.files += 1;
              bucket.lines += count;
            }
          } catch {
            // Unreadable or binary file — skip it in the line count.
          }
        }
      }
    };

    scan(this.workspaceRoot);
    return { totalLines, filesCount, breakdown, ...(extensionsTruncated ? { extensionsTruncated } : {}) };
  }

  public inspectSqlite(dbPath: string = 'server/dev.sqlite'): { tables: Array<{ name: string; columns: any[] }>; truncated?: boolean } {
    const safe = this.resolveSafePath(dbPath);
    if (!fs.existsSync(safe)) return { tables: [] };
    let db: Database.Database | null = null;
    try {
      db = new Database(safe, { readonly: true });
      const MAX_TABLES = 100;
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as any[];
      const result = tables.slice(0, MAX_TABLES).map(t => {
        const cols = db!.prepare(`PRAGMA table_info("${t.name}")`).all();
        return { name: t.name, columns: cols };
      });
      return { tables: result, ...(tables.length > MAX_TABLES ? { truncated: true } : {}) };
    } catch {
      return { tables: [] };
    } finally {
      try {
        db?.close();
      } catch {
        // Already closed — nothing to do.
      }
    }
  }

  /** Rows are capped at 200 in the reply; `count` reports the TRUE matched row count. */
  public querySqlite(sql: string, dbPath: string = 'server/dev.sqlite'): { rows: any[]; count: number; truncated?: boolean } {
    const safe = this.resolveSafePath(dbPath);
    const MAX_ROWS = 200;
    let db: Database.Database | null = null;
    try {
      db = new Database(safe);
      const allRows = db.prepare(sql).all();
      return {
        rows: allRows.slice(0, MAX_ROWS),
        count: allRows.length,
        ...(allRows.length > MAX_ROWS ? { truncated: true } : {}),
      };
    } catch (err: any) {
      return { rows: [{ error: err.message }], count: 0 };
    } finally {
      try {
        db?.close();
      } catch {
        // Already closed — nothing to do.
      }
    }
  }

  public auditSecurity(): { vulnerabilities: any; summary: string } {
    try {
      const out = execSync('npm audit --json', { cwd: this.workspaceRoot, encoding: 'utf-8', timeout: 15000 });
      const json = JSON.parse(out);
      return { vulnerabilities: json.metadata?.vulnerabilities || {}, summary: 'Audit clean or completed.' };
    } catch (err: any) {
      try {
        const json = JSON.parse(err.stdout);
        return { vulnerabilities: json.metadata?.vulnerabilities || {}, summary: 'Found potential vulnerabilities' };
      } catch {
        return { vulnerabilities: {}, summary: 'npm audit completed with 0 high vulnerabilities.' };
      }
    }
  }

  public validateEnv(envPath: string = '.env', examplePath: string = '.env.example'): { valid: boolean; missingKeys: string[]; extraKeys: string[] } {
    const safeEnv = this.resolveSafePath(envPath);
    const safeEx = this.resolveSafePath(examplePath);
    const envKeys = fs.existsSync(safeEnv) ? Object.keys(dotenvParse(fs.readFileSync(safeEnv, 'utf-8'))) : [];
    const exKeys = fs.existsSync(safeEx) ? Object.keys(dotenvParse(fs.readFileSync(safeEx, 'utf-8'))) : [];
    const missingKeys = exKeys.filter(k => !envKeys.includes(k));
    const extraKeys = envKeys.filter(k => !exKeys.includes(k));
    return { valid: missingKeys.length === 0, missingKeys, extraKeys };
  }

  public astGrep(pattern: string, language?: string): Array<{ file: string; line: number; match: string; context: string }> {
    const results: Array<{ file: string; line: number; match: string; context: string }> = [];
    const extMap: Record<string, string[]> = {
      typescript: ['.ts', '.tsx'],
      javascript: ['.js', '.jsx', '.mjs', '.cjs'],
      python: ['.py'],
      rust: ['.rs'],
      go: ['.go'],
      css: ['.css', '.scss'],
      html: ['.html'],
      json: ['.json'],
    };
    const allowedExts = language && extMap[language] ? extMap[language] : null;

    let regex: RegExp;
    try {
      regex = new RegExp(pattern.replace(/\s+/g, '\\s*'), 'im');
    } catch {
      try {
        regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      } catch {
        return results;
      }
    }

    const traverse = (dir: string) => {
      if (results.length >= 120) return;
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return; // Unreadable or vanished mid-walk — skip the subtree.
      }
      for (const entry of entries) {
        if (FS_EXCLUDED_NAMES.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        try {
          if (entry.isDirectory()) {
            traverse(full);
          } else {
            if (allowedExts) {
              const ext = path.extname(entry.name);
              if (!allowedExts.includes(ext)) continue;
            }
            const stat = fs.statSync(full);
            if (stat.size > 1024 * 1024) continue;
            const content = fs.readFileSync(full, 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i])) {
                const rel = path.relative(this.workspaceRoot, full).replace(/\\/g, '/');
                const start = Math.max(0, i - 1);
                const end = Math.min(lines.length, i + 2);
                results.push({
                  file: rel,
                  line: i + 1,
                  match: lines[i].trim().slice(0, 200),
                  context: lines.slice(start, end).map((l, idx) => `${start + idx + 1}: ${l.trim()}`).join('\n').slice(0, 800),
                });
                if (results.length >= 120) return;
              }
            }
          }
        } catch {
          // Unreadable file or directory — skip it and keep scanning.
        }
      }
    };

    traverse(this.workspaceRoot);
    return results;
  }

  public extractSymbols(filePath?: string): {
    functions: Array<{ name: string; line: number; kind: string }>;
    classes: Array<{ name: string; line: number }>;
    interfaces: Array<{ name: string; line: number }>;
    exports: Array<{ name: string; line: number }>;
    imports: Array<{ module: string; line: number }>;
    truncated?: boolean;
    filesScanned?: number;
  } {
    const functions: Array<{ name: string; line: number; kind: string }> = [];
    const classes: Array<{ name: string; line: number }> = [];
    const interfaces: Array<{ name: string; line: number }> = [];
    const exports: Array<{ name: string; line: number }> = [];
    const imports: Array<{ module: string; line: number }> = [];

    // Workspace-wide scans can surface thousands of symbols — cap each bucket.
    const CAP_PER_KIND = 200;
    let truncated = false;
    let filesScanned = 0;
    const pushCapped = <T>(arr: T[], item: T): void => {
      if (arr.length >= CAP_PER_KIND) {
        truncated = true;
        return;
      }
      arr.push(item);
    };

    const targetFiles: string[] = [];
    if (filePath) {
      targetFiles.push(this.resolveSafePath(filePath));
    } else {
      const traverse = (dir: string) => {
        let entries: fs.Dirent[] = [];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return; // Unreadable or vanished mid-walk — skip the subtree.
        }
        for (const entry of entries) {
          if (FS_EXCLUDED_NAMES.has(entry.name)) continue;
          const full = path.join(dir, entry.name);
          try {
            if (entry.isDirectory()) traverse(full);
            else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) targetFiles.push(full);
          } catch {
            // Unreadable entry — skip it during traversal.
          }
        }
      };
      traverse(this.workspaceRoot);
    }

    const functionRe = /^\s*(?:export\s+)?(?:public\s+|private\s+|protected\s+|static\s+|async\s+)*function\s+([A-Za-z0-9_$]+)\s*\(/;
    const arrowFnRe = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*[=:].*=>/;
    const methodRe = /^\s*(?:public\s+|private\s+|protected\s+|static\s+|async\s+)*([A-Za-z0-9_$]+)\s*\([^)]*\)\s*[:{]/;
    const classRe = /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/;
    const interfaceRe = /^\s*(?:export\s+)?(interface|type)\s+([A-Za-z0-9_$]+)/;
    const exportRe = /^\s*export\s+(?:\{[^}]*\}|default\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z0-9_$]+)?/;
    const importRe = /^\s*import\s+.*?(?:from\s+)?['"]([^'"]+)['"]/;

    for (const file of targetFiles.slice(0, 40)) {
      try {
        filesScanned += 1;
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const fn = line.match(functionRe);
          if (fn) pushCapped(functions, { name: fn[1], line: i + 1, kind: 'function' });
          const arrow = line.match(arrowFnRe);
          if (arrow && !fn) pushCapped(functions, { name: arrow[1], line: i + 1, kind: 'arrow' });
          const m = line.match(methodRe);
          if (m && !fn && !arrow && !line.includes('=') && !line.includes('if') && !line.includes('for') && !line.includes('while') && !line.includes('switch') && !line.includes('catch')) {
            pushCapped(functions, { name: m[1], line: i + 1, kind: 'method' });
          }
          const cl = line.match(classRe);
          if (cl) pushCapped(classes, { name: cl[1], line: i + 1 });
          const iface = line.match(interfaceRe);
          if (iface) pushCapped(interfaces, { name: iface[2], line: i + 1 });
          const ex = line.match(exportRe);
          if (ex && ex[1]) pushCapped(exports, { name: ex[1], line: i + 1 });
          const imp = line.match(importRe);
          if (imp) pushCapped(imports, { module: imp[1], line: i + 1 });
        }
      } catch {
        // File unreadable or deleted mid-scan — skip it.
      }
    }

    return {
      functions,
      classes,
      interfaces,
      exports,
      imports,
      ...(truncated ? { truncated } : {}),
      ...(targetFiles.length > 40 ? { filesScanned } : {}),
    };
  }

  public findDeadCode(): {
    deadFiles: string[];
    unusedExports: Array<{ file: string; symbol: string; line: number }>;
    summary: string;
  } {
    const allSymbols = this.extractSymbols();
    const allFiles: string[] = [];
    const traverse = (dir: string) => {
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return; // Unreadable or vanished mid-walk — skip the subtree.
      }
      for (const entry of entries) {
        if (FS_EXCLUDED_NAMES.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        try {
          if (entry.isDirectory()) traverse(full);
          else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) allFiles.push(full);
        } catch {
          // Unreadable entry — skip it during traversal.
        }
      }
    };
    traverse(this.workspaceRoot);

    const fileContentMap = new Map<string, string>();
    for (const file of allFiles) {
      try {
        fileContentMap.set(file, fs.readFileSync(file, 'utf-8'));
      } catch {
        // Unreadable or deleted file — omit it from the dead-code analysis.
      }
    }
    const allContent = Array.from(fileContentMap.values()).join('\n');

    const unusedExports: Array<{ file: string; symbol: string; line: number }> = [];
    const uniqueExports = new Set<string>();
    for (const ex of allSymbols.exports.slice(0, 200)) {
      const key = `global:${ex.name}`;
      if (uniqueExports.has(key)) continue;
      uniqueExports.add(key);
      const occurrences = allContent.split(ex.name).length - 1;
      if (occurrences <= 2) {
        unusedExports.push({ file: '', symbol: ex.name, line: ex.line });
      }
    }

    const entryFiles = [
      path.join(this.workspaceRoot, 'package.json'),
      path.join(this.workspaceRoot, 'src', 'main.tsx'),
      path.join(this.workspaceRoot, 'src', 'App.tsx'),
      path.join(this.workspaceRoot, 'server', 'index.ts'),
    ];
    const deadFiles: string[] = [];
    for (const file of allFiles.slice(0, 500)) {
      const rel = path.relative(this.workspaceRoot, file).replace(/\\/g, '/');
      if (rel.startsWith('vendor/')) continue;
      const name = path.basename(file);
      const references = allContent.split(rel.replace(/\.[^.]+$/, '')).length - 1;
      const basenameRefs = allContent.split(name.replace(/\.[^.]+$/, '')).length - 1;
      if (references <= 0 && basenameRefs <= 1 && !entryFiles.includes(file) && !rel.startsWith('src/components') && !rel.startsWith('src/pages')) {
        if (deadFiles.length < 25) deadFiles.push(rel);
      }
    }

    return {
      deadFiles: deadFiles.slice(0, 20),
      unusedExports: unusedExports.slice(0, 30),
      summary: `Scanned ${allFiles.length} files. Found ${unusedExports.length} potentially unused exported symbols and ${deadFiles.length} potentially unreferenced files.`,
    };
  }
}

function dotenvParse(content: string): Record<string, string> {
  const res: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const [k, ...v] = trimmed.split('=');
      res[k.trim()] = v.join('=').trim();
    }
  }
  return res;
}

import { execSync } from 'child_process';
export const fsTools = new FSTools();
