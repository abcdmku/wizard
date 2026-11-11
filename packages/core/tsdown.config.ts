import { defineConfig, type Plugin, type UserConfig } from 'tsdown'

const shared: UserConfig = {
  format: ['esm', 'cjs'],
  platform: 'neutral',
  target: 'es2022',
  sourcemap: true,
  minify: false,
  treeshake: true,
}

const entries = {
  index: 'src/index.ts',
  testing: 'src/testing.ts',
  inspect: 'src/inspect/index.ts',
  mirror: 'src/mirror/index.ts',
}

/** Keeps only the declarations of a build: its JavaScript comes from the shared build. */
const declarationsOnly: Plugin = {
  name: 'openwizard:declarations-only',
  generateBundle(_options, bundle) {
    for (const file of Object.keys(bundle)) {
      if (!/\.d\.c?ts(\.map)?$/.test(file)) delete bundle[file]
    }
  },
}

/** Declarations of one entry; subpaths import the public types from the main entry. */
const declarations = (name: keyof typeof entries): UserConfig => ({
  ...shared,
  entry: { [name]: entries[name] },
  dts: true,
  clean: false,
  plugins: [declarationsOnly],
  ...(name === 'index' ? {} : { external: ['@openwizard/core'] }),
})

// JavaScript: ONE build over every entry, so the modules entries share (errors, the compiler,
// the boundary checker symbol) live in one chunk and `WizardError` / `isBoundary` keep their
// identity across `@openwizard/core`, `/inspect` and `/testing` (scripts/check-pack.mjs checks).
// Declarations: one build per entry, because a multi-entry declaration build splits the types
// into hashed chunks and leaves `dist/index.d.ts` a re-export stub.
export default defineConfig([
  { ...shared, entry: entries, dts: false, clean: true },
  declarations('index'),
  declarations('testing'),
  declarations('inspect'),
  declarations('mirror'),
])
