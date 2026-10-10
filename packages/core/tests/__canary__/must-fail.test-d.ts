/**
 * CANARY — this file MUST fail to typecheck.
 *
 * `pnpm test:canary` (scripts/check-type-canary.mjs) runs tsc on this file and
 * asserts that it reports an error. If this file ever typechecks, the type-test
 * harness is broken (that is exactly what happened in v1: type tests that
 * silently verified nothing).
 *
 * It is excluded from the normal test/typecheck configs.
 */

const canary: number = 'this is deliberately not a number'

export { canary }
