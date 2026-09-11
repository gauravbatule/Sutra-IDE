import fs from 'fs';
import path from 'path';

export interface SkillDefinition {
  name: string;
  description: string;
  path: string;
  triggers: string[];
  content: string;
}

export class SkillVault {
  private workspaceRoot: string;
  private skillsDir: string;
  private skillsCache: Map<string, SkillDefinition> = new Map();

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.skillsDir = path.join(workspaceRoot, '.agentskills');
    if (!fs.existsSync(this.skillsDir)) {
      fs.mkdirSync(this.skillsDir, { recursive: true });
    }
    this.refreshSkills();
  }


  public refreshSkills(): void {
    this.skillsCache.clear();
    if (!fs.existsSync(this.skillsDir)) return;

    try {
      const files = fs.readdirSync(this.skillsDir);
      for (const file of files) {
        if (file.endsWith('.md')) {
          const fullPath = path.join(this.skillsDir, file);
          const content = fs.readFileSync(fullPath, 'utf8');
          const name = file.replace(/\.md$/i, '');
          const firstLine = content.split('\n')[0] || '';
          const desc = firstLine.replace(/^[#\s]+/, '').trim() || name;

          this.skillsCache.set(name, {
            name,
            description: desc,
            path: fullPath,
            triggers: [name, ...desc.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)],
            content,
          });
        }
      }
    } catch {
      // Ignore directory read errors
    }
  }

  public findRelevantSkills(prompt: string, limit = 3): SkillDefinition[] {
    const loaded: SkillDefinition[] = [];
    const logic = prompt.toLowerCase();

    for (const skill of this.skillsCache.values()) {
      const nameMatch = logic.includes(skill.name.toLowerCase());
      const triggerMatch = skill.triggers.some((t) => t.length > 3 && logic.includes(t));

      if (nameMatch || triggerMatch) {
        loaded.push(skill);
        if (loaded.length >= limit) break;
      }
    }
    return loaded;
  }

  public getSkill(name: string): SkillDefinition | undefined {
    return this.skillsCache.get(name);
  }

  public addSkill(name: string, content: string): void {
    const filePath = path.join(this.skillsDir, `${name}.md`);
    fs.writeFileSync(filePath, content, 'utf8');
    this.refreshSkills();
  }

  public setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root;
    this.skillsDir = path.join(root, '.agentskills');
    if (!fs.existsSync(this.skillsDir)) {
      try { fs.mkdirSync(this.skillsDir, { recursive: true }); } catch {}
    }
    this.refreshSkills();
  }
}

export const skillVault = new SkillVault(process.cwd());
