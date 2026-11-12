import { defineConfig, type UserConfig } from 'tsdown'

const shared: UserConfig = {
  format: ['esm', 'cjs'],
  platform: 'neutral',
  target: 'es2022',
  dts: true,
  sourcemap: true,
  minify: false,
  treeshake: true,
  // `@openwizard/store-kit` is a private workspace package: its source is inlined into every
  // entry that imports it, so the published package never names it.
  noExternal: ['@openwizard/store-kit'],
}

// One build per entry so each emitted declaration file is self-contained (a shared build would
// split common modules into hashed chunks). The entries import each other by package name, kept
// external, so the store protocol (and `DurableStoreError`) exists once at runtime and in types;
// `vitest` stays an optional peer of the testing entry.
export default defineConfig([
  { ...shared, entry: { store: 'src/store.ts' }, clean: true },
  {
    ...shared,
    entry: { index: 'src/index.ts' },
    clean: false,
    external: ['@openwizard/durable/store'],
  },
  {
    ...shared,
    entry: { testing: 'src/testing.ts' },
    clean: false,
    external: ['@openwizard/durable/store', 'vitest'],
  },
])
