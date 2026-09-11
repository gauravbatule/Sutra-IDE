/**
 * LSP Tools for Agent Harness
 * Provides language-aware code intelligence tools for the AI agent
 */

import { LSPManager, LSPDiagnostic, LSPLocation } from '../lsp/lspManager.js';

export class LSPTools {
  private lspManager: LSPManager | null = null;

  setLSPManager(manager: LSPManager): void {
    this.lspManager = manager;
  }

  /**
   * Get TypeScript/ESLint diagnostics for a file
   */
  async getDiagnostics(filePath: string): Promise<{
    success: boolean;
    diagnostics?: LSPDiagnostic[];
    error?: string;
  }> {
    if (!this.lspManager?.isReady()) {
      return {
        success: false,
        error: 'LSP server is not initialized. Start the language server first.',
      };
    }

    try {
      const diagnostics = this.lspManager.getDiagnostics(filePath);
      return {
        success: true,
        diagnostics,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Go to definition of a symbol
   */
  async goToDefinition(
    filePath: string,
    line: number,
    character: number,
    languageId: string = 'typescript'
  ): Promise<{
    success: boolean;
    locations?: LSPLocation[];
    error?: string;
  }> {
    if (!this.lspManager?.isReady()) {
      return {
        success: false,
        error: 'LSP server is not initialized.',
      };
    }

    try {
      const locations = await this.lspManager.getDefinition(filePath, languageId, line, character);
      return {
        success: true,
        locations,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Find all references to a symbol
   */
  async findReferences(
    filePath: string,
    line: number,
    character: number,
    languageId: string = 'typescript'
  ): Promise<{
    success: boolean;
    references?: LSPLocation[];
    count?: number;
    error?: string;
  }> {
    if (!this.lspManager?.isReady()) {
      return {
        success: false,
        error: 'LSP server is not initialized.',
      };
    }

    try {
      const references = await this.lspManager.findReferences(filePath, languageId, line, character);
      return {
        success: true,
        references,
        count: references.length,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get all symbols in a document (classes, functions, variables)
   */
  async getSymbols(
    filePath: string,
    languageId: string = 'typescript'
  ): Promise<{
    success: boolean;
    symbols?: any[];
    error?: string;
  }> {
    if (!this.lspManager?.isReady()) {
      return {
        success: false,
        error: 'LSP server is not initialized.',
      };
    }

    try {
      const symbols = await this.lspManager.getDocumentSymbols(filePath, languageId);
      return {
        success: true,
        symbols,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Format diagnostics into a human-readable string for agent context
   */
  formatDiagnosticsForPrompt(diagnostics: LSPDiagnostic[]): string {
    if (!diagnostics || diagnostics.length === 0) {
      return 'No diagnostics found. File is clean.';
    }

    const errors = diagnostics.filter((d) => d.severity === 1);
    const warnings = diagnostics.filter((d) => d.severity === 2);
    const info = diagnostics.filter((d) => d.severity >= 3);

    let output = `Found ${diagnostics.length} diagnostic(s):\n`;

    if (errors.length > 0) {
      output += `\n❌ ERRORS (${errors.length}):\n`;
      errors.forEach((d) => {
        output += `  Line ${d.startLine}:${d.startColumn} - ${d.message}\n`;
      });
    }

    if (warnings.length > 0) {
      output += `\n⚠️  WARNINGS (${warnings.length}):\n`;
      warnings.forEach((d) => {
        output += `  Line ${d.startLine}:${d.startColumn} - ${d.message}\n`;
      });
    }

    if (info.length > 0) {
      output += `\nℹ️  INFO (${info.length}):\n`;
      info.slice(0, 3).forEach((d) => {
        output += `  Line ${d.startLine}:${d.startColumn} - ${d.message}\n`;
      });
      if (info.length > 3) {
        output += `  ... and ${info.length - 3} more\n`;
      }
    }

    return output;
  }
}

export const lspTools = new LSPTools();
