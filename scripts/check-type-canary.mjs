#!/usr/bin/env node
/**
 * Type-test canaries. Each one runs tsc on a small project inside a package.
 *
 * `tests/__canary__` MUST FAIL to type-check. v1 shipped `expectTypeOf` assertions that never ran
 * (no `--typecheck`, tests excluded from tsc). Every package may contain
 * `tests/__canary__/must-fail.test-d.ts` with a deliberate type error, and this script fails if
 * tsc accepts it. That proves the checker sees type errors in test files.
 *
 * `tests/__declarations__` MUST PASS with `declaration: true`. It is a consumer project that
 * imports the built package and exports what applications export: a wizard, step modules, a
 * header object, projections and values read from a run. If a type in one of those inferred
 * types is not exported from the package, tsc reports TS4023 or TS4058 and this script fails.
 * It needs `pnpm build` first.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const packagesDir = join(root, 'packages')
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')

/** Runs tsc on one project and returns its exit status and output. */
function typecheck(tsconfig) {
  const res = spawnSync(process.execPath, [tsc, '-p', tsconfig, '--noEmit', '--pretty', 'false'], {
    cwd: root,
    encoding: 'utf8',
  })
  return { status: res.status, out: `${res.stdout ?? ''}${res.stderr ?? ''}` }
}

let canaries = 0
let ok = true

for (const pkg of readdirSync(packagesDir)) {
  const mustFail = join(packagesDir, pkg, 'tests', '__canary__', 'tsconfig.json')
  if (existsSync(mustFail)) {
    canaries++
    const { status, out } = typecheck(mustFail)
    if (status === 0 || !/must-fail\.test-d\.ts/.test(out)) {
      ok = false
      console.error(
        `[canary] ${pkg}: expected tsc to FAIL on tests/__canary__/must-fail.test-d.ts but it did not.`,
      )
      console.error(out || '(no output)')
    } else {
      console.log(`[canary] ${pkg}: ok — tsc failed on the deliberate error as expected.`)
    }
  }

  const declarations = join(packagesDir, pkg, 'tests', '__declarations__', 'tsconfig.json')
  if (existsSync(declarations)) {
    if (!existsSync(join(packagesDir, pkg, 'dist', 'index.d.ts'))) {
      ok = false
      console.error(`[declarations] ${pkg}: dist/index.d.ts is missing. Run pnpm build first.`)
      continue
    }
    const { status, out } = typecheck(declarations)
    if (status === 0) {
      console.log(`[declarations] ${pkg}: ok — every exported value has a nameable type.`)
    } else {
      ok = false
      console.error(
        `[declarations] ${pkg}: tests/__declarations__ does not compile with declaration: true.`,
      )
      if (/TS40(23|58)/.test(out)) {
        console.error(
          `[declarations] ${pkg}: export each type named below from the package entry, with a @public comment.`,
        )
      }
      console.error(out || '(no output)')
    }
  }
}

if (canaries === 0) {
  console.error(
    '[canary] no packages/*/tests/__canary__/tsconfig.json found — the type-test harness is unverified.',
  )
  process.exit(1)
}
process.exit(ok ? 0 : 1)
