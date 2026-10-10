/**
 * Primitives shared with the machine — documented aliases so the public surface names them; the
 * identity with the machine types is what matters for hooks.
 * @packageDocumentation
 */

import type { Progress as MachineProgress } from '../../machine/selectors'
import type {
  Issue as MachineIssue,
  SerializedError as MachineSerializedError,
  StepStatus as MachineStepStatus,
  WizardStatus as MachineWizardStatus,
} from '../../machine/state'
import type { RetryPolicy as CompiledRetryPolicy, StepKind as CompiledStepKind } from '../compiled'

/**
 * A value or a promise of it — every hook may be sync or async.
 * @public
 */
export type MaybePromise<T> = T | Promise<T>

/**
 * A duration: milliseconds as a number, or a string with a unit (`'250ms'`, `'15m'`, `'2h'`, `'1d'`).
 * @public
 */
export type Duration = number | `${number}${'ms' | 's' | 'm' | 'h' | 'd'}`

/**
 * Structural stand-in for the global `AbortSignal` (consumers need no DOM lib); the runtime passes a real one.
 * @public
 */
export interface AbortSignalLike {
  readonly aborted: boolean
  readonly reason: unknown
}

/**
 * A validation problem (Standard Schema issue shape): a message and an optional path.
 * @public
 */
export type Issue = MachineIssue

/**
 * A serializable error (`name`, `message`, optional `code`) — never carries a stack.
 * @public
 */
export type SerializedError = MachineSerializedError

/**
 * The six step kinds: `view | task | wait | decision | flow | final`.
 * @public
 */
export type StepKind = CompiledStepKind

/**
 * Stored status of a step: `idle | active | done | failed | skipped | cancelled | compensating | compensated`.
 * @public
 */
export type StepStatus = MachineStepStatus

/**
 * Status of a wizard instance: `idle | running | waiting | done | failed | compensating | cancelled`.
 * @public
 */
export type WizardStatus = MachineWizardStatus

/**
 * Retry policy for tasks (plain data, so `inspect()` shows it; the retry STATE — `attempt`, the
 * `retryAt` deadline — is what persists, the policy is read from the flow): `attempts` retries
 * after the first failure (`1` = one retry, two runs), spaced by `backoff` — a number is a fixed
 * delay in ms (absent = retry immediately); `'exponential'` waits
 * `min(baseMs × factor^(attempt-1), maxBackoffMs)` (`baseMs` 200, `factor` 2, `maxBackoffMs` 30 000).
 * @public
 */
export type RetryPolicy = CompiledRetryPolicy

/**
 * Progress of a wizard (`wizard.progress()`, `ClientState.progress` with `expose.progress: true`):
 * `total` counts the non-final steps, `done` those of them that are `done` or `skipped`,
 * `ratio` is `done / total` (`0` when there is nothing to count, `1` once the flow is `done`).
 * @public
 */
export type Progress = MachineProgress
