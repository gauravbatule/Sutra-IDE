/**
 * SUTRA Studio — Multi-File AST & Symbol Gatherer
 * Automatically parses imports, exported types, and related declarations before editing files.
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

    const content = fs.readFileSync(fullPath, 'utf-8');
    const importedFiles: string[] = [];
    const exportedSymbols: string[] = [];
    const typeSignatures: string[] = [];

    // Parse import statements
    const importRegex = /import\s+(?:(?:\{[^}]+\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[1];
      if (importPath.startsWith('.')) {
        importedFiles.push(importPath);
      }
    }

    // Parse exported functions, interfaces, types, classes
    const exportRegex = /export\s+(?:const|function|interface|type|class)\s+([a-zA-Z0-9_$]+)/g;
    while ((match = exportRegex.exec(content)) !== null) {
      exportedSymbols.push(match[1]);
    }

    // Read interface/type definitions in the file
    const typeRegex = /(?:export\s+)?(?:interface|type)\s+[a-zA-Z0-9_$]+[^=;{]+(?:=[^;]+|\{[^}]+\})/g;
    while ((match = typeRegex.exec(content)) !== null) {
      typeSignatures.push(match[0].slice(0, 300));
    }

    return { importedFiles, exportedSymbols, typeSignatures: typeSignatures.slice(0, 10) };
  }
}

export const astGatherer = new ASTGatherer();
