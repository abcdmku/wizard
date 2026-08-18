import { defineConfig } from 'vitest/config'

// Standalone config so `pnpm --filter example-10-devtools check` runs the headless UI test alone,
// against the BUILT packages (workspace links → dist). The root `pnpm test` runs the same test
// against the sources through the root config's `examples-react` project.
export default defineConfig({
  test: { include: ['src/**/*.test.tsx'], environment: 'jsdom' },
})
