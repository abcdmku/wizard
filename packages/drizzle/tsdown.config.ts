import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/pg.ts', 'src/sqlite.ts'],
  format: ['esm', 'cjs'],
  platform: 'neutral',
  target: 'es2022',
  dts: true,
  sourcemap: true,
  minify: false,
  clean: true,
  treeshake: true,
  external: ['@openwizard/durable', 'drizzle-orm'],
})
