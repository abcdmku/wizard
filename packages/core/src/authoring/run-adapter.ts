/**
 * Runtime-neutral adapter protocol for runnable steps.
 *
 * Optional integrations use this protocol to provide a run hook and its output boundary,
 * executed by the normal Run interpreter. Core installs the boundary and
 * classifies the failure envelope; it knows nothing about the integration runtime.
 *
 * @packageDocumentation
 */

import type { JsonValue, MaybePromise, RunArgs } from './types'
import type { Boundary } from './types/boundary'

/** A failure channel produced by a run adapter. @public */
export type RunFailureKind = 'typed' | 'defect' | 'interrupted'

/**
 * Internal marker carried by an adapter rejection. `data` is only included after the adapter
 * has validated it with its durable error schema.
 * @public
 */
export interface RunFailure {
  readonly [RUN_FAILURE]: true
  readonly kind: RunFailureKind
  readonly error: unknown
  readonly data?: JsonValue
}

/** Runtime marker for adapter-produced failures. @public */
const RUN_FAILURE: unique symbol = Symbol.for('@openwizard/run-failure') as never

export { RUN_FAILURE }

/** Construct a runtime-neutral adapter failure envelope. @public */
export function createRunFailure(
  kind: RunFailureKind,
  error: unknown,
  data?: JsonValue,
): RunFailure {
  return {
    [RUN_FAILURE]: true,
    kind,
    error,
    ...(data !== undefined ? { data } : {}),
  }
}

/** Test for an adapter failure without depending on the optional integration. @public */
export function isRunFailure(value: unknown): value is RunFailure {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<RunFailure>
  return (
    candidate[RUN_FAILURE] === true &&
    (candidate.kind === 'typed' ||
      candidate.kind === 'defect' ||
      candidate.kind === 'interrupted') &&
    'error' in candidate
  )
}

/** Metadata installed by a run adapter. @public */
export interface RunAdapterMetadata<
  C,
  D,
  A,
  E extends JsonValue = never,
  Args extends RunArgs<C, D> = RunArgs<C, D>,
> {
  readonly run: (args: Args) => MaybePromise<A>
  readonly output: Boundary<A, unknown>
  /** Phantom error channel retained for `ErrorOf<F, K>` inference. */
  readonly '~error'?: E
}

/** Runtime-neutral run adapter. Execution lives in metadata, so the adapter is not callable. @public */
export interface RunAdapter<
  C,
  D,
  A,
  E extends JsonValue = never,
  Args extends RunArgs<C, D> = RunArgs<C, D>,
> {
  readonly [RUN_ADAPTER]: RunAdapterMetadata<C, D, A, E, Args>
}

/** Runtime marker for run adapters. @public */
const RUN_ADAPTER: unique symbol = Symbol.for('@openwizard/run-adapter') as never

export { RUN_ADAPTER }

/** Test for an adapter returned by an optional integration. @public */
export function isRunAdapter(
  value: unknown,
): value is RunAdapter<unknown, unknown, unknown, JsonValue> {
  if (typeof value !== 'object' || value === null) return false
  const metadata = (value as Partial<RunAdapter<unknown, unknown, unknown, JsonValue>>)[RUN_ADAPTER]
  return (
    typeof metadata === 'object' &&
    metadata !== null &&
    typeof metadata.run === 'function' &&
    typeof metadata.output === 'object' &&
    metadata.output !== null
  )
}
