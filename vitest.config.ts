import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts', 'prisma/**/*.{test,spec}.ts'],
    exclude: ['dist/**', 'node_modules/**', 'src/generated/**'],
    clearMocks: true,
    restoreMocks: true,
    // Structured logs are silenced during tests so the reporter output stays
    // readable. The app reads LOG_LEVEL at import time and dotenv never
    // overrides an existing variable, so this wins over any .env file.
    env: {
      LOG_LEVEL: 'silent',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/generated/**'],
    },
  },
});
