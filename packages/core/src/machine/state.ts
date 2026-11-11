/**
 * Runtime state of a run instance.
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
import type { EachState } from './each-state'
import type {
  InboxEntry,
  Issue,
  RunFailureState,
  SerializedError,
  StepErrorKind,
  TerminalState,
  TimerEntry,
} from './state-support'

export type {
  CompensationFailureState,
  CompensationOutcome,
  InboxEntry,
  Issue,
  RunFailureState,
  SerializedError,
  StepErrorKind,
  TerminalState,
  TimerEntry,
} from './state-support'

// ---------------------------------------------------------------------------
// Statuses (stored). Kind + sub-fields explain what "active" means:
// view=shown, runnable step=running/retrying, event-driven step=waiting, child=child running.
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

export type RunStatus =
  | 'idle' // created, not started
  | 'running' // at least one plain or child step is executing
  | 'waiting' // nothing executing; waiting for a user (view) or an external event / timer
  | 'halted' // a step failed under `onFailure: 'halt'`; retry / skip / run / compensate / cancel recover it
  | 'done'
  | 'failed' // terminal
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

export interface StepError extends SerializedError {
  readonly kind: StepErrorKind
  readonly at: number
  readonly attempt?: number
  /** Standard-Schema issues when kind === 'validation'. */
  readonly issues?: readonly Issue[]
  /** JSON-safe value produced by a runnable step's `mapError` (typed via `ErrorOf<F, K>`). */
  readonly data?: unknown
}

interface GuardResult {
  readonly ok: boolean
  /** seq of the event that recorded this result. */
  readonly seq: number
  readonly reason?: string
}

export interface ChildSummary {
  readonly status: RunStatus
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
   * Result of the step: parsed input (view), a `run` result, a resolving event, normalized
   * routing output, or child output (child step). Map outputs retain the input order.
   */
  readonly output?: unknown
  /** Last validation issues (view). Cleared on the next input change. */
  readonly issues?: readonly Issue[]
  readonly error?: StepError
  /** Output before the last explicit invalidation. */
  readonly previousOutput?: unknown
  /** An explicit invalidation remains pending until the step is activated again. */
  readonly invalidated?: true
  /**
   * Why the step was skipped: `'when'`, `'command'`, `'not-taken'`, `'needs-skipped'`,
   * `'fallback'` or `'timeout'`.
   */
  readonly skipReason?: string
  /** Attempt counter for the current run (1-based while running; 0 when idle). */
  readonly attempt: number
  /** Increments each time the step (re)starts after completion or invalidation. Used for stale-result tokens. */
  readonly runId: number
  /** Scheduled retry time for a run. */
  readonly retryAt?: number
  /** Absolute event timeout. Re-armed on resume. */
  readonly deadline?: number
  /** Idempotency key for the current run. */
  readonly idempotencyKey?: string
  readonly guards: {
    readonly canEnter?: GuardResult
    readonly canExit?: GuardResult
  }
  /**
   * State of the step's `when` predicate for the current activation — `'pending'` while the
   * call is in flight, `'passed'` once it returned true (the step may enter). Absent when the step
   * has no `when` hook or has not been evaluated yet; cleared on entry, skip and invalidation.
   */
  readonly when?: 'pending' | 'passed'
  /** Event sequence that identifies the current dynamic draft initializer call. */
  readonly initializing?: number
  /** True while the step's `enter` hook is in flight (kind-specific work starts after it resolves). */
  readonly entering?: boolean
  /** The `enter` hook already ran for the pending activation (transition `entering` phase); cleared when the step enters. */
  readonly enterDone?: boolean
  /** Sequence of the most recent completion, used to select natural wizard output. */
  readonly completedSeq?: number
  readonly enteredAt?: number
  readonly exitedAt?: number
  /** When the step last settled (done, failed, skipped or cancelled). */
  readonly endedAt?: number
  readonly visitedCount: number
  /**
   * Set when `start`, a completed predecessor's `next` or a finished `needs` producer arrives
   * here while the step is not active; cleared when the step enters. Together with `needs`
   * gating this is the readiness rule: `ready = pendingActivation && depsSatisfied`.
   */
  readonly pendingActivation: boolean
  /** seq of the arrival that set `pendingActivation` (scheduler picks ready steps in arrival order). */
  readonly arrivedSeq?: number
  /** Child run summary (child steps). The full child snapshot lives in `Snapshot.children`. */
  readonly child?: ChildSummary
  /** Snapshotted map items and their durable results. */
  readonly each?: EachState
}

// ---------------------------------------------------------------------------
// Whole-run state
// ---------------------------------------------------------------------------

/** A delivered `send` event id and when it was delivered (ms). */
export interface SeenEventId {
  readonly id: string
  readonly at: number
}

export interface NavState {
  readonly phase: NavPhase
  readonly txId?: string
  readonly from?: string | null
  /** Resolved target(s) of the in-flight transition (first = cursor target). */
  readonly targets?: readonly string[]
  readonly cause?: NavCause
  readonly direction?: 'forward' | 'back'
  /** Targets still awaiting an initializer, `canEnter`, or `enter` result in the current phase. */
  readonly pendingSteps?: readonly string[]
  /** Auto-advance hop counter for the current command (guard against `next` loops). */
  readonly hops?: number
  /** Sources of the latest auto-advances since the last async boundary (newest last, at most 4). */
  readonly trail?: readonly string[]
  /**
   * Non-view steps that completed while a transition was in flight; their
   * auto-advance starts (in order) as soon as `nav` returns to idle.
   * `to` = target override carried by `step.done.next`.
   */
  readonly deferred?: ReadonlyArray<{
    readonly step: string
    readonly to?: string | readonly string[]
  }>
  /**
   * The view a committed transition wanted as cursor but could not enter because its `when`
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
  /** Set while compensating: the run status `run.compensated` ends in. */
  readonly outcome?: 'failed' | 'cancelled'
  readonly reason?: string
}

export interface WizardState {
  readonly status: RunStatus
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
  /** Wizard output once a completing step ran. */
  readonly output?: unknown
  /** Primary failure retained for a recoverable halt and for compensation results. */
  readonly failure?: RunFailureState
  /** Persisted exact terminal facts; absent in pre-result snapshots. */
  readonly terminal?: TerminalState
  readonly seq: number
  readonly instanceId: string
  /** Correlation id used to filter external events (`defineWizard({ correlate })`). */
  readonly correlationId?: string
  /** Delivered `send` event ids still inside the dedupe window, oldest first. */
  readonly eventIds?: readonly SeenEventId[]
  /** Increments on every resume so a restarted instance is distinguishable (Mirror frames carry `epoch` + `seq`). */
  readonly epoch: number
  readonly wizard: { readonly name: string; readonly version: number }
  readonly startedAt: number | null
  readonly updatedAt: number
}
