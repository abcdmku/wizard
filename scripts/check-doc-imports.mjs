#!/usr/bin/env node
/**
 * Validate that every `import { … } from '@openwizard/<pkg>[/<entry>]'` inside a
 * fenced code block in any markdown file names symbols that that ENTRY actually
 * exports (`@openwizard/core` and `@openwizard/core/testing` are different
 * surfaces). Catches docs referencing removed/renamed/moved APIs.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { collectExports, listPackages, ROOT } from './lib/exports.mjs'

// `docs/design` holds the architecture plan + ADRs (design history, may cite superseded APIs).
const IGNORE_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', '.changeset', 'design'])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (IGNORE_DIRS.has(entry)) continue
    const p = join(dir, entry)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (entry.endsWith('.md') || entry.endsWith('.mdx')) out.push(p)
  }
  return out
}

// Keyed by import specifier: '@openwizard/core', '@openwizard/core/testing', '@openwizard/react', …
const exportsBySpecifier = new Map()
for (const pkg of listPackages()) {
  for (const entry of pkg.entries) {
    exportsBySpecifier.set(
      entry.specifier,
      new Set(collectExports(entry.indexPath).map((e) => e.name)),
    )
  }
}

const importRe =
  /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"](@openwizard\/[a-z-]+(?:\/[a-z-]+)*)['"]/g
// Info strings may carry attributes (```ts title="examples/…/flow.ts" — see check-readme-quickstart).
const fenceRe = /```[a-zA-Z]*[^\n]*\n([\s\S]*?)```/g

let problems = 0
for (const file of walk(ROOT)) {
  const text = readFileSync(file, 'utf8')
  for (const fence of text.matchAll(fenceRe)) {
    const code = fence[1]
    for (const m of code.matchAll(importRe)) {
      const names = m[1]
        .split(',')
        .map(
          (s) =>
            s
              .trim()
              .replace(/^type\s+/, '')
              .split(/\s+as\s+/)[0],
        )
        .filter(Boolean)
      const pkg = m[2]
      const known = exportsBySpecifier.get(pkg)
      if (!known) {
        problems++
        console.error(`[doc-imports] ${relative(ROOT, file)}: unknown package or entry '${pkg}'`)
        continue
      }
      for (const n of names) {
        if (!known.has(n)) {
          problems++
          console.error(`[doc-imports] ${relative(ROOT, file)}: '${n}' is not exported by ${pkg}`)
        }
      }
    }
  }
}

if (problems > 0) {
  console.error(`[doc-imports] ${problems} problem(s)`)
  process.exit(1)
}
console.log('[doc-imports] all documented imports exist')
