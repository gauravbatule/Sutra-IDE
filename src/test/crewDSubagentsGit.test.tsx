import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { useIDEStore, modelCatalogSignature } from '../stores/ideStore.js';
import type { SubagentState } from '../types/ide.js';
import { GitPanel } from '../components/Git/GitPanel.js';

function makeSubagent(overrides: Partial<SubagentState> = {}): SubagentState {
  return {
    id: 'agent-architect-1',
    role: 'architect',
    name: 'Specialist: architect',
    status: 'executing',
    currentTask: 'Plan the layout',
    progress: 10,
    toolCalls: [],
    tokensUsed: 0,
    lastMessage: 'Spawned for task',
    ...overrides,
  };
}

describe('modelCatalogSignature (poll dedupe)', () => {
  it('is stable across reorderings of the same catalog', () => {
    const a = [
      { id: 'm1', name: 'One', provider: 'mock' as const, contextWindow: 1 },
      { id: 'm2', name: 'Two', provider: 'mock' as const, contextWindow: 2 },
    ];
    const b = [...a].reverse();
    expect(modelCatalogSignature(a)).toBe(modelCatalogSignature(b));
  });

  it('changes when the catalog changes', () => {
    const a = [{ id: 'm1', name: 'One', provider: 'mock' as const, contextWindow: 1 }];
    const b = [{ id: 'm9', name: 'Nine', provider: 'mock' as const, contextWindow: 9 }];
    expect(modelCatalogSignature(a)).not.toBe(modelCatalogSignature(b));
  });
});

describe('subagent auto-open guard (ideStore)', () => {
  beforeEach(() => {
    const s = useIDEStore.getState();
    useIDEStore.setState({
      subagents: [],
      subagentsAutoOpened: false,
      isAgentGenerating: false,
      activeSidebar: 'explorer',
    });
    void s;
  });

  it('auto-opens the subagents tab once when the first run event arrives', () => {
    useIDEStore.setState({ isAgentGenerating: true });
    useIDEStore.getState().setSubagents([makeSubagent()]);
    expect(useIDEStore.getState().activeSidebar).toBe('swarm');
    expect(useIDEStore.getState().subagentsAutoOpened).toBe(true);
  });

  it('does not re-open on later updates within the same run', () => {
    useIDEStore.setState({ isAgentGenerating: true });
    useIDEStore.getState().setSubagents([makeSubagent()]);
    useIDEStore.setState({ activeSidebar: 'explorer' });

    useIDEStore.getState().setSubagents([
      makeSubagent(),
      makeSubagent({ id: 'agent-test_engineer-2', role: 'qa_tester' }),
    ]);
    expect(useIDEStore.getState().activeSidebar).toBe('explorer');
  });

  it('resets the guard when subagents clear so the next run can open again', () => {
    useIDEStore.setState({ isAgentGenerating: true });
    useIDEStore.getState().setSubagents([makeSubagent()]);
    expect(useIDEStore.getState().subagentsAutoOpened).toBe(true);

    useIDEStore.getState().setSubagents([]);
    expect(useIDEStore.getState().subagentsAutoOpened).toBe(false);
  });

  it('never auto-opens while idle (e.g. stale server state at boot)', () => {
    expect(useIDEStore.getState().isAgentGenerating).toBe(false);
    useIDEStore.getState().setSubagents([makeSubagent({ status: 'completed' })]);
    expect(useIDEStore.getState().activeSidebar).not.toBe('swarm');
    expect(useIDEStore.getState().subagentsAutoOpened).toBe(false);
  });
});

describe('GitPanel honesty', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it('shows the friendly empty state with Initialize Repository when not a repo (inferred)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ branch: 'main', status: 'Not a git repository', hasChanges: false, files: [] }),
      }))
    );

    render(<GitPanel />);
    expect(await screen.findByText(/isn't a git repository yet/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /initialize repository/i })).toBeTruthy();
  });

  it('respects an explicit isRepo=false flag from the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ branch: '', status: '', hasChanges: false, files: [], isRepo: false }),
      }))
    );

    render(<GitPanel />);
    expect(await screen.findByRole('button', { name: /initialize repository/i })).toBeTruthy();
  });

  it('renders the repo UI with staged/unstaged counts when isRepo is true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any) => ({
        ok: true,
        json: async () =>
          String(url).includes('/api/git/status')
            ? {
                branch: 'main',
                status: '2 changed files',
                hasChanges: true,
                files: [
                  { path: 'src/a.ts', status: 'modified', staged: true },
                  { path: 'src/b.ts', status: 'modified', staged: false },
                ],
                isRepo: true,
              }
            : { diff: '' },
      }))
    );

    render(<GitPanel />);
    expect(await screen.findByText(/1 staged · 1 unstaged/)).toBeTruthy();
    expect(await screen.findByText('Commit Staged Changes')).toBeTruthy();
    expect(screen.getByText('Changes (2)')).toBeTruthy();
  });
});
