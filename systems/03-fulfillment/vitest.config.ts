import { defineConfig } from 'vitest/config'
import { sourceAliases } from './vitest.sources.ts'

export default defineConfig({
  resolve: { alias: sourceAliases },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['tests/e2e/**', 'tests/integration/**', 'tests/**/*.integration.test.ts'],
    testTimeout: 10_000,
    maxWorkers: 2,
  },
})
