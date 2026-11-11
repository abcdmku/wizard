import { defineConfig } from 'vitest/config'
import { sourceAliases } from '../vitest.sources.js'

export default defineConfig({
  resolve: { alias: sourceAliases },
  test: {
    environment: 'jsdom',
    restoreMocks: true,
  },
})
