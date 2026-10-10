#!/usr/bin/env node
/**
 * Every symbol exported from a public entry (`packages/<pkg>/src/index.ts`,
 * `src/testing.ts`, …) must carry TSDoc with a `@public` tag (so the export
 * table has a summary and the API surface is deliberate). Symbols tagged
 * `@internal` must not be exported at all.
 */
import { relative } from 'node:path'
import { collectExports, listPackages, ROOT } from './lib/exports.mjs'

let problems = 0
for (const pkg of listPackages()) {
  for (const entry of pkg.entries) {
    const label = entry.specifier
    for (const e of collectExports(entry.indexPath)) {
      const where = e.file ? `${relative(ROOT, e.file)}:${e.line}` : label
      if (e.tags.includes('internal')) {
        problems++
        console.error(`[public-tags] ${label}: '${e.name}' is @internal but exported (${where})`)
        continue
      }
      if (!e.tags.includes('public')) {
        problems++
        console.error(`[public-tags] ${label}: '${e.name}' has no @public TSDoc tag (${where})`)
      } else if (!e.summary) {
        problems++
        console.error(
          `[public-tags] ${label}: '${e.name}' is @public but has no summary line (${where})`,
        )
      }
    }
  }
}
if (problems > 0) {
  console.error(`[public-tags] ${problems} problem(s)`)
  process.exit(1)
}
console.log('[public-tags] every export is documented and @public')
