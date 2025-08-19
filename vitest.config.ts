import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'html'],
      exclude: ['dist/**', 'examples/**', 'vitest.config.ts', 'tsup.config.ts'],
    },
  },
});
