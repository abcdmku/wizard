import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/nitro.ts'],
  format: ['esm', 'cjs'],
  platform: 'neutral',
  target: 'es2022',
  dts: true,
  sourcemap: true,
  minify: false,
  clean: true,
  treeshake: true,
  external: [
    '@openwizard/core',
    '@standard-schema/spec',
    'nitro',
    'standardwebhooks',
    'node:fs',
    'node:path',
    'node:url',
  ],
})
