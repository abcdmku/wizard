import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { sourceAliases } from './vitest.sources.js'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: { alias: sourceAliases },
  test: {
    name: 'intake-unit',
    include: ['api/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['tests/**/*.integration.test.ts'],
    environment: 'node',
    typecheck: {
      enabled: true,
      include: ['api/**/*.test-d.ts', 'tests/**/*.test-d.ts'],
    },
  },
})
