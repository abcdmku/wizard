/**
 * Result types returned by `FlowRun` methods and `dispatch()`.
 *
 * One contract: results are values; the machine never throws for data
 * problems (see plan §8.2). `WizardError` is reserved for programmer errors.
 *
 * @public
 */

import type { AnyFlow, ChildFlowOf, FlowOutput, StepId, TaskId } from '../authoring/types'
import type { WizardErrorCode } from '../errors'
import type { TransitionRejectReason } from '../machine/events'
import type { Issue, SerializedError } from '../machine/state'
import type { StepErrorOf } from './create-wizard/state'

/**
 * Result of `dispatch()` and of every non-navigation command method (`start`, `setInput`, `retry`, …).
 *
 * @public
 */
export type CommandResult =
  | { readonly ok: true; readonly seq: number }
  | {
      readonly ok: false
      readonly code: WizardErrorCode | 'STALE' | 'FLOW_COMPENSATING'
      readonly message: string
      readonly step?: string
      readonly issues?: readonly Issue[]
    }

/**
 * Result of the navigation methods `next()`, `back()` and `go()`.
 *
 * @public
 */
export type NavResult =
  | { readonly ok: true; readonly from: string | null; readonly to: string; readonly seq: number }
  | {
      readonly ok: false
      readonly reason: TransitionRejectReason
      readonly code: WizardErrorCode
      readonly message: string
      readonly step?: string
      readonly issues?: readonly Issue[]
    }
  /**
   * The transition was accepted but a hook threw (`transition.failed`), or the
   * run was disposed while the transition was in flight (`code: 'DISPOSED'`).
   */
  | {
      readonly ok: false
      readonly reason: 'failed'
      readonly code: WizardErrorCode | 'HOOK_FAILED'
      readonly message: string
      readonly step?: string
      readonly error?: SerializedError
    }

/**
 * Result of `send(event, payload)`: delivered/buffered, rejected by the event boundary
 * (`code: 'BOUNDARY_REJECTED'`, with the boundary's `issues`), or dropped — nothing was waiting
 * for the event and it was not buffered (`code: 'NOT_ACTIVE'`), the machine refused it
 * (`FLOW_TERMINAL` / `FLOW_NOT_STARTED` / `FLOW_COMPENSATING`, …) or the run was disposed
 * (`DISPOSED`). Every `{ ok: false }` result carries `code` + `message`, like `CommandResult`;
 * `dispatch({ type: 'send' })` returns the same `code` as a `CommandResult`.
 *
 * @public
 */
export type SendResult =
  | {
      readonly ok: true
      readonly delivered: readonly string[]
      readonly buffered: boolean
      readonly seq: number
    }
  | {
      readonly ok: false
      readonly reason: 'rejected'
      readonly code: 'BOUNDARY_REJECTED'
      readonly message: string
      readonly issues: readonly Issue[]
    }
  | {
      readonly ok: false
      readonly reason: 'dropped'
      readonly code: WizardErrorCode | 'STALE' | 'FLOW_COMPENSATING'
      readonly message: string
    }

/** A compensation-hook failure. Its error is serialized because compensation has no `mapError`.
 * @public
 */
export type CompensationFailure<F extends AnyFlow> = {
  readonly [K in TaskId<F>]: {
    readonly step: K
    readonly runId: number
    readonly error: SerializedError
  }
}[TaskId<F>]

/** Compensation facts retained on a failed or cancelled terminal result.
 * @public
 */
export interface CompensationSummary<F extends AnyFlow> {
  readonly outcome: 'failed' | 'cancelled'
  readonly failures: readonly CompensationFailure<F>[]
}

/** A failure attributed to one flow step; `error.data` is present only for a mapped task error.
 * @public
 */
export type StepFailure<F extends AnyFlow> = {
  readonly [K in StepId<F>]: {
    readonly kind: 'step'
    readonly step: K
    readonly error: StepErrorOf<F, K>
    readonly compensation?: CompensationSummary<F>
    /** The terminal child result, when the failed step is a child flow and it was retained. */
    readonly child?: [ChildFlowOf<F, K>] extends [never] ? never : RunResult<ChildFlowOf<F, K>>
  }
}[StepId<F>]

/** The typed failure channel of a terminal run. Unknown thrown values remain serialized/runtime data.
 * @public
 */
export type FlowFailure<F extends AnyFlow> =
  | StepFailure<F>
  | {
      readonly kind: 'compensation'
      readonly cause?: StepFailure<F>
      readonly compensation: CompensationSummary<F> & { readonly outcome: 'failed' }
    }
  | {
      readonly kind: 'cancelled'
      readonly reason?: string
      readonly compensation?: CompensationSummary<F>
    }
  | {
      readonly kind: 'runtime'
      readonly step?: StepId<F>
      readonly error: SerializedError
    }

/** Successful terminal result.
 * @public
 */
export interface RunDone<F extends AnyFlow> {
  readonly status: 'done'
  readonly output: FlowOutput<F>
  readonly seq: number
  readonly epoch: number
}

/** Failed terminal result. Recoverable halts do not produce this result yet.
 * @public
 */
export interface RunFailed<F extends AnyFlow> {
  readonly status: 'failed'
  readonly failure: Exclude<FlowFailure<F>, { readonly kind: 'cancelled' }>
  readonly seq: number
  readonly epoch: number
}

/** Cancellation is separate from a failed run, including when compensation was attempted.
 * @public
 */
export interface RunCancelled<F extends AnyFlow> {
  readonly status: 'cancelled'
  readonly failure: Extract<FlowFailure<F>, { readonly kind: 'cancelled' }>
  readonly seq: number
  readonly epoch: number
}

/** One-shot terminal outcome of a `FlowRun`.
 * @public
 */
export type RunResult<F extends AnyFlow> = RunDone<F> | RunFailed<F> | RunCancelled<F>

/** Why an `awaitResult()` waiter ended without a terminal run result.
 * @public
 */
export type RunLifecycleCode = 'RUN_RESET' | 'RUN_DISPOSED'

/**
 * Rejection from `awaitResult()` when the run is reset or disposed before it
 * reaches a terminal outcome. This is intentionally separate from `RunResult`.
 *
 * @public
 */
export class RunLifecycleError extends Error {
  readonly code: RunLifecycleCode
  readonly reason: 'reset' | 'disposed'

  constructor(code: RunLifecycleCode, message?: string) {
    super(message ?? (code === 'RUN_RESET' ? 'run was reset' : 'run was disposed'))
    this.name = 'RunLifecycleError'
    this.code = code
    this.reason = code === 'RUN_RESET' ? 'reset' : 'disposed'
  }
}
