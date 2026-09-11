import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AskUserCard } from '../components/Common/AskUserCard.js';
import { ToolCallPayload } from '../types/ide.js';

describe('Inline Question Anchoring & Stability', () => {
  it('renders ask_user toolCall inline with options', () => {
    const toolCall: ToolCallPayload = {
      id: 'tc-question-1',
      tool: 'ask_user',
      params: {
        question: 'Would you like to use SQLite or PostgreSQL?',
        options: ['SQLite', 'PostgreSQL'],
      },
      status: 'executing',
      requiresApproval: false,
      timestamp: Date.now(),
    };

    render(<AskUserCard toolCall={toolCall} />);
    expect(screen.getByText(/Would you like to use SQLite or PostgreSQL?/i)).toBeDefined();
    expect(screen.getByText('SQLite')).toBeDefined();
    expect(screen.getByText('PostgreSQL')).toBeDefined();
  });

  it('renders completed ask_user toolCall as an inline resolved exchange', () => {
    const toolCall: ToolCallPayload = {
      id: 'tc-question-2',
      tool: 'ask_user',
      params: {
        question: 'Select theme:',
        options: ['Dark', 'Light'],
      },
      status: 'completed',
      result: 'Dark',
      requiresApproval: false,
      timestamp: Date.now(),
    };

    render(<AskUserCard toolCall={toolCall} />);
    expect(screen.getByText(/Select theme:/i)).toBeDefined();
    expect(screen.getByText('Dark')).toBeDefined();
  });

  it('renders ask_user toolCall with Unanswered badge when marked unanswered after new prompt', async () => {
    const { markQuestionUnanswered } = await import('../utils/agentSocket.js');
    const toolCall: ToolCallPayload = {
      id: 'tc-question-unanswered-1',
      tool: 'ask_user',
      params: {
        question: 'What heading should we use for hero section?',
        options: ['Welcome to Cats', 'Adopt a Furry Friend'],
      },
      status: 'executing',
      requiresApproval: false,
      timestamp: Date.now(),
    };

    markQuestionUnanswered('tc-question-unanswered-1');

    render(<AskUserCard toolCall={toolCall} />);
    expect(screen.getByText('Unanswered')).toBeDefined();
    expect(screen.getByText('Astra asked')).toBeDefined();
    expect(screen.getByText(/What heading should we use for hero section?/i)).toBeDefined();
    // Options and input form should NOT be rendered
    expect(screen.queryByText('Welcome to Cats')).toBeNull();
    expect(screen.queryByPlaceholderText(/type your own answer/i)).toBeNull();
  });

  it('stops scanning backwards and returns null fallback when a user message followed the question', async () => {
    const { findAskUserFallback } = await import('../components/Common/AskUserCard.js');
    const messages = [
      {
        id: 'msg-asst-1',
        role: 'assistant',
        content: 'I have a question for you.',
        toolCalls: [
          {
            id: 'tc-old-question',
            tool: 'ask_user',
            params: { question: 'Pick a color' },
            status: 'executing',
          },
        ],
      },
      {
        id: 'msg-user-2',
        role: 'user',
        content: 'Never mind, build the navbar first.',
      },
      {
        id: 'msg-asst-2',
        role: 'assistant',
        content: 'Building the navbar now...',
      },
    ];

    const fallback = findAskUserFallback(messages);
    expect(fallback).toBeNull();
  });
});
