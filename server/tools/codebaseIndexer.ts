import * as fs from 'fs';
import * as path from 'path';

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

export class CodebaseIndexer {
  private workspaceRoot: string;
  private symbols: CodeSymbol[] = [];
  private fileIndex = new Map<string, string>(); // path -> content
  private lastIndexedTime = 0;
  private isIndexing = false;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  public async buildIndex(): Promise<{ symbolCount: number; fileCount: number }> {
    if (this.isIndexing) return { symbolCount: this.symbols.length, fileCount: this.fileIndex.size };
    this.isIndexing = true;
    const newSymbols: CodeSymbol[] = [];
    const newFileIndex = new Map<string, string>();

    const ignoreDirs = new Set(['node_modules', '.git', 'dist', 'build', '.gemini', '.system_generated', 'coverage']);
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
                if (stat.size < 250000) { // Limit to 250KB per file
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
      this.lastIndexedTime = Date.now();
    } finally {
      this.isIndexing = false;
    }

    return { symbolCount: this.symbols.length, fileCount: this.fileIndex.size };
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

  public search(query: string, maxResults = 6): SearchResult[] {
    const rawTokens = query
      .toLowerCase()
      .split(/[^a-z0-9_]/)
      .filter((t) => t.length > 1);

    const stopwords = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'how', 'what', 'where', 'why', 'can', 'you', 'please', 'file', 'code', 'from', 'into']);
    const tokens = rawTokens.filter((t) => !stopwords.has(t));

    if (tokens.length === 0) return [];

    // Calculate collection statistics for BM25
    const totalDocs = this.symbols.length || 1;
    const docLengths = this.symbols.map((s) => s.name.length + s.snippet.length);
    const avgDocLength = docLengths.reduce((a, b) => a + b, 0) / totalDocs || 100;
    const k1 = 1.2;
    const b = 0.75;

    // Document frequency per token
    const docFreq = new Map<string, number>();
    for (const token of tokens) {
      let count = 0;
      for (const sym of this.symbols) {
        if (sym.name.toLowerCase().includes(token) || sym.snippet.toLowerCase().includes(token)) {
          count++;
        }
      }
      docFreq.set(token, count);
    }

    const results: SearchResult[] = [];

    for (let i = 0; i < this.symbols.length; i++) {
      const sym = this.symbols[i];
      let score = 0;
      const matchedTerms: string[] = [];
      const symNameLower = sym.name.toLowerCase();
      const pathLower = sym.filePath.toLowerCase();
      const snippetLower = sym.snippet.toLowerCase();
      const docLen = docLengths[i];

      // Kind boost multiplier
      let kindMultiplier = 1.0;
      if (sym.kind === 'component' || sym.kind === 'endpoint') kindMultiplier = 1.35;
      else if (sym.kind === 'class' || sym.kind === 'interface') kindMultiplier = 1.25;
      else if (sym.kind === 'function') kindMultiplier = 1.15;

      for (const token of tokens) {
        const df = docFreq.get(token) || 0;
        const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));

        // Exact symbol name hit
        if (symNameLower === token) {
          score += 25 * idf * kindMultiplier;
          matchedTerms.push(token);
        } else if (symNameLower.includes(token)) {
          score += 12 * idf * kindMultiplier;
          matchedTerms.push(token);
        } else if (pathLower.includes(token)) {
          score += 6 * idf;
          matchedTerms.push(token);
        }

        // BM25 calculation on snippet text
        const occurrences = (snippetLower.match(new RegExp(token, 'g')) || []).length;
        if (occurrences > 0) {
          const tf = (occurrences * (k1 + 1)) / (occurrences + k1 * (1 - b + (b * docLen) / avgDocLength));
          score += tf * idf * 2.5;
          if (!matchedTerms.includes(token)) matchedTerms.push(token);
        }
      }

      // Exact full query substring bonus
      if (query.trim().length > 3 && (symNameLower.includes(query.toLowerCase()) || snippetLower.includes(query.toLowerCase()))) {
        score += 20;
      }

      if (score > 0) {
        results.push({ symbol: sym, score: Math.round(score * 100) / 100, matchedTerms });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxResults);
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
      lines.push(sym.snippet.slice(0, 1200));
      lines.push('```');
    }

    return lines.join('\n');
  }
}
