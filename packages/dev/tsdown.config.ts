import { defineConfig } from 'tsdown'

const external = ['@openwizard/core', '@openwizard/core/inspect', /^tsx(\/.*)?$/]

// The server and the command line run on Node. Vite builds the browser UI into `dist/ui`.
export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    platform: 'node',
    fixedExtension: false,
    target: 'node20',
    dts: true,
    sourcemap: true,
    minify: false,
    clean: true,
    treeshake: true,
    shims: true,
    external,
  },
  {
    entry: ['src/cli.ts'],
    format: ['esm'],
    platform: 'node',
    fixedExtension: false,
    target: 'node20',
    dts: false,
    sourcemap: true,
    minify: false,
    clean: false,
    external,
  },
])
