import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import sourceConfig from '../../tsconfig.source.json' with { type: 'json' }

// Match the repository's source checks so workspace dist cannot hide an API change.
const root = new URL('../../', import.meta.url)
const sourceAliases = [
  ...Object.entries(sourceConfig.compilerOptions.paths)
    .sort(([a], [b]) => b.length - a.length)
    .flatMap(([find, targets]) =>
      targets.map((target) => ({ find, replacement: fileURLToPath(new URL(target, root)) })),
    ),
]

export default defineConfig({
  resolve: { alias: sourceAliases },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: [
            'server/**/*.test.ts',
            'shared/**/*.test.ts',
            'web/src/**/*.test.ts',
            'web/src/**/*.test.tsx',
            'tests/**/*.test.ts',
            'tests/**/*.test.tsx',
          ],
          exclude: ['**/node_modules/**', 'tests/integration/**', 'tests/load/**', 'tests/e2e/**'],
          environment: 'node',
          typecheck: {
            enabled: true,
            include: ['tests/**/*.test-d.ts', 'tests/**/*.test-d.tsx'],
            tsconfig: './tests/tsconfig.json',
            ignoreSourceErrors: false,
          },
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
    ],
  },
})
