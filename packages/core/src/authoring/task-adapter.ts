/**
 * Runtime-neutral task adapter protocol.
 *
 * Optional integrations (for example `@openwizard/effect`) can use this
 * protocol to provide a task body that is still executed by the normal
 * FlowRun interpreter. Core deliberately knows nothing about the integration
 * runtime; it only knows how to install the output boundary and classify the
 * failure envelope.
 *
 * @packageDocumentation
 */

import type { MaybePromise, RunArgs } from './types'
import type { Boundary } from './types/boundary'

/** A failure channel produced by a task adapter. @public */
export type TaskFailureKind = 'typed' | 'defect' | 'interrupted'

/**
 * Internal marker carried by an adapter rejection. `data` is only included
 * after the adapter has validated it with its durable error schema.
 * @public
 */
export interface TaskFailure {
  readonly [TASK_FAILURE]: true
  readonly kind: TaskFailureKind
  readonly error: unknown
  readonly data?: unknown
}

/** Runtime marker for adapter-produced failures. @public */
const TASK_FAILURE: unique symbol = Symbol.for('@openwizard/task-failure') as never

export { TASK_FAILURE }

/** Construct a runtime-neutral adapter failure envelope. @public */
export function createTaskFailure(
  kind: TaskFailureKind,
  error: unknown,
  data?: unknown,
): TaskFailure {
  return {
    [TASK_FAILURE]: true,
    kind,
    error,
    ...(data !== undefined ? { data } : {}),
  }
}

/** Test for an adapter failure without depending on the optional integration. @public */
export function isTaskFailure(value: unknown): value is TaskFailure {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<TaskFailure>
  return (
    candidate[TASK_FAILURE] === true &&
    (candidate.kind === 'typed' ||
      candidate.kind === 'defect' ||
      candidate.kind === 'interrupted') &&
    'error' in candidate
  )
}

/** Metadata installed by a task adapter. @public */
export interface TaskAdapterMetadata<A, E = never> {
  readonly output: Boundary<A, unknown>
  /** Phantom error channel retained for `ErrorOf<F, K>` inference. */
  readonly '~error'?: E
}

/** Runtime-neutral callable task adapter. @public */
export interface TaskAdapter<C, D, A, E> {
  (args: RunArgs<C, D>): MaybePromise<A>
  readonly [TASK_ADAPTER]: TaskAdapterMetadata<A, E>
}

/** Runtime marker for task adapters. @public */
const TASK_ADAPTER: unique symbol = Symbol.for('@openwizard/task-adapter') as never

export { TASK_ADAPTER }

/** Test for an adapter returned by an optional integration. @public */
export function isTaskAdapter(
  value: unknown,
): value is TaskAdapter<unknown, unknown, unknown, unknown> {
  if (typeof value !== 'function') return false
  const metadata = (value as Partial<TaskAdapter<unknown, unknown, unknown, unknown>>)[TASK_ADAPTER]
  return (
    typeof metadata === 'object' &&
    metadata !== null &&
    typeof metadata.output === 'object' &&
    metadata.output !== null
  )
}
