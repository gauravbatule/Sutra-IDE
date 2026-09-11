import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { fsTools } from './tools/fsTools.js';
import { ptyManager } from './ptyManager.js';
import { mediaEngine } from './mediaEngine.js';
import { initArtifacts } from './artifacts.js';

export interface ScratchWorkspaceMeta {
  id: string;
  name: string;
  path: string;
  template: string;
  createdAt: number;
  lastActive: number;
  description?: string;
  tags?: string[];
}

const ADJECTIVES = [
  'swift', 'bright', 'cyber', 'quantum', 'zen', 'stellar', 'hyper', 'nexus',
  'lunar', 'solar', 'aurora', 'vivid', 'cosmic', 'atomic', 'vector', 'prime'
];

const NOUNS = [
  'falcon', 'orbit', 'pulse', 'beacon', 'forge', 'harbor', 'haven', 'prism',
  'canvas', 'engine', 'matrix', 'stream', 'spark', 'craft', 'gateway', 'vertex'
];

export class ScratchWorkspaceManager {
  private baseDir: string;

  constructor(customBaseDir?: string) {
    if (customBaseDir) {
      this.baseDir = customBaseDir;
    } else {
      // Prefer ~/.sutra/scratch, or fallback to .gemini/antigravity/scratch if available
      const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
      const antigravityScratch = path.join(home, '.gemini', 'antigravity', 'scratch');
      if (fs.existsSync(antigravityScratch)) {
        this.baseDir = antigravityScratch;
      } else {
        this.baseDir = path.join(home, '.sutra', 'scratch');
      }
    }
    this.ensureBaseDir();
  }

  private ensureBaseDir(): void {
    try {
      if (!fs.existsSync(this.baseDir)) {
        fs.mkdirSync(this.baseDir, { recursive: true });
      }
    } catch (err: any) {
      console.warn(`[ScratchManager] Failed to create baseDir ${this.baseDir}:`, err.message);
    }
  }

  public getBaseDir(): string {
    return this.baseDir;
  }

  /**
   * Generates a unique, memorable project slug (e.g. "swift-beacon" or "zen-forge-42")
   */
  public generateSlug(prefix = 'scratch'): string {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const rand = Math.floor(Math.random() * 900 + 100);
    return `${prefix}-${adj}-${noun}-${rand}`;
  }

  /**
   * Creates an isolated scratch workspace inspired by Antigravity's .scratch pattern.
   * Initializes starter templates, sets up git, writes metadata, and activates the workspace.
   */
  public createScratchWorkspace(options: {
    name?: string;
    template?: 'web' | 'react' | 'node' | 'python' | 'empty';
    prompt?: string;
    description?: string;
    activate?: boolean;
    codebaseIndexer?: any;
    db?: any;
  }): ScratchWorkspaceMeta {
    this.ensureBaseDir();

    const rawName = options.name?.trim() || this.generateSlug();
    const safeName = rawName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase() || `scratch-${Date.now()}`;
    const workspacePath = path.join(this.baseDir, safeName);
    const template = options.template || 'web';

    if (!fs.existsSync(workspacePath)) {
      fs.mkdirSync(workspacePath, { recursive: true });
    }

    // Populate template files
    this.populateTemplate(workspacePath, safeName, template, options.description || options.prompt);

    // Initialize Git repository so checkpoints and diff tracking work out of the box
    try {
      if (!fs.existsSync(path.join(workspacePath, '.git'))) {
        execSync('git init', { cwd: workspacePath, stdio: 'ignore' });
        execSync('git add -A', { cwd: workspacePath, stdio: 'ignore' });
        execSync('git commit -m "Initial commit from SUTRA Scratchpad"', { cwd: workspacePath, stdio: 'ignore' });
      }
    } catch {
      // Git is optional if not installed
    }

    const meta: ScratchWorkspaceMeta = {
      id: `scratch-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: safeName,
      path: workspacePath,
      template,
      createdAt: Date.now(),
      lastActive: Date.now(),
      description: options.description || options.prompt || `Scratchpad workspace for ${safeName}`,
      tags: ['scratch', template],
    };

    try {
      fs.writeFileSync(
        path.join(workspacePath, '.scratch_meta.json'),
        JSON.stringify(meta, null, 2),
        'utf-8'
      );
    } catch {}

    // Activate if requested (default: true)
    if (options.activate !== false) {
      this.activateWorkspace(workspacePath, options.codebaseIndexer, options.db);
    }

    return meta;
  }

  /**
   * Switches the active IDE workspace to the scratchpad path
   */
  public activateWorkspace(targetPath: string, codebaseIndexer?: any, db?: any): void {
    const resolved = path.resolve(targetPath);
    fsTools.setWorkspaceRoot(resolved);
    ptyManager.setWorkspaceRoot(resolved);
    mediaEngine.setProjectRoot(resolved);
    initArtifacts(resolved);

    if (codebaseIndexer) {
      codebaseIndexer.setWorkspaceRoot(resolved);
      codebaseIndexer.buildIndex().catch(() => {});
    }

    if (db) {
      try {
        db.prepare(
          `INSERT INTO system_config (key, value) VALUES ('active_workspace', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
        ).run(resolved);
      } catch {}
    }
  }

  /**
   * Lists all existing scratch workspaces with metadata
   */
  public listScratchWorkspaces(): ScratchWorkspaceMeta[] {
    this.ensureBaseDir();
    const results: ScratchWorkspaceMeta[] = [];

    try {
      const entries = fs.readdirSync(this.baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dirPath = path.join(this.baseDir, entry.name);
        const metaPath = path.join(dirPath, '.scratch_meta.json');

        if (fs.existsSync(metaPath)) {
          try {
            const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
            results.push(parsed);
            continue;
          } catch {}
        }

        // Fallback metadata for folders created without meta file
        const stat = fs.statSync(dirPath);
        results.push({
          id: `scratch-${entry.name}`,
          name: entry.name,
          path: dirPath,
          template: 'custom',
          createdAt: stat.birthtimeMs || stat.mtimeMs,
          lastActive: stat.mtimeMs,
          description: `Scratchpad: ${entry.name}`,
          tags: ['scratch'],
        });
      }
    } catch (err: any) {
      console.warn('[ScratchManager] Failed to list scratchpads:', err.message);
    }

    return results.sort((a, b) => b.lastActive - a.lastActive);
  }

  /**
   * Promotes a scratchpad to a permanent user directory
   */
  public promoteScratchWorkspace(scratchPath: string, destinationDir: string): { success: boolean; newPath: string } {
    const source = path.resolve(scratchPath);
    const dest = path.resolve(destinationDir);

    if (!fs.existsSync(source)) {
      throw new Error(`Scratch workspace not found at "${source}".`);
    }

    if (!fs.existsSync(path.dirname(dest))) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
    }

    // Copy directory recursively
    fs.cpSync(source, dest, { recursive: true });

    return { success: true, newPath: dest };
  }

  /**
   * Populates starter files based on chosen template
   */
  private populateTemplate(
    targetPath: string,
    name: string,
    template: string,
    description?: string
  ): void {
    const descText = description || `Created with SUTRA Scratchpad.`;

    if (template === 'web' || template === 'html') {
      fs.writeFileSync(
        path.join(targetPath, 'index.html'),
        `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${name}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="card">
    <h1>${name}</h1>
    <p>${descText}</p>
    <button id="btn">Get Started</button>
  </div>
  <script src="script.js"></script>
</body>
</html>`,
        'utf-8'
      );

      fs.writeFileSync(
        path.join(targetPath, 'style.css'),
        `* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #09090b;
  color: #f4f4f5;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
}
.card {
  text-align: center;
  padding: 2.5rem;
  background: #18181b;
  border: 1px solid #27272a;
  border-radius: 0.75rem;
  box-shadow: 0 10px 25px rgba(0,0,0,0.5);
  max-width: 480px;
}
h1 { font-size: 1.75rem; margin-bottom: 0.75rem; font-weight: 600; }
p { color: #a1a1aa; font-size: 0.95rem; margin-bottom: 1.5rem; line-height: 1.5; }
button {
  background: #3b82f6;
  color: #ffffff;
  border: none;
  padding: 0.6rem 1.4rem;
  font-size: 0.9rem;
  font-weight: 500;
  border-radius: 0.375rem;
  cursor: pointer;
  transition: background 0.15s;
}
button:hover { background: #2563eb; }`,
        'utf-8'
      );

      fs.writeFileSync(
        path.join(targetPath, 'script.js'),
        `document.getElementById('btn')?.addEventListener('click', () => {
  console.log('Scratchpad ${name} interactive!');
});`,
        'utf-8'
      );
    } else if (template === 'node' || template === 'ts') {
      fs.writeFileSync(
        path.join(targetPath, 'package.json'),
        JSON.stringify(
          {
            name,
            version: '1.0.0',
            type: 'module',
            description: descText,
            scripts: { start: 'node index.js' },
          },
          null,
          2
        ),
        'utf-8'
      );
      fs.writeFileSync(
        path.join(targetPath, 'index.js'),
        `// ${name}\nconsole.log('Running ${name} in SUTRA Scratchpad...');\n`,
        'utf-8'
      );
    } else if (template === 'python') {
      fs.writeFileSync(
        path.join(targetPath, 'main.py'),
        `# ${name}\ndef main():\n    print("Running ${name} in SUTRA Scratchpad")\n\nif __name__ == "__main__":\n    main()\n`,
        'utf-8'
      );
    }

    // Always include a README.md
    fs.writeFileSync(
      path.join(targetPath, 'README.md'),
      `# ${name}\n\n${descText}\n\n*Isolated scratchpad environment created with SUTRA IDE.*\n`,
      'utf-8'
    );
  }
}

export const scratchManager = new ScratchWorkspaceManager();
