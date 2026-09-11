import fs from 'fs';
import path from 'path';

export interface DiscoveredRule {
  id: string;
  category: 'module-resolution' | 'port-binding' | 'memory-limit' | 'path-syntax' | 'general';
  rule: string;
  evidence: string;
  timestamp: number;
}

export class ReasonDiscoveryEngine {
  private workspaceRoot: string;
  private storagePath: string;
  private rules: Map<string, DiscoveredRule> = new Map();

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    const evoDir = path.join(workspaceRoot, '.sutra', 'evolution');
    if (!fs.existsSync(evoDir)) {
      fs.mkdirSync(evoDir, { recursive: true });
    }
    this.storagePath = path.join(evoDir, 'environment_rules.json');
    this.loadFromDisk();
  }

  public analyzeFailure(errorText: string): DiscoveredRule | null {
    const lower = errorText.toLowerCase();
    let category: DiscoveredRule['category'] = 'general';
    let rule = '';

    if (lower.includes('cannot find module') || lower.includes('err_module_not_found')) {
      category = 'module-resolution';
      rule = 'Explicit .js file extensions are required for ESM resolution in this environment.';
    } else if (lower.includes('eaddrinuse') || lower.includes('address already in use')) {
      category = 'port-binding';
      rule = 'Port is already bound; use dynamic port fallback or terminate stale processes.';
    } else if (lower.includes('heap out of memory') || lower.includes('memory leak')) {
      category = 'memory-limit';
      rule = 'Allocation budget exceeded; stream or chunk large in-memory buffers.';
    } else if (lower.includes('invalid') || lower.includes('unexpected token')) {
      category = 'path-syntax';
      rule = 'Syntax invariant violation detected; ensure strict TypeScript/ES compliance.';
    } else {
      return null;
    }

    const id = `rule-${category}`;
    const discovered: DiscoveredRule = {
      id,
      category,
      rule,
      evidence: errorText.slice(0, 200),
      timestamp: Date.now(),
    };

    this.rules.set(id, discovered);
    this.saveToDisk();
    return discovered;
  }

  public getRules(): DiscoveredRule[] {
    return Array.from(this.rules.values());
  }

  private saveToDisk(): void {
    try {
      const array = Array.from(this.rules.values());
      fs.writeFileSync(this.storagePath, JSON.stringify(array, null, 2), 'utf8');
    } catch {
      // Best-effort storage persistence
    }
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(this.storagePath)) return;
    try {
      const raw = fs.readFileSync(this.storagePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && item.id) {
            this.rules.set(item.id, item);
          }
        }
      }
    } catch {
      // Fallback on clean in-memory state
    }
  }
}
