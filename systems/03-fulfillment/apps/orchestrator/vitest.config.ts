import { defineConfig } from 'vitest/config'
import { sourceAliases } from '../../vitest.sources.ts'

export default defineConfig({
  root: import.meta.dirname,
  resolve: { alias: sourceAliases },
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 10_000,
    maxWorkers: 2,
  },
})
