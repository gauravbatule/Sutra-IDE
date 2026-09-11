/**
 * SUTRA Studio — Multi-File AST & Symbol Gatherer
 * Automatically parses imports, exported types, and related declarations before editing files.
 * Sanitizes and compacts symbol context to prevent token bloat or AST dumps.
 */
import fs from 'fs';
import path from 'path';

export interface SymbolContext {
  importedFiles: string[];
  exportedSymbols: string[];
  typeSignatures: string[];
}

export class ASTGatherer {
  private workspaceRoot: string = process.cwd();

  public setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root;
  }

  public gatherContextForFile(relativeFilePath: string): SymbolContext {
    const fullPath = path.resolve(this.workspaceRoot, relativeFilePath);
    if (!fs.existsSync(fullPath)) {
      return { importedFiles: [], exportedSymbols: [], typeSignatures: [] };
    }

    try {
      const stat = fs.statSync(fullPath);
      // Skip giant data files > 2MB
      if (stat.size > 2 * 1024 * 1024) {
        return { importedFiles: [], exportedSymbols: [], typeSignatures: [] };
      }

      const content = fs.readFileSync(fullPath, 'utf-8');
      const importedFiles: string[] = [];
      const exportedSymbols: string[] = [];
      const typeSignatures: string[] = [];

      // Parse import statements (local relative imports only)
      const importRegex = /import\s+(?:(?:\{[^}]+\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g;
      let match: RegExpExecArray | null;
      while ((match = importRegex.exec(content)) !== null) {
        const importPath = match[1];
        if (importPath.startsWith('.')) {
          importedFiles.push(importPath);
        }
      }

      // Parse exported functions, interfaces, types, classes, consts
      const exportRegex = /export\s+(?:const|function|interface|type|class|enum)\s+([a-zA-Z0-9_$]+)/g;
      while ((match = exportRegex.exec(content)) !== null) {
        if (!exportedSymbols.includes(match[1])) {
          exportedSymbols.push(match[1]);
        }
      }

      // Read interface/type declarations, sanitizing multi-line whitespace and stripping bloated bodies
      const typeRegex = /(?:export\s+)?(?:interface|type)\s+([a-zA-Z0-9_$]+)[^=;{]+(?:=[^;\n]+|\{[^}\n]*\})/g;
      while ((match = typeRegex.exec(content)) !== null) {
        const cleaned = match[0].replace(/\s+/g, ' ').trim().slice(0, 120);
        if (cleaned && !typeSignatures.includes(cleaned)) {
          typeSignatures.push(cleaned);
        }
      }

      return {
        importedFiles: importedFiles.slice(0, 8),
        exportedSymbols: exportedSymbols.slice(0, 15),
        typeSignatures: typeSignatures.slice(0, 6),
      };
    } catch {
      return { importedFiles: [], exportedSymbols: [], typeSignatures: [] };
    }
  }

  /**
   * Formats a concise 1-2 line summary of symbol context suitable for minimal prompt inclusion.
   */
  public formatCompactSummary(context: SymbolContext): string {
    const parts: string[] = [];
    if (context.importedFiles.length > 0) {
      parts.push(`Imports: [${context.importedFiles.join(', ')}]`);
    }
    if (context.exportedSymbols.length > 0) {
      parts.push(`Exports: [${context.exportedSymbols.join(', ')}]`);
    }
    if (context.typeSignatures.length > 0) {
      parts.push(`Types: [${context.typeSignatures.map((t) => t.split(' ')[1] || t).join(', ')}]`);
    }
    return parts.join(' | ');
  }
}

export const astGatherer = new ASTGatherer();

