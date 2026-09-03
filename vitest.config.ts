import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@creditmesh/core': resolve(__dirname, 'packages/core/src/index.ts'),
      '@creditmesh/adapters': resolve(__dirname, 'packages/adapters/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
