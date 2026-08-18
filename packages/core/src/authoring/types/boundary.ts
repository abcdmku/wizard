/**
 * Boundaries — the data doors: Standard Schemas and branded `Checker`s (`boundary.parse` & co).
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
 * input (draft) type — equal to `O` for checkers; the (private, nominal) brand keeps plain
 * functions and hand-written objects out.
 * @public
 */
export interface Checker<O, I = O> {
  readonly [CHECKER]: CheckerKind
  readonly '~types'?: { readonly input: I; readonly output: O }
}

/**
 * A data door: any Standard Schema (Zod 4 / Valibot / ArkType / …) or a branded `Checker`.
 * `O` is the parsed output type, `I` the accepted input (draft) type.
 * @public
 */
export type Boundary<O, I = O> = StandardSchemaV1<I, O> | Checker<O, I>

/**
 * Output type of a boundary.
 * @public
 */
export type InferBoundary<B> =
  B extends StandardSchemaV1<unknown, infer O> ? O : B extends Checker<infer O, unknown> ? O : never

/**
 * Input (draft) type of a boundary.
 * @public
 */
export type InferBoundaryInput<B> =
  B extends StandardSchemaV1<infer I, unknown> ? I : B extends Checker<unknown, infer I> ? I : never
