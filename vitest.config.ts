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
const durableSource = fileURLToPath(new URL('./packages/durable/src/index.ts', import.meta.url))
const durableDrizzleSource = fileURLToPath(
  new URL('./packages/drizzle/src/index.ts', import.meta.url),
)
const durableDrizzlePgSource = fileURLToPath(
  new URL('./packages/drizzle/src/pg.ts', import.meta.url),
)
const durableDrizzleSqliteSource = fileURLToPath(
  new URL('./packages/drizzle/src/sqlite.ts', import.meta.url),
)
const reactSource = fileURLToPath(new URL('./packages/react/src/index.ts', import.meta.url))
const devtoolsSource = fileURLToPath(new URL('./packages/devtools/src/index.ts', import.meta.url))
const effectSource = fileURLToPath(new URL('./packages/effect/src/index.ts', import.meta.url))
const effectV4Source = fileURLToPath(new URL('./packages/effect-v4/src/index.ts', import.meta.url))
const webhooksSource = fileURLToPath(new URL('./packages/webhooks/src/index.ts', import.meta.url))
const webhooksNitroSource = fileURLToPath(
  new URL('./packages/webhooks/src/nitro.ts', import.meta.url),
)
const devtoolsStyle = fileURLToPath(
  new URL('./packages/devtools/src/styles/theme.css', import.meta.url),
)
// Most specific first: a plain `'@openwizard/core'` alias would also swallow `…/core/testing`.
const sourceAliases = [
  { find: '@openwizard/core/testing', replacement: coreTestingSource },
  { find: '@openwizard/core', replacement: coreSource },
  { find: '@openwizard/durable', replacement: durableSource },
  { find: '@openwizard/drizzle/pg', replacement: durableDrizzlePgSource },
  { find: '@openwizard/drizzle/sqlite', replacement: durableDrizzleSqliteSource },
  { find: '@openwizard/drizzle', replacement: durableDrizzleSource },
  { find: '@openwizard/react', replacement: reactSource },
  { find: '@openwizard/devtools/style.css', replacement: devtoolsStyle },
  { find: '@openwizard/devtools', replacement: devtoolsSource },
  { find: '@openwizard/effect', replacement: effectSource },
  { find: '@openwizard/effect-v4', replacement: effectV4Source },
  { find: '@openwizard/webhooks/nitro', replacement: webhooksNitroSource },
  { find: '@openwizard/webhooks', replacement: webhooksSource },
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
          name: 'durable',
          root: './packages/durable',
          include: ['tests/**/*.test.ts'],
          environment: 'node',
          typecheck: {
            enabled: true,
            include: ['tests/**/*.test-d.ts'],
            tsconfig: './tsconfig.json',
            ignoreSourceErrors: false,
          },
        },
      },
      {
        resolve: { alias: sourceAliases },
        test: {
          name: 'drizzle',
          root: './packages/drizzle',
          include: ['tests/**/*.test.ts'],
          environment: 'node',
          typecheck: {
            enabled: true,
            include: ['tests/**/*.test-d.ts'],
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
        test: {
          name: 'opentelemetry',
          root: './packages/opentelemetry',
          include: ['tests/**/*.test.ts'],
          environment: 'node',
          typecheck: {
            enabled: true,
            include: ['tests/**/*.test-d.ts'],
            tsconfig: './tsconfig.json',
            ignoreSourceErrors: false,
          },
        },
      },
      {
        resolve: { alias: sourceAliases },
        test: {
          name: 'effect',
          root: './packages/effect',
          include: ['tests/**/*.test.ts'],
          environment: 'node',
          typecheck: {
            enabled: true,
            include: ['tests/**/*.test-d.ts'],
            tsconfig: './tsconfig.json',
            ignoreSourceErrors: false,
          },
        },
      },
      {
        resolve: { alias: sourceAliases },
        test: {
          name: 'effect-v4',
          root: './packages/effect-v4',
          include: ['tests/**/*.test.ts'],
          environment: 'node',
          typecheck: {
            enabled: true,
            include: ['tests/**/*.test-d.ts'],
            tsconfig: './tsconfig.json',
            ignoreSourceErrors: false,
          },
        },
      },
      {
        resolve: { alias: sourceAliases },
        test: {
          name: 'webhooks',
          root: './packages/webhooks',
          include: ['tests/**/*.test.ts'],
          environment: 'node',
          typecheck: {
            enabled: true,
            include: ['tests/**/*.test-d.ts'],
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
