import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  initRunLog,
  startRun,
  recordEvent,
  finishRun,
  listRuns,
  getRunDetail,
} from '../../server/harness/runLog.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  initRunLog(db);
});

describe('runLog', () => {
  it('starts a run and exposes it in the list', () => {
    const id = startRun({
      workspaceRoot: '/tmp/ws',
      modelId: 'test-model',
      permissionMode: 'strict',
      promptPreview: 'Build the login page',
    });
    const runs = listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id,
      status: 'running',
      workspaceRoot: '/tmp/ws',
      modelId: 'test-model',
      permissionMode: 'strict',
      promptPreview: 'Build the login page',
      filesMutated: 0,
      verificationPassed: null,
      finishedAt: null,
    });
  });

  it('truncates long prompt previews to 200 characters', () => {
    const id = startRun({ workspaceRoot: '/w', permissionMode: 'full', promptPreview: 'x'.repeat(500) });
    expect(getRunDetail(id)!.run.promptPreview).toHaveLength(200);
  });

  it('records events in order with parsed payloads', () => {
    const id = startRun({ workspaceRoot: '/w', permissionMode: 'full', promptPreview: '' });
    recordEvent(id, 'ToolsExecuted', { round: 1, tools: [{ tool: 'write_file', ok: true }] });
    recordEvent(id, 'VerificationCompleted', { allPassed: true });
    const { events } = getRunDetail(id)!;
    expect(events.map((e) => e.type)).toEqual(['RunStarted', 'ToolsExecuted', 'VerificationCompleted']);
    expect(events[1].payload).toEqual({ round: 1, tools: [{ tool: 'write_file', ok: true }] });
  });

  it('finishes a run exactly once and ignores later finish calls', () => {
    const id = startRun({ workspaceRoot: '/w', permissionMode: 'full', promptPreview: '' });
    finishRun(id, 'completed', { filesMutated: 3, verificationPassed: true });

    // A second endRun on another code path must not overwrite or duplicate.
    finishRun(id, 'failed');
    recordEvent(id, 'StrayEvent');

    const { run, events } = getRunDetail(id)!;
    expect(run.status).toBe('completed');
    expect(run.filesMutated).toBe(3);
    expect(run.verificationPassed).toBe(true);
    expect(run.finishedAt).not.toBeNull();
    expect(events.filter((e) => e.type === 'RunEnded')).toHaveLength(1);
  });

  it('keeps null semantics for skipped verification', () => {
    const id = startRun({ workspaceRoot: '/w', permissionMode: 'full', promptPreview: '' });
    finishRun(id, 'cancelled');
    expect(getRunDetail(id)!.run.verificationPassed).toBeNull();
  });

  it('lists newest-first and clamps the limit', () => {
    for (let i = 0; i < 5; i++) {
      startRun({ workspaceRoot: `/w-${i}`, permissionMode: 'full', promptPreview: '' });
    }
    expect(listRuns(3)).toHaveLength(3);
    const all = listRuns(10_000);
    expect(all).toHaveLength(5);
    expect(all[0].workspaceRoot).toBe('/w-4');
  });

  it('returns null detail for unknown ids and stores unserializable payloads safely', () => {
    expect(getRunDetail('nope')).toBeNull();
    const id = startRun({ workspaceRoot: '/w', permissionMode: 'full', promptPreview: '' });
    const cyclical: any = { label: 'state' };
    cyclical.self = cyclical;
    recordEvent(id, 'CyclicalPayload', cyclical);
    const { events } = getRunDetail(id)!;
    const weird = events.find((e) => e.type === 'CyclicalPayload');
    expect(weird).toBeDefined();
    expect(weird!.payload).toBeNull(); // Degraded to a typed marker, not a crash
  });
});
