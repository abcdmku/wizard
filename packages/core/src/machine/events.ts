/**
 * Domain events — the facts the machine produces. `apply` folds them into state; `plan` turns
 * them into effects; `observe()` streams them to users; `log()` keeps the trace. Every event
 * carries an envelope with sequence, time, run path and causality.
 */

import type { EachEventBody } from './each-events'
import type { IoEventBody } from './event-io'
import type { LifecycleEventBody } from './event-lifecycle'

export type { TransitionRejectReason } from './event-lifecycle'

export interface Envelope {
  /** Monotonic per run instance. */
  readonly seq: number
  /** `clock.now()` when applied. */
  readonly at: number
  /** Path of the run that produced the event: [] for the root, ['fulfil'] for a child. */
  readonly path: readonly string[]
  /** seq of the causing event, if any (effect results reference the event that planned the effect). */
  readonly causedBy?: number
  /** Optional wall-clock duration for hook results. */
  readonly durationMs?: number
}

export type DomainEventBody = LifecycleEventBody | IoEventBody | EachEventBody
export type DomainEvent = Envelope & DomainEventBody
export type DomainEventType = DomainEventBody['type']

/** Every event name emitted by a run. @public */
export const RUN_EVENT_TYPES: readonly DomainEventType[] = Object.freeze([
  'child.command',
  'child.started',
  'child.summary',
  'command.rejected',
  'context.changed',
  'event.buffered',
  'event.delivered',
  'event.dropped',
  'event.expired',
  'event.handlerFailed',
  'event.handlerResultIgnored',
  'event.received',
  'event.rejected',
  'event.wizardDelivered',
  'input.changed',
  'persist.failed',
  'result.ignored',
  'run.cancelled',
  'run.compensated',
  'run.compensating',
  'run.done',
  'run.failed',
  'run.halted',
  'run.reset',
  'run.resumed',
  'run.started',
  'run.status',
  'step.arrived',
  'step.cancelled',
  'step.compensated',
  'step.compensationFailed',
  'step.compensationStarted',
  'step.done',
  'step.eachChildOutputRequested',
  'step.eachChildStarted',
  'step.eachChildSummary',
  'step.eachItemCompleted',
  'step.eachItemFailed',
  'step.eachItemKeyed',
  'step.eachItemStarted',
  'step.eachMapErrorStarted',
  'step.eachRetryRequested',
  'step.eachRetryScheduled',
  'step.eachStarted',
  'step.enterCompleted',
  'step.entered',
  'step.exited',
  'step.failed',
  'step.guardEvaluated',
  'step.idempotencyKeyRequested',
  'step.invalidated',
  'step.mapErrorStarted',
  'step.progress',
  'step.retryScheduled',
  'step.runFailed',
  'step.runStarted',
  'step.runSucceeded',
  'step.skipped',
  'step.validated',
  'step.validationFailed',
  'step.whenEvaluated',
  'step.whenStarted',
  'timer.cleared',
  'timer.fired',
  'timer.scheduled',
  'transition.committed',
  'transition.failed',
  'transition.phase',
  'transition.rejected',
  'transition.started',
])
