import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['snippets/**/*.test.ts'],
    environment: 'node',
  },
})
