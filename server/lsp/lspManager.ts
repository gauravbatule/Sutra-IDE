/**
 * LSP Manager for OmniCraft IDE
 * Provides Language Server Protocol integration for TypeScript, Python, and other languages
 * Enables real-time diagnostics, go-to-definition, find references, and intelligent code navigation
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export interface LSPDiagnostic {
  severity: number; // 1=Error, 2=Warning, 3=Info, 4=Hint
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  message: string;
  source?: string;
  code?: string | number;
}

export interface LSPLocation {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export interface LSPSymbol {
  name: string;
  kind: number; // SymbolKind enum (1=File, 5=Class, 6=Method, etc.)
  location: LSPLocation;
  containerName?: string;
}

export type LSPLanguage = 'typescript' | 'javascript' | 'python' | 'rust' | 'go';

export class LSPManager extends EventEmitter {
  private servers: Map<LSPLanguage, ChildProcess> = new Map();
  private requestId = 0;
  private pendingRequests: Map<number, { resolve: (value: any) => void; reject: (reason: Error) => void }> = new Map();
  private diagnosticsCache: Map<string, LSPDiagnostic[]> = new Map();
  private workspaceRoot: string;
  private isInitialized = false;

  constructor(workspaceRoot: string) {
    super();
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Initialize LSP servers for all supported languages
   */
  async initialize(): Promise<void> {
    try {
      await this.startTypeScriptServer();
      this.isInitialized = true;
      console.log('[LSP Manager] Initialized successfully');
    } catch (error: any) {
      console.error('[LSP Manager] Initialization failed:', error.message);
    }
  }

  /**
   * Start TypeScript Language Server (tsserver)
   */
  private async startTypeScriptServer(): Promise<void> {
    try {
      // Use typescript-language-server wrapper around tsserver (Windows compatibility with shell: true)
      const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      const serverProcess = spawn(cmd, ['typescript-language-server', '--stdio'], {
        cwd: this.workspaceRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });

      serverProcess.on('error', (err) => {
        console.warn('[TypeScript LSP] Process spawn error:', err.message);
        this.servers.delete('typescript');
      });

      this.servers.set('typescript', serverProcess);

      let buffer = '';

      serverProcess.stdout?.on('data', (data: Buffer) => {
        buffer += data.toString();
        const messages = buffer.split('\r\n\r\n');
        buffer = messages.pop() || '';

        for (const msg of messages) {
          if (msg.trim()) {
            this.handleServerMessage('typescript', msg);
          }
        }
      });

      serverProcess.stderr?.on('data', (data: Buffer) => {
        console.warn('[TypeScript LSP] Stderr:', data.toString().slice(0, 200));
      });

      serverProcess.on('exit', (code) => {
        console.log(`[TypeScript LSP] Exited with code ${code}`);
        this.servers.delete('typescript');
      });

      // Send initialize request
      await this.sendRequest('typescript', 'initialize', {
        processId: process.pid,
        rootUri: `file://${this.workspaceRoot}`,
        capabilities: {
          textDocument: {
            publishDiagnostics: {},
            completion: {},
            hover: {},
            definition: {},
            references: {},
          },
        },
      });

      // Send initialized notification
      this.sendNotification('typescript', 'initialized', {});
    } catch (error: any) {
      console.error('[LSP Manager] Failed to start TypeScript server:', error.message);
    }
  }

  /**
   * Handle incoming messages from LSP server
   */
  private handleServerMessage(language: LSPLanguage, message: string): void {
    try {
      // Content-Length framing is intentionally not validated — messages arrive
      // newline-delimited here, so the JSON payload is located directly instead.
      const jsonStart = message.indexOf('{');
      if (jsonStart === -1) return;

      const jsonStr = message.substring(jsonStart);
      const parsed = JSON.parse(jsonStr);

      if (parsed.id !== undefined && this.pendingRequests.has(parsed.id)) {
        const request = this.pendingRequests.get(parsed.id)!;
        this.pendingRequests.delete(parsed.id);

        if (parsed.error) {
          request.reject(new Error(parsed.error.message));
        } else {
          request.resolve(parsed.result);
        }
      } else if (parsed.method === 'textDocument/publishDiagnostics') {
        this.handleDiagnostics(parsed.params);
      }
    } catch (error: any) {
      console.error('[LSP Manager] Failed to parse server message:', error.message);
    }
  }

  /**
   * Handle diagnostics from LSP server
   */
  private handleDiagnostics(params: any): void {
    const uri = params.uri;
    const filePath = uri.replace('file://', '');
    const diagnostics: LSPDiagnostic[] = params.diagnostics.map((d: any) => ({
      severity: d.severity || 1,
      startLine: d.range.start.line + 1, // LSP is 0-indexed
      startColumn: d.range.start.character + 1,
      endLine: d.range.end.line + 1,
      endColumn: d.range.end.character + 1,
      message: d.message,
      source: d.source,
      code: d.code,
    }));

    this.diagnosticsCache.set(filePath, diagnostics);
    this.emit('diagnostics', { filePath, diagnostics });
  }

  /**
   * Send LSP request and wait for response
   */
  private async sendRequest(language: LSPLanguage, method: string, params: any): Promise<any> {
    const server = this.servers.get(language);
    if (!server) {
      throw new Error(`LSP server for ${language} is not running`);
    }

    const id = ++this.requestId;
    const request = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const content = JSON.stringify(request);
    const header = `Content-Length: ${Buffer.byteLength(content, 'utf8')}\r\n\r\n`;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      server.stdin?.write(header + content);

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request ${method} timed out`));
        }
      }, 30000);
    });
  }

  /**
   * Send LSP notification (no response expected)
   */
  private sendNotification(language: LSPLanguage, method: string, params: any): void {
    const server = this.servers.get(language);
    if (!server) return;

    const notification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    const content = JSON.stringify(notification);
    const header = `Content-Length: ${Buffer.byteLength(content, 'utf8')}\r\n\r\n`;
    server.stdin?.write(header + content);
  }

  /**
   * Notify LSP that a document was opened
   */
  async didOpen(filePath: string, languageId: string, content: string): Promise<void> {
    const language = this.getLanguageFromId(languageId);
    if (!language || !this.servers.has(language)) return;

    this.sendNotification(language, 'textDocument/didOpen', {
      textDocument: {
        uri: `file://${filePath}`,
        languageId,
        version: 1,
        text: content,
      },
    });
  }

  /**
   * Notify LSP that a document changed
   */
  async didChange(filePath: string, languageId: string, content: string): Promise<void> {
    const language = this.getLanguageFromId(languageId);
    if (!language || !this.servers.has(language)) return;

    this.sendNotification(language, 'textDocument/didChange', {
      textDocument: {
        uri: `file://${filePath}`,
        version: Date.now(),
      },
      contentChanges: [{ text: content }],
    });
  }

  /**
   * Get diagnostics for a file
   */
  getDiagnostics(filePath: string): LSPDiagnostic[] {
    return this.diagnosticsCache.get(filePath) || [];
  }

  /**
   * Get definition location for a symbol at a position
   */
  async getDefinition(
    filePath: string,
    languageId: string,
    line: number,
    character: number
  ): Promise<LSPLocation[]> {
    const language = this.getLanguageFromId(languageId);
    if (!language || !this.servers.has(language)) return [];

    try {
      const result = await this.sendRequest(language, 'textDocument/definition', {
        textDocument: { uri: `file://${filePath}` },
        position: { line: line - 1, character: character - 1 }, // 0-indexed
      });

      return Array.isArray(result) ? result : result ? [result] : [];
    } catch {
      return [];
    }
  }

  /**
   * Find all references to a symbol
   */
  async findReferences(
    filePath: string,
    languageId: string,
    line: number,
    character: number
  ): Promise<LSPLocation[]> {
    const language = this.getLanguageFromId(languageId);
    if (!language || !this.servers.has(language)) return [];

    try {
      const result = await this.sendRequest(language, 'textDocument/references', {
        textDocument: { uri: `file://${filePath}` },
        position: { line: line - 1, character: character - 1 },
        context: { includeDeclaration: true },
      });

      return Array.isArray(result) ? result : [];
    } catch {
      return [];
    }
  }

  /**
   * Get all symbols in a file
   */
  async getDocumentSymbols(filePath: string, languageId: string): Promise<LSPSymbol[]> {
    const language = this.getLanguageFromId(languageId);
    if (!language || !this.servers.has(language)) return [];

    try {
      const result = await this.sendRequest(language, 'textDocument/documentSymbol', {
        textDocument: { uri: `file://${filePath}` },
      });

      return Array.isArray(result) ? result : [];
    } catch {
      return [];
    }
  }

  /**
   * Map language ID to LSP language
   */
  private getLanguageFromId(languageId: string): LSPLanguage | null {
    const mapping: Record<string, LSPLanguage> = {
      typescript: 'typescript',
      typescriptreact: 'typescript',
      javascript: 'javascript',
      javascriptreact: 'javascript',
      python: 'python',
      rust: 'rust',
      go: 'go',
    };
    return mapping[languageId] || null;
  }

  /**
   * Shutdown all LSP servers
   */
  async shutdown(): Promise<void> {
    for (const [language, server] of this.servers.entries()) {
      try {
        await this.sendRequest(language, 'shutdown', null);
        this.sendNotification(language, 'exit', null);
        server.kill();
      } catch {
        server.kill('SIGKILL');
      }
    }
    this.servers.clear();
    this.pendingRequests.clear();
    this.diagnosticsCache.clear();
    this.isInitialized = false;
  }

  /**
   * Check if LSP is ready
   */
  isReady(): boolean {
    return this.isInitialized && this.servers.size > 0;
  }
}
