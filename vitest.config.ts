import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import sourceConfig from './tsconfig.source.json'

/**
 * Root Vitest config.
 *
 * - `projects` keeps core/react/examples isolated (different environments).
 * - Every `@openwizard/*` import resolves to package SOURCE, at runtime and in type tests, from
 *   one table: the `paths` of `tsconfig.source.json`. The aliases below are derived from it and
 *   each package's `tsconfig.test.json` (its `typecheck` tsconfig) extends it, so a stale or
 *   missing `dist` never fails a test. Each example's own `check` script (`pnpm examples`) still
 *   resolves the built `dist` through the workspace link.
 * - `typecheck` runs `*.test-d.ts` files through tsc so type assertions (`expectTypeOf`,
 *   `@ts-expect-error`) are verified; `ignoreSourceErrors: false` also fails on errors in the
 *   sources those tests compile.
 */
const root = new URL('./', import.meta.url)
// Most specific first: a plain `'@openwizard/core'` alias would also swallow `…/core/testing`.
const sourceAliases = [
  {
    find: '@openwizard/devtools/style.css',
    replacement: fileURLToPath(new URL('packages/devtools/src/styles/theme.css', root)),
  },
  ...Object.entries(sourceConfig.compilerOptions.paths)
    .sort(([a], [b]) => b.length - a.length)
    .flatMap(([find, targets]) =>
      targets.map((target) => ({ find, replacement: fileURLToPath(new URL(target, root)) })),
    ),
]

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: sourceAliases },
        test: {
          name: 'core',
          root: './packages/core',
          include: ['tests/**/*.test.ts'],
          environment: 'node',
          typecheck: {
            enabled: true,
            include: ['tests/**/*.test-d.ts'],
            exclude: ['tests/__canary__/**'],
            tsconfig: './tsconfig.test.json',
            ignoreSourceErrors: false,
          },
        },
      },
      {
        resolve: { alias: sourceAliases },
        test: {
          name: 'durable',
          root: './packages/durable',
          include: ['tests/**/*.test.ts'],
          environment: 'node',
          typecheck: {
            enabled: true,
            include: ['tests/**/*.test-d.ts'],
            tsconfig: './tsconfig.test.json',
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
            tsconfig: './tsconfig.test.json',
            ignoreSourceErrors: false,
          },
        },
      },
      {
        resolve: { alias: sourceAliases },
        test: {
          name: 'react',
          root: './packages/react',
          include: ['tests/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          typecheck: {
            enabled: true,
            include: ['tests/**/*.test-d.{ts,tsx}'],
            tsconfig: './tsconfig.test.json',
            ignoreSourceErrors: false,
          },
        },
      },
      {
        resolve: { alias: sourceAliases },
        test: {
          name: 'devtools',
          root: './packages/devtools',
          include: ['tests/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['./tests/setup.ts'],
          typecheck: {
            enabled: true,
            include: ['tests/**/*.test-d.{ts,tsx}'],
            tsconfig: './tsconfig.test.json',
            ignoreSourceErrors: false,
          },
        },
      },
      {
        resolve: { alias: sourceAliases },
        test: {
          name: 'opentelemetry',
          root: './packages/opentelemetry',
          include: ['tests/**/*.test.ts'],
          environment: 'node',
          typecheck: {
            enabled: true,
            include: ['tests/**/*.test-d.ts'],
            tsconfig: './tsconfig.test.json',
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
            tsconfig: './tsconfig.test.json',
            ignoreSourceErrors: false,
          },
        },
      },
      {
        resolve: { alias: sourceAliases },
        test: {
          name: 'http',
          root: './packages/http',
          include: ['tests/**/*.test.ts'],
          environment: 'node',
          typecheck: {
            enabled: true,
            include: ['tests/**/*.test-d.ts'],
            tsconfig: './tsconfig.test.json',
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
