import '@testing-library/jest-dom';
import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Mock Monaco editor which can't be loaded in jsdom
vi.mock('@monaco-editor/react', () => ({
  default: () => null,
  loader: {
    init: vi.fn(),
    config: vi.fn(),
  },
}));

// Cleanup after each test case
afterEach(() => {
  cleanup();
});

// Add custom matchers
expect.extend({});
