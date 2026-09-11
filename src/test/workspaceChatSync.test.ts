import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useIDEStore, extractWorkspaceName } from '../stores/ideStore.js';

describe('Workspace & Chat Synchronization', () => {
  beforeEach(() => {
    useIDEStore.setState({
      currentWorkspacePath: '',
      currentWorkspaceName: '',
      openTabs: [],
      activeTabPath: null,
    });
    vi.restoreAllMocks();
  });

  it('extracts clean workspace basename from various path formats', () => {
    expect(extractWorkspaceName('C:\\Users\\Developer\\Desktop\\_Projects')).toBe('_Projects');
    expect(extractWorkspaceName('C:/Users/Developer/Desktop/_Projects/')).toBe('_Projects');
    expect(extractWorkspaceName('/home/user/my-cool-app')).toBe('my-cool-app');
    expect(extractWorkspaceName('/home/user/my-cool-app/')).toBe('my-cool-app');
    expect(extractWorkspaceName('')).toBe('');
  });

  it('automatically sets currentWorkspaceName when setCurrentWorkspacePath is called', () => {
    useIDEStore.getState().setCurrentWorkspacePath('C:\\Workspaces\\ProjectAlpha');
    const state = useIDEStore.getState();
    expect(state.currentWorkspacePath).toBe('C:\\Workspaces\\ProjectAlpha');
    expect(state.currentWorkspaceName).toBe('ProjectAlpha');
  });

  it('fetches workspace from /api/fs/workspace and populates both path and name', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        workspaceRoot: 'C:/Users/test/workspace/ClientPortal',
        path: 'C:/Users/test/workspace/ClientPortal',
        name: 'ClientPortal',
      }),
    });

    const path = await useIDEStore.getState().fetchCurrentWorkspace();
    expect(path).toBe('C:/Users/test/workspace/ClientPortal');
    const state = useIDEStore.getState();
    expect(state.currentWorkspacePath).toBe('C:/Users/test/workspace/ClientPortal');
    expect(state.currentWorkspaceName).toBe('ClientPortal');
  });

  it('switchWorkspace updates both currentWorkspacePath and currentWorkspaceName', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        workspacePath: 'D:\\repos\\sutra-mobile',
        name: 'sutra-mobile',
      }),
    });

    const result = await useIDEStore.getState().switchWorkspace('D:\\repos\\sutra-mobile');
    expect(result.success).toBe(true);
    const state = useIDEStore.getState();
    expect(state.currentWorkspacePath).toBe('D:\\repos\\sutra-mobile');
    expect(state.currentWorkspaceName).toBe('sutra-mobile');
  });
});
