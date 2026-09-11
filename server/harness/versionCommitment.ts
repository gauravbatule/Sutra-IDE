import { gitCheckpoints } from './gitCheckpoints.js';

export interface VersionCandidate {
  id: string;
  versionNumber: number;
  title: string;
  fitnessScore: number;
  hardwareModifier: number;
  compositeScore: number;
  checkpointId?: string;
  status: 'candidate' | 'committed' | 'rejected';
  createdAt: number;
}

export class VersionCommitmentEngine {
  private versions: Map<string, VersionCandidate> = new Map();
  private versionCounter = 0;

  public registerCandidate(params: {
    title: string;
    fitnessScore: number;
    hardwareModifier?: number;
  }): VersionCandidate {
    this.versionCounter += 1;
    const id = `v-${this.versionCounter}`;
    const hwMod = params.hardwareModifier || 0.0;
    const compositeScore = Number(Math.max(0, Math.min(1, params.fitnessScore + hwMod)).toFixed(3));

    const candidate: VersionCandidate = {
      id,
      versionNumber: this.versionCounter,
      title: params.title,
      fitnessScore: params.fitnessScore,
      hardwareModifier: hwMod,
      compositeScore,
      status: 'candidate',
      createdAt: Date.now(),
    };

    this.versions.set(id, candidate);
    return candidate;
  }

  public async commitBestVariation(): Promise<VersionCandidate | null> {
    let best: VersionCandidate | null = null;
    for (const v of this.versions.values()) {
      if (!best || v.compositeScore > best.compositeScore) {
        best = v;
      }
    }

    if (best) {
      best.status = 'committed';
      try {
        const chk = await gitCheckpoints.createCheckpoint(`AVO Commit ${best.id}: ${best.title} (Score: ${best.compositeScore})`);
        if (chk?.checkpoint) best.checkpointId = chk.checkpoint.id;
      } catch {
        // Best-effort git checkpoint
      }
    }

    return best;
  }

  public getVersions(): VersionCandidate[] {
    return Array.from(this.versions.values());
  }
}

export const versionCommitment = new VersionCommitmentEngine();
