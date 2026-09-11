import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// In-memory localStorage for this jsdom build (see ManagerMode.test.tsx note)
vi.hoisted(() => {
  let usable = true;
  try {
    globalThis.localStorage.getItem('__probe__');
  } catch {
    usable = false;
  }
  if (!usable) {
    const backing = new Map<string, string>();
    const memoryStorage = {
      getItem: (key: string) => (backing.has(key) ? (backing.get(key) as string) : null),
      setItem: (key: string, value: string) => {
        backing.set(key, String(value));
      },
      removeItem: (key: string) => {
        backing.delete(key);
      },
      clear: () => {
        backing.clear();
      },
      key: (index: number) => Array.from(backing.keys())[index] ?? null,
      get length() {
        return backing.size;
      },
    };
    try {
      Object.defineProperty(globalThis, 'localStorage', {
        value: memoryStorage,
        configurable: true,
      });
    } catch {
      // Leave whatever exists — assertions will surface the failure
    }
  }
});

import { useIDEStore } from '../stores/ideStore.js';
import { resetAgentSocketForTests } from '../utils/agentSocket.js';
import { ManagerShell } from '../components/Manager/ManagerShell.js';
import { TitleBar } from '../components/Layout/TitleBar.js';

// jsdom does not implement scrollIntoView; the real components use it for
// auto-scroll, so provide a no-op for the test environment only.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}

class MockWebSocket {
  static OPEN = 1;
  url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

describe('ManagerShell', () => {
  beforeEach(() => {
    localStorage.clear();
    resetAgentSocketForTests();
    useIDEStore.setState({
      uiMode: 'manager',
      pinnedSessionIds: [],
      isAgentGenerating: false,
      currentAgentThinking: '',
      pendingApprovals: [],
      availableModels: [],
      pendingAgentQuestion: null,
      subagents: [],
      assets: [],
      isSettingsOpen: false,
      agentMessages: [
        {
          id: 'msg-welcome',
          role: 'assistant',
          content:
            "I'm Astra — I read, write, and run code in your workspace. What are we building?",
          timestamp: Date.now(),
        },
      ],
    });
    (globalThis as any).WebSocket = MockWebSocket;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ success: true, sessions: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }) as unknown as Response
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).WebSocket;
  });

  it('renders the greeting hero, sidebar chrome, and Open IDE control', async () => {
    render(<ManagerShell />);
    expect(await screen.findByLabelText('Sutra')).toBeInTheDocument();
    // Hero mode hides the sidebar behind a History peek until the first send
    fireEvent.click(screen.getByRole('button', { name: /history/i }));
    expect(screen.getByRole('button', { name: /new conversation/i })).toBeInTheDocument();
    expect(screen.getByText('Conversation History')).toBeInTheDocument();
    expect(screen.getByText('Scheduled Tasks')).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open ide/i })).toBeInTheDocument();

    // Transcript stays hidden until the conversation starts
    expect(screen.queryByRole('log', { name: /conversation transcript/i })).not.toBeInTheDocument();
  });

  it('switches to IDE mode via Open IDE', async () => {
    render(<ManagerShell />);
    fireEvent.click(screen.getByRole('button', { name: /open ide/i }));
    await waitFor(() => expect(useIDEStore.getState().uiMode).toBe('ide'));
  });

  it('starting a conversation resets to a fresh session', async () => {
    useIDEStore.setState({
      agentMessages: [
        { id: 'm1', role: 'user', content: 'earlier chat', timestamp: Date.now() },
        { id: 'm2', role: 'assistant', content: 'done', timestamp: Date.now() },
      ],
    });
    render(<ManagerShell />);
    fireEvent.click(screen.getByRole('button', { name: /new conversation/i }));

    await waitFor(() => {
      const msgs = useIDEStore.getState().agentMessages;
      expect(msgs.length === 1 && msgs[0].role === 'assistant').toBe(true);
    });
  });

  it('sends a message through the shared store pipeline and renders the transcript below the composer', async () => {
    render(<ManagerShell />);
    const textarea = await screen.findByLabelText(/message astra/i);
    fireEvent.change(textarea, { target: { value: 'Build me a todo app' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    // User + assistant placeholder appended into the shared agentMessages state
    await waitFor(() => {
      const msgs = useIDEStore.getState().agentMessages;
      expect(msgs.some((m) => m.role === 'user' && m.content.includes('Build me a todo app'))).toBe(true);
      expect(useIDEStore.getState().isAgentGenerating).toBe(true);
    });

    // Transcript appears under the composer; greeting disappears once user speaks
    expect(await screen.findByRole('log', { name: /conversation transcript/i })).toBeInTheDocument();
    expect(screen.getByText('Build me a todo app')).toBeInTheDocument();
    expect(screen.queryByText('What are we building today?')).not.toBeInTheDocument();

    // Stop button available while generating
    expect(screen.getByRole('button', { name: /stop generating/i })).toBeInTheDocument();
  });

  it('canceling generation stops the stream and preserves progress in place', async () => {
    render(<ManagerShell />);
    const textarea = await screen.findByLabelText(/message astra/i);
    fireEvent.change(textarea, { target: { value: 'long task' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect(useIDEStore.getState().isAgentGenerating).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: /stop generating/i }));
    await waitFor(() => expect(useIDEStore.getState().isAgentGenerating).toBe(false));
    const last = useIDEStore.getState().agentMessages[useIDEStore.getState().agentMessages.length - 1];
    expect(last.content).toContain('Generation stopped');
  });

  it('shows the Scheduled Tasks manager with its create form', async () => {
    render(<ManagerShell />);
    fireEvent.click(screen.getByRole('button', { name: /history/i }));
    fireEvent.click(await screen.findByText('Scheduled Tasks'));
    expect(await screen.findByText(/No scheduled tasks yet/i)).toBeInTheDocument();

    const scheduleButton = screen.getByRole('button', { name: /schedule a task/i });
    expect(scheduleButton).toBeEnabled();
    fireEvent.click(scheduleButton);
    expect(await screen.findByLabelText('Task prompt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /schedule task/i })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByLabelText('Task prompt')).not.toBeInTheDocument());
  });

  it('shows the Settings row in the sidebar and opens the settings modal through it', async () => {
    render(<ManagerShell />);
    fireEvent.click(screen.getByRole('button', { name: /history/i }));
    const settingsRow = await screen.findByRole('button', { name: 'Settings' });
    fireEvent.click(settingsRow);
    await waitFor(() => expect(useIDEStore.getState().isSettingsOpen).toBe(true));
  });

  it('shows the connect-models hint on the hero when no models are configured and opens Settings', async () => {
    render(<ManagerShell />);
    const connectLink = await screen.findByText(/connect models in settings/i);
    expect(connectLink).toBeInTheDocument();

    fireEvent.click(connectLink);
    await waitFor(() => expect(useIDEStore.getState().isSettingsOpen).toBe(true));
  });

  it('hides the connect-models banner once models are available', async () => {
    useIDEStore.setState({
      availableModels: [
        {
          id: 'gpt-test',
          name: 'Test Model',
          provider: 'openai',
          contextWindow: 128000,
          supportsVision: true,
          supportsTools: true,
          costPer1kTokens: { input: 0, output: 0 },
          description: 'test',
        },
      ],
    });
    render(<ManagerShell />);
    expect(await screen.findByLabelText('Sutra')).toBeInTheDocument();
    expect(screen.queryByText(/connect models in settings/i)).not.toBeInTheDocument();
  });

  it('renders the right-side Activity panel with its sections', async () => {
    // Seed a user message so the shell leaves hero mode and mounts the activity panel
    useIDEStore.setState({
      agentMessages: [
        { id: 'msg-u1', role: 'user', content: 'Build the landing page', timestamp: Date.now() } as any,
        { id: 'msg-a1', role: 'assistant', content: 'On it — scanning the workspace first.', timestamp: Date.now() } as any,
      ],
    });
    render(<ManagerShell />);
    expect(await screen.findByRole('button', { name: /collapse activity panel/i })).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Work Items')).toBeInTheDocument();
    expect(screen.getByText('Files Changed')).toBeInTheDocument();
    expect(screen.getByText('Artifacts')).toBeInTheDocument();
    expect(screen.getByText('Background Tasks')).toBeInTheDocument();
    expect(screen.getByText('Subagents')).toBeInTheDocument();
  });

  it('does not render preview on new conversation / hero screen and automatically dismisses isPreviewOpen', async () => {
    useIDEStore.setState({
      isPreviewOpen: true,
      agentMessages: [{ id: 'msg-welcome', role: 'assistant', content: 'What are we building?', timestamp: Date.now() }],
    });
    render(<ManagerShell />);
    expect(screen.queryByRole('button', { name: /toggle live website preview/i })).not.toBeInTheDocument();
    expect(screen.queryByTitle(/SUTRA Live Responsive Preview Sandbox/i)).not.toBeInTheDocument();
    await waitFor(() => expect(useIDEStore.getState().isPreviewOpen).toBe(false));
  });

  it('renders the preview toggle button when in an active conversation', async () => {
    useIDEStore.setState({
      isPreviewOpen: false,
      agentMessages: [
        { id: 'msg-u1', role: 'user', content: 'Create index.html', timestamp: Date.now() } as any,
        { id: 'msg-a1', role: 'assistant', content: 'Created.', timestamp: Date.now() } as any,
      ],
    });
    render(<ManagerShell />);
    expect(await screen.findByRole('button', { name: /toggle live website preview/i })).toBeInTheDocument();
  });
});

describe('TitleBar manager jump-back button', () => {
  beforeEach(() => {
    localStorage.clear();
    useIDEStore.setState({ uiMode: 'manager' });
  });

  it('hides the Chat button while already in Manager mode', () => {
    render(<TitleBar />);
    expect(screen.queryByRole('button', { name: /back to astra chat/i })).not.toBeInTheDocument();
  });

  it('appears only in IDE mode and returns to Astra chat on click', () => {
    useIDEStore.setState({ uiMode: 'ide' });
    render(<TitleBar />);
    const chatButton = screen.getByRole('button', { name: /back to astra chat/i });
    fireEvent.click(chatButton);
    expect(useIDEStore.getState().uiMode).toBe('manager');
  });
});
