import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const source = JSON.parse(
  readFileSync(new URL('../../tsconfig.source.json', import.meta.url), 'utf8'),
)
const aliases = Object.fromEntries(
  Object.entries(source.compilerOptions.paths as Record<string, readonly string[]>)
    .sort(([a], [b]) => b.length - a.length)
    .map(([name, paths]) => [name, fileURLToPath(new URL(`../../${paths[0]}`, import.meta.url))]),
)

export default defineConfig({
  resolve: { alias: aliases },
  test: {
    include: ['snippets/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
})
