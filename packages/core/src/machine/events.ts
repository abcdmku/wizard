/**
 * Domain events — the facts the machine produces. `apply` folds them into
 * state; `plan` turns them into effects; `observe()` streams them to users;
 * `log()` keeps a bounded ring for tracing and devtools.
 *
 * Every event carries an `Envelope` (assigned by the interpreter): a monotonic
 * `seq`, a timestamp, the wizard `path` (nested flows), and `causedBy` — the
 * seq of the message/event that caused it — so causality can be replayed.
 */

import type { Command } from './commands'
import type {
  ChildSummary,
  Issue,
  NavCause,
  NavPhase,
  SerializedError,
  WizardStatus,
} from './state'

export interface Envelope {
  /** Monotonic per wizard instance. */
  readonly seq: number
  /** `clock.now()` when applied. */
  readonly at: number
  /** Path of the wizard that produced the event: [] for the root, ['fulfil'] for a child. */
  readonly path: readonly string[]
  /** seq of the causing event, if any (effect results reference the event that planned the effect). */
  readonly causedBy?: number
  /** Optional wall-clock duration for hook results. */
  readonly durationMs?: number
}

export type DomainEventBody =
  // ---- flow lifecycle ------------------------------------------------------
  | { readonly type: 'flow.started'; readonly start: string }
  | { readonly type: 'flow.done'; readonly output?: unknown }
  | {
      readonly type: 'flow.failed'
      readonly step?: string
      readonly error: SerializedError
      readonly code?: 'AUTO_ADVANCE_LOOP' | 'STEP_FAILED' | 'CHILD_FAILED'
    }
  /** `outcome` = what `flow.compensated` will report ('cancelled' when triggered by `cancel`, else 'failed'). */
  | {
      readonly type: 'flow.compensating'
      readonly reason?: string
      readonly plan: readonly string[]
      readonly outcome?: 'failed' | 'cancelled'
    }
  | {
      readonly type: 'flow.compensated'
      readonly failures: readonly string[]
      readonly outcome: 'failed' | 'cancelled'
    }
  | { readonly type: 'flow.cancelled'; readonly reason?: string }
  | {
      readonly type: 'flow.resumed'
      readonly fromSeq: number
      readonly interrupted: readonly string[]
    }
  | { readonly type: 'flow.reset' }
  | { readonly type: 'flow.status'; readonly status: WizardStatus }
  // ---- navigation (cursor) -------------------------------------------------
  | {
      readonly type: 'transition.started'
      readonly txId: string
      readonly from: string | null
      readonly to?: string
      readonly cause: NavCause
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
      readonly to: string
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
  /** `next` = auto-advance target override (wait handler `{ next }`, `waitTimeout.next`). */
  | {
      readonly type: 'step.done'
      readonly step: string
      readonly output?: unknown
      readonly next?: string
    }
  | {
      readonly type: 'step.failed'
      readonly step: string
      readonly error: SerializedError
      readonly kind: 'run' | 'timeout' | 'hook' | 'child' | 'sync-violation' | 'interrupted'
    }
  | { readonly type: 'step.skipped'; readonly step: string; readonly reason?: string }
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
  // ---- task execution ------------------------------------------------------
  | {
      readonly type: 'step.runStarted'
      readonly step: string
      readonly attempt: number
      readonly runId: number
      readonly idempotencyKey: string
    }
  | {
      readonly type: 'step.runSucceeded'
      readonly step: string
      readonly attempt: number
      readonly output: unknown
    }
  | {
      readonly type: 'step.runFailed'
      readonly step: string
      readonly attempt: number
      readonly error: SerializedError
      readonly willRetry: boolean
      readonly timedOut?: boolean
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
  // ---- data ----------------------------------------------------------------
  | {
      readonly type: 'input.changed'
      readonly step: string
      readonly patch: unknown
      readonly reset?: boolean
    }
  | { readonly type: 'context.changed'; readonly patch: unknown; readonly by?: string }
  // ---- external events -----------------------------------------------------
  | {
      readonly type: 'event.received'
      readonly event: string
      readonly payload: unknown
      readonly correlationId?: string
      readonly inboxId: string
    }
  | { readonly type: 'event.rejected'; readonly event: string; readonly issues: readonly Issue[] }
  /** `payload` travels with the delivery so `plan` can build the `on` call from the event alone. */
  | {
      readonly type: 'event.delivered'
      readonly event: string
      readonly to: string
      readonly inboxId: string
      readonly payload?: unknown
    }
  | {
      readonly type: 'event.buffered'
      readonly event: string
      readonly inboxId: string
      readonly expiresAt: number
      readonly payload?: unknown
    }
  | { readonly type: 'event.expired'; readonly event: string; readonly inboxId: string }
  | { readonly type: 'event.dropped'; readonly event: string; readonly reason: string }
  // ---- timers --------------------------------------------------------------
  /** `dueAt` = absolute fire time (`at` is the envelope timestamp). `step` is set for `retry` / `waitTimeout` timers (owner step). */
  | {
      readonly type: 'timer.scheduled'
      readonly timerId: string
      readonly dueAt: number
      readonly purpose: 'retry' | 'waitTimeout' | 'inboxTtl' | 'compensationGrace'
      readonly step?: string
    }
  | { readonly type: 'timer.fired'; readonly timerId: string }
  | { readonly type: 'timer.cleared'; readonly timerId: string }
  // ---- nested flows --------------------------------------------------------
  /** `childPath` = the child's wizard path (`[...path, step]`; `path` is the envelope field). `context` = value returned by `childContext` (input for `child.create`). */
  | {
      readonly type: 'child.started'
      readonly step: string
      readonly childPath: readonly string[]
      readonly context?: unknown
    }
  /** `done` mirrors `res.child.done` so `plan` can call `childOutput` / `apply` can store the child output. */
  | {
      readonly type: 'child.summary'
      readonly step: string
      readonly summary: ChildSummary
      readonly done?: { readonly output: unknown }
    }
  /** A `child` command was accepted and must be forwarded to the child interpreter (`plan` → `child.send`). */
  | { readonly type: 'child.command'; readonly step: string; readonly command: Command }
  // ---- persistence (recorded by the runtime, not decided by the machine) ------
  /**
   * An auto-save or `save()` could not be written: the snapshot is not JSON-serializable
   * (`reason: 'not-serializable'`, `location` = the offending path, e.g.
   * `state.steps.save.output.createdAt`) or the store rejected (`reason: 'store'`). The state
   * itself is unchanged; the envelope `seq` is the seq of the snapshot that failed to persist.
   */
  | {
      readonly type: 'persist.failed'
      readonly reason: 'not-serializable' | 'store'
      readonly key: string
      readonly message: string
      readonly location?: string
    }
  // ---- machine bookkeeping -------------------------------------------------
  | {
      readonly type: 'command.rejected'
      readonly command: Command
      readonly reason: string
      readonly code: string
    }
  | {
      readonly type: 'result.ignored'
      readonly effectId: string
      readonly reason: 'stale' | 'cancelled' | 'unknown-step'
    }

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
  | 'flow-terminal'
  | 'flow-not-started'
  | 'flow-compensating'
  | 'resumed'
  | 'auto-advance-loop'

export type DomainEvent = Envelope & DomainEventBody
export type DomainEventType = DomainEventBody['type']

/** Narrow a domain event by type. */
export type EventOf<T extends DomainEventType> = Extract<DomainEvent, { type: T }>
