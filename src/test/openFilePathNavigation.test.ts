import { describe, it, expect, beforeEach } from 'vitest';
import { useIDEStore } from '../stores/ideStore.js';

describe('openFilePath Navigation & Line Parsing', () => {
  beforeEach(() => {
    useIDEStore.setState({
      openTabs: [
        { path: 'src/App.tsx', name: 'App.tsx', content: '// App code', isDirty: false, language: 'typescriptreact' },
      ],
      activeTabPath: 'src/App.tsx',
      cursorPosition: null,
    });
  });

  it('switches to existing tab and parses line numbers (e.g. src/App.tsx:42)', async () => {
    await useIDEStore.getState().openFilePath('src/App.tsx:42');

    expect(useIDEStore.getState().activeTabPath).toBe('src/App.tsx');
    expect(useIDEStore.getState().cursorPosition).toEqual({ line: 42, column: 1 });
  });

  it('normalizes file:// URIs and #L line numbers', async () => {
    await useIDEStore.getState().openFilePath('file:///src/App.tsx#L88');

    expect(useIDEStore.getState().activeTabPath).toBe('src/App.tsx');
    expect(useIDEStore.getState().cursorPosition).toEqual({ line: 88, column: 1 });
  });
});
