#!/usr/bin/env node
/**
 * Type-test canary.
 *
 * v1 shipped `expectTypeOf` assertions that never ran (no `--typecheck`, tests
 * excluded from tsc). To make sure that can never silently happen again, every
 * package may contain `tests/__canary__/must-fail.test-d.ts` with a deliberate
 * type error. This script typechecks those files and FAILS if tsc reports
 * success — i.e. it proves the checker actually sees type errors in test files.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const packagesDir = join(root, 'packages')
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')

let checked = 0
let ok = true

for (const pkg of readdirSync(packagesDir)) {
  const canaryDir = join(packagesDir, pkg, 'tests', '__canary__')
  const tsconfig = join(canaryDir, 'tsconfig.json')
  if (!existsSync(tsconfig)) continue
  checked++
  const res = spawnSync(process.execPath, [tsc, '-p', tsconfig, '--noEmit', '--pretty', 'false'], {
    cwd: root,
    encoding: 'utf8',
  })
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`
  const mentionsCanary = /must-fail\.test-d\.ts/.test(out)
  if (res.status === 0 || !mentionsCanary) {
    ok = false
    console.error(
      `[canary] ${pkg}: expected tsc to FAIL on tests/__canary__/must-fail.test-d.ts but it did not.`,
    )
    console.error(out || '(no output)')
  } else {
    console.log(`[canary] ${pkg}: ok — tsc failed on the deliberate error as expected.`)
  }
}

if (checked === 0) {
  console.error(
    '[canary] no packages/*/tests/__canary__/tsconfig.json found — the type-test harness is unverified.',
  )
  process.exit(1)
}
process.exit(ok ? 0 : 1)
