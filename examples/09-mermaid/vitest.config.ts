import { defineConfig } from 'vitest/config'

// Standalone config so `pnpm --filter example-09-mermaid check` runs this example alone,
// against the BUILT `@openwizard/core` (workspace link → dist). The root `pnpm test` runs the
// same tests against the core source through the root config's `examples` project.
export default defineConfig({ test: { include: ['src/**/*.test.ts'], environment: 'node' } })
