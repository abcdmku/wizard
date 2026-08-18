import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Root Vitest config.
 *
 * - `projects` keeps core/react/examples isolated (different environments).
 * - `typecheck` runs `*.test-d.ts` files through tsc so type assertions
 *   (`expectTypeOf`, `@ts-expect-error`) are actually verified in CI.
 *   The v1 codebase shipped type tests that never ran — this is the fix.
 * - The `examples` / `examples-react` projects alias `@openwizard/core` (+ `/testing`) and
 *   `@openwizard/react` to the SOURCES so the example tests run without a build here; each
 *   example's own `check` script (`pnpm examples`) resolves the built `dist` through the
 *   workspace link instead. `examples-react` runs the `.test.tsx` files under jsdom.
 */
const coreSource = fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url))
const coreTestingSource = fileURLToPath(new URL('./packages/core/src/testing.ts', import.meta.url))
const reactSource = fileURLToPath(new URL('./packages/react/src/index.ts', import.meta.url))
const devtoolsSource = fileURLToPath(new URL('./packages/devtools/src/index.ts', import.meta.url))
const devtoolsStyle = fileURLToPath(
  new URL('./packages/devtools/src/styles/theme.css', import.meta.url),
)
// Most specific first: a plain `'@openwizard/core'` alias would also swallow `…/core/testing`.
const sourceAliases = [
  { find: '@openwizard/core/testing', replacement: coreTestingSource },
  { find: '@openwizard/core', replacement: coreSource },
  { find: '@openwizard/react', replacement: reactSource },
  { find: '@openwizard/devtools/style.css', replacement: devtoolsStyle },
  { find: '@openwizard/devtools', replacement: devtoolsSource },
]

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'core',
          root: './packages/core',
          include: ['tests/**/*.test.ts'],
          environment: 'node',
          typecheck: {
            enabled: true,
            include: ['tests/**/*.test-d.ts'],
            exclude: ['tests/__canary__/**'],
            tsconfig: './tsconfig.json',
            ignoreSourceErrors: false,
          },
        },
      },
      {
        test: {
          name: 'react',
          root: './packages/react',
          include: ['tests/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          typecheck: {
            enabled: true,
            include: ['tests/**/*.test-d.{ts,tsx}'],
            tsconfig: './tsconfig.json',
            ignoreSourceErrors: false,
          },
        },
      },
      {
        test: {
          name: 'devtools',
          root: './packages/devtools',
          include: ['tests/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['./tests/setup.ts'],
          typecheck: {
            enabled: true,
            include: ['tests/**/*.test-d.{ts,tsx}'],
            tsconfig: './tsconfig.json',
            ignoreSourceErrors: false,
          },
        },
      },
      {
        resolve: { alias: sourceAliases },
        test: {
          name: 'examples',
          root: './examples',
          include: ['*/src/**/*.test.ts', '*/*.test.ts'],
          environment: 'node',
        },
      },
      {
        resolve: { alias: sourceAliases },
        test: {
          name: 'examples-react',
          root: './examples',
          include: ['*/src/**/*.test.tsx'],
          environment: 'jsdom',
        },
      },
    ],
  },
})
