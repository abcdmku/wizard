/** Types shared by the hook executor and its invocation helpers. @internal */

import type { CompiledWizard } from '../authoring/compiled'
import type { ContextUpdater, Message } from '../machine/commands'
import type { CallEffect } from '../machine/effects'
import type { WizardState } from '../machine/state'
import type { Clock, Scheduler } from './env'

export interface ExecutorOptions {
  readonly def: CompiledWizard
  readonly path: readonly string[]
  readonly instanceId: string
  readonly clock: Clock
  readonly scheduler: Scheduler
  readonly deps?: unknown
  readonly strict?: 'sync'
  /**
   * After `abort()`, an unsettled call is reported as
   * `res.err { cancelled: true, timedOut: true }` once this many ms elapse
   * (only when the effect has no `timeoutMs` of its own). Default 30 s.
   */
  readonly abortGraceMs?: number
  /** The live state (records of the call's step). */
  getState(): WizardState
  send(msg: Message, causedBy?: number): void
  /** A hook called `progress(value)` while its call was in flight (a transient event). */
  progress(step: string, value: unknown): void
}

export interface Executor {
  /** Run a `call` effect; results come back through `send()` as `res.ok` / `res.err`. */
  execute(effect: CallEffect, causedBy?: number): void
  /** Report a call that must not start as `res.err { cancelled: true }` without invoking its hook. */
  abortUnstarted(effect: CallEffect, causedBy: number | undefined, reason: string): void
  /** Abort every in-flight call of `step` (cooperative: the hook still settles). */
  abort(step: string, reason?: string): void
  /** Abort only hooks belonging to a navigation transaction. */
  abortTransaction(txId: string, reason?: string): void
  /** Abort everything and silence late results (dispose). */
  abortAll(reason?: string): void
  /** Number of unsettled calls. */
  inflight(): number
  /** Live calls that can still affect successful completion. */
  pending(): number
}

export const DEFAULT_ABORT_GRACE_MS = 30_000

export interface InFlight {
  readonly effect: CallEffect
  readonly controller: AbortController
  readonly startedAt: number
  readonly causedBy: number | undefined
  settled: boolean
  aborted: boolean
  timeout: unknown
  grace: unknown
  /** Synchronous wait updates settle atomically with their handler result. */
  updates?: (Readonly<Record<string, unknown>> | ContextUpdater)[] | undefined
}

/** The raw value a failed `run` threw, kept for its `mapError` call. */
export interface RawFailure {
  readonly step: string
  readonly runId: number
  readonly attempt: number | undefined
  readonly error: unknown
}
