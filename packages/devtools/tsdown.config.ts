import { defineConfig } from 'tsdown'

// The graph engine (`@xyflow/react`), the layout engine (`elkjs`) and React stay external: the
// host app bundles them once. `dist/style.css` is assembled by `scripts/build-css.mjs`.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  platform: 'neutral',
  target: 'es2022',
  dts: true,
  sourcemap: true,
  minify: false,
  clean: true,
  treeshake: true,
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    '@openwizard/core',
    '@xyflow/react',
    /^elkjs(\/.*)?$/,
  ],
})
