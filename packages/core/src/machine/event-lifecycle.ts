/** Run lifecycle, navigation, step, step-run, and compensation event bodies. @internal */

import type { EachEventBody } from './each-events'
import type { Issue, NavCause, NavPhase, RunStatus, SerializedError } from './state'

export type LifecycleEventBody =
  | EachEventBody
  // ---- run lifecycle ------------------------------------------------------
  | { readonly type: 'run.started'; readonly start: string }
  | { readonly type: 'run.done'; readonly output?: unknown }
  /** Terminal failure: nothing can recover the run (a halted run emits `run.halted` instead). */
  | {
      readonly type: 'run.failed'
      readonly step?: string
      readonly error: SerializedError
      /** `AUTO_ADVANCE_LOOP`: synchronous `next` hops without an async boundary (absent: `output` failed). */
      readonly code?: 'AUTO_ADVANCE_LOOP'
      /** The runnable step's `mapError` value, when present. */
      readonly data?: unknown
    }
  /** A step failed under `onFailure: 'halt'`: the run stops scheduling until retry / skip / run / compensate / cancel. */
  | {
      readonly type: 'run.halted'
      readonly step: string
      readonly error: SerializedError
      /** The runnable step's `mapError` value, when present. */
      readonly data?: unknown
    }
  /** `status` = the run status `run.compensated` ends in ('cancelled' when triggered by `cancel`, else 'failed'). */
  | {
      readonly type: 'run.compensating'
      readonly reason?: string
      readonly plan: readonly string[]
      readonly status?: 'failed' | 'cancelled'
    }
  /** `failures` = steps whose compensation failed (empty = every compensation hook succeeded). */
  | {
      readonly type: 'run.compensated'
      readonly failures: readonly string[]
      readonly status: 'failed' | 'cancelled'
    }
  | { readonly type: 'run.cancelled'; readonly reason?: string }
  | {
      readonly type: 'run.resumed'
      readonly fromSeq: number
      readonly interrupted: readonly string[]
    }
  | { readonly type: 'run.reset' }
  | { readonly type: 'run.status'; readonly status: RunStatus }
  // ---- navigation (cursor) -------------------------------------------------
  | {
      readonly type: 'transition.started'
      readonly txId: string
      readonly from: string | null
      readonly to?: string
      readonly cause: NavCause
      /** Auto-advance only: synchronous hops since the last async boundary (the loop guard). */
      readonly hops?: number
    }
  /** `targets` is set on the first phase event emitted after the target list is known (static/dynamic `next`). */
  | {
      readonly type: 'transition.phase'
      readonly txId: string
      readonly phase: NavPhase
      readonly targets?: readonly string[]
    }
  | {
      readonly type: 'transition.committed'
      readonly txId: string
      readonly from: string | null
      readonly to: string | null
      readonly cause: NavCause
      readonly direction: 'forward' | 'back'
    }
  | {
      readonly type: 'transition.rejected'
      readonly txId: string
      readonly reason: TransitionRejectReason
      readonly step?: string
      readonly issues?: readonly Issue[]
    }
  | {
      readonly type: 'transition.failed'
      readonly txId: string
      readonly step: string
      readonly error: SerializedError
    }
  // ---- step lifecycle ------------------------------------------------------
  | { readonly type: 'step.arrived'; readonly step: string; readonly from: string | null }
  /** `enterPending: true` = the step's `enter` hook still has to run (scheduler entry); absent when there is no hook or it already ran in the transition's `entering` phase. */
  | {
      readonly type: 'step.entered'
      readonly step: string
      readonly from: string | null
      readonly runId: number
      readonly enterPending?: boolean
    }
  /** The step's `enter` hook resolved; kind-specific work may start (see machine-spec §2). */
  | { readonly type: 'step.enterCompleted'; readonly step: string }
  | {
      readonly type: 'step.exited'
      readonly step: string
      readonly to: string | null
      readonly direction: 'forward' | 'back'
    }
  /** `next` = the targets the `next` function of a routing step chose. */
  | {
      readonly type: 'step.done'
      readonly step: string
      readonly output?: unknown
      readonly next?: string | readonly string[]
    }
  /** `data` = the runnable step's `mapError` value for this failure. */
  | {
      readonly type: 'step.failed'
      readonly step: string
      readonly error: SerializedError
      readonly kind: StepFailureKind
      readonly data?: unknown
    }
  /**
   * `reason`: `'when'`, `'command'`, `'not-taken'` (a routing decision chose another declared
   * target), `'needs-skipped'` (a step it needs was skipped), `'fallback'` (the step failed for
   * good; `error` keeps the failure and the run continues at `next`) or `'timeout'` (a wait's
   * deadline passed with no event; the run continues at `next`).
   */
  | {
      readonly type: 'step.skipped'
      readonly step: string
      readonly reason?: string
      readonly next?: string | readonly string[]
      readonly error?: SerializedError
      readonly kind?: StepFailureKind
      readonly data?: unknown
    }
  /** The step's `when` predicate is being evaluated (it is ready; `apply` marks `when: 'pending'`). */
  | { readonly type: 'step.whenStarted'; readonly step: string }
  /** `when` resolved — `ok: false` is followed by `step.skipped { reason: 'when' }`. */
  | { readonly type: 'step.whenEvaluated'; readonly step: string; readonly ok: boolean }
  /** Explicit invalidation (never automatic). */
  | {
      readonly type: 'step.invalidated'
      readonly step: string
      readonly cascade: boolean
      readonly cause: 'command' | 'cascade'
    }
  | { readonly type: 'step.cancelled'; readonly step: string; readonly reason?: string }
  | { readonly type: 'step.validated'; readonly step: string; readonly output: unknown }
  | {
      readonly type: 'step.validationFailed'
      readonly step: string
      readonly issues: readonly Issue[]
    }
  | {
      readonly type: 'step.guardEvaluated'
      readonly step: string
      readonly hook: 'canEnter' | 'canExit'
      readonly ok: boolean
      readonly reason?: string
    }
  // ---- run execution -------------------------------------------------------
  /** The step's `idempotencyKey` hook is being called; `step.runStarted` follows. */
  | { readonly type: 'step.idempotencyKeyRequested'; readonly step: string; readonly runId: number }
  | {
      readonly type: 'step.runStarted'
      readonly step: string
      readonly attempt: number
      readonly runId: number
      readonly idempotencyKey: string
      /** True when an idempotent run is re-issued after a crash/resume. */
      readonly resumed?: boolean
    }
  | {
      readonly type: 'step.runSucceeded'
      readonly step: string
      readonly attempt: number
      readonly output: unknown
    }
  /**
   * An attempt failed and the step's `mapError` hook is being called before the failure is
   * recorded (`step.runFailed { data }` follows). Carries the raw failure so `plan` can build the call.
   */
  | {
      readonly type: 'step.mapErrorStarted'
      readonly step: string
      readonly attempt: number
      readonly error: SerializedError
      readonly timedOut?: boolean
      readonly syncViolation?: boolean
      readonly failureKind?: 'typed' | 'defect' | 'interrupted'
    }
  /** `data` = the step's `mapError` value for this attempt's failure. */
  | {
      readonly type: 'step.runFailed'
      readonly step: string
      readonly attempt: number
      readonly error: SerializedError
      readonly willRetry: boolean
      readonly timedOut?: boolean
      /** Failure channel from a run adapter; ordinary run functions leave this absent. */
      readonly failureKind?: 'typed' | 'defect' | 'interrupted'
      readonly data?: unknown
    }
  /** `dueAt` (not `at`, which is the envelope timestamp) = absolute time of the retry. */
  | {
      readonly type: 'step.retryScheduled'
      readonly step: string
      readonly attempt: number
      readonly dueAt: number
      readonly timerId: string
    }
  // ---- compensation --------------------------------------------------------
  /** `runId` identifies the stack entry (completion) being compensated — repeated activations have several. */
  | { readonly type: 'step.compensationStarted'; readonly step: string; readonly runId?: number }
  | { readonly type: 'step.compensated'; readonly step: string; readonly runId?: number }
  | {
      readonly type: 'step.compensationFailed'
      readonly step: string
      readonly runId?: number
      readonly error: SerializedError
    }

/**
 * Why a step failed for good (stored as `StepError.kind`). `guard`: its `needs` can never be
 * met (`DEPS_UNREACHABLE`).
 */
export type StepFailureKind =
  | 'run'
  | 'typed'
  | 'defect'
  | 'timeout'
  | 'hook'
  | 'guard'
  | 'child'
  | 'sync-violation'
  | 'interrupted'

export type TransitionRejectReason =
  | 'nav-busy'
  | 'not-a-view'
  | 'not-active'
  | 'not-reachable'
  | 'validation'
  | 'guard-canExit'
  | 'guard-canEnter'
  | 'no-target'
  | 'no-history'
  | 'run-terminal'
  | 'run-halted'
  | 'run-not-started'
  | 'run-compensating'
  | 'resumed'
  | 'auto-advance-loop'
