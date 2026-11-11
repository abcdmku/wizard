/**
 * Primitives shared with the machine. Unions get a documented alias here. Interfaces are
 * re-exported under their own name, so a project that exports a value of one can name it.
 * @packageDocumentation
 */

import type {
  RunStatus as MachineRunStatus,
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

export type { Progress } from '../../machine/selectors'
export type { Issue, SerializedError } from '../../machine/state'

/**
 * The three step kinds: `step | view | child`. A plain step runs a hook, waits for an event,
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
 * `retryAt` deadline ; is what persists, the policy is read from the wizard): `retries` extra runs
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
