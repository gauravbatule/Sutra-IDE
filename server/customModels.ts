import db from './db.js';

export interface CustomModelEntry {
  id: string;
  category: 'image' | 'video' | 'audio' | 'llm';
  name: string;
  providerId: string;
  modelId: string;
  description: string;
  config?: Record<string, any>;
  createdAt?: number;
}

export class CustomModelsManager {
  public getAllCustomModels(): CustomModelEntry[] {
    try {
      const rows = db.prepare('SELECT * FROM custom_models ORDER BY created_at DESC').all() as any[];
      return rows.map((r) => ({
        id: r.id,
        category: r.category as any,
        name: r.name,
        providerId: r.provider_id,
        modelId: r.model_id,
        description: r.description,
        config: r.config ? JSON.parse(r.config) : {},
        createdAt: new Date(r.created_at).getTime(),
      }));
    } catch {
      return [];
    }
  }

  public getModelsByCategory(category: 'image' | 'video' | 'audio' | 'llm'): CustomModelEntry[] {
    return this.getAllCustomModels().filter((m) => m.category === category);
  }

  public registerCustomModel(entry: CustomModelEntry): CustomModelEntry {
    const id = entry.id || `custom-${entry.category}-${Date.now()}`;
    db.prepare(`
      INSERT INTO custom_models (id, category, name, provider_id, model_id, description, config)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        category = excluded.category,
        name = excluded.name,
        provider_id = excluded.provider_id,
        model_id = excluded.model_id,
        description = excluded.description,
        config = excluded.config
    `).run(
      id,
      entry.category,
      entry.name,
      entry.providerId,
      entry.modelId,
      entry.description,
      JSON.stringify(entry.config || {})
    );
    return { ...entry, id };
  }

  public deleteCustomModel(id: string): boolean {
    try {
      db.prepare('DELETE FROM custom_models WHERE id = ?').run(id);
      return true;
    } catch {
      return false;
    }
  }

  public generateSystemPromptDocumentation(): string {
    const all = this.getAllCustomModels();
    if (all.length === 0) return '';

    const lines = [
      '\n--- USER-CONFIGURED CUSTOM MODELS & TOOL CAPABILITIES ---',
      'The user has configured specialized custom models for specific tasks. Use them accordingly:',
    ];

    for (const m of all) {
      lines.push(
        `• [${m.category.toUpperCase()}] Model: "${m.name}" (ID: \`${m.modelId}\`, Provider: \`${m.providerId}\`)\n  Usage Instructions: ${m.description}`
      );
    }
    lines.push('----------------------------------------------------------\n');
    return lines.join('\n');
  }
}

export const customModelsManager = new CustomModelsManager();
