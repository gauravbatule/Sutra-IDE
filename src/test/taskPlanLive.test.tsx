import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskPlanCard } from '../components/Agent/TaskPlanCard.js';
import { ToolCard } from '../components/Agent/ToolCard.js';
import { ToolCallPayload } from '../types/ide.js';

describe('TaskPlanCard & Live Task Plan', () => {
  it('renders live todos with progress bar and status checkboxes', () => {
    const toolCall: ToolCallPayload = {
      id: 'tp-1',
      tool: 'write_todos',
      params: {
        todos: [
          { content: 'Analyze project structure', status: 'completed' },
          { content: 'Implement new api endpoint', status: 'in_progress' },
          { content: 'Run unit tests', status: 'pending' },
        ],
      },
      status: 'completed',
      requiresApproval: false,
      timestamp: Date.now(),
    };

    render(<TaskPlanCard toolCall={toolCall} />);
    expect(screen.getByText(/Task Execution Plan/i)).toBeDefined();
    expect(screen.getByText(/1\/3 Done/i)).toBeDefined();
    expect(screen.getByText(/Analyze project structure/i)).toBeDefined();
    expect(screen.getByText(/Implement new api endpoint/i)).toBeDefined();
    expect(screen.getByText(/Run unit tests/i)).toBeDefined();
  });

  it('ToolCard delegates write_todos to TaskPlanCard', () => {
    const toolCall: ToolCallPayload = {
      id: 'tp-2',
      tool: 'write_todos',
      params: {
        todos: [
          { content: 'Build components', status: 'completed' },
        ],
      },
      status: 'completed',
      requiresApproval: false,
      timestamp: Date.now(),
    };

    render(<ToolCard toolCall={toolCall} />);
    expect(screen.getByText(/Task Execution Plan/i)).toBeDefined();
    expect(screen.getByText(/Build components/i)).toBeDefined();
  });
});
