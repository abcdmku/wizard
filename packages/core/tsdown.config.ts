import { defineConfig, type UserConfig } from 'tsdown'

const shared: UserConfig = {
  format: ['esm', 'cjs'],
  platform: 'neutral',
  target: 'es2022',
  dts: true,
  sourcemap: true,
  minify: false,
  treeshake: true,
}

// Two single-entry builds (not one build with two entries): rolldown would otherwise split the
// shared modules into hashed chunks and the emitted declarations would be re-export stubs. The
// testing entry externalizes the main entry, so `dist/testing.d.ts` imports the wire types from
// `@openwizard/core` instead of duplicating them.
export default defineConfig([
  { ...shared, entry: { index: 'src/index.ts' }, clean: true },
  {
    ...shared,
    entry: { testing: 'src/testing.ts' },
    clean: false,
    external: ['@openwizard/core'],
  },
])
