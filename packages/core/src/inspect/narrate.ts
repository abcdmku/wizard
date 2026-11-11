/**
 * One plain-English sentence per run event, and the set of bookkeeping event types a readable
 * trace leaves out. The switch is exhaustive: a new event type does not compile until it is
 * narrated here.
 * @internal
 */

import type { RunEventType } from '@openwizard/core'
import type { DomainEvent } from '../machine/events'

/** Machine bookkeeping: implied by the events around it, omitted from `formatTrace` by default. */
export const BOOKKEEPING: ReadonlySet<RunEventType> = new Set<RunEventType>([
  'child.command',
  'event.received',
  'flow.status',
  'result.ignored',
  'step.arrived',
  'step.enterCompleted',
  'step.eachItemKeyed',
  'step.eachChildOutputRequested',
  'step.eachMapErrorStarted',
  'step.eachRetryRequested',
  'step.exited',
  'step.idempotencyKeyRequested',
  'step.mapErrorStarted',
  'step.whenEvaluated',
  'step.whenStarted',
  'timer.cleared',
  'timer.fired',
  'timer.scheduled',
  'transition.phase',
  'transition.started',
])

export function narrate(e: DomainEvent, at: (time: number) => string): string {
  switch (e.type) {
    case 'flow.started':
      return `run started at ${e.start}`
    case 'flow.done':
      return 'run done'
    case 'flow.failed':
      return `run failed${e.step === undefined ? '' : ` at ${e.step}`}: ${e.error.message}${e.code === undefined ? '' : ` (${e.code})`}`
    case 'flow.halted':
      return `run halted at ${e.step}: ${e.error.message} (retry, skip, compensate or cancel)`
    case 'flow.compensating':
      return `compensating ${list(e.plan)}${e.status === undefined ? '' : ` after the run ${e.status === 'failed' ? 'failed' : 'was cancelled'}`}${e.reason === undefined ? '' : ` (${e.reason})`}`
    case 'flow.compensated':
      return e.failures.length === 0
        ? 'compensation completed'
        : `compensation partial: ${list(e.failures)} failed`
    case 'flow.cancelled':
      return `run cancelled${e.reason === undefined ? '' : ` (${e.reason})`}`
    case 'flow.resumed':
      return `run resumed from event ${e.fromSeq}${e.interrupted.length === 0 ? '' : `, interrupted: ${list(e.interrupted)}`}`
    case 'flow.reset':
      return 'run reset'
    case 'flow.status':
      return `status ${e.status}`
    case 'transition.started':
      return `navigating ${e.from ?? '(start)'} -> ${e.to ?? '?'} (${e.cause})`
    case 'transition.phase':
      return `navigation ${e.phase}${e.targets === undefined ? '' : ` ${list(e.targets)}`}`
    case 'transition.committed':
      return `moved ${e.direction === 'back' ? 'back ' : ''}${e.from ?? '(start)'} -> ${e.to ?? '(end)'}`
    case 'transition.rejected':
      return `navigation rejected: ${e.reason}${e.step === undefined ? '' : ` at ${e.step}`}${issues(e.issues)}`
    case 'transition.failed':
      return `navigation failed at ${e.step}: ${e.error.message}`
    case 'step.arrived':
      return `${e.step} arrived`
    case 'step.entered':
      return `${e.step} entered`
    case 'step.enterCompleted':
      return `${e.step} enter hook completed`
    case 'step.exited':
      return `${e.step} exited -> ${e.to ?? '(end)'}`
    case 'step.done':
      return `${e.step} done${e.next === undefined ? '' : ` -> ${e.next}`}`
    case 'step.failed':
      return `${e.step} failed (${e.kind}): ${e.error.message}`
    case 'step.skipped':
      return `${e.step} skipped${e.reason === undefined ? '' : ` (${e.reason})`}`
    case 'step.whenStarted':
      return `${e.step} checking when`
    case 'step.whenEvaluated':
      return `${e.step} when ${e.ok ? 'passed' : 'failed'}`
    case 'step.invalidated':
      return `${e.step} invalidated${e.cause === 'cascade' ? ' (cascade)' : ''}`
    case 'step.cancelled':
      return `${e.step} cancelled${e.reason === undefined ? '' : ` (${e.reason})`}`
    case 'step.validated':
      return `${e.step} input valid`
    case 'step.validationFailed':
      return `${e.step} input invalid${issues(e.issues)}`
    case 'step.guardEvaluated':
      return `${e.step} ${e.hook} ${e.ok ? 'allowed' : 'blocked'}${e.reason === undefined ? '' : ` (${e.reason})`}`
    case 'step.idempotencyKeyRequested':
      return `${e.step} computing idempotency key`
    case 'step.runStarted':
      return `${e.step} attempt ${e.attempt} started${e.resumed === true ? ' (resumed)' : ''}`
    case 'step.runSucceeded':
      return `${e.step} attempt ${e.attempt} succeeded`
    case 'step.eachStarted':
      return `${e.step} map started (${e.items.length} items)`
    case 'step.eachItemStarted':
      return `${e.step} item ${e.index} attempt ${e.attempt} started${e.resumed === true ? ' (resumed)' : ''}`
    case 'step.eachItemCompleted':
      return `${e.step} item ${e.index} done`
    case 'step.eachItemKeyed':
      return `${e.step} item ${e.index} keyed ${JSON.stringify(e.key)}`
    case 'step.eachItemFailed':
      return `${e.step} item ${e.index} attempt ${e.attempt} failed: ${e.error.message}${e.willRetry ? ', will retry' : ''}`
    case 'step.eachRetryScheduled':
      return `${e.step} item ${e.index} retry (attempt ${e.attempt}) at ${at(e.dueAt)}`
    case 'step.eachRetryRequested':
      return `${e.step} retrying items ${list(e.indices.map(String))}`
    case 'step.eachChildStarted':
      return `${e.step} item ${e.index} child flow started`
    case 'step.eachChildSummary':
      return `${e.step} item ${e.index} child flow ${e.summary.status}`
    case 'step.eachChildOutputRequested':
      return `${e.step} item ${e.index} mapping child output`
    case 'step.eachMapErrorStarted':
      return `${e.step} item ${e.index} mapping error of attempt ${e.attempt}`
    case 'step.mapErrorStarted':
      return `${e.step} mapping error of attempt ${e.attempt}`
    case 'step.runFailed':
      return `${e.step} attempt ${e.attempt} failed${e.timedOut === true ? ' (timeout)' : ''}: ${e.error.message}${e.willRetry ? ', will retry' : ''}`
    case 'step.retryScheduled':
      return `${e.step} retry (attempt ${e.attempt}) at ${at(e.dueAt)}`
    case 'step.compensationStarted':
      return `${e.step} compensating`
    case 'step.compensated':
      return `${e.step} compensated`
    case 'step.compensationFailed':
      return `${e.step} compensation failed: ${e.error.message}`
    case 'step.progress':
      return `${e.step} progress ${brief(e.value)}`
    case 'input.changed':
      return `${e.step} input ${e.reset === true ? 'reset' : 'changed'}`
    case 'context.changed':
      return `context updated${e.by === undefined ? '' : ` by ${e.by}`}`
    case 'event.received':
      return `event ${e.event} received`
    case 'event.rejected':
      return `event ${e.event} rejected${issues(e.issues)}`
    case 'event.delivered':
      return `event ${e.event} delivered to ${e.to}`
    case 'event.buffered':
      return `event ${e.event} buffered until ${at(e.expiresAt)}`
    case 'event.expired':
      return `event ${e.event} expired`
    case 'event.dropped':
      return `event ${e.event} dropped (${e.reason})`
    case 'event.flowDelivered':
      return `event ${e.event} handled by the flow`
    case 'event.handlerResultIgnored':
      return `${e.step} ignored the result of its ${e.event} handler (${e.reason})`
    case 'event.handlerFailed':
      return `${e.event} handler${e.step === undefined ? '' : ` of ${e.step}`} failed: ${e.error.message}`
    case 'timer.scheduled':
      return `${e.purpose} timer${e.step === undefined ? '' : ` for ${e.step}`} due at ${at(e.dueAt)}`
    case 'timer.fired':
      return `timer ${e.timerId} fired`
    case 'timer.cleared':
      return `timer ${e.timerId} cleared`
    case 'child.started':
      return `${e.step} child flow started`
    case 'child.summary':
      return `${e.step} child flow ${e.summary.status}`
    case 'child.command':
      return `${e.step} child command ${e.command.type}`
    case 'persist.failed':
      return `persist failed (${e.reason}): ${e.message}`
    case 'command.rejected':
      return `command ${e.command.type} rejected (${e.code}): ${e.reason}`
    case 'result.ignored':
      return `result ignored (${e.reason})`
    default:
      return unnarrated(e)
  }
}

function unnarrated(event: never): string {
  return `unknown event ${JSON.stringify(event)}`
}

function list(ids: readonly string[]): string {
  return ids.length === 0 ? '(nothing)' : ids.join(', ')
}

function issues(list: readonly { readonly message: string }[] | undefined): string {
  return list === undefined || list.length === 0 ? '' : `: ${list.map((i) => i.message).join('; ')}`
}

/** A short one-line rendering of an arbitrary value. */
export function brief(value: unknown): string {
  if (typeof value === 'string') return value.length > 40 ? `${value.slice(0, 37)}...` : value
  if (typeof value === 'number' || typeof value === 'boolean' || value === null)
    return String(value)
  if (Array.isArray(value)) return `[${value.length}]`
  if (typeof value === 'object') {
    if ('message' in value && typeof value.message === 'string') return brief(value.message)
    if ('type' in value && typeof value.type === 'string') return value.type
    return `{${Object.keys(value).length}}`
  }
  return typeof value
}
