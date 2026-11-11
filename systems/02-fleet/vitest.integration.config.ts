import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { sourceAliases } from './vitest.aliases'

const here = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: here,
  resolve: { alias: sourceAliases },
  test: {
    name: 'fleet-integration',
    include: ['tests/**/*.integration.test.ts'],
    fileParallelism: false,
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    typecheck: {
      enabled: false,
    },
  },
})
