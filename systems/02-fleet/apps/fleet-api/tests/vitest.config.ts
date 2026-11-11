import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { sourceAliases } from '../../../vitest.aliases'

const root = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig({
  root,
  resolve: { alias: sourceAliases },
  test: {
    name: 'fleet-api',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/**/*.integration.test.ts'],
    environment: 'node',
    typecheck: {
      enabled: true,
      tsconfig: './tsconfig.json',
      include: ['tests/**/*.test-d.ts'],
    },
  },
})
