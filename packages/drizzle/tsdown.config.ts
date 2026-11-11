import { defineConfig, type UserConfig } from 'tsdown'

const shared: UserConfig = {
  format: ['esm', 'cjs'],
  platform: 'neutral',
  target: 'es2022',
  dts: true,
  sourcemap: true,
  minify: false,
  treeshake: true,
  external: ['@openwizard/durable', 'drizzle-orm'],
  // `@openwizard/store-kit` is a private workspace package: its source is inlined into every
  // entry that imports it, so the published package never names it.
  noExternal: ['@openwizard/store-kit'],
}

// One build per entry: a shared build splits `store.ts` into a hashed chunk and the emitted
// declarations import it (`./store-<hash>.js`). Separate builds keep each entry self-contained;
// an app imports one dialect, so the duplicated adapter code is never loaded twice.
export default defineConfig([
  { ...shared, entry: { index: 'src/index.ts' }, clean: true },
  { ...shared, entry: { pg: 'src/pg.ts' }, clean: false },
  { ...shared, entry: { sqlite: 'src/sqlite.ts' }, clean: false },
])
