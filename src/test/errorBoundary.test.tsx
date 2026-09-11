import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../components/Common/ErrorBoundary.js';

const ProblemChild: React.FC<{ shouldThrow?: boolean }> = ({ shouldThrow }) => {
  if (shouldThrow) {
    throw new Error('Test crash in child component');
  }
  return <div>Clean child content</div>;
};

describe('ErrorBoundary', () => {
  it('renders children normally when no error occurs', () => {
    render(
      <ErrorBoundary>
        <ProblemChild shouldThrow={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText('Clean child content')).toBeDefined();
  });

  it('renders fallback card when child throws an exception', () => {
    // Suppress console.error during deliberate error test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary fallbackTitle="Custom View Crash">
        <ProblemChild shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Custom View Crash')).toBeDefined();
    expect(screen.getByText('Test crash in child component')).toBeDefined();
    expect(screen.getByText('Try Again')).toBeDefined();
    expect(screen.getByText('Reload Page')).toBeDefined();

    consoleSpy.mockRestore();
  });
});
