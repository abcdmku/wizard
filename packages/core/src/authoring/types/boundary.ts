/**
 * Boundaries describe accepted inputs and parsed outputs for schemas and branded checkers.
 * @packageDocumentation
 */

import type { StandardSchemaV1 } from '@standard-schema/spec'

/**
 * Runtime brand of a `Checker`. A module-private `Symbol()` (deliberately not `Symbol.for`,
 * which anyone could look up): only `boundary.parse/guard/assert/trusted` can mint a checker,
 * so a forged `{ '~checker': 'assert' }` object is never a boundary. Not exported from the
 * package; the `Checker` type is nominal through this key.
 * @internal
 */
export const CHECKER: unique symbol = Symbol('openwizard.checker')

/**
 * The four checker kinds: `parse` (return or throw), `guard` (predicate), `assert` (assertion
 * function) and `trusted` (no runtime check).
 * @public
 */
export type CheckerKind = 'parse' | 'guard' | 'assert' | 'trusted'

/**
 * A branded runtime checker built by `boundary.parse/guard/assert/trusted`. `I` is the
 * input type equals `O` for checkers. The private brand keeps plain
 * functions and hand-written objects out.
 * @public
 */
export interface Checker<O, I = O> {
  readonly [CHECKER]: CheckerKind
  readonly '~types'?: { readonly input: I; readonly output: O }
}

/**
 * A Standard Schema, such as Zod, Valibot or ArkType, or a branded checker.
 * `O` is the parsed output type, `I` the accepted input (draft) type.
 * @public
 */
export type Boundary<O, I = O> = StandardSchemaV1<I, O> | Checker<O, I>
