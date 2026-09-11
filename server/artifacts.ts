import fs from 'fs';
import path from 'path';

export interface WorkArtifact {
  id: string;
  chatId?: string;
  name: string;
  type: 'plan' | 'implementation' | 'design' | 'asset' | 'verification' | 'doc' | 'findings' | 'audit';
  status: 'draft' | 'in_progress' | 'done';
  content: string;
  updatedAt: number;
}

let artifactsDir = '';

export function initArtifacts(workspaceRoot: string): void {
  artifactsDir = path.join(workspaceRoot, '.sutra', 'artifacts');
  try {
    fs.mkdirSync(artifactsDir, { recursive: true });
  } catch {
    // Read-only workspace — artifacts degrade to in-memory responses
  }
  // Repair the index if a crash left it unparsable
  try {
    readIndex();
  } catch {
    writeIndex([]);
  }
}

function indexPath(): string {
  return path.join(artifactsDir, 'index.json');
}

function readIndex(): WorkArtifact[] {
  try {
    if (!fs.existsSync(indexPath())) return [];
    const raw = fs.readFileSync(indexPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeIndex(items: WorkArtifact[]): void {
  const tmpPath = `${indexPath()}.tmp.${Date.now()}`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(items, null, 2), 'utf-8');
    fs.renameSync(tmpPath, indexPath());
  } catch {
    try {
      fs.writeFileSync(indexPath(), JSON.stringify(items, null, 2), 'utf-8');
    } catch {
      // Best-effort write
    }
  }
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\- ]/g, '').trim().slice(0, 80) || 'artifact';
}

export function listArtifacts(chatId?: string): WorkArtifact[] {
  try {
    const indexed = readIndex();
    const existingIds = new Set(indexed.map((a) => a.id));

    // Auto-discover top-level workspace markdown artifacts (implementation_plan, walkthrough, findings)
    const workspaceRoot = artifactsDir ? path.dirname(path.dirname(artifactsDir)) : '';
    if (workspaceRoot && fs.existsSync(workspaceRoot)) {
      const knownFiles = [
        { file: 'implementation_plan.md', name: 'Implementation Plan', type: 'plan' as const },
        { file: 'walkthrough.md', name: 'Walkthrough', type: 'verification' as const },
        { file: 'findings.md', name: 'Diagnostic Findings', type: 'findings' as const },
        { file: 'task_progress.md', name: 'Task Progress', type: 'plan' as const },
      ];

      for (const k of knownFiles) {
        const fullPath = path.join(workspaceRoot, k.file);
        if (fs.existsSync(fullPath)) {
          const autoId = `ws-${k.file.replace('.md', '')}`;
          if (!existingIds.has(autoId)) {
            try {
              const stat = fs.statSync(fullPath);
              const content = fs.readFileSync(fullPath, 'utf-8');
              indexed.push({
                id: autoId,
                name: k.name,
                type: k.type,
                status: 'done',
                content,
                updatedAt: stat.mtimeMs || Date.now(),
              });
              existingIds.add(autoId);
            } catch {
              // Ignore unreadable
            }
          }
        }
      }
    }

    const all = indexed.sort((a, b) => b.updatedAt - a.updatedAt);
    if (!chatId || chatId === 'all') return all;
    return all.filter((a) => !a.chatId || a.chatId === chatId);
  } catch {
    return [];
  }
}

export function getArtifact(id: string): WorkArtifact | null {
  return listArtifacts().find((a) => a.id === id) || null;
}

export function deleteArtifact(id: string): boolean {
  try {
    const items = readIndex();
    const next = items.filter((a) => a.id !== id);
    writeIndex(next);
    const mdPath = path.join(artifactsDir, `${id}.md`);
    if (fs.existsSync(mdPath)) {
      try { fs.unlinkSync(mdPath); } catch {}
    }
    return true;
  } catch {
    return false;
  }
}

export function upsertArtifact(input: {
  id?: string;
  chatId?: string;
  name: string;
  type: string;
  content: string;
  status?: string;
}): WorkArtifact {
  const items = readIndex();
  const name = sanitizeName(input.name);
  const validTypes = ['plan', 'implementation', 'design', 'asset', 'verification', 'doc', 'findings', 'audit'] as const;
  const type = (validTypes as readonly string[]).includes(input.type)
    ? (input.type as WorkArtifact['type'])
    : 'doc';
  const status = (['draft', 'in_progress', 'done'] as const).includes(input.status as any)
    ? (input.status as WorkArtifact['status'])
    : 'draft';

  const existing = input.id ? items.find((a) => a.id === input.id) : items.find((a) => a.name === name);
  const artifact: WorkArtifact = {
    id: existing?.id || input.id || `art-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    chatId: input.chatId || existing?.chatId,
    name: input.name ? sanitizeName(input.name) : existing?.name || name,
    type,
    status,
    content: String(input.content || '').slice(0, 500_000),
    updatedAt: Date.now(),
  };

  const next = [artifact, ...items.filter((a) => a.id !== artifact.id)];
  writeIndex(next);
  try {
    fs.writeFileSync(path.join(artifactsDir, `${artifact.id}.md`), artifact.content, 'utf-8');
  } catch {
    // Index still authoritative even if the markdown mirror fails
  }
  return artifact;
}

/** Auto-capture helper: only creates/updates when content is meaningfully different. */
export function captureArtifact(name: string, type: WorkArtifact['type'], content: string, status: WorkArtifact['status'] = 'done', chatId?: string): WorkArtifact | null {
  if (!content || !content.trim()) return null;
  try {
    return upsertArtifact({ name, type, content, status, chatId });
  } catch {
    return null;
  }
}
