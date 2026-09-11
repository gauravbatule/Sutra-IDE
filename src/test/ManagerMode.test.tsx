import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// This repo's jsdom build refuses localStorage without a --localstorage-file CLI
// flag (SecurityError), so swap in an in-memory implementation before any store
// module evaluates. Scoped to these tests — no shared config changes needed.
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
import { answerAgentQuestion } from '../utils/agentSocket.js';
import { ManagerComposer } from '../components/Manager/ManagerComposer.js';
import { ConversationList } from '../components/Manager/ConversationList.js';
import { AskUserCard } from '../components/Common/AskUserCard.js';
import { ActivityPanel } from '../components/Manager/ActivityPanel.js';
import { formatRelativeTime, formatCompactTimestamp, type ChatSessionSummary as SessionRow } from '../components/Manager/useChatSessions.js';
import type { OmniAgentMessage, ProjectAsset, SubagentState, ToolCallPayload } from '../types/ide.js';

// AskUserCard must never open a real socket in unit tests — assert the
// agent_answer contract through this mock instead.
vi.mock('../utils/agentSocket.js', () => ({
  sendAgentPrompt: vi.fn(async () => undefined),
  cancelAgentStream: vi.fn(),
  answerAgentQuestion: vi.fn(() => true),
  registerQuestionSender: vi.fn(),
  markQuestionAnswered: vi.fn(),
  wasQuestionAnswered: vi.fn(() => false),
  isAgentSocketBusy: vi.fn(() => false),
  resolveWsUrl: vi.fn(() => 'ws://localhost:3001/ws'),
  resetAgentSocketForTests: vi.fn(),
}));

const session = (overrides: Partial<SessionRow> = {}): SessionRow => ({
  id: 'session-1',
  title: 'Build a landing page',
  updated_at: new Date().toISOString(),
  message_count: 4,
  ...overrides,
});

describe('Manager mode store state', () => {
  beforeEach(() => {
    localStorage.clear();
    useIDEStore.setState({ uiMode: 'manager', pinnedSessionIds: [] });
  });

  it('defaults uiMode to manager', () => {
    expect(useIDEStore.getState().uiMode).toBe('manager');
  });

  it('setUiMode persists the chosen mode to localStorage', () => {
    useIDEStore.getState().setUiMode('ide');
    expect(useIDEStore.getState().uiMode).toBe('ide');
    expect(localStorage.getItem('sutra-ui-mode')).toBe('ide');

    useIDEStore.getState().setUiMode('manager');
    expect(localStorage.getItem('sutra-ui-mode')).toBe('manager');
  });

  it('togglePinSession adds, removes, and persists pinned ids', () => {
    const { togglePinSession } = useIDEStore.getState();
    togglePinSession('a');
    togglePinSession('b');
    expect(useIDEStore.getState().pinnedSessionIds).toEqual(['a', 'b']);
    expect(JSON.parse(localStorage.getItem('sutra-pinned-sessions') || '[]')).toEqual(['a', 'b']);

    togglePinSession('a');
    expect(useIDEStore.getState().pinnedSessionIds).toEqual(['b']);
    expect(JSON.parse(localStorage.getItem('sutra-pinned-sessions') || '[]')).toEqual(['b']);
  });
});

describe('formatRelativeTime', () => {
  it('returns friendly labels for recent and stale timestamps', () => {
    const now = Date.now();
    expect(formatRelativeTime(new Date(now - 30_000).toISOString())).toBe('Just now');
    expect(formatRelativeTime(new Date(now - 5 * 60_000).toISOString())).toBe('5m ago');
    expect(formatRelativeTime(new Date(now - 3 * 3_600_000).toISOString())).toBe('3h ago');
    expect(formatRelativeTime(new Date(now - 24 * 3_600_000 * 2).toISOString())).toBe('2d ago');
    expect(formatRelativeTime(undefined)).toBe('');
    expect(formatRelativeTime('not-a-date')).toBe('');
  });
});

describe('formatCompactTimestamp', () => {
  it('renders ultra-compact relative stamps for conversation gutters', () => {
    const now = Date.now();
    expect(formatCompactTimestamp(new Date(now - 30_000).toISOString())).toBe('now');
    expect(formatCompactTimestamp(new Date(now - 2 * 60_000).toISOString())).toBe('2m');
    expect(formatCompactTimestamp(new Date(now - 60_000 * 90).toISOString())).toBe('1h');
    expect(formatCompactTimestamp(new Date(now - 6 * 86_400_000).toISOString())).toBe('6d');
    expect(formatCompactTimestamp(new Date(now - 62 * 86_400_000).toISOString())).toBe('2mo');
    expect(formatCompactTimestamp(undefined)).toBe('');
    expect(formatCompactTimestamp('not-a-date')).toBe('');
  });
});

describe('Astra voice in store copy', () => {
  it('the default welcome message speaks as Astra, never SUTRA', () => {
    const welcome = useIDEStore.getState().agentMessages.find((m) => m.id === 'msg-welcome');
    expect(welcome?.content).toContain("I'm Astra");
    expect(welcome?.content).not.toContain('SUTRA');
  });

  it('recordReviewDiff and clearReviewDiffs manage the review slice additively', () => {
    useIDEStore.getState().recordReviewDiff({
      path: '/src/app.tsx',
      tool: 'edit_file',
      originalContent: 'old',
      proposedContent: 'new',
      capturedAt: Date.now(),
    });
    expect(useIDEStore.getState().reviewDiffs['/src/app.tsx']).toMatchObject({ originalContent: 'old' });

    useIDEStore.getState().clearReviewDiffs();
    expect(useIDEStore.getState().reviewDiffs).toEqual({});
  });
});

describe('ConversationList', () => {
  const baseProps = {
    sessions: [] as SessionRow[],
    isLoading: false,
    error: null as string | null,
    activeSessionId: null as string | null,
    pinnedSessionIds: [] as string[],
    emptyMessage: 'No conversations yet — start one below',
    onRetry: vi.fn(),
    onOpen: vi.fn(),
    onDelete: vi.fn(),
    onTogglePin: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a loading state while fetching', () => {
    render(<ConversationList {...baseProps} isLoading />);
    // Skeleton rows keep row heights stable while loading (premium pass, no pulse)
    const status = screen.getByRole('status', { name: /loading conversations/i });
    expect(status.querySelectorAll('.h-2').length).toBeGreaterThan(0);
  });

  it('renders an error state with a working retry button', () => {
    const onRetry = vi.fn();
    render(<ConversationList {...baseProps} error="Could not load conversations (500)" onRetry={onRetry} />);
    expect(screen.getByText(/Could not load conversations \(500\)/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the designed empty state', () => {
    render(<ConversationList {...baseProps} />);
    expect(screen.getByText('No conversations yet — start one below')).toBeInTheDocument();
  });

  it('opens a conversation on row click and keyboard Enter', () => {
    const onOpen = vi.fn();
    render(<ConversationList {...baseProps} sessions={[session()]} onOpen={onOpen} />);

    fireEvent.click(screen.getByText('Build a landing page'));
    expect(onOpen).toHaveBeenCalledWith('session-1');

    const row = screen.getByRole('listitem');
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('pins without triggering row open (stopPropagation)', () => {
    const onOpen = vi.fn();
    const onTogglePin = vi.fn();
    render(
      <ConversationList
        {...baseProps}
        sessions={[session()]}
        pinnedSessionIds={['session-1']}
        onOpen={onOpen}
        onTogglePin={onTogglePin}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /unpin conversation/i }));
    expect(onTogglePin).toHaveBeenCalledWith('session-1');
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /pin conversation/i })).toBeInTheDocument();
  });

  it('deletes via the hover action with stopPropagation', () => {
    const onDelete = vi.fn();
    const onOpen = vi.fn();
    render(<ConversationList {...baseProps} sessions={[session()]} onDelete={onDelete} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /delete conversation/i }));
    expect(onDelete).toHaveBeenCalledWith('session-1');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('shows a compact right-aligned timestamp on each row', () => {
    render(<ConversationList {...baseProps} sessions={[session()]} />);
    expect(screen.getByText(/^now$|^0m$/)).toBeInTheDocument();
  });

  it('marks the generating conversation with an accent working dot', () => {
    render(
      <ConversationList
        {...baseProps}
        sessions={[session(), session({ id: 'session-2', title: 'Other chat' })]}
        activeSessionId="session-1"
        workingSessionId="session-1"
      />
    );
    expect(screen.getByRole('status', { name: /generating: build a landing page/i })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /generating: other chat/i })).not.toBeInTheDocument();
  });
});

describe('ManagerComposer', () => {
  const onSend = vi.fn();
  const onCancel = vi.fn();

  const renderComposer = (isGenerating = false) =>
    render(<ManagerComposer isGenerating={isGenerating} onSend={onSend} onCancel={onCancel} />);

  beforeEach(() => {
    vi.clearAllMocks();
    useIDEStore.setState({ permissionLevel: 'full' });
  });

  it('shows the placeholder and disabled send when empty', () => {
    renderComposer();
    expect(screen.getByPlaceholderText(/Ask anything/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send message/i })).toBeDisabled();
  });

  it('enables send after typing and sends text on Enter, clearing the field', async () => {
    renderComposer();
    const textarea = screen.getByLabelText(/message astra/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Build me a dashboard' } });
    const sendButton = screen.getByRole('button', { name: /send message/i });
    expect(sendButton).toBeEnabled();

    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenCalledWith('Build me a dashboard', null);
    await waitFor(() => expect(textarea.value).toBe(''));
  });

  it('does not send on Shift+Enter (newline intent)', () => {
    renderComposer();
    const textarea = screen.getByLabelText(/message astra/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'line one' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    expect(textarea.value).toBe('line one');
  });

  it('swaps the send button for a stop button that cancels while generating', () => {
    renderComposer(true);
    expect(screen.queryByRole('button', { name: /send message/i })).not.toBeInTheDocument();
    const stop = screen.getByRole('button', { name: /stop generating/i });
    fireEvent.click(stop);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows the permission-mode indicator (icon-only) for strict and full access modes', () => {
    const { rerender } = renderComposer();
    expect(screen.getByLabelText(/permission: full access/i)).toBeInTheDocument();

    useIDEStore.setState({ permissionLevel: 'strict' });
    rerender(<ManagerComposer isGenerating={false} onSend={onSend} onCancel={onCancel} />);
    expect(screen.getByLabelText(/permission: strict/i)).toBeInTheDocument();
  });

  it('attaches a file client-side and forwards its content to onSend', async () => {
    renderComposer();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();

    const file = new File(['hello attachment body'], 'notes.txt', { type: 'text/plain' });
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);

    // Chip appears once FileReader resolves
    await waitFor(() => expect(screen.getByText(/attached as context/i)).toBeInTheDocument());
    expect(screen.getByText('notes.txt')).toBeInTheDocument();

    const textarea = screen.getByLabelText(/message astra/i);
    fireEvent.change(textarea, { target: { value: 'summarize this' } });
    fireEvent.click(screen.getByRole('button', { name: /send message/i }));

    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith(
        'summarize this',
        expect.objectContaining({ name: 'notes.txt', content: 'hello attachment body' })
      )
    );
  });

  it('fills the composer from a quick-action chip without auto-sending', () => {
    render(<ManagerComposer isGenerating={false} onSend={onSend} onCancel={onCancel} showQuickActions />);
    fireEvent.click(screen.getByRole('button', { name: 'Explain this codebase' }));
    const textarea = screen.getByLabelText(/message astra/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe('Explain this codebase');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('keeps quick-action chips hidden during an active conversation', () => {
    renderComposer();
    expect(screen.queryByRole('button', { name: 'Explain this codebase' })).not.toBeInTheDocument();
  });

  it('hides the MCP pill when no servers are configured or status fails', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({ servers: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }) as unknown as Response;
    });
    renderComposer();
    await waitFor(() => expect(screen.queryByText(/MCP/)).not.toBeInTheDocument());
    fetchMock.mockRestore();
  });

  it('shows the MCP pill with connected count and opens Settings on click', async () => {
    useIDEStore.setState({ isSettingsOpen: false });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            servers: [
              { name: 'fs', status: 'connected' },
              { name: 'git', status: 'disabled' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        ) as unknown as Response;
      });
    renderComposer();
    expect(await screen.findByText('MCP · 1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /mcp/i }));
    expect(useIDEStore.getState().isSettingsOpen).toBe(true);
    fetchMock.mockRestore();
  });
});

describe('AskUserCard', () => {
  const question = {
    id: 'q-1',
    question: 'Use TypeScript or JavaScript?',
    options: ['TypeScript', 'JavaScript'],
    allowFreeText: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useIDEStore.setState({ pendingAgentQuestion: null });
  });

  it('renders nothing when there is no pending or resolved question', () => {
    const { container } = render(<AskUserCard />);
    expect(container.textContent).toBe('');
  });

  it('renders the pending question and sends a chosen option as agent_answer', async () => {
    useIDEStore.setState({ pendingAgentQuestion: question });
    render(<AskUserCard />);

    expect(screen.getByText('Use TypeScript or JavaScript?')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'TypeScript' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'JavaScript' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('option', { name: 'JavaScript' }));

    // Contract: answerAgentQuestion(id, answer) on the shared socket sender
    expect(vi.mocked(answerAgentQuestion)).toHaveBeenCalledWith('q-1', 'JavaScript');
    await waitFor(() => expect(useIDEStore.getState().pendingAgentQuestion).toBeNull());

    // Resolved Q&A stays inline after answering
    expect(await screen.findByText('Your answer')).toBeInTheDocument();
    expect(screen.getByText('Question')).toBeInTheDocument();
    expect(screen.getByText('JavaScript')).toBeInTheDocument();
  });

  it('sends typed free text when the options do not fit', async () => {
    useIDEStore.setState({
      pendingAgentQuestion: { id: 'q-2', question: 'Which database should we use?', options: [], allowFreeText: true },
    });
    render(<AskUserCard />);

    const input = screen.getByLabelText(/type your answer/i);
    fireEvent.change(input, { target: { value: 'Postgres, please' } });
    fireEvent.click(screen.getByRole('button', { name: /send answer/i }));

    expect(vi.mocked(answerAgentQuestion)).toHaveBeenCalledWith('q-2', 'Postgres, please');
    await waitFor(() => expect(useIDEStore.getState().pendingAgentQuestion).toBeNull());
    expect(await screen.findByText(/your answer/i)).toBeInTheDocument();
  });

  it('flags when the answer could not be delivered', async () => {
    vi.mocked(answerAgentQuestion).mockReturnValueOnce(false);
    useIDEStore.setState({ pendingAgentQuestion: question });
    render(<AskUserCard />);

    fireEvent.click(screen.getByRole('option', { name: 'TypeScript' }));

    expect(await screen.findByText(/not delivered/i)).toBeInTheDocument();
    await waitFor(() => expect(useIDEStore.getState().pendingAgentQuestion).toBeNull());
  });
});

describe('ActivityPanel', () => {
  const toolCall = (overrides: Partial<ToolCallPayload>): ToolCallPayload => ({
    id: `t-${Math.random().toString(36).slice(2)}`,
    tool: 'read_file',
    params: {},
    requiresApproval: false,
    status: 'completed',
    timestamp: Date.now(),
    ...overrides,
  });

  const welcomeOnly: OmniAgentMessage[] = [
    { id: 'msg-welcome', role: 'assistant', content: 'Hello', timestamp: Date.now() },
  ];

  beforeEach(() => {
    useIDEStore.setState({
      agentMessages: welcomeOnly,
      subagents: [],
      assets: [],
      isAgentGenerating: false,
      pendingAgentQuestion: null,
    });
  });

  it('renders every section with its empty state while idle', () => {
    render(<ActivityPanel />);

    expect(screen.getByText('Idle')).toBeInTheDocument();
    expect(screen.getByText('No files changed yet')).toBeInTheDocument();
    expect(screen.getByText('No artifacts yet')).toBeInTheDocument();
    expect(screen.getByText('No background tasks yet')).toBeInTheDocument();
    expect(screen.getByText('No subagents running')).toBeInTheDocument();
  });

  it('derives live status, files, artifacts, tasks, and subagents from store data', () => {
    useIDEStore.setState({
      agentMessages: [
        ...welcomeOnly,
        {
          id: 'm1',
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          toolCalls: [
            toolCall({ id: 't1', tool: 'write_file', params: { path: '/src/app/main.tsx' }, status: 'completed' }),
            toolCall({ id: 't2', tool: 'edit_file', params: { path: '/src/app/main.tsx' }, status: 'executing' }),
            toolCall({ id: 't3', tool: 'delete_file', params: { path: '/src/old/legacy.ts' }, status: 'failed' }),
            toolCall({ id: 't4', tool: 'run_command', params: { command: 'npm run build' }, status: 'pending' }),
            toolCall({
              id: 't5',
              tool: 'generate_image_asset',
              params: { filename: 'hero.png', prompt: 'a hero image' },
              status: 'completed',
              result: { ok: true },
            }),
            toolCall({ id: 't6', tool: 'run_command', params: { command: 'npm test' }, status: 'failed' }),
          ],
        },
        { id: 'm2', role: 'assistant', content: 'Working on it.', timestamp: Date.now() },
        { id: 'm3', role: 'assistant', content: 'Nearly there.', timestamp: Date.now() },
      ],
      subagents: [
        {
          id: 's1',
          role: 'frontend',
          name: 'Frontend Builder',
          status: 'thinking',
          currentTask: 'Building the UI',
          progress: 10,
          toolCalls: [],
          tokensUsed: 0,
          lastMessage: '',
        } as SubagentState,
      ],
      assets: [
        {
          id: 'a9',
          name: 'brand.svg',
          type: 'svg',
          path: '/assets/images/brand.svg',
          url: '/assets/images/brand.svg',
          createdAt: Date.now(),
        } as ProjectAsset,
      ],
      isAgentGenerating: true,
    });

    render(<ActivityPanel />);

    // Status summary — numbers chosen to be unique against section count badges
    expect(screen.getByText('Astra is working')).toBeInTheDocument();
    expect(screen.getByText('SUTRA Auto')).toBeInTheDocument(); // default activeModel
    expect(screen.getByText('3')).toBeInTheDocument(); // rounds (assistant msgs minus welcome)
    expect(screen.getByText('6')).toBeInTheDocument(); // total tool calls

    // Files Changed — grouped by basename, latest status wins
    expect(screen.getAllByText('main.tsx')).toHaveLength(1);
    expect(screen.getByText('legacy.ts')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();

    // Artifacts — from tool calls plus the media asset store
    expect(screen.getByText('hero.png')).toBeInTheDocument();
    expect(screen.getByText('brand.svg')).toBeInTheDocument();

    // Background Tasks — counts plus latest command (last run_command wins)
    expect(screen.getByText('1 running')).toBeInTheDocument();
    expect(screen.getByText('0 completed')).toBeInTheDocument();
    expect(screen.getByText('1 failed')).toBeInTheDocument();
    expect(screen.getByText('npm test')).toBeInTheDocument();

    // Subagents
    expect(screen.getByText('Frontend Builder')).toBeInTheDocument();
  });

  it('collapses a section via its chevron without losing state', () => {
    useIDEStore.setState({
      agentMessages: [
        ...welcomeOnly,
        {
          id: 'm1',
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          toolCalls: [toolCall({ id: 't1', tool: 'write_file', params: { path: '/src/app.tsx' }, status: 'completed' })],
        },
      ],
    });

    render(<ActivityPanel />);
    const filesSection = screen.getByRole('button', { name: /files changed/i });
    expect(filesSection).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('app.tsx')).toBeInTheDocument();

    fireEvent.click(filesSection);
    expect(filesSection).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('app.tsx')).not.toBeInTheDocument();

    fireEvent.click(filesSection);
    expect(screen.getByText('app.tsx')).toBeInTheDocument();
  });

  it('collapses the whole panel down to a slim rail and back', () => {
    render(<ActivityPanel />);

    fireEvent.click(screen.getByRole('button', { name: /collapse activity panel/i }));
    expect(screen.queryByText('Status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /expand activity panel/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /expand activity panel/i }));
    expect(screen.getByRole('button', { name: /collapse activity panel/i })).toBeInTheDocument();
  });
});
