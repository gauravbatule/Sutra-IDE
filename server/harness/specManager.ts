import fs from 'fs';
import path from 'path';

export interface SpecMetadata {
  goalTitle: string;
  version: string;
  createdAt: number;
  updatedAt: number;
  milestones: Array<{ id: string; title: string; completed: boolean }>;
  invariants: string[];
  apiContracts: string[];
  fileMap: {[ filePath: string]: string };
}

export class SpecManager {
  private workspaceRoot: string;
  private specDir: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.specDir = path.join(workspaceRoot, '.sutra', 'specs');
    if (!fs.existsSync(this.specDir)) {
      fs.mkdirSync(this.specDir, { recursive: true });
    }
  }

  public createSpec(goalTitle: string, opts: Partial<SpecMetadata> = {}): SpecMetadata {
    const spec: SpecMetadata = {
      goalTitle,
      version: '1.0.0',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      milestones: opts.milestones || [
        { id: '1', title: 'Discover and architect data models', completed: false },
        { id: '2', title: 'Implement core components', completed: false },
        { id: '3', title: 'Ground-truth verification & tests', completed: false },
      ],
      invariants: opts.invariants || [
        'Zero toy/placeholder stubs',
        '100% TypeScript/Eslint/Vitest passing',
      ],
      apiContracts: opts.apiContracts || [],
      fileMap: opts.fileMap || {},
    };

    this.saveSpec(spec);
    return spec;
  }

  public saveSpec(spec: SpecMetadata): void {
    spec.updatedAt = Date.now();
    const filePath = path.join(this.specDir, 'active_spec.json');
    fs.writeFileSync(filePath, JSON.stringify(spec, null, 2), 'utf8');
  }

  public getActiveSpec(): SpecMetadata | null {
    try {
      const filePath = path.join(this.specDir, 'active_spec.json');
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    } catch {
      // Ignore parsing error
    }
    return null;
  }

  public updateMilestone(id: string, completed: boolean): boolean {
    const spec = this.getActiveSpec();
    if (!spec) return false;
    const m = spec.milestones.find(item => item.id === id);
    if (m) {
      m.completed = completed;
      this.saveSpec(spec);
      return true;
    }
    return false;
  }

  public getComplianceScore(): { completionRatio: number; missingMilestones: string[] } {
    const spec = this.getActiveSpec();
    if (!spec || spec.milestones.length === 0) {
      return { completionRatio: 1.0, missingMilestones: [] };
    }
    const done = spec.milestones.filter(m => m.completed).length;
    const missing = spec.milestones.filter(m => !m.completed).map(m => m.title);
    return {
      completionRatio: done / spec.milestones.length,
      missingMilestones: missing,
    };
  }

  public setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root;
    this.specDir = path.join(root, '.sutra', 'specs');
  }
}

export const specManager = new SpecManager(process.cwd());
