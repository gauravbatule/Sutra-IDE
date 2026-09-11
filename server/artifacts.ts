import fs from 'fs';
import path from 'path';

export interface WorkArtifact {
  id: string;
  name: string;
  type: 'plan' | 'implementation' | 'design' | 'asset' | 'verification' | 'doc';
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
  const raw = fs.readFileSync(indexPath(), 'utf-8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

function writeIndex(items: WorkArtifact[]): void {
  fs.writeFileSync(indexPath(), JSON.stringify(items, null, 2), 'utf-8');
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\- ]/g, '').trim().slice(0, 80) || 'artifact';
}

export function listArtifacts(): WorkArtifact[] {
  try {
    return readIndex().sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function getArtifact(id: string): WorkArtifact | null {
  return listArtifacts().find((a) => a.id === id) || null;
}

export function upsertArtifact(input: {
  id?: string;
  name: string;
  type: string;
  content: string;
  status?: string;
}): WorkArtifact {
  const items = listArtifacts();
  const name = sanitizeName(input.name);
  const type = (['plan', 'implementation', 'design', 'asset', 'verification', 'doc'] as const).includes(input.type as any)
    ? (input.type as WorkArtifact['type'])
    : 'doc';
  const status = (['draft', 'in_progress', 'done'] as const).includes(input.status as any)
    ? (input.status as WorkArtifact['status'])
    : 'draft';

  const existing = input.id ? items.find((a) => a.id === input.id) : items.find((a) => a.name === name);
  const artifact: WorkArtifact = {
    id: existing?.id || `art-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    name: existing ? existing.name : name,
    type,
    status,
    content: String(input.content || '').slice(0, 100_000),
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
export function captureArtifact(name: string, type: WorkArtifact['type'], content: string, status: WorkArtifact['status'] = 'done'): WorkArtifact | null {
  if (!content || !content.trim()) return null;
  try {
    return upsertArtifact({ name, type, content, status });
  } catch {
    return null;
  }
}
