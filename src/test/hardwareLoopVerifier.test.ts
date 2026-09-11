import { describe, it, expect } from 'vitest';
import { hardwareLoopVerifier } from '../../server/harness/hardwareLoopVerifier.js';

describe('hardwareLoopVerifier', () => {
  it('samples physical hardware metrics', () => {
    const telemetry = hardwareLoopVerifier.sampleTelemetry();
    expect(telemetry.rssMb).toBeGreaterThan(0);
    expect(telemetry.heapUsedMb).toBeGreaterThan(0);
    expect(telemetry.cpuCount).toBeGreaterThan(0);
    expect(telemetry.totalMemMb).toBeGreaterThan(0);
  });

  it('evaluates deltas and catches regressions', () => {
    const before = {
      timestamp: 1000,
      rssMb: 100,
      heapUsedMb: 50,
      heapTotalMb: 80,
      freeMemMb: 4000,
      totalMemMb: 8000,
      cpuCount: 8,
      cpuUsageUser: 10000,
      cpuUsageSystem: 5000,
    };

    const afterNormal = {
      ...before,
      timestamp: 1500,
      heapUsedMb: 51,
      cpuUsageUser: 11000,
    };

    const result = hardwareLoopVerifier.evaluateDelta(before, afterNormal);
    expect(result.hasMemoryLeakWarning).toBe(false);
    expect(result.durationMs).toBe(500);
    expect(result.fitnessModifier).toBeGreaterThanOrEqual(0);
  });

  it('flags memory leaks on large heap expansion', () => {
    const before = hardwareLoopVerifier.sampleTelemetry();
    const afterBloat = {
      ...before,
      timestamp: before.timestamp + 1000,
      heapUsedMb: before.heapUsedMb + 40.0,
    };

    const result = hardwareLoopVerifier.evaluateDelta(before, afterBloat);
    expect(result.hasMemoryLeakWarning).toBe(true);
    expect(result.fitnessModifier).toBeLessThan(0);
  });
});
