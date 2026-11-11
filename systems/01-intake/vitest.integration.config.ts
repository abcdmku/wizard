import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { sourceAliases } from './vitest.sources.js'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: { alias: sourceAliases },
  test: {
    name: 'intake-integration',
    include: ['tests/**/*.integration.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    typecheck: { enabled: false },
  },
})
