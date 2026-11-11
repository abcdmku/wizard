/**
 * Result types returned by `Run` methods and `dispatch()`.
 *
 * One contract: results are values; the machine never throws for data
 * problems. `WizardError` is reserved for programmer errors.
 *
 * @public
 */

import type {
  AnyWizardDefinition,
  ChildStepId,
  ChildWizardOf,
  EventType,
  RunStepId,
  StepId,
  ViewId,
  WizardOutput,
} from '../authoring/types'
import type { WizardErrorCode } from '../errors'
import type { TransitionRejectReason } from '../machine/events'
import type { Issue, SerializedError } from '../machine/state'
import type { Snapshot, StepErrorOf } from './create-wizard/state'

/**
 * Result of `dispatch()` and of every non-navigation command method (`start`, `setInput`, `retry`, …).
 *
 * @public
 */
export type CommandResult =
  | { readonly ok: true; readonly seq: number }
  | {
      readonly ok: false
      readonly code: WizardErrorCode | 'STALE' | 'RUN_COMPENSATING' | 'FORBIDDEN'
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
  | {
      readonly ok: true
      readonly from: string | null
      readonly to: string | null
      readonly seq: number
    }
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
      readonly code: WizardErrorCode | 'HOOK_FAILED' | 'STALE'
      readonly message: string
      readonly step?: string
      readonly error?: SerializedError
    }

/**
 * Result of `send(event, payload, options)`: delivered/buffered, a duplicate (`duplicate: true`:
 * the `eventId` was already delivered, nothing changed, `delivered` is empty), rejected by the event boundary
 * (`code: 'BOUNDARY_REJECTED'`, with the boundary's `issues`), or dropped — nothing was waiting
 * for the event and it was not buffered (`code: 'NOT_ACTIVE'`), the machine refused it
 * (`RUN_TERMINAL` / `RUN_NOT_STARTED` / `RUN_COMPENSATING`, …) or the run was disposed
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
      readonly duplicate?: true
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
      readonly code: WizardErrorCode | 'STALE' | 'RUN_COMPENSATING'
      readonly message: string
    }

/** A compensation-hook failure. Its error is serialized because compensation has no `mapError`.
 * @public
 */
export type CompensationFailure<F extends AnyWizardDefinition> = {
  readonly [K in RunStepId<F>]: {
    readonly step: K
    readonly runId: number
    readonly error: SerializedError
  }
}[RunStepId<F>]

/** Compensation facts retained on a failed or cancelled terminal result: `'partial'` when at
 * least one compensation hook failed (`failures` is non-empty), else `'completed'`.
 * @public
 */
export interface CompensationSummary<F extends AnyWizardDefinition> {
  readonly outcome: 'completed' | 'partial'
  readonly failures: readonly CompensationFailure<F>[]
}

/** A failure attributed to one step; `error.data` is present only for a mapped run error.
 * @public
 */
export type StepFailure<F extends AnyWizardDefinition> = {
  readonly [K in StepId<F>]: {
    readonly kind: 'step'
    readonly step: K
    readonly error: StepErrorOf<F, K>
    readonly compensation?: CompensationSummary<F>
    /**
     * For a child step: the child's terminal result when it was retained, or — when a halted
     * child halted this run — the child's own halted outcome (recover it through `run.child(step)`).
     */
    readonly child?: [ChildWizardOf<F, K>] extends [never]
      ? never
      : RunResult<ChildWizardOf<F, K>> | RunHalted<ChildWizardOf<F, K>>
  }
}[StepId<F>]

/** The typed failure channel of a terminal run. Unknown thrown values remain serialized/runtime data.
 * @public
 */
export type TerminalFailure<F extends AnyWizardDefinition> =
  | StepFailure<F>
  | {
      readonly kind: 'compensation'
      readonly cause?: StepFailure<F>
      readonly compensation: CompensationSummary<F> & { readonly outcome: 'partial' }
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
export interface RunDone<F extends AnyWizardDefinition> {
  readonly status: 'done'
  readonly output: WizardOutput<F>
  readonly seq: number
  readonly epoch: number
}

/** Failed terminal result: nothing can recover the run (a recoverable halt is `RunHalted`).
 * @public
 */
export interface RunFailed<F extends AnyWizardDefinition> {
  readonly status: 'failed'
  readonly failure: Exclude<TerminalFailure<F>, { readonly kind: 'cancelled' }>
  readonly seq: number
  readonly epoch: number
}

/** Cancellation is separate from a failed run, including when compensation was attempted.
 * @public
 */
export interface RunCancelled<F extends AnyWizardDefinition> {
  readonly status: 'cancelled'
  readonly failure: Extract<TerminalFailure<F>, { readonly kind: 'cancelled' }>
  readonly seq: number
  readonly epoch: number
}

/** One-shot terminal outcome of a `Run`.
 * @public
 */
export type RunResult<F extends AnyWizardDefinition> = RunDone<F> | RunFailed<F> | RunCancelled<F>

type WaitEntry<Path, Step, View, Event> =
  | { readonly kind: 'view'; readonly path: Path; readonly step: View }
  | {
      readonly kind: 'event'
      readonly path: Path
      readonly step: Step
      readonly events: readonly Event[]
      /** Absolute time (ms) the wait times out, when it declares a timeout. */
      readonly deadline?: number
    }
  | { readonly kind: 'sleep'; readonly path: Path; readonly step: Step; readonly deadline: number }

/**
 * One thing a run waits on from the outside: a user on a `view`, an external `event` (with the
 * absolute `deadline` of its timeout), or a `sleep` that fires at `deadline`. The list is flat:
 * `path` locates the run — `[]` is this run (ids and event names typed by `F`), `['pay']` the
 * child run of child step `pay`, or `['pay', '0']` its first mapped item (child ids untyped).
 * @public
 */
export type WaitingFor<F extends AnyWizardDefinition> =
  | WaitEntry<readonly [], StepId<F>, ViewId<F>, EventType<F>>
  | ([ChildStepId<F>] extends [never]
      ? never
      : WaitEntry<readonly [string, ...string[]], string, string, string>)

/**
 * A run stopped by a failed step under `onFailure: 'halt'`, or by a halted child run
 * (`failure.child` is the child's halted outcome): recover it with `retry` / `skip` /
 * `compensate` / `cancel` (on `run.child(step)` for a child), or persist `snapshot` and `resume`
 * it later.
 * @public
 */
export interface RunHalted<F extends AnyWizardDefinition> {
  readonly status: 'halted'
  readonly failure: StepFailure<F>
  readonly snapshot: Snapshot<F>
  readonly seq: number
  readonly epoch: number
}

/**
 * A run parked on a view or an external event: `waitingFor` lists every wait (sleeps included),
 * empty only when the run is stuck (nothing runs and nothing waits). Persist `snapshot` and
 * `resume` it when the input arrives.
 * @public
 */
export interface RunWaiting<F extends AnyWizardDefinition> {
  readonly status: 'waiting'
  readonly waitingFor: readonly WaitingFor<F>[]
  readonly snapshot: Snapshot<F>
  readonly seq: number
  readonly epoch: number
}

/**
 * What `run.awaitOutcome()`, `wizard.run()` and `wizard.runSync()` return: a terminal
 * `RunResult`, or the run halted or waiting — never a hang, never a throw for a failed step.
 * @public
 */
export type RunOutcome<F extends AnyWizardDefinition> = RunResult<F> | RunHalted<F> | RunWaiting<F>

/** Why a lifecycle-sensitive waiter ended before producing its normal result.
 * @public
 */
export type RunLifecycleCode = 'RUN_RESET' | 'RUN_DISPOSED'

/**
 * Rejection from a lifecycle-sensitive wait. `awaitResult()` rejects on reset or disposal;
 * `whenIdle()` rejects on disposal. This is intentionally separate from `RunResult`.
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
