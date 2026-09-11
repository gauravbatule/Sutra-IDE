import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MultiViewport } from '../components/Preview/MultiViewport.js';
import { useIDEStore } from '../stores/ideStore.js';

describe('MultiViewport Work-In-Progress and Dev Server Auto-Launch', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    act(() => {
      useIDEStore.setState({
        isPreviewOpen: true,
        previewUrl: '/preview',
        isAgentGenerating: false,
        currentAgentThinking: '',
        agentMessages: [],
        currentWorkspacePath: 'c:/Users/test/workspace',
      });
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('renders Work In Progress overlay when isAgentGenerating is true with live activity', () => {
    act(() => {
      useIDEStore.setState({
        isPreviewOpen: true,
        isAgentGenerating: true,
        currentAgentThinking: 'Designing responsive hero section and navigation bar',
        agentMessages: [
          {
            id: 'msg-1',
            role: 'assistant',
            content: 'Working on site...',
            timestamp: Date.now(),
            toolCalls: [
              {
                id: 'tc-1',
                tool: 'write_file',
                params: { path: 'src/components/Hero.tsx' },
                requiresApproval: false,
                status: 'executing',
                timestamp: Date.now(),
              },
            ],
          },
        ],
      });
    });

    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ success: true, projects: [], pages: [] }),
    });

    render(<MultiViewport />);

    expect(screen.getByText(/ASTRA WORK IN PROGRESS/i)).toBeDefined();
    expect(screen.getByText(/Building Application Files/i)).toBeDefined();
    expect(screen.getByText(/Creating Hero\.tsx…/i)).toBeDefined();
    expect(screen.getByText(/Designing responsive hero section and navigation bar/i)).toBeDefined();
    expect(screen.getByText(/View canvas anyway/i)).toBeDefined();
  });

  it('allows dismissing WIP overlay and restoring it via floating pill button', () => {
    act(() => {
      useIDEStore.setState({
        isPreviewOpen: true,
        isAgentGenerating: true,
        currentAgentThinking: 'Configuring Tailwind styles',
        agentMessages: [],
      });
    });

    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ success: true, projects: [], pages: [] }),
    });

    render(<MultiViewport />);

    const dismissBtn = screen.getByText(/View canvas anyway/i);
    act(() => {
      fireEvent.click(dismissBtn);
    });

    // Overlay is dismissed, restore pill is shown
    expect(screen.queryByText(/ASTRA WORK IN PROGRESS/i)).toBeNull();
    const restoreBtn = screen.getByTitle(/Click to restore build HUD/i);
    expect(restoreBtn).toBeDefined();

    // Clicking restore brings back WIP overlay
    act(() => {
      fireEvent.click(restoreBtn);
    });
    expect(screen.getByText(/ASTRA WORK IN PROGRESS/i)).toBeDefined();
  });

  it('renders No Web Pages Ready Yet when workspace has no files or dev servers', async () => {
    useIDEStore.setState({
      isPreviewOpen: true,
      isAgentGenerating: false,
      previewUrl: '/preview',
    });

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/preview/detect')) {
        return { json: async () => ({ success: true, projects: [], activeProject: null }) };
      }
      if (url.includes('/api/preview/pages')) {
        return { json: async () => ({ success: true, pages: [] }) };
      }
      return { json: async () => ({}) };
    });

    render(<MultiViewport />);

    await waitFor(() => {
      expect(screen.getByText(/No Web Pages Ready Yet/i)).toBeDefined();
    });
  });

  it('auto-launches relevant dev server when project is detected and not running', async () => {
    const launchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        success: true,
        port: 5174,
        url: 'http://localhost:5174',
        previewUrl: 'http://localhost:5174',
      }),
    });

    global.fetch = vi.fn().mockImplementation(async (url: string, options?: any) => {
      if (url.includes('/api/preview/launch')) {
        return launchMock(url, options);
      }
      if (url.includes('/api/preview/detect')) {
        return {
          json: async () => ({
            success: true,
            projects: [
              {
                id: 'proj-vite-app',
                name: 'cat-website',
                framework: 'Vite',
                type: 'vite',
                cwd: 'c:/Users/test/workspace',
                relCwd: '.',
                command: 'npm run dev',
                port: 5173,
                isRunning: false,
                previewUrl: 'http://localhost:5173',
                badge: 'VITE',
              },
            ],
            activeProject: {
              id: 'proj-vite-app',
              name: 'cat-website',
              framework: 'Vite',
              type: 'vite',
              cwd: 'c:/Users/test/workspace',
              relCwd: '.',
              command: 'npm run dev',
              port: 5173,
              isRunning: false,
              previewUrl: 'http://localhost:5173',
              badge: 'VITE',
            },
          }),
        };
      }
      if (url.includes('/api/preview/pages')) {
        return { json: async () => ({ success: true, pages: [] }) };
      }
      return { json: async () => ({}) };
    });

    useIDEStore.setState({
      isPreviewOpen: true,
      isAgentGenerating: false,
      previewUrl: '/preview',
    });

    render(<MultiViewport />);

    await waitFor(() => {
      expect(launchMock).toHaveBeenCalledTimes(1);
    });

    const callBody = JSON.parse(launchMock.mock.calls[0][1].body);
    expect(callBody.command).toBe('npm run dev');
    expect(callBody.port).toBe(5173);
  });
});
