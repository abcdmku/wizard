#!/usr/bin/env node
/**
 * API snapshot governance — one snapshot per public ENTRY.
 *
 *   node scripts/check-api.mjs            # diff packages/<pkg>/dist/<entry>.d.ts against api/<slug>.d.ts
 *   node scripts/check-api.mjs --update   # overwrite the snapshots
 *
 * Entries come from each package's `exports` (`.` → api/core.d.ts, `./testing` →
 * api/core-testing.d.ts, …). Also fails if a public declaration file contains the `any` type
 * or an `as` assertion (rules: no `any` / no `as` in the public surface).
 * Requires `pnpm build` to have run.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { listPackages, ROOT } from './lib/exports.mjs'

const update = process.argv.includes('--update')
const apiDir = join(ROOT, 'api')
mkdirSync(apiDir, { recursive: true })

let failed = false

for (const pkg of listPackages()) {
  for (const entry of pkg.entries) {
    const label = entry.specifier
    if (!existsSync(entry.dtsPath)) {
      console.error(
        `[api] ${label}: ${relative(ROOT, entry.dtsPath)} missing — run pnpm build first`,
      )
      failed = true
      continue
    }
    const content = readFileSync(entry.dtsPath, 'utf8').replaceAll('\r\n', '\n')

    // Public-surface hygiene: no `any`, no `as` assertions in emitted declarations.
    const stripped = stripComments(content)
    // `any` as a TYPE only — not the property named `any` (e.g. `dependsOn: { any: [...] }`).
    const anyHits = [...stripped.matchAll(/(?<![\w$.'"])any(?![\w$]|\s*\??:)/g)].length
    if (anyHits > 0) {
      console.error(
        `[api] ${label}: ${anyHits} occurrence(s) of 'any' in the public declaration file`,
      )
      failed = true
    }
    const asHits = [...stripped.matchAll(/\)\s+as\s+[A-Za-z_$]/g)].length
    if (asHits > 0) {
      console.error(
        `[api] ${label}: ${asHits} type assertion(s) leaked into the public declaration file`,
      )
      failed = true
    }

    const snapshotPath = join(apiDir, `${entry.slug}.d.ts`)
    if (update) {
      writeFileSync(snapshotPath, content)
      console.log(`[api] wrote ${relative(ROOT, snapshotPath)}`)
      continue
    }
    if (!existsSync(snapshotPath)) {
      console.error(
        `[api] ${label}: no snapshot at ${relative(ROOT, snapshotPath)} — run pnpm check:api:update`,
      )
      failed = true
      continue
    }
    const prev = readFileSync(snapshotPath, 'utf8').replaceAll('\r\n', '\n')
    if (prev !== content) {
      console.error(
        `[api] ${label}: public API changed. Review the diff and run pnpm check:api:update (and add a changeset).`,
      )
      printDiff(prev, content)
      failed = true
    } else {
      console.log(`[api] ${label}: unchanged`)
    }
  }
}

process.exit(failed ? 1 : 0)

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

function printDiff(a, b) {
  const al = a.split('\n')
  const bl = b.split('\n')
  const max = Math.max(al.length, bl.length)
  let shown = 0
  for (let i = 0; i < max && shown < 40; i++) {
    if (al[i] !== bl[i]) {
      console.error(`  L${i + 1}\n  - ${al[i] ?? ''}\n  + ${bl[i] ?? ''}`)
      shown++
    }
  }
}
