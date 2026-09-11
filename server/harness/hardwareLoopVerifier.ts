import os from 'os';

export interface HardwareTelemetry {
  timestamp: number;
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  freeMemMb: number;
  totalMemMb: number;
  cpuCount: number;
  cpuUsageUser: number;
  cpuUsageSystem: number;
}

export interface HardwareDeltaResult {
  durationMs: number;
  heapDeltaMb: number;
  rssDeltaMb: number;
  cpuUserUs: number;
  cpuSystemUs: number;
  hasMemoryLeakWarning: boolean;
  hasCpuSpikeWarning: boolean;
  fitnessModifier: number; // -0.5 (bad) to +0.2 (good)
  summary: string;
}

export class HardwareLoopVerifier {
  public sampleTelemetry(): HardwareTelemetry {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();

    return {
      timestamp: Date.now(),
      rssMb: Number((mem.rss / (1024 * 1024)).toFixed(2)),
      heapUsedMb: Number((mem.heapUsed / (1024 * 1024)).toFixed(2)),
      heapTotalMb: Number((mem.heapTotal / (1024 * 1024)).toFixed(2)),
      freeMemMb: Number((os.freemem() / (1024 * 1024)).toFixed(2)),
      totalMemMb: Number((os.totalmem() / (1024 * 1024)).toFixed(2)),
      cpuCount: os.cpus().length,
      cpuUsageUser: cpu.user,
      cpuUsageSystem: cpu.system,
    };
  }

  public evaluateDelta(before: HardwareTelemetry, after: HardwareTelemetry): HardwareDeltaResult {
    const durationMs = Math.max(0, after.timestamp - before.timestamp);
    const heapDeltaMb = Number((after.heapUsedMb - before.heapUsedMb).toFixed(2));
    const rssDeltaMb = Number((after.rssMb - before.rssMb).toFixed(2));
    const cpuUserUs = Math.max(0, after.cpuUsageUser - before.cpuUsageUser);
    const cpuSystemUs = Math.max(0, after.cpuUsageSystem - before.cpuUsageSystem);

    // Memory leak check: sustained heap growth > 25 MB is flagged
    const hasMemoryLeakWarning = heapExpansion(durationMs, heapDeltaMb);
    const hasCpuSpikeWarning = durationMs > 50 && (cpuUserUs / (durationMs * 1000)) > 0.8;


    let fitnessModifier = 0.0;
    if (hasMemoryLeakWarning) fitnessModifier -= 0.25;
    if (hasCpuSpikeWarning) fitnessModifier -= 0.15;
    if (!hasMemoryLeakWarning && !hasCpuSpikeWarning && durationMs < 5000) {
      fitnessModifier += 0.05;
    }


    return {
      durationMs,
      heapDeltaMb,
      rssDeltaMb,
      cpuUserUs,
      cpuSystemUs,
      hasMemoryLeakWarning,
      hasCpuSpikeWarning,
      fitnessModifier: Number(fitnessModifier.toFixed(2)),
      summary: `duration: ${durationMs}ms, heapDelta: ${heapDeltaMb} MB, cpuUser: ${Math.round(cpuUserUs / 1000)}ms`,
    };
  }
}

function heapExpansion(durationMs: number, heapDeltaMb: number): boolean {
  return durationMs > 500 && heapDeltaMb > 25.0;
}

export const hardwareLoopVerifier = new HardwareLoopVerifier();
