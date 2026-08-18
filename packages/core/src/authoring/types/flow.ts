/**
 * The flow: assembly-time validation of a steps map, the `Flow` record, its definition header and
 * the `FlowBuilder` returned by `defineFlow()`.
 * @packageDocumentation
 */

import type { Boundary } from './boundary'
import type { CorrelateSpec, FlowOnHandlers } from './handlers'
import type { Ids } from './hook-args'
import type { Duration, RetryPolicy, StepKind } from './primitives'
import type { BoundTo, CompactStep, FlowStep } from './step'
import type { StepApi } from './step-config'

/**
 * Ids a step references (phantom `refs`).
 * @public
 */
export type RefsOf<S> = S extends { readonly '~types': infer P }
  ? NonNullable<P> extends { readonly refs: infer R }
    ? R
    : never
  : never

/**
 * `T & ValidateSteps<T, C, Ev, D>`: naked `T` wins inference; a failing key evaluates to an
 * object with a `'~error'` message property that no Step has, so the error lands on that
 * step's property line and never cascades into `T`. The `'~bound'` probe checks that every
 * step is bound to this flow's context/events/deps (module variance).
 *
 * IMPORTANT (ADR-001 F1): `T` must NOT be constrained; the homomorphic mapped type below has no
 * visible members while `T` is generic, so it cannot poison inference.
 * @public
 */
export type ValidateSteps<T, C, Ev, D> = {
  readonly [K in keyof T]: [RefsOf<T[K]>] extends [Ids<T>]
    ? T[K] extends { readonly '~bound': BoundTo<C, Ev, D> | undefined }
      ? unknown
      : {
          readonly '~error': `step '${K & string}' is bound to a different context/events/deps than this flow`
        }
    : {
        readonly '~error': `step '${K & string}' references unknown step id(s): '${Exclude<RefsOf<T[K]>, Ids<T>> & string}'`
      }
}
/**
 * Rejects steps maps with dynamic (index-signature) keys — every id must be a literal.
 * @public
 */
export type NoDynamicKeys<T> = string extends keyof T
  ? { readonly '~error': 'steps must be declared with literal keys' }
  : unknown
/**
 * The full assembly check applied by `FlowBuilder.steps`.
 * @public
 */
export type CheckSteps<T, C, Ev, D> = ValidateSteps<T, C, Ev, D> & NoDynamicKeys<T>

/**
 * Phantom facts of a flow.
 * @public
 */
export interface FlowTypes<C, CIn, Ev, D, T> {
  readonly ctx: C
  readonly ctxIn: CIn
  readonly events: Ev
  readonly deps: D
  readonly steps: T
}

/**
 * Flow-level policies.
 * @public
 */
export interface FlowOptions {
  /** What happens when a task fails with no retries left. Default `'halt'`. */
  readonly onFailure?: 'halt' | 'compensate'
  /** Default retry policy for tasks. */
  readonly retry?: RetryPolicy
  /** Ready non-view steps start automatically (`'ready'`, default) or via `runReady()` (`'manual'`). */
  readonly autoRun?: 'ready' | 'manual'
  /** Maximum concurrently running tasks. Default `Infinity`. */
  readonly concurrency?: number
  /** Events with no active listener: buffer them (default `true`) for `ttl` (default `'5m'`). */
  readonly unmatchedEvents?: { readonly buffer: boolean; readonly ttl: Duration }
}

/**
 * A defined flow. `T` is the COMPACT steps map (`{ [id]: FlowStep<…> }`); the runtime object
 * holds the full step records (with hooks).
 * @public
 */
export interface Flow<C, CIn, Ev, D, T> extends FlowOptions {
  readonly '~types': FlowTypes<C, CIn, Ev, D, T> | undefined
  readonly name: string
  readonly version?: number
  readonly context: Boundary<C, CIn>
  readonly events?: { readonly [E in keyof Ev]: Boundary<Ev[E], unknown> }
  readonly deps?: Boundary<D, unknown>
  /**
   * Flow-level `on` handlers by event (`defineFlow({ on })`), stored as opaque functions so the
   * flow type stays covariant in its context; the typed contract is `FlowDefinition.on`.
   */
  readonly on?: { readonly [E in keyof Ev]?: (args: never) => unknown }
  /** Correlation extractors by event (`defineFlow({ correlate })`); stored opaquely like `on`. */
  readonly correlate?: { readonly [E in keyof Ev]?: (payload: never) => string | undefined }
  readonly steps: T
  /** Entry step(s): one id, or several for a flow with more than one entry point (default: the first step). */
  readonly start?: Ids<T> | readonly Ids<T>[]
}

/**
 * The steps map every flow satisfies (an index of `FlowStep`s); the interface breaks the
 * `AnyFlow` ↔ child-flow reference cycle.
 * @public
 */
export interface AnyFlowSteps {
  readonly [id: string]: FlowStep<unknown, unknown, string, StepKind, AnyFlow, unknown>
}

/**
 * Any flow — the constraint of every extractor and of `Wizard<F>`; `any`-free (a flow's
 * `'~types'`/`steps`/boundaries are covariant, so every concrete `Flow` is assignable).
 * @public
 */
export type AnyFlow = Flow<unknown, unknown, Record<string, unknown>, unknown, AnyFlowSteps>

/**
 * `defineFlow(options)` header: name/version, boundaries and policies.
 * @public
 */
export type FlowDefinition<C, CIn, Ev, D> = FlowOptions & {
  /** Persistence identity together with `version`. Required. */
  readonly name: string
  readonly version?: number
  /** Context boundary (`boundary.trusted<C>()` for unvalidated defaults). */
  readonly context: Boundary<C, CIn>
  /** External event boundaries; `Ev` is inferred by reverse mapping. */
  readonly events?: { readonly [E in keyof Ev]: Boundary<Ev[E], unknown> }
  /** Injected dependencies boundary (usually `boundary.trusted<D>()`). */
  readonly deps?: Boundary<D, unknown>
  /**
   * Flow-level event handlers, run after the step-level ones of the same event in the same
   * batch; a handler may return `{ cancel: reason }`. (`NoInfer`: `Ev` comes from `events` only.)
   */
  readonly on?: NoInfer<FlowOnHandlers<C, Ev, D>>
  /**
   * Correlation extractors: with `createWizard(flow, { correlationId })`, an event whose
   * extracted id differs is dropped (`event.dropped { reason: 'correlation' }`), never buffered.
   */
  readonly correlate?: NoInfer<CorrelateSpec<Ev>>
}

/**
 * What `defineFlow(options)` returns: the pre-bound constructors plus `steps()`.
 * @public
 */
export interface FlowBuilder<C, CIn, Ev, D> extends StepApi<C, Ev, D> {
  /**
   * Assemble the flow. `start` defaults to the first declared step. Every referenced id is
   * checked at compile time (`'~error'` on the offending step property) and at runtime.
   */
  steps<T>(
    steps: T & CheckSteps<T, C, Ev, D>,
    opts?: { readonly start?: NoInfer<Ids<T> | readonly Ids<T>[]> },
  ): Flow<C, CIn, Ev, D, { readonly [K in keyof T]: CompactStep<T[K]> }>
}
