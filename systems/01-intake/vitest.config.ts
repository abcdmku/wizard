import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { sourceAliases } from './vitest.sources.js'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root,
  resolve: { alias: sourceAliases },
  test: {
    name: 'intake',
    include: ['api/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['tests/**/*.integration.test.ts'],
    environment: 'node',
    typecheck: {
      enabled: true,
      include: ['api/**/*.test-d.ts', 'tests/**/*.test-d.ts'],
    },
  },
})
