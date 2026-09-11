import * as fs from 'fs';
import * as path from 'path';
import { fsTools } from './fsTools.js';

export interface CodeSymbol {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'component' | 'endpoint' | 'variable' | 'asset';
  filePath: string;
  line: number;
  snippet: string;
  signature?: string;
}

export interface SearchResult {
  symbol: CodeSymbol;
  score: number;
  matchedTerms: string[];
}

export interface SymbolPosting {
  symIndex: number;
  tf: number;
  inName: boolean;
  inPath: boolean;
}

export interface SymbolNode {
  id: string; // "filePath:name"
  symbol: CodeSymbol;
  dependencies: Set<string>; // Symbol IDs this symbol imports or references
  dependents: Set<string>;   // Symbol IDs that depend on this symbol
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'how', 'what', 'where', 'why',
  'can', 'you', 'please', 'file', 'code', 'from', 'into', 'create', 'make',
  'build', 'website', 'app', 'help', 'test', 'fix', 'show', 'check', 'write',
  'look', 'find', 'does', 'have', 'need', 'const', 'let', 'var', 'import',
  'export', 'return', 'async', 'await', 'function', 'class', 'type',
  'interface', 'default', 'null', 'undefined', 'true', 'false'
]);

export class CodebaseIndexer {
  private workspaceRoot: string;
  private symbols: CodeSymbol[] = [];
  private fileIndex = new Map<string, string>(); // path -> content
  private lastIndexedTime = 0;
  private isIndexing = false;

  // Inverted index for sub-millisecond BM25 lookup: token -> postings
  private invertedIndex = new Map<string, SymbolPosting[]>();
  private docLengths: Float32Array = new Float32Array(0);
  private avgDocLength = 100;
  private idfCache = new Map<string, number>();

  // Directed Symbol Dependency Graph: symbolId -> SymbolNode
  private symbolGraph = new Map<string, SymbolNode>();

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  public getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  public setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root;
  }

  public getSymbols(): CodeSymbol[] {
    return this.symbols;
  }

  public getSymbolGraph(): Map<string, SymbolNode> {
    return this.symbolGraph;
  }

  public async buildIndex(): Promise<{ symbolCount: number; fileCount: number }> {
    if (this.isIndexing) return { symbolCount: this.symbols.length, fileCount: this.fileIndex.size };
    this.isIndexing = true;
    const newSymbols: CodeSymbol[] = [];
    const newFileIndex = new Map<string, string>();

    const ignoreDirs = new Set(['node_modules', '.git', 'dist', 'build', '.gemini', '.system_generated', 'coverage', '.next', '.cache']);
    const allowedExts = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.py', '.rs', '.go', '.html', '.css', '.md', '.svg']);

    const walk = (dir: string) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') && entry.name !== '.env') continue;
          const fullPath = path.join(dir, entry.name);
          const relPath = path.relative(this.workspaceRoot, fullPath).replace(/\\/g, '/');

          if (entry.isDirectory()) {
            if (!ignoreDirs.has(entry.name)) {
              walk(fullPath);
            }
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (allowedExts.has(ext)) {
              try {
                const stat = fs.statSync(fullPath);
                if (stat.size < 350000) { // Limit to 350KB per file
                  const content = fs.readFileSync(fullPath, 'utf8');
                  newFileIndex.set(relPath, content);
                  const extracted = this.extractSymbols(relPath, content, ext);
                  newSymbols.push(...extracted);
                }
              } catch {
                // ignore unreadable
              }
            }
          }
        }
      } catch {
        // ignore unreadable dirs
      }
    };

    try {
      walk(this.workspaceRoot);
      this.symbols = newSymbols;
      this.fileIndex = newFileIndex;
      this.rebuildInvertedIndexAndGraph();
      this.lastIndexedTime = Date.now();
    } finally {
      this.isIndexing = false;
    }

    return { symbolCount: this.symbols.length, fileCount: this.fileIndex.size };
  }

  /**
   * Rebuilds the inverted index and directed symbol graph in $O(N \times \text{tokens})$ time.
   */
  private rebuildInvertedIndexAndGraph(): void {
    const totalDocs = this.symbols.length;
    this.invertedIndex.clear();
    this.idfCache.clear();
    this.symbolGraph.clear();

    if (totalDocs === 0) {
      this.docLengths = new Float32Array(0);
      this.avgDocLength = 100;
      return;
    }

    this.docLengths = new Float32Array(totalDocs);
    let totalLength = 0;

    // 1. Build document lengths and initialize Symbol Nodes
    for (let i = 0; i < totalDocs; i++) {
      const sym = this.symbols[i];
      const length = sym.name.length + sym.snippet.length;
      this.docLengths[i] = length;
      totalLength += length;

      const nodeKey = `${sym.filePath}:${sym.name}`;
      if (!this.symbolGraph.has(nodeKey)) {
        this.symbolGraph.set(nodeKey, {
          id: nodeKey,
          symbol: sym,
          dependencies: new Set<string>(),
          dependents: new Set<string>(),
        });
      }
    }

    this.avgDocLength = totalLength / totalDocs || 100;

    // 2. Tokenize symbols and build postings lists
    for (let i = 0; i < totalDocs; i++) {
      const sym = this.symbols[i];
      const symNameLower = sym.name.toLowerCase();
      const pathLower = sym.filePath.toLowerCase();
      const snippetLower = sym.snippet.toLowerCase();

      // Extract unique tokens with frequency
      const nameTokens = this.tokenizeText(symNameLower);
      const pathTokens = this.tokenizeText(pathLower);
      const snippetTokens = this.tokenizeText(snippetLower);

      // Aggregate term frequencies in this document
      const termCounts = new Map<string, number>();
      for (const t of snippetTokens) {
        termCounts.set(t, (termCounts.get(t) || 0) + 1);
      }

      // Combine all tokens
      const allTokens = new Set<string>([...nameTokens, ...pathTokens, ...termCounts.keys()]);

      for (const token of allTokens) {
        if (STOPWORDS.has(token) || token.length <= 1) continue;

        let postings = this.invertedIndex.get(token);
        if (!postings) {
          postings = [];
          this.invertedIndex.set(token, postings);
        }

        postings.push({
          symIndex: i,
          tf: termCounts.get(token) || 0,
          inName: nameTokens.has(token) || symNameLower.includes(token),
          inPath: pathTokens.has(token) || pathLower.includes(token),
        });
      }
    }

    // 3. Construct Symbol Dependency Graph edges from file imports
    this.buildGraphEdges();
  }

  /**
   * Connects graph vertices based on cross-file imports and symbol declarations.
   */
  private buildGraphEdges(): void {
    const symbolsByFile = new Map<string, CodeSymbol[]>();
    for (const sym of this.symbols) {
      const list = symbolsByFile.get(sym.filePath) || [];
      list.push(sym);
      symbolsByFile.set(sym.filePath, list);
    }

    for (const [filePath, content] of this.fileIndex.entries()) {
      const fileSymbols = symbolsByFile.get(filePath) || [];
      const importRegex = /import\s+(?:(?:\{([^}]+)\}|\*\s+as\s+(\w+)|\w+)\s+from\s+)?['"]([^'"]+)['"]/g;
      let match: RegExpExecArray | null;

      while ((match = importRegex.exec(content)) !== null) {
        const importSpecifier = match[3];
        const importedSymbols = match[1] ? match[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]) : [];

        // Resolve relative import target path
        let resolvedRelPath = importSpecifier;
        if (importSpecifier.startsWith('.')) {
          const dir = path.dirname(filePath);
          const full = path.normalize(path.join(dir, importSpecifier)).replace(/\\/g, '/');
          // Match potential extension
          for (const ext of ['', '.ts', '.tsx', '.js', '.jsx']) {
            if (this.fileIndex.has(full + ext)) {
              resolvedRelPath = full + ext;
              break;
            }
          }
        }

        const targetSymbols = symbolsByFile.get(resolvedRelPath) || [];

        for (const localSym of fileSymbols) {
          const localNodeKey = `${localSym.filePath}:${localSym.name}`;
          const localNode = this.symbolGraph.get(localNodeKey);
          if (!localNode) continue;

          for (const targetSym of targetSymbols) {
            if (importedSymbols.length === 0 || importedSymbols.includes(targetSym.name)) {
              const targetNodeKey = `${targetSym.filePath}:${targetSym.name}`;
              const targetNode = this.symbolGraph.get(targetNodeKey);
              if (targetNode) {
                localNode.dependencies.add(targetNodeKey);
                targetNode.dependents.add(localNodeKey);
              }
            }
          }
        }
      }
    }
  }

  /**
   * Fast tokenizer that converts text to alphanumeric lowercase terms.
   */
  private tokenizeText(text: string): Set<string> {
    const tokens = new Set<string>();
    const matches = text.match(/[a-z0-9_]+/g);
    if (matches) {
      for (const m of matches) {
        if (m.length > 1) tokens.add(m);
      }
    }
    return tokens;
  }

  private extractSymbols(filePath: string, content: string, _ext: string): CodeSymbol[] {
    const symbols: CodeSymbol[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;
      const trimmed = line.trim();

      // 1. React Components (e.g. export const Header: React.FC = ...)
      const reactCompMatch = trimmed.match(/^export\s+(?:const|function)\s+([A-Z][a-zA-Z0-9_]*)\s*(?::\s*React\.FC|<|\()/);
      if (reactCompMatch) {
        symbols.push({
          name: reactCompMatch[1],
          kind: 'component',
          filePath,
          line: lineNum,
          snippet: lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 10)).join('\n'),
          signature: trimmed.slice(0, 100),
        });
        continue;
      }

      // 2. TypeScript / JS Functions (e.g. function foo(), export async function bar())
      const fnMatch = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_]+)\s*\(/);
      if (fnMatch) {
        symbols.push({
          name: fnMatch[1],
          kind: 'function',
          filePath,
          line: lineNum,
          snippet: lines.slice(Math.max(0, i), Math.min(lines.length, i + 8)).join('\n'),
          signature: trimmed.slice(0, 100),
        });
        continue;
      }

      // 3. Arrow Functions / Methods (e.g. const handleSave = async () => ...)
      const arrowFnMatch = trimmed.match(/^(?:export\s+)?const\s+([a-zA-Z0-9_]+)\s*=\s*(?:async\s*)?\(/);
      if (arrowFnMatch) {
        symbols.push({
          name: arrowFnMatch[1],
          kind: 'function',
          filePath,
          line: lineNum,
          snippet: lines.slice(Math.max(0, i), Math.min(lines.length, i + 8)).join('\n'),
          signature: trimmed.slice(0, 100),
        });
        continue;
      }

      // 4. Classes & Interfaces
      const classMatch = trimmed.match(/^(?:export\s+)?(?:abstract\s+)?class\s+([a-zA-Z0-9_]+)/);
      if (classMatch) {
        symbols.push({
          name: classMatch[1],
          kind: 'class',
          filePath,
          line: lineNum,
          snippet: lines.slice(Math.max(0, i), Math.min(lines.length, i + 12)).join('\n'),
          signature: trimmed.slice(0, 100),
        });
        continue;
      }

      const ifaceMatch = trimmed.match(/^(?:export\s+)?interface\s+([a-zA-Z0-9_]+)/);
      if (ifaceMatch) {
        symbols.push({
          name: ifaceMatch[1],
          kind: 'interface',
          filePath,
          line: lineNum,
          snippet: lines.slice(Math.max(0, i), Math.min(lines.length, i + 10)).join('\n'),
          signature: trimmed.slice(0, 100),
        });
        continue;
      }

      const typeMatch = trimmed.match(/^(?:export\s+)?type\s+([a-zA-Z0-9_]+)\s*=/);
      if (typeMatch) {
        symbols.push({
          name: typeMatch[1],
          kind: 'type',
          filePath,
          line: lineNum,
          snippet: lines.slice(Math.max(0, i), Math.min(lines.length, i + 6)).join('\n'),
          signature: trimmed.slice(0, 100),
        });
        continue;
      }

      // 5. REST / Express Endpoints (e.g. app.get('/api/foo', ...))
      const endpointMatch = trimmed.match(/(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/);
      if (endpointMatch) {
        symbols.push({
          name: `${endpointMatch[1].toUpperCase()} ${endpointMatch[2]}`,
          kind: 'endpoint',
          filePath,
          line: lineNum,
          snippet: lines.slice(Math.max(0, i), Math.min(lines.length, i + 12)).join('\n'),
          signature: trimmed.slice(0, 100),
        });
        continue;
      }
    }

    return symbols;
  }

  /**
   * Incremental file indexing: updates or adds symbols for a single file in sub-millisecond time.
   */
  public updateFileIndex(relPath: string, content: string): void {
    const ext = path.extname(relPath).toLowerCase();
    this.fileIndex.set(relPath, content);
    
    // Remove old symbols for this file
    const filteredSymbols = this.symbols.filter((s) => s.filePath !== relPath);
    const newExtracted = this.extractSymbols(relPath, content, ext);
    this.symbols = [...filteredSymbols, ...newExtracted];
    this.rebuildInvertedIndexAndGraph();
  }

  /**
   * Incremental file removal.
   */
  public removeFile(relPath: string): void {
    this.fileIndex.delete(relPath);
    this.symbols = this.symbols.filter((s) => s.filePath !== relPath);
    this.rebuildInvertedIndexAndGraph();
  }

  /**
   * Sub-millisecond BM25 Search using the precomputed Inverted Index.
   * Time complexity: $O(|tokens| \times |\text{postings}|)$ with zero runtime regex compilations.
   */
  public search(query: string, maxResults = 6): SearchResult[] {
    const rawTokens = query
      .toLowerCase()
      .split(/[^a-z0-9_]/)
      .filter((t) => t.length > 1);

    const tokens = rawTokens.filter((t) => !STOPWORDS.has(t));
    if (tokens.length === 0 || this.symbols.length === 0) return [];

    const totalDocs = this.symbols.length;
    const k1 = 1.2;
    const b = 0.75;
    const avgLen = this.avgDocLength;

    // Accumulator for scores and matched terms keyed by docIndex
    const candidateScores = new Map<number, number>();
    const candidateMatchedTerms = new Map<number, Set<string>>();

    const lowerQuery = query.trim().toLowerCase();

    for (const token of tokens) {
      const postings = this.invertedIndex.get(token);
      if (!postings || postings.length === 0) continue;

      const df = postings.length;
      let idf = this.idfCache.get(token);
      if (idf === undefined) {
        idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));
        this.idfCache.set(token, idf);
      }

      for (const p of postings) {
        const docIdx = p.symIndex;
        const sym = this.symbols[docIdx];
        const docLen = this.docLengths[docIdx];

        // Kind boost multiplier
        let kindMultiplier = 1.0;
        if (sym.kind === 'component' || sym.kind === 'endpoint') kindMultiplier = 1.35;
        else if (sym.kind === 'class' || sym.kind === 'interface') kindMultiplier = 1.25;
        else if (sym.kind === 'function') kindMultiplier = 1.15;

        let tokenScore = 0;
        const symNameLower = sym.name.toLowerCase();

        // Exact symbol name hit
        if (symNameLower === token) {
          tokenScore += 25 * idf * kindMultiplier;
        } else if (p.inName) {
          tokenScore += 12 * idf * kindMultiplier;
        } else if (p.inPath) {
          tokenScore += 6 * idf;
        }

        // BM25 term frequency contribution on snippet
        if (p.tf > 0) {
          const tf = (p.tf * (k1 + 1)) / (p.tf + k1 * (1 - b + (b * docLen) / avgLen));
          tokenScore += tf * idf * 2.5;
        }

        if (tokenScore > 0) {
          const currentScore = candidateScores.get(docIdx) || 0;
          candidateScores.set(docIdx, currentScore + tokenScore);

          let termsSet = candidateMatchedTerms.get(docIdx);
          if (!termsSet) {
            termsSet = new Set<string>();
            candidateMatchedTerms.set(docIdx, termsSet);
          }
          termsSet.add(token);
        }
      }
    }

    // Exact query substring bonus & assemble results
    const results: SearchResult[] = [];

    for (const [docIdx, rawScore] of candidateScores.entries()) {
      const sym = this.symbols[docIdx];
      let score = rawScore;

      if (lowerQuery.length > 3) {
        if (sym.name.toLowerCase().includes(lowerQuery) || sym.snippet.toLowerCase().includes(lowerQuery)) {
          score += 20;
        }
      }

      const matchedTerms = Array.from(candidateMatchedTerms.get(docIdx) || []);
      results.push({
        symbol: sym,
        score: Math.round(score * 100) / 100,
        matchedTerms,
      });
    }

    // Fallback: If inverted index had zero token hits, fallback to query substring search
    if (results.length === 0 && lowerQuery.length > 2) {
      for (let i = 0; i < this.symbols.length; i++) {
        const sym = this.symbols[i];
        if (sym.name.toLowerCase().includes(lowerQuery) || sym.filePath.toLowerCase().includes(lowerQuery)) {
          results.push({
            symbol: sym,
            score: 15.0,
            matchedTerms: [lowerQuery],
          });
          if (results.length >= maxResults) break;
        }
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxResults);
  }

  /**
   * Graph Traversal: BFS to find all transitive dependencies of a symbol.
   */
  public getTransitiveDependencies(symbolIdOrName: string, maxDepth = 5): CodeSymbol[] {
    const rootNode = this.findSymbolNode(symbolIdOrName);
    if (!rootNode) return [];

    const visited = new Set<string>([rootNode.id]);
    const queue: Array<{ node: SymbolNode; depth: number }> = [{ node: rootNode, depth: 0 }];
    const result: CodeSymbol[] = [];

    while (queue.length > 0) {
      const { node, depth } = queue.shift()!;
      if (depth > 0) result.push(node.symbol);
      if (depth >= maxDepth) continue;

      for (const depId of node.dependencies) {
        if (!visited.has(depId)) {
          visited.add(depId);
          const depNode = this.symbolGraph.get(depId);
          if (depNode) {
            queue.push({ node: depNode, depth: depth + 1 });
          }
        }
      }
    }

    return result;
  }

  /**
   * Graph Traversal: BFS to find all transitive dependents (callers/importers).
   */
  public getTransitiveDependents(symbolIdOrName: string, maxDepth = 5): CodeSymbol[] {
    const rootNode = this.findSymbolNode(symbolIdOrName);
    if (!rootNode) return [];

    const visited = new Set<string>([rootNode.id]);
    const queue: Array<{ node: SymbolNode; depth: number }> = [{ node: rootNode, depth: 0 }];
    const result: CodeSymbol[] = [];

    while (queue.length > 0) {
      const { node, depth } = queue.shift()!;
      if (depth > 0) result.push(node.symbol);
      if (depth >= maxDepth) continue;

      for (const depId of node.dependents) {
        if (!visited.has(depId)) {
          visited.add(depId);
          const depNode = this.symbolGraph.get(depId);
          if (depNode) {
            queue.push({ node: depNode, depth: depth + 1 });
          }
        }
      }
    }

    return result;
  }

  /**
   * Graph Traversal: Shortest path between two symbols using BFS.
   */
  public findSymbolPath(startSymbol: string, targetSymbol: string): string[] | null {
    const startNode = this.findSymbolNode(startSymbol);
    const targetNode = this.findSymbolNode(targetSymbol);
    if (!startNode || !targetNode) return null;
    if (startNode.id === targetNode.id) return [startNode.id];

    const visited = new Set<string>([startNode.id]);
    const parentMap = new Map<string, string>();
    const queue: string[] = [startNode.id];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (currentId === targetNode.id) {
        // Reconstruct path
        const pathArr: string[] = [currentId];
        let curr = currentId;
        while (parentMap.has(curr)) {
          curr = parentMap.get(curr)!;
          pathArr.unshift(curr);
        }
        return pathArr;
      }

      const node = this.symbolGraph.get(currentId);
      if (!node) continue;

      for (const neighborId of [...node.dependencies, ...node.dependents]) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          parentMap.set(neighborId, currentId);
          queue.push(neighborId);
        }
      }
    }

    return null;
  }

  private findSymbolNode(nameOrId: string): SymbolNode | undefined {
    if (this.symbolGraph.has(nameOrId)) {
      return this.symbolGraph.get(nameOrId);
    }
    for (const [id, node] of this.symbolGraph.entries()) {
      if (node.symbol.name === nameOrId || id.endsWith(`:${nameOrId}`)) {
        return node;
      }
    }
    return undefined;
  }

  public formatSemanticContextForPrompt(query: string): string {
    const searchResults = this.search(query, 5);
    if (searchResults.length === 0) return '';

    const lines = [
      '### RELEVANT CODEBASE SYMBOLS & CONTEXT (Auto-Retrieved via Codebase Indexer):',
    ];

    for (const res of searchResults) {
      const sym = res.symbol;
      lines.push(`\n- **[${sym.kind.toUpperCase()}] \`${sym.name}\`** in \`${sym.filePath}:${sym.line}\` (relevance: ${res.score}):`);
      lines.push('```' + (sym.filePath.endsWith('.tsx') || sym.filePath.endsWith('.ts') ? 'typescript' : ''));
      lines.push(sym.snippet.slice(0, 400));
      lines.push('```');
    }

    return lines.join('\n');
  }
}

export const codebaseIndexer = new CodebaseIndexer(fsTools.getWorkspaceRoot());

