import { defineConfig, type UserConfig } from 'tsdown'

const shared: UserConfig = {
  format: ['esm', 'cjs'],
  platform: 'neutral',
  target: 'es2022',
  dts: true,
  sourcemap: true,
  minify: false,
  treeshake: true,
  external: [/^@openwizard\/core(\/.*)?$/, '@standard-schema/spec', /^nitro(\/.*)?$/, /^node:/],
}

// One build per entry: the entries share no runtime code, and each emitted declaration file is
// self-contained (a shared build would split the common types into a hashed chunk that the API
// snapshots cannot guard).
export default defineConfig([
  { ...shared, entry: { index: 'src/index.ts' }, clean: true },
  { ...shared, entry: { client: 'src/client.ts' }, clean: false },
  { ...shared, entry: { nitro: 'src/nitro.ts' }, clean: false },
])
