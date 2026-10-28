import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.join(root, 'src'),
      // `server-only` throws outside React Server Components; tests exercise server code directly.
      'server-only': path.join(root, 'tests/support/empty-module.ts'),
    },
  },
  test: {
    environment: 'node',
    env: { NODE_ENV: 'test' },
    testTimeout: 30_000,
    hookTimeout: 120_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          globalSetup: ['tests/support/global-setup.ts'],
          setupFiles: ['tests/support/setup-db.ts'],
          pool: 'forks',
        },
      },
    ],
  },
});
