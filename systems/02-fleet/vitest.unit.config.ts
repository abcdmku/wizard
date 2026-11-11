import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { sourceAliases } from './vitest.aliases'

const here = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: here,
  resolve: { alias: sourceAliases },
  test: {
    name: 'fleet-unit',
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
