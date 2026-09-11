import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    // Only run this project's own tests. `vendor/` holds third-party checkouts
    // that ship their own suites and test runner config.
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'server/**/*.{test,spec}.ts'],
    exclude: [
      'node_modules/**',
      'dist/**',
      'dist-exe/**',
      'vendor/**',
      // Monaco can't be loaded in jsdom — needs full browser environment
      'src/test/CodeEditor.test.tsx',
      // App test transitively imports Monaco through nested components
      'src/test/App.test.tsx',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData',
        'dist/',
        'dist-exe/',
        'vendor/',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
