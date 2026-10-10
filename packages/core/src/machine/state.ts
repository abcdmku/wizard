/**
 * Runtime state of a wizard instance.
 *
 * This is the *stored* state: the fold of the event log (see `apply.ts`).
 * Everything derivable (readiness, availability, phase, progress, explain
 * reasons) lives in `selectors.ts` and is never stored.
 *
 * Invariants:
 * - JSON-serializable (no functions, no `undefined` values in persisted form —
 *   optional fields are simply absent).
 * - `seq` is monotonic and increments once per applied event.
 * - `active` lists every step whose status is `active` (kept in sync by `apply`).
 * - `current` is the UI cursor: the active *view* step (or null).
 *
 * @internal Public consumers see `Snapshot<F>`, a typed view over this shape.
 */

import type { StepKind } from '../authoring/compiled'
import type { Command, TimerFired } from './commands'

// ---------------------------------------------------------------------------
// Statuses (stored). Kind + sub-fields explain what "active" means:
// view=shown, task=running/retrying, wait=waiting, flow=child running.
// ---------------------------------------------------------------------------

export type StepStatus =
  | 'idle'
  | 'active'
  | 'done'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'compensating'
  | 'compensated'

export type WizardStatus =
  | 'idle' // created, not started
  | 'running' // at least one task/decision/flow step is executing
  | 'waiting' // nothing executing; waiting for a user (view) or an external event / timer (wait)
  | 'done'
  | 'failed'
  | 'compensating'
  | 'cancelled'

export type NavPhase =
  | 'idle'
  | 'parsingInput'
  | 'validating'
  | 'canExit'
  | 'resolvingTarget'
  | 'canEnter'
  | 'exiting'
  | 'entering'

export type NavCause = 'start' | 'next' | 'go' | 'back' | 'auto' | 'resume' | 'event'

export type StepErrorKind =
  | 'validation'
  | 'guard'
  | 'run'
  | 'timeout'
  | 'compensate'
  | 'interrupted'
  | 'child'
  | 'hook'
  | 'sync-violation'

/** Serializable error. Never carries a stack. */
export interface SerializedError {
  readonly name: string
  readonly message: string
  readonly code?: string
}

export interface StepError extends SerializedError {
  readonly kind: StepErrorKind
  readonly at: number
  readonly attempt?: number
  /** Standard-Schema issues when kind === 'validation'. */
  readonly issues?: readonly Issue[]
  /** v0.2: JSON-safe value produced by the task's `mapError` (typed for users via `ErrorOf<F, K>`). */
  readonly data?: unknown
}

/** Standard Schema v1 issue (kept structural so core has zero runtime deps). */
export interface Issue {
  readonly message: string
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>
}

export interface GuardResult {
  readonly ok: boolean
  /** seq of the event that recorded this result. */
  readonly seq: number
  readonly reason?: string
}

export interface ChildSummary {
  readonly status: WizardStatus
  readonly current: string | null
  readonly progress: number
  readonly seq: number
}

// ---------------------------------------------------------------------------
// Per-step record
// ---------------------------------------------------------------------------

export interface StepRecord {
  readonly id: string
  readonly kind: StepKind
  readonly status: StepStatus
  /** Draft input (view steps): raw, shallow-merged by `setInput`, parsed on next/go. */
  readonly input?: unknown
  /**
   * Result of the step: parsed input (view), run result (task), resolving event
   * `{ event, payload }` (wait), chosen target (decision), child output (flow),
   * `output()` result (final).
   */
  readonly output?: unknown
  /** Last validation issues (view). Cleared on the next input change. */
  readonly issues?: readonly Issue[]
  readonly error?: StepError
  /** v0.2: output before the last explicit invalidation. */
  readonly previousOutput?: unknown
  /** v0.2: why the step was skipped (`'when'` | `'command'`). */
  readonly skipReason?: string
  /** Attempt counter for the current run (1-based while running; 0 when idle). */
  readonly attempt: number
  /** Increments each time the step (re)starts after completion or invalidation. Used for stale-result tokens. */
  readonly runId: number
  /** Scheduled retry time (task). */
  readonly retryAt?: number
  /** Absolute wait timeout (wait). Re-armed on resume. */
  readonly deadline?: number
  /** Idempotency key for the current run (task). */
  readonly idempotencyKey?: string
  readonly guards: {
    readonly canEnter?: GuardResult
    readonly canExit?: GuardResult
  }
  /**
   * v0.2: state of the step's `when` predicate for the current activation — `'pending'` while the
   * call is in flight, `'passed'` once it returned true (the step may enter). Absent when the step
   * has no `when` hook or has not been evaluated yet; cleared on entry, skip and invalidation.
   */
  readonly when?: 'pending' | 'passed'
  /** True while the step's `enter` hook is in flight (kind-specific work starts after it resolves). */
  readonly entering?: boolean
  /** The `enter` hook already ran for the pending activation (transition `entering` phase); cleared when the step enters. */
  readonly enterDone?: boolean
  readonly enteredAt?: number
  readonly exitedAt?: number
  readonly visitedCount: number
  /**
   * Set when `start` or a completed predecessor's `next` arrives here while the
   * step is not active; cleared when the step enters. Together with `dependsOn`
   * gating this is the readiness rule: `ready = pendingActivation && depsSatisfied`.
   */
  readonly pendingActivation: boolean
  /** seq of the arrival that set `pendingActivation` (scheduler picks ready tasks in arrival order). */
  readonly arrivedSeq?: number
  /** Child flow summary (flow steps). The full child snapshot lives in `Snapshot.children`. */
  readonly child?: ChildSummary
}

// ---------------------------------------------------------------------------
// Whole-wizard state
// ---------------------------------------------------------------------------

export interface NavState {
  readonly phase: NavPhase
  readonly txId?: string
  readonly from?: string | null
  /** Resolved target(s) of the in-flight transition (first = cursor target). */
  readonly targets?: readonly string[]
  readonly cause?: NavCause
  readonly direction?: 'forward' | 'back'
  /** Targets still awaiting a `canEnter` / `enter` result in the current phase. */
  readonly pendingSteps?: readonly string[]
  /** Auto-advance hop counter for the current command (guard against `next` loops). */
  readonly hops?: number
  /**
   * Non-view steps that completed while a transition was in flight; their
   * auto-advance starts (in order) as soon as `nav` returns to idle.
   * `to` = target override carried by `step.done.next`.
   */
  readonly deferred?: ReadonlyArray<{ readonly step: string; readonly to?: string }>
  /**
   * v0.2: the view a committed transition wanted as cursor but could not enter because its `when`
   * predicate was still unevaluated. Once the predicate passes, the cursor rule prefers this view
   * when several views are ready. Cleared when a cursor is set or the view enters/skips/invalidates.
   */
  readonly cursorHint?: string
}

/** Identity of one completion of a compensable step (repeated activations produce several). */
export interface SagaEntryRef {
  readonly step: string
  readonly runId: number
}

/** A completion pushed on the compensation stack, with the output snapshot the `compensate` hook receives. */
export interface SagaEntry extends SagaEntryRef {
  readonly seq: number
  readonly output?: unknown
}

export interface SagaState {
  /** Completions of steps with a `compensate` hook, in completion order (one entry per completion). */
  readonly stack: readonly SagaEntry[]
  readonly compensated: readonly SagaEntryRef[]
  readonly failures: readonly SagaEntryRef[]
  /** Compensation phase 1: steps whose `run` is still in flight and must settle before unwinding. */
  readonly settling?: readonly string[]
  /** The entry whose `compensate` call is in flight (one at a time). */
  readonly inFlight?: SagaEntryRef
  /** Set while compensating; decides `flow.compensated.outcome`. */
  readonly outcome?: 'failed' | 'cancelled'
  readonly reason?: string
}

export interface InboxEntry {
  readonly id: string
  readonly event: string
  readonly payload: unknown
  readonly at: number
  readonly expiresAt: number
}

export interface TimerEntry {
  readonly at: number
  readonly fire: Command | TimerFired
  /** What the timer is for (set by `apply` from `timer.scheduled` / `step.retryScheduled`). */
  readonly purpose?: 'retry' | 'waitTimeout' | 'inboxTtl' | 'compensationGrace'
  /** Owner step for `retry` / `waitTimeout` timers. */
  readonly step?: string
}

export interface WizardState {
  readonly status: WizardStatus
  /** UI cursor: the active view step, or null. */
  readonly current: string | null
  /** Every step whose status is `active`, in activation order. */
  readonly active: readonly string[]
  readonly context: unknown
  readonly steps: Readonly<Record<string, StepRecord>>
  /** Visited view ids in navigation order (stack for `back`). */
  readonly history: readonly string[]
  readonly nav: NavState
  readonly saga: SagaState
  readonly inbox: readonly InboxEntry[]
  readonly timers: Readonly<Record<string, TimerEntry>>
  /** Flow output once a `final` step ran (from its `output` hook). */
  readonly output?: unknown
  readonly seq: number
  readonly instanceId: string
  /** v0.2: correlation id used to filter external events (`defineFlow({ correlate })`). */
  readonly correlationId?: string
  /** Increments on every resume so a restarted instance is distinguishable (Mirror frames carry `epoch` + `seq`). */
  readonly epoch: number
  readonly flow: { readonly name: string; readonly version: number }
  readonly startedAt: number | null
  readonly updatedAt: number
}
