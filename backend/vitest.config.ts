import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
    fileParallelism: false,
    env: {
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/network_growth_engine',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', 'prisma/'],
    },
  },
});
