/**
 * Boundaries at runtime: the branded checkers (`boundary.parse/guard/assert/trusted`) and
 * the adapter that turns any `Boundary` (Standard Schema or checker) into the
 * `RuntimeBoundary` the machine consumes.
 *
 * The checker brand is a module-private `Symbol()` (`CHECKER`): only this module can mint a
 * checker, so a hand-written `{ '~checker': 'assert' }` (or any object without the symbol, a
 * bogus kind, or a missing function) is not a boundary — `isBoundary` says no and
 * `toRuntimeBoundary` throws `WizardError('DEFINITION_INVALID')`.
 *
 * @packageDocumentation
 */

import type { StandardSchemaV1 } from '@standard-schema/spec'
import { describeError, WizardError } from '../errors'
import { getThen } from '../interpreter/thenable'
import type { BoundaryResult, RuntimeBoundary } from './compiled'
import { type Boundary, CHECKER, type Checker, type CheckerKind, type Issue } from './types'

// ---------------------------------------------------------------------------
// Checkers
// ---------------------------------------------------------------------------

/** @internal The runtime shape behind a `Checker`: the brand (kind) plus the function it wraps. */
interface CheckerImpl<T> extends Checker<T> {
  readonly '~fn': ((value: unknown) => unknown) | undefined
}

const KINDS: ReadonlySet<string> = new Set<CheckerKind>(['parse', 'guard', 'assert', 'trusted'])

function checker<T>(kind: CheckerKind, fn: ((value: unknown) => unknown) | undefined): Checker<T> {
  const impl: CheckerImpl<T> = { [CHECKER]: kind, '~fn': fn }
  return impl
}

/**
 * Build a branded `Checker` from a plain function: `parse` (returns the value or throws),
 * `guard` (type predicate), `assert` (assertion function) or `trusted<T>()` (no runtime check —
 * a grep-able escape hatch for data you already trust).
 * @public
 */
export const boundary: {
  parse<T>(fn: (value: unknown) => T): Checker<T>
  guard<T>(fn: (value: unknown) => value is T): Checker<T>
  assert<T>(fn: (value: unknown) => asserts value is T): Checker<T>
  trusted<T>(): Checker<T>
} = {
  parse: (fn) => checker('parse', requireFn(fn, 'boundary.parse')),
  guard: (fn) => checker('guard', requireFn(fn, 'boundary.guard')),
  assert: (fn) => checker('assert', requireFn(fn, 'boundary.assert')),
  trusted: () => checker('trusted', undefined),
}

function requireFn(fn: unknown, what: string): (value: unknown) => unknown {
  if (typeof fn !== 'function') {
    throw new WizardError('DEFINITION_INVALID', `${what} expects a function`)
  }
  return fn as (value: unknown) => unknown
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

/**
 * True when `value` is a boundary: a Standard Schema (`'~standard'`) or a checker minted by
 * `boundary.*` (the private brand, a known kind, and a function for `parse` / `guard` / `assert`).
 * @public
 */
export function isBoundary(value: unknown): value is Boundary<unknown, unknown> {
  return isStandardSchema(value) || isChecker(value)
}

function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    '~standard' in value &&
    typeof value['~standard'] === 'object' &&
    value['~standard'] !== null &&
    'validate' in value['~standard'] &&
    typeof value['~standard'].validate === 'function'
  )
}

function isChecker(value: unknown): value is CheckerImpl<unknown> {
  if (typeof value !== 'object' || value === null || !(CHECKER in value)) return false
  const kind = value[CHECKER]
  if (typeof kind !== 'string' || !KINDS.has(kind)) return false
  const fn = '~fn' in value ? value['~fn'] : undefined
  return kind === 'trusted' ? fn === undefined : typeof fn === 'function'
}

// ---------------------------------------------------------------------------
// Adapter → RuntimeBoundary
// ---------------------------------------------------------------------------

/**
 * Adapt a `Boundary` to the machine's `RuntimeBoundary`. Standard Schemas are validated via
 * `'~standard'.validate` (sync or async, both supported; issues are mapped to `Issue`s);
 * checkers run their function (`parse`/`assert` throw → issues; `guard` false → issue).
 * Anything else — including a forged checker — throws `WizardError('DEFINITION_INVALID')`.
 * @public
 */
export function toRuntimeBoundary(boundary: Boundary<unknown, unknown>): RuntimeBoundary {
  if (isStandardSchema(boundary)) {
    const props = boundary['~standard']
    return {
      kind: 'standard',
      parse: (value) => {
        const result = props.validate(value)
        return isThenable(result) ? result.then(fromStandardResult) : fromStandardResult(result)
      },
    }
  }
  if (!isChecker(boundary)) {
    throw new WizardError(
      'DEFINITION_INVALID',
      'expected a boundary: a Standard Schema or a checker built by boundary.parse/guard/assert/trusted',
    )
  }
  const kind = boundary[CHECKER]
  const fn = boundary['~fn']
  switch (kind) {
    case 'trusted':
      return { kind, parse: (value) => ({ ok: true, value }) }
    case 'guard':
      return {
        kind,
        parse: (value) => {
          let accepted: unknown
          try {
            accepted = fn?.(value)
          } catch (error) {
            return { ok: false, issues: [{ message: describeError(error) }] }
          }
          return accepted === true
            ? { ok: true, value }
            : { ok: false, issues: [{ message: 'value rejected by guard' }] }
        },
      }
    case 'assert':
      return {
        kind,
        parse: (value) => {
          try {
            fn?.(value)
          } catch (error) {
            return { ok: false, issues: issuesFromError(error) }
          }
          return { ok: true, value }
        },
      }
    case 'parse':
      return {
        kind,
        parse: (value) => {
          try {
            return { ok: true, value: fn === undefined ? value : fn(value) }
          } catch (error) {
            return { ok: false, issues: issuesFromError(error) }
          }
        },
      }
  }
}

function fromStandardResult(result: StandardSchemaV1.Result<unknown>): BoundaryResult {
  if (result.issues === undefined) return { ok: true, value: result.value }
  return { ok: false, issues: result.issues.map(toIssue) }
}

/** Standard Schema issue → `Issue` (drop an explicit `undefined` path; keep segments as they are). */
function toIssue(issue: StandardSchemaV1.Issue): Issue {
  return issue.path === undefined
    ? { message: issue.message }
    : { message: issue.message, path: issue.path }
}

/** A thrown value → issues; objects carrying an `issues` array (schema errors) contribute theirs. */
function issuesFromError(error: unknown): readonly Issue[] {
  if (
    typeof error === 'object' &&
    error !== null &&
    'issues' in error &&
    Array.isArray(error.issues)
  ) {
    const mapped = error.issues
      .filter(
        (i: unknown): i is StandardSchemaV1.Issue =>
          typeof i === 'object' && i !== null && 'message' in i && typeof i.message === 'string',
      )
      .map(toIssue)
    if (mapped.length > 0) return mapped
  }
  return [{ message: describeError(error) }]
}

/** A Standard Schema `validate` may return its result synchronously or as a thenable. */
function isThenable(value: unknown): value is PromiseLike<StandardSchemaV1.Result<unknown>> {
  return getThen(value) !== undefined
}
