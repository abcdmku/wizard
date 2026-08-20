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

export default defineConfig({
  ...shared,
  entry: { index: 'src/index.ts' },
  clean: true,
})
