/**
 * Primitives shared with the machine ; documented aliases so the public surface names them; the
 * identity with the machine types is what matters for hooks.
 * @packageDocumentation
 */

import type { Progress as MachineProgress } from '../../machine/selectors'
import type {
  Issue as MachineIssue,
  RunStatus as MachineRunStatus,
  SerializedError as MachineSerializedError,
  StepStatus as MachineStepStatus,
} from '../../machine/state'
import type { StepKind as CompiledStepKind } from '../compiled'

/**
 * A value or a promise of it ; every hook may be sync or async.
 * @public
 */
export type MaybePromise<T> = T | Promise<T>

/**
 * A duration: milliseconds as a number, or a string with a unit (`'250ms'`, `'15m'`, `'2h'`, `'1d'`).
 * @public
 */
export type Duration = number | `${number}${'ms' | 's' | 'm' | 'h' | 'd'}`

/**
 * A JSON value (`meta` and other data that must survive `JSON.stringify` unchanged).
 * @public
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

/**
 * A validation problem (Standard Schema issue shape): a message and an optional path.
 * @public
 */
export type Issue = MachineIssue

/**
 * A serializable error (`name`, `message`, optional `code`) ; never carries a stack.
 * @public
 */
export type SerializedError = MachineSerializedError

/**
 * The three step kinds: `step | view | flow`. A plain step runs a hook, waits for an event,
 * sleeps until a deadline, or chooses its next steps.
 * @public
 */
export type StepKind = CompiledStepKind

/**
 * Stored status of a step: `idle | active | done | failed | skipped | cancelled | compensating | compensated`.
 * @public
 */
export type StepStatus = MachineStepStatus

/**
 * Status of a run instance, including recoverable `halted` and terminal `failed`.
 * @public
 */
export type RunStatus = MachineRunStatus

/**
 * Retry policy for runnable steps (plain data, so `inspect()` shows it; the retry STATE ; `attempt`, the
 * `retryAt` deadline ; is what persists, the policy is read from the flow): `retries` extra runs
 * after the first failure (`retries: 1` = at most two runs), spaced by `backoff` ; a number is a fixed
 * delay in ms (absent = retry immediately); `'exponential'` waits
 * `min(baseMs * factor^(attempt-1), maxBackoffMs)` (`baseMs` 200, `factor` 2, `maxBackoffMs` 30 000).
 * @public
 */
export interface RetryPolicy<E = unknown> {
  readonly retries: number
  readonly backoff?: number | 'exponential'
  readonly baseMs?: number
  readonly factor?: number
  readonly maxBackoffMs?: number
  /** Randomize each delay by up to this fraction (0..1). */
  readonly jitter?: number
  /** Retry only when this returns true; receives the mapped error when `mapError` exists. */
  readonly when?: (error: E) => boolean
}

/**
 * Progress of a run (`run.progress()`, `ClientState.progress` with `expose.progress: true`):
 * Counts completed or skipped steps and reports their fraction of the total.
 * @public
 */
export type Progress = MachineProgress

/** Default of an inference site that was not given (distinct from `never`, which a value can have). */
declare const UNSET: unique symbol
export interface Unset {
  readonly [UNSET]: true
}
export type IsUnset<X> = 0 extends 1 & X
  ? false
  : [X] extends [Unset]
    ? [Unset] extends [X]
      ? true
      : false
    : false
